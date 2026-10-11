// P2 41–44: Leave (More › Leave): record sheet, balances + my leave, cancel, team on leave.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../data/p2.dart';
import '../../data/ph_time.dart';
import '../../state/p2_providers.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

/// Opens the Record leave sheet (also from "+ Add leave" with [date] prefilled). True when saved.
Future<bool> showRecordLeave(BuildContext context, {DateTime? date}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    useRootNavigator: true,
    showDragHandle: true,
    builder: (_) => RecordLeaveSheet(date: date),
  );
  return ok == true;
}

class RecordLeaveSheet extends ConsumerStatefulWidget {
  const RecordLeaveSheet({super.key, this.date});
  final DateTime? date;
  @override
  ConsumerState<RecordLeaveSheet> createState() => _RecordLeaveSheetState();
}

class _RecordLeaveSheetState extends ConsumerState<RecordLeaveSheet> {
  String? _type;
  String _part = 'FULL';
  late DateTime _from, _to;
  final _reason = TextEditingController();
  Map<String, String> _errors = {};
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _from = widget.date ?? ref.read(todayPhProvider);
    _to = _from;
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _pick(bool from) async {
    final d = await showDatePicker(
      context: context,
      initialDate: from ? _from : _to,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (d == null) return;
    setState(() {
      if (from) {
        _from = d;
        if (_part != 'FULL' || _to.isBefore(d)) _to = d;
      } else {
        _to = d;
      }
    });
  }

  Map<String, String> _validate() => {
    if (_type == null) 'leaveTypeId': 'Choose a leave type.',
    if (_to.isBefore(_from))
      'to': toBeforeFrom
    else if (_part != 'FULL' && _to != _from)
      'to': halfDaySingleDate,
  };

  Future<void> _save() async {
    final e = _validate();
    setState(() => _errors = e);
    if (e.isNotEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(leaveRepositoryProvider).record(
        LeaveInput(typeId: _type!, dayPart: _part, from: _from, to: _to, reason: _reason.text),
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (err) {
      if (mounted) setState(() => _errors = err.fields.isNotEmpty ? err.fields : {'_': err.message});
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final types = ref.watch(leaveTypesProvider).value ?? const <LeaveType>[];
    final type = types.where((t) => t.id == _type).firstOrNull;
    final bal = ref.watch(leaveBalancesProvider(_from.year)).value;
    final t = Theme.of(context).textTheme;
    final s = Theme.of(context).colorScheme;
    Widget dateField(String key, String label, DateTime v, String field, bool from) => InkWell(
      key: Key(key),
      onTap: () => _pick(from),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: _errors[field],
          errorMaxLines: 3,
          suffixIcon: const Icon(Icons.calendar_today_outlined, semanticLabel: 'Pick a date'),
        ),
        child: Text(longDayShort(v)),
      ),
    );
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        key: const Key('recordLeaveSheet'),
        padding: const EdgeInsets.fromLTRB(Space.m, 0, Space.m, Space.l),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Record leave', style: t.titleLarge),
            const SizedBox(height: Space.m),
            if (bal != null && bal.supervisorName == null) ...[
              Card(
                key: const Key('noSupervisorBanner'),
                color: context.statusColors.forReview.container,
                child: const Padding(padding: EdgeInsets.all(Space.m), child: Text(noSupervisorLeave)),
              ),
              const SizedBox(height: Space.m),
            ],
            if (_errors['_'] != null) ...[
              Text(_errors['_']!, key: const Key('leaveError'), style: TextStyle(color: s.error)),
              const SizedBox(height: Space.s),
            ],
            DropdownMenu<String>(
              key: const Key('leaveTypeField'),
              expandedInsets: EdgeInsets.zero,
              label: const Text('Leave type *'),
              errorText: _errors['leaveTypeId'],
              initialSelection: _type,
              dropdownMenuEntries: [
                for (final lt in types) DropdownMenuEntry(value: lt.id, label: lt.name),
              ],
              onSelected: (v) => setState(() {
                _type = v;
                final nt = types.where((x) => x.id == v).firstOrNull;
                if (nt?.fullDaysOnly ?? false) _part = 'FULL';
              }),
            ),
            if (_errors['leaveTypeId'] != null && _errors['leaveTypeId']!.length > 40)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(_errors['leaveTypeId']!, style: t.bodySmall?.copyWith(color: s.error)),
              ),
            const SizedBox(height: Space.m),
            Text('Day part *', style: t.labelLarge),
            const SizedBox(height: Space.s),
            SegmentedButton<String>(
              key: const Key('leaveDayPart'),
              showSelectedIcon: false,
              segments: [
                for (final e in dayPartLabels.entries)
                  ButtonSegment(
                    value: e.key,
                    label: FitLabel(e.value),
                    enabled: e.key == 'FULL' || !(type?.fullDaysOnly ?? false),
                  ),
              ],
              selected: {_part},
              onSelectionChanged: (v) => setState(() {
                _part = v.first;
                if (_part != 'FULL') _to = _from;
              }),
            ),
            if (_errors['dayPart'] != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(_errors['dayPart']!, style: t.bodySmall?.copyWith(color: s.error)),
              ),
            const SizedBox(height: Space.m),
            dateField('leaveFromField', 'From', _from, 'from', true),
            const SizedBox(height: Space.m),
            dateField('leaveToField', 'To *', _to, 'to', false),
            const SizedBox(height: Space.m),
            TextField(
              key: const Key('leaveReasonField'),
              controller: _reason,
              maxLength: 500,
              maxLines: 3,
              minLines: 1,
              decoration: const InputDecoration(
                labelText: 'Reason',
                helperText: "Don't include medical details. Only you, your supervisor and Admins can see this.",
                helperMaxLines: 3,
              ),
            ),
            const SizedBox(height: Space.m),
            FilledButton(
              key: const Key('recordLeaveSubmit'),
              onPressed: _busy ? null : _save,
              child: FitLabel(_busy ? 'Saving…' : 'Record leave'),
            ),
          ],
        ),
      ),
    );
  }
}

