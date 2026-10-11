import 'models.dart';
import 'repositories.dart';

/// In-memory sample data matching the hi-fi mockups. Used in demo mode
/// (no API_BASE_URL), in tests, and for "proposal" features.
class MockStore {
  MockStore() {
    _seed();
  }

  final projects = <Project>[];
  final tasks = <Task>[];
  final entries = <TimeEntry>[];
  final notifications = <AppNotification>[];
  final issues = <Issue>[];
  static final today = DateTime(2026, 10, 11);

  void _seed() {
    DateTime d(int m, int day) => DateTime(2026, m, day);
    projects.addAll([
      Project(
        id: 'p1',
        name: 'Acme Corp rollout',
        clientName: 'Acme Corp',
        status: ProjectStatus.active,
        progress: 78,
        goLive: d(10, 30),
        managerName: 'Jomerson Nazaire',
        taskCount: 7,
        projectTypeId: 'pt1',
        projectTypeName: 'Implementation',
        clientId: 'c1',
        managerId: 'u1',
        startDate: DateTime(2026, 8, 3),
        code: 'ACME-01',
      ),
      Project(
        id: 'p2',
        name: 'Globex ERP',
        clientName: 'Globex',
        status: ProjectStatus.active,
        progress: 52,
        goLive: d(11, 18),
        managerName: 'Queen R.',
        taskCount: 1,
        projectTypeId: 'pt7',
        projectTypeName: 'Migration',
        clientId: 'c2',
        managerId: 'u2',
        startDate: DateTime(2026, 9, 1),
        code: 'GLX-01',
      ),
      Project(
        id: 'p3',
        name: 'Initech CRM',
        clientName: 'Initech',
        status: ProjectStatus.onHold,
        progress: 30,
        goLive: d(12, 2),
        managerName: 'Mark K.',
        taskCount: 0,
        projectTypeId: 'pt10',
        projectTypeName: 'Legacy rollout',
        projectTypeActive: false,
        clientId: 'c3',
        managerId: 'u3',
        startDate: DateTime(2026, 7, 6),
        code: 'INI-CRM',
      ),
      Project(
        id: 'p4',
        name: 'Umbrella onboarding',
        clientName: 'Umbrella',
        status: ProjectStatus.planning,
        progress: 8,
        goLive: DateTime(2027, 1, 10),
        managerName: 'Jomerson Nazaire',
        taskCount: 0,
        clientId: 'c4',
        managerId: 'u1',
        startDate: DateTime(2026, 10, 5),
        code: 'UMB-ONB',
      ),
    ]);
    Task t(
      String id,
      String name,
      String phase,
      TaskStatus s,
      Priority p, {
      String project = 'p1',
      String pn = 'Acme Corp',
      DateTime? due,
      String owner = 'Jomerson Nazaire',
      List<String> assignees = const ['Jomerson Nazaire'],
      String? blocker,
      bool approval = false,
      double? est,
      double actual = 0,
      Party party = Party.internal,
      List<String> deps = const [],
    }) => Task(
      id: id,
      projectId: project,
      projectName: pn,
      name: name,
      phase: phase,
      status: s,
      priority: p,
      dueDate: due,
      plannedStart: due?.subtract(const Duration(days: 6)),
      ownerName: owner,
      assignees: assignees,
      blockerReason: blocker,
      requiresApproval: approval,
      reviewerName: approval ? 'Queen R.' : null,
      approvalState: approval ? 'PENDING' : 'NONE',
      estHours: est,
      actualHours: actual,
      party: party,
      dependsOn: deps,
      previousStatus: s == TaskStatus.blocked ? TaskStatus.inProgress : null,
    );
    tasks.addAll([
      t(
        't1',
        'Requirements workshop',
        'Phase 1 · Discovery',
        TaskStatus.done,
        Priority.medium,
        due: d(10, 2),
        est: 6,
        actual: 6,
      ),
      t(
        't2',
        'Environment setup',
        'Phase 1 · Discovery',
        TaskStatus.done,
        Priority.medium,
        due: d(10, 4),
        est: 4,
        actual: 5,
      ),
      t(
        't3',
        'Configure roles',
        'Phase 2 · Configuration',
        TaskStatus.inProgress,
        Priority.medium,
        due: d(10, 13),
        assignees: ['Queen R.'],
        est: 8,
        actual: 3,
      ),
      t(
        't4',
        'Configure SSO',
        'Phase 2 · Configuration',
        TaskStatus.blocked,
        Priority.critical,
        due: d(10, 14),
        assignees: ['Queen R.', 'Mark K.'],
        blocker: 'Waiting on client IdP metadata XML',
        approval: true,
        est: 8,
        actual: 6,
        party: Party.client,
        deps: ['t2'],
      ),
      t(
        't5',
        'Collect org chart',
        'Phase 2 · Configuration',
        TaskStatus.todo,
        Priority.low,
        due: d(10, 16),
        party: Party.client,
      ),
      t(
        't6',
        'Data migration dry run',
        'Phase 3 · Migration',
        TaskStatus.inProgress,
        Priority.high,
        due: d(10, 12),
        est: 12,
        actual: 4,
      ),
      t(
        't7',
        'UAT sign-off',
        'Phase 4 · UAT',
        TaskStatus.forReview,
        Priority.high,
        due: d(10, 11),
        approval: true,
        est: 2,
        actual: 2,
      ),
      t(
        't8',
        'Data migration dry run',
        'Phase 2 · Build',
        TaskStatus.inProgress,
        Priority.medium,
        project: 'p2',
        pn: 'Globex',
        due: d(10, 12),
        est: 10,
        actual: 4,
      ),
    ]);
    entries.addAll([
      TimeEntry(
        id: 'e1',
        projectName: 'Globex',
        taskName: 'Data migration dry run',
        workDate: d(10, 9),
        hours: 4,
      ),
      TimeEntry(
        id: 'e2',
        projectName: 'Acme Corp',
        taskName: 'UAT sign-off',
        workDate: d(10, 8),
        hours: 2,
      ),
      TimeEntry(
        id: 'e3',
        projectName: 'Acme Corp',
        taskName: 'Configure SSO',
        workDate: d(10, 7),
        hours: 6,
      ),
      TimeEntry(
        id: 'e4',
        projectName: 'Acme Corp',
        taskName: 'Configure roles',
        workDate: d(10, 6),
        hours: 3,
      ),
      TimeEntry(
        id: 'e5',
        projectName: 'Globex',
        taskName: 'Data migration dry run',
        workDate: d(10, 5),
        hours: 8,
      ),
      TimeEntry(
        id: 'e6',
        projectName: 'Acme Corp',
        taskName: 'Environment setup',
        workDate: d(10, 5),
        hours: 8.5,
      ),
    ]);
    notifications.addAll([
      AppNotification(
        id: 'n5',
        title: 'Queen Reyes reopened your timesheet for Thu, Oct 8: "Add the client call." Make your changes and submit it again before the weekly lock.',
        subtitle: '',
        read: false,
        at: DateTime(2026, 10, 11, 10),
        link: '/my-tasks?tab=day&date=2026-10-08',
      ),
      AppNotification(
        id: 'n6',
        title: 'Mark Kim recorded Vacation leave for Oct 19 – Oct 20.',
        subtitle: '',
        read: true,
        at: DateTime(2026, 10, 10, 9),
        link: '/leave?tab=team',
      ),
      AppNotification(
        id: 'n7',
        title: 'Queen R. raised a Critical issue',
        subtitle: 'ACME-12 Login loop on Safari · Acme Corp',
        read: true,
        at: DateTime(2026, 10, 9, 10),
        issueId: 'i1',
      ),
      AppNotification(
        id: 'n1',
        title: 'Queen R. requested your approval',
        subtitle: 'UAT sign-off · Acme Corp',
        read: false,
        at: DateTime(2026, 10, 11, 9, 45),
        taskId: 't7',
      ),
      AppNotification(
        id: 'n2',
        title: 'You were assigned a task',
        subtitle: 'Configure roles · Globex',
        read: false,
        at: DateTime(2026, 10, 11, 8),
        taskId: 't3',
      ),
      AppNotification(
        id: 'n3',
        title: 'Project handed over to you',
        subtitle: 'Initech CRM',
        read: true,
        at: DateTime(2026, 10, 11, 7),
      ),
      AppNotification(
        id: 'n4',
        title: 'Task marked Done',
        subtitle: 'Environment setup · Acme',
        read: true,
        at: DateTime(2026, 10, 4, 10),
        taskId: 't2',
      ),
      AppNotification(
        id: 'n5',
        title: 'Document request fulfilled',
        subtitle: 'Signed SOW · Acme',
        read: true,
        at: DateTime(2026, 10, 3, 15),
      ),
    ]);
    issues.addAll(const [
      Issue(
        id: 'i1',
        key: 'ACME-12',
        title: 'Login loop on Safari',
        projectName: 'Acme Corp',
        severity: Priority.critical,
        status: 'OPEN',
        ownerName: 'Queen R.',
      ),
      Issue(
        id: 'i2',
        key: 'GLX-7',
        title: 'Report totals mismatch',
        projectName: 'Globex',
        severity: Priority.high,
        status: 'IN_PROGRESS',
        ownerName: 'Mark K.',
      ),
      Issue(
        id: 'i3',
        key: 'INT-3',
        title: 'Missing currency field',
        projectName: 'Initech',
        severity: Priority.medium,
        status: 'OPEN',
      ),
      Issue(
        id: 'i4',
        key: 'ACME-9',
        title: 'Slow import >10k rows',
        projectName: 'Acme Corp',
        severity: Priority.low,
        status: 'OPEN',
      ),
      Issue(
        id: 'i5',
        key: 'ACME-4',
        title: 'Typo on welcome email',
        projectName: 'Acme Corp',
        severity: Priority.low,
        status: 'CLOSED',
      ),
    ]);
  }
}

