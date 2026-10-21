import 'models.dart';
import 'api_client.dart';

/// DAR Send from mobile (FR-DAR-20, PR #29 + mobile return path PR #36).
///
/// Flow: GET /dar/send-status → POST /dar/saved/:id/send `{}` → `{url}` → open the Microsoft URL
/// in the system browser → the API callback sends from the user's own Outlook and returns to
/// `opstrack://ms/send-result?flow=dar&report=<id>&sent=<id>` or `…&send_error=<reason>`.
/// The deep link carries only the outcome (no token or code), so the app re-reads the saved
/// report (`sentAt`, PR #35) to confirm a success when the API provides it.

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

/// `opstrack://ms/send-result` for a DAR send.
class DarSendResult {
  const DarSendResult({
    required this.reportId,
    required this.sent,
    this.reason,
  });
  final String reportId;
  final bool sent;
  final String? reason;

  /// Parses a DAR send-result link; null for any other link.
  static DarSendResult? parse(Uri uri) {
    if (!isSendResultLink(uri)) return null;
    final q = uri.queryParameters;
    if (q['flow'] != 'dar') return null;
    final report = q['report'] ?? q['sent'];
    if (report == null || report.isEmpty) return null;
    final err = q['send_error'];
    if (err != null && err.isNotEmpty) {
      return DarSendResult(reportId: report, sent: false, reason: err);
    }
    if (q['sent'] == report) return DarSendResult(reportId: report, sent: true);
    return DarSendResult(reportId: report, sent: false, reason: 'send_failed');
  }
}

/// `opstrack://ms/send-result` (PR #36): the return address for every Microsoft send flow.
bool isSendResultLink(Uri uri) =>
    uri.scheme == 'opstrack' &&
    uri.host == 'ms' &&
    (uri.path == '/send-result' || uri.path == 'send-result');

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
const darNoResult =
    "We didn't get a result back from Microsoft, so the report may not have been sent. Press Send to try again.";

/// Friendly message for a send-status reason, a 409 SEND_UNAVAILABLE reason, or a deep-link
/// `send_error` (unknown reasons are treated as `send_failed`, per PR #36).
String darSendMessage(String? reason) => switch (reason) {
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

  /// POST /dar/saved/:id/send → the Microsoft URL to open.
  Future<Uri> start(String savedId);

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
  Future<Uri> start(String savedId) async {
    final b = await api.post('/dar/saved/$savedId/send', const {});
    final url = b['url'];
    final uri = url is String ? Uri.tryParse(url) : null;
    if (uri == null || uri.scheme != 'https') {
      throw ApiException(darSendMessage('send_failed'), status: 502);
    }
    return uri;
  }

  @override
  Future<bool> notifySupervisor(String savedId) async {
    final b = await api.post('/dar/saved/$savedId/notify-supervisor', const {});
    final n = b['notified'];
    return n is bool ? n : (n is num && n > 0);
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
  ApiException? startError, notifyError;

  @override
  Future<DarSendStatus> status() async => current;

  @override
  Future<Uri> start(String savedId) async {
    if (startError != null) throw startError!;
    started.add(savedId);
    return Uri.parse('https://login.microsoftonline.com/mock?report=$savedId');
  }

  @override
  Future<bool> notifySupervisor(String savedId) async {
    if (notifyError != null) throw notifyError!;
    notified.add(savedId);
    return true;
  }
}
