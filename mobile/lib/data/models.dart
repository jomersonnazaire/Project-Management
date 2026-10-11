// Domain models mapped from the Express API DTOs (packages/shared/src).

enum TaskStatus {
  todo('TODO', 'To do'),
  inProgress('IN_PROGRESS', 'In progress'),
  blocked('BLOCKED', 'Blocked'),
  forReview('FOR_REVIEW', 'For review'),
  done('COMPLETED', 'Done'),
  cancelled('CANCELLED', 'Cancelled');

  const TaskStatus(this.api, this.label);
  final String api;
  final String label;

  static TaskStatus fromApi(String? v) =>
      values.firstWhere((s) => s.api == v, orElse: () => TaskStatus.todo);

  /// Kanban columns, in board order.
  static const board = [todo, inProgress, blocked, forReview, done];
}

enum Priority {
  low('LOW', 'Low'),
  medium('MEDIUM', 'Medium'),
  high('HIGH', 'High'),
  critical('CRITICAL', 'Critical');

  const Priority(this.api, this.label);
  final String api;
  final String label;
  static Priority fromApi(String? v) =>
      values.firstWhere((s) => s.api == v, orElse: () => Priority.medium);
}

enum Party {
  internal('INTERNAL', 'Internal'),
  client('CLIENT', 'Client');

  const Party(this.api, this.label);
  final String api;
  final String label;
  static Party fromApi(String? v) => v == 'CLIENT' ? client : internal;
}

enum ProjectStatus {
  planning('PLANNING', 'Planning'),
  active('ACTIVE', 'Active'),
  onHold('ON_HOLD', 'On hold'),
  completed('COMPLETED', 'Completed'),
  other('', 'Other');

  const ProjectStatus(this.api, this.label);
  final String api;
  final String label;
  static ProjectStatus fromApi(String? v) =>
      values.firstWhere((s) => s.api == v, orElse: () => ProjectStatus.other);
}

/// Status moves a user can request, mirroring TASK_TRANSITIONS in the API
/// (packages/shared/src/projects.ts). Blocked returns to the previous status
/// via POST /tasks/:id/unblock. For review is decided by approval on the web.
List<TaskStatus> allowedTargets(Task t) => switch (t.status) {
  TaskStatus.todo => [TaskStatus.inProgress, TaskStatus.blocked],
  TaskStatus.inProgress => [TaskStatus.blocked, TaskStatus.done],
  TaskStatus.blocked => [t.previousStatus ?? TaskStatus.todo],
  TaskStatus.done => [TaskStatus.inProgress],
  TaskStatus.forReview || TaskStatus.cancelled => const [],
};

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;
String? _name(Object? v) => v is Map ? v['name'] as String? : null;
double _num(Object? v) => v is num ? v.toDouble() : 0;

String initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return (parts.first[0] + parts.last[0]).toUpperCase();
}

class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    this.role = '',
    this.systemRole = 'PROJECT_MANAGER',
  });
  final String id, name, email, role;

  /// ADMIN, PROJECT_MANAGER, MEMBER or VIEWER.
  final String systemRole;
  bool get isAdmin => systemRole == 'ADMIN';
  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
    systemRole: j['systemRole'] as String? ?? 'MEMBER',
    id: j['id'] as String,
    name: j['name'] as String? ?? '',
    email: j['email'] as String? ?? '',
    role: [j['systemRole'], j['jobRole']].whereType<String>().join(' · '),
  );
}

class Project {
  const Project({
    required this.id,
    required this.name,
    required this.clientName,
    required this.status,
    required this.progress,
    this.goLive,
    this.managerName,
    this.taskCount = 0,
    this.projectTypeId,
    this.projectTypeName,
    this.projectTypeActive = true,
    this.clientId,
    this.managerId,
    this.startDate,
    this.description,
    this.code,
    this.can,
  });

  /// Server `can` flags (edit, planTasks, activity…); null in demo data.
  final Map<String, bool>? can;
  final String? projectTypeId,
      projectTypeName,
      clientId,
      managerId,
      description,
      code;
  final bool projectTypeActive;
  final DateTime? startDate;
  final String id, name, clientName;
  final ProjectStatus status;

  /// 0..100
  final double progress;
  final DateTime? goLive;
  final String? managerName;
  final int taskCount;

