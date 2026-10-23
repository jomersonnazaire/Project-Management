import 'action_email.dart';
import 'api_client.dart';
import 'models.dart';
import 'ph_time.dart';
import 'tracker_models.dart';

/// M5–M8 repositories (m8-polish API). See README for the endpoint map.
abstract interface class TrackerRepository {
  Future<TrackerDay> day(DateTime date, {String? userId});
  Future<Running> running();

  /// POST /tracker/start. Throws ApiException 409 TIMER_RUNNING / HALF_DAY_LEAVE, 400 LOCATION_NEEDED.
  Future<TrackerEntry> start(EntryDraft d);

  /// POST /tracker/stop {entryId} (idempotent).
  Future<TrackerEntry> stop(String entryId);
  Future<TrackerEntry> createEntry(EntryDraft d);
  Future<TrackerEntry> updateEntry(String id, EntryDraft d);
  Future<void> deleteEntry(String id);
  Future<void> setDayLocation(DateTime date, String locationId);
  Future<void> submitDay(DateTime date);
  Future<void> reopenDay(DateTime date, String userId, String reason);

  /// GET /tracker/people: self + people the caller can review.
  Future<List<IdName>> people();
  Future<Lookups> lookups();

  /// GET /project-types/preselect?taskId=
  Future<Preselect?> preselect(String taskId);
}

abstract interface class MyTasksRepository {
  Future<MyTasksResult> mine({required String view, String? query});
}

abstract interface class HoursRepository {
  /// GET /time?week= (the API takes a week, not from/to).
  Future<List<HoursEntry>> week(DateTime anyDay);
  Future<void> update(
    String id, {
    double? hours,
    TimeType? type,
    String? notes,
  });
  Future<void> delete(String id);
}

abstract interface class DarRepository {
  Future<DarReport> generate(DateTime from, DateTime to);
  Future<List<SavedReport>> saved({DateTime? from, DateTime? to});
  Future<SavedReport> save(DateTime from, DateTime to);
  Future<SavedReport> savedDetail(String id);
}

class NamedRef {
  const NamedRef(this.id, this.name, {this.version});
  final String id, name;
  final int? version;
}

class ProjectInput {
  const ProjectInput({
    this.templateId,
    this.templateVersion,
    this.name,
    this.code,
    this.clientId,
    this.projectTypeId,
    this.managerId,
    this.startDate,
    this.endDate,
    this.description,
    this.status,
    this.rebaselineReason,
    this.memberIds,
  });
  final String? templateId,
      name,
      code,
      clientId,
      projectTypeId,
      managerId,
      description,
      status,
      rebaselineReason;
  final List<String>? memberIds;
  final int? templateVersion;
  final DateTime? startDate, endDate;
}

abstract interface class ProjectAdminRepository {
  Future<List<ProjectTypeInfo>> projectTypes();
  Future<List<NamedRef>> templates();
  Future<List<NamedRef>> clients();
  Future<List<NamedRef>> people();

  /// [email]: "Email new members" (PR #37); filled from the save response.
  Future<String> create(ProjectInput p, {EmailOnSave? email});
  Future<void> update(String id, ProjectInput p, {EmailOnSave? email});
}

List<Map<String, dynamic>> _items(Map<String, dynamic> b) => [
  for (final i in (b['items'] as List? ?? const [])) i as Map<String, dynamic>,
];

class ApiTrackerRepository implements TrackerRepository {
  ApiTrackerRepository(this.api);
  final ApiClient api;

  @override
  Future<TrackerDay> day(DateTime date, {String? userId}) async =>
      TrackerDay.fromJson(
        (await api.get('/tracker/day', {
              'date': ymd(date),
              'userId': ?userId,
            }))['day']
            as Map<String, dynamic>,
      );

