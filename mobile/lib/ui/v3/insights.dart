// P3 50–53: Home portfolio (GET /dashboard), My projects (GET /dashboard/my-projects),
// Team & workload (GET /workload), Reports viewer (GET /reports/:name). View only; no export.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/p3.dart';
import '../../state/p3_providers.dart';
import '../../state/providers.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';
import 'issues.dart';

const healthLabels = {
  'ON_TRACK': 'On track',
  'AT_RISK': 'At risk',
  'DELAYED': 'Delayed',
  'ON_HOLD': 'On hold',
};

StatusPair healthColors(BuildContext c, String? h) {
  final sc = c.statusColors;
  return switch (h) {
    'ON_TRACK' => sc.done,
    'AT_RISK' => sc.forReview,
    'DELAYED' => sc.blocked,
    _ => sc.todo,
  };
}

String _num(Object? n) {
  if (n is! num) return '–';
  return n == n.roundToDouble() ? '${n.toInt()}' : n.toStringAsFixed(1);
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value, this.colors, {super.key});
  final String label, value;
  final StatusPair colors;
  @override
  Widget build(BuildContext context) => Card(
    color: colors.container,
    child: Padding(
      padding: const EdgeInsets.all(Space.m),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.labelMedium
                ?.copyWith(color: colors.onContainer),
          ),
          const SizedBox(height: Space.s),
          Text(
            value,
            style: Theme.of(context).textTheme.headlineMedium
                ?.copyWith(color: colors.onContainer),
          ),
        ],
      ),
    ),
  );
}

