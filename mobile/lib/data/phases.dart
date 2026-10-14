import 'api_client.dart';
import 'mock_repositories.dart';
import 'models.dart';

/// GET /projects/:id/phases item (PhaseDto, FR-PRJ-22/23).
class PhaseInfo {
  const PhaseInfo({
    required this.name,
    this.taskCount = 0,
    this.documentCount = 0,
    this.deletable = false,
    this.deleteBlockedReason,
    this.editable = false,
  });
  final String name;
  final int taskCount, documentCount;
  final bool deletable, editable;
  final String? deleteBlockedReason;

  factory PhaseInfo.fromJson(Map<String, dynamic> j) => PhaseInfo(
    name: j['name'] as String,
    taskCount: (j['taskCount'] as num? ?? 0).toInt(),
    documentCount: (j['documentCount'] as num? ?? 0).toInt(),
    deletable: j['deletable'] == true,
    deleteBlockedReason: j['deleteBlockedReason'] as String?,
    editable: j['editable'] == true,
  );
}

/// POST /projects/:id/apply-template result.
class ApplyTemplateResult {
  const ApplyTemplateResult({
    required this.templateName,
    this.phasesAdded = 0,
    this.phasesMerged = 0,
    this.tasksAdded = 0,
    this.alreadyApplied = false,
  });
  final String templateName;
  final int phasesAdded, phasesMerged, tasksAdded;
  final bool alreadyApplied;

  /// Toast copy (design delta D22).
  String get toast {
    if (alreadyApplied) {
      return '$templateName is already applied to this project. Applying it again adds nothing.';
    }
    String n(int c, String one, String many) => '$c ${c == 1 ? one : many}';
    final parts = [
      if (phasesAdded > 0) n(phasesAdded, 'phase', 'phases'),
      if (tasksAdded > 0) n(tasksAdded, 'activity', 'activities'),
    ];
    return parts.isEmpty
        ? 'Nothing new to add from $templateName.'
        : 'Added ${parts.join(' and ')} from $templateName.';
  }
}

abstract interface class PhaseRepository {
  Future<List<PhaseInfo>> phases(String projectId);
  Future<void> add(String projectId, String name);
  Future<void> rename(String projectId, String name, String newName);
  Future<void> delete(String projectId, String name);
  Future<ApplyTemplateResult> applyTemplate(
    String projectId,
    String templateId, {
    int? templateVersion,
  });
}

class ApiPhaseRepository implements PhaseRepository {
  ApiPhaseRepository(this.api);
  final ApiClient api;

  @override
  Future<List<PhaseInfo>> phases(String projectId) async {
    final b = await api.get('/projects/$projectId/phases');
    return [
      for (final i in (b['items'] as List? ?? const []))
        PhaseInfo.fromJson(i as Map<String, dynamic>),
    ];
  }

  @override
  Future<void> add(String projectId, String name) =>
      api.post('/projects/$projectId/phases', {'name': name.trim()});

  @override
  Future<void> rename(String projectId, String name, String newName) =>
      api.patch('/projects/$projectId/phases', {
        'name': name,
        'newName': newName.trim(),
      });

  @override
  Future<void> delete(String projectId, String name) => api.delete(
    '/projects/$projectId/phases?name=${Uri.encodeQueryComponent(name)}',
  );

  @override
  Future<ApplyTemplateResult> applyTemplate(
    String projectId,
    String templateId, {
    int? templateVersion,
  }) async {
    final b = await api.post('/projects/$projectId/apply-template', {
      'templateId': templateId,
      'templateVersion': ?templateVersion,
    });
    final t = b['template'];
    return ApplyTemplateResult(
      templateName: t is Map ? '${t['name']}' : 'the template',
      phasesAdded: (b['phasesAdded'] as num? ?? 0).toInt(),
      phasesMerged: (b['phasesMerged'] as num? ?? 0).toInt(),
      tasksAdded: (b['tasksAdded'] as num? ?? 0).toInt(),
      alreadyApplied: b['alreadyApplied'] == true,
    );
  }
}

/// Demo/tests: phases come from the project's tasks plus empty phases added here.
class MockPhaseRepository implements PhaseRepository {
  MockPhaseRepository(this.store);
  final MockStore store;
  static final _extra = Expando<Map<String, List<String>>>();
  static final _applied = Expando<Set<String>>();
  Map<String, List<String>> get _x => _extra[store] ??= {};