  @override
  Future<Running> running() async {
    final b = await api.get('/tracker/running');
    final now = DateTime.tryParse('${b['now']}');
    if (now != null) api.observeServerNow(now);
    return Running(
      entry: b['entry'] is Map
          ? TrackerEntry.fromJson(b['entry'] as Map<String, dynamic>)
          : null,
      serverNow: DateTime.tryParse('${b['now']}') ?? DateTime.now(),
    );
  }

  TrackerEntry _entry(Map<String, dynamic> b) =>
      TrackerEntry.fromJson(b['entry'] as Map<String, dynamic>);

  @override
  Future<TrackerEntry> start(EntryDraft d) async =>
      _entry(await api.post('/tracker/start', d.toJson(timer: true)));

  @override
  Future<TrackerEntry> stop(String entryId) async =>
      _entry(await api.post('/tracker/stop', {'entryId': entryId}));

  @override
  Future<TrackerEntry> createEntry(EntryDraft d) async =>
      _entry(await api.post('/tracker/entries', d.toJson()));

  @override
  Future<TrackerEntry> updateEntry(String id, EntryDraft d) async =>
      _entry(await api.patch('/tracker/entries/$id', d.toJson(update: true)));

  @override
  Future<void> deleteEntry(String id) => api.delete('/tracker/entries/$id');

  @override
  Future<void> setDayLocation(DateTime date, String locationId) => api.put(
    '/tracker/days/${ymd(date)}/location',
    {'locationId': locationId},
  );

  @override
  Future<void> submitDay(DateTime date) =>
      api.post('/tracker/days/${ymd(date)}/submit');

  @override
  Future<void> reopenDay(DateTime date, String userId, String reason) =>
      api.post('/tracker/days/${ymd(date)}/reopen', {
        'userId': userId,
        'reason': reason,
      });

  @override
  Future<List<IdName>> people() async => [
    for (final p in _items(await api.get('/tracker/people')))
      (id: '${p['id']}', name: '${p['name']}'),
  ];

  @override
  Future<Lookups> lookups() async {
    final b = await api.get('/lookups');
    List<Lookup> l(String k) => [
      for (final x in (b[k] as List? ?? const []))
        Lookup.fromJson(x as Map<String, dynamic>),
    ];
    return Lookups(
      activityTypes: l('activityTypes'),
      locations: l('locations'),
    );
  }

  @override
  Future<Preselect?> preselect(String taskId) async {
    final p = (await api.get('/project-types/preselect', {
      'taskId': taskId,
    }))['preselect'];
    return p is Map<String, dynamic> ? Preselect.fromJson(p) : null;
  }
}

class ApiMyTasksRepository implements MyTasksRepository {
  ApiMyTasksRepository(this.api);
  final ApiClient api;
  @override
  Future<MyTasksResult> mine({required String view, String? query}) async {
    final b = await api.get('/tasks/mine', {
      'view': view,
      if (query != null && query.isNotEmpty) 'q': query,
    });
    final c = (b['counts'] as Map?) ?? const {};
    int n(String k) => (c[k] as num?)?.toInt() ?? 0;
    return MyTasksResult(
      items: _items(b).map(MyTask.fromJson).toList(),
      overdue: n('overdue'),
      dueThisWeek: n('dueThisWeek'),
      toReview: n('toReview'),
    );
  }
}

class ApiHoursRepository implements HoursRepository {
  ApiHoursRepository(this.api);
  final ApiClient api;
  @override
  Future<List<HoursEntry>> week(DateTime anyDay) async =>
      _items(await api.get('/time', {'week': ymd(anyDay)}))
          .map(HoursEntry.fromJson)
          .toList();
  @override
  Future<void> update(
    String id, {
    double? hours,
    TimeType? type,
    String? notes,
  }) => api.patch('/time/$id', {
    'hours': ?hours,
    if (type != null) 'type': type.api,
    'notes': ?notes,
  });
  @override
  Future<void> delete(String id) => api.delete('/time/$id');
}

