import 'mock_repositories.dart';
import 'p2.dart';
import 'models.dart';
import 'ph_time.dart';
import 'tracker_models.dart';
import 'v2_repositories.dart';

/// In-memory M5–M8 sample data (demo mode and tests). Rules mirror apps/api/src/routes/tracker.ts:
/// one running timer per person (409 TIMER_RUNNING + switchFrom), day location on the first entry
/// (400 LOCATION_NEEDED), no overlaps, 24h day cap, submit/reopen, weekly lock, leave.
class MockTrackerStore {
  MockTrackerStore({required this.now}) {
    _seed();
  }

  /// Current instant (overridable in tests).
  DateTime Function() now;
  DateTime get today => phDate(now());

  static const me = (id: 'u1', name: 'Jomerson Nazaire');
  static const people = [
    me,
    (id: 'u2', name: 'Queen Reyes'),
    (id: 'u3', name: 'Mark Kim'),
  ];
  static const activityTypes = [
    Lookup('a1', 'Integration'),
    Lookup('a2', 'Configuration'),
    Lookup('a3', 'Data migration'),
    Lookup('a4', 'Training'),
    Lookup('a5', 'Testing / UAT'),
    Lookup('a6', 'Development'),
    Lookup('a7', 'Internal meeting'),
    Lookup('aq', 'Quick Activity', key: quickActivityKey, system: true),
    Lookup('a8', 'Client meeting'),
    Lookup('a9', 'Pre-sales'),
    Lookup('a10', 'Admin work'),
    Lookup('a11', 'Support'),
    Lookup('a12', 'Other'),
  ];
  static const locations = [
    Lookup('l1', 'Onsite'),
    Lookup('l2', 'WFH'),
    Lookup('l3', 'Office'),
  ];
  static const projectTypes = [
    ProjectTypeInfo(
      id: 'pt1',
      name: 'Implementation',
      defaultActivity: (id: 'a2', name: 'Configuration'),
    ),
    ProjectTypeInfo(
      id: 'pt2',
      name: 'Integration',
      defaultActivity: (id: 'a1', name: 'Integration'),
    ),
    ProjectTypeInfo(
      id: 'pt5',
      name: 'Support',
      defaultActivity: (id: 'a11', name: 'Support'),
    ),
    ProjectTypeInfo(
      id: 'pt7',
      name: 'Migration',
      defaultActivity: (id: 'a3', name: 'Data migration'),
    ),
    ProjectTypeInfo(
      id: 'pt8',
      name: 'Training',
      defaultActivity: (id: 'a4', name: 'Training'),
    ),
    ProjectTypeInfo(id: 'pt9', name: 'Consulting'),
    ProjectTypeInfo(id: 'pt10', name: 'Legacy rollout', active: false),
  ];

  /// task id → (project id, project, client, project type id)
  static const taskProjects = {
    't3': ('p1', 'Acme Corp rollout', 'Acme Corp', 'pt1'),
    't4': ('p1', 'Acme Corp rollout', 'Acme Corp', 'pt1'),
    't5': ('p1', 'Acme Corp rollout', 'Acme Corp', 'pt1'),
    't6': ('p1', 'Acme Corp rollout', 'Acme Corp', 'pt1'),
    't7': ('p1', 'Acme Corp rollout', 'Acme Corp', 'pt1'),
    't8': ('p2', 'Globex ERP', 'Globex', 'pt7'),
  };

  static final _tasks = MockStore().tasks;
  final entries = <String, List<MockEntry>>{}; // "userId|yyyy-mm-dd"
  final days = <String, MockDay>{};
  final saved = <SavedReport>[];
  int _seq = 100;

  String _k(String user, DateTime d) => '$user|${ymd(d)}';
  MockDay dayOf(String user, DateTime d) =>
      days.putIfAbsent(_k(user, d), () => MockDay());
  List<MockEntry> entriesOf(String user, DateTime d) =>
      entries.putIfAbsent(_k(user, d), () => []);