class MockAuthRepository implements AuthRepository {
  MockAuthRepository({
    this.signedIn = false,
    this.systemRole = 'PROJECT_MANAGER',
  });
  bool signedIn;

  /// Demo role. Sign in as admin@…, member@… or viewer@… to try the other roles.
  String systemRole;
  static const user = AppUser(
    id: 'u1',
    name: 'Jomerson Nazaire',
    email: 'jomerson@xceler8.com',
    role: 'Project Manager · Consultant',
  );
  AppUser get _me => AppUser(
    id: user.id,
    name: user.name,
    email: user.email,
    role:
        '${const {'ADMIN': 'Admin', 'PROJECT_MANAGER': 'Project Manager', 'MEMBER': 'Member', 'VIEWER': 'Viewer'}[systemRole]} · Consultant',
    systemRole: systemRole,
  );

  @override
  Future<AppUser?> currentUser() async => signedIn ? _me : null;

  @override
  Future<AppUser> login(String email, String password) async {
    if (email.trim().isEmpty || password.isEmpty) {
      throw ApiException('Enter your email and password.');
    }
    if (password == 'locked') {
      throw ApiException(
        'Too many sign-in attempts. Please wait 15 minutes and try again.',
        status: 429,
        code: 'RATE_LIMITED',
      );
    }
    if (password.length < 4) {
      throw ApiException(
        'Email or password is incorrect.',
        status: 401,
        code: 'INVALID_CREDENTIALS',
      );
    }
    final e = email.trim().toLowerCase();
    systemRole = e.startsWith('admin')
        ? 'ADMIN'
        : e.startsWith('member')
        ? 'MEMBER'
        : e.startsWith('viewer')
        ? 'VIEWER'
        : 'PROJECT_MANAGER';
    signedIn = true;
    return _me;
  }