/// Two per row, one per row at large text.
class StatGrid extends StatelessWidget {
  const StatGrid({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final cols = MediaQuery.textScalerOf(context).scale(10) > 15 ? 1 : 2;
    return Column(
      children: [
        for (var i = 0; i < children.length; i += cols)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var j = i; j < i + cols; j++)
                  Expanded(
                    child: j < children.length ? children[j] : const SizedBox(),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// Home › Portfolio (design 50). Filters are applied on the client: GET /dashboard takes no filters.
class PortfolioSection extends ConsumerStatefulWidget {
  const PortfolioSection({super.key});
  @override
  ConsumerState<PortfolioSection> createState() => _PortfolioSectionState();
}

class _PortfolioSectionState extends ConsumerState<PortfolioSection> {
  String? _client, _health;
  @override
  Widget build(BuildContext context) {
    final dash = ref.watch(portfolioProvider);
    final waiting = ref.watch(waitingOnClientProvider).value ?? const <Json>[];
    final t = Theme.of(context).textTheme;
    final sc = context.statusColors;
    final s = Theme.of(context).colorScheme;
    return AsyncView(
      value: dash,
      onRetry: () => ref.invalidate(portfolioProvider),
      data: (d) {
        final all = jsonList(d['activeProjects']);
        final projects = all
            .where((p) => _client == null || refId(p['client']) == _client)
            .where((p) => _health == null || p['health'] == _health)
            .toList();
        final ids = {for (final p in projects) p['id']};
        final filtered = _client != null || _health != null;
        final k = (d['kpis'] as Map?) ?? const {};
        final iss = (d['issues'] as Map?) ?? const {};
        final sev = (iss['bySeverity'] as Map?) ?? const {};
        final miles = jsonList(d['upcomingMilestones'])
            .where((m) => !filtered || ids.contains(refId(m['project'])))
            .toList();
        final wait = jsonList(d['waitingOnClient'])
            .where((m) => !filtered || ids.contains(refId(m['project'])))
            .toList();
        final docs = waiting
            .where((w) => !filtered || ids.contains(refId(w['project'])))
            .toList();
        final clients = {
          for (final p in all)
            '${refId(p['client'])}': '${refName(p['client'])}',
        };
        return Padding(
          key: const Key('portfolio'),
          padding: const EdgeInsets.symmetric(horizontal: Space.m),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Portfolio', style: t.titleMedium),
              const SizedBox(height: Space.s),
              Wrap(
                spacing: Space.s,
                runSpacing: Space.s,
                children: [
                  _menu(
                    'dashClientFilter',
                    _client == null ? 'All clients' : clients[_client]!,
                    {null: 'All clients', ...clients},
                    (v) => _client = v,
                  ),
                  _menu(
                    'dashHealthFilter',
                    _health == null ? 'All health' : healthLabels[_health]!,
                    {null: 'All health', ...healthLabels},
                    (v) => _health = v,
                  ),
                ],
              ),
              const SizedBox(height: Space.s),
              StatGrid(
                children: [
                  _Stat(
                    'Active projects',
                    filtered ? '${projects.length}' : _num(k['activeProjects']),
                    StatusPair(s.primaryContainer, s.onPrimaryContainer),
                    key: const Key('dashActive'),
                  ),
                  _Stat(
                    'Delayed',
                    filtered
                        ? '${projects.where((p) => p['health'] == 'DELAYED').length}'
                        : _num(k['delayedProjects']),
                    sc.blocked,
                  ),
                  _Stat(
                    'Waiting on client',
                    '${wait.length + docs.length}',
                    sc.forReview,
                    key: const Key('dashWaiting'),
                  ),
                  _Stat('Open issues', _num(iss['open']), sc.inProgress),
                ],
              ),
              const SizedBox(height: Space.m),
              Text('Active projects', style: t.titleSmall),
              Card(
                child: Column(
                  children: [
                    if (projects.isEmpty)
                      const ListTile(title: Text('No active projects')),
                    for (final p in projects)
                      ListTile(
                        key: Key('dashProject_${p['id']}'),
                        title: Text('${p['name']}'),
                        subtitle: Text(
                          [
                            refName(p['client']),
                            p['projectType'] ?? 'Type not set',
                            '${p['progress']}%',
                          ].join(' · '),
                        ),
                        trailing: StatusChip(
                          label: healthLabels[p['health']] ?? '${p['health']}',
                          colors: healthColors(context, p['health'] as String?),
                        ),
                        onTap: () => context.go('/projects/${p['id']}'),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: Space.m),
              Text('Upcoming milestones', style: t.titleSmall),
              Card(
                key: const Key('dashMilestones'),
                child: Column(
                  children: [
                    if (miles.isEmpty)
                      const ListTile(
                        title: Text('No milestones in the next 30 days'),
                      ),
                    for (final m in miles)
                      ListTile(
                        title: Text('${m['name']}'),
                        subtitle: Text(
                          '${refName(m['client'])} · ${shortYmd(m['dueDate'])}',
                        ),
                        onTap: () =>
                            context.go('/projects/${refId(m['project'])}'),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: Space.m),
              Text('Waiting on client', style: t.titleSmall),
              Card(
                key: const Key('dashWaitingList'),
                child: Column(
                  children: [
                    if (wait.isEmpty && docs.isEmpty)
                      const ListTile(
                        title: Text('Nothing is waiting on a client.'),
                      ),
                    for (final w in wait)
                      ListTile(
                        leading: const Icon(Icons.hourglass_bottom),
                        title: Text('${w['name']}'),
                        subtitle: Text(
                          [
                            refName(w['project']),
                            if (w['contact'] != null) refName(w['contact']),
                            if (w['daysOverdue'] != null)
                              '${w['daysOverdue']} days overdue',
                          ].join(' · '),
                        ),
                        onTap: () => context.push('/tasks/${w['id']}'),
                      ),
                    for (final w in docs)
                      ListTile(
                        key: Key('waitingDoc_${w['id']}'),
                        leading: const Icon(Icons.description_outlined),
                        title: Text('${w['name']}'),
                        subtitle: Text(
                          [
                            refName(w['project']),
                            if (refName(w['requestedFrom']) != null)
                              'from ${refName(w['requestedFrom'])}',
                            if (w['dueDate'] != null)
                              'due ${shortYmd(w['dueDate'])}',
                            if (w['overdue'] == true) 'Overdue',
                          ].join(' · '),
                        ),
                        onTap: () => context.push(
                          '/projects/${refId(w['project'])}/documents',
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: Space.m),
              Text('Open by severity', style: t.titleSmall),
              Card(
                key: const Key('dashSeverity'),
                child: Padding(
                  padding: const EdgeInsets.all(Space.m),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: Space.s,
                        runSpacing: 4,
                        children: [
                          for (final e in issueSeverityLabels.entries)
                            StatusChip(
                              label: '${e.value} ${_num(sev[e.key] ?? 0)}',
                              colors: severityColors(context, e.key),
                            ),
                        ],
                      ),
                      const SizedBox(height: Space.s),
                      Text(
                        'Avg. days to resolve: ${_num(iss['avgDaysToResolve'])}',
                        style: t.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
              if (d['myProjects'] == true)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    key: const Key('dashMyProjects'),
                    onPressed: () => context.push('/insights'),
                    child: const Text('My projects, workload and reports'),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _menu(
    String key,
    String label,
    Map<String?, String> items,
    void Function(String?) on,
  ) => PopupMenuButton<String?>(
    key: Key(key),
    tooltip: label,
    onSelected: (v) => setState(() => on(v == '' ? null : v)),
    itemBuilder: (_) => [
      for (final e in items.entries)
        PopupMenuItem(value: e.key ?? '', child: Text(e.value)),
    ],
    child: Chip(label: Text(label), avatar: const Icon(Icons.arrow_drop_down)),
  );
}

/// More › Insights: My projects (not for Members: /dashboard/my-projects is 403) |
/// Team & workload (workload.view) | Reports (reports.view).
class InsightsScreen extends ConsumerWidget {
  const InsightsScreen({super.key, this.initialTab});
  final String? initialTab;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(authProvider).value?.systemRole;
    final tabs = <(String, String, Widget)>[
      if (role != 'MEMBER' && canW(ref, 'reports', 'view'))
        ('projects', 'My projects', const MyProjectsView()),
      if (canW(ref, 'workload', 'view'))
        ('workload', 'Team & workload', const WorkloadView()),
      if (canW(ref, 'reports', 'view'))
        ('reports', 'Reports', const ReportsView()),
    ];
    if (tabs.isEmpty) {
      return Scaffold(
        key: const Key('insightsScreen'),
        appBar: AppBar(
          leading: const BackOrUpButton(fallback: '/more'),
          title: const Text('Insights'),
        ),
        body: const Center(child: Text('Nothing to show for your role.')),
      );
    }
    final i = tabs.indexWhere((t) => t.$1 == initialTab);
    return DefaultTabController(
      key: ValueKey('insights-${tabs.length}-$initialTab'),
      length: tabs.length,
      initialIndex: i < 0 ? 0 : i,
      child: Scaffold(
        key: const Key('insightsScreen'),
        appBar: AppBar(
          leading: const BackOrUpButton(fallback: '/more'),
          title: Text(
            tabs.map((t) => t.$2).join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              for (final t in tabs)
                Tab(key: Key('insightsTab_${t.$1}'), text: t.$2),
            ],
          ),
        ),
        body: TabBarView(children: [for (final t in tabs) t.$3]),
      ),
    );
  }
}

class MyProjectsView extends ConsumerStatefulWidget {
  const MyProjectsView({super.key});
  @override
  ConsumerState<MyProjectsView> createState() => _MyProjectsViewState();
}

class _MyProjectsViewState extends ConsumerState<MyProjectsView> {
  String _sort = 'late';
  @override
  Widget build(BuildContext context) => AsyncView(
    value: ref.watch(myProjectsReportProvider),
    onRetry: () => ref.invalidate(myProjectsReportProvider),
    data: (rows) {
      final list = [...rows]
        ..sort(
          (a, b) => _sort == 'late'
              ? ((b['daysLate'] as num?) ?? 0).compareTo(
                  (a['daysLate'] as num?) ?? 0,
                )
              : '${a['name']}'.compareTo('${b['name']}'),
        );
      return ListView(
        key: const Key('myProjectsList'),
        padding: const EdgeInsets.all(Space.m),
        children: [
          Wrap(
            spacing: Space.s,
            children: [
              ChoiceChip(
                key: const Key('sortLate'),
                label: const Text('Most days late'),
                selected: _sort == 'late',
                onSelected: (_) => setState(() => _sort = 'late'),
              ),
              ChoiceChip(
                key: const Key('sortName'),
                label: const Text('Name'),
                selected: _sort == 'name',
                onSelected: (_) => setState(() => _sort = 'name'),
              ),
            ],
          ),
          const SizedBox(height: Space.s),
          if (list.isEmpty)
            const Padding(
              padding: EdgeInsets.all(Space.m),
              child: Text(
                'Projects you manage show here.',
                key: Key('myProjectsEmpty'),
              ),
            ),
          for (final p in list) _MyProjectCard(p),
        ],
      );
    },
  );
}

class _MyProjectCard extends StatelessWidget {
  const _MyProjectCard(this.p);
  final Json p;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final late = (p['daysLate'] as num?) ?? 0;
    final fu = (p['followUps'] as Map?) ?? const {};
    final people = jsonList(fu['people']), contacts = jsonList(fu['contacts']);
    return Card(
      key: Key('myProject_${p['id']}'),
      child: Padding(
        padding: const EdgeInsets.all(Space.m),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${p['name']}', style: t.titleSmall),
            Text(
              '${refName(p['client'])} · ${p['progress']}% complete',
              style: t.bodySmall,
            ),
            const SizedBox(height: Space.s),
            Wrap(
              spacing: Space.s,
              runSpacing: 4,
              children: [
                StatusChip(
                  label: healthLabels[p['health']] ?? '${p['health']}',
                  colors: healthColors(context, p['health'] as String?),
                ),
                if (late > 0)
                  StatusChip(
                    label: '${_num(late)} ${late == 1 ? 'day' : 'days'} late',
                    colors: context.statusColors.blocked,
                  ),
              ],
            ),
            const SizedBox(height: Space.s),
            Text(
              [
                '${p['overdueTasks']} overdue',
                '${p['blockedTasks']} blocked',
                '${p['openCriticalHighIssues']} Critical/High issues',
                '${p['waitingOnClient']} waiting on client',
              ].join(' · '),
              style: t.bodySmall,
            ),
            if (people.isNotEmpty || contacts.isNotEmpty) ...[
              const SizedBox(height: Space.s),
              Text('Follow up', style: t.labelLarge),
              for (final x in people)
                Text(
                  '• ${refName(x['person'])}: ${x['overdue']} overdue${(x['aging'] ?? 0) > 0 ? ', ${x['aging']} aging' : ''}',
                  style: t.bodySmall,
                ),
              for (final x in contacts)
                Text(
                  '• ${refName(x['contact'])} (client): ${x['overdueTasks']} tasks, ${x['overdueDocuments']} documents overdue',
                  style: t.bodySmall,
                ),
            ],
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => context.go('/projects/${p['id']}'),
                child: const Text('Open project'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class WorkloadView extends ConsumerStatefulWidget {
  const WorkloadView({super.key});
  @override
  ConsumerState<WorkloadView> createState() => _WorkloadViewState();
}

class _WorkloadViewState extends ConsumerState<WorkloadView> {
  String? _team;
  @override
  Widget build(BuildContext context) {
    final teams = ref.watch(workloadTeamsProvider).value ?? const <Json>[];
    return _build(context, teams);
  }

  Widget _build(BuildContext context, List<Json> teams) => AsyncView(
    value: ref.watch(workloadProvider(_team)),
    onRetry: () => ref.invalidate(workloadProvider(_team)),
    data: (rows) {
      final t = Theme.of(context).textTheme;
      if (rows.isEmpty) {
        return const Center(
          child: Text('No one to show', key: Key('workloadEmpty')),
        );
      }
      return ListView(
        key: const Key('workloadList'),
        padding: const EdgeInsets.all(Space.m),
        children: [
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: Space.s,

            children: [
              Text('This week', style: t.titleSmall),
              PopupMenuButton<String>(
                key: const Key('workloadTeamFilter'),
                tooltip: 'Team',
                onSelected: (v) => setState(() => _team = v.isEmpty ? null : v),
                itemBuilder: (_) => [
                  const PopupMenuItem(value: '', child: Text('All teams')),
                  for (final tm
                      in (ref.watch(workloadTeamsProvider).value ??
                          const <Json>[]))
                    PopupMenuItem(
                      value: '${tm['id']}',
                      child: Text('${tm['name']}'),
                    ),
                ],
                child: Chip(
                  avatar: const Icon(Icons.arrow_drop_down),
                  label: Text(
                    _team == null
                        ? 'All teams'
                        : '${teams.where((x) => x['id'] == _team).firstOrNull?['name'] ?? 'Team'}',
                  ),
                ),
              ),
            ],
          ),
          for (final r in rows)
            Card(
              key: Key('workload_${refId(r['person'])}'),
              child: Padding(
                padding: const EdgeInsets.all(Space.m),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        InitialsAvatar(refName(r['person']) ?? '?'),
                        const SizedBox(width: Space.s),
                        Expanded(
                          child: Text(
                            '${refName(r['person'])}\n${r['jobRole'] ?? ''}',
                            style: t.bodyMedium,
                          ),
                        ),
                      ],
                    ),
                    if (r['overAssigned'] == true) ...[
                      const SizedBox(height: Space.s),
                      StatusChip(
                        label: 'Over capacity',
                        colors: context.statusColors.blocked,
                      ),
                    ],
                    const SizedBox(height: Space.s),
                    if ((r['capacityHours'] as num? ?? 0) == 0)
                      Text(
                        'No capacity set · Assigned ${_num(r['assignedHours'])}h',
                        style: t.bodySmall,
                      )
                    else ...[
                      LinearProgressIndicator(
                        value: (((r['assignedPct'] as num?) ?? 0) / 100)
                            .clamp(0, 1)
                            .toDouble(),
                        color: r['overAssigned'] == true
                            ? context.statusColors.blocked.onContainer
                            : null,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Capacity ${_num(r['capacityHours'])}h · Assigned ${_num(r['assignedHours'])}h (${_num(r['assignedPct'])}%) · Utilization ${r['utilizationPct'] == null ? '–' : '${_num(r['utilizationPct'])}%'}',
                        style: t.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
            ),
        ],
      );
    },
  );
}

class ReportsView extends StatelessWidget {
  const ReportsView({super.key});
  @override
  Widget build(BuildContext context) => ListView(
    key: const Key('reportsList'),
    padding: const EdgeInsets.all(Space.m),
    children: [
      Card(
        child: Column(
          children: [
            for (final e in reportNames.entries)
              ListTile(
                key: Key('report_${e.key}'),
                leading: const Icon(Icons.table_chart_outlined),
                title: Text(e.value),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/reports/${e.key}'),
              ),
          ],
        ),
      ),
      const SizedBox(height: Space.m),
      Text(
        'View only. Exports and advanced filters are on the web app.',
        style: Theme.of(context).textTheme.bodySmall,
      ),
    ],
  );
}

class ReportScreen extends ConsumerWidget {
  const ReportScreen({super.key, required this.name});
  final String name;

  ({String title, String sub, String? trailing, String? link}) _row(
    Json r,
  ) => switch (name) {
    'project-status' => (
      title: '${r['name']}',
      sub: [
        refName(r['client']),
        r['projectType'] ?? 'Type not set',
        healthLabels[r['health']] ?? r['health'],
        '${r['progress']}%',
        'Forecast ${shortYmd(r['forecastEnd'])}',
        '${r['overdueTasks']} overdue',
        '${r['pendingClientItems']} pending client items',
      ].join(' · '),
      trailing: (r['varianceDays'] ?? 0) > 0 ? '+${r['varianceDays']}d' : null,
      link: '/projects/${r['id']}',
    ),
    'effort-variance' => (
      title: refName(r['task']) ?? '${r['name'] ?? ''}',
      sub:
          '${refName(r['project']) ?? ''} · Est ${_num(r['estHours'])}h · Actual ${_num(r['actualHours'])}h',
      trailing:
          '${((r['varianceHours'] as num?) ?? 0) > 0 ? '+' : ''}${_num(r['varianceHours'])}h',
      link: null,
    ),
    'overdue' => (
      title: '${r['name']}',
      sub: [
        refName(r['project']),
        refName(r['owner']),
        'due ${shortYmd(r['dueDate'])}',
        if (r['party'] == 'CLIENT') 'Client',
      ].whereType<String>().join(' · '),
      trailing: r['daysOverdue'] == null ? null : '${r['daysOverdue']}d',
      link: '/tasks/${r['id']}',
    ),
    'issues' => (
      title: '${r['key']} · ${r['title']}',
      sub: [
        refName(r['project']),
        issueSeverityLabels[r['severity']],
        issueStatusLabels[r['status']] ?? r['status'],
        if (r['overdue'] == true) 'Overdue',
      ].whereType<String>().join(' · '),
      trailing: null,
      link: '/issues/${r['id']}',
    ),
    _ => (
      title: '${refName(r['user']) ?? ''} · ${shortYmd(r['workDate'])}',
      sub: [
        refName(r['project']),
        refName(r['task']),
        r['type'],
        r['note'],
      ].whereType<String>().join(' · '),
      trailing: '${_num(r['hours'])}h',
      link: null,
    ),
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    key: const Key('reportScreen'),
    appBar: AppBar(
      leading: const BackOrUpButton(fallback: '/insights?tab=reports'),
      title: Text(reportNames[name] ?? 'Report'),
    ),
    body: AsyncView(
      value: ref.watch(reportProvider(name)),
      onRetry: () => ref.invalidate(reportProvider(name)),
      data: (body) {
        final rows = jsonList(body['items']);
        final totals = body['totals'] as Map?;
        return ListView(
          key: const Key('reportRows'),
          padding: const EdgeInsets.all(Space.m),
          children: [
            if (rows.isEmpty)
              const Padding(
                padding: EdgeInsets.all(Space.m),
                child: Text('Nothing to report', key: Key('reportEmpty')),
              ),
            if (rows.isNotEmpty)
              Card(
                child: Column(
                  children: [
                    for (final r in rows)
                      Builder(
                        builder: (context) {
                          final x = _row(r);
                          return ListTile(
                            title: Text(x.title),
                            subtitle: Text(x.sub),
                            trailing: x.trailing == null
                                ? null
                                : Text(x.trailing!),
                            onTap: x.link == null
                                ? null
                                : () => context.push(x.link!),
                          );
                        },
                      ),
                  ],
                ),
              ),
            if (totals != null)
              Padding(
                padding: const EdgeInsets.only(top: Space.s),
                child: Text(
                  'Total ${_num(totals['all'])}h',
                  key: const Key('reportTotal'),
                ),
              ),
            const SizedBox(height: Space.m),
            Text(
              'View only. Exports and advanced filters are on the web app.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        );
      },
    ),
  );
}

/// Home › documents requested from me (GET /document-requests/mine). Hidden when empty.
class MyDocRequests extends ConsumerWidget {
  const MyDocRequests({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(myDocRequestsProvider).value ?? const <Json>[];
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      key: const Key('myDocRequests'),
      padding: const EdgeInsets.fromLTRB(Space.m, 0, Space.m, Space.m),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Documents requested from you',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          Card(
            child: Column(
              children: [
                for (final d in items)
                  ListTile(
                    key: Key('myDocRequest_${d['id']}'),
                    leading: const Icon(Icons.pending_actions),
                    title: Text('${d['name']}'),
                    subtitle: Text(
                      [
                        refName(d['project']),
                        if (refName(d['requestedBy']) != null)
                          'by ${refName(d['requestedBy'])}',
                        'due ${shortYmd(d['dueDate'])}',
                        if (d['overdue'] == true) 'Overdue',
                      ].whereType<String>().join(' · '),
                    ),
                    onTap: () => context.push(
                      '/projects/${refId(d['project'])}/documents',
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
