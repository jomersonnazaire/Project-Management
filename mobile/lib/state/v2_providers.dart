import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/phases.dart';
import '../data/access.dart';
import '../data/models.dart' show Project, ProjectStatus;
export '../data/access.dart' show PermissionGrid;

import '../config.dart';
import '../data/mock_v2.dart';
import '../data/ph_time.dart';
import '../data/tracker_models.dart';
import '../data/v2_repositories.dart';
import 'providers.dart';

/// Current instant. Demo mode starts at Sun Oct 11, 2026 14:00 PH and then runs in real time
/// (so the running timer ticks); tests override it with a fixed instant.
final nowProvider = Provider<DateTime Function()>((ref) {
  if (!AppConfig.demoMode) return ref.watch(apiClientProvider).serverNow;
  final base = DateTime.utc(2026, 10, 11, 6);
  final started = DateTime.now();
  return () => base.add(DateTime.now().difference(started));
});

/// PH "today" (date only).
final todayPhProvider = Provider<DateTime>(
  (ref) => phDate(ref.watch(nowProvider)()),
);

/// One tick per second for the running bar (overridden with a single value in tests).
final tickerProvider = StreamProvider<int>(
  (ref) => Stream.periodic(const Duration(seconds: 1), (i) => i),
);

final mockTrackerStoreProvider = Provider<MockTrackerStore>(
  (ref) => MockTrackerStore(now: ref.watch(nowProvider)),
);

T _pick<T>(Ref ref, T Function() api, T Function() mock) =>
    AppConfig.demoMode ? mock() : api();

final trackerRepositoryProvider = Provider<TrackerRepository>(
  (ref) => _pick<TrackerRepository>(
    ref,
    () => ApiTrackerRepository(ref.watch(apiClientProvider)),
    () => MockTrackerRepository(ref.watch(mockTrackerStoreProvider)),
  ),
);
final myTasksRepositoryProvider = Provider<MyTasksRepository>(
  (ref) => _pick<MyTasksRepository>(
    ref,
    () => ApiMyTasksRepository(ref.watch(apiClientProvider)),
    () => MockMyTasksRepository(
      ref.watch(mockStoreProvider),
      () => ref.read(todayPhProvider),
    ),
  ),
);
final hoursRepositoryProvider = Provider<HoursRepository>(
  (ref) => _pick<HoursRepository>(
    ref,
    () => ApiHoursRepository(ref.watch(apiClientProvider)),
    () => MockHoursRepository(ref.watch(mockTrackerStoreProvider)),
  ),
);
final darRepositoryProvider = Provider<DarRepository>(
  (ref) => _pick<DarRepository>(
    ref,
    () => ApiDarRepository(ref.watch(apiClientProvider)),
    () => MockDarRepository(ref.watch(mockTrackerStoreProvider)),
  ),
);
final phaseRepositoryProvider = Provider<PhaseRepository>(
  (ref) => _pick<PhaseRepository>(
    ref,
    () => ApiPhaseRepository(ref.watch(apiClientProvider)),
    () => MockPhaseRepository(ref.watch(mockStoreProvider)),
  ),
);
final phasesProvider = FutureProvider.family<List<PhaseInfo>, String>(
  (ref, id) => ref.watch(phaseRepositoryProvider).phases(id),
);

final projectAdminRepositoryProvider = Provider<ProjectAdminRepository>(
  (ref) => _pick<ProjectAdminRepository>(
    ref,
    () => ApiProjectAdminRepository(ref.watch(apiClientProvider)),
    () => MockProjectAdminRepository(ref.watch(mockStoreProvider)),
  ),
);

/// GET /auth/me/permissions → {record: {action: bool}}, parsed strictly. Demo: the m8-polish
/// default rules for the demo user's role.
/// Raw GET /auth/me/permissions (null in demo mode or signed out).
final permissionsBodyProvider = FutureProvider<Map<String, dynamic>?>((
  ref,
) async {
  final u = await ref.watch(authProvider.future);
  if (u == null || AppConfig.demoMode) return null;
  return ref.watch(apiClientProvider).get('/auth/me/permissions');
});

final permissionsProvider = FutureProvider<PermissionGrid>((ref) async {
  final u = await ref.watch(authProvider.future);
  if (u == null) return const {};
  if (AppConfig.demoMode) return defaultPermissions(u.systemRole);
  return parsePermissions(await ref.watch(permissionsBodyProvider.future));
});

/// FR-ACL-21: allowed My tasks tabs (server `myTasksTabs`, else the same rule locally).
/// Null while permissions load.
final myTasksTabsProvider = Provider<List<String>?>((ref) {
  final grid = ref.watch(permissionsProvider).value;
  if (grid == null) return null;
  return parseMyTasksTabs(ref.watch(permissionsBodyProvider).value) ??
      myTasksTabsFor(grid);
});

/// D7: `canCreateProject` / `canCreateTask` from /auth/me/permissions, else the grid.
bool canCreateProjectW(WidgetRef ref) {
  final v = ref.watch(permissionsBodyProvider).value?['canCreateProject'];
  return v is bool
      ? v && canW(ref, 'projects', 'create')
      : canW(ref, 'projects', 'create');
}

bool canCreateTaskW(WidgetRef ref) {
  final v = ref.watch(permissionsBodyProvider).value?['canCreateTask'];
  return v is bool ? v : true;
}

