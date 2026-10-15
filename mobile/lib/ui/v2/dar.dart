import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/ph_time.dart';
import '../../data/tracker_models.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

/// No export/share on mobile (decision d): PDF/Excel stay on the web app.
class DarGenerateScreen extends ConsumerStatefulWidget {
  const DarGenerateScreen({super.key});
  @override
  ConsumerState<DarGenerateScreen> createState() => _DarGenerateScreenState();
}

class _DarGenerateScreenState extends ConsumerState<DarGenerateScreen> {
  late DateTime _from = mondayOf(ref.read(todayPhProvider));
  late DateTime _to = ref.read(todayPhProvider);
  (String, String)? _err;
  DarReport? _report;
  bool _busy = false;

  Future<void> _pick(bool from) async {
    final today = ref.read(todayPhProvider);
    final d = await showDatePicker(
      context: context,
      initialDate: from ? _from : _to,
      firstDate: DateTime(today.year - 2),
      lastDate: today,
    );
    if (d != null) {
      setState(() {
        from ? _from = d : _to = d;
        _err = null;
        _report = null;
      });
    }
  }

  Future<void> _preview() async {
    final e = validateDarRange(_from, _to);
    setState(() => _err = e);
    if (e != null) return;
    setState(() => _busy = true);
    try {
      final r = await ref.read(darRepositoryProvider).generate(_from, _to);
      if (mounted) setState(() => _report = r);
    } on ApiException catch (e) {
      if (mounted) {
        setState(
          () => _err = e.fields.isNotEmpty
              ? (e.fields.keys.first, e.fields.values.first)
              : ('', e.message),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final s = Theme.of(context).colorScheme;
    final sc = context.statusColors;
    final today = ref.watch(todayPhProvider);
    final r = _report;
    return Scaffold(
      key: const Key('darGenerateScreen'),
      appBar: AppBar(
        leading: const BackOrUpButton(fallback: '/day'),
        title: const Text('Daily Accomplishment Report'),
        actions: [
          IconButton(
            key: const Key('openSavedReports'),
            tooltip: 'My saved reports',
            icon: const Icon(Icons.bookmarks_outlined),
            onPressed: () => context.push('/dar/saved'),
          ),
        ],
      ),
      body: ListView(
        key: const Key('darGenerateList'),
        padding: const EdgeInsets.all(Space.m),
        children: [
          Row(
            children: [
              Expanded(
                child: _DateField(
                  key: const Key('darFrom'),
                  label: 'From',
                  value: _from,
                  error: _err?.$1 == 'from' ? _err!.$2 : null,
                  onTap: () => _pick(true),
                ),
              ),
              const SizedBox(width: Space.s),
              Expanded(
                child: _DateField(
                  key: const Key('darTo'),
                  label: 'To',
                  value: _to,
                  error: _err?.$1 == 'to' ? _err!.$2 : null,
                  onTap: () => _pick(false),
                ),
              ),
            ],
          ),
          if (_err != null && _err!.$1 == '')
            Text(_err!.$2, style: TextStyle(color: s.error)),
          const SizedBox(height: Space.s),
          Wrap(
            spacing: Space.s,
            runSpacing: Space.s,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              ActionChip(
                key: const Key('darToday'),
                label: const Text('Today'),
                onPressed: () => setState(() {
                  _from = today;
                  _to = today;
                  _err = null;
                  _report = null;
                }),
              ),
              FilledButton(
                key: const Key('darPreview'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: _busy ? null : _preview,
                child: const Text('Preview'),
              ),
            ],
          ),
          const SizedBox(height: Space.m),
          if (r != null) ...[
            Card(
              child: Column(
                children: [
                  ListTile(
                    title: const Text('To'),
                    subtitle: Text(
                      r.supervisor == null
                          ? '—'
                          : '${r.supervisor} (supervisor)',
                    ),
                    trailing: const Chip(label: Text('Set by Admin')),
                  ),
                  const Divider(indent: Space.m, endIndent: Space.m),
                  ListTile(
                    title: const Text('CC'),
                    subtitle: Text(r.cc.isEmpty ? '—' : r.cc.join(', ')),
                    trailing: const Chip(label: Text('Set by Admin')),
                  ),
                ],
              ),
            ),
            const SizedBox(height: Space.s),
            Card(
              key: const Key('darSendDisabled'),
              color: s.surfaceContainerHighest,
              child: Padding(
                padding: const EdgeInsets.all(Space.m),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Chip(
                      label: const Text('Coming with Microsoft sign-in'),
                      backgroundColor: s.surfaceContainerLow,
                    ),
                    const SizedBox(height: Space.xs),
                    Text(
                      'Sending to your supervisor is coming with Microsoft sign-in.',
                      style: t.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: Space.m),
            Text(
              'Day status in this range (not part of the report):',
              style: t.labelMedium,
            ),
            const SizedBox(height: Space.xs),
            Wrap(
              key: const Key('darDayStrip'),
              spacing: Space.xs,
              runSpacing: Space.xs,
              children: [
                for (final d in r.days)
                  StatusChip(
                    label:
                        '${shortDate(d.date)} ${d.leave != null ? '· ${d.leave}' : d.status}',
                    colors: switch (d.status) {
                      'Submitted' => sc.done,
                      'Reopened' => sc.forReview,
                      _ => sc.blocked,
                    },
                  ),
              ],
            ),
            const SizedBox(height: Space.m),
            if (r.rows.isEmpty)
              Card(
                key: const Key('darEmpty'),
                child: ListTile(
                  title: const Text('No time entries in this range'),
                  trailing: TextButton(
                    onPressed: () => context.go('/tasks'),
                    child: const Text('My tasks › Today'),
                  ),
                ),
              )
            else ...[
              FilledButton.tonal(
                key: const Key('darOpenPreview'),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => DarPreviewScreen(report: r),
                  ),
                ),
                child: Text(
                  'Open preview · ${r.totalActivities} activities · ${r.totalRendered}',
                ),
              ),
              const SizedBox(height: Space.s),
              SaveReportButton(from: r.from, to: r.to),
            ],
          ],
          const SizedBox(height: Space.s),
          TextButton(
            key: const Key('viewSavedReports'),
            onPressed: () => context.push('/dar/saved'),
            child: const Text('View saved reports'),
          ),
        ],
      ),
    );
  }
}

class SaveReportButton extends ConsumerWidget {
  const SaveReportButton({super.key, required this.from, required this.to});
  final DateTime from, to;
  @override
  Widget build(BuildContext context, WidgetRef ref) => FilledButton.icon(
    key: const Key('darSave'),
    icon: const Icon(Icons.save_outlined),
    label: const Text('Save report'),
    onPressed: () async {
      try {
        await ref.read(darRepositoryProvider).save(from, to);
        ref.invalidate(savedReportsProvider);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('Report saved'),
              action: SnackBarAction(
                label: 'View',
                onPressed: () => context.push('/dar/saved'),
              ),
            ),
          );
        }
      } catch (e) {
        if (context.mounted) showError(context, e);
      }
    },
  );
}

