// Models for M5–M8 endpoints on m8-polish: tracker, lookups, DAR, project types, my tasks.
import 'ph_time.dart';

typedef IdName = ({String id, String name});

IdName? _ref(Object? v) =>
    v is Map ? (id: '${v['id']}', name: '${v['name'] ?? ''}') : null;
DateTime? _inst(Object? v) => v is String ? DateTime.tryParse(v) : null;

class Lookup {
  const Lookup(this.id, this.name, {this.key, this.system = false});
  final String id, name;

  /// Stable key for system values (`quick_activity`), else null (m8-polish, additive).
  final String? key;
  final bool system;
  factory Lookup.fromJson(Map<String, dynamic> j) => Lookup(
    '${j['id']}',
    '${j['name']}',
    key: j['key'] as String?,
    system: j['system'] == true,
  );
}

/// FR-ACT-32: the system Activity type preselected by Add quick activity.
const quickActivityKey = 'quick_activity';

class Lookups {
  const Lookups({required this.activityTypes, required this.locations});
  final List<Lookup> activityTypes, locations;
}

enum TimeType {
  execution('EXECUTION', 'Execution'),
  waiting('WAITING', 'Waiting'),
  rework('REWORK', 'Rework');

  const TimeType(this.api, this.label);
  final String api, label;
  static TimeType? fromApi(String? v) =>
      values.where((t) => t.api == v).firstOrNull;
}

class TrackerEntry {
  const TrackerEntry({
    required this.id,
    required this.date,
    this.isQuick = false,
    this.project,
    this.client,
    this.task,
    this.title,
    this.startAt,
    this.endAt,
    this.running = false,
    this.minutes = 0,
    this.timed = true,
    this.autoStopped = false,
    this.activityType,
    this.module,
    this.location,
    this.locationOverridden = false,
    this.billable = false,
    this.type,
    this.notes,
    this.locked = false,
  });
  final String id;
  final DateTime date;
  final bool isQuick,
      running,
      timed,
      autoStopped,
      locationOverridden,
      billable,
      locked;
  final IdName? project, client, task, activityType, location;
  final String? title, module, notes;
  final DateTime? startAt, endAt;
  final int minutes;
  final TimeType? type;

  String get name => task?.name ?? title ?? '';

  /// Minutes, counting a running timer up to [now].
  int minutesAt(DateTime now) => running && startAt != null
      ? now.difference(startAt!).inMinutes.clamp(0, 24 * 60)
      : minutes;

  factory TrackerEntry.fromJson(Map<String, dynamic> j) => TrackerEntry(
    id: '${j['id']}',
    date: parseYmd('${j['date']}'),
    isQuick: j['kind'] == 'QUICK',
    project: _ref(j['project']),
    client: _ref(j['client']),
    task: _ref(j['task']),
    title: j['title'] as String?,
    startAt: _inst(j['startAt']),
    endAt: _inst(j['endAt']),
    running: j['running'] == true,
    minutes: (j['minutes'] as num?)?.toInt() ?? 0,
    timed: j['timed'] != false,
    autoStopped: j['autoStopped'] == true,
    activityType: _ref(j['activityType']),
    module: j['module'] as String?,
    location: _ref(j['location']),
    locationOverridden: j['locationOverridden'] == true,
    billable: j['billable'] == true,
    type: TimeType.fromApi(j['type'] as String?),
    notes: j['notes'] as String?,
    locked: j['locked'] == true,
  );
}

enum DayStatus { open, submitted, reopened }

class ReopenInfo {
  const ReopenInfo({required this.by, required this.at, required this.reason});
  final String by, reason;
  final DateTime at;
}

class LeaveRow {
  const LeaveRow({required this.id, required this.label});
  final String id, label;
}

class TrackerDay {
  const TrackerDay({
    required this.user,
    required this.date,
    this.location,
    this.status = DayStatus.open,
    this.submittedAt,
    this.reopened = const [],
    this.notSubmitted = false,
    this.weekLocked = false,
    this.entries = const [],
    this.totalMinutes = 0,
    this.own = true,
    this.canEdit = true,
    this.canSubmit = true,
    this.canReopen = false,
    this.leave,
    this.leaveRows = const [],
  });
  final IdName user;
  final DateTime date;
  final IdName? location;
  final DayStatus status;
  final DateTime? submittedAt;
  final List<ReopenInfo> reopened;
  final bool notSubmitted, weekLocked, own, canEdit, canSubmit, canReopen;
  final List<TrackerEntry> entries;
  final int totalMinutes;
  final String? leave;
  final List<LeaveRow> leaveRows;

