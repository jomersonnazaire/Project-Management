// P2 36–40: task actions — approval, request changes, evidence, follow-ups, edit, history, delete.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/p2.dart';
import '../../data/ph_time.dart';
import '../../data/v2_repositories.dart';
import '../../state/p2_providers.dart';
import '../../state/providers.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';
import 'dependencies.dart';

void refreshTask(WidgetRef ref, Task t) {
  invalidateTask(ref, t);
  ref.invalidate(myTasksV2Provider);
  ref.invalidate(taskExtrasProvider(t.id));
  ref.invalidate(taskHistoryProvider(t.id));
}

String _when(DateTime at) => phDateTime(at);

String _size(int? b) {
  if (b == null) return '';
  if (b < 1024) return '$b B';
  if (b < 1024 * 1024) return '${(b / 1024).toStringAsFixed(0)} KB';
  return '${(b / 1024 / 1024).toStringAsFixed(1)} MB';
}

/// Approval card, evidence and follow-ups for Task detail (36).
class TaskActionsSection extends ConsumerStatefulWidget {
  const TaskActionsSection({super.key, required this.task});
  final Task task;
  @override
  ConsumerState<TaskActionsSection> createState() => _TaskActionsSectionState();
}

class _TaskActionsSectionState extends ConsumerState<TaskActionsSection> {
  bool _uploading = false;
  String? _uploadError;

  Task get t => widget.task;

