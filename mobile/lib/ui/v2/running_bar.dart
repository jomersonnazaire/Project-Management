import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/ph_time.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import 'entry_sheet.dart';

/// App-wide running timer bar above the NavigationBar. Polls GET /tracker/running every 30 s and on
/// resume; ticks locally every second.
class RunningTimerBar extends ConsumerStatefulWidget {
  const RunningTimerBar({super.key});
  @override
  ConsumerState<RunningTimerBar> createState() => _RunningTimerBarState();
}

class _RunningTimerBarState extends ConsumerState<RunningTimerBar> {
  late final AppLifecycleListener _life;

  @override
  void initState() {
    super.initState();
    _life = AppLifecycleListener(
      onResume: () => ref.invalidate(runningProvider),
    );
  }

  @override
  void dispose() {
    _life.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(runningPollerProvider);
    ref.watch(tickerProvider);
    final entry = ref.watch(runningProvider).value?.entry;
    if (entry == null || entry.startAt == null) return const SizedBox.shrink();
    final pair = context.statusColorsDone;
    final elapsed = ref
        .read(nowProvider)()
        .difference(entry.startAt!)
        .inSeconds;
    return Material(
      key: const Key('runningTimerBar'),
      color: pair.container,
      child: SafeArea(
        top: false,
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.m,
            Space.xs,
            Space.s,
            Space.xs,
          ),
          child: Row(
            children: [
              Icon(Icons.circle, size: 10, color: pair.onContainer),
              const SizedBox(width: Space.s),
              Expanded(
                child: Text(
                  entry.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: pair.onContainer,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                formatHMS(elapsed),
                key: const Key('runningTimerElapsed'),
                style: TextStyle(
                  color: pair.onContainer,
                  fontFeatures: const [FontFeature.tabularFigures()],
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: Space.s),
              FilledButton.icon(
                key: const Key('runningTimerStop'),
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFB3261E),
                  foregroundColor: Colors.white,
                  minimumSize: const Size(0, 36),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
                onPressed: () => timeOut(context, ref, entry.id),
                icon: const Icon(Icons.stop, size: 16),
                label: const Text('Time out'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

extension on BuildContext {
  StatusPair get statusColorsDone =>
      Theme.of(this).extension<StatusColors>()!.done;
}
