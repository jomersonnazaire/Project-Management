import 'api_client.dart';
import 'models.dart' show ApiException;

/// Mobile action emails (API PR #37): follow-up, task assigned, added to project, sent from the
/// user's own Outlook through the system browser, then confirmed like DAR Send
/// (`opstrack://auth/mail?code=…` → POST /auth/mobile/mail/confirm, see dar_send.dart).

/// GET /auth/me/email-status: whether "Email …" shows (`enabled`) and is usable (`linked`).
class EmailStatus {
  const EmailStatus({required this.enabled, required this.linked});
  final bool enabled, linked;
  factory EmailStatus.fromJson(Map<String, dynamic> j) =>
      EmailStatus(enabled: j['enabled'] == true, linked: j['linked'] == true);
}

/// Shown under a disabled "Email …" checkbox (shared ACTION_EMAIL_NOT_LINKED).
const actionEmailNotLinked = 'Link your Microsoft account to send emails.';

/// `{url, recipients}` from /action-emails/mobile, or `email:{url, error, message, recipients}`
/// on a task/project save. `url == null`: the save worked but no email started.
class EmailStart {
  const EmailStart({this.url, this.error, this.message, this.recipients = 0});
  final Uri? url;
  final String? error, message;

  /// How many people the email would go to (M in "Emailed N of M").
  final int recipients;

  static EmailStart? fromJson(Object? j) {
    if (j is! Map) return null;
    final raw = j['url'];
    final uri = raw is String ? Uri.tryParse(raw) : null;
    return EmailStart(
      url: uri != null && uri.scheme == 'https' ? uri : null,
      error: j['error'] as String?,
      message: j['message'] as String?,
      recipients: (j['recipients'] as num?)?.toInt() ?? 0,
    );
  }

  /// Copy for a save whose email didn't start.
  String get notStartedMessage =>
      (message != null && message!.trim().isNotEmpty)
      ? message!
      : actionEmailStartMessage(error);
}

/// The email part of a task/project save from the app: `emailReturn: 'mobile'` with the PKCE
/// challenge. The repository fills [start] from the save response.
class EmailOnSave {
  EmailOnSave(this.codeChallenge);
  final String codeChallenge;
  EmailStart? start;

  Map<String, Object> fields(String flag) => {
    flag: true,
    'emailReturn': 'mobile',
    'code_challenge': codeChallenge,
    'code_challenge_method': 'S256',
  };
}

const alreadyEmailedMessage =
    "This follow-up was already emailed, so it wasn't sent again.";

/// Follow-ups emailed only in part keep `emailedAt` on the server; shown with this suffix.
const partlyEmailedLabel = "Emailed · some couldn't be sent";

/// Copy for a start error code (409 on /action-emails/mobile, or `email.error` on a save).
String actionEmailStartMessage(String? code) => switch (code?.toUpperCase()) {
  'EMAIL_DISABLED' => 'Email not sent: emails are switched off.',
  'MICROSOFT_NOT_LINKED' => 'Email not sent. $actionEmailNotLinked',
  'PROJECT_ARCHIVED' => 'Email not sent: this project is archived.',
  'ALREADY_EMAILED' => alreadyEmailedMessage,
  'NO_RECIPIENTS' => 'Email not sent: there was nobody to email.',
  'MOBILE_ONLY' => 'Email not sent. Sign in again and try again.',
  _ => "Email not sent. Try again.",
};

String actionEmailApiErrorMessage(ApiException e) {
  if (e.status == 429) {
    return 'Email not sent: too many emails in a short time. Wait a few minutes and try again.';
  }
  if (e.message == demoEmailMessage) return demoEmailMessage;
  if (e.status == 409 || e.code == 'MOBILE_ONLY') {
    return actionEmailStartMessage(e.code);
  }
  if (e.status == 403) return "Email not sent: you can't email about this.";
  if (e.status == 0 || (e.status ?? 0) >= 500) return disconnectedMessage;
  return e.message;
}

const actionEmailFlows = {'action_email', 'task_assigned', 'project_added'};

