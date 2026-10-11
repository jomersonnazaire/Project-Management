import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/ph_time.dart';
import '../../data/tracker_models.dart';
import '../../state/providers.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';
import 'day_dialogs.dart';
import 'entry_sheet.dart';

/// Day timesheet tab: the same widget/state as My tasks › Day timesheet, with Day | Hours list inside.
class DayTimesheetScreen extends ConsumerWidget {
  const DayTimesheetScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    key: const Key('dayTimesheetScreen'),
    appBar: AppBar(
      title: const Text('Day timesheet'),
      actions: const [DayTimesheetActions()],
    ),
    body: const DayTimesheetBody(showSegment: true),
  );
}

/// App bar actions: DAR and overflow (team review).
class DayTimesheetActions extends ConsumerWidget {
  const DayTimesheetActions({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final people = ref.watch(trackerPeopleProvider).value ?? const [];
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          key: const Key('openDar'),
          tooltip: 'Daily Accomplishment Report',
          icon: const Icon(Icons.summarize_outlined),
          onPressed: () => context.push('/dar'),
        ),
        PopupMenuButton<String>(
          key: const Key('dayOverflow'),
          tooltip: 'More options',
          onSelected: (v) => context.push(v),
          itemBuilder: (_) => [
            const PopupMenuItem(
              value: '/dar/saved',
              child: Text('My saved reports'),
            ),
            if (people.length > 1)
              const PopupMenuItem(
                value: '/timesheet-review',
                child: Text('Review your team’s timesheets'),
              ),
          ],
        ),
      ],
    );
  }
}

class DayTimesheetBody extends ConsumerWidget {
  const DayTimesheetBody({super.key, this.showSegment = true});
  final bool showSegment;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(dayModeProvider);
    return Column(
      children: [
        if (showSegment)
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.m, 0, Space.m, Space.s),
            child: SizedBox(
              width: double.infinity,
              child: SegmentedButton<DayMode>(
                key: const Key('daySegment'),
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: DayMode.day, label: FitLabel('Day')),
                  ButtonSegment(
                    value: DayMode.hours,
                    label: FitLabel('Hours list', key: Key('hoursListSegment')),
                  ),
                ],
                selected: {mode},
                onSelectionChanged: (v) =>
                    ref.read(dayModeProvider.notifier).set(v.first),
              ),
            ),
          ),
        Expanded(
          child: mode == DayMode.day || !showSegment
              ? const DayView()
              : const HoursListView(),
        ),
      ],
    );
  }
}

/// The day view (own, editable) or someone else's day (review, read-only + Reopen).
class DayView extends ConsumerWidget {
  const DayView({super.key, this.userId, this.reviewName});
  final String? userId;
  final String? reviewName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final date = ref.watch(selectedDayProvider);
    final today = ref.watch(todayPhProvider);
    final value = ref.watch(dayTimesheetProvider((date, userId)));
    ref.watch(tickerProvider);
    final now = ref.read(nowProvider)();
    final t = Theme.of(context).textTheme;
    final s = Theme.of(context).colorScheme;
    final sc = context.statusColors;

    Future<void> pickDate() async {
      final d = await showDatePicker(
        context: context,
        initialDate: date,
        firstDate: DateTime(today.year - 1),
        lastDate: today,
      );
      if (d != null) ref.read(selectedDayProvider.notifier).set(d);
    }

