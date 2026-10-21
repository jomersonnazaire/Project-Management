import 'action_email.dart';
import 'models.dart';

/// Repository interfaces. [ApiRepositories] (api_repositories.dart) talks to the
/// Express API; [MockRepositories] (mock_repositories.dart) backs demo mode, tests,
/// and the features marked "proposal" in the design brief.
abstract interface class AuthRepository {
  /// Restores the session (GET /auth/me). Null when signed out.
  Future<AppUser?> currentUser();
  Future<AppUser> login(String email, String password);
  Future<void> logout();
  Future<void> setupPassword(String token, String password);
  Future<bool> microsoftAvailable();
}

abstract interface class ProjectRepository {
  Future<List<Project>> list({
    String? query,
    ProjectStatus? status,
    String? projectTypeId,
  });
  Future<Project> get(String id);
  Future<List<Task>> tasks(String projectId);

  /// [email]: "Email {name}" / "Email new assignees" (PR #37); filled from the response.
  Future<Task> createTask(String projectId, NewTask task, {EmailOnSave? email});
}

abstract interface class TaskRepository {
  Future<List<Task>> mine();
  Future<Task> get(String id);

  /// Moves a task. [reason] is required when [to] is [TaskStatus.blocked].
  Future<Task> changeStatus(Task task, TaskStatus to, {String? reason});
}

abstract interface class TimeRepository {
  Future<TimeWeek> week(DateTime anyDayInWeek);
  Future<List<LoggableProject>> options();
  Future<void> log({
    required String taskId,
    required DateTime date,
    required double hours,
    String? notes,
  });
}

abstract interface class NotificationRepository {
  Future<List<AppNotification>> list();
  Future<void> markAllRead();
}

abstract interface class IssueRepository {
  Future<List<Issue>> list({String? projectId});
}
