import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xc8_pm/config.dart';
import 'package:xc8_pm/data/api_client.dart';
import 'package:xc8_pm/data/ms_sign_in.dart';
import 'package:xc8_pm/data/session_store.dart';
import 'package:xc8_pm/state/providers.dart';

import 'helpers.dart';

class MemoryMsPkceStorage implements MsPkceStorage {
  final map = <String, String>{};

  @override
  Future<void> delete(String key) async => map.remove(key);

  @override
  Future<String?> read(String key) async => map[key];

  @override
  Future<void> write(String key, String value) async => map[key] = value;
}

const _verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

Future<MemoryMsPkceStorage> freshPkce() async {
  final storage = MemoryMsPkceStorage();
  await storage.write(
    'opstrack.ms_pkce',
    jsonEncode({
      'verifier': _verifier,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
    }),
  );
  return storage;
}

/// API whose exchange endpoint answers [status] with [code], or throws (offline) when null.
ApiClient exchangeApi(int? status, {String? code, MemorySessionStore? store}) =>
    ApiClient(
      'http://api.test/api/v1',
      store: store,
      timeout: const Duration(seconds: 2),
      client: MockClient((req) async {
        if (status == null) throw const SocketExceptionLike();
        return http.Response(
          jsonEncode({
            'error': {'code': code, 'message': 'server text'},
          }),
          status,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

/// Single-use code server: the first exchange succeeds, any repeat gets 400 INVALID_CODE.
class SingleUseExchange {
  int exchanges = 0;
  final store = MemorySessionStore();
  late final api = ApiClient(
    'http://api.test/api/v1',
    store: store,
    client: MockClient((req) async {
      if (!req.url.path.endsWith('/auth/mobile/microsoft/exchange')) {
        return http.Response('{}', 404);
      }
      exchanges++;
      if (exchanges > 1) {
        return http.Response(
          jsonEncode({
            'error': {'code': 'INVALID_CODE', 'message': 'x'},
          }),
          400,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response(
        jsonEncode({
          'user': {
            'id': 'u1',
            'email': 'a@xceler8.com',
            'name': 'A',
            'systemRole': 'VIEWER',
            'jobRole': null,
          },
          'token': 'mobile-bearer-token-123456789012345678901234',
          'expiresAt': DateTime.utc(2026, 10, 30).toIso8601String(),
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    }),
  );
}

/// Starts with an error already set, as if a deep link failed before the login screen was built.
class PresetMsError extends MsSignInErrorController {
  PresetMsError(this.initial);
  final String? initial;
  @override
  String? build() => initial;
}

class SocketExceptionLike implements Exception {
  const SocketExceptionLike();
}

String s256Challenge(String verifier) {
  final digest = sha256.convert(ascii.encode(verifier));
  return base64Url.encode(digest.bytes).replaceAll('=', '');
}

void main() {
  test('PKCE RFC 7636 vector and generated verifier shape', () {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(
      s256Challenge(verifier),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    final generated = PkcePair.generate();
    expect(generated.verifier.length, 43);
    expect(RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(generated.verifier), isTrue);
    expect(s256Challenge(generated.verifier), generated.challenge);
  });

  test(
    'start stores verifier and launches login URL with S256 challenge',
    () async {
      AppConfig.debugApiBaseUrl = 'http://api.test/api/v1';
      addTearDown(() => AppConfig.debugApiBaseUrl = null);
      final storage = MemoryMsPkceStorage();
      Uri? launched;
      final api = ApiClient(
        'http://api.test/api/v1',
        client: MockClient((_) async {
          throw UnimplementedError();
        }),
      );
      final ms = MicrosoftSignIn(
        api: api,
        storage: storage,
        launch: (uri) async {
          launched = uri;
          return true;
        },
      );
      await ms.start();
      expect(storage.map.containsKey('opstrack.ms_pkce'), isTrue);
      expect(launched, isNotNull);
      expect(launched!.path, endsWith('/auth/mobile/microsoft/login'));
      expect(launched!.queryParameters['code_challenge_method'], 'S256');
      expect(launched!.queryParameters['code_challenge']!.length, 43);
    },
  );

  test(
    'handle(code) exchanges, sets bearer, touches session, clears pkce',
    () async {
      AppConfig.debugApiBaseUrl = 'http://api.test/api/v1';
      addTearDown(() => AppConfig.debugApiBaseUrl = null);
      final storage = MemoryMsPkceStorage();
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      await storage.write(
        'opstrack.ms_pkce',
        jsonEncode({
          'verifier': verifier,
          'createdAt': DateTime.now().toUtc().toIso8601String(),
        }),
      );
      final sessionStore = MemorySessionStore();
      final calls = <String>[];
      final api = ApiClient(
        'http://api.test/api/v1',
        store: sessionStore,
        client: MockClient((req) async {
          calls.add('${req.method} ${req.url.path}');
          if (req.url.path.endsWith('/auth/mobile/microsoft/exchange')) {
            final b = jsonDecode(req.body) as Map<String, dynamic>;
            expect(b['code'], 'abc');
            expect(b['code_verifier'], verifier);
            return http.Response(
              jsonEncode({
                'user': {
                  'id': 'u1',
                  'email': 'a@xceler8.com',
                  'name': 'A',
                  'systemRole': 'VIEWER',
                  'jobRole': null,
                },
                'token': 'mobile-bearer-token-123456789012345678901234',
                'expiresAt': DateTime.utc(2026, 10, 12).toIso8601String(),
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (req.url.path.endsWith('/auth/me')) {
            return http.Response(
              jsonEncode({
                'user': {
                  'id': 'u1',
                  'email': 'a@xceler8.com',
                  'name': 'A',
                  'systemRole': 'VIEWER',
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('{}', 404);
        }),
      );
      final ms = MicrosoftSignIn(api: api, storage: storage);
      final user = await ms.handle(
        Uri.parse('opstrack://auth/microsoft?code=abc'),
      );
      expect(user?.email, 'a@xceler8.com');
      expect(api.bearer, 'mobile-bearer-token-123456789012345678901234');
      expect(await sessionStore.read(), isNotNull);
      expect(storage.map.containsKey('opstrack.ms_pkce'), isFalse);
      expect(
        calls.any((c) => c.contains('/auth/mobile/microsoft/exchange')),
        isTrue,
      );
    },
  );

  test('handle(ms_no_email) shows message and sends no request', () async {
    final storage = MemoryMsPkceStorage();
    await storage.write(
      'opstrack.ms_pkce',
      jsonEncode({
        'verifier': 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        'createdAt': DateTime.now().toUtc().toIso8601String(),
      }),
    );
    var posts = 0;
    final api = ApiClient(
      'http://api.test/api/v1',
      client: MockClient((req) async {
        posts++;
        return http.Response('{}', 500);
      }),
    );
    final ms = MicrosoftSignIn(api: api, storage: storage);
    expect(
      () => ms.handle(Uri.parse('opstrack://auth/microsoft?error=ms_no_email')),
      throwsA(
        isA<MicrosoftSignInFailure>().having(
          (e) => e.message,
          'message',
          contains('no email'),
        ),
      ),
    );
    expect(posts, 0);
    expect(api.bearer, isNull);
  });

  test('missing or stale pkce fails without exchange', () async {
    final storage = MemoryMsPkceStorage();
    final api = ApiClient(
      'http://api.test/api/v1',
      client: MockClient((_) async => http.Response('{}', 500)),
    );
    final ms = MicrosoftSignIn(api: api, storage: storage);
    await expectLater(
      ms.handle(Uri.parse('opstrack://auth/microsoft?code=x')),
      throwsA(isA<MicrosoftSignInFailure>()),
    );
    await storage.write(
      'opstrack.ms_pkce',
      jsonEncode({
        'verifier': 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        'createdAt': DateTime.utc(2020).toIso8601String(),
      }),
    );
    // QA D3: awaited, so a missing TTL check actually fails this test.
    await expectLater(
      ms.handle(Uri.parse('opstrack://auth/microsoft?code=y')),
      throwsA(
        isA<MicrosoftSignInFailure>().having(
          (e) => e.message,
          'message',
          'Sign-in expired. Try again.',
        ),
      ),
    );
  });

  test('QA D3: a stored ptl_ token is not restored on restart', () async {
    final store = MemorySessionStore();
    final now = DateTime.now().toUtc();
    await store.write(
      StoredSession({ApiClient.bearerKey: 'ptl_portal-token'}, now),
    );
    final api = ApiClient('http://api.test/api/v1', store: store);
    await api.restoreSession();
    expect(api.bearer, isNull);
    final ok = ApiClient('http://api.test/api/v1', store: store);
    await store.write(
      StoredSession({ApiClient.bearerKey: 'mob_real-token'}, now),
    );
    expect(await ok.restoreSession(), isTrue);
    expect(ok.bearer, 'mob_real-token');
  });

  test('ignores other schemes and hosts', () async {
    final storage = MemoryMsPkceStorage();
    final api = ApiClient('http://api.test/api/v1');
    final ms = MicrosoftSignIn(api: api, storage: storage);
    expect(await ms.handle(Uri.parse('https://evil/callback')), isNull);
    expect(await ms.handle(Uri.parse('opstrack://other/microsoft')), isNull);
  });

  testWidgets('login hides Microsoft in demo mode, shows when provider true', (
    tester,
  ) async {
    await pumpApp(tester, signedIn: false);
    expect(find.byKey(const Key('loginMicrosoft')), findsNothing);

    await pumpApp(
      tester,
      signedIn: false,
      overrides: [msAvailableProvider.overrideWith((ref) async => true)],
    );
    expect(find.byKey(const Key('loginMicrosoft')), findsOneWidget);
  });

  group('failed exchange shows a message and leaves no session', () {
    final cases = <String, (int?, String?, String)>{
      '400 expired or reused code': (400, 'INVALID_CODE', msExpiredMessage),
      '403 deactivated account': (
        403,
        'ACCOUNT_DEACTIVATED',
        msDeactivatedMessage,
      ),
      'offline': (null, null, msOfflineMessage),
      '429 rate limited': (429, 'RATE_LIMITED', msRateLimitedMessage),
      '500 server error': (500, 'SERVER_ERROR', msOfflineMessage),
      '503 unavailable': (503, null, msOfflineMessage),
    };
    for (final c in cases.entries) {
      test(c.key, () async {
        final store = MemorySessionStore();
        final api = exchangeApi(c.value.$1, code: c.value.$2, store: store);
        final ms = MicrosoftSignIn(api: api, storage: await freshPkce());
        await expectLater(
          ms.handle(Uri.parse('opstrack://auth/microsoft?code=abc')),
          throwsA(
            isA<MicrosoftSignInFailure>().having(
              (e) => e.message,
              'message',
              c.value.$3,
            ),
          ),
        );
        expect(api.bearer, isNull);
        expect(await store.read(), isNull);
      });
    }
  });

  test('error deep links map to messages even without a stored PKCE', () async {
    final api = exchangeApi(500);
    final ms = MicrosoftSignIn(api: api, storage: MemoryMsPkceStorage());
    Future<String> msg(String err) async {
      try {
        await ms.handle(Uri.parse('opstrack://auth/microsoft?error=$err'));
      } on MicrosoftSignInFailure catch (e) {
        return e.message;
      }
      return 'no error';
    }

    expect(await msg('ms_signin_failed'), msFailedMessage);
    expect(await msg('ms_no_email'), msNoEmailMessage);
    expect(await msg('cancelled'), msCancelledMessage);
  });

  for (final c in <String, (int?, String)>{
    '400': (400, msExpiredMessage),
    '403': (403, msDeactivatedMessage),
    'offline': (null, msOfflineMessage),
  }.entries) {
    testWidgets('login screen shows the ${c.key} exchange error', (
      tester,
    ) async {
      AppConfig.debugApiBaseUrl = 'http://api.test/api/v1';
      addTearDown(() => AppConfig.debugApiBaseUrl = null);
      final links = StreamController<Uri>();
      addTearDown(links.close);
      final storage = await freshPkce();
      final ms = MicrosoftSignIn(
        api: exchangeApi(c.value.$1),
        storage: storage,
        links: links.stream,
        initialLink: () async => null,
      );
      await pumpApp(
        tester,
        signedIn: false,
        overrides: [msSignInProvider.overrideWithValue(ms)],
      );
      expect(find.byKey(const Key('loginScreen')), findsOneWidget);
      await tester.runAsync(() async {
        links.add(Uri.parse('opstrack://auth/microsoft?code=abc'));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('loginError')), findsOneWidget);
      expect(find.text(c.value.$2), findsOneWidget);
      expect(find.byKey(const Key('loginScreen')), findsOneWidget);
    });
  }

  group('M3 cold start: launch link handled once', () {
    test(
      'bindDeepLinks drops only the stream replay of the launch link',
      () async {
        final launch = Uri.parse('opstrack://auth/microsoft?error=cancelled');
        final links = StreamController<Uri>();
        addTearDown(links.close);
        final ms = MicrosoftSignIn(
          api: ApiClient('http://api.test/api/v1'),
          storage: MemoryMsPkceStorage(),
          links: links.stream,
          initialLink: () async => launch,
        );
        final got = <Uri>[];
        await ms.bindDeepLinks(got.add);
        links.add(launch); // app_links replays the launch link on the stream
        links.add(launch); // the user cancels again later: a real, new link
        await pumpEventQueue();
        expect(got, [launch, launch]);
      },
    );

    test(
      'the same code handled twice at once: one exchange, session kept',
      () async {
        final server = SingleUseExchange();
        final ms = MicrosoftSignIn(api: server.api, storage: await freshPkce());
        final uri = Uri.parse('opstrack://auth/microsoft?code=abc');
        final results = await Future.wait([ms.handle(uri), ms.handle(uri)]);
        expect(server.exchanges, 1);
        expect(results.whereType<Object>().length, 1);
        expect(results.first?.email, 'a@xceler8.com');
        expect(
          server.api.bearer,
          'mobile-bearer-token-123456789012345678901234',
        );
        expect(await server.store.read(), isNotNull);
      },
    );

    testWidgets(
      'initial link plus the same link on the stream: one exchange, signed in, no message',
      (tester) async {
        AppConfig.debugApiBaseUrl = 'http://api.test/api/v1';
        addTearDown(() => AppConfig.debugApiBaseUrl = null);
        final uri = Uri.parse('opstrack://auth/microsoft?code=abc');
        final server = SingleUseExchange();
        final ms = MicrosoftSignIn(
          api: server.api,
          storage: await freshPkce(),
          links: Stream<Uri>.value(uri),
          initialLink: () async => uri,
        );
        final c = await pumpApp(
          tester,
          signedIn: false,
          overrides: [msSignInProvider.overrideWithValue(ms)],
        );
        await tester.pumpAndSettle();
        expect(server.exchanges, 1);
        expect(
          server.api.bearer,
          'mobile-bearer-token-123456789012345678901234',
        );
        expect(await tester.runAsync(server.store.read), isNotNull);
        expect(c.read(authProvider).value?.email, 'a@xceler8.com');
        expect(c.read(msSignInErrorProvider), isNull);
        expect(find.byKey(const Key('loginError')), findsNothing);
      },
    );

    testWidgets('a successful sign-in clears an earlier error message', (
      tester,
    ) async {
      AppConfig.debugApiBaseUrl = 'http://api.test/api/v1';
      addTearDown(() => AppConfig.debugApiBaseUrl = null);
      final server = SingleUseExchange();
      final links = StreamController<Uri>();
      addTearDown(links.close);
      final ms = MicrosoftSignIn(
        api: server.api,
        storage: await freshPkce(),
        links: links.stream,
        initialLink: () async => null,
      );
      final c = await pumpApp(
        tester,
        signedIn: false,
        overrides: [
          msSignInProvider.overrideWithValue(ms),
          msSignInErrorProvider.overrideWith(
            () => PresetMsError(msExpiredMessage),
          ),
        ],
      );
      links.add(Uri.parse('opstrack://auth/microsoft?code=abc'));
      await tester.pumpAndSettle();
      expect(server.exchanges, 1);
      expect(c.read(authProvider).value?.email, 'a@xceler8.com');
      expect(c.read(msSignInErrorProvider), isNull);
    });
  });

  group('L9 gaps', () {
    testWidgets('cold-start error link shows its message on the login screen', (
      tester,
    ) async {
      AppConfig.debugApiBaseUrl = 'http://api.test/api/v1';
      addTearDown(() => AppConfig.debugApiBaseUrl = null);
      final launch = Uri.parse('opstrack://auth/microsoft?error=ms_no_email');
      final ms = MicrosoftSignIn(
        api: exchangeApi(500),
        storage: MemoryMsPkceStorage(),
        links: Stream<Uri>.value(launch),
        initialLink: () async => launch,
      );
      await pumpApp(
        tester,
        signedIn: false,
        overrides: [msSignInProvider.overrideWithValue(ms)],
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('loginScreen')), findsOneWidget);
      expect(find.text(msNoEmailMessage), findsOneWidget);
    });

    testWidgets('an error set before the login screen is built is shown', (
      tester,
    ) async {
      await pumpApp(
        tester,
        signedIn: false,
        overrides: [
          msSignInErrorProvider.overrideWith(
            () => PresetMsError(msDeactivatedMessage),
          ),
        ],
      );
      expect(find.byKey(const Key('loginError')), findsOneWidget);
      expect(find.text(msDeactivatedMessage), findsOneWidget);
    });

    test('a failed exchange removes an existing stored session', () async {
      final store = MemorySessionStore();
      await store.write(
        StoredSession({
          ApiClient.bearerKey: 'old-bearer-token',
          'sid': 'old-cookie',
        }, DateTime.now().toUtc()),
      );
      final api = exchangeApi(400, code: 'INVALID_CODE', store: store);
      expect(await api.restoreSession(), isTrue);
      expect(api.bearer, 'old-bearer-token');
      final ms = MicrosoftSignIn(api: api, storage: await freshPkce());
      await expectLater(
        ms.handle(Uri.parse('opstrack://auth/microsoft?code=abc')),
        throwsA(isA<MicrosoftSignInFailure>()),
      );
      expect(api.bearer, isNull);
      expect(await store.read(), isNull);
    });
  });
}
