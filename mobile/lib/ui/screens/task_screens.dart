import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';
import '../widgets/status_flow.dart';

class TaskDetailScreen extends ConsumerWidget {
  const TaskDetailScreen({super.key, required this.taskId});
  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final task = ref.watch(taskProvider(taskId));
    return Scaffold(
      key: const Key('taskDetailScreen'),
      appBar: AppBar(),
      body: AsyncView(
        value: task,
        onRetry: () => ref.invalidate(taskProvider(taskId)),
        data: (t) => _Body(t),
      ),
      bottomNavigationBar: task.hasValue ? _ActionBar(task: task.requireValue) : null,
    );
  }
}

class _ActionBar extends ConsumerWidget {
  const _ActionBar({required this.task});
  final Task task;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Material(
    color: Theme.of(context).colorScheme.surfaceContainer,
    child: SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.all(Space.m),
        child: Row(
          children: [
            Expanded(
              flex: 2,
              child: OutlinedButton.icon(
                key: const Key('taskLogTime'),
                icon: const Icon(Icons.timer_outlined),
                label: const Text('Log time'),
                onPressed: () => context.go('/log?task=${task.id}&project=${task.projectId}'),
              ),
            ),
            const SizedBox(width: Space.m - 4),
            Expanded(
              flex: 3,
              child: FilledButton(
                key: const Key('taskChangeStatus'),
                onPressed: allowedTargets(task).isEmpty
                    ? null
                    : () async {
                        final to = await showStatusPicker(context, task);
                        if (to != null && context.mounted) await requestStatusChange(context, ref, task, to);
                      },
                child: const Text('Change status'),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _Body extends StatelessWidget {
  const _Body(this.t);
  final Task t;
  @override
  Widget build(BuildContext context) {
    final sc = context.statusColors;
    final text = Theme.of(context).textTheme;
    final est = t.estHours == null ? 'no estimate' : '${fmtHours(t.estHours!)}h est.';
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.all(Space.m),
          sliver: SliverList.list(
            children: [
              Text(
                [t.projectName, t.phase].whereType<String>().where((e) => e.isNotEmpty).join(' · '),
                style: text.bodySmall,
              ),
              const SizedBox(height: Space.s),
              Text(t.name, key: const Key('taskTitle'), style: text.headlineMedium),
              const SizedBox(height: Space.s),
              Wrap(
                spacing: Space.s,
                runSpacing: Space.s,
                children: [
                  TaskStatusChip(t.status, key: const Key('taskStatusChip')),
                  PriorityChip(t.priority),
                  StatusChip(label: '${t.party.label} party', colors: sc.todo),
                ],
              ),
              if (t.status == TaskStatus.blocked) ...[
                const SizedBox(height: Space.m),
                Card(
                  key: const Key('blockedBanner'),
                  color: sc.blocked.container,
                  child: ListTile(
                    leading: Icon(Icons.block, color: sc.blocked.onContainer),
                    title: Text(
                      'Blocked',
                      style: TextStyle(color: sc.blocked.onContainer, fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      t.blockerReason ?? 'No reason given',
                      style: TextStyle(color: sc.blocked.onContainer),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: Space.m),
              Card(
                child: Column(
                  children: [
                    ListTile(
                      leading: InitialsAvatar(t.ownerName ?? '?'),
                      title: const Text('Owner'),
                      subtitle: Text(t.ownerName ?? 'Unassigned'),
                    ),
                    const Divider(indent: 72),
                    ListTile(
                      leading: InitialsAvatar(t.assignees.isEmpty ? '?' : t.assignees.first),
                      title: const Text('Assignees'),
                      subtitle: Text(t.assignees.isEmpty ? 'None' : t.assignees.join(', ')),
                    ),
                    const Divider(indent: 72),
                    ListTile(
                      leading: const Icon(Icons.event_outlined),
                      title: const Text('Dates'),
                      subtitle: Text('${fmtShort(t.plannedStart)} → ${fmtShort(t.dueDate)}'),
                    ),
                    const Divider(indent: 72),
                    ListTile(
                      leading: const Icon(Icons.schedule),
                      title: const Text('Effort'),
                      subtitle: Text('${fmtHours(t.actualHours)}h logged of $est'),
                    ),
                    if (t.dependsOn.isNotEmpty) ...[
                      const Divider(indent: 72),
                      ListTile(
                        leading: const Icon(Icons.link),
                        title: const Text('Depends on'),
                        subtitle: Text(t.dependsOn.join(', ')),
                      ),
                    ],
                  ],
                ),
              ),
              if (t.requiresApproval) ...[
                const SizedBox(height: Space.m),
                Text('Approval', style: text.titleSmall),
                const SizedBox(height: Space.s),
                Card(
                  child: ListTile(
                    leading: InitialsAvatar(t.reviewerName ?? 'PM'),
                    title: Text('${t.reviewerName ?? 'Project manager'} · reviewer'),
                    subtitle: const Text('Required before Done'),
                    trailing: StatusChip(
                      label: switch (t.approvalState) {
                        'APPROVED' => 'Approved',
                        'REJECTED' => 'Rejected',
                        _ => 'Pending',
                      },
                      colors: t.approvalState == 'APPROVED' ? sc.done : sc.forReview,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: Space.l),
            ],
          ),
        ),
      ],
    );
  }
}

/// Log time tab: week switcher (PR #14 design), project/task pickers, hours + note, entries.
class LogTimeScreen extends ConsumerStatefulWidget {
  const LogTimeScreen({super.key, this.taskId, this.projectId});
  final String? taskId, projectId;
  @override
  ConsumerState<LogTimeScreen> createState() => _LogTimeScreenState();
}

class _LogTimeScreenState extends ConsumerState<LogTimeScreen> {
  late DateTime _day;
  String? _projectId, _taskId;
  final _hours = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final now = ref.read(clockProvider)();
    _day = DateTime(now.year, now.month, now.day);
    _projectId = widget.projectId;
    _taskId = widget.taskId;
  }

  @override
  void didUpdateWidget(LogTimeScreen old) {
    super.didUpdateWidget(old);
    if (widget.taskId != null && widget.taskId != old.taskId) {
      setState(() {
        _projectId = widget.projectId;
        _taskId = widget.taskId;
      });
    }
  }

  @override
  void dispose() {
    _hours.dispose();
    _note.dispose();
    super.dispose();
  }

  DateTime get _weekStart => _day.subtract(Duration(days: _day.weekday - 1));

  Future<void> _save() async {
    final h = double.tryParse(_hours.text.trim());
    if (_taskId == null) return showError(context, 'Choose a task.');
    if (h == null || h <= 0 || h > 24 || (h * 4) != (h * 4).roundToDouble()) {
      return showError(context, 'Enter hours in steps of 0.25 (max 24).');
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(timeRepositoryProvider)
          .log(taskId: _taskId!, date: _day, hours: h, notes: _note.text.trim());
      _hours.clear();
      _note.clear();
      ref.invalidate(timeWeekProvider);
      ref.invalidate(dashboardProvider);
      ref.invalidate(taskProvider(_taskId!));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Logged ${fmtHours(h)}h')));
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final t = Theme.of(context).textTheme;
    final week = ref.watch(timeWeekProvider(_weekStart));
    final options = ref.watch(timeOptionsProvider).value ?? const <LoggableProject>[];
    final project = options.where((p) => p.id == _projectId).firstOrNull;
    final weekEnd = _weekStart.add(const Duration(days: 6));

    return Scaffold(
      key: const Key('logTimeScreen'),
      appBar: AppBar(title: const Text('Log time')),
      body: ListView(
        padding: const EdgeInsets.all(Space.m),
        children: [
          Row(
            children: [
              IconButton(
                key: const Key('prevWeek'),
                icon: const Icon(Icons.chevron_left),
                onPressed: () => setState(() => _day = _day.subtract(const Duration(days: 7))),
              ),
              Expanded(
                child: Text(
                  '${fmtDate(_weekStart)} – ${weekEnd.month == _weekStart.month ? weekEnd.day : fmtDate(weekEnd)}',
                  textAlign: TextAlign.center,
                  style: t.titleMedium,
                ),
              ),
              IconButton(
                key: const Key('nextWeek'),
                icon: const Icon(Icons.chevron_right),
                onPressed: () => setState(() => _day = _day.add(const Duration(days: 7))),
              ),
            ],
          ),
          const SizedBox(height: Space.s),
          Row(
            children: [
              for (var i = 0; i < 7; i++)
                Builder(
                  builder: (_) {
                    final d = _weekStart.add(Duration(days: i));
                    final sel = d == _day;
                    final hrs =
                        week.value?.entries
                            .where((e) => DateUtils.isSameDay(e.workDate, d))
                            .fold<double>(0, (a, e) => a + e.hours) ??
                        0;
                    return Expanded(
                      child: InkWell(
                        key: Key('day_$i'),
                        borderRadius: BorderRadius.circular(12),
                        onTap: () => setState(() => _day = d),
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 2),
                          padding: const EdgeInsets.symmetric(vertical: Space.s),
                          decoration: BoxDecoration(
                            color: sel ? s.primary : null,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            children: [
                              Text(
                                weekdays[i],
                                style: t.labelSmall?.copyWith(color: sel ? s.onPrimary : null),
                              ),
                              Text(
                                '${d.day}',
                                style: t.titleMedium?.copyWith(color: sel ? s.onPrimary : null),
                              ),
                              Text(
                                hrs == 0 ? '–' : fmtHours(hrs),
                                style: t.labelSmall?.copyWith(color: sel ? s.onPrimary : s.onSurfaceVariant),
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
            ],
          ),
          const SizedBox(height: Space.m),
          DropdownMenu<String>(
            key: const Key('projectDropdown'),
            expandedInsets: EdgeInsets.zero,
            label: const Text('Project'),
            initialSelection: _projectId,
            dropdownMenuEntries: [for (final p in options) DropdownMenuEntry(value: p.id, label: p.name)],
            onSelected: (v) => setState(() {
              _projectId = v;
              _taskId = null;
            }),
          ),
          const SizedBox(height: Space.m),
          DropdownMenu<String>(
            key: ValueKey('taskDropdown_$_projectId'),
            expandedInsets: EdgeInsets.zero,
            label: const Text('Task'),
            enabled: project != null,
            initialSelection: _taskId,
            dropdownMenuEntries: [
              for (final x in project?.tasks ?? const <({String id, String name})>[])
                DropdownMenuEntry(value: x.id, label: x.name),
            ],
            onSelected: (v) => setState(() => _taskId = v),
          ),
          const SizedBox(height: Space.m),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('hoursField'),
                  controller: _hours,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Hours'),
                ),
              ),
              const SizedBox(width: Space.s),
              Expanded(
                child: InputDecorator(
                  decoration: const InputDecoration(labelText: 'Date'),
                  child: Text('${weekdays[_day.weekday - 1]}, ${fmtDate(_day)}'),
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.m),
          TextField(
            key: const Key('noteField'),
            controller: _note,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'Note'),
          ),
          const SizedBox(height: Space.m),
          FilledButton(
            key: const Key('saveEntry'),
            onPressed: _busy ? null : _save,
            child: const Text('Save entry'),
          ),
          const SizedBox(height: Space.m),
          AsyncView(
            value: week,
            data: (w) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('This week · ${fmtHours(w.total)}h', key: const Key('weekTotal'), style: t.titleSmall),
                const SizedBox(height: Space.s),
                Card(
                  child: Column(
                    children: [
                      if (w.entries.isEmpty) const ListTile(title: Text('No time logged this week.')),
                      for (final e in w.entries)
                        ListTile(
                          title: Text(e.taskName),
                          subtitle: Text('${e.projectName} · ${weekdays[e.workDate.weekday - 1]}'),
                          trailing: Text('${fmtHours(e.hours)}h', style: t.titleSmall),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