  void _seed() {
    final t = today; // Sun Oct 11, 2026 in demo
    DateTime d(int back) => t.subtract(Duration(days: back));
    void add(
      String user,
      DateTime day,
      String? task,
      String? title,
      String inT,
      String outT,
      String act, {
      String module = '',
      String notes = '',
      bool billable = true,
      bool autoStopped = false,
      String? loc,
    }) {
      final p = inT.split(':').map(int.parse).toList(),
          q = outT.split(':').map(int.parse).toList();
      entriesOf(user, day).add(
        MockEntry(
          id: 'e${_seq++}',
          user: user,
          date: day,
          taskId: task,
          title: title,
          start: phInstant(day, p[0], p[1]),
          end: phInstant(day, q[0], q[1]),
          activityTypeId: act,
          module: module,
          notes: notes,
          billable: billable,
          autoStopped: autoStopped,
          locationId: loc,
        ),
      );
    }

    // Today: not submitted, Onsite (03)
    dayOf(me.id, d(0)).locationId = 'l1';
    add(
      me.id,
      d(0),
      't4',
      null,
      '08:00',
      '10:30',
      'a2',
      module: 'ADFS Remote',
      notes: 'IdP config call with client',
    );
    add(
      me.id,
      d(0),
      null,
      'Weekly team sync',
      '10:45',
      '11:30',
      'a7',
      billable: false,
      notes: 'Sprint planning',
    );
    add(
      me.id,
      d(0),
      't8',
      null,
      '12:30',
      '13:45',
      'a3',
      module: 'Item master',
      notes: 'Dry run 2 of 3',
      loc: 'l2',
    );
    // Yesterday (Sat): empty (08). Oct 9: submitted (05)
    final s = dayOf(me.id, d(2))..locationId = 'l1';
    add(me.id, d(2), 't7', null, '09:00', '12:00', 'a5', notes: 'UAT session');
    add(me.id, d(2), 't3', null, '13:00', '17:30', 'a2');
    s.status = DayStatus.submitted;
    s.submittedAt = phInstant(d(2), 18, 4);
    // Oct 8: reopened (06)
    final r = dayOf(me.id, d(3))..locationId = 'l3';
    add(
      me.id,
      d(3),
      't6',
      null,
      '08:30',
      '12:00',
      'a3',
      notes: 'Mapping review',
    );
    add(me.id, d(3), 't4', null, '13:00', '23:59', 'a2', autoStopped: true);
    r.status = DayStatus.reopened;
    r.reopened.add(
      ReopenInfo(
        by: 'Queen Reyes',
        at: phInstant(d(2), 9, 15),
        reason: 'Please split the SSO block by activity.',
      ),
    );
    // Oct 7: half day leave AM (09)
    final h = dayOf(me.id, d(4))..locationId = 'l2';
    h.leave = 'Half day leave (AM)';
    h.leaveRows.add(const LeaveRow(id: 'lv1', label: 'Vacation · Half day AM'));
    add(
      me.id,
      d(4),
      't5',
      null,
      '13:00',
      '17:00',
      'a8',
      notes: 'Org chart walkthrough',
    );
    // Oct 6: full day leave (10)
    final f = dayOf(me.id, d(5));
    f.leave = 'On leave';
    f.fullLeave = true;
    f.leaveRows.add(const LeaveRow(id: 'lv2', label: 'Sick · Full day'));
    // Oct 2 (previous week): past the weekly lock, not submitted (07)
    final l = dayOf(me.id, d(9))..locationId = 'l1';
    add(me.id, d(9), 't3', null, '09:00', '15:00', 'a2');
    l.weekLocked = true;
    // Team member days for review (22)
    dayOf('u2', d(0)).locationId = 'l2';
    add('u2', d(0), 't3', null, '09:00', '12:00', 'a2');
    final q = dayOf('u2', d(1))..locationId = 'l2';
    add('u2', d(1), 't3', null, '09:00', '11:00', 'a2');
    q.status = DayStatus.submitted;
    q.submittedAt = phInstant(d(1), 17, 0);

    saved.add(
      SavedReport(
        id: 'sr1',
        savedAt: phInstant(d(1), 17, 20),
        from: t.subtract(const Duration(days: 6)),
        to: d(1),
        totalActivities: 9,
        totalRendered: '31:30',
        tag: null,
        changedDates: [d(3)],
      ),
    );
  }

  bool _locked(String user, DateTime d) {
    final day = dayOf(user, d);
    return day.weekLocked || day.status == DayStatus.submitted || user != me.id;
  }

