import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config.dart';
import '../../data/models.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).value;
    final dash = ref.watch(dashboardProvider);
    final projects = ref.watch(projectsProvider);
    final unread = ref.watch(notificationsProvider).value?.where((n) => !n.read).length ?? 0;
    final hour = ref.watch(clockProvider)().hour;
    final greet = hour < 12 ? 'Good morning' : (hour < 18 ? 'Good afternoon' : 'Good evening');
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
        },
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              pinned: true,
              title: Text(first.isEmpty ? greet : '$greet, $first'),
              actions: [
                IconButton(
                  key: const Key('notificationsButton'),
                  tooltip: 'Notifications',
                  onPressed: () => context.push('/notifications'),
                  icon: Badge(
                    isLabelVisible: unread > 0,
                    label: Text('$unread'),
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
                      child: GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        mainAxisSpacing: Space.s,
                        crossAxisSpacing: Space.s,
                        childAspectRatio: 1.7,
                        children: [
                          _Kpi('Open tasks', '${d.open}', s.primaryContainer, s.onPrimaryContainer),
                          _Kpi('Blocked', '${d.blocked}', sc.blocked.container, sc.blocked.onContainer),
                          _Kpi(
                            'Due this week',
                            '${d.dueThisWeek}',
                            sc.forReview.container,
                            sc.forReview.onContainer,
                          ),
                          _Kpi(
                            'Hours this week',
                            fmtHours(d.hours),
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
                            if (d.dueSoon.isEmpty) const ListTile(title: Text('Nothing due this week 🎉')),
                            for (final t in d.dueSoon) TaskTile(t),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SectionHeader('My projects')),
            SliverToBoxAdapter(
              child: AsyncView(
                value: projects,
                data: (list) => Padding(
                  padding: const EdgeInsets.fromLTRB(Space.m, 0, Space.m, Space.l),
                  child: Card(
                    child: Column(
                      children: [
                        for (final p in list.where((p) => p.status == ProjectStatus.active))
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

class _Kpi extends StatelessWidget {
  const _Kpi(this.label, this.value, this.bg, this.fg);
  final String label, value;
  final Color bg, fg;
  @override
  Widget build(BuildContext context) => Card(
    color: bg,
    child: Padding(
      padding: const EdgeInsets.all(Space.m),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: fg)),
          Text(value, style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: fg)),
        ],
      ),
    ),
  );
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
                final shown = list.where((t) => _filter == null || t.status == _filter).toList();
                if (shown.isEmpty) return const Center(child: Text('No tasks here.'));
                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(myTasksProvider),
                  child: ListView.separated(
                    itemCount: shown.length,
                    separatorBuilder: (_, _) => const Divider(indent: Space.m, endIndent: Space.m),
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
        data: (list) {
          bool isToday(AppNotification n) =>
              n.at.year == today.year && n.at.month == today.month && n.at.day == today.day;
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
                      onTap: n.taskId == null ? null : () => context.push('/tasks/${n.taskId}'),
                      leading: InitialsAvatar(n.title),
                      title: Text(
                        n.title,
                        style: TextStyle(fontWeight: n.read ? FontWeight.w400 : FontWeight.w600),
                      ),
                      subtitle: Text(n.subtitle),
                      trailing: n.read
                          ? null
                          : CircleAvatar(radius: 4, backgroundColor: Theme.of(context).colorScheme.primary),
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
      data: (all) {
        final open = all.where((i) => i.isOpen).length;
        final shown = all.where(
          (i) => switch (_filter) {
            'Open' => i.isOpen,
            'Closed' => !i.isOpen,
            'Mine' => i.ownerName != null && i.isOpen,
            _ => i.isOpen && (i.severity == Priority.high || i.severity == Priority.critical),
          },
        );
        return Column(
          children: [
            SizedBox(
              height: 52,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.all(Space.s),
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
                ],
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
                              Container(width: 4, color: sc.forPriority(i.severity).onContainer),
                              Expanded(
                                child: ListTile(
                                  title: Text(i.title),
                                  subtitle: Text(
                                    [i.projectName, i.key, i.ownerName].whereType<String>().join(' · '),
                                  ),
                                  trailing: Text(i.status.replaceAll('_', ' ').toLowerCase()),
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
    appBar: AppBar(title: const Text('Issues')),
    body: const IssuesList(),
  );
}

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).value;
    final mode = ref.watch(themeModeProvider);
    final unread = ref.watch(notificationsProvider).value?.where((n) => !n.read).length ?? 0;
    final s = Theme.of(context).colorScheme;
    return Scaffold(
      key: const Key('moreScreen'),
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        padding: const EdgeInsets.all(Space.m),
        children: [
          Card(
            color: s.secondaryContainer,
            child: ListTile(
              leading: InitialsAvatar(user?.name ?? '?', radius: 22),
              title: Text(user?.name ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(user?.role ?? ''),
              trailing: const Icon(Icons.chevron_right),
            ),
          ),
          const SizedBox(height: Space.m),
          Card(
            child: Column(
              children: [
                ListTile(
                  key: const Key('moreIssues'),
                  leading: const Icon(Icons.bug_report_outlined),
                  title: const Text('Issues'),
                  onTap: () => context.push('/issues'),
                ),
                ListTile(
                  leading: const Icon(Icons.business_outlined),
                  title: const Text('Clients'),
                  subtitle: const Text('Contacts & projects (web)'),
                  onTap: () => _openWeb(context, '/clients'),
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
                        ButtonSegment(value: ThemeMode.system, label: Text('System')),
                        ButtonSegment(value: ThemeMode.light, label: Text('Light')),
                        ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
                      ],
                      selected: {mode},
                      onSelectionChanged: (v) => ref.read(themeModeProvider.notifier).set(v.first),
                    ),
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.lock_outline),
                  title: const Text('Change password'),
                  onTap: () => _openWeb(context, '/profile'),
                ),
                ListTile(
                  key: const Key('adminTools'),
                  leading: const Icon(Icons.open_in_new),
                  title: const Text('Admin tools'),
                  subtitle: const Text('Users, teams, access rules · opens web'),
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
        ],
      ),
    );
  }

  Future<void> _openWeb(BuildContext context, String path) async {
    final ok = await launchUrl(
      Uri.parse('${AppConfig.webAppUrl}$path'),
      mode: LaunchMode.externalApplication,
    );
    if (!ok && context.mounted) showError(context, 'Could not open the web app.');
  }
}