  static const templatePhases = {
    'tp1': ['Discovery', 'Build', 'Go-live'],
    'tp2': ['Onboarding'],
  };
  static const templateNames = {
    'tp1': 'SAP B1 Implementation',
    'tp2': 'Support onboarding',
  };

  String _k(String s) => s.trim().toLowerCase();

  Project _project(String id) => store.projects.firstWhere(
    (p) => p.id == id,
    orElse: () => throw ApiException('Not found', status: 404),
  );

  void _assertEdit(String id) {
    if (_project(id).status != ProjectStatus.planning) {
      throw ApiException(
        'Phase details can only be changed while the project is in Planning.',
        status: 422,
        code: 'PROJECT_NOT_PLANNING',
      );
    }
  }

  @override
  Future<List<PhaseInfo>> phases(String projectId) async {
    final p = _project(projectId);
    final editable = p.status == ProjectStatus.planning;
    final counts = <String, int>{};
    for (final t in store.tasks.where((t) => t.projectId == projectId)) {
      if (t.phase != null) counts[t.phase!] = (counts[t.phase!] ?? 0) + 1;
    }
    for (final e in _x[projectId] ?? const <String>[]) {
      counts.putIfAbsent(e, () => 0);
    }
    return [
      for (final e in counts.entries)
        PhaseInfo(
          name: e.key,
          taskCount: e.value,
          editable: editable,
          deletable: editable && e.value == 0,
          deleteBlockedReason: e.value == 0
              ? null
              : "Can't delete: this phase still has ${e.value} ${e.value == 1 ? 'activity. Delete it first.' : 'activities. Delete them first.'}",
        ),
    ];
  }

  @override
  Future<void> add(String projectId, String name) async {
    _assertEdit(projectId);
    final n = name.trim();
    if (n.isEmpty) {
      throw ApiException(
        'Add a phase name.',
        status: 400,
        fields: {'name': 'Add a phase name.'},
      );
    }
    if ((await phases(projectId)).any((p) => _k(p.name) == _k(n))) {
      throw ApiException(
        '"$n" already exists.',
        status: 409,
        code: 'DUPLICATE_NAME',
        fields: {'name': '"$n" already exists.'},
      );
    }
    (_x[projectId] ??= []).add(n);
  }

  @override
  Future<void> rename(String projectId, String name, String newName) async {
    _assertEdit(projectId);
    final n = newName.trim();
    if ((await phases(projectId))
        .any((p) => _k(p.name) == _k(n) && _k(p.name) != _k(name))) {
      throw ApiException(
        '"$n" already exists.',
        status: 409,
        code: 'DUPLICATE_NAME',
        fields: {'newName': '"$n" already exists.'},
      );
    }
    final l = _x[projectId];
    if (l != null) {
      final i = l.indexWhere((e) => _k(e) == _k(name));
      if (i >= 0) l[i] = n;
    }
    for (var i = 0; i < store.tasks.length; i++) {
      final t = store.tasks[i];
      if (t.projectId == projectId && t.phase == name) {
        store.tasks[i] = t.copyWith(phase: n);
      }
    }
  }

  @override
  Future<void> delete(String projectId, String name) async {
    _assertEdit(projectId);
    final ph = (await phases(projectId))
        .firstWhere((p) => _k(p.name) == _k(name));
    if (ph.taskCount > 0) {
      throw ApiException(
        ph.deleteBlockedReason!,
        status: 409,
        code: 'PHASE_NOT_EMPTY',
      );
    }
    _x[projectId]?.removeWhere((e) => _k(e) == _k(name));
  }

  @override
  Future<ApplyTemplateResult> applyTemplate(
    String projectId,
    String templateId, {
    int? templateVersion,
  }) async {
    _assertEdit(projectId);
    final name = templateNames[templateId] ?? 'Template';
    final applied = _applied[store] ??= {};
    if (!applied.add('$projectId/$templateId')) {
      return ApplyTemplateResult(templateName: name, alreadyApplied: true);
    }
    final existing = {for (final p in await phases(projectId)) _k(p.name)};
    var added = 0, merged = 0;
    for (final ph in templatePhases[templateId] ?? const <String>[]) {
      if (existing.contains(_k(ph))) {
        merged++;
      } else {
        (_x[projectId] ??= []).add(ph);
        added++;
      }
    }
    return ApplyTemplateResult(
      templateName: name,
      phasesAdded: added,
      phasesMerged: merged,
    );
  }
}