  TrackerEntry dto(MockEntry e) {
    final tp = e.taskId == null ? null : taskProjects[e.taskId];
    final task = e.taskId == null
        ? null
        : _tasks.firstWhere((t) => t.id == e.taskId);
    final day = dayOf(e.user, e.date);
    final locId = e.locationId ?? day.locationId;
    final n = now();
    return TrackerEntry(
      id: e.id,
      date: e.date,
      isQuick: e.taskId == null,
      project: tp == null ? null : (id: tp.$1, name: tp.$2),
      client: tp == null ? null : (id: 'c-${tp.$1}', name: tp.$3),
      task: task == null ? null : (id: task.id, name: task.name),
      title: e.title,
      startAt: e.start,
      endAt: e.end,
      running: e.end == null,
      minutes: e.end == null
          ? n.difference(e.start).inMinutes
          : e.end!.difference(e.start).inMinutes,
      autoStopped: e.autoStopped,
      activityType: _lk(activityTypes, e.activityTypeId),
      module: e.module.isEmpty ? null : e.module,
      location: locId == null ? null : _lk(locations, locId),
      locationOverridden: e.locationId != null,
      billable: e.billable,
      type: e.taskId == null ? null : (e.type ?? TimeType.execution),
      notes: e.notes.isEmpty ? null : e.notes,
      locked: _locked(e.user, e.date),
    );
  }

  IdName? _lk(List<Lookup> l, String id) {
    final x = l.where((a) => a.id == id).firstOrNull;
    return x == null ? null : (id: x.id, name: x.name);
  }

  TrackerDay day(DateTime date, String user) {
    final d = dayOf(user, date);
    final list = entriesOf(user, date).map(dto).toList()
      ..sort((a, b) => (a.startAt ?? date).compareTo(b.startAt ?? date));
    final own = user == me.id;
    final n = now();
    final editable = own && d.status != DayStatus.submitted && !d.weekLocked;
    return TrackerDay(
      user: people.firstWhere((p) => p.id == user),
      date: date,
      location: d.locationId == null ? null : _lk(locations, d.locationId!),
      status: d.status,
      submittedAt: d.submittedAt,
      reopened: List.of(d.reopened),
      notSubmitted: d.weekLocked && d.status != DayStatus.submitted,
      weekLocked: d.weekLocked,
      entries: list,
      totalMinutes: list.fold(0, (s, e) => s + e.minutesAt(n)),
      own: own,
      canEdit: editable && !d.fullLeave,
      canSubmit: editable && list.isNotEmpty,
      // Demo user is a supervisor and Admin: can reopen own past-lock days and reports' submitted days.
      canReopen: (d.status == DayStatus.submitted && !own) || d.weekLocked,
      leave: d.leave,
      leaveRows: List.of(d.leaveRows),
    );
  }

  MockEntry? get runningEntry {
    for (final l in entries.values) {
      for (final e in l) {
        if (e.user == me.id && e.end == null) return e;
      }
    }
    return null;
  }

  String nextId() => 'e${_seq++}';
}

class MockEntry {
  MockEntry({
    required this.id,
    required this.user,
    required this.date,
    this.taskId,
    this.title,
    required this.start,
    this.end,
    required this.activityTypeId,
    this.module = '',
    this.notes = '',
    this.billable = true,
    this.autoStopped = false,
    this.locationId,
    this.type,
  });
  final String id, user;
  final DateTime date;
  String? taskId, title, locationId;
  DateTime start;
  DateTime? end;
  String activityTypeId, module, notes;
  bool billable, autoStopped;
  TimeType? type;
}

class MockDay {
  String? locationId;
  DayStatus status = DayStatus.open;
  DateTime? submittedAt;
  final reopened = <ReopenInfo>[];
  bool weekLocked = false, fullLeave = false;
  String? leave;
  final leaveRows = <LeaveRow>[];
}

class MockTrackerRepository implements TrackerRepository {
  MockTrackerRepository(this.s);
  final MockTrackerStore s;
  static const _me = MockTrackerStore.me;

  @override
  Future<TrackerDay> day(DateTime date, {String? userId}) async {
    if (userId != null && !MockTrackerStore.people.any((p) => p.id == userId)) {
      throw ApiException('Not found', status: 404);
    }
    return s.day(DateTime(date.year, date.month, date.day), userId ?? _me.id);
  }

  @override
  Future<Running> running() async {
    final e = s.runningEntry;
    return Running(entry: e == null ? null : s.dto(e), serverNow: s.now());
  }

