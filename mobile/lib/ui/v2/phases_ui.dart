import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../data/phases.dart';
import '../../state/providers.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

/// D21 / D23: may this user add/rename/delete phases or apply a template right now?
/// Server `editable` wins; otherwise Project PM in Planning, or Admin.
bool canEditPhases(WidgetRef ref, Project p, List<PhaseInfo> phases) {
  if (phases.isNotEmpty) return phases.first.editable;
  final u = ref.watch(authProvider).value;
  if (u == null || !canEditProject(ref, p)) return false;
  return u.isAdmin || p.status == ProjectStatus.planning;
}

/// QA B7: wait for the fresh phase list so "No phases yet" never lingers.
Future<void> _refresh(WidgetRef ref, String projectId) async {
  ref.invalidate(projectTasksProvider(projectId));
  ref.invalidate(projectProvider(projectId));
  try {
    ref.invalidate(phasesProvider(projectId));
    await ref.read(phasesProvider(projectId).future);
  } catch (_) {}
}

/// QA B4 (x7): the "Can't delete" reason shown inline under the phase header.
class PhaseDeleteError extends Notifier<(String, String, String)?> {
  @override
  (String, String, String)? build() => null;
  void set((String, String, String)? v) => state = v;
}

/// (projectId, phase, message) or null.
final phaseDeleteErrorProvider =
    NotifierProvider<PhaseDeleteError, (String, String, String)?>(
      PhaseDeleteError.new,
    );

String? phaseDeleteErrorFor(WidgetRef ref, String projectId, String phase) {
  final e = ref.watch(phaseDeleteErrorProvider);
  return e != null && e.$1 == projectId && e.$2 == phase ? e.$3 : null;
}