/// useCan(record, action). False while permissions load, so write controls never flash on.
bool can(Ref ref, String record, String action) =>
    hasPermission(ref.watch(permissionsProvider).value, record, action);

/// Same as [can] for widgets.
bool canW(WidgetRef ref, String record, String action) =>
    hasPermission(ref.watch(permissionsProvider).value, record, action);

/// project.can.edit (web ProjectDetailPage). Demo: projects.edit and (Admin or the project's PM).
bool canEditProject(WidgetRef ref, Project p) {
  if (p.can != null) return p.can!['edit'] == true;
  final u = ref.watch(authProvider).value;
  return canW(ref, 'projects', 'edit') &&
      u != null &&
      (u.isAdmin || (u.systemRole == 'PROJECT_MANAGER' && p.managerId == u.id));
}

/// project.can.planTasks. Demo mirrors the server: open, tasks.edit and isPlanner (Admin or PM).
bool canPlanTasks(WidgetRef ref, Project p) {
  if (p.can != null) return p.can!['planTasks'] == true;
  final u = ref.watch(authProvider).value;
  return !p.archived &&
      p.status != ProjectStatus.completed &&
      canW(ref, 'tasks', 'edit') &&
      u != null &&
      (u.isAdmin || (u.systemRole == 'PROJECT_MANAGER' && p.managerId == u.id));
}

/// project.can.activity: Admins and PMs, or View on audit (doc 11 §12).
bool canProjectActivity(WidgetRef ref, Project p) {
  if (p.can != null) return p.can!['activity'] == true;
  final u = ref.watch(authProvider).value;
  return u != null &&
      (u.isAdmin ||
          u.systemRole == 'PROJECT_MANAGER' ||
          canW(ref, 'audit', 'view'));
}

/// The date shown on the Day timesheet (shared by the tab and My tasks › Day timesheet).
class SelectedDay extends Notifier<DateTime> {
  @override
  DateTime build() => ref.watch(todayPhProvider);
  void set(DateTime d) => state = DateTime(d.year, d.month, d.day);
}

final selectedDayProvider = NotifierProvider<SelectedDay, DateTime>(
  SelectedDay.new,
);

enum DayMode { day, hours }

class DayModeController extends Notifier<DayMode> {
  @override
  DayMode build() => DayMode.day;
  void set(DayMode m) => state = m;
}

final dayModeProvider = NotifierProvider<DayModeController, DayMode>(
  DayModeController.new,
);

/// dayTimesheetProvider((date, userId)) — userId null = me.
final dayTimesheetProvider =
    FutureProvider.family<TrackerDay, (DateTime, String?)>(
      (ref, a) => ref.watch(trackerRepositoryProvider).day(a.$1, userId: a.$2),
    );

/// Time-lock setting (either shape). Null when unknown (demo, 403, older API).
final timeLockProvider = FutureProvider<TimeLockPolicy?>((ref) async {
  if (AppConfig.demoMode) return const TimeLockPolicy(enabled: true);
  try {
    return TimeLockPolicy.fromJson(
      await ref.watch(apiClientProvider).get('/settings/time-lock'),
    );
  } catch (_) {
    return null;
  }
});

final runningProvider = FutureProvider<Running>(
  (ref) => ref.watch(trackerRepositoryProvider).running(),
);
final lookupsProvider = FutureProvider<Lookups>(
  (ref) => ref.watch(trackerRepositoryProvider).lookups(),
);
final trackerPeopleProvider = FutureProvider<List<IdName>>(
  (ref) => ref.watch(trackerRepositoryProvider).people(),
);
final myTasksV2Provider =
    FutureProvider.family<MyTasksResult, (String, String)>(
      (ref, a) =>
          ref.watch(myTasksRepositoryProvider).mine(view: a.$1, query: a.$2),
    );
final hoursWeekProvider = FutureProvider.family<List<HoursEntry>, DateTime>(
  (ref, d) => ref.watch(hoursRepositoryProvider).week(d),
);
final projectTypesProvider = FutureProvider<List<ProjectTypeInfo>>(
  (ref) => ref.watch(projectAdminRepositoryProvider).projectTypes(),
);
final savedReportsProvider =
    FutureProvider.family<List<SavedReport>, (DateTime?, DateTime?)>(
      (ref, a) => ref.watch(darRepositoryProvider).saved(from: a.$1, to: a.$2),
    );
final savedReportProvider = FutureProvider.family<SavedReport, String>(
  (ref, id) => ref.watch(darRepositoryProvider).savedDetail(id),
);

class ProjectTypeFilter extends Notifier<String?> {
  @override
  String? build() => null;
  void set(String? id) => state = id;
}

/// null = All project types, 'none' = Not set.
final projectTypeFilterProvider = NotifierProvider<ProjectTypeFilter, String?>(
  ProjectTypeFilter.new,
);

/// Refresh everything the tracker touches.
void invalidateTracker(WidgetRef ref) {
  ref.invalidate(dayTimesheetProvider);
  ref.invalidate(runningProvider);
  ref.invalidate(hoursWeekProvider);
  ref.invalidate(myTasksV2Provider);
  ref.invalidate(dashboardProvider);
}

/// Polls GET /tracker/running every 30 s (driven by the ticker).
void pollRunning(Ref ref) {
  ref.listen(tickerProvider, (_, next) {
    final i = next.value ?? 0;
    if (i > 0 && i % 30 == 0) ref.invalidate(runningProvider);
  });
}

final runningPollerProvider = Provider<void>((ref) => pollRunning(ref));