class _DateField extends StatelessWidget {
  const _DateField({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.error,
  });
  final String label;
  final DateTime value;
  final String? error;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        errorText: error,
        errorMaxLines: 3,
      ),
      child: Text(longDate(value)),
    ),
  );
}

/// Preview (25/26): cards in portrait, DataTable in landscape. Read-only, no export.
class DarPreviewScreen extends StatelessWidget {
  const DarPreviewScreen({super.key, required this.report, this.saved});
  final DarReport report;
  final SavedReport? saved;

  @override
  Widget build(BuildContext context) {
    final r = report;
    final t = Theme.of(context).textTheme;
    final s = Theme.of(context).colorScheme;
    final landscape =
        MediaQuery.orientationOf(context) == Orientation.landscape;
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Daily Accomplishment Report', style: t.titleLarge),
        Text(
          '${r.userName} · Generated range: ${longDate(r.from)} to ${longDate(r.shownTo ?? r.to)}',
          style: t.bodySmall,
        ),
        Text(
          'Total Activities: ${r.totalActivities}',
          key: const Key('darTotalActivities'),
          style: t.titleSmall,
        ),
      ],
    );
    final footer = [
      Card(
        key: const Key('darTotalRendered'),
        color: s.primaryContainer,
        child: ListTile(
          title: const Text('Total rendered hours'),
          trailing: Text(
            r.totalRendered,
            style: t.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
      ),
      Center(
        child: Padding(
          padding: const EdgeInsets.all(Space.s),
          child: Text(
            'Generated by ${r.exportName}.',
            key: const Key('darFooter'),
            style: t.bodySmall,
          ),
        ),
      ),
    ];
    return Scaffold(
      key: const Key('darPreviewScreen'),
      appBar: AppBar(title: Text(saved == null ? 'Preview' : 'Saved report')),
      body: ListView(
        key: const Key('darPreviewList'),
        padding: const EdgeInsets.all(Space.m),
        children: [
          header,
          const SizedBox(height: Space.m),
          if (landscape)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                key: const Key('darTable'),
                columns: [
                  for (final c in [
                    'Date',
                    'Time In',
                    'Time Out',
                    'Rendered Hrs',
                    'Client Name',
                    'Project Name',
                    'Activity Type',
                    'Location',
                    'Billable',
                    'Module',
                    'Activity Remarks',
                  ])
                    DataColumn(label: Text(c)),
                ],
                rows: [
                  for (final row in r.rows)
                    DataRow(
                      cells: [
                        DataCell(Text(shortDate(row.date))),
                        if (row.leave) ...[
                          DataCell(Text(leaveLabel(row))),
                          for (var i = 0; i < 9; i++) const DataCell(Text('')),
                        ] else ...[
                          DataCell(Text(row.timeIn)),
                          DataCell(Text(row.timeOut)),
                          DataCell(Text(row.rendered)),
                          DataCell(Text(row.client)),
                          DataCell(Text(row.project)),
                          DataCell(Text(row.activityType)),
                          DataCell(Text(row.location)),
                          DataCell(Text(row.billable)),
                          DataCell(Text(row.module)),
                          DataCell(Text(row.remarks)),
                        ],
                      ],
                    ),
                ],
              ),
            )
          else
            for (final row in r.rows)
              Card(
                color: row.leave ? s.surfaceContainerHighest : null,
                child: Padding(
                  padding: const EdgeInsets.all(Space.m - 4),
                  child: row.leave
                      ? Text(
                          '${shortDate(row.date)} · ${leaveLabel(row)}',
                          style: t.titleSmall,
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${shortDate(row.date)} · ${row.timeIn.isEmpty ? 'Hours only' : '${row.timeIn} – ${row.timeOut}'}',
                                    style: t.labelLarge,
                                  ),
                                ),
                                Text(
                                  row.rendered,
                                  style: t.labelLarge?.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                            Text(row.remarks, style: t.titleSmall),
                            Text(
                              [
                                row.client,
                                row.project,
                              ].where((x) => x.isNotEmpty).join(' · '),
                              style: t.bodySmall,
                            ),
                            Text(
                              [
                                row.activityType,
                                row.location,
                                'Billable ${row.billable}',
                              ].where((x) => x.isNotEmpty).join(' · '),
                              style: t.bodySmall,
                            ),
                            if (row.module.isNotEmpty)
                              Text(row.module, style: t.bodySmall),
                          ],
                        ),
                ),
              ),
          ...footer,
          if (saved == null) SaveReportButton(from: r.from, to: r.to),
        ],
      ),
    );
  }
}