  void _assertEditable(DateTime date) {
    final d = s.dayOf(_me.id, date);
    if (d.weekLocked) {
      throw ApiException(_dayLockedAdmin, status: 422, code: 'DAY_LOCKED');
    }
    if (d.status == DayStatus.submitted) {
      throw ApiException(_dayLocked, status: 422, code: 'DAY_LOCKED');
    }
  }

  static const _dayLocked =
      'This day is locked. Ask your supervisor or an Admin to reopen it.';
  static const _dayLockedAdmin =
      'This day is past the weekly lock. Only an Admin can reopen it.';

  void _validate(EntryDraft d) {
    final f = <String, String>{};
    if ((d.taskId == null) == (d.title == null || d.title!.trim().isEmpty)) {
      f['taskId'] = 'Choose a task, or give the quick activity a title.';
    }
    if (d.activityTypeId.isEmpty) {
      f['activityTypeId'] = 'Choose an activity type.';
    }
    if ((d.module ?? '').trim().length > 100) {
      f['module'] = 'Keep the module under 100 characters.';
    }
    if (f.isNotEmpty) {
      throw ApiException(
        f.values.first,
        status: 400,
        code: 'VALIDATION_ERROR',
        fields: f,
      );
    }
  }

  void _leaveAndLocation(DateTime date, EntryDraft d) {
    final day = s.dayOf(_me.id, date);
    if (day.fullLeave) {
      throw ApiException(
        "You're on leave (Sick) this day, so time can't be logged.",
        status: 422,
        code: 'ON_LEAVE',
      );
    }
    if (day.leave != null && day.leave!.startsWith('Half') && !d.confirmLeave) {
      throw ApiException(
        'You have a half day leave (AM) this day. Log time for the other half only.',
        status: 409,
        code: 'HALF_DAY_LEAVE',
      );
    }
    if (day.locationId == null) {
      if (d.dayLocationId == null) {
        throw ApiException(
          "Choose where you're working today.",
          status: 400,
          code: 'LOCATION_NEEDED',
          fields: {'dayLocationId': 'Choose where you’re working today.'},
        );
      }
      day.locationId = d.dayLocationId;
    }
  }

  void _cap(DateTime date, int addMinutes, {String? except}) {
    final n = s.now();
    final total =
        s
            .entriesOf(_me.id, date)
            .where((e) => e.id != except)
            .fold<int>(
              0,
              (a, e) => a + (e.end ?? n).difference(e.start).inMinutes,
            ) +
        addMinutes;
    if (total > 24 * 60) {
      throw ApiException(
        "This would bring your total for ${shortDate(date)} to ${formatHoursMinutes(total)}. A day can't exceed 24 hours. Shorten or remove an entry.",
        status: 422,
        code: 'DAILY_CAP',
      );
    }
  }

  void _overlap(DateTime date, DateTime a, DateTime b, {String? except}) {
    for (final e in s.entriesOf(_me.id, date)) {
      if (e.id == except) continue;
      final end = e.end ?? s.now();
      if (a.isBefore(end) && b.isAfter(e.start)) {
        final dto = s.dto(e);
        throw ApiException(
          "This overlaps ${dto.name} (${formatTime12(e.start)}–${formatTime12(end)}). Adjust the times so they don't overlap.",
          status: 422,
          code: 'OVERLAP',
          fields: {'timeIn': 'Overlaps ${dto.name}.'},
        );
      }
    }
  }

  @override
  Future<TrackerEntry> start(EntryDraft d) async {
    _validate(d);
    final n = s.now();
    final date = phDate(n);
    _assertEditable(date);
    _leaveAndLocation(date, d);
    final cur = s.runningEntry;
    if (cur != null) {
      if (d.switchFrom != cur.id) {
        throw ApiException(
          'A timer is already running. Stop it first or switch.',
          status: 409,
          code: 'TIMER_RUNNING',
          details: {
            'running': {'id': cur.id, 'name': s.dto(cur).name},
          },
        );
      }
      cur.end = n;
    }
    _cap(date, 1);
    final e = MockEntry(
      id: s.nextId(),
      user: _me.id,
      date: date,
      taskId: d.taskId,
      title: d.title?.trim(),
      start: DateTime.fromMillisecondsSinceEpoch(
        n.millisecondsSinceEpoch ~/ 60000 * 60000,
        isUtc: true,
      ),
      activityTypeId: d.activityTypeId,
      module: d.module?.trim() ?? '',
      notes: d.notes?.trim() ?? '',
      billable: d.billable ?? d.taskId != null,
      locationId: d.locationId,
      type: d.type,
    );
    s.entriesOf(_me.id, date).add(e);
    return s.dto(e);
  }

