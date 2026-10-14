import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../data/ph_time.dart';
import '../../data/tracker_models.dart';
import '../../state/providers.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

enum EntryMode { timeIn, quick, add, edit }

const quickTarget = '__quick__';

/// Opens the entry sheet. Returns true when something was saved/started/deleted.
Future<bool> showEntrySheet(
  BuildContext context, {
  required EntryMode mode,
  String? taskId,
  DateTime? date,
  TrackerEntry? entry,
}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: .92,
      minChildSize: .5,
      maxChildSize: .95,
      builder: (_, scroll) => TrackerEntrySheet(
        mode: mode,
        taskId: taskId,
        date: date,
        entry: entry,
        scroll: scroll,
      ),
    ),
  );
  return ok == true;
}

/// Time in on a task (row button, task detail): the sheet with the timer preselected.
Future<void> timeInOnTask(
  BuildContext context,
  WidgetRef ref,
  String taskId,
) async {
  // The running timer bar is the confirmation.
  if (await showEntrySheet(context, mode: EntryMode.timeIn, taskId: taskId)) {
    invalidateTracker(ref);
  }
}

/// "Stop '{task}' and start this one?" (FR-ACT-26). Returns true for Switch.
Future<bool> showSwitchPrompt(
  BuildContext context,
  String? runningName,
) async =>
    await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('switchPrompt'),
        title: const Text('Time in'),
        content: Text(
          runningName == null
              ? 'A timer is already running. Stop it first or switch.'
              : "Stop '$runningName' and start this one?",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('switchTimer'),
            style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Switch'),
          ),
        ],
      ),
    ) ==
    true;

class TrackerEntrySheet extends ConsumerStatefulWidget {
  const TrackerEntrySheet({
    super.key,
    required this.mode,
    this.taskId,
    this.date,
    this.entry,
    this.scroll,
  });
  final EntryMode mode;
  final String? taskId;
  final DateTime? date;
  final TrackerEntry? entry;
  final ScrollController? scroll;
  @override
  ConsumerState<TrackerEntrySheet> createState() => _TrackerEntrySheetState();
}

class _TrackerEntrySheetState extends ConsumerState<TrackerEntrySheet> {
  String? _target; // task id or quickTarget
  final _title = TextEditingController();
  final _module = TextEditingController();
  final _remarks = TextEditingController();
  bool _timer = true;
  TimeOfDay? _in, _out;
  String? _dayLocation, _activity;
  TimeType _type = TimeType.execution;
  bool? _billable;
  String? _hint;
  Map<String, String> _errors = {};
  String? _error;
  bool _busy = false;

  bool get _edit => widget.mode == EntryMode.edit;
  DateTime get _today => ref.read(todayPhProvider);
  DateTime get _date => widget.entry?.date ?? widget.date ?? _today;
  bool get _isQuick => _target == quickTarget;

  @override
  void initState() {
    super.initState();
    final e = widget.entry;
    if (e != null) {
      _target = e.isQuick ? quickTarget : e.task?.id;
      _title.text = e.title ?? '';
      _module.text = e.module ?? '';
      _remarks.text = e.notes ?? '';
      _activity = e.activityType?.id;
      _billable = e.billable;
      _type = e.type ?? TimeType.execution;
      _timer = false;
      if (e.startAt != null) _in = _tod(e.startAt!);
      if (e.endAt != null) _out = _tod(e.endAt!);
    } else {
      _target = widget.mode == EntryMode.quick ? quickTarget : widget.taskId;
      _timer = widget.mode != EntryMode.add || _date == _today;
      if (widget.mode == EntryMode.add) _timer = false;
      if (_target != null && _target != quickTarget) _preselect(_target!);
    }
  }

  TimeOfDay _tod(DateTime instant) {
    final p = toPh(instant);
    return TimeOfDay(hour: p.hour, minute: p.minute);
  }

  @override
  void dispose() {
    _title.dispose();
    _module.dispose();
    _remarks.dispose();
    super.dispose();
  }

  Future<void> _preselect(String taskId) async {
    try {
      final p = await ref.read(trackerRepositoryProvider).preselect(taskId);
      if (!mounted || p == null) return;
      setState(() {
        if (p.activityType != null) {
          _activity = p.activityType!.id;
          _hint = 'From project type: ${p.projectTypeName}. You can change it.';
        } else {
          _hint = null;
        }
      });
    } catch (_) {}
  }

