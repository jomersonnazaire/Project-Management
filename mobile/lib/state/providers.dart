import 'v2_providers.dart';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config.dart';
import '../data/api_client.dart';
import '../data/ph_time.dart';
import '../data/session_store.dart';
import '../data/api_repositories.dart';
import '../data/http_factory.dart';
import '../data/mock_repositories.dart';
import '../data/models.dart';
import '../data/ms_sign_in.dart';
import '../data/repositories.dart';

/// Override in tests / demo. Defaults: API when API_BASE_URL is set, otherwise mock data.
final mockStoreProvider = Provider<MockStore>((ref) => MockStore());

/// Secure storage for the session cookie (overridden with a memory store in tests).
final sessionStoreProvider = Provider<SessionStore>(
  (ref) => SecureSessionStore(),
);

/// Device clock; only used to measure the server offset (tests override it).
final deviceClockProvider = Provider<DateTime Function()>(
  (ref) => DateTime.now,
);

final apiClientProvider = Provider<ApiClient>((ref) {
  final api = ApiClient(
    AppConfig.apiBaseUrl,
    store: ref.watch(sessionStoreProvider),
    deviceClock: ref.watch(deviceClockProvider),
  );
  // 401 → back to sign-in; unreachable → the Disconnected banner (never a logout).
  api.onUnauthorized = () =>
      Future.microtask(() => ref.read(authProvider.notifier).sessionEnded());
  api.onReachability = (ok) =>
      Future.microtask(() => ref.read(connectionProvider.notifier).set(ok));
  return api;
});

/// false while the API is unreachable (offline, timeout, DNS, 5xx).
class ConnectionController extends Notifier<bool> {
  @override
  bool build() => true;
  void set(bool ok) {
    if (state != ok) state = ok;
  }
}

final connectionProvider = NotifierProvider<ConnectionController, bool>(
  ConnectionController.new,
);

T _pick<T>(Ref ref, T Function(ApiClient) api, T Function(MockStore) mock) =>
    AppConfig.demoMode
    ? mock(ref.watch(mockStoreProvider))
    : api(ref.watch(apiClientProvider));

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => _pick<AuthRepository>(
    ref,
    ApiAuthRepository.new,
    (_) => MockAuthRepository(),
  ),
);
final projectRepositoryProvider = Provider<ProjectRepository>(
  (ref) => _pick<ProjectRepository>(
    ref,
    ApiProjectRepository.new,
    MockProjectRepository.new,
  ),
);
final taskRepositoryProvider = Provider<TaskRepository>(
  (ref) =>
      _pick<TaskRepository>(ref, ApiTaskRepository.new, MockTaskRepository.new),
);
final timeRepositoryProvider = Provider<TimeRepository>(
  (ref) =>
      _pick<TimeRepository>(ref, ApiTimeRepository.new, MockTimeRepository.new),
);
final notificationRepositoryProvider = Provider<NotificationRepository>(
  (ref) => _pick<NotificationRepository>(
    ref,
    ApiNotificationRepository.new,
    MockNotificationRepository.new,
  ),
);
final issueRepositoryProvider = Provider<IssueRepository>(
  (ref) => _pick<IssueRepository>(
    ref,
    ApiIssueRepository.new,
    MockIssueRepository.new,
  ),
);

/// "Today" — overridable so tests and goldens are deterministic.
/// Wall-clock "now" in PH time for date limits. Live: server time, never the device clock.
final clockProvider = Provider<DateTime Function()>((ref) {
  if (AppConfig.demoMode) {
    return () => MockStore.today.add(const Duration(hours: 14));
  }
  final api = ref.watch(apiClientProvider);
  return () {
    final p = toPh(api.serverNow());
    return DateTime(p.year, p.month, p.day, p.hour, p.minute, p.second);
  };
});

class AuthController extends AsyncNotifier<AppUser?> {
  @override
  Future<AppUser?> build() => ref.watch(authRepositoryProvider).currentUser();

  Future<void> login(String email, String password) async {
    final user = await ref.read(authRepositoryProvider).login(email, password);
    state = AsyncData(user);
  }

  Future<void> loginWithMicrosoftResult(AppUser user) async {
    state = AsyncData(user);
  }

  Future<void> logout() async {
    await ref.read(authRepositoryProvider).logout();
    state = const AsyncData(null);
  }

  /// The server said 401: the session is gone, so sign in again.
  void sessionEnded() {
    if (state.value != null) state = const AsyncData(null);
  }

  /// App open/resume: refresh the sliding session (GET /auth/me touches it server-side).
  /// Offline keeps the user signed in; only a 401 signs out.
  Future<void> refreshSession() async {
    if (AppConfig.demoMode || state.value == null) return;
    try {
      final u = await ref.read(authRepositoryProvider).currentUser();
      if (u == null) state = const AsyncData(null);
    } on ApiException {
      // Disconnected banner handles it.
    }
  }