  @override
  Future<TrackerEntry> stop(String entryId) async {
    for (final l in s.entries.values) {
      for (final e in l) {
        if (e.id == entryId) {
          e.end ??= s.now();
          return s.dto(e);
        }
      }
    }
    throw ApiException('Not found', status: 404);
  }

  (DateTime, DateTime) _times(DateTime date, String timeIn, String timeOut) {
    final a = timeIn.split(':').map(int.parse).toList(),
        b = timeOut.split(':').map(int.parse).toList();
    final start = phInstant(date, a[0], a[1]),
        end = phInstant(date, b[0], b[1]);
    if (!end.isAfter(start)) {
      throw ApiException(
        'Time out must be after time in.',
        status: 400,
        code: 'VALIDATION_ERROR',
        fields: {'timeOut': 'Time out must be after time in.'},
      );
    }
    if (end.isAfter(s.now())) {
      throw ApiException(
        "Time out can't be in the future.",
        status: 400,
        code: 'VALIDATION_ERROR',
        fields: {'timeOut': "Time out can't be in the future."},
      );
    }
    return (start, end);
  }

  @override
  Future<TrackerEntry> createEntry(EntryDraft d) async {
    _validate(d);
    final date = d.date!;
    _assertEditable(date);
    final (start, end) = _times(date, d.timeIn!, d.timeOut!);
    _leaveAndLocation(date, d);
    _overlap(date, start, end);
    _cap(date, end.difference(start).inMinutes);
    final e = MockEntry(
      id: s.nextId(),
      user: _me.id,
      date: date,
      taskId: d.taskId,
      title: d.title?.trim(),
      start: start,
      end: end,
      activityTypeId: d.activityTypeId,
      module: d.module?.trim() ?? '',
      notes: d.notes?.trim() ?? '',
      billable: d.billable ?? d.taskId != null,
      locationId: d.locationId,
      type: d.type,
    );
    s.entriesOf(_me.id, date).add(e);
    return s.dto(e);
  }

  MockEntry _find(String id) {
    for (final l in s.entries.values) {
      for (final e in l) {
        if (e.id == id) return e;
      }
    }
    throw ApiException('Not found', status: 404);
  }

  @override
  Future<TrackerEntry> updateEntry(String id, EntryDraft d) async {
    final e = _find(id);
    _assertEditable(e.date);
    if ((d.module ?? '').trim().length > 100) {
      throw ApiException(
        'Keep the module under 100 characters.',
        status: 400,
        fields: {'module': 'Keep the module under 100 characters.'},
      );
    }
    if (d.timeIn != null && d.timeOut != null) {
      final (start, end) = _times(e.date, d.timeIn!, d.timeOut!);
      _overlap(e.date, start, end, except: id);
      _cap(e.date, end.difference(start).inMinutes, except: id);
      e.start = start;
      e.end = end;
      e.autoStopped = false;
    }
    if (d.title != null) e.title = d.title!.trim();
    e.activityTypeId = d.activityTypeId;
    e.module = d.module?.trim() ?? '';
    e.notes = d.notes?.trim() ?? '';
    e.billable = d.billable ?? e.billable;
    e.locationId = d.locationId;
    e.type = d.type ?? e.type;
    return s.dto(e);
  }

  @override
  Future<void> deleteEntry(String id) async {
    final e = _find(id);
    _assertEditable(e.date);
    s.entriesOf(e.user, e.date).remove(e);
  }

  @override
  Future<void> setDayLocation(DateTime date, String locationId) async {
    _assertEditable(date);
    s.dayOf(_me.id, date).locationId = locationId;
  }

  @override
  Future<void> submitDay(DateTime date) async {
    _assertEditable(date);
    if (s.entriesOf(_me.id, date).any((e) => e.end == null)) {
      throw ApiException(
        'Stop the running timer before submitting this day.',
        status: 422,
        code: 'TIMER_RUNNING',
      );
    }
    final d = s.dayOf(_me.id, date)
      ..status = DayStatus.submitted
      ..submittedAt = s.now();
    d.weekLocked = d.weekLocked;
  }

