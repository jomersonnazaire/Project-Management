import 'api_client.dart';
import 'http_factory.dart';
import 'models.dart';
import 'repositories.dart';

String dateOnly(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

List<Map<String, dynamic>> _items(Map<String, dynamic> body) => [
  for (final i in (body['items'] as List? ?? const []))
    i as Map<String, dynamic>,
];

class ApiAuthRepository implements AuthRepository {
  ApiAuthRepository(this.api);
  final ApiClient api;

  @override
  Future<AppUser?> currentUser() async {
    // Native: only call the API when a non-expired session was restored from secure storage.
    if (!await api.restoreSession() && !browserManagesCookies) return null;
    try {
      // Mobile token: refresh extends the 3-day sliding window (feature/mobile-sessions-api).
      Map<String, dynamic> body;
      if (api.bearer != null) {
        try {
          body = await api.post('/auth/mobile/refresh');
        } on ApiException catch (e) {
          // API without /auth/mobile/* (rolled back): a 404 is not "disconnected".
          if (e.status != 404) rethrow;
          body = await api.get('/auth/me');
        }
      } else {
        body = await api.get('/auth/me');
      }
      return AppUser.fromJson(body['user'] as Map<String, dynamic>);
    } on ApiException catch (e) {
      if (e.status == 401) return null;
      rethrow;
    }
  }

  @override
  Future<AppUser> login(String email, String password) async {
    // Always a fresh sign-in against the API: drop any stored token/cookie first, so a
    // failed attempt can never fall back to an earlier session.
    await api.clearSession();
    final creds = {'email': email, 'password': password};
    // Native apps use the mobile sign-in (device token in the body). Browsers can't (the API
    // refuses it when Origin/Sec-Fetch-* are present), so the web build keeps the cookie.
    if (!browserManagesCookies) {
      try {
        final body = await api.post('/auth/mobile/login', creds);
        api.bearer = body['token'] as String;
        await api.touch();
        return AppUser.fromJson(body['user'] as Map<String, dynamic>);
      } on ApiException catch (e) {
        // Older API without the mobile endpoint (404), or a proxy that makes the request
        // look like a browser (403 MOBILE_ONLY): use the standard cookie session.
        if (e.status != 404 && e.code != 'MOBILE_ONLY') rethrow;
      }
    }
    final body = await api.post('/auth/login', creds);
    return AppUser.fromJson(body['user'] as Map<String, dynamic>);
  }

  @override
  Future<void> logout() async {
    try {
      await api.post(
        api.bearer != null ? '/auth/mobile/logout' : '/auth/logout',
      );
    } on ApiException {
      // Offline or already ended: still forget the session on this device.
    } finally {
      await api.clearSession();
    }
  }

  @override
  Future<void> setupPassword(String token, String password) =>
      api.post('/auth/setup-password', {'token': token, 'password': password});

  @override
  Future<bool> microsoftAvailable() async {
    try {
      final body = await api.get('/auth/providers');
      return body['microsoft'] == true;
    } on ApiException {
      return false;
    }
  }
}

class ApiProjectRepository implements ProjectRepository {
  ApiProjectRepository(this.api);
  final ApiClient api;

  @override
  Future<List<Project>> list({
    String? query,
    ProjectStatus? status,
    String? projectTypeId,
  }) async {
    final body = await api.get('/projects', {
      if (query != null && query.isNotEmpty) 'q': query,
      if (status != null && status != ProjectStatus.other) 'status': status.api,
      'pageSize': '100',
      'projectTypeId': ?projectTypeId,
    });
    return _items(body).map(Project.fromJson).toList();
  }

  @override
  Future<Project> get(String id) async => Project.fromJson(
    (await api.get('/projects/$id'))['project'] as Map<String, dynamic>,
  );

  @override
  Future<List<Task>> tasks(String projectId) async =>
      _items(await api.get('/projects/$projectId/tasks'))
          .map(Task.fromJson)
          .toList();

  @override
  Future<Task> createTask(String projectId, NewTask t) async {
    final body = await api.post('/projects/$projectId/tasks', {
      'name': t.name,
      if (t.phase != null && t.phase!.isNotEmpty) 'phase': t.phase,
      'priority': t.priority.api,
      'party': t.party.api,
      'plannedStart': t.plannedStart == null ? null : dateOnly(t.plannedStart!),
      'dueDate': t.dueDate == null ? null : dateOnly(t.dueDate!),
      'estHours': t.estHours,
      'requiresApproval': t.requiresApproval,
      'mandatory': t.mandatory,
      if (t.ownerId != null) 'ownerId': t.ownerId,
      'assigneeIds': t.assigneeIds,
      'dependsOn': t.dependsOn,
      if (t.reviewerId != null) 'reviewerId': t.reviewerId,
    });
    return Task.fromJson(body['task'] as Map<String, dynamic>);
  }
}

class ApiTaskRepository implements TaskRepository {
  ApiTaskRepository(this.api);
  final ApiClient api;

  @override
  Future<List<Task>> mine() async =>
      _items(await api.get('/tasks/mine')).map(Task.fromJson).toList();

  @override
  Future<Task> get(String id) async => Task.fromJson(
    (await api.get('/tasks/$id'))['task'] as Map<String, dynamic>,
  );

  @override
  Future<Task> changeStatus(Task task, TaskStatus to, {String? reason}) async {
    if (to == TaskStatus.blocked && (reason == null || reason.trim().isEmpty)) {
      throw ApiException('A reason is required to block a task.');
    }
    final body = task.status == TaskStatus.blocked
        ? await api.post('/tasks/${task.id}/unblock', {'version': task.version})
        : await api.post('/tasks/${task.id}/status', {
            'status': to.api,
            'version': task.version,
            if (reason != null && reason.trim().isNotEmpty)
              'reason': reason.trim(),
          });
    final dto = body['task'];
    return dto is Map<String, dynamic> ? Task.fromJson(dto) : get(task.id);
  }
}

class ApiTimeRepository implements TimeRepository {
  ApiTimeRepository(this.api);
  final ApiClient api;

  @override
  Future<TimeWeek> week(DateTime day) async {
    final b = await api.get('/time', {'week': dateOnly(day)});
    return TimeWeek(
      weekStart: DateTime.parse(b['weekStart'] as String),
      entries: _items(b).map(TimeEntry.fromJson).toList(),
      total: (b['total'] as num? ?? 0).toDouble(),
      capacity: (b['capacity'] as num? ?? 40).toDouble(),
    );
  }

  @override
  Future<List<LoggableProject>> options() async => [
    for (final p in _items(await api.get('/time/options')))
      LoggableProject(
        id: (p['project'] as Map)['id'] as String,
        name: (p['project'] as Map)['name'] as String,
        tasks: [
          for (final t in p['tasks'] as List)
            (id: (t as Map)['id'] as String, name: t['name'] as String),
        ],
      ),
  ];

  @override
  Future<void> log({
    required String taskId,
    required DateTime date,
    required double hours,
    String? notes,
  }) => api.post('/time', {
    'taskId': taskId,
    'workDate': dateOnly(date),
    'hours': hours,
    if (notes != null && notes.isNotEmpty) 'notes': notes,
  });
}

class ApiNotificationRepository implements NotificationRepository {
  ApiNotificationRepository(this.api);
  final ApiClient api;

  @override
  Future<List<AppNotification>> list() async =>
      _items(await api.get('/notifications'))
          .map(AppNotification.fromJson)
          .toList();

  @override
  Future<void> markAllRead() => api.post('/notifications/read-all');
}

class ApiIssueRepository implements IssueRepository {
  ApiIssueRepository(this.api);
  final ApiClient api;

  @override
  Future<List<Issue>> list({String? projectId}) async => _items(
    projectId == null
        ? await api.get('/issues')
        : await api.get('/projects/$projectId/issues'),
  ).map(Issue.fromJson).toList();
}