    final header = Padding(
      padding: const EdgeInsets.symmetric(horizontal: Space.s),
      child: Row(
        children: [
          IconButton.outlined(
            key: const Key('prevDay'),
            tooltip: 'Previous day',
            icon: const Icon(Icons.chevron_left),
            onPressed: () => ref
                .read(selectedDayProvider.notifier)
                .set(date.subtract(const Duration(days: 1))),
          ),
          IconButton.outlined(
            key: const Key('nextDay'),
            tooltip: 'Next day',
            icon: const Icon(Icons.chevron_right),
            onPressed: date.isBefore(today)
                ? () => ref
                      .read(selectedDayProvider.notifier)
                      .set(date.add(const Duration(days: 1)))
                : null,
          ),
          const SizedBox(width: Space.xs),
          Expanded(
            child: Text(
              longDay(date),
              key: const Key('dayTitle'),
              style: t.titleMedium,
              maxLines: 2,
            ),
          ),
          IconButton(
            key: const Key('pickDate'),
            tooltip: 'Pick a date',
            icon: const Icon(Icons.calendar_month_outlined),
            onPressed: pickDate,
          ),
        ],
      ),
    );

    return Column(
      children: [
        header,
        Expanded(
          child: AsyncView(
            value: value,
            onRetry: () => ref.invalidate(dayTimesheetProvider((date, userId))),
            data: (day) {
              final running = day.runningEntry;
              final entries = [...day.entries]
                ..sort((a, b) => a.running ? -1 : (b.running ? 1 : 0));
              final short = shortDate(day.date);
              final isToday = day.date == today;
              return RefreshIndicator(
                onRefresh: () async => invalidateTracker(ref),
                child: SingleChildScrollView(
                  key: const Key('dayTimesheet'),
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(
                    Space.m,
                    Space.s,
                    Space.m,
                    Space.xl,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Wrap(
                        spacing: Space.s,
                        runSpacing: Space.xs,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          _Chip(
                            key: const Key('locationChip'),
                            icon: Icons.place_outlined,
                            label: day.location?.name ?? 'Location not set',
                            colors: sc.inProgress,
                          ),
                          if (day.canEdit && day.own)
                            TextButton(
                              key: const Key('changeLocation'),
                              onPressed: () =>
                                  changeDayLocation(context, ref, day),
                              child: const Text('Change'),
                            ),
                          DayStatusBadge(day: day),
                          if (day.leave != null)
                            _Chip(
                              key: const Key('leaveChip'),
                              label: day.leave!,
                              colors: sc.planning,
                            ),
                        ],
                      ),
                      const SizedBox(height: Space.s),
                      for (final r in day.reopened)
                        _Banner(
                          key: const Key('reopenedBanner'),
                          colors: sc.forReview,
                          text:
                              '↺ Reopened by ${r.by} on ${phDateTime(r.at)} · Reason: "${r.reason}"',
                        ),
                      if (day.status == DayStatus.submitted &&
                          day.submittedAt != null)
                        _Banner(
                          key: const Key('submittedBanner'),
                          colors: sc.done,
                          text:
                              '✓ Submitted ${phDateTime(day.submittedAt!)} · entries locked',
                        ),
                      if (day.notSubmitted)
                        _Banner(
                          key: const Key('lockedBanner'),
                          colors: sc.todo,
                          text:
                              "🔒 $short wasn't submitted. It was locked as it stood at the weekly lock.",
                        ),
                      if (day.own &&
                          (day.canEdit || day.canSubmit || day.canReopen))
                        Wrap(
                          spacing: Space.s,
                          runSpacing: Space.s,
                          children: [
                            if (day.canEdit)
                              OutlinedButton.icon(
                                key: const Key('addEntry'),
                                icon: const Icon(Icons.add, size: 18),
                                label: const Text('Add entry'),
                                onPressed: () async {
                                  if (await showEntrySheet(
                                    context,
                                    mode: EntryMode.add,
                                    date: day.date,
                                  )) {
                                    invalidateTracker(ref);
                                  }
                                },
                              ),
                            if (day.own &&
                                ref
                                        .watch(permissionsProvider)
                                        .value?['leave']?['create'] !=
                                    false)
                              OutlinedButton.icon(
                                key: const Key('addLeave'),
                                icon: const Icon(Icons.add, size: 18),
                                label: const Text('Add leave'),
                                onPressed: () => showError(
                                  context,
                                  'Recording leave is coming in the next update (P2). Use the web app for now.',
                                ),
                              ),
                            if (day.canSubmit)
                              FilledButton(
                                key: const Key('submitDay'),
                                style: FilledButton.styleFrom(
                                  minimumSize: const Size(0, 40),
                                ),
                                onPressed: running != null
                                    ? null
                                    : () => submitDay(context, ref, day),
                                child: Text(
                                  isToday ? 'Submit day' : 'Submit $short',
                                ),
                              ),
                            if (day.canReopen)
                              OutlinedButton(
                                key: const Key('reopenDay'),
                                onPressed: () => reopenDay(context, ref, day),
                                child: Text(
                                  'Reopen day…${day.weekLocked ? ' (Admin)' : ''}',
                                ),
                              ),
                          ],
                        ),
                      if (!day.own && day.canReopen)
                        Align(
                          alignment: Alignment.centerLeft,
                          child: OutlinedButton(
                            key: const Key('reopenDay'),
                            onPressed: () => reopenDay(context, ref, day),
                            child: Text(
                              'Reopen day…${day.weekLocked ? ' (Admin)' : ''}',
                            ),
                          ),
                        ),
                      if (day.canSubmit && running != null)
                        Padding(
                          padding: const EdgeInsets.only(top: Space.xs),
                          child: Text(
                            'Stop the running timer before submitting this day.',
                            key: const Key('stopFirstHelper'),
                            style: t.bodySmall?.copyWith(
                              color: sc.forReview.onContainer,
                            ),
                          ),
                        ),
                      if (day.own && !day.canEdit && day.weekLocked)
                        _Banner(
                          colors: sc.todo,
                          icon: Icons.lock_outline,
                          text: 'Locked. Ask an Admin to reopen this day.',
                        ),
                      const SizedBox(height: Space.m),
                      for (final l in day.leaveRows)
                        Card(
                          key: Key('leaveRow_${l.id}'),
                          color: s.surfaceContainerHighest,
                          child: ListTile(
                            leading: const Icon(Icons.wb_sunny_outlined),
                            title: Text(l.label),
                            textColor: s.onSurfaceVariant,
                          ),
                        ),
                      if (entries.isEmpty && day.leaveRows.isEmpty)
                        Padding(
                          key: const Key('dayEmpty'),
                          padding: const EdgeInsets.symmetric(
                            vertical: Space.xl,
                          ),
                          child: Column(
                            children: [
                              Icon(
                                Icons.event_note_outlined,
                                size: 40,
                                color: s.outline,
                              ),
                              const SizedBox(height: Space.s),
                              Text(
                                'No entries on $short',
                                style: t.titleMedium,
                              ),
                              const SizedBox(height: Space.xs),
                              Text(
                                day.canEdit
                                    ? 'Add an entry (asks for the day’s location first).'
                                    : 'Nothing was logged this day.',
                                textAlign: TextAlign.center,
                                style: t.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      for (final e in entries)
                        EntryCard(entry: e, day: day, now: now),
                      const SizedBox(height: Space.s),
                      Card(
                        key: const Key('hoursRendered'),
                        color: s.primaryContainer,
                        child: Padding(
                          padding: const EdgeInsets.all(Space.m),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Hours rendered',
                                      style: t.titleSmall?.copyWith(
                                        color: s.onPrimaryContainer,
                                      ),
                                    ),
                                    Text(
                                      'Sum of the day’s entries (exact minutes; a running timer counts up to now)',
                                      style: t.bodySmall?.copyWith(
                                        color: s.onPrimaryContainer,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                formatHHMM(day.totalAt(now)),
                                key: const Key('hoursRenderedValue'),
                                style: t.headlineSmall?.copyWith(
                                  color: s.onPrimaryContainer,
                                  fontFeatures: const [
                                    FontFeature.tabularFigures(),
                                  ],
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: Space.s),
                      Text(
                        'Submit day locks the day’s entries; before the weekly lock your supervisor or an Admin can '
                        'reopen it with a reason. After the weekly lock only an Admin can reopen a day.',
                        style: t.bodySmall,
                      ),
                      if (day.own &&
                          (ref.watch(trackerPeopleProvider).value?.length ??
                                  0) >
                              1)
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton(
                            key: const Key('reviewTeamLink'),
                            onPressed: () => context.push('/timesheet-review'),
                            child: const Text('Review your team’s timesheets'),
                          ),
                        ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class DayStatusBadge extends StatelessWidget {
  const DayStatusBadge({super.key, required this.day});
  final TrackerDay day;
  @override
  Widget build(BuildContext context) {
    final sc = context.statusColors;
    return switch (day.status) {
      DayStatus.submitted => _Chip(
        key: const Key('dayStatusBadge'),
        label: '✓ Submitted',
        colors: sc.done,
      ),
      DayStatus.reopened => _Chip(
        key: const Key('dayStatusBadge'),
        label: 'Reopened',
        colors: sc.forReview,
      ),
      DayStatus.open => _Chip(
        key: const Key('dayStatusBadge'),
        label: 'Not submitted',
        colors: day.notSubmitted ? sc.blocked : sc.todo,
      ),
    };
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    super.key,
    required this.label,
    required this.colors,
    this.icon,
  });
  final String label;
  final StatusPair colors;
  final IconData? icon;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: colors.container,
      borderRadius: BorderRadius.circular(8),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 14, color: colors.onContainer),
          const SizedBox(width: 4),
        ],
        Flexible(
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelMedium
                ?.copyWith(color: colors.onContainer),
          ),
        ),
      ],
    ),
  );
}

class _Banner extends StatelessWidget {
  const _Banner({
    super.key,
    required this.text,
    required this.colors,
    this.icon,
  });
  final String text;
  final StatusPair colors;
  final IconData? icon;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Space.s),
    child: Card(
      color: colors.container,
      child: Padding(
        padding: const EdgeInsets.all(Space.m - 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 18, color: colors.onContainer),
              const SizedBox(width: Space.s),
            ],
            Expanded(
              child: Text(text, style: TextStyle(color: colors.onContainer)),
            ),
          ],
        ),
      ),
    ),
  );
}

class EntryCard extends ConsumerWidget {
  const EntryCard({
    super.key,
    required this.entry,
    required this.day,
    required this.now,
  });
  final TrackerEntry entry;
  final TrackerDay day;
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final e = entry;
    final t = Theme.of(context).textTheme;
    final s = Theme.of(context).colorScheme;
    final sc = context.statusColors;
    final mono = t.labelLarge?.copyWith(
      fontFamily: 'monospace',
      fontWeight: FontWeight.w600,
    );
    final times = !e.timed
        ? 'Hours only'
        : e.running
        ? '${formatTime12(e.startAt!)} – Running'
        : '${formatTime12(e.startAt!)} – ${formatTime12(e.endAt!)}';
    final editable = !e.locked && day.canEdit;
    return Padding(
      padding: const EdgeInsets.only(bottom: Space.s),
      child: Card(
        key: Key('entry_${e.id}'),
        color: s.surfaceContainerLowest,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: e.running ? sc.done.onContainer : s.outlineVariant,
            width: e.running ? 2 : 1,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.m,
            Space.m - 4,
            Space.xs,
            Space.m - 4,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            times,
                            style: mono?.copyWith(
                              color: e.running ? sc.done.onContainer : null,
                            ),
                          ),
                        ),
                        Text(formatHHMM(e.minutesAt(now)), style: mono),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      e.name,
                      style: t.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      e.isQuick
                          ? 'Quick activity'
                          : [
                              e.project?.name,
                              e.client?.name,
                            ].whereType<String>().join(' · '),
                      style: t.bodySmall,
                    ),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: Space.s,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (e.activityType != null)
                          Text(e.activityType!.name, style: t.bodySmall),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.place_outlined, size: 13),
                            Text(
                              e.location?.name ?? '–',
                              style: t.bodySmall?.copyWith(
                                fontWeight: e.locationOverridden
                                    ? FontWeight.w700
                                    : null,
                              ),
                            ),
                          ],
                        ),
                        Text(
                          'Billable ${e.billable ? 'Yes' : 'No'}',
                          style: t.bodySmall,
                        ),
                      ],
                    ),
                    Text(
                      '${e.module ?? '–'} · ${e.notes ?? '–'}',
                      style: t.bodySmall,
                    ),
                    if (e.autoStopped)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: StatusChip(
                          label: 'Auto-stopped – please check',
                          colors: sc.forReview,
                        ),
                      ),
                    if (e.running && day.own) ...[
                      const SizedBox(height: Space.s),
                      FilledButton.icon(
                        key: Key('rowTimeOut_${e.id}'),
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFFB3261E),
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(40),
                        ),
                        onPressed: () => timeOut(context, ref, e.id),
                        icon: const Icon(Icons.stop, size: 16),
                        label: const Text('Time out'),
                      ),
                    ],
                  ],
                ),
              ),
              if (editable && !e.running)
                IconButton(
                  key: Key('editEntry_${e.id}'),
                  tooltip: 'Edit entry',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () async {
                    if (await showEntrySheet(
                      context,
                      mode: EntryMode.edit,
                      entry: e,
                    )) {
                      invalidateTracker(ref);
                    }
                  },
                )
              else if (!editable)
                Tooltip(
                  message: 'Locked. Ask an Admin to reopen this day.',
                  child: Padding(
                    key: Key('lockedIcon_${e.id}'),
                    padding: const EdgeInsets.all(12),
                    child: Icon(
                      Icons.lock_outline,
                      size: 20,
                      color: s.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Hours list: this week's entries (GET /time?week=) with the hours form (FAB "Log time").
class HoursListView extends ConsumerStatefulWidget {
  const HoursListView({super.key});
  @override
  ConsumerState<HoursListView> createState() => _HoursListViewState();
}

class _HoursListViewState extends ConsumerState<HoursListView> {
  late DateTime _week = mondayOf(ref.read(selectedDayProvider));

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final today = ref.watch(todayPhProvider);
    final list = ref.watch(hoursWeekProvider(_week));
    final canNext = !_week.add(const Duration(days: 7)).isAfter(today);
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('hoursLogTime'),
        onPressed: () => context.push('/log'),
        icon: const Icon(Icons.add),
        label: const Text('Log time'),
      ),
      body: Column(
        children: [
          Row(
            children: [
              IconButton.outlined(
                key: const Key('prevWeek'),
                tooltip: 'Previous week',
                icon: const Icon(Icons.chevron_left),
                onPressed: () => setState(
                  () => _week = _week.subtract(const Duration(days: 7)),
                ),
              ),
              Expanded(
                child: Text(
                  '‹ ${weekRangeShort(_week)} ›',
                  textAlign: TextAlign.center,
                  style: t.titleSmall,
                ),
              ),
              IconButton.outlined(
                key: const Key('nextWeek'),
                tooltip: 'Next week',
                icon: const Icon(Icons.chevron_right),
                onPressed: canNext
                    ? () => setState(
                        () => _week = _week.add(const Duration(days: 7)),
                      )
                    : null,
              ),
            ],
          ),
          Expanded(
            child: AsyncView(
              value: list,
              data: (items) {
                final total = items.fold<int>(0, (a, e) => a + e.minutes);
                return ListView(
                  key: const Key('hoursList'),
                  padding: const EdgeInsets.fromLTRB(
                    Space.m,
                    Space.s,
                    Space.m,
                    96,
                  ),
                  children: [
                    Text(
                      'My entries this week · ${formatHHMM(total)}',
                      key: const Key('hoursListTitle'),
                      style: t.titleSmall,
                    ),
                    const SizedBox(height: Space.s),
                    Card(
                      child: Column(
                        children: [
                          if (items.isEmpty)
                            const ListTile(
                              title: Text('No time logged this week.'),
                            ),
                          for (final e in items)
                            ListTile(
                              key: Key('hoursRow_${e.id}'),
                              title: Text(e.task.name),
                              subtitle: Text(
                                [
                                  e.project.name,
                                  longDayShort(e.date),
                                  e.type?.label,
                                ].whereType<String>().join(' · '),
                              ),
                              trailing: e.locked
                                  ? const Tooltip(
                                      message: 'Locked. Ask an Admin to reopen this day.',
                                      child: Icon(Icons.lock_outline),
                                    )
                                  : Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          formatHHMM(e.minutes),
                                          style: t.titleSmall,
                                        ),
                                        IconButton(
                                          key: Key('deleteHours_${e.id}'),
                                          tooltip: 'Delete time entry',
                                          icon: const Icon(
                                            Icons.delete_outline,
                                          ),
                                          onPressed: () => _delete(e),
                                        ),
                                      ],
                                    ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: Space.s),
                    Text(
                      'Hours-only entries (0.25 h steps). Timed entries are on the Day view.',
                      style: t.bodySmall,
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _delete(HoursEntry e) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this time entry?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('confirmDeleteHours'),
            style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(hoursRepositoryProvider).delete(e.id);
      invalidateTracker(ref);
    } on ApiException catch (err) {
      if (mounted) showError(context, err.message);
    }
  }
}

/// More › Timesheet review (22–23).
class TimesheetReviewScreen extends ConsumerStatefulWidget {
  const TimesheetReviewScreen({super.key});
  @override
  ConsumerState<TimesheetReviewScreen> createState() =>
      _TimesheetReviewScreenState();
}

class _TimesheetReviewScreenState extends ConsumerState<TimesheetReviewScreen> {
  String? _person;
  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).value?.id;
    final people = ref.watch(trackerPeopleProvider);
    final t = Theme.of(context).textTheme;
    return Scaffold(
      key: const Key('timesheetReviewScreen'),
      appBar: AppBar(
        leading: const BackOrUpButton(fallback: '/more'),
        title: const Text('Timesheet review'),
      ),
      body: AsyncView(
        value: people,
        data: (all) {
          final others = all.where((p) => p.id != me).toList();
          if (others.isEmpty) {
            return Center(
              key: const Key('reviewNobody'),
              child: Padding(
                padding: const EdgeInsets.all(Space.l),
                child: Text(
                  'Nobody reports to you, so there are no timesheets to review.',
                  textAlign: TextAlign.center,
                  style: t.bodyLarge,
                ),
              ),
            );
          }
          final name = others.where((p) => p.id == _person).firstOrNull?.name;
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  Space.m,
                  0,
                  Space.m,
                  Space.s,
                ),
                child: DropdownMenu<String>(
                  key: const Key('reviewPerson'),
                  expandedInsets: EdgeInsets.zero,
                  label: const Text('Person'),
                  hintText: 'Choose a person…',
                  initialSelection: _person,
                  dropdownMenuEntries: [
                    for (final p in others)
                      DropdownMenuEntry(value: p.id, label: p.name),
                  ],
                  onSelected: (v) => setState(() => _person = v),
                ),
              ),
              Expanded(
                child: _person == null
                    ? Center(
                        key: const Key('reviewEmpty'),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('Choose a person', style: t.titleMedium),
                            const SizedBox(height: Space.xs),
                            Text(
                              'Pick someone who reports to you to review their day.',
                              style: t.bodySmall,
                            ),
                          ],
                        ),
                      )
                    : DayView(userId: _person, reviewName: name),
              ),
            ],
          );
        },
      ),
    );
  }
}