  @override
  Future<void> reopenDay(DateTime date, String userId, String reason) async {
    if (reason.trim().isEmpty) {
      throw ApiException(
        'Add a reason for reopening.',
        status: 400,
        fields: {'reason': 'Add a reason for reopening.'},
      );
    }
    final d = s.dayOf(userId, date)
      ..status = DayStatus.reopened
      ..weekLocked = false;
    d.reopened.add(
      ReopenInfo(by: _me.name, at: s.now(), reason: reason.trim()),
    );
  }

  @override
  Future<List<IdName>> people() async => MockTrackerStore.people;

  @override
  Future<Lookups> lookups() async => const Lookups(
    activityTypes: MockTrackerStore.activityTypes,
    locations: MockTrackerStore.locations,
  );

  @override
  Future<Preselect?> preselect(String taskId) async {
    final tp = MockTrackerStore.taskProjects[taskId];
    if (tp == null) return const Preselect();
    final type = MockTrackerStore.projectTypes.firstWhere((t) => t.id == tp.$4);
    return Preselect(
      projectTypeName: type.name,
      activityType: type.defaultActivity,
    );
  }
}

class MockMyTasksRepository implements MyTasksRepository {
  MockMyTasksRepository(this.store, this.today);
  final MockStore store;
  final DateTime Function() today;

  @override
  Future<MyTasksResult> mine({required String view, String? query}) async {
    final t = today();
    final all = [
      for (final x in store.tasks)
        MyTask(
          id: x.id,
          name: x.name,
          project: (id: x.projectId, name: x.projectName),
          phase: x.phase,
          role: x.id == 't7'
              ? 'REVIEWER'
              : (x.ownerName == 'Jomerson Nazaire'
                    ? 'ACCOUNTABLE'
                    : 'ASSIGNEE'),
          dueDate: x.dueDate,
          plannedStart: x.plannedStart,
          overdue:
              x.dueDate != null &&
              x.dueDate!.isBefore(t) &&
              x.status != TaskStatus.done,
          daysLate: x.dueDate == null
              ? 0
              : t.difference(x.dueDate!).inDays.clamp(0, 999),
          status: x.status.api,
          section:
              x.plannedStart != null &&
                  x.plannedStart!.isBefore(t.subtract(const Duration(days: 3)))
              ? 'AGING'
              : 'PLANNED',
          ageDays: x.plannedStart == null
              ? null
              : t.difference(x.plannedStart!).inDays,
        ),
    ];
    bool open(MyTask m) => m.status != 'COMPLETED' && m.status != 'CANCELLED';
    final items =
        switch (view) {
              'today' =>
                all.where((m) => open(m) && m.status != 'FOR_REVIEW').toList(),
              'due' =>
                all
                    .where(
                      (m) =>
                          open(m) &&
                          m.dueDate != null &&
                          !m.dueDate!.isAfter(t),
                    )
                    .toList(),
              'assigned' =>
                all.where((m) => open(m) && m.role == 'ASSIGNEE').toList(),
              'accountable' =>
                all.where((m) => open(m) && m.role == 'ACCOUNTABLE').toList(),
              'review' => all.where((m) => m.status == 'FOR_REVIEW').toList(),
              'completed' => all.where((m) => m.status == 'COMPLETED').toList(),
              _ => all,
            }
            .where(
              (m) =>
                  query == null ||
                  m.name.toLowerCase().contains(query.toLowerCase()),
            )
            .toList();
    return MyTasksResult(
      items: items,
      overdue: all.where((m) => open(m) && m.overdue).length,
      dueThisWeek: all
          .where(
            (m) =>
                open(m) &&
                m.dueDate != null &&
                m.dueDate!.difference(t).inDays.abs() < 7,
          )
          .length,
      toReview: all.where((m) => m.status == 'FOR_REVIEW').length,
    );
  }
}

class MockHoursRepository implements HoursRepository {
  MockHoursRepository(this.s);
  final MockTrackerStore s;

  @override
  Future<List<HoursEntry>> week(DateTime anyDay) async {
    final start = mondayOf(anyDay);
    final out = <HoursEntry>[];
    for (var i = 0; i < 7; i++) {
      final d = start.add(Duration(days: i));
      for (final e in s.entriesOf(MockTrackerStore.me.id, d)) {
        final dto = s.dto(e);
        if (dto.isQuick) continue; // FR-TIME lists project time
        out.add(
          HoursEntry(
            id: e.id,
            project: dto.project!,
            task: dto.task!,
            date: d,
            minutes: dto.minutesAt(s.now()),
            type: dto.type,
            notes: dto.notes,
            locked: dto.locked,
          ),
        );
      }
    }
    out.sort((a, b) => b.date.compareTo(a.date));
    return out;
  }