  /// Retry after a connection failure at start-up.
  Future<void> retry() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref.read(authRepositoryProvider).currentUser(),
    );
  }
}

final authProvider = AsyncNotifierProvider<AuthController, AppUser?>(
  AuthController.new,
);

class MsSignInErrorController extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? message) => state = message;
}

final msSignInErrorProvider =
    NotifierProvider<MsSignInErrorController, String?>(
      MsSignInErrorController.new,
    );

final msSignInProvider = Provider<MicrosoftSignIn>((ref) {
  final ms = MicrosoftSignIn(api: ref.watch(apiClientProvider));
  ref.onDispose(ms.dispose);
  return ms;
});

final msAvailableProvider = FutureProvider<bool>((ref) async {
  if (AppConfig.demoMode || browserManagesCookies) return false;
  return ref.read(authRepositoryProvider).microsoftAvailable();
});

/// In-app appearance setting (proposal: kept in memory, not persisted).
class ThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => ThemeMode.system;
  void set(ThemeMode m) => state = m;
}

final themeModeProvider = NotifierProvider<ThemeModeController, ThemeMode>(
  ThemeModeController.new,
);

class ProjectFilter extends Notifier<ProjectStatus?> {
  @override
  ProjectStatus? build() => null;
  void set(ProjectStatus? s) => state = s;
}

final projectFilterProvider = NotifierProvider<ProjectFilter, ProjectStatus?>(
  ProjectFilter.new,
);

final projectsProvider = FutureProvider<List<Project>>(
  (ref) => ref
      .watch(projectRepositoryProvider)
      .list(
        status: ref.watch(projectFilterProvider),
        projectTypeId: ref.watch(projectTypeFilterProvider),
      ),
);
final projectProvider = FutureProvider.family<Project, String>(
  (ref, id) => ref.watch(projectRepositoryProvider).get(id),
);
final projectTasksProvider = FutureProvider.family<List<Task>, String>(
  (ref, id) => ref.watch(projectRepositoryProvider).tasks(id),
);
final myTasksProvider = FutureProvider<List<Task>>(
  (ref) => ref.watch(taskRepositoryProvider).mine(),
);
final taskProvider = FutureProvider.family<Task, String>(
  (ref, id) => ref.watch(taskRepositoryProvider).get(id),
);
final notificationsProvider = FutureProvider<List<AppNotification>>(
  (ref) => ref.watch(notificationRepositoryProvider).list(),
);
final issuesProvider = FutureProvider.family<List<Issue>, String?>(
  (ref, projectId) =>
      ref.watch(issueRepositoryProvider).list(projectId: projectId),
);
final timeWeekProvider = FutureProvider.family<TimeWeek, DateTime>(
  (ref, day) => ref.watch(timeRepositoryProvider).week(day),
);
final timeOptionsProvider = FutureProvider<List<LoggableProject>>(
  (ref) => ref.watch(timeRepositoryProvider).options(),
);

/// Home KPIs. The repo's dashboard KPI endpoints are in unmerged PRs (#10–#15), so these
/// are derived client-side from /tasks/mine and /time.
class DashboardData {
  const DashboardData({
    required this.open,
    required this.blocked,
    required this.dueThisWeek,
    required this.hours,
    required this.dueSoon,
  });
  final int open, blocked, dueThisWeek;
  final double hours;
  final List<Task> dueSoon;
}

final dashboardProvider = FutureProvider<DashboardData>((ref) async {
  final now = ref.watch(clockProvider)();
  final tasks = await ref.watch(myTasksProvider.future);
  final week = await ref.watch(
    timeWeekProvider(DateTime(now.year, now.month, now.day)).future,
  );
  final horizon = now.add(const Duration(days: 7));
  final open = tasks
      .where(
        (t) => t.status != TaskStatus.done && t.status != TaskStatus.cancelled,
      )
      .toList();
  final due =
      open
          .where((t) => t.dueDate != null && t.dueDate!.isBefore(horizon))
          .toList()
        ..sort((a, b) => a.dueDate!.compareTo(b.dueDate!));
  return DashboardData(
    open: open.length,
    blocked: open.where((t) => t.status == TaskStatus.blocked).length,
    dueThisWeek: due.length,
    hours: week.total,
    dueSoon: due.take(3).toList(),
  );
});

/// Refresh everything that depends on a task after a change.
void invalidateTask(WidgetRef ref, Task t) {
  ref.invalidate(taskProvider(t.id));
  ref.invalidate(projectTasksProvider(t.projectId));
  ref.invalidate(myTasksProvider);
  ref.invalidate(dashboardProvider);
}

/// Riverpod 3 retries failed providers by default. API errors are not retried
/// automatically: 4xx won't change, and 5xx/offline show the error state with Retry.
Duration? noAutoRetry(int retryCount, Object error) {
  if (error is ApiException) return null;
  if (retryCount >= 3) return null;
  return Duration(milliseconds: 200 * (1 << retryCount));
}
