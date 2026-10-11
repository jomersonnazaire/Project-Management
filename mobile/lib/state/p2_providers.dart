import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config.dart';
import '../data/p2.dart';
import 'providers.dart';
import 'v2_providers.dart';

final mockLeaveStoreProvider = Provider<MockLeaveStore>((ref) => MockLeaveStore());

final leaveRepositoryProvider = Provider<LeaveRepository>(
  (ref) => AppConfig.demoMode
      ? MockLeaveRepository(ref.watch(mockLeaveStoreProvider))
      : ApiLeaveRepository(ref.watch(apiClientProvider)),
);
final taskActionsRepositoryProvider = Provider<TaskActionsRepository>(
  (ref) => AppConfig.demoMode
      ? MockTaskActionsRepository(ref.watch(mockStoreProvider))
      : ApiTaskActionsRepository(ref.watch(apiClientProvider)),
);
final projectExtrasRepositoryProvider = Provider<ProjectExtrasRepository>(
  (ref) => AppConfig.demoMode
      ? MockProjectExtrasRepository(ref.watch(mockStoreProvider))
      : ApiProjectExtrasRepository(ref.watch(apiClientProvider)),
);

/// Picks one evidence file. Overridden in tests; the app uses file_picker.
final evidencePickerProvider = Provider<Future<PickedFile?> Function()>((ref) => () async => null);

final leaveTypesProvider = FutureProvider<List<LeaveType>>((ref) => ref.watch(leaveRepositoryProvider).types());
final leaveYearProvider = NotifierProvider<LeaveYear, int>(LeaveYear.new);

class LeaveYear extends Notifier<int> {
  @override
  int build() => ref.watch(todayPhProvider).year;
  void set(int y) => state = y;
}

final leaveBalancesProvider = FutureProvider.family<Balances, int>(
  (ref, y) => ref.watch(leaveRepositoryProvider).balances(y),
);
final myLeaveProvider = FutureProvider.family<List<LeaveItem>, int>(
  (ref, y) async => mergeHalfDays(await ref.watch(leaveRepositoryProvider).mine(y)),
);
final teamLeaveProvider = FutureProvider<TeamLeave>((ref) => ref.watch(leaveRepositoryProvider).team());

void invalidateLeave(WidgetRef ref) {
  ref.invalidate(leaveBalancesProvider);
  ref.invalidate(myLeaveProvider);
  ref.invalidate(teamLeaveProvider);
  invalidateTracker(ref);
}

final taskExtrasProvider = FutureProvider.family<TaskExtras, String>(
  (ref, id) => ref.watch(taskActionsRepositoryProvider).extras(id),
);
final taskHistoryProvider = FutureProvider.family<List<HistoryItem>, String>(
  (ref, id) => ref.watch(taskActionsRepositoryProvider).history(id),
);
final projectExtrasProvider = FutureProvider.family<ProjectExtras, String>(
  (ref, id) => ref.watch(projectExtrasRepositoryProvider).extras(id),
);
final projectTimeProvider = FutureProvider.family<ProjectTime, String>(
  (ref, id) => ref.watch(projectExtrasRepositoryProvider).time(id),
);
final projectActivityProvider = FutureProvider.family<List<HistoryItem>, String>(
  (ref, id) => ref.watch(projectExtrasRepositoryProvider).activity(id),
);
