import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config.dart';
import '../../data/models.dart';
import '../../data/p3.dart';
import '../../data/ph_time.dart';
import '../../state/p3_providers.dart';
import '../v3/insights.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../../state/v2_providers.dart';
import '../widgets/brand.dart';
import '../widgets/common.dart';
import '../widgets/kpi.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).value;
    final dash = ref.watch(dashboardProvider);
    final projects = ref.watch(projectsProvider);
    final unread =
        ref.watch(notificationsProvider).value?.where((n) => !n.read).length ??
        0;
    final hour = ref.watch(clockProvider)().hour;
    final greet = hour < 12
        ? 'Good morning'
        : (hour < 18 ? 'Good afternoon' : 'Good evening');
    final first = (user?.name ?? '').split(' ').first;
    final s = Theme.of(context).colorScheme;
    final sc = context.statusColors;

    return Scaffold(
      key: const Key('homeScreen'),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(myTasksProvider);
          ref.invalidate(projectsProvider);
          ref.invalidate(dashboardProvider);
          ref.invalidate(notificationsProvider);
          ref.invalidate(portfolioProvider);
          ref.invalidate(waitingOnClientProvider);
        },
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              pinned: true,
              leading: const Padding(
                padding: EdgeInsets.all(14),
                child: BrandIcon(),
              ),
              title: Text(first.isEmpty ? greet : '$greet, $first'),
              actions: [
                IconButton(
                  key: const Key('notificationsButton'),
                  tooltip: 'Notifications',
                  onPressed: () => context.push('/notifications'),
                  icon: Badge(
                    isLabelVisible: unread > 0,
                    label: Text('$unread', textScaler: TextScaler.noScaling),
                    child: const Icon(Icons.notifications_outlined),
                  ),
                ),
              ],
            ),
            SliverToBoxAdapter(
              child: AsyncView(
                value: dash,
                onRetry: () => ref.invalidate(dashboardProvider),
                data: (d) => Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: Space.m),
                      child: KpiGrid(
                        children: [
                          KpiCard(
                            'Open tasks',
                            '${d.open}',
                            s.primaryContainer,
                            s.onPrimaryContainer,
                          ),
                          KpiCard(
                            'Blocked',
                            '${d.blocked}',
                            sc.blocked.container,
                            sc.blocked.onContainer,
                          ),
                          KpiCard(
                            'Due this week',
                            '${d.dueThisWeek}',
                            sc.forReview.container,
                            sc.forReview.onContainer,
                          ),
                          if (d.hours != null && canW(ref, 'time', 'view'))
                            KpiCard(
                              'Logged this week',
                              fmtHours(d.hours!),
                              sc.inProgress.container,
                              sc.inProgress.onContainer,
                            ),
                        ],
                      ),
                    ),
                    SectionHeader(
                      'Due soon',
                      trailing: TextButton(
                        onPressed: () => context.go('/tasks'),
                        child: const Text('See all'),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: Space.m),
                      child: Card(
                        child: Column(
                          children: [
                            if (d.dueSoon.isEmpty)
                              const ListTile(
                                title: Text('Nothing due this week 🎉'),
                              ),
                            for (final t in d.dueSoon) TaskTile(t),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (canW(ref, 'reports', 'view'))
              const SliverToBoxAdapter(child: PortfolioSection()),
            const SliverToBoxAdapter(child: SectionHeader('My projects')),
            SliverToBoxAdapter(
              child: AsyncView(
                value: projects,
                data: (list) => Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.m,
                    0,
                    Space.m,
                    Space.l,
                  ),
                  child: Card(
                    child: Column(
                      children: [
                        for (final p in list.where(
                          (p) => p.status == ProjectStatus.active,
                        ))
                          ListTile(
                            onTap: () => context.go('/projects/${p.id}'),
                            title: Text(p.name),
                            subtitle: Padding(
                              padding: const EdgeInsets.only(top: Space.s),
                              child: LinearProgressIndicator(
                                value: p.progress / 100,
                                borderRadius: BorderRadius.circular(4),
                              ),
                            ),
                            trailing: Text('${p.progress.round()}%'),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Compact task row used on Home and My tasks.
class TaskTile extends StatelessWidget {
  const TaskTile(this.task, {super.key});
  final Task task;
  @override
  Widget build(BuildContext context) => ListTile(
    key: Key('taskTile_${task.id}'),
    onTap: () => context.push('/tasks/${task.id}'),
    title: Text(task.name, maxLines: 1, overflow: TextOverflow.ellipsis),
    subtitle: Text(
      [
        task.projectName,
        task.phase?.split(' · ').first,
        if (task.dueDate != null) fmtDate(task.dueDate),
      ].whereType<String>().where((e) => e.isNotEmpty).join(' · '),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    ),
    trailing: TaskStatusChip(task.status),
  );
}

class MyTasksScreen extends ConsumerStatefulWidget {
  const MyTasksScreen({super.key});
  @override
  ConsumerState<MyTasksScreen> createState() => _MyTasksScreenState();
}

class _MyTasksScreenState extends ConsumerState<MyTasksScreen> {
  TaskStatus? _filter;
  @override
  Widget build(BuildContext context) {
    final tasks = ref.watch(myTasksProvider);
    return Scaffold(
      key: const Key('tasksScreen'),
      appBar: AppBar(title: const Text('My tasks')),
      body: Column(
        children: [
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: Space.m),
              children: [
                for (final s in [null, ...TaskStatus.board.take(4)])
                  Padding(
                    padding: const EdgeInsets.only(right: Space.s),
                    child: FilterChip(
                      label: Text(s?.label ?? 'All'),
                      selected: _filter == s,
                      onSelected: (_) => setState(() => _filter = s),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: AsyncView(
              value: tasks,
              onRetry: () => ref.invalidate(myTasksProvider),
              data: (list) {
                final shown = list
                    .where((t) => _filter == null || t.status == _filter)
                    .toList();
                if (shown.isEmpty) {
                  return const Center(child: Text('No tasks here.'));
                }
                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(myTasksProvider),
                  child: ListView.separated(
                    itemCount: shown.length,
                    separatorBuilder: (_, _) =>
                        const Divider(indent: Space.m, endIndent: Space.m),
                    itemBuilder: (_, i) => TaskTile(shown[i]),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final today = ref.watch(clockProvider)();
    return Scaffold(
      key: const Key('notificationsScreen'),
      appBar: AppBar(
        leading: const BackOrUpButton(fallback: '/home'),
        title: const Text('Notifications'),
        actions: [
          TextButton(
            key: const Key('markAllRead'),
            onPressed: () async {
              await ref.read(notificationRepositoryProvider).markAllRead();
              ref.invalidate(notificationsProvider);
            },
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: AsyncView(
        value: ref.watch(notificationsProvider),
        onRetry: () => ref.invalidate(notificationsProvider),
        data: (list) {
          bool isToday(AppNotification n) =>
              n.at.year == today.year &&
              n.at.month == today.month &&
              n.at.day == today.day;
          final groups = {
            'Today': list.where(isToday).toList(),
            'Earlier': list.where((n) => !isToday(n)).toList(),
          };
          return ListView(
            children: [
              for (final g in groups.entries)
                if (g.value.isNotEmpty) ...[
                  SectionHeader(g.key),
                  for (final n in g.value)
                    ListTile(
                      key: Key('notification_${n.id}'),
                      onTap: notificationTarget(n) == null
                          ? null
                          : () => openNotification(context, ref, n),
                      leading: InitialsAvatar(n.title),
                      title: Text(
                        n.title,
                        style: TextStyle(
                          fontWeight: n.read
                              ? FontWeight.w400
                              : FontWeight.w600,
                        ),
                      ),
                      subtitle: Text(n.subtitle),
                      trailing: n.read
                          ? null
                          : CircleAvatar(
                              radius: 4,
                              backgroundColor: Theme.of(context)
                                  .colorScheme
                                  .primary,
                            ),
                    ),
                ],
            ],
          );
        },
      ),
    );
  }
}

class IssuesList extends ConsumerStatefulWidget {
  const IssuesList({super.key, this.projectId});
  final String? projectId;
  @override
  ConsumerState<IssuesList> createState() => _IssuesListState();
}

class _IssuesListState extends ConsumerState<IssuesList> {
  String _filter = 'Open';
  @override
  Widget build(BuildContext context) {
    final sc = context.statusColors;
    return AsyncView(
      value: ref.watch(issuesProvider(widget.projectId)),
      onRetry: () => ref.invalidate(issuesProvider(widget.projectId)),
      data: (all) {
        final open = all.where((i) => i.isOpen).length;
        final shown = all.where(
          (i) => switch (_filter) {
            'Open' => i.isOpen,
            'Closed' => !i.isOpen,
            'Mine' => i.ownerName != null && i.isOpen,
            _ =>
              i.isOpen &&
                  (i.severity == Priority.high ||
                      i.severity == Priority.critical),
          },
        );
        return Column(
          children: [
            SizedBox(
              height: 52,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.all(Space.s),
                child: Row(
                  children: [
                    for (final f in ['Open', 'Mine', 'High', 'Closed'])
                      Padding(
                        padding: const EdgeInsets.only(right: Space.s),
                        child: FilterChip(
                          label: Text(f == 'Open' ? 'Open $open' : f),
                          selected: _filter == f,
                          onSelected: (_) => setState(() => _filter = f),
                        ),
                      ),
                    if (canW(ref, 'issues', 'create'))
                      ActionChip(
                        key: const Key('raiseIssue'),
                        avatar: const Icon(Icons.add, size: 18),
                        label: const Text('Raise issue'),
                        onPressed: () => context.push(
                          widget.projectId == null
                              ? '/issues/new'
                              : '/projects/${widget.projectId}/issues/new',
                        ),
                      ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: Space.m),
                children: [
                  for (final i in shown)
                    Padding(
                      padding: const EdgeInsets.only(bottom: Space.s),
                      child: Card(
                        clipBehavior: Clip.antiAlias,
                        child: IntrinsicHeight(
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Container(
                                width: 4,
                                color: sc.forPriority(i.severity).onContainer,
                              ),
                              Expanded(
                                child: ListTile(
                                  key: Key('issue_${i.id}'),
                                  onTap: () => context.push('/issues/${i.id}'),
                                  title: Text(i.title),
                                  subtitle: Text(
                                    [
                                      i.projectName,
                                      i.key,
                                      i.ownerName,
                                    ].whereType<String>().join(' · '),
                                  ),
                                  trailing: Text(
                                    issueStatusLabels[i.status] ?? i.status,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class IssuesScreen extends StatelessWidget {
  const IssuesScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    key: const Key('issuesScreen'),
    appBar: AppBar(
      leading: const BackOrUpButton(fallback: '/more'),
      title: const Text('Issues'),
    ),
    body: const IssuesList(),
  );
}

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).value;
    final mode = ref.watch(themeModeProvider);
    final unread =
        ref.watch(notificationsProvider).value?.where((n) => !n.read).length ??
        0;
    final s = Theme.of(context).colorScheme;
    return Scaffold(
      key: const Key('moreScreen'),
      appBar: AppBar(
        leading: const Padding(padding: EdgeInsets.all(14), child: BrandIcon()),
        title: const Text('More'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(Space.m),
        children: [
          Card(
            color: s.secondaryContainer,
            child: ListTile(
              leading: InitialsAvatar(user?.name ?? '?', radius: 22),
              title: Text(
                user?.name ?? '',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(user?.role ?? ''),
              trailing: const Icon(Icons.chevron_right),
              key: const Key('moreProfile'),
              onTap: () => context.push('/profile'),
            ),
          ),
          const SizedBox(height: Space.m),
          Card(
            child: Column(
              children: [
                if (canW(ref, 'activities', 'view'))
                  ListTile(
                    key: const Key('moreDar'),
                    leading: const Icon(Icons.summarize_outlined),
                    title: const Text('Daily Accomplishment Report'),
                    onTap: () => context.push('/dar'),
                  ),
                if (canW(ref, 'activities', 'view'))
                  ListTile(
                    key: const Key('moreSavedReports'),
                    leading: const Icon(Icons.bookmarks_outlined),
                    title: const Text('My saved reports'),
                    onTap: () => context.push('/dar/saved'),
                  ),
                if (canW(ref, 'leave', 'view'))
                  ListTile(
                    key: const Key('moreLeave'),
                    leading: const Icon(Icons.beach_access_outlined),
                    title: const Text('Leave'),
                    onTap: () => context.push('/leave'),
                  ),
                if (canW(ref, 'activities', 'view') &&
                    (ref.watch(trackerPeopleProvider).value?.length ?? 0) > 1)
                  ListTile(
                    key: const Key('moreTimesheetReview'),
                    leading: const Icon(Icons.fact_check_outlined),
                    title: const Text('Timesheet review'),
                    onTap: () => context.push('/timesheet-review'),
                  ),
                if (canW(ref, 'issues', 'view'))
                  ListTile(
                    key: const Key('moreIssues'),
                    leading: const Icon(Icons.bug_report_outlined),
                    title: const Text('Issues'),
                    subtitle: Text(
                      '${ref.watch(issuesProvider(null)).value?.where((i) => i.isOpen).length ?? '…'} open',
                      key: const Key('moreIssuesCount'),
                    ),
                    onTap: () => context.push('/issues'),
                  ),
                if (canW(ref, 'clients', 'view'))
                  ListTile(
                    key: const Key('moreClients'),
                    leading: const Icon(Icons.business_outlined),
                    title: const Text('Clients'),
                    subtitle: const Text('Contacts & projects'),
                    onTap: () => context.push('/clients'),
                  ),
                if (canW(ref, 'reports', 'view'))
                  ListTile(
                    key: const Key('moreInsights'),
                    leading: const Icon(Icons.insights_outlined),
                    title: const Text('Team & workload · Reports'),
                    onTap: () => context.push('/insights'),
                  ),
                ListTile(
                  leading: const Icon(Icons.notifications_outlined),
                  title: const Text('Notifications'),
                  subtitle: Text('$unread unread'),
                  onTap: () => context.push('/notifications'),
                ),
              ],
            ),
          ),
          const SizedBox(height: Space.m),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.dark_mode_outlined),
                  title: const Text('Appearance'),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: Space.s),
                    child: SegmentedButton<ThemeMode>(
                      key: const Key('appearanceToggle'),
                      showSelectedIcon: false,
                      segments: const [
                        ButtonSegment(
                          value: ThemeMode.system,
                          label: Text('System'),
                        ),
                        ButtonSegment(
                          value: ThemeMode.light,
                          label: Text('Light'),
                        ),
                        ButtonSegment(
                          value: ThemeMode.dark,
                          label: Text('Dark'),
                        ),
                      ],
                      selected: {mode},
                      onSelectionChanged: (v) =>
                          ref.read(themeModeProvider.notifier).set(v.first),
                    ),
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.lock_outline),
                  key: const Key('moreChangePassword'),
                  title: const Text('Change password'),
                  onTap: () => context.push('/change-password'),
                ),
                ListTile(
                  key: const Key('adminTools'),
                  leading: const Icon(Icons.open_in_new),
                  title: const Text('Admin tools'),
                  subtitle: const Text(
                    'Users, Teams, Settings, Project types, Leave types, Access rules, Audit log, Templates · opens web',
                  ),
                  onTap: () => _openWeb(context, '/admin'),
                ),
              ],
            ),
          ),
          const SizedBox(height: Space.l),
          OutlinedButton(
            key: const Key('signOut'),
            style: OutlinedButton.styleFrom(foregroundColor: s.error),
            onPressed: () => ref.read(authProvider.notifier).logout(),
            child: const Text('Sign out'),
          ),
          const SizedBox(height: Space.l),
          Text(
            Brand.footer,
            key: const Key('brandFooter'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall
                ?.copyWith(color: s.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  Future<void> _openWeb(BuildContext context, String path) async {
    final ok = await launchUrl(
      Uri.parse('${AppConfig.webAppUrl}$path'),
      mode: LaunchMode.externalApplication,
    );
    if (!ok && context.mounted) {
      showError(context, 'Could not open the web app.');
    }
  }
}

/// 2-column KPI grid whose rows grow with text scale (no fixed aspect ratio).
/// Where a notification opens in the app. Web links from the API are mapped to mobile routes.
String? notificationTarget(AppNotification n) {
  if (n.taskId != null) return '/tasks/${n.taskId}';
  if (n.issueId != null) return '/issues/${n.issueId}';
  final l = n.link;
  if (l == null) return null;
  final u = Uri.parse(l);
  return switch (u.path) {
    '/my-tasks' when u.queryParameters['tab'] == 'day' => '/day',
    '/my-tasks' => '/tasks',
    '/leave' => l,
    '/timesheets/review' => '/timesheet-review',
    _ => null,
  };
}

void openNotification(BuildContext context, WidgetRef ref, AppNotification n) {
  final target = notificationTarget(n);
  if (target == null) return;
  final date = n.link == null
      ? null
      : Uri.parse(n.link!).queryParameters['date'];
  if (target == '/day') {
    if (date != null) {
      ref.read(selectedDayProvider.notifier).set(parseYmd(date));
    }
    ref.read(dayModeProvider.notifier).set(DayMode.day);
    context.go('/day');
    return;
  }
  context.push(target);
}