  TrackerEntry? get runningEntry => entries.where((e) => e.running).firstOrNull;
  int totalAt(DateTime now) => entries.fold(0, (s, e) => s + e.minutesAt(now));

  factory TrackerDay.fromJson(Map<String, dynamic> j) {
    final can = (j['can'] as Map?) ?? const {};
    return TrackerDay(
      user: _ref(j['user']) ?? (id: '', name: ''),
      date: parseYmd('${j['date']}'),
      location: _ref(j['location']),
      status: switch (j['status']) {
        'SUBMITTED' => DayStatus.submitted,
        'REOPENED' => DayStatus.reopened,
        _ => DayStatus.open,
      },
      submittedAt: _inst(j['submittedAt']),
      reopened: [
        for (final r in (j['reopened'] as List? ?? const []))
          ReopenInfo(
            by: _ref((r as Map)['by'])?.name ?? '',
            at: _inst(r['at']) ?? DateTime.now(),
            reason: '${r['reason'] ?? ''}',
          ),
      ],
      notSubmitted: j['notSubmitted'] == true,
      weekLocked: j['weekLocked'] == true,
      entries: [
        for (final e in (j['entries'] as List? ?? const []))
          TrackerEntry.fromJson(e as Map<String, dynamic>),
      ],
      totalMinutes: (j['totalMinutes'] as num?)?.toInt() ?? 0,
      own: j['own'] != false,
      canEdit: can['edit'] == true,
      canSubmit: can['submit'] == true,
      canReopen: can['reopen'] == true,
      leave: j['leave'] as String?,
      leaveRows: [
        for (final r in (j['leaveRows'] as List? ?? const []))
          LeaveRow(id: '${(r as Map)['id']}', label: '${r['label'] ?? ''}'),
      ],
    );
  }
}

class Running {
  const Running({this.entry, required this.serverNow});
  final TrackerEntry? entry;
  final DateTime serverNow;
}

/// Input for Time in / Add entry / Edit entry.
class EntryDraft {
  const EntryDraft({
    this.taskId,
    this.title,
    required this.activityTypeId,
    this.locationId,
    this.dayLocationId,
    this.billable,
    this.type,
    this.module,
    this.notes,
    this.date,
    this.timeIn,
    this.timeOut,
    this.switchFrom,
    this.confirmLeave = false,
  });
  final String? taskId,
      title,
      locationId,
      dayLocationId,
      module,
      notes,
      switchFrom;
  final String activityTypeId;
  final bool? billable;
  final TimeType? type;
  final DateTime? date;

  /// "HH:MM" PH.
  final String? timeIn, timeOut;
  final bool confirmLeave;

  EntryDraft copyWith({String? switchFrom, bool? confirmLeave}) => EntryDraft(
    taskId: taskId,
    title: title,
    activityTypeId: activityTypeId,
    locationId: locationId,
    dayLocationId: dayLocationId,
    billable: billable,
    type: type,
    module: module,
    notes: notes,
    date: date,
    timeIn: timeIn,
    timeOut: timeOut,
    switchFrom: switchFrom ?? this.switchFrom,
    confirmLeave: confirmLeave ?? this.confirmLeave,
  );

  Map<String, dynamic> toJson({bool timer = false, bool update = false}) => {
    if (!update && taskId != null) 'taskId': taskId,
    if (title != null) 'title': title,
    'activityTypeId': activityTypeId,
    // Per-entry location is no longer edited (the day location is); an update never sends it,
    // so overrides already stored on entries are kept.
    if (!update && locationId != null) 'locationId': locationId,
    if (!update && dayLocationId != null) 'dayLocationId': dayLocationId,
    'billable': ?billable,
    if (type != null) 'type': type!.api,
    'module': (module == null || module!.trim().isEmpty)
        ? null
        : module!.trim(),
    'notes': (notes == null || notes!.trim().isEmpty) ? null : notes!.trim(),
    if (!timer && !update && date != null) 'date': ymd(date!),
    if (!timer) 'timeIn': ?timeIn,
    if (!timer) 'timeOut': ?timeOut,
    if (timer && switchFrom != null) 'switchFrom': switchFrom,
    if (!update && confirmLeave) 'confirmLeave': true,
  };
}

class ProjectTypeInfo {
  const ProjectTypeInfo({
    required this.id,
    required this.name,
    this.active = true,
    this.defaultActivity,
  });
  final String id, name;
  final bool active;
  final IdName? defaultActivity;
  factory ProjectTypeInfo.fromJson(Map<String, dynamic> j) => ProjectTypeInfo(
    id: '${j['id']}',
    name: '${j['name']}',
    active: j['active'] != false,
    defaultActivity: _ref(j['defaultActivityType']),
  );
}