/// The confirmed outcome of an action email.
class ActionEmailResult {
  const ActionEmailResult({
    required this.flow,
    this.projectId,
    this.taskId,
    this.followUpId,
    required this.sent,
    this.partial = false,
    this.recipients = 0,
    this.total = 0,
    this.reason,
  });
  final String flow;
  final String? projectId, taskId, followUpId;

  /// True only from a 200 confirm with `email: 'sent' | 'partial'`.
  final bool sent, partial;

  /// N (emails actually sent, from confirm) and M (from the start response; 0 if unknown).
  final int recipients, total;

  /// `email_error` (unknown → `send_failed`), or `expired` / `result_unavailable` / `wrong_user`
  /// / `no_result`.
  final String? reason;

  static const knownErrors = {
    'consent_declined',
    'admin_consent_required',
    'wrong_account',
    'not_enabled',
    'not_found',
    'project_archived',
    'no_recipients',
    'already_emailed',
    'no_address',
    'no_mailbox',
    'send_forbidden',
    'ms_auth_failed',
    'bad_recipient',
    'too_large',
    'graph_unavailable',
    'send_failed',
  };

  /// POST /auth/mobile/mail/confirm for an action flow. The answer must be for the flow and ids
  /// this phone started (same rule as DAR E1).
  static ActionEmailResult fromConfirm(
    Map<String, dynamic> b, {
    required String flow,
    String? projectId,
    String? taskId,
    String? followUpId,
    int total = 0,
  }) {
    ActionEmailResult r({
      bool sent = false,
      bool partial = false,
      int n = 0,
      String? reason,
    }) => ActionEmailResult(
      flow: flow,
      projectId: (b['project'] as String?) ?? projectId,
      taskId: (b['task'] as String?) ?? taskId,
      followUpId: (b['followUp'] as String?) ?? followUpId,
      sent: sent,
      partial: partial,
      recipients: n,
      total: total,
      reason: reason,
    );
    bool same(String key, String? mine) =>
        mine == null || mine.isEmpty || b[key] == mine;
    if (b['flow'] != flow ||
        !same('project', projectId) ||
        !same('task', taskId) ||
        !same('followUp', followUpId)) {
      return r(reason: 'result_unavailable');
    }
    final n = (b['recipients'] as num?)?.toInt() ?? 0;
    final err = b['email_error'];
    if (err is String && err.isNotEmpty) {
      return r(reason: knownErrors.contains(err) ? err : 'send_failed');
    }
    return switch (b['email']) {
      'sent' => r(sent: true, n: n),
      'partial' => r(sent: true, partial: true, n: n),
      _ => r(reason: 'no_result'),
    };
  }

  String get message => actionEmailResultMessage(this);
}

String _who(String flow) => switch (flow) {
  'task_assigned' => 'the new assignees',
  'project_added' => 'the new members',
  _ => 'the team about this follow-up',
};

/// Result banner copy. "Emailed" only for a confirmed sent/partial.
String actionEmailResultMessage(ActionEmailResult r) {
  final n = r.recipients;
  String people(int k) => '$k ${k == 1 ? 'person' : 'people'}';
  if (r.sent && r.partial) {
    // Never the plain "Emailed" success for a partial send.
    if (n < 1) return "Some emails couldn't be sent.";
    return r.total > n
        ? "Some emails couldn't be sent. Emailed $n of ${r.total} people."
        : "Some emails couldn't be sent. Emailed ${people(n)}.";
  }
  if (r.sent) {
    final base = 'Emailed ${_who(r.flow)} from your Outlook.';
    return n < 1 ? base : '$base Sent to ${people(n)}.';
  }
  final saved = r.flow == 'action_email' ? '' : ' The change itself was saved.';
  final text = switch (r.reason) {
    'expired' => 'This email result expired. Try again.',
    'result_unavailable' => "We couldn't confirm whether the email was sent. Check before sending again.",
    'wrong_user' => 'This email was started from a different OpsTrack account, so we can\'t show its result.',
    'no_result' => "We didn't get a result back from Microsoft, so the email may not have been sent.",
    'consent_declined' =>
      'Email not sent: you cancelled or declined the Microsoft prompt.',
    'admin_consent_required' => 'Email not sent: your organization must approve OpsTrack sending mail for you (admin consent).',
    'wrong_account' =>
      'Email not sent: sign in with the Microsoft account linked to OpsTrack.',
    'not_enabled' => 'Email not sent: emails are switched off.',
    'not_found' => 'Email not sent: this item no longer exists.',
    'project_archived' => 'Email not sent: this project is archived.',
    'no_recipients' ||
    'no_address' => 'Email not sent: there was nobody to email.',
    'already_emailed' => alreadyEmailedMessage,
    'no_mailbox' =>
      'Email not sent: your Microsoft account has no Outlook mailbox.',
    'send_forbidden' =>
      'Email not sent: Microsoft refused to send from your mailbox.',
    'ms_auth_failed' => 'Email not sent: Microsoft sign-in failed. Try again.',
    'bad_recipient' => 'Email not sent: Microsoft refused a recipient address.',
    'too_large' => 'Email not sent: it was too large.',
    'graph_unavailable' => 'Email not sent: Microsoft 365 is unavailable right now. Try again in a few minutes.',
    _ => 'Email not sent: something went wrong. Try again.',
  };
  return '$text$saved';
}