  factory Project.fromJson(Map<String, dynamic> j) => Project(
    id: j['id'] as String,
    name: j['name'] as String? ?? '',
    clientName: j['clientName'] as String? ?? '',
    status: ProjectStatus.fromApi(j['status'] as String?),
    progress: _num(j['progress']),
    goLive: _date(j['plannedEndDate']),
    managerName: j['managerName'] as String?,
    taskCount: (j['taskCount'] as num?)?.toInt() ?? 0,
    projectTypeId: (j['projectType'] as Map?)?['id'] as String?,
    projectTypeName: (j['projectType'] as Map?)?['name'] as String?,
    projectTypeActive: (j['projectType'] as Map?)?['active'] != false,
    clientId: j['clientId'] as String?,
    managerId: j['managerId'] as String?,
    startDate: _date(j['startDate']),
    description: j['description'] as String?,
    code: j['code'] as String?,
    can: j['can'] is Map
        ? {
            for (final e in (j['can'] as Map).entries)
              '${e.key}': e.value == true,
          }
        : null,
  );
}

class Task {
  const Task({
    required this.id,
    required this.projectId,
    required this.name,
    required this.status,
    this.projectName = '',
    this.phase,
    this.priority = Priority.medium,
    this.party = Party.internal,
    this.ownerName,
    this.assignees = const [],
    this.plannedStart,
    this.dueDate,
    this.estHours,
    this.actualHours = 0,
    this.previousStatus,
    this.blockerReason,
    this.dependsOn = const [],
    this.requiresApproval = false,
    this.mandatory = false,
    this.reviewerName,
    this.approvalState = 'NONE',
    this.version = 0,
    this.overdue = false,
  });

  final String id, projectId, name, projectName;
  final String? phase, ownerName, blockerReason, reviewerName;
  final TaskStatus status;
  final TaskStatus? previousStatus;
  final Priority priority;
  final Party party;
  final List<String> assignees, dependsOn;
  final DateTime? plannedStart, dueDate;
  final double? estHours;
  final double actualHours;
  final bool requiresApproval, mandatory, overdue;
  final String approvalState;
  final int version;

  Task copyWith({
    TaskStatus? status,
    TaskStatus? previousStatus,
    String? blockerReason,
    bool clearBlocker = false,
    double? actualHours,
  }) => Task(
    id: id,
    projectId: projectId,
    name: name,
    projectName: projectName,
    phase: phase,
    priority: priority,
    party: party,
    ownerName: ownerName,
    assignees: assignees,
    plannedStart: plannedStart,
    dueDate: dueDate,
    estHours: estHours,
    actualHours: actualHours ?? this.actualHours,
    status: status ?? this.status,
    previousStatus: previousStatus ?? this.previousStatus,
    blockerReason: clearBlocker ? null : (blockerReason ?? this.blockerReason),
    dependsOn: dependsOn,
    requiresApproval: requiresApproval,
    mandatory: mandatory,
    reviewerName: reviewerName,
    approvalState: approvalState,
    version: version + 1,
    overdue: overdue,
  );

  /// Accepts both TaskDto (GET /tasks/:id, /projects/:id/tasks) and MyTaskDto (/tasks/mine).
  factory Task.fromJson(Map<String, dynamic> j, {String projectName = ''}) {
    final approval = j['approval'];
    final project = j['project'];
    return Task(
      id: j['id'] as String,
      projectId:
          (j['projectId'] ?? (project is Map ? project['id'] : '')) as String,
      projectName: _name(project) ?? projectName,
      name: j['name'] as String? ?? '',
      phase: j['phase'] as String?,
      status: TaskStatus.fromApi(j['status'] as String?),
      previousStatus: j['previousStatus'] == null
          ? null
          : TaskStatus.fromApi(j['previousStatus'] as String),
      priority: Priority.fromApi(j['priority'] as String?),
      party: Party.fromApi(j['party'] as String?),
      ownerName: _name(j['owner']),
      assignees: [
        for (final a in (j['assignees'] as List? ?? const [])) _name(a) ?? '',
      ],
      plannedStart: _date(j['plannedStart']),
      dueDate: _date(j['dueDate']),
      estHours: (j['estHours'] as num?)?.toDouble(),
      actualHours: _num(j['actualHours']),
      blockerReason: j['blockerReason'] as String?,
      dependsOn: [for (final d in (j['dependsOn'] as List? ?? const [])) '$d'],
      requiresApproval: j['requiresApproval'] as bool? ?? false,
      mandatory: j['mandatory'] as bool? ?? false,
      reviewerName: _name(j['reviewer']),
      approvalState: approval is Map
          ? approval['state'] as String? ?? 'NONE'
          : 'NONE',
      version: (j['version'] as num?)?.toInt() ?? 0,
      overdue: j['overdue'] as bool? ?? false,
    );
  }
}