/// Saved list (28).
class SavedReportsScreen extends ConsumerStatefulWidget {
  const SavedReportsScreen({super.key});
  @override
  ConsumerState<SavedReportsScreen> createState() => _SavedReportsScreenState();
}

class _SavedReportsScreenState extends ConsumerState<SavedReportsScreen> {
  DateTime? _from, _to;

  Future<void> _pick(bool from) async {
    final today = ref.read(todayPhProvider);
    final d = await showDatePicker(
      context: context,
      firstDate: DateTime(today.year - 2),
      lastDate: today,
    );
    setState(() => from ? _from = d : _to = d);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final sc = context.statusColors;
    final list = ref.watch(savedReportsProvider((_from, _to)));
    final filtered = _from != null || _to != null;
    return Scaffold(
      key: const Key('savedReportsScreen'),
      appBar: AppBar(
        leading: const BackOrUpButton(fallback: '/dar'),
        title: const Text('My saved reports'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Space.m),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    key: const Key('savedFrom'),
                    onPressed: () => _pick(true),
                    child: Text(
                      'Saved from ${_from == null ? '—' : shortDate(_from!)}',
                    ),
                  ),
                ),
                const SizedBox(width: Space.s),
                Expanded(
                  child: OutlinedButton(
                    key: const Key('savedTo'),
                    onPressed: () => _pick(false),
                    child: Text('To ${_to == null ? '—' : shortDate(_to!)}'),
                  ),
                ),
                if (filtered)
                  IconButton(
                    tooltip: 'Clear filters',
                    icon: const Icon(Icons.close),
                    onPressed: () => setState(() => _from = _to = null),
                  ),
              ],
            ),
          ),
          Expanded(
            child: AsyncView(
              value: list,
              data: (items) => items.isEmpty
                  ? Center(
                      key: const Key('savedEmpty'),
                      child: Text(
                        filtered
                            ? 'No saved reports match these filters'
                            : 'No saved reports yet',
                        style: t.titleMedium,
                      ),
                    )
                  : ListView(
                      padding: const EdgeInsets.all(Space.m),
                      children: [
                        for (final r in items)
                          Card(
                            key: Key('savedReport_${r.id}'),
                            child: ListTile(
                              onTap: () => context.push('/dar/saved/${r.id}'),
                              title: Text(
                                '${shortDate(r.from)} – ${longDate(r.to)}',
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Saved ${phDateTime(r.savedAt)} · ${r.totalActivities} activities · ${r.totalRendered}',
                                  ),
                                  const SizedBox(height: 4),
                                  Wrap(
                                    spacing: Space.xs,
                                    children: [
                                      if (r.tag == 'LATEST')
                                        StatusChip(
                                          label: 'Latest',
                                          colors: sc.done,
                                        ),
                                      if (r.tag == 'EARLIER')
                                        StatusChip(
                                          label: 'Earlier version',
                                          colors: sc.todo,
                                        ),
                                      if (r.changedDates.isNotEmpty)
                                        StatusChip(
                                          label: 'Changed after saving',
                                          colors: sc.forReview,
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                              trailing: const Icon(Icons.chevron_right),
                            ),
                          ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Saved detail (29): read-only snapshot.
class SavedReportDetailScreen extends ConsumerWidget {
  const SavedReportDetailScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    final sc = context.statusColors;
    return AsyncView(
      value: ref.watch(savedReportProvider(id)),
      onRetry: () => ref.invalidate(savedReportProvider(id)),
      data: (sr) {
        final r = sr.report!;
        return Scaffold(
          key: const Key('savedReportDetail'),
          appBar: AppBar(
            leading: const BackOrUpButton(fallback: '/dar/saved'),
            title: const Text('Saved report'),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: Space.m),
                child: StatusChip(label: 'Read-only', colors: sc.todo),
              ),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.all(Space.m),
            children: [
              Text(
                'Saved copy from ${phDateTime(sr.savedAt)}. Later changes to your entries don’t change it.',
                key: const Key('savedCopyNote'),
                style: t.bodyMedium,
              ),
              for (final d in sr.changedDates)
                Card(
                  color: sc.forReview.container,
                  child: Padding(
                    padding: const EdgeInsets.all(Space.m),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${shortDate(d)} was changed after this was saved',
                        ),
                        const SizedBox(height: Space.s),
                        SaveReportButton(from: sr.from, to: sr.to),
                      ],
                    ),
                  ),
                ),
              if (r.exportName != 'OpsTrack')
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: Space.s),
                  child: Text(
                    'Saved before the app was renamed to OpsTrack (Oct 10, 2026), so this copy keeps the old name in '
                    'its footer, exactly as it was saved.',
                    key: const Key('oldNameNote'),
                    style: t.bodySmall,
                  ),
                ),
              const SizedBox(height: Space.s),
              Text('Daily Accomplishment Report', style: t.titleLarge),
              Text(
                'Generated range: ${longDate(r.from)} to ${longDate(r.shownTo ?? r.to)}',
                style: t.bodySmall,
              ),
              Text(
                'Total Activities: ${r.totalActivities}',
                style: t.titleSmall,
              ),
              const SizedBox(height: Space.s),
              for (final row in r.rows)
                Card(
                  child: ListTile(
                    title: Text(row.leave ? leaveLabel(row) : row.remarks),
                    subtitle: Text(
                      row.leave
                          ? shortDate(row.date)
                          : '${shortDate(row.date)} · ${row.timeIn} – ${row.timeOut} · ${row.project.isEmpty ? 'Quick activity' : row.project}',
                    ),
                    trailing: Text(row.rendered),
                  ),
                ),
              ListTile(
                title: const Text('Total rendered hours'),
                trailing: Text(r.totalRendered, style: t.titleMedium),
              ),
              Center(
                child: Text(
                  'Generated by ${r.exportName}.',
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

/// The server's leave label (services/dar.ts puts it in `remarks`), e.g. "Half day leave (AM)".
String leaveLabel(DarRow row) => row.remarks.isEmpty ? 'On leave' : row.remarks;
