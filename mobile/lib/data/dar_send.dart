import 'dart:convert';

import 'api_client.dart';
import 'models.dart' show ApiException;
import 'ms_sign_in.dart' show MsPkceStorage, FlutterMsPkceStorage, PkcePair;

/// DAR Send from mobile (FR-DAR-20, PR #29 + mobile return path PR #36).
///
/// Flow: GET /dar/send-status → [DarMailSend.begin] makes a PKCE pair per send, stores the
/// verifier (10 min) and POSTs `/dar/saved/:id/send/mobile` with the S256 challenge → `{url}` →
/// Microsoft in the system browser → the API sends from the user's own Outlook and returns to
/// `opstrack://auth/mail?code=<one-time code>` (60 s, single use, same user). [DarMailSend.handle]
/// trades the code in straight away with POST /auth/mobile/mail/confirm `{code, code_verifier}`.
/// Only the confirm response can say "sent"; the link on its own is never proof.

/// GET /dar/send-status.
class DarSendStatus {
  const DarSendStatus({
    required this.enabled,
    this.reason,
    this.canNotify = false,
    this.to,
    this.cc = const [],
  });
  final bool enabled;

  /// null, `ms_disabled`, `not_linked` or `no_supervisor`.
  final String? reason;
  final bool canNotify;
  final ({String name, String email})? to;
  final List<String> cc;

  factory DarSendStatus.fromJson(Map<String, dynamic> j) {
    final to = j['to'];
    return DarSendStatus(
      enabled: j['enabled'] == true,
      reason: j['reason'] as String?,
      canNotify: j['canNotify'] == true,
      to: to is Map
          ? (name: '${to['name'] ?? ''}', email: '${to['email'] ?? ''}')
          : null,
      cc: [
        for (final c in (j['cc'] as List? ?? const []))
          if (c is Map) '${c['email'] ?? c['name'] ?? ''}' else '$c',
      ],
    );
  }
}

/// The confirmed outcome of a DAR send (or why it couldn't be confirmed).
class DarSendResult {
  const DarSendResult({
    required this.reportId,
    required this.sent,
    this.reason,
  });
  final String reportId;
  final bool sent;

  /// A `send_error` reason from the API, or [noResult] / [expired] / [wrongUser].
  final String? reason;

  static const noResult = 'no_result';
  static const expired = 'expired';
  static const wrongUser = 'wrong_user';

  /// The POST /auth/mobile/mail/confirm body: `{flow:'dar', report, sent}` or
  /// `{flow:'dar', report, send_error}` (PR #36 458fcab). Anything else is not a success.
  static DarSendResult fromConfirm(
    Map<String, dynamic> b, {
    String? fallbackReport,
  }) {
    final report = '${b['report'] ?? fallbackReport ?? ''}';
    final err = b['send_error'];
    if (b['flow'] != 'dar') {
      return DarSendResult(reportId: report, sent: false, reason: noResult);
    }
    if (err is String && err.isNotEmpty) {
      return DarSendResult(reportId: report, sent: false, reason: err);
    }
    final sent = b['sent'];
    if (sent is String && sent.isNotEmpty && sent == report) {
      return DarSendResult(reportId: report, sent: true);
    }
    return DarSendResult(reportId: report, sent: false, reason: noResult);
  }
}

/// `opstrack://auth/mail` (PR #36): the fixed return address for a mobile DAR Send.
bool isMailReturnLink(Uri uri) =>
    uri.scheme == 'opstrack' &&
    uri.host == 'auth' &&
    (uri.path == '/mail' || uri.path == 'mail');

const darPasswordOnly =
    'Link your Microsoft account to send emails. You can export this report on the web or notify your supervisor.';
const darNoSupervisor = 'Ask an Admin to set your supervisor.';
const darMsDisabled =
    "Sending reports by email isn't available right now. You can export this report on the web.";
const darTooLarge =
    "This report's PDF is over 2.5 MB, so it can't be emailed. Choose a shorter date range, or export it on the web and send it yourself.";
const darRateLimited =
    "You've pressed Send too many times. Wait 15 minutes and try again, or export the report on the web and send it yourself.";
const darNotifyRecent =
    'You already notified your supervisor about this report in the last hour. You can notify them again later.';
const darSendExpired = 'Send expired. Try again.';
const darWrongUser =
    "This send was started from a different OpsTrack account, so we can't show its result. Sign in with the account that pressed Send.";
const darNoResult =
    "We didn't get a result back from Microsoft, so the report may not have been sent. Press Send to try again.";