  @override
  Future<void> logout() async => signedIn = false;

  @override
  Future<void> setupPassword(String token, String password) async {}
}

class MockProjectRepository implements ProjectRepository {
  MockProjectRepository(this.store);
  final MockStore store;

  @override
  Future<List<Project>> list({
    String? query,
    ProjectStatus? status,
    String? projectTypeId,
  }) async => store.projects
      .where(
        (p) =>
            projectTypeId == null ||
            (projectTypeId == 'none'
                ? p.projectTypeId == null
                : p.projectTypeId == projectTypeId),
      )
      .where((p) => status == null || p.status == status)
      .where(
        (p) =>
            query == null || p.name.toLowerCase().contains(query.toLowerCase()),
      )
      .toList();

  @override
  Future<Project> get(String id) async =>
      store.projects.firstWhere((p) => p.id == id);

  @override
  Future<List<Task>> tasks(String projectId) async =>
      store.tasks.where((t) => t.projectId == projectId).toList();

  @override
  Future<Task> createTask(String projectId, NewTask n) async {
    final t = Task(
      id: 't${store.tasks.length + 1}',
      projectId: projectId,
      name: n.name,
      phase: n.phase,
      status: TaskStatus.todo,
      priority: n.priority,
      party: n.party,
      plannedStart: n.plannedStart,
      dueDate: n.dueDate,
      estHours: n.estHours,
      requiresApproval: n.requiresApproval,
      mandatory: n.mandatory,
      ownerName: n.ownerName ?? MockAuthRepository.user.name,
      dependsOn: n.dependsOn,
    );
    store.tasks.add(t);
    return t;
  }
}

