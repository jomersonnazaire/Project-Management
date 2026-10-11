import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config.dart';

import '../../data/models.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../v2/entry_sheet.dart';
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
      appBar: AppBar(
        leading: BackOrUpButton(
          fallback: task.hasValue
              ? '/projects/${task.requireValue.projectId}'
              : '/home',
        ),
        actions: [
          IconButton(
            key: const Key('taskEdit'),
            tooltip: 'Edit task',
            icon: const Icon(Icons.edit_outlined),
            onPressed: task.hasValue
                ? () => _openOnWeb(context, task.requireValue)
                : null,
          ),
          PopupMenuButton<String>(
            key: const Key('taskOverflow'),
            tooltip: 'More options',
            onSelected: (v) {
              if (v == 'refresh') ref.invalidate(taskProvider(taskId));
              if (v == 'web' && task.hasValue) {
                _openOnWeb(context, task.requireValue);
              }
              if (v == 'project' && task.hasValue) {
                context.go('/projects/${task.requireValue.projectId}');
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'refresh', child: Text('Refresh')),
              PopupMenuItem(value: 'project', child: Text('Open project')),
              PopupMenuItem(value: 'web', child: Text('Open in web app')),
            ],
          ),
        ],
      ),
      body: AsyncView(
        value: task,
        onRetry: () => ref.invalidate(taskProvider(taskId)),
        data: (t) => _Body(t),
      ),
      bottomNavigationBar: task.hasValue
          ? _ActionBar(task: task.requireValue)
          : null,
    );
  }
}

