import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/ph_time.dart';
import '../../data/tracker_models.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../../data/access.dart' show resolveMyTasksTab, myTasksTabRules;
import '../widgets/common.dart';
import 'day_timesheet.dart';
import 'entry_sheet.dart';

const myTaskTabs = [
  ('today', 'Today'),
  ('day', 'Day timesheet'),
  ('due', 'Due'),
  ('assigned', 'Assigned to me'),
  ('accountable', 'I\'m accountable'),
  ('review', 'To review'),
  ('completed', 'Completed'),
];

/// My tasks (01–02): 7 scrollable tabs. "Day timesheet" embeds the same DayTimesheetBody as the tab.
/// Tabs follow GET /auth/me/permissions `myTasksTabs` (FR-ACL-21): e.g. a Viewer has no Today
/// or Day timesheet tab. A deep link to a hidden tab opens the next allowed one.
class MyTasksV2Screen extends ConsumerWidget {
  const MyTasksV2Screen({super.key, this.initialTab});
  final String? initialTab;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final allowed = ref.watch(myTasksTabsProvider);
    if (allowed == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final tabs = [
      for (final t in myTaskTabs)
        if (allowed.contains(t.$1)) t,
    ];
    if (tabs.isEmpty) {
      return Scaffold(
        key: const Key('myTasksScreen'),
        appBar: AppBar(title: const Text('My tasks')),
        body: const Center(child: Text("You don't have access to My tasks.")),
      );
    }
    return _MyTasksTabs(
      key: ValueKey(allowed.join(',')),
      tabs: tabs,
      initialTab: resolveMyTasksTab(
        initialTab ?? _defaultTab(ref.watch(permissionsBodyProvider).value),
        allowed,
      ),
      wanted: initialTab,
    );
  }
}

/// D7 `defaultTab` (API key; `day-timesheet` → `day`).
String? _defaultTab(Map<String, dynamic>? body) {
  final d = body?['defaultTab'];
  return d is String ? (d == 'day-timesheet' ? 'day' : d) : null;
}

class _MyTasksTabs extends ConsumerStatefulWidget {
  const _MyTasksTabs({
    super.key,
    required this.tabs,
    this.initialTab,
    this.wanted,
  });
  final List<(String, String)> tabs;
  final String? initialTab;
  final String? wanted;
  @override
  ConsumerState<_MyTasksTabs> createState() => _MyTasksV2ScreenState();
}

