// P2 (m8-polish): leave, task actions, project detail extras. Models, repositories, mocks.
import 'api_client.dart';
import 'mock_repositories.dart';
import 'models.dart';
import 'ph_time.dart';
import 'v2_repositories.dart';

// ---------------- Leave (packages/shared/src/leave.ts) ----------------

const dayPartLabels = {
  'FULL': 'Full day',
  'AM': 'Half day AM',
  'PM': 'Half day PM',
};
const fullDayAmPm = 'Full day (AM + PM)';
const halfDaySingleDate =
    'A half day is on a single date. Set "To" to the same date.';
const toBeforeFrom = 'Pick a "To" date on or after the "From" date.';
const noWorkingDays = 'This range has no working days. Pick working days.';
const morningTaken = 'You already have leave recorded for this morning.';
const afternoonTaken = 'You already have leave recorded for this afternoon.';
const pastLeaveAdminOnly =
    'Only leave that hasn’t started can be cancelled here. For past leave, ask an Admin.';
const noSupervisorLeave =
    "You don't have a supervisor yet, so your leave notices go to all Admins. Ask an Admin to set your supervisor.";
String _days(num n) => '${fmtNum(n)} ${n == 1 ? 'day' : 'days'}';
String overBalanceMessage(num left, String type, num need) =>
    'You have ${_days(left)} of $type left, and this needs ${_days(need)}. Choose fewer days or another leave type.';
String fullDayTypeMessage(String type) =>
    '$type is taken in full days. Choose Full day.';
String fmtNum(num n) => n == n.roundToDouble() ? '${n.toInt()}' : '$n';

/// leaveDaysLabel: real minus sign (U+2212); null → "–".
String leaveDaysLabel(num? n) =>
    n == null ? '–' : (n < 0 ? '\u2212${fmtNum(n.abs())}' : fmtNum(n));
String leaveRangeLabel(DateTime from, DateTime to) =>
    from == to ? shortDate(from) : '${shortDate(from)} – ${shortDate(to)}';

class LeaveType {
  const LeaveType(
    this.id,
    this.name, {
    this.paid = true,
    this.unit = 'HALF_DAY',
    this.needsDocument = false,
  });
  final String id, name, unit;
  final bool paid, needsDocument;
  bool get fullDaysOnly => unit == 'DAY';
  factory LeaveType.fromJson(Map<String, dynamic> j) => LeaveType(
    '${j['id']}',
    '${j['name']}',
    paid: j['paid'] as bool? ?? true,
    unit: j['unit'] as String? ?? 'HALF_DAY',
    needsDocument: j['needsDocument'] as bool? ?? false,
  );
}

class LeaveItem {
  const LeaveItem({
    required this.id,
    required this.userName,
    required this.typeId,
    required this.typeName,
    required this.dayPart,
    required this.from,
    required this.to,
    required this.days,
    this.reason,
    this.status = 'RECORDED',
    this.canCancel = false,
    this.halves,
  });
  final String id, userName, typeId, typeName, dayPart, status;
  final DateTime from, to;
  final num days;
  final String? reason;
  final bool canCancel;
  final List<LeaveItem>? halves;
  bool get cancelled => status == 'CANCELLED';
  String get partLabel =>
      halves != null ? fullDayAmPm : dayPartLabels[dayPart] ?? dayPart;

  factory LeaveItem.fromJson(Map<String, dynamic> j) => LeaveItem(
    id: '${j['id']}',
    userName: '${(j['user'] as Map?)?['name'] ?? ''}',
    typeId: '${(j['type'] as Map?)?['id'] ?? ''}',
    typeName: '${(j['type'] as Map?)?['name'] ?? ''}',
    dayPart: j['dayPart'] as String? ?? 'FULL',
    from: parseYmd(j['from'] as String),
    to: parseYmd(j['to'] as String),
    days: j['days'] as num? ?? 0,
    reason: j['reason'] as String?,
    status: j['status'] as String? ?? 'RECORDED',
    canCancel: (j['can'] as Map?)?['cancel'] as bool? ?? false,
  );
}

/// DR-33 mergeHalfDays: a recorded AM + PM of the same person, type and date → one row.
List<LeaveItem> mergeHalfDays(List<LeaveItem> items) {
  String key(LeaveItem l) => '${l.userName}|${l.typeId}|${ymd(l.from)}';
  final am = <String, LeaveItem>{}, pm = <String, LeaveItem>{};
  for (final l in items) {
    if (l.cancelled || l.from != l.to) continue;
    if (l.dayPart == 'AM') am.putIfAbsent(key(l), () => l);
    if (l.dayPart == 'PM') pm.putIfAbsent(key(l), () => l);
  }
  final used = <String>{};
  final out = <LeaveItem>[];
  for (final l in items) {
    if (used.contains(l.id)) continue;
    final a = am[key(l)], p = pm[key(l)];
    if (a != null && p != null && (l.id == a.id || l.id == p.id)) {
      used.addAll([a.id, p.id]);
      final reasons = {
        a.reason,
        p.reason,
      }.whereType<String>().where((r) => r.isNotEmpty);
      out.add(
        LeaveItem(
          id: '${a.id}+${p.id}',
          userName: a.userName,
          typeId: a.typeId,
          typeName: a.typeName,
          dayPart: 'FULL',
          from: a.from,
          to: a.to,
          days: a.days + p.days,
          reason: reasons.isEmpty ? null : reasons.join(' / '),
          canCancel: a.canCancel || p.canCancel,
          halves: [a, p],
        ),
      );
      continue;
    }
    out.add(l);
  }
  return out;
}

class LeaveBalance {
  const LeaveBalance({
    required this.type,
    this.entitlement,
    this.carryOver = 0,
    this.recorded = 0,
    this.balance,
    this.negative = false,
  });
  final LeaveType type;
  final num? entitlement, balance;
  final num carryOver, recorded;
  final bool negative;
  factory LeaveBalance.fromJson(Map<String, dynamic> j) => LeaveBalance(
    type: LeaveType.fromJson(j['type'] as Map<String, dynamic>),
    entitlement: j['entitlement'] as num?,
    carryOver: j['carryOver'] as num? ?? 0,
    recorded: j['recorded'] as num? ?? 0,
    balance: j['balance'] as num?,
    negative: j['negative'] as bool? ?? false,
  );
}