  String get _titleText => switch (widget.mode) {
    EntryMode.timeIn => 'Time in',
    EntryMode.quick => 'Quick activity',
    EntryMode.add => 'Add entry',
    EntryMode.edit => 'Edit entry',
  };

  Future<void> _pickTime(bool isIn) async {
    final now = toPh(ref.read(nowProvider)());
    final past = _date.isBefore(_today);
    final initial = isIn
        ? (_in ??
              (past
                  ? const TimeOfDay(hour: 8, minute: 0)
                  : TimeOfDay(hour: (now.hour - 1).clamp(0, 23), minute: 0)))
        : (_out ??
              (_in != null
                  ? TimeOfDay(
                      hour: (_in!.hour + 1).clamp(0, 23),
                      minute: _in!.minute,
                    )
                  : (past
                        ? const TimeOfDay(hour: 9, minute: 0)
                        : TimeOfDay(hour: now.hour, minute: 0))));
    final t = await showTimePicker(context: context, initialTime: initial);
    if (t != null) {
      setState(() {
        isIn ? _in = t : _out = t;
        _errors.remove(isIn ? 'timeIn' : 'timeOut');
      });
    }
  }

  Map<String, String> _validate(bool needsDayLocation) {
    final e = <String, String>{};
    if (_target == null) e['taskId'] = 'Choose a task or Quick activity.';
    if (_isQuick && _title.text.trim().isEmpty) e['title'] = 'Add a title.';
    if (needsDayLocation && _dayLocation == null) {
      e['dayLocationId'] = 'Choose where you’re working today.';
    }
    if (_activity == null) e['activityTypeId'] = 'Choose an activity type.';
    final manual = _edit
        ? widget.entry!.timed && !widget.entry!.running
        : !_timer;
    if (manual) {
      if (_in == null) e['timeIn'] = 'Enter the time in.';
      if (_out == null) e['timeOut'] = 'Enter the time out.';
      if (_in != null &&
          _out != null &&
          (_out!.hour * 60 + _out!.minute) <= (_in!.hour * 60 + _in!.minute)) {
        e['timeOut'] = 'Time out must be after time in.';
      }
    }
    if (_module.text.trim().characters.length > 100) {
      e['module'] = 'Keep the module under 100 characters.';
    }
    return e;
  }

  EntryDraft _draft({String? switchFrom, bool confirmLeave = false}) {
    final manual = !_timer || _edit;
    return EntryDraft(
      taskId: _isQuick ? null : _target,
      title: _isQuick ? _title.text.trim() : null,
      activityTypeId: _activity!,
      locationId: null,
      dayLocationId: _dayLocation,
      billable: _billable ?? !_isQuick,
      type: _isQuick ? null : _type,
      module: _module.text,
      notes: _remarks.text,
      date: _date,
      timeIn: manual && _in != null ? hhmm24(_in!.hour, _in!.minute) : null,
      timeOut: manual && _out != null ? hhmm24(_out!.hour, _out!.minute) : null,
      switchFrom: switchFrom,
      confirmLeave: confirmLeave,
    );
  }