abstract interface class ActionEmailRepository {
  Future<EmailStatus> status();

  /// POST /action-emails/mobile (FOLLOW_UP) → `{url, recipients}`.
  Future<EmailStart> followUp(
    String taskId,
    String followUpId, {
    required String codeChallenge,
  });
}

class ApiActionEmailRepository implements ActionEmailRepository {
  ApiActionEmailRepository(this.api);
  final ApiClient api;

  @override
  Future<EmailStatus> status() async =>
      EmailStatus.fromJson(await api.get('/auth/me/email-status'));

  @override
  Future<EmailStart> followUp(
    String taskId,
    String followUpId, {
    required String codeChallenge,
  }) async {
    final b = await api.post('/action-emails/mobile', {
      'kind': 'FOLLOW_UP',
      'taskId': taskId,
      'followUpId': followUpId,
      'code_challenge': codeChallenge,
      'code_challenge_method': 'S256',
    });
    final s = EmailStart.fromJson(b);
    if (s?.url == null) {
      throw ApiException(actionEmailStartMessage(null), status: 502);
    }
    return s!;
  }
}

/// Demo/tests.
class MockActionEmailRepository implements ActionEmailRepository {
  MockActionEmailRepository({
    this.current = const EmailStatus(enabled: true, linked: true),
    this.demo = true,
  });

  /// Demo mode: the follow-up email is refused (no Microsoft round trip).
  final bool demo;
  EmailStatus current;
  final followUps = <(String, String, String)>[];
  ApiException? followUpError;
  int recipients = 2;

  @override
  Future<EmailStatus> status() async => current;

  @override
  Future<EmailStart> followUp(
    String taskId,
    String followUpId, {
    required String codeChallenge,
  }) async {
    if (followUpError != null) throw followUpError!;
    if (demo) {
      throw ApiException(demoEmailMessage, status: 409, code: 'EMAIL_DISABLED');
    }
    followUps.add((taskId, followUpId, codeChallenge));
    return EmailStart(
      url: Uri.parse('https://login.microsoftonline.com/mock?fu=$followUpId'),
      recipients: recipients,
    );
  }
}

/// Demo/tests: what a mock save answers for `email`. Demo mode never opens Microsoft.
EmailStart Function(String flag, int recipients, EmailOnSave email)
mockSaveEmail = demoMockSaveEmail;

const demoEmailMessage = 'Demo mode: no email was sent.';

EmailStart demoMockSaveEmail(String flag, int recipients, EmailOnSave email) =>
    const EmailStart(error: 'EMAIL_DISABLED', message: demoEmailMessage);

/// Tests: a save that starts an email (fake Microsoft URL).
EmailStart urlMockSaveEmail(String flag, int recipients, EmailOnSave email) =>
    EmailStart(
      url: Uri.parse('https://login.microsoftonline.com/mock?$flag'),
      recipients: recipients,
    );