class _MyTasksV2ScreenState extends ConsumerState<_MyTasksTabs>
    with SingleTickerProviderStateMixin {
  List<(String, String)> get myTaskTabs => widget.tabs;
  late final TabController _tabs = TabController(
    length: myTaskTabs.length,
    vsync: this,
    initialIndex: _index(widget.initialTab),
  );
  bool _searching = false;
  String _query = '';

  int _index(String? key) =>
      myTaskTabs.indexWhere((t) => t.$1 == key).clamp(0, myTaskTabs.length - 1);

  @override
  void initState() {
    super.initState();
    _tabs.addListener(() => setState(() {}));
    _noticeIfDenied(widget.wanted);
  }

  /// D7: a deep link to a tab this user can't open lands on the next allowed tab
  /// with a notice.
  void _noticeIfDenied(String? wanted) {
    if (wanted == null || !myTaskTabs.every((t) => t.$1 != wanted)) return;
    if (!myTasksTabRules.any((r) => r.$1 == wanted)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(
          key: Key('noTabAccessNotice'),
          content: Text("You don't have access to that view."),
        ),
      );
    });
  }

  @override
  void didUpdateWidget(_MyTasksTabs old) {
    super.didUpdateWidget(old);
    if (widget.wanted != old.wanted && widget.initialTab != null) {
      _tabs.index = _index(widget.initialTab);
      _noticeIfDenied(widget.wanted);
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final onDay = myTaskTabs[_tabs.index].$1 == 'day';
    return Scaffold(
      key: const Key('myTasksScreen'),
      appBar: AppBar(
        title: const Text('My tasks'),
        actions: [
          if (onDay) const DayTimesheetActions(),
          if (!onDay)
            IconButton(
              key: const Key('taskSearchToggle'),
              tooltip: 'Search tasks',
              icon: Icon(_searching ? Icons.close : Icons.search),
              onPressed: () => setState(() {
                _searching = !_searching;
                if (!_searching) _query = '';
              }),
            ),
          if (!onDay)
            IconButton(
              tooltip: 'Notifications',
              icon: const Icon(Icons.notifications_outlined),
              onPressed: () => context.push('/notifications'),
            ),
        ],
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: [
            for (final (k, l) in myTaskTabs)
              Tab(key: Key('myTasksTab_$k'), text: l),
          ],
        ),
      ),
      body: Column(
        children: [
          if (_searching && !onDay)
            Padding(
              padding: const EdgeInsets.fromLTRB(Space.m, Space.s, Space.m, 0),
              child: SearchBar(
                key: const Key('taskSearch'),
                autoFocus: true,
                hintText: 'Search tasks…',
                leading: const Icon(Icons.search),
                elevation: const WidgetStatePropertyAll(0),
                onChanged: (v) => setState(() => _query = v.trim()),
              ),
            ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                for (final (k, _) in myTaskTabs)
                  k == 'day'
                      ? const Padding(
                          padding: EdgeInsets.only(top: Space.s),
                          child: DayTimesheetBody(showSegment: false),
                        )
                      : _TaskTab(view: k, query: _query),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TaskTab extends ConsumerWidget {
  const _TaskTab({required this.view, required this.query});
  final String view, query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final res = ref.watch(myTasksV2Provider((view, query)));
    final running = ref.watch(runningProvider).value?.entry;
    final s = Theme.of(context).colorScheme;
    final sc = context.statusColors;
    final t = Theme.of(context).textTheme;
    final week = ref.watch(
      hoursWeekProvider(mondayOf(ref.watch(todayPhProvider))),
    );
    return AsyncView(
      value: res,
      onRetry: () => ref.invalidate(myTasksV2Provider((view, query))),
      data: (r) {
        final empty = query.isNotEmpty
            ? 'No tasks match your search.'
            : switch (view) {
                'today' => 'Nothing planned for today',
                'due' => 'Nothing due today',
                _ => 'No tasks here right now.',
              };
        final logged = week.value?.fold<int>(0, (a, e) => a + e.minutes) ?? 0;
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(myTasksV2Provider),
          child: ListView(
            key: Key('myTasksList_$view'),
            padding: const EdgeInsets.fromLTRB(
              Space.m,
              Space.s,
              Space.m,
              Space.xl,
            ),
            children: [
              if (view == 'today') ...[
                _KpiRow(
                  items: [
                    _Kpi('Overdue', '${r.overdue}', sc.blocked),
                    _Kpi('Due this week', '${r.dueThisWeek}', sc.forReview),
                    _Kpi(
                      'Waiting for my review',
                      '${r.toReview}',
                      sc.inProgress,
                    ),
                    _Kpi(
                      'Logged this week',
                      formatHHMM(logged),
                      StatusPair(s.primaryContainer, s.onPrimaryContainer),
                    ),
                  ],
                ),
                const SizedBox(height: Space.s),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Philippine time · by planned date',
                        style: t.bodySmall,
                      ),
                    ),
                    Flexible(
                      child: FilledButton.tonalIcon(
                        key: const Key('quickActivityButton'),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 40),
                        ),
                        icon: const Icon(Icons.add),
                        label: const FitLabel('Add quick activity'),
                        onPressed: () async {
                          if (await showEntrySheet(
                            context,
                            mode: EntryMode.quick,
                          )) {
                            invalidateTracker(ref);
                          }
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: Space.s),
              ],
              if (r.items.isEmpty)
                Padding(
                  key: const Key('myTasksEmpty'),
                  padding: const EdgeInsets.symmetric(vertical: Space.xl),
                  child: Center(child: Text(empty, style: t.titleMedium)),
                )
              else
                Card(
                  child: Column(
                    children: [
                      for (final (i, task) in r.items.indexed) ...[
                        if (i > 0)
                          const Divider(indent: Space.m, endIndent: Space.m),
                        _TaskRow(
                          task: task,
                          view: view,
                          running: running?.task?.id == task.id,
                        ),
                      ],
                    ],
                  ),
                ),
              if (view == 'today')
                Padding(
                  padding: const EdgeInsets.only(top: Space.s),
                  child: Text(
                    'Use Add quick activity to time non-project work.',
                    style: t.bodySmall,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

/// 4 across normally; 2×2 at large text so labels wrap at word boundaries (QA #3).
class _KpiRow extends StatelessWidget {
  const _KpiRow({required this.items});
  final List<_Kpi> items;
  @override
  Widget build(BuildContext context) {
    final large = MediaQuery.textScalerOf(context).scale(10) > 13;
    Widget row(List<_Kpi> xs) => IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: xs),
    );
    if (!large) return row(items);
    return Column(
      children: [
        row(items.sublist(0, 2)),
        const SizedBox(height: 4),
        row(items.sublist(2)),
      ],
    );
  }
}

class _Kpi extends StatelessWidget {
  const _Kpi(this.label, this.value, this.colors);
  final String label, value;
  final StatusPair colors;
  @override
  Widget build(BuildContext context) => Expanded(
    child: Card(
      color: colors.container,
      margin: const EdgeInsets.symmetric(horizontal: 2),
      child: Padding(
        padding: const EdgeInsets.all(Space.s),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: Theme.of(context).textTheme.labelSmall
                  ?.copyWith(color: colors.onContainer),
            ),
            const SizedBox(height: Space.xs),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                value,
                style: Theme.of(context).textTheme.titleLarge
                    ?.copyWith(color: colors.onContainer),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

const myTaskRoleLabels = {
  'ACCOUNTABLE': 'Accountable',
  'ASSIGNEE': 'Assignee',
  'REVIEWER': 'Reviewer',
};

class _TaskRow extends ConsumerWidget {
  const _TaskRow({
    required this.task,
    required this.view,
    required this.running,
  });
  final MyTask task;
  final String view;
  final bool running;

  String _sub() {
    final parts = <String>[task.project.name];
    if (view == 'today') {
      parts.add(
        task.section == 'AGING' ? 'Age ${task.ageDays ?? 0}d' : 'Planned today',
      );
    } else {
      // D26: cards show Planned (before Due) and the caller's role.
      if (task.plannedStart != null) {
        parts.add('Planned ${shortDate(task.plannedStart!)}');
      }
    }
    if (view != 'today' && task.dueDate != null) {
      parts.add(
        task.overdue
            ? '${task.daysLate}d late'
            : 'Due ${shortDate(task.dueDate!)}',
      );
    }
    final role = myTaskRoleLabels[task.role];
    return '${parts.join(' · ')}${role == null ? '' : '\nRole: $role'}';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sc = context.statusColors;
    final status = TaskStatus.fromApi(task.status);
    final open = status != TaskStatus.done && status != TaskStatus.cancelled;
    return ListTile(
      key: Key('myTask_${task.id}'),
      onTap: () => context.push('/tasks/${task.id}'),
      title: Text(task.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(_sub(), maxLines: 2, overflow: TextOverflow.ellipsis),
      trailing: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 132),
        child: running
            ? StatusChip(
                key: Key('runningChip_${task.id}'),
                label: 'Running',
                colors: sc.done,
              )
            : view == 'today' && open
            ? Semantics(
                label: 'Time in on ${task.name}',
                button: true,
                excludeSemantics: true,
                child: OutlinedButton.icon(
                  key: Key('timeIn_${task.id}'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 40),
                  ),
                  icon: const Icon(Icons.play_arrow_outlined, size: 18),
                  label: const FitLabel('Time in'),
                  onPressed: () => timeInOnTask(context, ref, task.id),
                ),
              )
            : TaskStatusChip(status),
      ),
    );
  }
}