class LeaveScreen extends ConsumerWidget {
  const LeaveScreen({super.key, this.initialTab});
  final String? initialTab;
  @override
  Widget build(BuildContext context, WidgetRef ref) => DefaultTabController(
    length: 2,
    initialIndex: initialTab == 'team' ? 1 : 0,
    child: Scaffold(
      key: const Key('leaveScreen'),
      appBar: AppBar(
        leading: const BackOrUpButton(fallback: '/more'),
        title: const Text('Leave'),
        bottom: const TabBar(
          tabs: [
            Tab(key: Key('leaveTab_mine'), text: 'My leave'),
            Tab(key: Key('leaveTab_team'), text: 'Team on leave'),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('recordLeaveFab'),
        icon: const Icon(Icons.add),
        label: const Text('Record leave'),
        onPressed: () async {
          if (await showRecordLeave(context)) invalidateLeave(ref);
        },
      ),
      body: const TabBarView(children: [_MyLeave(), _TeamLeave()]),
    ),
  );
}

class _MyLeave extends ConsumerWidget {
  const _MyLeave();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final year = ref.watch(leaveYearProvider);
    final bal = ref.watch(leaveBalancesProvider(year));
    final list = ref.watch(myLeaveProvider(year));
    final today = ref.watch(todayPhProvider);
    final t = Theme.of(context).textTheme;
    final sc = context.statusColors;
    return RefreshIndicator(
      onRefresh: () async => invalidateLeave(ref),
      child: ListView(
        key: const Key('myLeaveList'),
        padding: const EdgeInsets.fromLTRB(Space.m, Space.m, Space.m, 96),
        children: [
          if (bal.value != null && bal.value!.supervisorName == null)
            Card(
              key: const Key('noSupervisorBanner'),
              color: sc.forReview.container,
              child: Padding(
                padding: const EdgeInsets.all(Space.m),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    StatusChip(label: 'Supervisor needed', colors: sc.forReview),
                    const SizedBox(height: Space.s),
                    const Text(noSupervisorLeave),
                  ],
                ),
              ),
            ),
          Row(
            children: [
              Expanded(child: Text('My balances', style: t.titleMedium)),
              IconButton(
                key: const Key('leavePrevYear'),
                tooltip: 'Previous year',
                icon: const Icon(Icons.chevron_left),
                onPressed: () => ref.read(leaveYearProvider.notifier).set(year - 1),
              ),
              Text('$year', key: const Key('leaveYear'), style: t.titleSmall),
              IconButton(
                key: const Key('leaveNextYear'),
                tooltip: 'Next year',
                icon: const Icon(Icons.chevron_right),
                onPressed: () => ref.read(leaveYearProvider.notifier).set(year + 1),
              ),
            ],
          ),
          Text('Calendar year Jan–Dec', style: t.bodySmall),
          const SizedBox(height: Space.s),
          AsyncView(
            value: bal,
            onRetry: () => ref.invalidate(leaveBalancesProvider(year)),
            data: (b) => Column(children: [for (final x in b.items) _BalanceCard(x)]),
          ),
          const SizedBox(height: Space.l),
          Text('My leave', style: t.titleMedium),
          const SizedBox(height: Space.s),
          AsyncView(
            value: list,
            onRetry: () => ref.invalidate(myLeaveProvider(year)),
            data: (items) => items.isEmpty
                ? const Padding(
                    padding: EdgeInsets.all(Space.l),
                    child: Text('No leave recorded yet', key: Key('myLeaveEmpty'), textAlign: TextAlign.center),
                  )
                : Column(children: [for (final l in items) _LeaveCard(l, today: today)]),
          ),
        ],
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard(this.b);
  final LeaveBalance b;
  @override
  Widget build(BuildContext context) {
    final sc = context.statusColors;
    final t = Theme.of(context).textTheme;
    return Card(
      key: Key('leaveBalance_${b.type.id}'),
      child: Padding(
        padding: const EdgeInsets.all(Space.m),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: Space.s,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(b.type.name, style: t.titleSmall),
                if (!b.type.paid) StatusChip(label: 'Unpaid', colors: sc.todo),
                if (b.negative) StatusChip(label: 'Negative', colors: sc.blocked),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              b.balance == null
                  ? '${leaveDaysLabel(b.recorded)} taken · no limit'
                  : '${leaveDaysLabel(b.balance)} left · ${leaveDaysLabel(b.recorded)} taken of ${leaveDaysLabel((b.entitlement ?? 0) + b.carryOver)}',
              style: t.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _cancel(BuildContext context, WidgetRef ref, LeaveItem l) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Cancel ${l.typeName} leave?'),
      content: Text(
        '${leaveRangeLabel(l.from, l.to)} · ${l.partLabel}. This restores your balance and tells your supervisor.',
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep it')),
        FilledButton(
          key: const Key('confirmCancelLeave'),
          style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Cancel leave'),
        ),
      ],
    ),
  );
  if (ok != true) return;
  try {
    await ref.read(leaveRepositoryProvider).cancel(l.id);
    invalidateLeave(ref);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Leave cancelled')));
    }
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

class _LeaveCard extends ConsumerWidget {
  const _LeaveCard(this.l, {required this.today});
  final LeaveItem l;
  final DateTime today;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sc = context.statusColors;
    final t = Theme.of(context).textTheme;
    final past = !l.from.isAfter(today);
    Widget? action;
    if (l.cancelled) {
      action = StatusChip(label: 'Cancelled', colors: sc.todo);
    } else if (l.halves != null && l.canCancel) {
      action = PopupMenuButton<LeaveItem>(
        key: Key('cancelLeave_${l.id}'),
        tooltip: 'Cancel leave',
        icon: const Icon(Icons.event_busy_outlined),
        onSelected: (h) => _cancel(context, ref, h),
        itemBuilder: (_) => [
          for (final h in l.halves!)
            if (h.canCancel)
              PopupMenuItem(
                key: Key('cancelHalf_${h.dayPart}'),
                value: h,
                child: Text('Cancel ${h.dayPart == 'AM' ? 'morning (AM)' : 'afternoon (PM)'}'),
              ),
        ],
      );
    } else if (l.canCancel) {
      action = IconButton(
        key: Key('cancelLeave_${l.id}'),
        tooltip: 'Cancel leave',
        icon: const Icon(Icons.event_busy_outlined),
        onPressed: () => _cancel(context, ref, l),
      );
    }
    return Card(
      key: Key('leave_${l.id}'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Space.m, Space.s, Space.s, Space.s),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${l.typeName} · ${leaveRangeLabel(l.from, l.to)}', style: t.titleSmall),
                  Text('${l.partLabel} · ${leaveDaysLabel(l.days)} ${l.days == 1 ? 'day' : 'days'}', style: t.bodySmall),
                  if (l.reason != null && l.reason!.isNotEmpty) Text(l.reason!, style: t.bodySmall),
                  if (!l.cancelled && !l.canCancel && past)
                    Text(pastLeaveAdminOnly, key: Key('pastLeave_${l.id}'), style: t.bodySmall),
                ],
              ),
            ),
            ?action,
          ],
        ),
      ),
    );
  }
}