class Preselect {
  const Preselect({
    this.projectTypeName,
    this.activityType,
    this.inactiveDefault,
  });
  final String? projectTypeName, inactiveDefault;
  final IdName? activityType;
  factory Preselect.fromJson(Map<String, dynamic> j) => Preselect(
    projectTypeName: (j['projectType'] as Map?)?['name'] as String?,
    activityType: _ref(j['activityType']),
    inactiveDefault: j['inactiveDefault'] as String?,
  );
}

/// /tasks/mine row (MyTaskDto).
class MyTask {
  const MyTask({
    required this.id,
    required this.name,
    required this.project,
    this.phase,
    this.role = 'ASSIGNEE',
    this.dueDate,
    this.plannedStart,
    this.overdue = false,
    this.daysLate = 0,
    required this.status,
    this.section,
    this.ageDays,
  });
  final String id, name, role;
  final IdName project;
  final String? phase, section;
  final DateTime? dueDate, plannedStart;
  final bool overdue;
  final int daysLate;
  final int? ageDays;
  final String status;

  factory MyTask.fromJson(Map<String, dynamic> j) => MyTask(
    id: '${j['id']}',
    name: '${j['name']}',
    project: _ref(j['project']) ?? (id: '', name: ''),
    phase: j['phase'] as String?,
    role: '${j['role'] ?? 'ASSIGNEE'}',
    dueDate: j['dueDate'] is String
        ? DateTime.tryParse(j['dueDate'] as String)
        : null,
    plannedStart: j['plannedStart'] is String
        ? DateTime.tryParse(j['plannedStart'] as String)
        : null,
    overdue: j['overdue'] == true,
    daysLate: (j['daysLate'] as num?)?.toInt() ?? 0,
    status: '${j['status']}',
    section: j['section'] as String?,
    ageDays: (j['ageDays'] as num?)?.toInt(),
  );
}

class MyTasksResult {
  const MyTasksResult({
    required this.items,
    this.overdue = 0,
    this.dueThisWeek = 0,
    this.toReview = 0,
  });
  final List<MyTask> items;
  final int overdue, dueThisWeek, toReview;
}

/// Hours-list row (TimeEntryDto, FR-TIME).
class HoursEntry {
  const HoursEntry({
    required this.id,
    required this.project,
    required this.task,
    required this.date,
    required this.minutes,
    this.type,
    this.notes,
    this.locked = false,
  });
  final String id;
  final IdName project, task;
  final DateTime date;
  final int minutes;
  final TimeType? type;
  final String? notes;
  final bool locked;
  factory HoursEntry.fromJson(Map<String, dynamic> j) => HoursEntry(
    id: '${j['id']}',
    project: _ref(j['project']) ?? (id: '', name: ''),
    task: _ref(j['task']) ?? (id: '', name: ''),
    date: parseYmd('${j['workDate']}'.substring(0, 10)),
    minutes:
        (j['minutes'] as num?)?.toInt() ??
        (((j['hours'] as num?) ?? 0) * 60).round(),
    type: TimeType.fromApi(j['type'] as String?),
    notes: j['notes'] as String?,
    locked: j['locked'] == true,
  );
}

class DarRow {
  const DarRow({
    required this.date,
    this.timeIn = '',
    this.timeOut = '',
    this.rendered = '',
    this.client = '',
    this.project = '',
    this.activityType = '',
    this.location = '',
    this.billable = '',
    this.module = '',
    this.remarks = '',
    this.leave = false,
  });
  final DateTime date;
  final String timeIn,
      timeOut,
      rendered,
      client,
      project,
      activityType,
      location,
      billable,
      module,
      remarks;
  final bool leave;
  factory DarRow.fromJson(Map<String, dynamic> j) => DarRow(
    date: parseYmd('${j['date']}'),
    timeIn: '${j['timeIn'] ?? ''}',
    timeOut: '${j['timeOut'] ?? ''}',
    rendered: '${j['rendered'] ?? ''}',
    client: '${j['client'] ?? ''}',
    project: '${j['project'] ?? ''}',
    activityType: '${j['activityType'] ?? ''}',
    location: '${j['location'] ?? ''}',
    billable: '${j['billable'] ?? ''}',
    module: '${j['module'] ?? ''}',
    remarks: '${j['remarks'] ?? ''}',
    leave: j['leave'] == true,
  );
}

class DarDayStatusInfo {
  const DarDayStatusInfo({
    required this.date,
    required this.status,
    this.leave,
  });
  final DateTime date;
  final String status;
  final String? leave;
}

