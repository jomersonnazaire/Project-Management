import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:app_links/app_links.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import 'api_client.dart';
import 'http_factory.dart';
import 'models.dart';

const _pkceKey = 'opstrack.ms_pkce';
const _pkceTtl = Duration(minutes: 10);

/// Microsoft sign-in failed with a user-visible message.
class MicrosoftSignInFailure implements Exception {
  MicrosoftSignInFailure(this.message);
  final String message;
  @override
  String toString() => message;
}

/// User cancelled Microsoft sign-in.
class MicrosoftSignInCancelled extends MicrosoftSignInFailure {
  MicrosoftSignInCancelled() : super(msCancelledMessage);
}

const msFailedMessage =
    'Microsoft sign-in failed. Try again or use your email and password.';
const msNoEmailMessage =
    'Your Microsoft account has no email address. Ask an Admin.';
const msCancelledMessage = 'Microsoft sign-in was cancelled.';
const msExpiredMessage = 'Sign-in expired. Try again.';
const msDeactivatedMessage =
    'This account is deactivated. Contact your administrator.';
const msOfflineMessage =
    "Can't reach the server. Check your connection and try again.";
const msRateLimitedMessage =
    'Too many sign-in attempts. Wait a few minutes and try again.';

/// Maps a failed POST /auth/mobile/microsoft/exchange to a login-screen message.
String msExchangeErrorMessage(ApiException e) {
  final status = e.status ?? 0;
  if (status == 0 || status >= 500) return msOfflineMessage;
  if (status == 403) return msDeactivatedMessage;
  if (status == 429) return msRateLimitedMessage;
  if (status == 400) return msExpiredMessage;
  return msFailedMessage;
}

class PkcePair {
  PkcePair({required this.verifier, required this.challenge});
  final String verifier;
  final String challenge;

  static PkcePair generate() {
    final bytes = List<int>.generate(32, (_) => Random.secure().nextInt(256));
    final verifier = base64Url.encode(bytes).replaceAll('=', '');
    final digest = sha256.convert(ascii.encode(verifier));
    final challenge = base64Url.encode(digest.bytes).replaceAll('=', '');
    return PkcePair(verifier: verifier, challenge: challenge);
  }
}

typedef LaunchUrlFn = Future<bool> Function(Uri uri);
typedef UriLinkStream = Stream<Uri>;