class MockTaskRepository implements TaskRepository {
  MockTaskRepository(this.store);
  final MockStore store;

  @override
  Future<List<Task>> mine() async =>
      store.tasks
          .where(
            (t) =>
                t.status != TaskStatus.done && t.status != TaskStatus.cancelled,
          )
          .toList()
        ..sort(
          (a, b) => (a.dueDate ?? DateTime(9999)).compareTo(
            b.dueDate ?? DateTime(9999),
          ),
        );

  @override
  Future<Task> get(String id) async =>
      store.tasks.firstWhere((t) => t.id == id);

  @override
  Future<Task> changeStatus(Task task, TaskStatus to, {String? reason}) async {
    if (to == TaskStatus.blocked && (reason == null || reason.trim().isEmpty)) {
      throw ApiException('A reason is required to block a task.');
    }
    if (!allowedTargets(task).contains(to)) {
      throw ApiException(
        "A task can't move from ${task.status.label} to ${to.label}.",
        code: 'INVALID_TRANSITION',
      );
    }
    final actual = to == TaskStatus.done && task.requiresApproval
        ? TaskStatus.forReview
        : to;
    final updated = task.copyWith(
      status: actual,
      previousStatus: actual == TaskStatus.blocked ? task.status : null,
      blockerReason: actual == TaskStatus.blocked ? reason!.trim() : null,
      clearBlocker: actual != TaskStatus.blocked,
    );
    final i = store.tasks.indexWhere((t) => t.id == task.id);
    if (i >= 0) store.tasks[i] = updated;
    return updated;
  }
}

class MockTimeRepository implements TimeRepository {
  MockTimeRepository(this.store);
  final MockStore store;

  static DateTime weekStartOf(DateTime d) {
    final day = DateTime(d.year, d.month, d.day);
    return day.subtract(
      Duration(days: day.weekday - 1),
    ); // Monday, like weekStartOf in the API
  }

  @override
  Future<TimeWeek> week(DateTime anyDay) async {
    final start = weekStartOf(anyDay);
    final end = start.add(const Duration(days: 7));
    final list =
        store.entries
            .where(
              (e) => !e.workDate.isBefore(start) && e.workDate.isBefore(end),
            )
            .toList()
          ..sort((a, b) => b.workDate.compareTo(a.workDate));
    return TimeWeek(
      weekStart: start,
      entries: list,
      total: list.fold(0, (s, e) => s + e.hours),
    );
  }

  @override
  Future<List<LoggableProject>> options() async => [
    for (final p in store.projects)
      if (store.tasks.any((t) => t.projectId == p.id))
        LoggableProject(
          id: p.id,
          name: p.name,
          tasks: [
            for (final t in store.tasks.where((t) => t.projectId == p.id))
              (id: t.id, name: t.name),
          ],
        ),
  ];

  @override
  Future<void> log({
    required String taskId,
    required DateTime date,
    required double hours,
    String? notes,
  }) async {
    if (hours <= 0 || hours > 24) {
      throw ApiException('Enter between 0.25 and 24 hours.');
    }
    final t = store.tasks.firstWhere((t) => t.id == taskId);
    store.entries.add(
      TimeEntry(
        id: 'e${store.entries.length + 1}',
        projectName: t.projectName,
        taskName: t.name,
        workDate: date,
        hours: hours,
        notes: notes,
      ),
    );
    final i = store.tasks.indexOf(t);
    store.tasks[i] = t.copyWith(actualHours: t.actualHours + hours);
  }
}

class MockNotificationRepository implements NotificationRepository {
  MockNotificationRepository(this.store);
  final MockStore store;

  @override
  Future<List<AppNotification>> list() async => List.of(store.notifications);

  @override
  Future<void> markAllRead() async {
    for (var i = 0; i < store.notifications.length; i++) {
      final n = store.notifications[i];
      store.notifications[i] = AppNotification(
        id: n.id,
        title: n.title,
        subtitle: n.subtitle,
        read: true,
        at: n.at,
        taskId: n.taskId,
      );
    }
  }
}

class MockIssueRepository implements IssueRepository {
  MockIssueRepository(this.store);
  final MockStore store;

  @override
  Future<List<Issue>> list({String? projectId}) async {
    if (projectId == null) return List.of(store.issues);
    final name = store.projects.firstWhere((p) => p.id == projectId).clientName;
    return store.issues.where((i) => i.projectName == name).toList();
  }
}