  Future<void> _save(bool needsDayLocation) async {
    final errs = _validate(needsDayLocation);
    setState(() {
      _errors = errs;
      _error = null;
    });
    if (errs.isNotEmpty) return;
    setState(() => _busy = true);
    final repo = ref.read(trackerRepositoryProvider);
    try {
      // Changing the day's location goes through PUT /tracker/days/:date/location first (it
      // writes the audit). If that fails (e.g. DAY_LOCKED) the entry is not saved.
      final current = ref
          .read(dayTimesheetProvider((_date, null)))
          .value
          ?.location
          ?.id;
      if (!_edit && current != null && _dayLocation != current) {
        await repo.setDayLocation(_date, _dayLocation!);
      }
      String? switchFrom;
      if (!_edit && _timer) {
        // Ask before starting when a timer is already running (FR-ACT-26).
        final running =
            (await ref.read(trackerRepositoryProvider).running()).entry;
        if (running != null) {
          if (!mounted || !await showSwitchPrompt(context, running.name)) {
            return;
          }
          switchFrom = running.id;
        }
      }
      var confirmLeave = false;
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          final d = _draft(switchFrom: switchFrom, confirmLeave: confirmLeave);
          if (_edit) {
            await repo.updateEntry(widget.entry!.id, d);
          } else if (_timer) {
            await repo.start(d);
          } else {
            await repo.createEntry(d);
          }
          if (mounted) Navigator.of(context).pop(true);
          return;
        } on ApiException catch (e) {
          if (!mounted) return;
          if (e.code == 'TIMER_RUNNING' &&
              e.details is Map &&
              (e.details as Map)['running'] is Map) {
            final r = (e.details as Map)['running'] as Map;
            if (!await showSwitchPrompt(context, '${r['name']}')) return;
            switchFrom = '${r['id']}';
            continue;
          }
          if (e.code == 'HALF_DAY_LEAVE') {
            final ok = await showDialog<bool>(
              context: context,
              builder: (ctx) => AlertDialog(
                title: const Text('Half day leave'),
                content: Text(e.message),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(ctx, false),
                    child: const Text('Cancel'),
                  ),
                  FilledButton(
                    key: const Key('confirmLeaveTime'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 40),
                    ),
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('Log anyway'),
                  ),
                ],
              ),
            );
            if (ok != true) return;
            confirmLeave = true;
            continue;
          }
          rethrow;
        }
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _errors = {...e.fields};
        // 422 FUTURE_DATE reports `date` or `workDate`.
        final dateErr = _errors.remove('workDate') ?? _errors.remove('date');
        if (dateErr != null || e.code == 'FUTURE_DATE') {
          _errors.clear();
          _error = e.message;
          return;
        }
        if (e.code == 'LOCATION_NEEDED') {
          _errors['dayLocationId'] = 'Choose where you’re working today.';
        }
        // Field errors go under their fields; anything else shows in the sheet.
        _error = e.fields.isEmpty || e.code == 'OVERLAP' ? e.message : null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this entry?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('confirmDeleteEntry'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
              minimumSize: const Size(0, 40),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete entry'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(trackerRepositoryProvider).deleteEntry(widget.entry!.id);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _error = e is ApiException ? e.message : '$e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final s = Theme.of(context).colorScheme;
    final lookups = ref.watch(lookupsProvider).value;
    final options =
        ref.watch(timeOptionsProvider).value ?? const <LoggableProject>[];
    final day = ref.watch(dayTimesheetProvider((_date, null))).value;
    // Doc 16 §2: "Where are you working today? *" is required on every new entry, prefilled
    // with the day location; another value changes the whole day (PUT …/location).
    final needsDayLocation = !_edit && day != null;
    if (needsDayLocation && _dayLocation == null && day.location != null) {
      _dayLocation = day.location!.id;
    }
    if (_isQuick && _activity == null && lookups != null) {
      _activity = lookups.activityTypes
          .where((a) => a.key == quickActivityKey)
          .firstOrNull
          ?.id;
    }
    final manual = _edit
        ? (widget.entry!.timed && !widget.entry!.running)
        : !_timer;
    final canTimer = !_edit && _date == _today;
    final help = t.bodySmall?.copyWith(color: s.onSurfaceVariant);

    Widget gap() => const SizedBox(height: Space.m);

    return Material(
      key: const Key('entrySheet'),
      color: Theme.of(context).bottomSheetTheme.backgroundColor,
      child: SingleChildScrollView(
        controller: widget.scroll,
        padding: EdgeInsets.fromLTRB(
          Space.l,
          Space.s,
          Space.l,
          Space.l + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_titleText, style: t.headlineSmall),
            if (_date != _today) Text(longDay(_date), style: help),
            gap(),
            if (_error != null) ...[
              Card(
                key: const Key('entryError'),
                color: s.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(Space.m),
                  child: Text(
                    _error!,
                    style: TextStyle(color: s.onErrorContainer),
                  ),
                ),
              ),
              gap(),
            ],
            KeyedSubtree(
              key: const Key('entryTarget'),
              child: DropdownMenu<String>(
                key: ValueKey('entryTarget_${options.length}'),
                expandedInsets: EdgeInsets.zero,
                enabled: !_edit,
                label: const Text('Task or quick activity *'),
                errorText: _errors['taskId'],
                initialSelection: _target,
                menuHeight: 360,
                dropdownMenuEntries: [
                  for (final p in options) ...[
                    DropdownMenuEntry(
                      value: 'h:${p.id}',
                      label: p.name,
                      enabled: false,
                      style: MenuItemButton.styleFrom(textStyle: t.labelMedium),
                    ),
                    for (final x in p.tasks)
                      DropdownMenuEntry(
                        value: x.id,
                        label: x.name,
                        leadingIcon: const SizedBox(width: 8),
                      ),
                  ],
                  const DropdownMenuEntry(
                    value: quickTarget,
                    label: 'Quick activity…',
                    leadingIcon: Icon(Icons.bolt),
                  ),
                ],
                onSelected: (v) {
                  setState(() {
                    _target = v;
                    _errors.remove('taskId');
                    _hint = null;
                    if (v == quickTarget) {
                      _activity = null;
                    } else if (v != null) {
                      _preselect(v);
                    }
                  });
                },
              ),
            ),
            if (_target != null && !_isQuick)
              Padding(
                padding: const EdgeInsets.only(top: 4, left: Space.m),
                child: Text(
                  options
                          .where((p) => p.tasks.any((x) => x.id == _target))
                          .firstOrNull
                          ?.name ??
                      widget.entry?.project?.name ??
                      '',
                  style: help,
                ),
              ),
            if (_isQuick) ...[
              gap(),
              TextField(
                key: const Key('entryTitle'),
                controller: _title,
                maxLength: 150,
                decoration: InputDecoration(
                  labelText: 'Title *',
                  errorText: _errors['title'],
                ),
              ),
            ],
            if (canTimer) ...[
              gap(),
              Column(
                key: const Key('entryWhen'),
                children: [
                  RadioGroup<bool>(
                    groupValue: _timer,
                    onChanged: (v) => setState(() => _timer = v ?? true),
                    child: const Column(
                      children: [
                        RadioListTile<bool>(
                          key: Key('entryWhenTimer'),
                          contentPadding: EdgeInsets.zero,
                          value: true,
                          title: Text('Start timer now'),
                        ),
                        RadioListTile<bool>(
                          key: Key('entryWhenManual'),
                          contentPadding: EdgeInsets.zero,
                          value: false,
                          title: Text('Enter time in and time out'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
            if (manual) ...[
              gap(),
              Row(
                children: [
                  Expanded(
                    child: _TimeField(
                      key: const Key('entryTimeIn'),
                      label: 'Time in *',
                      value: _in,
                      error: _errors['timeIn'],
                      onTap: () => _pickTime(true),
                    ),
                  ),
                  const SizedBox(width: Space.s),
                  Expanded(
                    child: _TimeField(
                      key: const Key('entryTimeOut'),
                      label: 'Time out *',
                      value: _out,
                      error: _errors['timeOut'],
                      onTap: () => _pickTime(false),
                    ),
                  ),
                ],
              ),
            ],
            if (needsDayLocation) ...[
              gap(),
              DropdownMenu<String>(
                key: const Key('entryDayLocation'),
                expandedInsets: EdgeInsets.zero,
                initialSelection: _dayLocation,
                label: Text('${whereWorkingQuestion(_date, _today)} *'),
                errorText: _errors['dayLocationId'],
                dropdownMenuEntries: [
                  for (final l in lookups?.locations ?? const <Lookup>[])
                    DropdownMenuEntry(value: l.id, label: l.name),
                ],
                onSelected: (v) => setState(() {
                  _dayLocation = v;
                  _errors.remove('dayLocationId');
                }),
              ),
            ],
            gap(),
            KeyedSubtree(
              key: const Key('entryActivityType'),
              child: DropdownMenu<String>(
                key: ValueKey('entryActivityType_$_activity'),
                expandedInsets: EdgeInsets.zero,
                label: const Text('Activity type *'),
                errorText: _errors['activityTypeId'],
                initialSelection: _activity,
                menuHeight: 320,
                dropdownMenuEntries: [
                  for (final a in lookups?.activityTypes ?? const <Lookup>[])
                    DropdownMenuEntry(value: a.id, label: a.name),
                ],
                onSelected: (v) => setState(() {
                  _activity = v;
                  _errors.remove('activityTypeId');
                }),
              ),
            ),
            if (_hint != null)
              Padding(
                padding: const EdgeInsets.only(top: 4, left: Space.m),
                child: Text(
                  _hint!,
                  key: const Key('activityHint'),
                  style: t.bodySmall?.copyWith(color: s.primary),
                ),
              ),
            if (!_isQuick) ...[
              gap(),
              DropdownMenu<TimeType>(
                key: const Key('entryTimeType'),
                expandedInsets: EdgeInsets.zero,
                label: const Text('Time type'),
                helperText: 'Project tasks only · default Execution',
                initialSelection: _type,
                dropdownMenuEntries: [
                  for (final x in TimeType.values)
                    DropdownMenuEntry(value: x, label: x.label),
                ],
                onSelected: (v) =>
                    setState(() => _type = v ?? TimeType.execution),
              ),
            ],
            gap(),
            Text('Billable', style: t.labelLarge),
            const SizedBox(height: Space.xs),
            Row(
              children: [
                SegmentedButton<bool>(
                  key: const Key('entryBillable'),
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(value: true, label: Text('Yes')),
                    ButtonSegment(value: false, label: Text('No')),
                  ],
                  selected: {_billable ?? !_isQuick},
                  onSelectionChanged: (v) =>
                      setState(() => _billable = v.first),
                ),
                const SizedBox(width: Space.s),
                Flexible(
                  child: Text(
                    _isQuick
                        ? 'No for quick activities'
                        : 'Yes for client projects',
                    style: help,
                  ),
                ),
              ],
            ),
            gap(),
            TextField(
              key: const Key('entryModule'),
              controller: _module,
              maxLength: 100,
              onChanged: (_) => setState(() => _errors.remove('module')),
              buildCounter:
                  (
                    _, {
                    required currentLength,
                    required isFocused,
                    maxLength,
                  }) => currentLength >= 80
                  ? Text('$currentLength/$maxLength')
                  : null,
              decoration: InputDecoration(
                labelText: 'Module (optional)',
                hintText: 'e.g. ADFS Remote',
                errorText: _errors['module'],
              ),
            ),
            const SizedBox(height: Space.s),
            TextField(
              key: const Key('entryRemarks'),
              controller: _remarks,
              maxLength: 1000,
              maxLines: 3,
              minLines: 1,
              decoration: InputDecoration(
                labelText: 'Remarks',
                errorText: _errors['notes'],
              ),
            ),
            gap(),
            Wrap(
              alignment: WrapAlignment.end,
              spacing: Space.s,
              runSpacing: Space.s,
              children: [
                if (_edit)
                  TextButton(
                    key: const Key('entryDelete'),
                    style: TextButton.styleFrom(foregroundColor: s.error),
                    onPressed: _busy ? null : _delete,
                    child: const Text('Delete'),
                  ),
                OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  key: const Key('entrySave'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                  onPressed: _busy ? null : () => _save(needsDayLocation),
                  child: Text(
                    _edit ? 'Save' : (_timer ? 'Start timer' : 'Save entry'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _TimeField extends StatelessWidget {
  const _TimeField({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.error,
  });
  final String label;
  final TimeOfDay? value;
  final String? error;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        errorText: error,
        errorMaxLines: 2,
        suffixIcon: const Icon(Icons.schedule),
      ),
      isEmpty: value == null,
      child: Text(value == null ? '' : _fmt(value!)),
    ),
  );
  static String _fmt(TimeOfDay t) =>
      '${(t.hourOfPeriod == 0 ? 12 : t.hourOfPeriod).toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')} ${t.period == DayPeriod.am ? 'AM' : 'PM'}';
}

/// "■ Time out" for a running entry; idempotent POST /tracker/stop.
Future<void> timeOut(
  BuildContext context,
  WidgetRef ref,
  String entryId,
) async {
  try {
    await ref.read(trackerRepositoryProvider).stop(entryId);
    invalidateTracker(ref);
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}