abstract class MsPkceStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class FlutterMsPkceStorage implements MsPkceStorage {
  FlutterMsPkceStorage([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class MicrosoftSignIn {
  MicrosoftSignIn({
    required this.api,
    MsPkceStorage? storage,
    LaunchUrlFn? launch,
    UriLinkStream? links,
    AppLinks? appLinks,
    Future<Uri?> Function()? initialLink,
  }) : _storage = storage ?? FlutterMsPkceStorage(),
       _launch =
           launch ??
           ((uri) => launchUrl(uri, mode: LaunchMode.externalApplication)),
       _appLinks = appLinks ?? AppLinks(),
       _links = links,
       _initialLink = initialLink;

  final ApiClient api;
  final MsPkceStorage _storage;
  final LaunchUrlFn _launch;
  final AppLinks _appLinks;
  final UriLinkStream? _links;
  final Future<Uri?> Function()? _initialLink;
  StreamSubscription<Uri>? _sub;

  /// One handle() at a time, in arrival order.
  Future<void> _queue = Future.value();

  /// One-time codes already exchanged or being exchanged (each is single-use).
  final _seenCodes = <String>{};

  Stream<Uri> get linkStream => _links ?? _appLinks.uriLinkStream;

  /// app_links returns the launch link from getInitialLink() and also replays it on the
  /// stream, so the first stream link equal to the launch link is dropped (once).
  Future<void> bindDeepLinks(void Function(Uri uri) onUri) async {
    await _sub?.cancel();
    final initialFn = _initialLink;
    Uri? launch = initialFn != null
        ? await initialFn()
        : await _appLinks.getInitialLink();
    if (launch != null) onUri(launch);
    _sub = linkStream.listen((uri) {
      if (launch != null && uri == launch) {
        launch = null;
        return;
      }
      launch = null;
      onUri(uri);
    });
  }

  Future<void> dispose() async => _sub?.cancel();

  Future<void> start() async {
    if (AppConfig.demoMode || browserManagesCookies) {
      throw MicrosoftSignInFailure('Microsoft sign-in is not available.');
    }
    final pkce = PkcePair.generate();
    await _storage.write(
      _pkceKey,
      jsonEncode({
        'verifier': pkce.verifier,
        'createdAt': DateTime.now().toUtc().toIso8601String(),
      }),
    );
    final base = AppConfig.apiBaseUrl.endsWith('/')
        ? AppConfig.apiBaseUrl.substring(0, AppConfig.apiBaseUrl.length - 1)
        : AppConfig.apiBaseUrl;
    final uri = Uri.parse('$base/auth/mobile/microsoft/login').replace(
      queryParameters: {
        'code_challenge': pkce.challenge,
        'code_challenge_method': 'S256',
      },
    );
    final ok = await _launch(uri);
    if (!ok) {
      throw MicrosoftSignInFailure('Could not open the sign-in page.');
    }
  }

  /// Handles an `opstrack://auth/microsoft` link; returns null for other links and for a
  /// code that was already handled. Calls run one at a time.
  Future<AppUser?> handle(Uri uri) {
    final run = _queue.then((_) => _handle(uri));
    _queue = run.then<void>((_) {}, onError: (Object _) {});
    return run;
  }

  Future<AppUser?> _handle(Uri uri) async {
    if (uri.scheme != 'opstrack' || uri.host != 'auth') return null;
    final path = uri.path.isEmpty ? '' : uri.path;
    if (path != '/microsoft' && path != 'microsoft') return null;
    final linkCode = uri.queryParameters['code'];
    if (linkCode != null && linkCode.isNotEmpty && !_seenCodes.add(linkCode)) {
      return null; // same code again: already exchanged or in flight
    }

    final raw = await _storage.read(_pkceKey);
    await _storage.delete(_pkceKey);

    // The server's error comes first: it is the real reason, even if the PKCE entry is gone.
    final err = uri.queryParameters['error'];
    if (err != null && err.isNotEmpty) {
      if (err == 'cancelled') throw MicrosoftSignInCancelled();
      if (err == 'ms_no_email') throw MicrosoftSignInFailure(msNoEmailMessage);
      throw MicrosoftSignInFailure(msFailedMessage);
    }

    if (raw == null) throw MicrosoftSignInFailure(msExpiredMessage);
    final String verifier;
    try {
      final parsed = jsonDecode(raw) as Map<String, dynamic>;
      final createdAt = DateTime.parse(parsed['createdAt'] as String).toUtc();
      if (DateTime.now().toUtc().difference(createdAt) > _pkceTtl) {
        throw MicrosoftSignInFailure(msExpiredMessage);
      }
      verifier = parsed['verifier'] as String;
    } on MicrosoftSignInFailure {
      rethrow;
    } catch (_) {
      throw MicrosoftSignInFailure(msExpiredMessage);
    }

    final code = uri.queryParameters['code'];
    if (code == null || code.isEmpty) {
      throw MicrosoftSignInFailure(msFailedMessage);
    }

    await api.clearSession();
    try {
      final body = await api.post('/auth/mobile/microsoft/exchange', {
        'code': code,
        'code_verifier': verifier,
      });
      api.bearer = body['token'] as String;
      await api.touch();
      return AppUser.fromJson(body['user'] as Map<String, dynamic>);
    } on ApiException catch (e) {
      await api.clearSession();
      throw MicrosoftSignInFailure(msExchangeErrorMessage(e));
    } catch (_) {
      await api.clearSession();
      throw MicrosoftSignInFailure(msFailedMessage);
    }
  }
}