class Balances {
  const Balances(this.year, this.items, {this.supervisorName});
  final int year;
  final List<LeaveBalance> items;
  final String? supervisorName;
}

class TeamPerson {
  const TeamPerson(
    this.name, {
    this.noSupervisor = false,
    this.balances = const [],
  });
  final String name;
  final bool noSupervisor;
  final List<LeaveBalance> balances;
}

class TeamLeave {
  const TeamLeave(this.items, this.people);
  final List<LeaveItem> items;
  final List<TeamPerson> people;
}

class LeaveInput {
  const LeaveInput({
    required this.typeId,
    required this.dayPart,
    required this.from,
    required this.to,
    this.reason,
  });
  final String typeId, dayPart;
  final DateTime from, to;
  final String? reason;
  Map<String, dynamic> toJson() => {
    'leaveTypeId': typeId,
    'dayPart': dayPart,
    'from': ymd(from),
    'to': ymd(to),
    if (reason != null && reason!.trim().isNotEmpty) 'reason': reason!.trim(),
  };
}

abstract interface class LeaveRepository {
  Future<List<LeaveType>> types();
  Future<Balances> balances(int year);
  Future<List<LeaveItem>> mine(int year);
  Future<TeamLeave> team();
  Future<LeaveItem> record(LeaveInput input);
  Future<void> cancel(String id);
}

// ---------------- Task actions (TaskDto extras) ----------------

class Evidence {
  const Evidence({
    required this.id,
    required this.type,
    required this.name,
    this.url,
    this.size,
    this.addedBy,
    required this.at,
  });
  final String id, type, name;
  final String? url, addedBy;
  final int? size;
  final DateTime at;
  bool get legacyLink => type == 'LINK';
  factory Evidence.fromJson(Map<String, dynamic> j) => Evidence(
    id: '${j['id']}',
    type: j['type'] as String? ?? 'FILE',
    name: '${j['name']}',
    url: j['url'] as String?,
    size: (j['size'] as num?)?.toInt(),
    addedBy: (j['addedBy'] as Map?)?['name'] as String?,
    at: DateTime.tryParse('${j['at']}') ?? DateTime(2026),
  );
}

class FollowUp {
  const FollowUp({
    required this.id,
    required this.note,
    this.author,
    this.contact,
    required this.at,
  });
  final String id, note;
  final String? author, contact;
  final DateTime at;
  factory FollowUp.fromJson(Map<String, dynamic> j) => FollowUp(
    id: '${j['id']}',
    note: '${j['note']}',
    author: (j['author'] as Map?)?['name'] as String?,
    contact: (j['contact'] as Map?)?['name'] as String?,
    at: DateTime.tryParse('${j['at']}') ?? DateTime(2026),
  );
}

/// Fields of TaskDto the v1 Task model doesn't carry (approval comment, evidence, follow-ups, can, delete).
class TaskExtras {
  const TaskExtras({
    this.approvalComment,
    this.approvalBy,
    this.evidence = const [],
    this.followUps = const [],
    this.canEdit = true,
    this.canPlan = true,
    this.canStatus = true,
    this.canApprove = false,
    this.deletable = false,
    this.deleteBlockedReason,
    this.ownerId,
    this.assigneeIds = const [],
    this.deliverable,
    this.clientContactId,
  });
  final String? approvalComment,
      approvalBy,
      deleteBlockedReason,
      ownerId,
      deliverable,
      clientContactId;
  final List<Evidence> evidence;
  final List<FollowUp> followUps;
  final List<String> assigneeIds;
  final bool canEdit, canPlan, canStatus, canApprove, deletable;

  factory TaskExtras.fromJson(Map<String, dynamic> j) {
    final can = j['can'] as Map? ?? const {};
    final ap = j['approval'] as Map? ?? const {};
    return TaskExtras(
      approvalComment: ap['comment'] as String?,
      approvalBy: (ap['decidedBy'] as Map?)?['name'] as String?,
      evidence: [
        for (final e in (j['evidence'] as List? ?? const []))
          Evidence.fromJson(e as Map<String, dynamic>),
      ],
      followUps: [
        for (final e in (j['followUps'] as List? ?? const []))
          FollowUp.fromJson(e as Map<String, dynamic>),
      ],
      canEdit: can['edit'] as bool? ?? false,
      canPlan: can['plan'] as bool? ?? false,
      canStatus: can['status'] as bool? ?? false,
      canApprove: can['approve'] as bool? ?? false,
      deletable: j['deletable'] as bool? ?? false,
      deleteBlockedReason: j['deleteBlockedReason'] as String?,
      ownerId: (j['owner'] as Map?)?['id'] as String?,
      assigneeIds: [
        for (final a in (j['assignees'] as List? ?? const []))
          '${(a as Map)['id']}',
      ],
      deliverable: j['deliverable'] as String?,
      clientContactId: (j['clientContact'] as Map?)?['id'] as String?,
    );
  }
}

class HistoryItem {
  const HistoryItem({
    required this.id,
    required this.at,
    this.actor,
    required this.action,
    this.changes = const [],
    this.reason,
  });
  final String id, action;
  final DateTime at;
  final String? actor, reason;
  final List<({String field, String? old, String? now})> changes;
  factory HistoryItem.fromJson(Map<String, dynamic> j) => HistoryItem(
    id: '${j['id']}',
    at: DateTime.tryParse('${j['at']}') ?? DateTime(2026),
    actor: (j['actor'] as Map?)?['name'] as String?,
    action: '${j['action']}',
    reason: j['reason'] as String?,
    changes: [
      for (final c in (j['changes'] as List? ?? const []))
        (
          field: '${(c as Map)['field']}',
          old: c['old']?.toString(),
          now: c['new']?.toString(),
        ),
    ],
  );