  @override
  Future<void> update(
    String id, {
    double? hours,
    TimeType? type,
    String? notes,
  }) async {}

  @override
  Future<void> delete(String id) async {
    for (final l in s.entries.values) {
      l.removeWhere((e) => e.id == id);
    }
  }
}

class MockDarRepository implements DarRepository {
  MockDarRepository(this.s);
  final MockTrackerStore s;

  @override
  Future<DarReport> generate(DateTime from, DateTime to) async {
    final err = validateDarRange(from, to);
    if (err != null) {
      throw ApiException(err.$2, status: 400, fields: {err.$1: err.$2});
    }
    final shownTo = to.isAfter(s.today) ? s.today : to;
    final rows = <DarRow>[];
    final days = <DarDayStatusInfo>[];
    var total = 0;
    for (
      var d = from;
      !d.isAfter(shownTo);
      d = d.add(const Duration(days: 1))
    ) {
      final day = s.day(d, MockTrackerStore.me.id);
      final list = day.entries.where((e) => !e.running).toList();
      if (day.leave != null) {
        rows.add(DarRow(date: d, leave: true, remarks: day.leave!));
      }
      for (final e in list) {
        total += e.minutes;
        rows.add(
          DarRow(
            date: d,
            timeIn: e.startAt == null ? '' : formatTime12(e.startAt!),
            timeOut: e.endAt == null ? '' : formatTime12(e.endAt!),
            rendered: formatHHMM(e.minutes),
            client: e.client?.name ?? '',
            project: e.project?.name ?? '',
            activityType: e.activityType?.name ?? '',
            location: e.location?.name ?? '',
            billable: e.billable ? 'Yes' : 'No',
            module: e.module ?? '',
            remarks: e.notes ?? e.name,
          ),
        );
      }
      if (list.isNotEmpty || day.leave != null) {
        days.add(
          DarDayStatusInfo(
            date: d,
            status: day.status == DayStatus.submitted
                ? 'Submitted'
                : day.status == DayStatus.reopened
                ? 'Reopened'
                : 'Not submitted',
            leave: day.leave,
          ),
        );
      }
    }
    return DarReport(
      userName: MockTrackerStore.me.name,
      supervisor: 'Queen Reyes',
      cc: const ['ops@xceler8.com', 'hr@xceler8.com'],
      from: from,
      to: to,
      shownTo: shownTo,
      totalActivities: rows.where((r) => !r.leave).length,
      totalRendered: formatHHMM(total),
      rows: rows,
      days: days,
    );
  }

  @override
  Future<List<SavedReport>> saved({DateTime? from, DateTime? to}) async => s
      .saved
      .where((r) => from == null || !phDate(r.savedAt).isBefore(from))
      .where((r) => to == null || !phDate(r.savedAt).isAfter(to))
      .toList()
      .reversed
      .toList();

  @override
  Future<SavedReport> save(DateTime from, DateTime to) async {
    final rep = await generate(from, to);
    final same = s.saved.where((r) => r.from == from && r.to == to).toList();
    final item = SavedReport(
      id: 'sr${s.saved.length + 1}',
      savedAt: s.now(),
      from: from,
      to: to,
      totalActivities: rep.totalActivities,
      totalRendered: rep.totalRendered,
      tag: same.isEmpty ? null : 'LATEST',
      report: rep,
    );
    for (final o in same) {
      s.saved[s.saved.indexOf(o)] = SavedReport(
        id: o.id,
        savedAt: o.savedAt,
        from: o.from,
        to: o.to,
        totalActivities: o.totalActivities,
        totalRendered: o.totalRendered,
        tag: 'EARLIER',
        changedDates: o.changedDates,
        report: o.report,
      );
    }
    s.saved.add(item);
    return item;
  }