/// Full task editing (owner, assignees, dependencies…) lives on the web for now.
Future<void> _openOnWeb(BuildContext context, Task t) async {
  final ok = await launchUrl(
    Uri.parse('${AppConfig.webAppUrl}/projects/${t.projectId}?task=${t.id}'),
    mode: LaunchMode.externalApplication,
  );
  if (!ok && context.mounted) showError(context, 'Could not open the web app.');
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
                key: const Key('taskTimeIn'),
                icon: const Icon(Icons.play_arrow_outlined),
                label: const FitLabel('Time in'),
                onPressed: () => timeInOnTask(context, ref, task.id),
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
                        if (to != null && context.mounted) {
                          await requestStatusChange(context, ref, task, to);
                        }
                      },
                child: const FitLabel('Change status'),
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
    final est = t.estHours == null
        ? 'no estimate'
        : '${fmtHours(t.estHours!)}h est.';
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.all(Space.m),
          sliver: SliverList.list(
            children: [
              Text(
                [
                  t.projectName,
                  t.phase,
                ].whereType<String>().where((e) => e.isNotEmpty).join(' · '),
                style: text.bodySmall,
              ),
              const SizedBox(height: Space.s),
              Text(
                t.name,
                key: const Key('taskTitle'),
                style: text.headlineMedium,
              ),
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
                      style: TextStyle(
                        color: sc.blocked.onContainer,
                        fontWeight: FontWeight.w600,
                      ),
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
                      leading: InitialsAvatar(
                        t.assignees.isEmpty ? '?' : t.assignees.first,
                      ),
                      title: const Text('Assignees'),
                      subtitle: Text(
                        t.assignees.isEmpty ? 'None' : t.assignees.join(', '),
                      ),
                    ),
                    const Divider(indent: 72),
                    ListTile(
                      leading: const Icon(Icons.event_outlined),
                      title: const Text('Dates'),
                      subtitle: Text(
                        '${fmtShort(t.plannedStart)} → ${fmtShort(t.dueDate)}',
                      ),
                    ),
                    const Divider(indent: 72),
                    ListTile(
                      leading: const Icon(Icons.schedule),
                      title: const Text('Effort'),
                      subtitle: Text(
                        '${fmtHours(t.actualHours)}h logged of $est',
                      ),
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
                    title: Text(
                      '${t.reviewerName ?? 'Project manager'} · reviewer',
                    ),
                    subtitle: const Text('Required before Done'),
                    trailing: StatusChip(
                      label: switch (t.approvalState) {
                        'APPROVED' => 'Approved',
                        'REJECTED' => 'Rejected',
                        _ => 'Pending',
                      },
                      colors: t.approvalState == 'APPROVED'
                          ? sc.done
                          : sc.forReview,
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
  DateTime get _today {
    final n = ref.read(clockProvider)();
    return DateTime(n.year, n.month, n.day);
  }

  bool get _canGoNext =>
      !_weekStart.add(const Duration(days: 7)).isAfter(_today);

  void _selectDay(DateTime d) =>
      setState(() => _day = d.isAfter(_today) ? _today : d);

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _day,
      firstDate: DateTime(_today.year - 1),
      lastDate: _today, // no future dates
    );
    if (d != null) _selectDay(d);
  }

  Future<void> _save() async {
    final h = double.tryParse(_hours.text.trim());
    if (_taskId == null) return showError(context, 'Choose a task.');
    if (h == null || h <= 0 || h > 24 || (h * 4) != (h * 4).roundToDouble()) {
      return showError(context, 'Enter hours in steps of 0.25 (max 24).');
    }
    if (_day.isAfter(_today)) {
      return showError(context, "You can't log time on a future date.");
    }
    final logged =
        ref
            .read(timeWeekProvider(_weekStart))
            .value
            ?.entries
            .where((e) => DateUtils.isSameDay(e.workDate, _day))
            .fold<double>(0, (a, e) => a + e.hours) ??
        0;
    if (logged + h > 24) {
      return showError(
        context,
        'That makes ${fmtHours(logged + h)}h on ${fmtDate(_day)}. A day can have at most 24h '
        '(${fmtHours(24 - logged)}h left).',
      );
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(timeRepositoryProvider)
          .log(
            taskId: _taskId!,
            date: _day,
            hours: h,
            notes: _note.text.trim(),
          );
      _hours.clear();
      _note.clear();
      ref.invalidate(timeWeekProvider);
      ref.invalidate(dashboardProvider);
      ref.invalidate(taskProvider(_taskId!));
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Logged ${fmtHours(h)}h')));
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
    final options =
        ref.watch(timeOptionsProvider).value ?? const <LoggableProject>[];
    final project = options.where((p) => p.id == _projectId).firstOrNull;
    final weekEnd = _weekStart.add(const Duration(days: 6));

    return Scaffold(
      key: const Key('logTimeScreen'),
      appBar: AppBar(
        leading: const BackOrUpButton(fallback: '/day'),
        title: const Text('Log time'),
        actions: [
          IconButton(
            key: const Key('pickDate'),
            tooltip: 'Pick a date',
            icon: const Icon(Icons.calendar_month_outlined),
            onPressed: _pickDate,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(Space.m),
        children: [
          Row(
            children: [
              IconButton(
                key: const Key('prevWeek'),
                tooltip: 'Previous week',
                icon: const Icon(Icons.chevron_left),
                onPressed: () => setState(
                  () => _day = _day.subtract(const Duration(days: 7)),
                ),
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
                tooltip: 'Next week',
                icon: const Icon(Icons.chevron_right),
                onPressed: _canGoNext
                    ? () => _selectDay(_day.add(const Duration(days: 7)))
                    : null,
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
                    final future = d.isAfter(_today);
                    final hrs =
                        week.value?.entries
                            .where((e) => DateUtils.isSameDay(e.workDate, d))
                            .fold<double>(0, (a, e) => a + e.hours) ??
                        0;
                    return Expanded(
                      child: InkWell(
                        key: Key('day_$i'),
                        borderRadius: BorderRadius.circular(12),
                        onTap: future ? null : () => _selectDay(d),
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 2),
                          padding: const EdgeInsets.symmetric(
                            vertical: Space.s,
                          ),
                          decoration: BoxDecoration(
                            color: sel ? s.primary : s.surfaceContainerLow,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          foregroundDecoration: future
                              ? BoxDecoration(
                                  color: s.surface.withValues(alpha: .6),
                                  borderRadius: BorderRadius.circular(12),
                                )
                              : null,
                          child: Column(
                            children: [
                              Text(
                                weekdays[i],
                                style: t.labelSmall?.copyWith(
                                  color: sel ? s.onPrimary : null,
                                ),
                              ),
                              Text(
                                '${d.day}',
                                style: t.titleMedium?.copyWith(
                                  color: sel ? s.onPrimary : null,
                                ),
                              ),
                              Text(
                                hrs == 0 ? '–' : fmtHours(hrs),
                                style: t.labelSmall?.copyWith(
                                  color: sel ? s.onPrimary : s.onSurfaceVariant,
                                ),
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
            key: Key('projectDropdown_$_projectId'),
            trailingIcon: const Icon(
              Icons.arrow_drop_down,
              semanticLabel: 'Show projects',
            ),
            selectedTrailingIcon: const Icon(
              Icons.arrow_drop_up,
              semanticLabel: 'Hide projects',
            ),
            expandedInsets: EdgeInsets.zero,
            label: const Text('Project'),
            initialSelection: _projectId,
            dropdownMenuEntries: [
              for (final p in options)
                DropdownMenuEntry(value: p.id, label: p.name),
            ],
            onSelected: (v) => setState(() {
              _projectId = v;
              _taskId = null;
            }),
          ),
          const SizedBox(height: Space.m),
          DropdownMenu<String>(
            key: ValueKey('taskDropdown_${_projectId}_$_taskId'),
            trailingIcon: const Icon(
              Icons.arrow_drop_down,
              semanticLabel: 'Show tasks',
            ),
            selectedTrailingIcon: const Icon(
              Icons.arrow_drop_up,
              semanticLabel: 'Hide tasks',
            ),
            expandedInsets: EdgeInsets.zero,
            label: const Text('Task'),
            enabled: project != null,
            initialSelection: _taskId,
            dropdownMenuEntries: [
              for (final x
                  in project?.tasks ?? const <({String id, String name})>[])
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
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Hours'),
                ),
              ),
              const SizedBox(width: Space.s),
              Expanded(
                child: InputDecorator(
                  decoration: const InputDecoration(labelText: 'Date'),
                  child: Text(
                    '${weekdays[_day.weekday - 1]}, ${fmtDate(_day)}',
                  ),
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
                Text(
                  'This week · ${fmtHours(w.total)}h',
                  key: const Key('weekTotal'),
                  style: t.titleSmall,
                ),
                const SizedBox(height: Space.s),
                Card(
                  child: Column(
                    children: [
                      if (w.entries.isEmpty)
                        const ListTile(
                          title: Text('No time logged this week.'),
                        ),
                      for (final e in w.entries)
                        ListTile(
                          title: Text(e.taskName),
                          subtitle: Text(
                            '${e.projectName} · ${weekdays[e.workDate.weekday - 1]}',
                          ),
                          trailing: Text(
                            '${fmtHours(e.hours)}h',
                            style: t.titleSmall,
                          ),
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