  /// "task_status_changed" → "Status changed".
  String get label {
    final s = action
        .replaceFirst(RegExp(r'^(task|project)_'), '')
        .replaceAll('_', ' ');
    return s.isEmpty ? action : s[0].toUpperCase() + s.substring(1);
  }
}

class TaskEdit {
  const TaskEdit({
    required this.version,
    this.name,
    this.phase,
    this.priority,
    this.party,
    this.ownerId,
    this.assigneeIds,
    this.plannedStart,
    this.dueDate,
    this.estHours,
    this.deliverable,
    this.requiresApproval,
    this.mandatory,
    this.clientContactId,
  });
  final int version;
  final String? name, phase, ownerId, deliverable, clientContactId;
  final Priority? priority;
  final Party? party;
  final List<String>? assigneeIds;
  final DateTime? plannedStart, dueDate;
  final double? estHours;
  final bool? requiresApproval, mandatory;
  Map<String, dynamic> toJson() => {
    'version': version,
    'name': ?name,
    'phase': (phase == null || phase!.trim().isEmpty) ? null : phase!.trim(),
    if (priority != null) 'priority': priority!.api,
    if (party != null) 'party': party!.api,
    'ownerId': ownerId,
    'assigneeIds': ?assigneeIds,
    'plannedStart': plannedStart == null ? null : ymd(plannedStart!),
    'dueDate': dueDate == null ? null : ymd(dueDate!),
    'estHours': estHours,
    'deliverable': (deliverable == null || deliverable!.trim().isEmpty)
        ? null
        : deliverable!.trim(),
    'requiresApproval': ?requiresApproval,
    'mandatory': ?mandatory,
    'clientContactId': clientContactId,
  };
}

class PickedFile {
  const PickedFile(this.name, this.size, this.bytes);
  final String name;
  final int size;
  final List<int> bytes;
}

const evidenceExt = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];
const evidenceMaxBytes = 25 * 1024 * 1024;
const evidenceTypesLabel = 'PDF, Word or Excel · up to 25 MB each';

/// Client check before asking for an upload link (the server repeats it: fileIssue()).
String? evidenceProblem(PickedFile f) {
  final ext = f.name.contains('.') ? f.name.split('.').last.toLowerCase() : '';
  if (!evidenceExt.contains(ext)) {
    return '${f.name}: Upload a PDF, Word or Excel file.';
  }
  if (f.size > evidenceMaxBytes) return '${f.name}: Files can be up to 25 MB.';
  return null;
}