  @override
  Future<SavedReport> savedDetail(String id) async {
    final r = s.saved.where((x) => x.id == id).firstOrNull;
    if (r == null) throw ApiException('Not found', status: 404);
    if (r.report != null) return r;
    final rep = await generate(r.from, r.to);
    return SavedReport(
      id: r.id,
      savedAt: r.savedAt,
      from: r.from,
      to: r.to,
      totalActivities: r.totalActivities,
      totalRendered: r.totalRendered,
      tag: r.tag,
      changedDates: r.changedDates,
      report: DarReport(
        userName: rep.userName,
        supervisor: rep.supervisor,
        cc: rep.cc,
        from: rep.from,
        to: rep.to,
        shownTo: rep.shownTo,
        totalActivities: rep.totalActivities,
        totalRendered: rep.totalRendered,
        rows: rep.rows,
        days: rep.days,
        exportName: 'Project Activity Tracker Application',
      ),
    );
  }
}

class MockProjectAdminRepository implements ProjectAdminRepository {
  MockProjectAdminRepository(this.store);
  final MockStore store;
  @override
  Future<List<ProjectTypeInfo>> projectTypes() async =>
      MockTrackerStore.projectTypes;
  @override
  Future<List<NamedRef>> templates() async => const [
    NamedRef('tp1', 'SAP B1 Implementation', version: 3),
    NamedRef('tp2', 'Support onboarding', version: 1),
  ];
  @override
  Future<List<NamedRef>> clients() async => const [
    NamedRef('c1', 'Acme Corp'),
    NamedRef('c2', 'Globex'),
    NamedRef('c3', 'Initech'),
    NamedRef('c4', 'Umbrella Corp'),
  ];
  @override
  Future<List<NamedRef>> people() async => const [
    NamedRef('u1', 'Jomerson Nazaire'),
    NamedRef('u2', 'Queen Reyes'),
    NamedRef('u3', 'Mark Kim'),
  ];

  @override
  Future<String> create(ProjectInput p) async {
    final types = MockTrackerStore.projectTypes;
    final t = types.where((x) => x.id == p.projectTypeId).firstOrNull;
    if (t != null && !t.active) {
      throw ApiException(
        'This project type is inactive. Choose an active one.',
        status: 422,
        fields: {
          'projectTypeId':
              'This project type is inactive. Choose an active one.',
        },
      );
    }
    final clients = await this.clients();
    final id = 'p${store.projects.length + 1}';
    store.projects.add(
      Project(
        id: id,
        name: p.name!,
        clientName: clients.firstWhere((c) => c.id == p.clientId).name,
        status: ProjectStatus.planning,
        progress: 0,
        goLive: p.endDate,
        managerName: 'Jomerson Nazaire',
        projectTypeId: t?.id,
        projectTypeName: t?.name,
        clientId: p.clientId,
        managerId: p.managerId,
        startDate: p.startDate,
        code: p.code,
      ),
    );
    if (p.memberIds != null) {
      await MockProjectExtrasRepository(store)
          .setMembers(id, {...p.memberIds!, ?p.managerId}.toList());
    }
    return id;
  }

  @override
  Future<void> update(String id, ProjectInput p) async {
    if (p.memberIds != null) {
      await MockProjectExtrasRepository(store)
          .setMembers(id, {...p.memberIds!, ?p.managerId}.toList());
    }
    final i = store.projects.indexWhere((x) => x.id == id);
    final o = store.projects[i];
    final t = MockTrackerStore.projectTypes
        .where((x) => x.id == p.projectTypeId)
        .firstOrNull;
    if (t != null && !t.active && t.id != o.projectTypeId) {
      throw ApiException(
        'This project type is inactive. Choose an active one.',
        status: 422,
        fields: {
          'projectTypeId':
              'This project type is inactive. Choose an active one.',
        },
      );
    }
    store.projects[i] = Project(
      id: o.id,
      name: p.name ?? o.name,
      clientName: o.clientName,
      status: p.status == null ? o.status : ProjectStatus.fromApi(p.status),
      progress: o.progress,
      goLive: p.endDate ?? o.goLive,
      managerName:
          const {
            'u1': 'Jomerson Nazaire',
            'u2': 'Queen Reyes',
            'u3': 'Mark Kim',
          }[p.managerId] ??
          o.managerName,
      taskCount: o.taskCount,
      projectTypeId: t?.id ?? o.projectTypeId,
      projectTypeName: t?.name ?? o.projectTypeName,
      projectTypeActive: t?.active ?? o.projectTypeActive,
      clientId: p.clientId ?? o.clientId,
      managerId: p.managerId ?? o.managerId,
      startDate: p.startDate ?? o.startDate,
      code: p.code ?? o.code,
      description: p.description ?? o.description,
    );
  }
}
