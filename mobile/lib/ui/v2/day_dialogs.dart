import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../data/ph_time.dart';
import '../../data/tracker_models.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

/// Location sheet (19): PUT /tracker/days/:date/location.
Future<void> changeDayLocation(
  BuildContext context,
  WidgetRef ref,
  TrackerDay day,
) async {
  final lookups = await ref.read(lookupsProvider.future);
  if (!context.mounted) return;
  final today = ref.read(todayPhProvider);
  final picked = await showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (ctx) => _LocationSheet(
      title: whereWorkingQuestion(day.date, today),
      locations: lookups.locations,
      current: day.location?.id,
    ),
  );
  if (picked == null || picked == day.location?.id) return;
  try {
    await ref.read(trackerRepositoryProvider).setDayLocation(day.date, picked);
    invalidateTracker(ref);
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

class _LocationSheet extends StatefulWidget {
  const _LocationSheet({
    required this.title,
    required this.locations,
    this.current,
  });
  final String title;
  final List<Lookup> locations;
  final String? current;
  @override
  State<_LocationSheet> createState() => _LocationSheetState();
}

class _LocationSheetState extends State<_LocationSheet> {
  late String? _sel = widget.current;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return SafeArea(
      child: Padding(
        key: const Key('locationSheet'),
        padding: const EdgeInsets.fromLTRB(Space.l, 0, Space.l, Space.m),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, style: t.titleLarge),
            const SizedBox(height: Space.s),
            RadioGroup<String>(
              groupValue: _sel,
              onChanged: (v) => setState(() => _sel = v),
              child: Column(
                children: [
                  for (final l in widget.locations)
                    RadioListTile<String>(
                      key: Key('locationOption_${l.id}'),
                      contentPadding: EdgeInsets.zero,
                      value: l.id,
                      title: Text(l.name),
                    ),
                ],
              ),
            ),
            Text(
              'Entries that follow the day’s location change with it; changed entries keep theirs.',
              style: t.bodySmall,
            ),
            const SizedBox(height: Space.m),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancel'),
                ),
                const SizedBox(width: Space.s),
                FilledButton(
                  key: const Key('locationSave'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                  onPressed: _sel == null
                      ? null
                      : () => Navigator.pop(context, _sel),
                  child: const Text('Save'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Submit (20): POST /tracker/days/:date/submit.
Future<void> submitDay(
  BuildContext context,
  WidgetRef ref,
  TrackerDay day,
) async {
  final n = day.entries.length;
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      key: const Key('submitDialog'),
      title: Text('Submit ${shortDate(day.date)}?'),
      content: Text(
        '${formatHHMM(day.totalMinutes)} in $n ${n == 1 ? 'entry' : 'entries'}. Submitting locks the day’s '
        'entries. Before the weekly lock, your supervisor or an Admin can reopen it.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('confirmSubmit'),
          style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Submit day'),
        ),
      ],
    ),
  );
  if (ok != true) return;
  try {
    await ref.read(trackerRepositoryProvider).submitDay(day.date);
    invalidateTracker(ref);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${shortDate(day.date)} submitted')),
      );
    }
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

/// Reopen (21): POST /tracker/days/:date/reopen {userId, reason}.
Future<void> reopenDay(
  BuildContext context,
  WidgetRef ref,
  TrackerDay day,
) async {
  final done = await showModalBottomSheet<bool>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (ctx) => _ReopenSheet(day: day),
  );
  if (done == true) invalidateTracker(ref);
}

class _ReopenSheet extends ConsumerStatefulWidget {
  const _ReopenSheet({required this.day});
  final TrackerDay day;
  @override
  ConsumerState<_ReopenSheet> createState() => _ReopenSheetState();
}

class _ReopenSheetState extends ConsumerState<_ReopenSheet> {
  final _ctrl = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_ctrl.text.trim().isEmpty) {
      setState(() => _error = 'Add a reason for reopening.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(trackerRepositoryProvider)
          .reopenDay(widget.day.date, widget.day.user.id, _ctrl.text.trim());
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      setState(() => _error = e.fields['reason'] ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = widget.day.user.name;
    final t = Theme.of(context).textTheme;
    return Padding(
      key: const Key('reopenSheet'),
      padding: EdgeInsets.fromLTRB(
        Space.l,
        0,
        Space.l,
        Space.l + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Reopen ${shortDate(widget.day.date)} · $name',
            style: t.titleLarge,
          ),
          const SizedBox(height: Space.s),
          Text(
            '$name can edit the day’s entries again. The reason shows on the day, is recorded in the audit log, '
            'and $name gets an in-app notification.',
            style: t.bodyMedium,
          ),
          const SizedBox(height: Space.m),
          TextField(
            key: const Key('reopenReason'),
            controller: _ctrl,
            maxLength: 500,
            maxLines: 3,
            autofocus: true,
            decoration: InputDecoration(
              labelText: 'Reason *',
              errorText: _error,
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              const SizedBox(width: Space.s),
              FilledButton(
                key: const Key('confirmReopen'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: _busy ? null : _submit,
                child: const Text('Reopen day'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