/// Inline red line (#b8240a).
class PhaseInlineError extends StatelessWidget {
  const PhaseInlineError(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(
    text,
    key: const Key('phaseDeleteError'),
    style: Theme.of(context).textTheme.bodySmall
        ?.copyWith(color: const Color(0xFFB8240A)),
  );
}

/// "No phases yet" (design x5).
class NoPhasesView extends ConsumerWidget {
  const NoPhasesView({super.key, required this.project, required this.canEdit});
  final Project project;
  final bool canEdit;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return Center(
      key: const Key('noPhases'),
      child: Padding(
        padding: const EdgeInsets.all(Space.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('No phases yet', style: t.titleMedium),
            const SizedBox(height: Space.s),
            Text(
              canEdit
                  ? 'Add your first phase, or apply a template.'
                  : 'The project manager hasn\'t added phases yet.',
              textAlign: TextAlign.center,
            ),
            if (canEdit) ...[
              const SizedBox(height: Space.l),
              Wrap(
                spacing: Space.s,
                runSpacing: Space.s,
                alignment: WrapAlignment.center,
                children: [
                  FilledButton.icon(
                    key: const Key('addPhase'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 40),
                    ),
                    icon: const Icon(Icons.add),
                    label: const Text('Add phase'),
                    onPressed: () =>
                        showPhaseNameSheet(context, ref, project.id),
                  ),
                  if (project.status == ProjectStatus.planning)
                    OutlinedButton(
                      key: const Key('applyTemplate'),
                      onPressed: () =>
                          showApplyTemplateSheet(context, ref, project.id),
                      child: const Text('Apply template'),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Add (rename == null) or rename a phase. Field errors inline (DUPLICATE_NAME).
Future<void> showPhaseNameSheet(
  BuildContext context,
  WidgetRef ref,
  String projectId, {
  String? rename,
}) async {
  final ctrl = TextEditingController(text: rename ?? '');
  String? error;
  var busy = false;
  await showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setS) => Padding(
        padding: EdgeInsets.fromLTRB(
          Space.l,
          Space.l,
          Space.l,
          Space.l + MediaQuery.viewInsetsOf(ctx).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              rename == null ? 'Add phase' : 'Rename phase',
              style: Theme.of(ctx).textTheme.titleMedium,
            ),
            const SizedBox(height: Space.m),
            TextField(
              key: const Key('phaseNameField'),
              controller: ctrl,
              autofocus: true,
              maxLength: 120,
              decoration: InputDecoration(
                labelText: 'Phase name *',
                errorText: error,
              ),
            ),
            const SizedBox(height: Space.s),
            FilledButton(
              key: const Key('savePhase'),
              onPressed: busy
                  ? null
                  : () async {
                      final n = ctrl.text.trim();
                      if (n.isEmpty) {
                        setS(() => error = 'Add a phase name.');
                        return;
                      }
                      setS(() => busy = true);
                      try {
                        final repo = ref.read(phaseRepositoryProvider);
                        if (rename == null) {
                          await repo.add(projectId, n);
                        } else {
                          await repo.rename(projectId, rename, n);
                        }
                        await _refresh(ref, projectId);
                        if (ctx.mounted) Navigator.pop(ctx);
                      } on ApiException catch (e) {
                        setS(() {
                          busy = false;
                          error =
                              e.fields['name'] ??
                              e.fields['newName'] ??
                              e.message;
                        });
                      }
                    },
              child: Text(rename == null ? 'Add phase' : 'Save'),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Delete: an empty phase asks "Delete phase {name}?"; otherwise the inline reason.
Future<void> deletePhase(
  BuildContext context,
  WidgetRef ref,
  String projectId,
  PhaseInfo ph,
) async {
  final err = ref.read(phaseDeleteErrorProvider.notifier);
  err.set(null);
  if (!ph.deletable) {
    err.set((
      projectId,
      ph.name,
      ph.deleteBlockedReason ??
          "Can't delete: this phase still has ${ph.taskCount} ${ph.taskCount == 1 ? 'activity. Delete it first.' : 'activities. Delete them first.'}",
    ));
    return;
  }
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Delete phase ${ph.name}?'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('confirmDeletePhase'),
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(ctx).colorScheme.error,
            minimumSize: const Size(0, 40),
          ),
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Delete phase'),
        ),
      ],
    ),
  );
  if (ok != true) return;
  try {
    await ref.read(phaseRepositoryProvider).delete(projectId, ph.name);
    await _refresh(ref, projectId);
  } on ApiException catch (e) {
    if (e.code == 'PHASE_NOT_EMPTY' || e.code == 'PHASE_HAS_DOCUMENTS') {
      err.set((projectId, ph.name, e.message));
    } else if (context.mounted) {
      showError(context, e);
    }
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

/// Apply template (design x6): pick a published template, confirm, toast the result.
Future<void> showApplyTemplateSheet(
  BuildContext context,
  WidgetRef ref,
  String projectId,
) async {
  final templates = await ref.read(projectAdminRepositoryProvider).templates();
  if (!context.mounted) return;
  String? picked;
  String? preview;
  var busy = false;
  final existing = [
    for (final p
        in ref.read(phasesProvider(projectId)).value ?? const <PhaseInfo>[])
      p.name,
  ];
  final msg = await showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setS) => SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(Space.l),
          child: Column(
            key: const Key('applyTemplateSheet'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Apply template',
                style: Theme.of(ctx).textTheme.titleMedium,
              ),
              const SizedBox(height: Space.s),
              const Text(
                'Adds the template\'s phases and activities. Phases with the same name are merged. Nothing is replaced.',
              ),
              const SizedBox(height: Space.m),
              RadioGroup<String>(
                groupValue: picked,
                onChanged: (v) async {
                  setS(() {
                    picked = v;
                    preview = null;
                  });
                  if (v == null) return;
                  try {
                    final p = await ref
                        .read(phaseRepositoryProvider)
                        .templatePreview(v);
                    if (picked == v) {
                      setS(() => preview = p.confirmText(existing));
                    }
                  } catch (_) {}
                },
                child: Column(
                  children: [
                    for (final t in templates)
                      RadioListTile<String>(
                        key: Key('applyTemplate_${t.id}'),
                        value: t.id,
                        title: Text(t.name),
                        subtitle: t.version == null
                            ? null
                            : Text('v${t.version}'),
                      ),
                  ],
                ),
              ),
              if (preview != null)
                Padding(
                  padding: const EdgeInsets.only(top: Space.s),
                  child: Text(preview!, key: const Key('applyTemplatePreview')),
                ),
              const SizedBox(height: Space.s),
              FilledButton(
                key: const Key('confirmApplyTemplate'),
                onPressed: picked == null || busy
                    ? null
                    : () async {
                        setS(() => busy = true);
                        try {
                          final r = await ref
                              .read(phaseRepositoryProvider)
                              .applyTemplate(
                                projectId,
                                picked!,
                                templateVersion: templates
                                    .firstWhere((t) => t.id == picked)
                                    .version,
                              );
                          _refresh(ref, projectId);
                          if (ctx.mounted) Navigator.pop(ctx, r.toast);
                        } catch (e) {
                          setS(() => busy = false);
                          if (ctx.mounted) showError(ctx, e);
                        }
                      },
                child: const Text('Apply template'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  if (msg != null && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}