/// Friendly message for a send-status reason, a 409 SEND_UNAVAILABLE reason, or a deep-link
/// `send_error` (unknown reasons are treated as `send_failed`, per PR #36).
String darSendMessage(String? reason) => switch (reason) {
  DarSendResult.noResult || 'result_unavailable' => darNoResult,
  DarSendResult.expired => darSendExpired,
  DarSendResult.wrongUser => darWrongUser,
  'not_linked' => darPasswordOnly,
  'no_supervisor' => darNoSupervisor,
  'ms_disabled' || 'not_enabled' => darMsDisabled,
  'consent_declined' => "You didn't allow OpsTrack to send email as you, so nothing was sent. Press Send again and choose Accept.",
  'admin_consent_required' => 'Your organisation needs an administrator to approve OpsTrack sending email for you. Ask your IT admin, then press Send again.',
  'wrong_account' => 'Pick the same Microsoft account you use for OpsTrack.',
  'not_found' => "This saved report wasn't found. It may have been removed.",
  'no_mailbox' => 'This Microsoft account has no mailbox. Export the report on the web instead.',
  'send_forbidden' => "Microsoft didn't allow this email to be sent from your account. Ask your IT admin.",
  'ms_auth_failed' =>
    'Microsoft sign-in failed, so nothing was sent. Try again.',
  'bad_recipient' => 'Microsoft refused a recipient address. Ask an Admin to check your supervisor and CC list.',
  'too_large' => darTooLarge,
  'graph_unavailable' =>
    'Microsoft 365 is unavailable right now. Try again in a few minutes.',
  'rate_limited' => darRateLimited,
  _ => "We couldn't send your report. Try again, or export it on the web.",
};

/// Message for a failed start/notify call.
String darApiErrorMessage(ApiException e) {
  if (e.status == 429) return darRateLimited;
  switch (e.code) {
    case 'SEND_UNAVAILABLE':
      final d = e.details;
      final reason = d is Map ? d['reason'] as String? : null;
      return darSendMessage(reason ?? 'send_failed');
    case 'NOTIFY_RECENT':
      return darNotifyRecent;
    case 'NO_SUPERVISOR':
      return darNoSupervisor;
    case 'USE_SEND':
      return 'Your account is linked to Microsoft, so use Send to email your report.';
  }
  if (e.status == 0 || (e.status ?? 0) >= 500) return disconnectedMessage;
  return e.message;
}

abstract interface class DarSendRepository {
  Future<DarSendStatus> status();

  /// POST /dar/saved/:id/send/mobile with the S256 challenge → the Microsoft URL to open.
  Future<Uri> start(String savedId, {required String codeChallenge});

  /// POST /auth/mobile/mail/confirm → the raw outcome body.
  Future<Map<String, dynamic>> confirm(
    String code, {
    required String codeVerifier,
  });

  /// POST /dar/saved/:id/notify-supervisor → whether a notice was created.
  Future<bool> notifySupervisor(String savedId);
}

class ApiDarSendRepository implements DarSendRepository {
  ApiDarSendRepository(this.api);
  final ApiClient api;

  @override
  Future<DarSendStatus> status() async =>
      DarSendStatus.fromJson(await api.get('/dar/send-status'));

  @override
  Future<Uri> start(String savedId, {required String codeChallenge}) async {
    final b = await api.post('/dar/saved/$savedId/send/mobile', {
      'code_challenge': codeChallenge,
      'code_challenge_method': 'S256',
    });
    final url = b['url'];
    final uri = url is String ? Uri.tryParse(url) : null;
    if (uri == null || uri.scheme != 'https') {
      throw ApiException(darSendMessage('send_failed'), status: 502);
    }
    return uri;
  }

  @override
  Future<Map<String, dynamic>> confirm(
    String code, {
    required String codeVerifier,
  }) => api.post('/auth/mobile/mail/confirm', {
    'code': code,
    'code_verifier': codeVerifier,
  });

  @override
  Future<bool> notifySupervisor(String savedId) async {
    final b = await api.post('/dar/saved/$savedId/notify-supervisor', const {});
    final n = b['notified'];
    return n is bool ? n : (n is num && n > 0);
  }
}

const _mailPkceKey = 'opstrack.ms_mail_pkce';
const _mailPkceTtl = Duration(minutes: 10);

/// One mobile DAR send round trip: PKCE per send (reusing the sign-in plumbing), then the
/// `opstrack://auth/mail` return link traded in with confirm. Links are handled one at a time
/// and a code is only ever tried once.
class DarMailSend {
  DarMailSend({
    required this.repo,
    MsPkceStorage? storage,
    DateTime Function()? now,
  }) : _storage = storage ?? FlutterMsPkceStorage(),
       _now = now ?? DateTime.now;
  final DarSendRepository repo;
  final MsPkceStorage _storage;
  final DateTime Function() _now;
  final _seen = <String>{};
  Future<void> _queue = Future.value();
  int _inFlight = 0;