const _mime = {
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

abstract interface class TaskActionsRepository {
  Future<TaskExtras> extras(String taskId);
  Future<void> approve(String taskId, int version, {String? comment});
  Future<void> requestChanges(String taskId, int version, String comment);
  Future<void> uploadEvidence(String taskId, PickedFile file);
  Future<void> deleteEvidence(String taskId, String evidenceId);
  Future<void> addFollowUp(String taskId, String note);
  Future<void> update(String taskId, TaskEdit edit);
  Future<List<HistoryItem>> history(String taskId);
  Future<void> delete(String taskId);
  Future<List<NamedRef>> projectPeople(String projectId);
}

// ---------------- Project detail extras ----------------

class Contact {
  const Contact(
    this.id,
    this.name, {
    this.position,
    this.email,
    this.added = false,
  });
  final String id, name;
  final String? position, email;
  final bool added;
  factory Contact.fromJson(Map<String, dynamic> j) => Contact(
    '${j['id']}',
    '${j['name']}',
    position: j['position'] as String?,
    email: j['email'] as String?,
    added: j['added'] as bool? ?? true,
  );
}

class ProjectExtras {
  const ProjectExtras({
    this.members = const [],
    this.contacts = const [],
    this.canEdit = true,
  });
  final List<NamedRef> members;
  final List<Contact> contacts;
  final bool canEdit;
  factory ProjectExtras.fromJson(Map<String, dynamic> j) => ProjectExtras(
    members: [
      for (final m in (j['members'] as List? ?? const []))
        NamedRef('${(m as Map)['id']}', '${m['name']}'),
    ],
    contacts: [
      for (final c in (j['activeContacts'] as List? ?? const []))
        Contact.fromJson(c as Map<String, dynamic>),
    ],
    canEdit: (j['can'] as Map?)?['edit'] as bool? ?? true,
  );
}

class ProjectTimeRow {
  const ProjectTimeRow({
    required this.id,
    required this.person,
    required this.task,
    required this.date,
    required this.hours,
    this.type = 'EXECUTION',
  });
  final String id, person, task, type;
  final DateTime date;
  final double hours;
  factory ProjectTimeRow.fromJson(Map<String, dynamic> j) => ProjectTimeRow(
    id: '${j['id']}',
    person: '${(j['user'] as Map?)?['name'] ?? ''}',
    task: '${(j['task'] as Map?)?['name'] ?? ''}',
    date: parseYmd('${j['workDate']}'.substring(0, 10)),
    hours: (j['hours'] as num? ?? 0).toDouble(),
    type: j['type'] as String? ?? 'EXECUTION',
  );
}

class ProjectTime {
  const ProjectTime(
    this.items,
    this.total,
    this.byType, {
    this.allPeople = true,
  });
  final List<ProjectTimeRow> items;
  final double total;
  final Map<String, double> byType;
  final bool allPeople;
}

abstract interface class ProjectExtrasRepository {
  Future<ProjectExtras> extras(String projectId);
  Future<ProjectTime> time(String projectId);
  Future<List<HistoryItem>> activity(String projectId);
  Future<List<Contact>> contactOptions(String projectId);
  Future<void> addContact(String projectId, String contactId);
  Future<void> removeContact(String projectId, String contactId);
  Future<void> handover(String projectId, String managerId);
  Future<void> setMembers(String projectId, List<String> memberIds);
}

// ---------------- API ----------------

List<Map<String, dynamic>> _items(Map<String, dynamic> b) => [
  for (final i in (b['items'] as List? ?? const [])) i as Map<String, dynamic>,
];

class ApiLeaveRepository implements LeaveRepository {
  ApiLeaveRepository(this.api);
  final ApiClient api;
  @override
  Future<List<LeaveType>> types() async => [
    for (final t in _items(await api.get('/leave/types')))
      LeaveType.fromJson(t),
  ];
  @override
  Future<Balances> balances(int year) async {
    final b = await api.get('/leave/balances', {'year': '$year'});
    return Balances((b['year'] as num?)?.toInt() ?? year, [
      for (final i in _items(b)) LeaveBalance.fromJson(i),
    ], supervisorName: (b['supervisor'] as Map?)?['name'] as String?);
  }

  @override
  Future<List<LeaveItem>> mine(int year) async => [
    for (final i in _items(await api.get('/leave', {'year': '$year'})))
      LeaveItem.fromJson(i),
  ];
  @override
  Future<TeamLeave> team() async {
    final b = await api.get('/leave/team');
    return TeamLeave(
      [for (final i in _items(b)) LeaveItem.fromJson(i)],
      [
        for (final p in (b['people'] as List? ?? const []))
          TeamPerson(
            '${((p as Map)['user'] as Map?)?['name'] ?? ''}',
            noSupervisor: p['noSupervisor'] as bool? ?? false,
            balances: [
              for (final i in (p['items'] as List? ?? const []))
                LeaveBalance.fromJson(i as Map<String, dynamic>),
            ],
          ),
      ],
    );
  }

  @override
  Future<LeaveItem> record(LeaveInput input) async => LeaveItem.fromJson(
    (await api.post('/leave', input.toJson()))['item'] as Map<String, dynamic>,
  );
  @override
  Future<void> cancel(String id) => api.post('/leave/$id/cancel');
}

class ApiTaskActionsRepository implements TaskActionsRepository {
  ApiTaskActionsRepository(this.api);
  final ApiClient api;
  @override
  Future<TaskExtras> extras(String taskId) async {
    final b = await api.get('/tasks/$taskId');
    return TaskExtras.fromJson((b['task'] ?? b) as Map<String, dynamic>);
  }

  @override
  Future<void> approve(String taskId, int version, {String? comment}) =>
      api.post('/tasks/$taskId/approve', {
        'version': version,
        if (comment != null && comment.trim().isNotEmpty)
          'comment': comment.trim(),
      });
  @override
  Future<void> requestChanges(String taskId, int version, String comment) =>
      api.post('/tasks/$taskId/reject', {
        'version': version,
        'comment': comment.trim(),
      });

  /// m8-polish: POST /tasks/:id/evidence/uploads → PUT bytes → POST /uploads/:id/complete.
  @override
  Future<void> uploadEvidence(String taskId, PickedFile f) async {
    final ext = f.name.split('.').last.toLowerCase();
    final b = await api.post('/tasks/$taskId/evidence/uploads', {
      'files': [
        {'name': f.name, 'size': f.size, 'contentType': ?_mime[ext]},
      ],
    });
    final t = (b['uploads'] as List).first as Map<String, dynamic>;
    await api.putBytes('${t['uploadUrl']}', {
      for (final e in ((t['headers'] as Map?) ?? const {}).entries)
        '${e.key}': '${e.value}',
    }, f.bytes);
    await api.post('/uploads/${t['id']}/complete');
  }

  @override
  Future<void> deleteEvidence(String taskId, String evidenceId) =>
      api.delete('/tasks/$taskId/evidence/$evidenceId');
  @override
  Future<void> addFollowUp(String taskId, String note) =>
      api.post('/tasks/$taskId/follow-ups', {'note': note.trim()});
  @override
  Future<void> update(String taskId, TaskEdit edit) =>
      api.patch('/tasks/$taskId', edit.toJson());
  @override
  Future<List<HistoryItem>> history(String taskId) async => [
    for (final i in _items(await api.get('/tasks/$taskId/history')))
      HistoryItem.fromJson(i),
  ];
  @override
  Future<void> delete(String taskId) => api.delete('/tasks/$taskId');
  @override
  Future<List<NamedRef>> projectPeople(String projectId) async {
    final b = await api.get('/projects/$projectId');
    return ProjectExtras.fromJson(b['project'] as Map<String, dynamic>).members;
  }
}

class ApiProjectExtrasRepository implements ProjectExtrasRepository {
  ApiProjectExtrasRepository(this.api);
  final ApiClient api;
  @override
  Future<ProjectExtras> extras(String projectId) async =>
      ProjectExtras.fromJson(
        (await api.get('/projects/$projectId'))['project']
            as Map<String, dynamic>,
      );
  @override
  Future<ProjectTime> time(String projectId) async {
    final b = await api.get('/projects/$projectId/time');
    return ProjectTime(
      [for (final i in _items(b)) ProjectTimeRow.fromJson(i)],
      (b['total'] as num? ?? 0).toDouble(),
      {
        for (final e in ((b['byType'] as Map?) ?? const {}).entries)
          '${e.key}': (e.value as num).toDouble(),
      },
      allPeople: b['scope'] == 'ALL',
    );
  }

  @override
  Future<List<HistoryItem>> activity(String projectId) async => [
    for (final i in _items(await api.get('/projects/$projectId/activity')))
      HistoryItem.fromJson(i),
  ];
  @override
  Future<List<Contact>> contactOptions(String projectId) async => [
    for (final i in _items(
      await api.get('/projects/$projectId/contact-options'),
    ))
      Contact.fromJson(i),
  ];
  @override
  Future<void> addContact(String projectId, String contactId) =>
      api.post('/projects/$projectId/contacts', {'contactId': contactId});
  @override
  Future<void> removeContact(String projectId, String contactId) =>
      api.delete('/projects/$projectId/contacts/$contactId');

  /// m8-polish has no /handover route: handover = PATCH managerId (audited as project_handover).
  @override
  Future<void> handover(String projectId, String managerId) =>
      api.patch('/projects/$projectId', {'managerId': managerId});
  @override
  Future<void> setMembers(String projectId, List<String> memberIds) =>
      api.patch('/projects/$projectId', {'memberIds': memberIds});
}

// ---------------- Mocks ----------------

class MockLeaveStore {
  MockLeaveStore() {
    final t = MockStore.today;
    DateTime d(int add) => DateTime(t.year, t.month, t.day + add);
    items.addAll([
      LeaveItem(
        id: 'l1',
        userName: 'Jonathan Esmalla',
        typeId: 'lt1',
        typeName: 'Vacation',
        dayPart: 'FULL',
        from: DateTime(2026, 10, 6),
        to: DateTime(2026, 10, 6),
        days: 1,
      ),
      LeaveItem(
        id: 'l2',
        userName: 'Jonathan Esmalla',
        typeId: 'lt1',
        typeName: 'Vacation',
        dayPart: 'AM',
        from: DateTime(2026, 10, 7),
        to: DateTime(2026, 10, 7),
        days: 0.5,
      ),
      LeaveItem(
        id: 'l3',
        userName: 'Jonathan Esmalla',
        typeId: 'lt1',
        typeName: 'Vacation',
        dayPart: 'AM',
        from: d(4),
        to: d(4),
        days: 0.5,
        canCancel: true,
      ),
      LeaveItem(
        id: 'l4',
        userName: 'Jonathan Esmalla',
        typeId: 'lt1',
        typeName: 'Vacation',
        dayPart: 'PM',
        from: d(4),
        to: d(4),
        days: 0.5,
        canCancel: true,
      ),
      LeaveItem(
        id: 'l5',
        userName: 'Jonathan Esmalla',
        typeId: 'lt2',
        typeName: 'Sick',
        dayPart: 'FULL',
        from: d(8),
        to: d(9),
        days: 2,
        reason: 'Check-up',
        canCancel: true,
      ),
    ]);
  }
  static const types = [
    LeaveType('lt1', 'Vacation'),
    LeaveType('lt2', 'Sick', needsDocument: true),
    LeaveType('lt3', 'Emergency', unit: 'DAY'),
    LeaveType('lt4', 'Unpaid', paid: false),
  ];
  static const entitlement = {'lt1': 15, 'lt2': 10, 'lt3': 3};
  final items = <LeaveItem>[];
  bool hasSupervisor = true;
  int _n = 10;
}

/// Working days between two dates (weekends don't count; holidays are not modelled in demo).
num workingDays(DateTime from, DateTime to) {
  var n = 0;
  for (var d = from; !d.isAfter(to); d = DateTime(d.year, d.month, d.day + 1)) {
    if (d.weekday <= 5) n++;
  }
  return n;
}

class MockLeaveRepository implements LeaveRepository {
  MockLeaveRepository(this.s);
  final MockLeaveStore s;
  @override
  Future<List<LeaveType>> types() async => MockLeaveStore.types;

  num _used(String typeId, int year) => s.items
      .where((l) => !l.cancelled && l.typeId == typeId && l.from.year == year)
      .fold<num>(0, (a, l) => a + l.days);

  List<LeaveBalance> _balances(int year) => [
    for (final t in MockLeaveStore.types)
      () {
        final ent = t.paid ? MockLeaveStore.entitlement[t.id] : null;
        final rec = _used(t.id, year);
        final bal = ent == null ? null : ent - rec;
        return LeaveBalance(
          type: t,
          entitlement: ent,
          recorded: rec,
          balance: bal,
          negative: (bal ?? 0) < 0,
        );
      }(),
  ];

  @override
  Future<Balances> balances(int year) async => Balances(
    year,
    _balances(year),
    supervisorName: s.hasSupervisor ? 'Queen Reyes' : null,
  );
  @override
  Future<List<LeaveItem>> mine(int year) async =>
      s.items.where((l) => l.from.year == year || l.to.year == year).toList()
        ..sort((a, b) => b.from.compareTo(a.from));
  @override
  Future<TeamLeave> team() async => TeamLeave(
    [
      LeaveItem(
        id: 'tl1',
        userName: 'Mark Kim',
        typeId: 'lt1',
        typeName: 'Vacation',
        dayPart: 'FULL',
        from: DateTime(2026, 10, 14),
        to: DateTime(2026, 10, 16),
        days: 3,
      ),
    ],
    [
      TeamPerson(
        'Mark Kim',
        balances: [
          LeaveBalance(
            type: MockLeaveStore.types[0],
            entitlement: 15,
            recorded: 3,
            balance: 12,
          ),
        ],
      ),
      TeamPerson(
        'Ana Cruz',
        noSupervisor: true,
        balances: [
          LeaveBalance(
            type: MockLeaveStore.types[1],
            entitlement: 10,
            recorded: 11,
            balance: -1,
            negative: true,
          ),
        ],
      ),
    ],
  );

  ApiException _fail(String path, String msg, {String? code}) =>
      ApiException(msg, status: 422, code: code, fields: {path: msg});

  @override
  Future<LeaveItem> record(LeaveInput i) async {
    final type = MockLeaveStore.types
        .where((t) => t.id == i.typeId)
        .firstOrNull;
    if (type == null) throw _fail('leaveTypeId', 'Choose a leave type.');
    if (i.to.isBefore(i.from)) throw _fail('to', toBeforeFrom);
    if (i.dayPart != 'FULL' && i.from != i.to) {
      throw _fail('to', halfDaySingleDate);
    }
    if (type.fullDaysOnly && i.dayPart != 'FULL') {
      throw _fail('dayPart', fullDayTypeMessage(type.name));
    }
    final wd = workingDays(i.from, i.to);
    if (wd == 0) throw _fail('to', noWorkingDays, code: 'NO_WORKING_DAYS');
    final need = i.dayPart == 'FULL' ? wd : 0.5;
    for (final l in s.items.where((l) => !l.cancelled)) {
      if (l.to.isBefore(i.from) || l.from.isAfter(i.to)) continue;
      if (l.dayPart != 'FULL' &&
          i.dayPart != 'FULL' &&
          l.dayPart != i.dayPart) {
        continue;
      }
      final msg = i.dayPart == 'AM'
          ? morningTaken
          : i.dayPart == 'PM'
          ? afternoonTaken
          : 'You already have leave filed for ${leaveRangeLabel(l.from, l.to)}.';
      throw _fail('from', msg, code: 'LEAVE_OVERLAP');
    }
    final bal = _balances(i.from.year)
        .firstWhere((b) => b.type.id == type.id)
        .balance;
    if (bal != null && need > bal) {
      throw _fail(
        'leaveTypeId',
        overBalanceMessage(bal, type.name, need),
        code: 'OVER_BALANCE',
      );
    }
    final item = LeaveItem(
      id: 'l${s._n++}',
      userName: 'Jonathan Esmalla',
      typeId: type.id,
      typeName: type.name,
      dayPart: i.dayPart,
      from: i.from,
      to: i.to,
      days: need,
      reason: i.reason,
      canCancel: true,
    );
    s.items.add(item);
    return item;
  }

  @override
  Future<void> cancel(String id) async {
    final i = s.items.indexWhere((l) => l.id == id);
    final l = s.items[i];
    if (!l.from.isAfter(MockStore.today)) {
      throw ApiException(pastLeaveAdminOnly, status: 422, code: 'PAST_LEAVE');
    }
    s.items[i] = LeaveItem(
      id: l.id,
      userName: l.userName,
      typeId: l.typeId,
      typeName: l.typeName,
      dayPart: l.dayPart,
      from: l.from,
      to: l.to,
      days: l.days,
      reason: l.reason,
      status: 'CANCELLED',
    );
  }
}

class MockTaskActionsRepository implements TaskActionsRepository {
  MockTaskActionsRepository(this.store);
  final MockStore store;
  static final _extras = <MockStore, Map<String, TaskExtras>>{};
  static final _history = <MockStore, Map<String, List<HistoryItem>>>{};
  Map<String, TaskExtras> get _x => _extras.putIfAbsent(
    store,
    () => {
      't7': const TaskExtras(
        canApprove: true,
        ownerId: 'u1',
        assigneeIds: ['u1'],
      ),
      't4': TaskExtras(
        evidence: [
          Evidence(
            id: 'e1',
            type: 'FILE',
            name: 'Roles matrix.xlsx',
            size: 48213,
            addedBy: 'Mark Kim',
            at: DateTime.utc(2026, 10, 9, 3),
          ),
          Evidence(
            id: 'e2',
            type: 'LINK',
            name: 'Sign-off notes',
            url: 'https://example.com/notes',
            addedBy: 'Mark Kim',
            at: DateTime.utc(2026, 9, 2, 3),
          ),
        ],
        followUps: [
          FollowUp(
            id: 'f1',
            note: 'Asked Acme IT for the SSO metadata.',
            author: 'Jonathan E.',
            at: DateTime.utc(2026, 10, 8, 2),
          ),
        ],
        deleteBlockedReason:
            'It has 2 evidence files and 1 follow-up. Delete those first.',
        ownerId: 'u1',
        assigneeIds: const ['u1'],
      ),
      't8': const TaskExtras(
        deletable: true,
        ownerId: 'u1',
        assigneeIds: ['u1'],
      ),
    },
  );
  Map<String, List<HistoryItem>> get _h =>
      _history.putIfAbsent(store, () => {});

  int _i(String id) => store.tasks.indexWhere((t) => t.id == id);
  TaskExtras _get(String id) =>
      _x[id] ?? const TaskExtras(ownerId: 'u1', assigneeIds: ['u1']);
  void _log(
    String id,
    String action, {
    String? reason,
    List<({String field, String? old, String? now})> changes = const [],
  }) => _h
      .putIfAbsent(id, () => [])
      .insert(
        0,
        HistoryItem(
          id: 'h${_h.length}${DateTime.now().microsecond}',
          at: DateTime.utc(2026, 10, 11, 6),
          actor: 'Jonathan Esmalla',
          action: action,
          reason: reason,
          changes: changes,
        ),
      );

  TaskExtras _with(
    TaskExtras e, {
    String? comment,
    List<Evidence>? evidence,
    List<FollowUp>? followUps,
    bool? canApprove,
  }) => TaskExtras(
    approvalComment: comment ?? e.approvalComment,
    approvalBy: comment != null ? 'Jonathan Esmalla' : e.approvalBy,
    evidence: evidence ?? e.evidence,
    followUps: followUps ?? e.followUps,
    canEdit: e.canEdit,
    canPlan: e.canPlan,
    canStatus: e.canStatus,
    canApprove: canApprove ?? e.canApprove,
    deletable: e.deletable,
    deleteBlockedReason: e.deleteBlockedReason,
    ownerId: e.ownerId,
    assigneeIds: e.assigneeIds,
    deliverable: e.deliverable,
  );

  @override
  Future<TaskExtras> extras(String taskId) async => _get(taskId);

  Task _decide(String id, TaskStatus to, String state) {
    final t = store.tasks[_i(id)];
    if (t.status != TaskStatus.forReview) {
      throw ApiException(
        'Only tasks in For Review can be approved or rejected.',
        status: 400,
      );
    }
    final n = Task(
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      projectName: t.projectName,
      phase: t.phase,
      priority: t.priority,
      party: t.party,
      ownerName: t.ownerName,
      assignees: t.assignees,
      plannedStart: t.plannedStart,
      dueDate: t.dueDate,
      estHours: t.estHours,
      actualHours: t.actualHours,
      status: to,
      dependsOn: t.dependsOn,
      requiresApproval: t.requiresApproval,
      mandatory: t.mandatory,
      reviewerName: t.reviewerName,
      approvalState: state,
      version: t.version + 1,
      overdue: t.overdue,
    );
    store.tasks[_i(id)] = n;
    return n;
  }

  @override
  Future<void> approve(String taskId, int version, {String? comment}) async {
    _decide(taskId, TaskStatus.done, 'APPROVED');
    _x[taskId] = _with(_get(taskId), comment: comment ?? '', canApprove: false);
    _log(taskId, 'task_approved', reason: comment);
  }

  @override
  Future<void> requestChanges(
    String taskId,
    int version,
    String comment,
  ) async {
    if (comment.trim().isEmpty) {
      throw ApiException(
        'Comment is required.',
        status: 400,
        fields: {'comment': 'Comment is required.'},
      );
    }
    _decide(taskId, TaskStatus.inProgress, 'REJECTED');
    _x[taskId] = _with(
      _get(taskId),
      comment: comment.trim(),
      canApprove: false,
    );
    _log(taskId, 'task_rejected', reason: comment.trim());
  }

  @override
  Future<void> uploadEvidence(String taskId, PickedFile f) async {
    final p = evidenceProblem(f);
    if (p != null) throw ApiException(p, status: 422);
    final e = _get(taskId);
    _x[taskId] = _with(
      e,
      evidence: [
        ...e.evidence,
        Evidence(
          id: 'e${e.evidence.length + 10}',
          type: 'FILE',
          name: f.name,
          size: f.size,
          addedBy: 'Jonathan Esmalla',
          at: DateTime.utc(2026, 10, 11, 6),
        ),
      ],
    );
    _log(
      taskId,
      'task_evidence_added',
      changes: [(field: 'evidence', old: null, now: f.name)],
    );
  }

  @override
  Future<void> deleteEvidence(String taskId, String evidenceId) async {
    final e = _get(taskId);
    final st = store.tasks.firstWhere((t) => t.id == taskId).status;
    final ev = e.evidence.firstWhere((x) => x.id == evidenceId);
    if (ev.type == 'FILE' &&
        (st == TaskStatus.forReview || st == TaskStatus.done)) {
      throw ApiException(
        'This task is in review or completed. Reopen it before removing its evidence.',
        status: 409,
        code: 'EVIDENCE_LOCKED',
      );
    }
    _log(
      taskId,
      'task_evidence_removed',
      changes: [(field: 'evidence', old: ev.name, now: null)],
    );
    _x[taskId] = _with(
      e,
      evidence: e.evidence.where((x) => x.id != evidenceId).toList(),
    );
  }

  @override
  Future<void> addFollowUp(String taskId, String note) async {
    if (note.trim().isEmpty) {
      throw ApiException(
        'Note is required.',
        status: 400,
        fields: {'note': 'Note is required.'},
      );
    }
    final e = _get(taskId);
    _x[taskId] = _with(
      e,
      followUps: [
        ...e.followUps,
        FollowUp(
          id: 'f${e.followUps.length + 10}',
          note: note.trim(),
          author: 'Jonathan Esmalla',
          at: DateTime.utc(2026, 10, 11, 6),
        ),
      ],
    );
  }

  @override
  Future<void> update(String taskId, TaskEdit d) async {
    if (d.name != null && d.name!.trim().isEmpty) {
      throw ApiException(
        'Task name is required.',
        status: 400,
        fields: {'name': 'Task name is required.'},
      );
    }
    final t = store.tasks[_i(taskId)];
    final people = {
      for (final p in await projectPeople(t.projectId)) p.id: p.name,
    };
    store.tasks[_i(taskId)] = Task(
      id: t.id,
      projectId: t.projectId,
      projectName: t.projectName,
      name: d.name?.trim() ?? t.name,
      phase: d.phase ?? t.phase,
      priority: d.priority ?? t.priority,
      party: d.party ?? t.party,
      ownerName: d.ownerId == null ? t.ownerName : people[d.ownerId],
      assignees: d.assigneeIds == null
          ? t.assignees
          : [for (final a in d.assigneeIds!) people[a] ?? a],
      plannedStart: d.plannedStart,
      dueDate: d.dueDate,
      estHours: d.estHours,
      actualHours: t.actualHours,
      status: t.status,
      previousStatus: t.previousStatus,
      blockerReason: t.blockerReason,
      dependsOn: t.dependsOn,
      requiresApproval: d.requiresApproval ?? t.requiresApproval,
      mandatory: d.mandatory ?? t.mandatory,
      reviewerName: t.reviewerName,
      approvalState: t.approvalState,
      version: t.version + 1,
      overdue: t.overdue,
    );
    final e = _get(taskId);
    _x[taskId] = TaskExtras(
      approvalComment: e.approvalComment,
      approvalBy: e.approvalBy,
      evidence: e.evidence,
      followUps: e.followUps,
      canApprove: e.canApprove,
      deletable: e.deletable,
      deleteBlockedReason: e.deleteBlockedReason,
      ownerId: d.ownerId ?? e.ownerId,
      assigneeIds: d.assigneeIds ?? e.assigneeIds,
      deliverable: d.deliverable,
    );
    _log(
      taskId,
      'task_updated',
      changes: [
        if (d.name != null && d.name != t.name)
          (field: 'name', old: t.name, now: d.name),
      ],
    );
  }

  @override
  Future<List<HistoryItem>> history(String taskId) async => [
    ...?_h[taskId],
    HistoryItem(
      id: 'h0',
      at: DateTime.utc(2026, 9, 28, 1),
      actor: 'Jonathan Esmalla',
      action: 'task_created',
    ),
  ];

  @override
  Future<void> delete(String taskId) async {
    final e = _get(taskId);
    if (!e.deletable) {
      throw ApiException(
        e.deleteBlockedReason ?? 'This task has records and can’t be deleted.',
        status: 409,
        code: 'TASK_HAS_RECORDS',
      );
    }
    store.tasks.removeAt(_i(taskId));
  }

  @override
  Future<List<NamedRef>> projectPeople(String projectId) async => const [
    NamedRef('u1', 'Jonathan Esmalla'),
    NamedRef('u2', 'Queen Reyes'),
    NamedRef('u3', 'Mark Kim'),
  ];
}

class MockProjectExtrasRepository implements ProjectExtrasRepository {
  MockProjectExtrasRepository(this.store);
  final MockStore store;
  static final _state = <MockStore, Map<String, ProjectExtras>>{};
  static final _log = <MockStore, Map<String, List<HistoryItem>>>{};
  static const _people = {
    'u1': 'Jonathan Esmalla',
    'u2': 'Queen Reyes',
    'u3': 'Mark Kim',
  };
  static const _allContacts = [
    Contact(
      'k1',
      'Ana Cruz',
      position: 'IT Manager',
      email: 'ana@acme.example',
    ),
    Contact(
      'k2',
      'Ben Tan',
      position: 'Finance Lead',
      email: 'ben@acme.example',
    ),
    Contact('k3', 'Carla Diaz', position: 'HR Officer'),
  ];
  Map<String, ProjectExtras> get _s => _state.putIfAbsent(store, () => {});
  Map<String, List<HistoryItem>> get _l => _log.putIfAbsent(store, () => {});
  ProjectExtras _get(String id) =>
      _s[id] ??
      const ProjectExtras(
        members: [
          NamedRef('u1', 'Jonathan Esmalla'),
          NamedRef('u3', 'Mark Kim'),
        ],
        contacts: [
          Contact(
            'k1',
            'Ana Cruz',
            position: 'IT Manager',
            email: 'ana@acme.example',
          ),
        ],
      );
  void _add(
    String id,
    String action,
    List<({String field, String? old, String? now})> c,
  ) => _l
      .putIfAbsent(id, () => [])
      .insert(
        0,
        HistoryItem(
          id: 'a${_l[id]!.length + 9}',
          at: DateTime.utc(2026, 10, 11, 6),
          actor: 'Jonathan Esmalla',
          action: action,
          changes: c,
        ),
      );

  @override
  Future<ProjectExtras> extras(String projectId) async => _get(projectId);
  @override
  Future<ProjectTime> time(String projectId) async {
    final rows = [
      ProjectTimeRow(
        id: 'pt1',
        person: 'Jonathan Esmalla',
        task: 'Configure roles',
        date: DateTime(2026, 10, 9),
        hours: 3.5,
      ),
      ProjectTimeRow(
        id: 'pt2',
        person: 'Mark Kim',
        task: 'Data migration dry run',
        date: DateTime(2026, 10, 8),
        hours: 2,
        type: 'WAITING',
      ),
      ProjectTimeRow(
        id: 'pt3',
        person: 'Mark Kim',
        task: 'Environment setup',
        date: DateTime(2026, 10, 4),
        hours: 5,
      ),
      ProjectTimeRow(
        id: 'pt4',
        person: 'Jonathan Esmalla',
        task: 'Configure roles',
        date: DateTime(2026, 10, 2),
        hours: 1.5,
        type: 'REWORK',
      ),
    ];
    final by = <String, double>{'EXECUTION': 0, 'WAITING': 0, 'REWORK': 0};
    for (final r in rows) {
      by[r.type] = by[r.type]! + r.hours;
    }
    return ProjectTime(rows, rows.fold(0, (a, r) => a + r.hours), by);
  }

  @override
  Future<List<HistoryItem>> activity(String projectId) async => [
    ...?_l[projectId],
    HistoryItem(
      id: 'a2',
      at: DateTime.utc(2026, 10, 9, 4),
      actor: 'Mark Kim',
      action: 'task_status_changed',
      changes: const [(field: 'status', old: 'IN_PROGRESS', now: 'FOR_REVIEW')],
    ),
    HistoryItem(
      id: 'a1',
      at: DateTime.utc(2026, 8, 3, 1),
      actor: 'Jonathan Esmalla',
      action: 'project_created',
    ),
  ];
  @override
  Future<List<Contact>> contactOptions(String projectId) async {
    final added = {for (final c in _get(projectId).contacts) c.id};
    return [
      for (final c in _allContacts)
        Contact(
          c.id,
          c.name,
          position: c.position,
          email: c.email,
          added: added.contains(c.id),
        ),
    ];
  }

  ProjectExtras _copy(
    ProjectExtras e, {
    List<NamedRef>? members,
    List<Contact>? contacts,
  }) => ProjectExtras(
    members: members ?? e.members,
    contacts: contacts ?? e.contacts,
    canEdit: e.canEdit,
  );

  @override
  Future<void> addContact(String projectId, String contactId) async {
    final e = _get(projectId);
    final c = _allContacts.firstWhere((c) => c.id == contactId);
    _s[projectId] = _copy(e, contacts: [...e.contacts, c]);
    _add(projectId, 'project_contact_added', [
      (field: 'contact', old: null, now: c.name),
    ]);
  }

  @override
  Future<void> removeContact(String projectId, String contactId) async {
    final e = _get(projectId);
    _s[projectId] = _copy(
      e,
      contacts: e.contacts.where((c) => c.id != contactId).toList(),
    );
  }

  @override
  Future<void> handover(String projectId, String managerId) async {
    final i = store.projects.indexWhere((p) => p.id == projectId);
    final o = store.projects[i];
    store.projects[i] = Project(
      id: o.id,
      name: o.name,
      clientName: o.clientName,
      status: o.status,
      progress: o.progress,
      goLive: o.goLive,
      managerName: _people[managerId],
      taskCount: o.taskCount,
      projectTypeId: o.projectTypeId,
      projectTypeName: o.projectTypeName,
      projectTypeActive: o.projectTypeActive,
      clientId: o.clientId,
      managerId: managerId,
      startDate: o.startDate,
      code: o.code,
      description: o.description,
    );
    final e = _get(projectId);
    if (!e.members.any((m) => m.id == managerId)) {
      _s[projectId] = _copy(
        e,
        members: [...e.members, NamedRef(managerId, _people[managerId]!)],
      );
    }
    _add(projectId, 'project_handover', [
      (field: 'managerId', old: o.managerName, now: _people[managerId]),
    ]);
  }

  @override
  Future<void> setMembers(String projectId, List<String> memberIds) async {
    _s[projectId] = _copy(
      _get(projectId),
      members: [for (final id in memberIds) NamedRef(id, _people[id] ?? id)],
    );
  }
}