class ApiDarRepository implements DarRepository {
  ApiDarRepository(this.api);
  final ApiClient api;
  @override
  Future<DarReport> generate(DateTime from, DateTime to) async =>
      DarReport.fromJson(
        (await api.get('/dar', {'from': ymd(from), 'to': ymd(to)}))['report']
            as Map<String, dynamic>,
      );
  @override
  Future<List<SavedReport>> saved({DateTime? from, DateTime? to}) async =>
      _items(
        await api.get('/dar/saved', {
          if (from != null) 'from': ymd(from),
          if (to != null) 'to': ymd(to),
        }),
      ).map(SavedReport.fromJson).toList();
  @override
  Future<SavedReport> save(DateTime from, DateTime to) async =>
      SavedReport.fromJson(
        (await api.post('/dar/saved', {
              'from': ymd(from),
              'to': ymd(to),
            }))['item']
            as Map<String, dynamic>,
      );
  @override
  Future<SavedReport> savedDetail(String id) async => SavedReport.fromJson(
    (await api.get('/dar/saved/$id'))['item'] as Map<String, dynamic>,
  );
}

class ApiProjectAdminRepository implements ProjectAdminRepository {
  ApiProjectAdminRepository(this.api);
  final ApiClient api;
  @override
  Future<List<ProjectTypeInfo>> projectTypes() async {
    try {
      return _items(await api.get('/project-types'))
          .map(ProjectTypeInfo.fromJson)
          .toList();
    } on ApiException catch (e) {
      // APIs deployed before project types (m8-project-type) don't have the route:
      // the form and filters work without types instead of failing.
      if (e.status == 404) return const [];
      rethrow;
    }
  }

  @override
  Future<List<NamedRef>> templates() async => [
    for (final t in _items(await api.get('/templates')))
      NamedRef(
        '${t['id']}',
        '${t['name']}',
        version: (t['version'] as num?)?.toInt(),
      ),
  ];
  @override
  Future<List<NamedRef>> clients() async => [
    for (final c in _items(await api.get('/clients', {'pageSize': '100'})))
      NamedRef('${c['id']}', '${c['name']}'),
  ];
  @override
  Future<List<NamedRef>> people() async => [
    for (final c in _items(await api.get('/people')))
      NamedRef('${c['id']}', '${c['name']}'),
  ];

  Map<String, dynamic> _body(ProjectInput p) => {
    'name': ?p.name,
    if (p.code != null && p.code!.isNotEmpty) 'code': p.code,
    'clientId': ?p.clientId,
    'projectTypeId': ?p.projectTypeId,
    'managerId': ?p.managerId,
    'memberIds': ?p.memberIds,
    if (p.startDate != null) 'startDate': ymd(p.startDate!),
    if (p.endDate != null) 'plannedEndDate': ymd(p.endDate!),
    if (p.description != null && p.description!.isNotEmpty)
      'description': p.description,
  };

  @override
  Future<String> create(ProjectInput p, {EmailOnSave? email}) async {
    final b = await api.post('/projects', {
      ..._body(p),
      'templateId': ?p.templateId,
      'templateVersion': ?p.templateVersion,
      ...?email?.fields('emailAddedMembers'),
    });
    email?.start = EmailStart.fromJson(b['email']);
    return '${(b['project'] as Map)['id']}';
  }

  @override
  Future<void> update(String id, ProjectInput p, {EmailOnSave? email}) async {
    final b = await api.patch('/projects/$id', {
      ..._body(p),
      'status': ?p.status,
      if (p.rebaselineReason != null && p.rebaselineReason!.isNotEmpty)
        'reason': p.rebaselineReason,
      ...?email?.fields('emailAddedMembers'),
    });
    email?.start = EmailStart.fromJson(b['email']);
  }
}

/// Maps a thrown error to a readable message for banners/snackbars.
String errorText(Object e) => e is ApiException ? e.message : '$e';
