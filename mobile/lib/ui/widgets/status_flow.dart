import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import 'common.dart';

/// Quick picks on the blocked-reason sheet (design proposal; not in the repo).
const blockerQuickPicks = [
  'Waiting on client',
  'Dependency',
  'Access',
  'Unclear requirements',
];

/// Blocked-reason sheet: a reason is required (API blockerReason). Returns the reason or null.
Future<String?> showBlockReasonSheet(BuildContext context, Task task) =>
    showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      builder: (_) => BlockReasonSheet(task: task),
    );

class BlockReasonSheet extends StatefulWidget {
  const BlockReasonSheet({super.key, required this.task});
  final Task task;
  @override
  State<BlockReasonSheet> createState() => _BlockReasonSheetState();
}

class _BlockReasonSheetState extends State<BlockReasonSheet> {
  final _ctrl = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _submit() {
    final reason = _ctrl.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'A reason is required to block a task.');
      return;
    }
    Navigator.of(context).pop(reason);
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final t = Theme.of(context).textTheme;
    return Padding(
      key: const Key('blockSheet'),
      padding: EdgeInsets.fromLTRB(
        Space.l,
        0,
        Space.l,
        Space.l + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Mark as Blocked', style: t.headlineSmall),
          const SizedBox(height: Space.s),
          Text(
            'Tell the team what is blocking this task. It shows on the task and in the project.',
            style: t.bodyMedium?.copyWith(color: s.onSurfaceVariant),
          ),
          const SizedBox(height: Space.m),
          TextField(
            key: const Key('blockReasonField'),
            controller: _ctrl,
            maxLines: 3,
            maxLength: 1000,
            autofocus: true,
            decoration: InputDecoration(
              labelText: 'Blocker reason *',
              errorText: _error,
            ),
            onChanged: (_) =>
                _error == null ? null : setState(() => _error = null),
          ),
          Text(
            'Quick picks',
            style: t.labelMedium?.copyWith(color: s.onSurfaceVariant),
          ),
          const SizedBox(height: Space.xs),
          Wrap(
            spacing: Space.s,
            children: [
              for (final q in blockerQuickPicks)
                ActionChip(
                  label: Text(q),
                  onPressed: () => setState(() {
                    _ctrl.text = _ctrl.text.trim().isEmpty
                        ? q
                        : '${_ctrl.text.trim()} — $q';
                    _error = null;
                  }),
                ),
            ],
          ),
          const SizedBox(height: Space.m),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Cancel'),
              ),
              const SizedBox(width: Space.s),
              FilledButton(
                key: const Key('confirmBlockButton'),
                style: FilledButton.styleFrom(
                  backgroundColor: s.error,
                  foregroundColor: s.onError,
                  minimumSize: const Size(0, 48),
                ),
                onPressed: _submit,
                child: const Text('Mark blocked'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Runs a status change, asking for a reason first when blocking.
/// Returns the updated task, or null if cancelled or failed.
Future<Task?> requestStatusChange(
  BuildContext context,
  WidgetRef ref,
  Task task,
  TaskStatus to,
) async {
  if (!allowedTargets(task).contains(to)) {
    showError(
      context,
      "A task can't move from ${task.status.label} to ${to.label}.",
    );
    return null;
  }
  String? reason;
  if (to == TaskStatus.blocked) {
    reason = await showBlockReasonSheet(context, task);
    if (reason == null) return null;
  }
  try {
    final updated = await ref
        .read(taskRepositoryProvider)
        .changeStatus(task, to, reason: reason);
    invalidateTask(ref, task);
    if (context.mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(content: Text('Moved to ${updated.status.label}')),
        );
    }
    return updated;
  } catch (e) {
    if (context.mounted) showError(context, e);
    return null;
  }
}

/// Status picker used by "Change status" and long-press on board cards.
Future<TaskStatus?> showStatusPicker(
  BuildContext context,
  Task task, {
  String title = 'Change status',
}) {
  final allowed = allowedTargets(task);
  return showModalBottomSheet<TaskStatus>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: SingleChildScrollView(
        child: Column(
          key: const Key('statusPicker'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Space.l, 0, Space.l, Space.s),
              child: Text(title, style: Theme.of(ctx).textTheme.titleLarge),
            ),
            for (final s in TaskStatus.board)
              if (s != task.status)
                ListTile(
                  key: Key('statusOption_${s.name}'),
                  enabled: allowed.contains(s),
                  leading: Icon(
                    Icons.circle,
                    size: 14,
                    color: ctx.statusColors.forStatus(s).onContainer,
                  ),
                  title: Text(s.label),
                  subtitle: allowed.contains(s)
                      ? (s == TaskStatus.blocked
                            ? const Text('Requires a reason')
                            : null)
                      : Text(
                          s == TaskStatus.forReview
                              ? 'Set by approval (Done on tasks that need approval)'
                              : 'Not allowed from ${task.status.label}',
                        ),
                  onTap: () => Navigator.of(ctx).pop(s),
                ),
            const SizedBox(height: Space.s),
          ],
        ),
      ),
    ),
  );
}