class DarReport {
  const DarReport({
    required this.userName,
    this.supervisor,
    this.cc = const [],
    required this.from,
    required this.to,
    this.shownTo,
    required this.totalActivities,
    required this.totalRendered,
    required this.rows,
    required this.days,
    this.exportName = 'OpsTrack',
  });
  final String userName;
  final String? supervisor;
  final List<String> cc;
  final DateTime from, to;
  final DateTime? shownTo;
  final int totalActivities;
  final String totalRendered, exportName;
  final List<DarRow> rows;
  final List<DarDayStatusInfo> days;

  factory DarReport.fromJson(Map<String, dynamic> j) => DarReport(
    userName: _ref(j['user'])?.name ?? '',
    supervisor: _ref(j['supervisor'])?.name,
    cc: [for (final c in (j['cc'] as List? ?? const [])) '$c'],
    from: parseYmd('${j['from']}'),
    to: parseYmd('${j['to']}'),
    shownTo: j['shownTo'] is String ? parseYmd(j['shownTo'] as String) : null,
    totalActivities: (j['totalActivities'] as num?)?.toInt() ?? 0,
    totalRendered: '${j['totalRendered'] ?? '00:00'}',
    rows: [
      for (final r in (j['rows'] as List? ?? const []))
        DarRow.fromJson(r as Map<String, dynamic>),
    ],
    days: [
      for (final d in (j['days'] as List? ?? const []))
        DarDayStatusInfo(
          date: parseYmd('${(d as Map)['date']}'),
          status: '${d['status']}',
          leave: d['leave'] as String?,
        ),
    ],
    exportName: '${j['exportName'] ?? 'OpsTrack'}',
  );
}

class SavedReport {
  const SavedReport({
    required this.id,
    required this.savedAt,
    required this.from,
    required this.to,
    required this.totalActivities,
    required this.totalRendered,
    this.tag,
    this.changedDates = const [],
    this.report,
    this.sentKnown = false,
    this.sentAt,
    this.sentRecipientCount,
  });

  /// PR #35: the API reports send status (`sentAt` present, even when null).
  final bool sentKnown;
  final DateTime? sentAt;
  final int? sentRecipientCount;
  final String id;
  final DateTime savedAt, from, to;
  final int totalActivities;
  final String totalRendered;
  final String? tag;
  final List<DateTime> changedDates;
  final DarReport? report;

  factory SavedReport.fromJson(Map<String, dynamic> j) => SavedReport(
    id: '${j['id']}',
    savedAt: DateTime.parse('${j['savedAt']}'),
    from: parseYmd('${j['from']}'),
    to: parseYmd('${j['to']}'),
    totalActivities: (j['totalActivities'] as num?)?.toInt() ?? 0,
    totalRendered: '${j['totalRendered'] ?? ''}',
    tag: j['tag'] as String?,
    changedDates: [
      for (final d in (j['changedDates'] as List? ?? const [])) parseYmd('$d'),
    ],
    report: j['report'] is Map
        ? DarReport.fromJson(j['report'] as Map<String, dynamic>)
        : null,
    sentKnown: j.containsKey('sentAt'),
    sentAt: j['sentAt'] is String
        ? DateTime.tryParse(j['sentAt'] as String)
        : null,
    sentRecipientCount: (j['sentRecipientCount'] as num?)?.toInt(),
  );
}

const darMaxDays = 31;
const darRangeTooLong = 'The range can be up to 31 days. Pick a shorter range.';
const darFromAfterTo = '"From" must be on or before "To".';

/// Client-side DAR range check (darRangeSchema). Returns (field, message) or null.
(String, String)? validateDarRange(DateTime from, DateTime to) {
  if (from.isAfter(to)) return ('from', darFromAfterTo);
  if (to.difference(from).inDays + 1 > darMaxDays) {
    return ('to', darRangeTooLong);
  }
  return null;
}

/// GET /settings/time-lock. New shape (c96c8da, Q-09): `{policy: {enabled, version}}` or
/// `{enabled, version}`. Old shape: `{policy: {weekday, hour, ...}}` = weekly lock, i.e. on.
class TimeLockPolicy {
  const TimeLockPolicy({required this.enabled, this.legacyWeekly = false});
  final bool enabled;

  /// True when the API still returns the old weekly `{weekday, hour}` policy.
  final bool legacyWeekly;

  factory TimeLockPolicy.fromJson(Map<String, dynamic>? body) {
    final p = body?['policy'] is Map ? body!['policy'] as Map : body;
    if (p == null) return const TimeLockPolicy(enabled: true);
    final e = p['enabled'];
    final legacy = p.containsKey('weekday') || p.containsKey('hour');
    return TimeLockPolicy(enabled: e is bool ? e : true, legacyWeekly: legacy);
  }
}