  Future<void> _approve() async {
    try {
      await ref.read(taskActionsRepositoryProvider).approve(t.id, t.version);
      refreshTask(ref, t);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Task approved')));
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  /// Web parity (EvidenceSection `removable`): can.edit, and files stay while For review/Completed.
  bool _removable(TaskExtras x, Evidence e) =>
      x.canEdit &&
      !(e.type == 'FILE' &&
          (t.status == TaskStatus.forReview || t.status == TaskStatus.done));

  Future<void> _remove(Evidence e) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Remove ${e.name} from this task?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('confirmRemoveEvidence'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
              minimumSize: const Size(0, 40),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(taskActionsRepositoryProvider).deleteEvidence(t.id, e.id);
      ref.invalidate(taskExtrasProvider(t.id));
      ref.invalidate(taskHistoryProvider(t.id));
    } catch (err) {
      if (mounted) {
        setState(
          () => _uploadError = err is ApiException ? err.message : '$err',
        );
      }
    }
  }

  Future<void> _upload() async {
    final f = await ref.read(evidencePickerProvider)();
    if (f == null) return;
    final problem = evidenceProblem(f);
    if (problem != null) {
      setState(() => _uploadError = problem);
      return;
    }
    setState(() {
      _uploading = true;
      _uploadError = null;
    });
    try {
      await ref.read(taskActionsRepositoryProvider).uploadEvidence(t.id, f);
      ref.invalidate(taskExtrasProvider(t.id));
    } catch (e) {
      if (mounted) {
        setState(() => _uploadError = e is ApiException ? e.message : '$e');
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final x = ref.watch(taskExtrasProvider(t.id)).value;
    final sc = context.statusColors;
    final text = Theme.of(context).textTheme;
    final pending =
        t.status == TaskStatus.forReview && (x?.canApprove ?? false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (t.requiresApproval) ...[
          const SizedBox(height: Space.m),
          Text('Approval', style: text.titleSmall),
          const SizedBox(height: Space.s),
          Card(
            key: const Key('approvalCard'),
            child: Padding(
              padding: const EdgeInsets.all(Space.m),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      InitialsAvatar(t.reviewerName ?? 'PM'),
                      const SizedBox(width: Space.m),
                      Expanded(
                        child: Text(
                          '${t.reviewerName ?? 'Project manager'} · reviewer',
                          style: text.bodyLarge,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: Space.s),
                  StatusChip(
                    key: const Key('approvalState'),
                    label: switch (t.approvalState) {
                      'APPROVED' => 'Approved',
                      'REJECTED' => 'Changes requested',
                      'PENDING' => 'Pending',
                      _ => 'Required before Done',
                    },
                    colors: t.approvalState == 'APPROVED'
                        ? sc.done
                        : sc.forReview,
                  ),
                  if (t.approvalState == 'REJECTED' &&
                      (x?.approvalComment ?? '').isNotEmpty) ...[
                    const SizedBox(height: Space.s),
                    Text.rich(
                      key: const Key('changesRequested'),
                      TextSpan(
                        children: [
                          const TextSpan(
                            text: 'Changes requested: ',
                            style: TextStyle(fontWeight: FontWeight.w600),
                          ),
                          TextSpan(text: x!.approvalComment),
                        ],
                      ),
                    ),
                  ],
                  if (pending) ...[
                    const SizedBox(height: Space.m),
                    Wrap(
                      spacing: Space.s,
                      runSpacing: Space.s,
                      children: [
                        FilledButton(
                          key: const Key('approveTask'),
                          onPressed: _approve,
                          child: const Text('Approve'),
                        ),
                        OutlinedButton(
                          key: const Key('requestChanges'),
                          onPressed: () async {
                            if (await showRequestChanges(context, t)) {
                              refreshTask(ref, t);
                            }
                          },
                          child: const Text('Request changes'),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: Space.m),
        Text('Evidence', style: text.titleSmall),
        Text(evidenceTypesLabel, style: text.bodySmall),
        const SizedBox(height: Space.s),
        Card(
          key: const Key('evidenceCard'),
          child: Column(
            children: [
              for (final e in x?.evidence ?? const <Evidence>[])
                ListTile(
                  trailing: _removable(x!, e)
                      ? IconButton(
                          key: Key('removeEvidence_${e.id}'),
                          tooltip: 'Remove ${e.name}',
                          icon: const Icon(Icons.delete_outline),
                          onPressed: () => _remove(e),
                        )
                      : null,
                  key: Key('evidence_${e.id}'),
                  leading: Icon(
                    e.legacyLink ? Icons.link : Icons.description_outlined,
                  ),
                  title: Text(e.name),
                  subtitle: Text(
                    e.legacyLink
                        ? 'Link (legacy) · added before file uploads'
                        : [
                            _size(e.size),
                            ?e.addedBy,
                            _when(e.at),
                          ].where((s) => s.isNotEmpty).join(' · '),
                  ),
                ),
              if (_uploading)
                const ListTile(
                  key: Key('evidenceChecking'),
                  leading: Icon(Icons.hourglass_top),
                  title: Text('Checking the file…'),
                ),
              if (_uploadError != null)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: Space.m),
                  child: Text(
                    _uploadError!,
                    key: const Key('evidenceError'),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if ((x?.canStatus ?? false) || (x?.canEdit ?? false))
                Padding(
                  padding: const EdgeInsets.all(Space.s),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      key: const Key('uploadEvidence'),
                      icon: const Icon(Icons.upload_file),
                      label: const Text('Upload file'),
                      onPressed: _uploading ? null : _upload,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Request changes (37): "Comment *", shown on the task as "Changes requested:".
Future<bool> showRequestChanges(BuildContext context, Task t) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    useRootNavigator: true,
    showDragHandle: true,
    builder: (_) => _RequestChangesSheet(task: t),
  );
  return ok == true;
}

class _RequestChangesSheet extends ConsumerStatefulWidget {
  const _RequestChangesSheet({required this.task});
  final Task task;
  @override
  ConsumerState<_RequestChangesSheet> createState() =>
      _RequestChangesSheetState();
}

class _RequestChangesSheetState extends ConsumerState<_RequestChangesSheet> {
  final _c = TextEditingController();
  String? _error;
  bool _busy = false;
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_c.text.trim().isEmpty) {
      setState(() => _error = 'Comment is required.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(taskActionsRepositoryProvider)
          .requestChanges(widget.task.id, widget.task.version, _c.text);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.fields['comment'] ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      Space.m,
      0,
      Space.m,
      MediaQuery.viewInsetsOf(context).bottom + Space.l,
    ),
    child: Column(
      key: const Key('requestChangesSheet'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Request changes', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: Space.s),
        const Text(
          'The task goes back to In progress, and the assignees see your comment.',
        ),
        const SizedBox(height: Space.m),
        TextField(
          key: const Key('requestChangesComment'),
          controller: _c,
          maxLength: 1000,
          minLines: 2,
          maxLines: 5,
          decoration: InputDecoration(
            labelText: 'Comment *',
            errorText: _error,
          ),
        ),
        FilledButton(
          key: const Key('requestChangesSubmit'),
          onPressed: _busy ? null : _send,
          child: const Text('Request changes'),
        ),
      ],
    ),
  );
}

/// Delete (40). Only when the API says `deletable`; otherwise explain why.
Future<void> deleteTask(BuildContext context, WidgetRef ref, Task t) async {
  final x = await ref.read(taskExtrasProvider(t.id).future);
  if (!context.mounted) return;
  if (!x.deletable) {
    showError(
      context,
      x.deleteBlockedReason ?? 'This task has records, so it can’t be deleted.',
    );
    return;
  }
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Delete "${t.name}"?'),
      content: const Text(
        'Nothing has been recorded on it yet. This cannot be undone.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('confirmDeleteTask'),
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(ctx).colorScheme.error,
            minimumSize: const Size(0, 40),
          ),
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  if (ok != true) return;
  try {
    await ref.read(taskActionsRepositoryProvider).delete(t.id);
    ref.invalidate(projectTasksProvider(t.projectId));
    ref.invalidate(myTasksProvider);
    ref.invalidate(myTasksV2Provider);
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Task deleted')));
      context.go('/projects/${t.projectId}');
    }
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

class HistoryList extends StatelessWidget {
  const HistoryList({
    super.key,
    required this.items,
    required this.listKey,
    this.empty = 'No history yet.',
  });
  final List<HistoryItem> items;
  final String listKey, empty;
  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return Center(child: Text(empty, key: Key('${listKey}Empty')));
    }
    final t = Theme.of(context).textTheme;
    return ListView.separated(
      key: Key(listKey),
      padding: const EdgeInsets.all(Space.m),
      itemCount: items.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final h = items[i];
        return ListTile(
          contentPadding: EdgeInsets.zero,
          leading: InitialsAvatar(h.actor ?? '?'),
          title: Text(h.label),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${h.actor ?? 'System'} · ${_when(h.at)}',
                style: t.bodySmall,
              ),
              for (final c in h.changes)
                Text(
                  '${c.field}: ${c.old ?? '—'} → ${c.now ?? '—'}',
                  style: t.bodySmall,
                ),
              if (h.reason != null && h.reason!.isNotEmpty)
                Text('Reason: ${h.reason}', style: t.bodySmall),
            ],
          ),
        );
      },
    );
  }
}

final _peopleProvider = FutureProvider.family<List<NamedRef>, String>(
  (ref, projectId) =>
      ref.watch(taskActionsRepositoryProvider).projectPeople(projectId),
);

/// Edit task (38): PATCH /tasks/:id with the TaskFormModal fields.
class EditTaskScreen extends ConsumerStatefulWidget {
  const EditTaskScreen({super.key, required this.taskId});
  final String taskId;
  @override
  ConsumerState<EditTaskScreen> createState() => _EditTaskScreenState();
}

class _EditTaskScreenState extends ConsumerState<EditTaskScreen> {
  final _name = TextEditingController();
  final _phase = TextEditingController();
  final _est = TextEditingController();
  final _deliverable = TextEditingController();
  Priority _priority = Priority.medium;
  Party _party = Party.internal;
  String? _owner, _contact;
  Set<String> _assignees = {};
  List<String> _deps = [];
  DateTime? _planned, _due;
  bool _approval = false, _mandatory = false, _loaded = false, _busy = false;
  Map<String, String> _errors = {};
  Task? _task;

  @override
  void dispose() {
    for (final c in [_name, _phase, _est, _deliverable]) {
      c.dispose();
    }
    super.dispose();
  }

  void _load(Task t, TaskExtras x) {
    if (_loaded) return;
    _loaded = true;
    _task = t;
    _name.text = t.name;
    _phase.text = t.phase ?? '';
    _est.text = t.estHours == null ? '' : fmtHours(t.estHours!);
    _deliverable.text = x.deliverable ?? '';
    _priority = t.priority;
    _party = t.party;
    _owner = x.ownerId;
    _contact = x.clientContactId;
    _assignees = {...x.assigneeIds};
    _deps = [...t.dependsOn];
    _planned = t.plannedStart;
    _due = t.dueDate;
    _approval = t.requiresApproval;
    _mandatory = t.mandatory;
  }

  Future<void> _save() async {
    final est = _est.text.trim();
    final e = <String, String>{
      if (_name.text.trim().isEmpty) 'name': 'Task name is required.',
      if (_planned != null && _due != null && _due!.isBefore(_planned!))
        'dueDate': "Due date can't be before the start date.",
      if (est.isNotEmpty && ((double.tryParse(est) ?? -1) < 0))
        'estHours': 'Enter hours as a number.',
      'dependsOn': ?dependencyProblem(
        _task!.id,
        _deps,
        ref.read(projectTasksProvider(_task!.projectId)).value ?? const [],
      ),
    };
    setState(() => _errors = e);
    if (e.isNotEmpty) return;
    setState(() => _busy = true);
    final t = _task!;
    try {
      await ref
          .read(taskActionsRepositoryProvider)
          .update(
            t.id,
            TaskEdit(
              version: t.version,
              name: _name.text.trim(),
              phase: _phase.text,
              priority: _priority,
              party: _party,
              ownerId: _owner,
              assigneeIds: _assignees.toList(),
              plannedStart: _planned,
              dueDate: _due,
              estHours: est.isEmpty ? null : double.parse(est),
              deliverable: _deliverable.text,
              requiresApproval: _approval,
              mandatory: _mandatory,
              clientContactId: _party == Party.client ? _contact : null,
              dependsOn: _deps,
            ),
          );
      refreshTask(ref, t);
      if (mounted) popOrGo(context, '/tasks/${t.id}');
    } on ApiException catch (err) {
      if (mounted) {
        setState(
          () => _errors = err.fields.isNotEmpty
              ? err.fields
              : err.code == 'DEPENDENCY_CYCLE' ||
                    err.code == 'INVALID_DEPENDENCY'
              ? {'dependsOn': err.message}
              : {'_': err.message},
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pick(bool planned) async {
    final d = await showDatePicker(
      context: context,
      initialDate: (planned ? _planned : _due) ?? DateTime(2026, 10, 11),
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (d != null) setState(() => planned ? _planned = d : _due = d);
  }

  @override
  Widget build(BuildContext context) {
    final task = ref.watch(taskProvider(widget.taskId));
    final extras = ref.watch(taskExtrasProvider(widget.taskId));
    if (task.hasValue && extras.hasValue) {
      _load(task.requireValue, extras.requireValue);
    }
    final pid = task.value?.projectId;
    final people = pid == null
        ? const <NamedRef>[]
        : (ref.watch(_peopleProvider(pid)).value ?? const <NamedRef>[]);
    final contacts = pid == null
        ? const <Contact>[]
        : (ref.watch(projectExtrasProvider(pid)).value?.contacts ??
              const <Contact>[]);
    Widget gap() => const SizedBox(height: Space.m);
    Widget date(
      String key,
      String label,
      DateTime? v,
      String field,
      bool planned,
    ) => InkWell(
      key: Key(key),
      onTap: () => _pick(planned),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: _errors[field],
          errorMaxLines: 2,
        ),
        child: Text(v == null ? '' : fmtDate(v)),
      ),
    );
    return Scaffold(
      key: const Key('editTaskScreen'),
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Close',
          icon: const Icon(Icons.close),
          onPressed: () => popOrGo(context, '/tasks/${widget.taskId}'),
        ),
        title: const Text('Edit task'),
        actions: [
          TextButton(
            key: const Key('taskSave'),
            onPressed: _busy || !_loaded ? null : _save,
            child: const Text('Save'),
          ),
        ],
      ),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              key: const Key('editTaskList'),
              padding: const EdgeInsets.all(Space.m),
              children: [
                if (_errors['_'] != null) ...[
                  Text(
                    _errors['_']!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                  gap(),
                ],
                TextField(
                  key: const Key('editTaskName'),
                  controller: _name,
                  maxLength: 200,
                  decoration: InputDecoration(
                    labelText: 'Task name *',
                    errorText: _errors['name'],
                  ),
                ),
                TextField(
                  key: const Key('editTaskPhase'),
                  controller: _phase,
                  maxLength: 120,
                  decoration: InputDecoration(
                    labelText: 'Phase',
                    errorText: _errors['phase'],
                  ),
                ),
                DropdownMenu<Priority>(
                  key: const Key('editTaskPriority'),
                  expandedInsets: EdgeInsets.zero,
                  label: const Text('Priority'),
                  initialSelection: _priority,
                  dropdownMenuEntries: [
                    for (final p in Priority.values)
                      DropdownMenuEntry(value: p, label: p.label),
                  ],
                  onSelected: (v) => setState(() => _priority = v ?? _priority),
                ),
                gap(),
                Text('Party', style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: Space.s),
                SegmentedButton<Party>(
                  key: const Key('editTaskParty'),
                  showSelectedIcon: false,
                  segments: [
                    for (final p in Party.values)
                      ButtonSegment(value: p, label: FitLabel(p.label)),
                  ],
                  selected: {_party},
                  onSelectionChanged: (v) => setState(() => _party = v.first),
                ),
                if (_party == Party.client) ...[
                  gap(),
                  DropdownMenu<String>(
                    key: ValueKey('editTaskContact_${contacts.length}'),
                    expandedInsets: EdgeInsets.zero,
                    label: const Text('Client contact'),
                    initialSelection: _contact,
                    dropdownMenuEntries: [
                      for (final c in contacts)
                        DropdownMenuEntry(value: c.id, label: c.name),
                    ],
                    onSelected: (v) => setState(() => _contact = v),
                  ),
                ],
                gap(),
                DropdownMenu<String>(
                  key: ValueKey('editTaskOwner_${people.length}'),
                  expandedInsets: EdgeInsets.zero,
                  label: const Text('Owner'),
                  initialSelection: _owner,
                  dropdownMenuEntries: [
                    for (final p in people)
                      DropdownMenuEntry(value: p.id, label: p.name),
                  ],
                  onSelected: (v) => setState(() => _owner = v),
                ),
                gap(),
                Text(
                  'Assignees',
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                Wrap(
                  key: const Key('editTaskAssignees'),
                  spacing: Space.s,
                  children: [
                    for (final p in people)
                      FilterChip(
                        key: Key('assignee_${p.id}'),
                        label: Text(p.name),
                        selected: _assignees.contains(p.id),
                        onSelected: (v) => setState(
                          () => v
                              ? _assignees.add(p.id)
                              : _assignees.remove(p.id),
                        ),
                      ),
                  ],
                ),
                gap(),
                DependenciesField(
                  projectId: _task!.projectId,
                  taskId: _task!.id,
                  selected: _deps,
                  errorText: _errors['dependsOn'],
                  onChanged: (v) => setState(() {
                    _deps = v;
                    _errors = {..._errors}..remove('dependsOn');
                  }),
                ),
                gap(),
                date(
                  'editTaskPlanned',
                  'Planned start',
                  _planned,
                  'plannedStart',
                  true,
                ),
                gap(),
                date('editTaskDue', 'Due', _due, 'dueDate', false),
                gap(),
                TextField(
                  key: const Key('editTaskEst'),
                  controller: _est,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: InputDecoration(
                    labelText: 'Est. hours',
                    errorText: _errors['estHours'],
                  ),
                ),
                gap(),
                TextField(
                  key: const Key('editTaskDeliverable'),
                  controller: _deliverable,
                  maxLength: 500,
                  decoration: InputDecoration(
                    labelText: 'Deliverable',
                    errorText: _errors['deliverable'],
                  ),
                ),
                SwitchListTile(
                  key: const Key('editTaskApproval'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Requires approval'),
                  value: _approval,
                  onChanged: (v) => setState(() => _approval = v),
                ),
                SwitchListTile(
                  key: const Key('editTaskMandatory'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Mandatory'),
                  value: _mandatory,
                  onChanged: (v) => setState(() => _mandatory = v),
                ),
              ],
            ),
    );
  }
}

/// History tab (design 39): follow-up note + a timeline of follow-ups and audit events.
class TaskHistoryTab extends ConsumerStatefulWidget {
  const TaskHistoryTab({super.key, required this.task});
  final Task task;
  @override
  ConsumerState<TaskHistoryTab> createState() => _TaskHistoryTabState();
}

class _TaskHistoryTabState extends ConsumerState<TaskHistoryTab> {
  final _note = TextEditingController();
  String? _error;
  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    if (_note.text.trim().isEmpty) {
      setState(() => _error = 'Note is required.');
      return;
    }
    try {
      await ref
          .read(taskActionsRepositoryProvider)
          .addFollowUp(widget.task.id, _note.text);
      _note.clear();
      setState(() => _error = null);
      ref.invalidate(taskExtrasProvider(widget.task.id));
    } on ApiException catch (e) {
      setState(() => _error = e.fields['note'] ?? e.message);
    }
  }

  static IconData _icon(String action) => switch (action) {
    'follow_up' => Icons.forum_outlined,
    'task_created' => Icons.add_task,
    'task_status_changed' ||
    'task_approved' ||
    'task_rejected' => Icons.swap_horiz,
    'task_blocked' => Icons.block,
    'task_assigned' || 'task_updated' => Icons.edit_note,
    _ when action.contains('evidence') => Icons.attach_file,
    _ => Icons.history,
  };

  @override
  Widget build(BuildContext context) {
    final id = widget.task.id;
    final x = ref.watch(taskExtrasProvider(id)).value;
    final h = ref.watch(taskHistoryProvider(id)).value ?? const <HistoryItem>[];
    final items = <({DateTime at, String title, String sub, String action})>[
      for (final f in x?.followUps ?? const <FollowUp>[])
        (
          at: f.at,
          title: 'Follow-up: ${f.note}',
          sub: [
            ?f.author,
            if (f.contact != null) 'to ${f.contact}',
            _when(f.at),
          ].join(' · '),
          action: 'follow_up',
        ),
      for (final e in h)
        (
          at: e.at,
          title: [
            e.label,
            for (final c in e.changes)
              if (c.field == 'status') '→ ${c.now}',
          ].join(' '),
          sub: [
            e.actor ?? 'System',
            _when(e.at),
            if (e.reason != null && e.reason!.isNotEmpty) e.reason!,
          ].join(' · '),
          action: e.action,
        ),
    ]..sort((a, b) => b.at.compareTo(a.at));
    return ListView(
      key: const Key('taskHistoryList'),
      padding: const EdgeInsets.all(Space.m),
      children: [
        if (canW(ref, 'tasks', 'edit') && x?.canEdit != false) ...[
          TextField(
            key: const Key('followUpField'),
            controller: _note,
            maxLength: 2000,
            minLines: 2,
            maxLines: 4,
            decoration: InputDecoration(
              labelText: 'Follow-up note',
              hintText: 'What did you chase, and with whom?',
              filled: true,
              errorText: _error,
            ),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton(
              key: const Key('addFollowUp'),
              onPressed: _add,
              child: const Text('Add follow-up'),
            ),
          ),
        ],
        const SizedBox(height: Space.m),
        if ((x?.followUps ?? const []).isEmpty)
          const Padding(
            padding: EdgeInsets.only(bottom: Space.s),
            child: Text('No follow-ups yet.', key: Key('noFollowUps')),
          ),
        Card(
          key: const Key('taskTimeline'),
          child: Column(
            children: [
              for (final (i, e) in items.indexed) ...[
                if (i > 0) const Divider(indent: 56, height: 1),
                ListTile(
                  leading: Icon(_icon(e.action)),
                  title: Text(e.title),
                  subtitle: Text(e.sub),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
