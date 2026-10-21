import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/action_email.dart';
import '../../data/models.dart' show ApiException;
import '../../data/p2.dart' show FollowUp;
import '../../data/ms_sign_in.dart' show PkcePair;
import '../../state/p2_providers.dart' show taskExtrasProvider;
import '../../state/v2_providers.dart';

/// "Email …" under an action (web EmailCheckbox): hidden while the feature is off, disabled with
/// a hint for users without a linked Microsoft account. The action itself never depends on it.
class EmailCheckbox extends ConsumerWidget {
  const EmailCheckbox({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
  });
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st = ref.watch(emailStatusProvider).value;
    if (st == null || !st.enabled) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CheckboxListTile(
          key: key == null ? null : ValueKey('${(key as ValueKey).value}_box'),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          title: Text(label),
          value: st.linked && value,
          onChanged: st.linked ? (v) => onChanged(v ?? false) : null,
        ),
        if (!st.linked)
          Padding(
            padding: const EdgeInsets.only(left: 12, bottom: 8),
            child: Text(
              actionEmailNotLinked,
              key: const Key('emailNotLinkedHint'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}

/// True when the email should go with the save (flag on, linked, ticked).
bool wantsEmail(WidgetRef ref, bool checked) {
  final st = ref.read(emailStatusProvider).value;
  return checked && st != null && st.enabled && st.linked;
}

/// "Email Ana" for one person, "Email new assignees" for several.
String emailAssigneesLabel(List<String> names) =>
    names.length == 1 ? 'Email ${names.single}' : 'Email new assignees';

void _banner(WidgetRef ref, String text, {bool ok = false}) =>
    ref.read(emailBannerProvider.notifier).set(EmailBanner(text, ok: ok));

/// After a save that asked for an email: open Microsoft when the API started one (remembering
/// the PKCE verifier with the flow and ids), else show the server's message.
Future<void> continueSaveEmail(
  WidgetRef ref,
  EmailOnSave? email,
  PkcePair pkce, {
  required String flow,
  String? projectId,
  String? taskId,
}) async {
  final start = email?.start;
  if (email == null || start == null) return;
  final mail = ref.read(darMailSendProvider);
  final url = start.url;
  if (url == null) {
    _banner(ref, start.notStartedMessage);
    return;
  }
  await mail.remember(
    pkce,
    flow: flow,
    project: projectId,
    task: taskId,
    total: start.recipients,
  );
  final opened = await ref.read(externalLauncherProvider)(url);
  if (!opened) {
    await mail.forget();
    _banner(
      ref,
      "Email not sent: couldn't open the browser. The change itself was saved.",
    );
  }
}

/// Follow-up email after the follow-up is saved (POST /action-emails/mobile).
Future<void> startFollowUpEmail(
  WidgetRef ref, {
  required String taskId,
  required String followUpId,
  String? projectId,
}) async {
  // A follow-up is emailed once (a partial send counts): never start it again.
  if (followUpAlreadyEmailed(
    ref.read(partlyEmailedFollowUpsProvider),
    ref.read(taskExtrasProvider(taskId)).value?.followUps ?? const [],
    followUpId,
  )) {
    _banner(ref, alreadyEmailedMessage);
    return;
  }
  try {
    final s = await ref
        .read(darMailSendProvider)
        .beginFollowUp(
          ref.read(actionEmailRepositoryProvider),
          taskId: taskId,
          followUpId: followUpId,
          projectId: projectId,
        );
    final opened = await ref.read(externalLauncherProvider)(s.url!);
    if (!opened) {
      await ref.read(darMailSendProvider).forget();
      _banner(ref, "Email not sent: couldn't open the browser.");
    }
  } on ApiException catch (e) {
    _banner(ref, actionEmailApiErrorMessage(e));
  }
}

/// The app-wide email result line (above every screen, like the Disconnected banner).
class EmailResultBanner extends ConsumerWidget {
  const EmailResultBanner({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final b = ref.watch(emailBannerProvider);
    if (b == null) return const SizedBox.shrink();
    final s = Theme.of(context).colorScheme;
    final bg = b.ok ? s.secondaryContainer : s.errorContainer;
    final fg = b.ok ? s.onSecondaryContainer : s.onErrorContainer;
    return Material(
      key: const Key('emailResultBanner'),
      color: bg,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 4, 4),
          child: Row(
            children: [
              Icon(
                b.ok ? Icons.mark_email_read_outlined : Icons.info_outline,
                color: fg,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Semantics(
                  liveRegion: true,
                  child: Text(b.text, style: TextStyle(color: fg)),
                ),
              ),
              // No tooltip: this sits above the Navigator, outside any Overlay.
              IconButton(
                key: const Key('emailResultDismiss'),
                icon: Icon(Icons.close, color: fg, semanticLabel: 'Dismiss'),
                onPressed: () =>
                    ref.read(emailBannerProvider.notifier).set(null),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// True when this follow-up was already emailed (server `emailedAt`, or a partial send this
/// session): the app never offers or starts its email again.
bool followUpAlreadyEmailed(
  Set<String> partly,
  List<FollowUp> followUps,
  String followUpId,
) =>
    partly.contains(followUpId) ||
    followUps.any((f) => f.id == followUpId && f.emailedAt != null);