  /// A return link is being confirmed right now.
  bool get busy => _inFlight > 0;

  /// New PKCE pair; verifier stored (10 min) before the API is asked for the Microsoft URL.
  Future<Uri> begin(String savedId) async {
    final pkce = PkcePair.generate();
    await _storage.write(
      _mailPkceKey,
      jsonEncode({
        'verifier': pkce.verifier,
        'report': savedId,
        'createdAt': _now().toUtc().toIso8601String(),
      }),
    );
    try {
      return await repo.start(savedId, codeChallenge: pkce.challenge);
    } catch (_) {
      await _storage.delete(_mailPkceKey);
      rethrow;
    }
  }

  /// Handles an `opstrack://auth/mail` link; null for any other link or a repeated code.
  Future<DarSendResult?> handle(Uri uri) {
    if (!isMailReturnLink(uri)) return Future.value(null);
    _inFlight++;
    final run = _queue.then((_) => _handle(uri));
    _queue = run.then<void>((_) {}, onError: (Object _) {});
    return run.whenComplete(() => _inFlight--);
  }

  Future<DarSendResult?> _handle(Uri uri) async {
    final code = uri.queryParameters['code'];
    if (code != null && code.isNotEmpty && !_seen.add(code)) return null;
    final raw = await _storage.read(_mailPkceKey);
    await _storage.delete(_mailPkceKey);
    String? verifier, report;
    DateTime? created;
    if (raw != null) {
      try {
        final j = jsonDecode(raw) as Map<String, dynamic>;
        verifier = j['verifier'] as String?;
        report = j['report'] as String?;
        created = DateTime.tryParse('${j['createdAt']}');
      } catch (_) {}
    }
    final rep = report ?? '';
    // No code (forged, or ?error=result_unavailable): never "sent".
    if (code == null || code.isEmpty) {
      return DarSendResult(
        reportId: rep,
        sent: false,
        reason: DarSendResult.noResult,
      );
    }
    if (verifier == null ||
        created == null ||
        _now().toUtc().difference(created.toUtc()) > _mailPkceTtl) {
      return DarSendResult(
        reportId: rep,
        sent: false,
        reason: DarSendResult.expired,
      );
    }
    try {
      final b = await repo.confirm(code, codeVerifier: verifier);
      return DarSendResult.fromConfirm(b, fallbackReport: report);
    } on ApiException catch (e) {
      final reason = switch (e.status) {
        400 ||
        404 ||
        410 => DarSendResult.expired, // INVALID_CODE: expired or reused
        403 => DarSendResult.wrongUser,
        401 => DarSendResult.wrongUser,
        _ => DarSendResult.noResult,
      };
      return DarSendResult(reportId: rep, sent: false, reason: reason);
    }
  }
}

/// Demo/tests: configurable status; start returns a fake Microsoft URL.
class MockDarSendRepository implements DarSendRepository {
  MockDarSendRepository({
    this.current = const DarSendStatus(
      enabled: true,
      canNotify: false,
      to: (name: 'Queen Reyes', email: 'queen@xceler8.example'),
      cc: ['mark@xceler8.example'],
    ),
  });
  DarSendStatus current;
  final started = <String>[];
  final notified = <String>[];
  final challenges = <String>[];

  /// Confirm calls as (code, verifier); [confirmBody] / [confirmError] decide the answer.
  final confirms = <(String, String)>[];
  Map<String, dynamic>? confirmBody;
  ApiException? confirmError;

  @override
  Future<Map<String, dynamic>> confirm(
    String code, {
    required String codeVerifier,
  }) async {
    confirms.add((code, codeVerifier));
    if (confirmError != null) throw confirmError!;
    return confirmBody ??
        {
          'flow': 'dar',
          'report': started.lastOrNull,
          'sent': started.lastOrNull,
        };
  }

  ApiException? startError, notifyError;

  @override
  Future<DarSendStatus> status() async => current;

  @override
  Future<Uri> start(String savedId, {required String codeChallenge}) async {
    if (startError != null) throw startError!;
    started.add(savedId);
    challenges.add(codeChallenge);
    return Uri.parse('https://login.microsoftonline.com/mock?report=$savedId');
  }

  @override
  Future<bool> notifySupervisor(String savedId) async {
    if (notifyError != null) throw notifyError!;
    notified.add(savedId);
    return true;
  }
}