class NewTask {
  const NewTask({
    required this.name,
    this.phase,
    this.priority = Priority.medium,
    this.party = Party.internal,
    this.plannedStart,
    this.dueDate,
    this.estHours,
    this.requiresApproval = false,
    this.mandatory = false,
  });
  final String name;
  final String? phase;
  final Priority priority;
  final Party party;
  final DateTime? plannedStart, dueDate;
  final double? estHours;
  final bool requiresApproval, mandatory;
}

class TimeEntry {
  const TimeEntry({
    required this.id,
    required this.projectName,
    required this.taskName,
    required this.workDate,
    required this.hours,
    this.notes,
  });
  final String id, projectName, taskName;
  final DateTime workDate;
  final double hours;
  final String? notes;
  factory TimeEntry.fromJson(Map<String, dynamic> j) => TimeEntry(
    id: j['id'] as String,
    projectName: _name(j['project']) ?? '',
    taskName: _name(j['task']) ?? '',
    workDate: _date(j['workDate']) ?? DateTime.now(),
    hours: _num(j['hours']),
    notes: j['notes'] as String?,
  );
}

class TimeWeek {
  const TimeWeek({
    required this.weekStart,
    required this.entries,
    required this.total,
    this.capacity = 40,
  });
  final DateTime weekStart;
  final List<TimeEntry> entries;
  final double total, capacity;
}

class LoggableProject {
  const LoggableProject({
    required this.id,
    required this.name,
    required this.tasks,
  });
  final String id, name;
  final List<({String id, String name})> tasks;
}

class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.read,
    required this.at,
    this.taskId,
    this.issueId,
    this.link,
  });
  final String id, title, subtitle;
  final bool read;
  final DateTime at;
  final String? taskId, issueId;

  /// Personal notices (day reopened, leave, auto-stopped timer) carry the web path they open.
  final String? link;

  static const _verbs = {
    'ASSIGNED': 'You were assigned a task',
    'FOR_REVIEW': 'requested your approval',
    'APPROVED': 'approved your task',
    'REJECTED': 'returned your task',
    'BLOCKED': 'blocked a task',
    'MENTION': 'mentioned you',
  };

  factory AppNotification.fromJson(Map<String, dynamic> j) {
    final type = j['type'] as String? ?? '';
    final actor = _name(j['actor']);
    final verb = _verbs[type] ?? type.replaceAll('_', ' ').toLowerCase();
    final title = type == 'ASSIGNED' || actor == null ? verb : '$actor $verb';
    final target =
        _name(j['task']) ??
        (j['issue'] is Map ? j['issue']['title'] as String? : null);
    final message = j['message'] as String?;
    if (message != null && message.isNotEmpty) {
      return AppNotification(
        id: j['id'] as String,
        title: message,
        subtitle: _name(j['project']) ?? '',
        read: j['read'] as bool? ?? false,
        at: _date(j['at']) ?? DateTime.now(),
        link: j['link'] as String?,
      );
    }
    return AppNotification(
      id: j['id'] as String,
      title: title.isEmpty
          ? 'Update'
          : title[0].toUpperCase() + title.substring(1),
      subtitle: [target, _name(j['project'])].whereType<String>().join(' · '),
      read: j['read'] as bool? ?? false,
      at: _date(j['at']) ?? DateTime.now(),
      taskId: j['task'] is Map ? j['task']['id'] as String? : null,
      issueId: j['issue'] is Map ? j['issue']['id'] as String? : null,
      link: j['link'] as String?,
    );
  }
}

class Issue {
  const Issue({
    required this.id,
    required this.key,
    required this.title,
    required this.projectName,
    required this.severity,
    required this.status,
    this.ownerName,
  });
  final String id, key, title, projectName, status;
  final Priority severity;
  final String? ownerName;
  bool get isOpen => status != 'RESOLVED' && status != 'CLOSED';
  factory Issue.fromJson(Map<String, dynamic> j) => Issue(
    id: j['id'] as String,
    key: j['key'] as String? ?? '',
    title: j['title'] as String? ?? '',
    projectName: _name(j['project']) ?? '',
    severity: Priority.fromApi(j['severity'] as String?),
    status: j['status'] as String? ?? 'OPEN',
    ownerName: _name(j['owner']),
  );
}

class ApiException implements Exception {
  ApiException(
    this.message, {
    this.status,
    this.code,
    this.fields = const {},
    this.details,
  });
  final String message;
  final int? status;
  final String? code;

  /// 400/422 field errors (`error.details[] {path, message}`), keyed by path.
  final Map<String, String> fields;

  /// Raw `error.details` (e.g. TIMER_RUNNING `{running: {id, name}}`).
  final Object? details;

  bool get isNetworkOrServer => status == null || status! >= 500;
  @override
  String toString() => message;
}