class _TeamLeave extends ConsumerWidget {
  const _TeamLeave();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final team = ref.watch(teamLeaveProvider);
    final t = Theme.of(context).textTheme;
    final sc = context.statusColors;
    return AsyncView(
      value: team,
      onRetry: () => ref.invalidate(teamLeaveProvider),
      data: (tl) => ListView(
        key: const Key('teamLeaveList'),
        padding: const EdgeInsets.fromLTRB(Space.m, Space.m, Space.m, 96),
        children: [
          Text('Next 30 days', style: t.titleMedium),
          const SizedBox(height: Space.s),
          if (tl.items.isEmpty)
            const Padding(
              padding: EdgeInsets.all(Space.l),
              child: Text('No team leave in the next 30 days', key: Key('teamLeaveEmpty'), textAlign: TextAlign.center),
            ),
          for (final l in tl.items)
            Card(
              child: ListTile(
                leading: InitialsAvatar(l.userName),
                title: Text(l.userName),
                subtitle: Text('${l.typeName} · ${leaveRangeLabel(l.from, l.to)} · ${l.partLabel}'),
              ),
            ),
          if (tl.people.isNotEmpty) ...[
            const SizedBox(height: Space.l),
            Text('Balances', style: t.titleMedium),
            const SizedBox(height: Space.s),
            for (final p in tl.people)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(Space.m),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: Space.s,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(p.name, style: t.titleSmall),
                          if (p.noSupervisor) StatusChip(label: 'Supervisor needed', colors: sc.forReview),
                        ],
                      ),
                      for (final b in p.balances)
                        Text(
                          '${b.type.name}: ${leaveDaysLabel(b.balance)} left${b.negative ? ' · Negative' : ''}',
                          style: t.bodySmall?.copyWith(color: b.negative ? sc.blocked.onContainer : null),
                        ),
                    ],
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
