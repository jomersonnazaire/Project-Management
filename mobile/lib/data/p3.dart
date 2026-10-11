// P3 (m8-polish): issues, documents, conversation, clients, dashboard, my projects, workload,
// reports, profile/password. The API answers JSON; the mock answers the same JSON shapes, so the
// UI parses one format. Helpers below read it defensively.
import 'api_client.dart';
import 'mock_repositories.dart';
import 'models.dart';
import 'ph_time.dart';

typedef Json = Map<String, dynamic>;

List<Json> jsonList(Object? v) => [
  for (final e in (v as List? ?? const [])) e as Json,
];
String? refName(Object? v) => v is Map ? v['name'] as String? : null;
String? refId(Object? v) => v is Map ? v['id'] as String? : null;
DateTime? jsonDate(Object? v) =>
    v is String && v.length >= 10 ? DateTime.tryParse(v) : null;

const issueStatusLabels = {
  'OPEN': 'Open',
  'IN_PROGRESS': 'In progress',
  'WAITING_ON_CLIENT': 'Waiting on client',
  'RESOLVED': 'Resolved',
  'CLOSED': 'Closed',
};
const issueSeverityLabels = {
  'CRITICAL': 'Critical',
  'HIGH': 'High',
  'MEDIUM': 'Medium',
  'LOW': 'Low',
};
const issueStageLabels = {
  'BEFORE_GO_LIVE': 'Before go-live',
  'AFTER_GO_LIVE': 'After go-live',
};
const issueTransitions = {
  'OPEN': ['IN_PROGRESS', 'CLOSED'],
  'IN_PROGRESS': ['WAITING_ON_CLIENT', 'RESOLVED'],
  'WAITING_ON_CLIENT': ['IN_PROGRESS'],
  'RESOLVED': ['CLOSED', 'IN_PROGRESS'],
  'CLOSED': ['IN_PROGRESS'],
};

/// transitionLabel() from packages/shared/src/issues.ts.
String transitionLabel(String from, String to) {
  if (to == 'IN_PROGRESS') {
    return from == 'OPEN'
        ? 'Start'
        : (from == 'WAITING_ON_CLIENT' ? 'Client responded' : 'Reopen');
  }
  if (to == 'WAITING_ON_CLIENT') return 'Move to Waiting on client';
  if (to == 'RESOLVED') return 'Mark resolved';
  return from == 'OPEN' ? 'Close as duplicate / not an issue' : 'Close';
}

bool transitionNeedsReason(String from, String to) =>
    (from == 'OPEN' && to == 'CLOSED') ||
    ((from == 'RESOLVED' || from == 'CLOSED') && to == 'IN_PROGRESS');

const documentStatusLabels = {
  'REQUESTED': 'Requested',
  'SUBMITTED': 'Submitted',
  'SIGNED': 'Signed',
  'CANCELLED': 'Cancelled',
};
const messageTypeLabels = {
  'NOTE': 'Note',
  'CALL': 'Call',
  'MEETING': 'Meeting',
  'DECISION': 'Decision',
};
const reportNames = {
  'project-status': 'Project status',
  'effort-variance': 'Effort variance',
  'overdue': 'Overdue tasks',
  'issues': 'Issues',
  'timesheets': 'Timesheets',
};
const passwordPolicy = '8+ characters, a number and a symbol';

/// Client check that mirrors the server password policy.
String? passwordProblem(String p) {
  if (p.length < 8 ||
      !RegExp(r'\d').hasMatch(p) ||
      !RegExp(r'[^A-Za-z0-9]').hasMatch(p)) {
    return 'Use $passwordPolicy.';
  }
  return null;
}

abstract interface class P3Repository {
  // Issues
  Future<Json> issue(String id);
  Future<List<Json>> issueActivity(String id);
  Future<List<Json>> issues({String? taskId, String? projectId});
  Future<Json> issueOptions(String projectId);
  Future<String> createIssue(String projectId, Json body);
  Future<void> issueStatus(String id, Json body);
  Future<void> issueComment(String id, String text);
  Future<void> updateIssue(String id, Json body);
  // Documents & conversation
  Future<List<Json>> folders(String projectId);
  Future<List<Json>> documents(
    String projectId, {
    String? folderId,
    String? status,
  });
  Future<String> downloadUrl(String projectId, String docId);
  Future<void> uploadDocument(
    String projectId,
    String folderId,
    String name,
    List<int> bytes, {
    String? fulfils,
  });
  Future<List<Json>> messages(String projectId);
  Future<void> postMessage(String projectId, Json body);
  // Clients
  Future<List<Json>> clients();
  Future<Json> client(String id);
  Future<List<Json>> clientContacts(String id);
  Future<List<Json>> clientProjects(String id);
  Future<void> addContact(String clientId, Json body);
  // Dashboard & reports
  Future<Json> dashboard();
  Future<List<Json>> myProjects();
  Future<List<Json>> workload();
  Future<Json> report(String name);
  Future<List<Json>> waitingOnClient();
  Future<List<Json>> myDocumentRequests();
  // Account
  Future<Json> profile(String userId);
  Future<void> changePassword(String current, String next);
  Future<Json> verifyInvite(String token);
}

class ApiP3Repository implements P3Repository {
  ApiP3Repository(this.api);
  final ApiClient api;
  Map<String, String> _q(Map<String, String?> m) => {
    for (final e in m.entries)
      if (e.value != null) e.key: e.value!,
  };

  @override
  Future<Json> issue(String id) async =>
      (await api.get('/issues/$id'))['issue'] as Json;
  @override
  Future<List<Json>> issueActivity(String id) async =>
      jsonList((await api.get('/issues/$id/activity'))['items']);
  @override
  Future<List<Json>> issues({String? taskId, String? projectId}) async =>
      jsonList(
        (await api.get(
          '/issues',
          _q({'status': 'ALL', 'taskId': taskId, 'projectId': projectId}),
        ))['items'],
      );
  @override
  Future<Json> issueOptions(String projectId) =>
      api.get('/projects/$projectId/issue-options');
  @override
  Future<String> createIssue(String projectId, Json body) async =>
      '${((await api.post('/projects/$projectId/issues', body))['issue'] as Json)['id']}';
  @override
  Future<void> issueStatus(String id, Json body) =>
      api.post('/issues/$id/status', body);
  @override
  Future<void> issueComment(String id, String text) =>
      api.post('/issues/$id/comments', {'text': text});
  @override
  Future<void> updateIssue(String id, Json body) =>
      api.patch('/issues/$id', body);

  @override
  Future<List<Json>> folders(String projectId) async =>
      jsonList((await api.get('/projects/$projectId/folders'))['items']);
  @override
  Future<List<Json>> documents(
    String projectId, {
    String? folderId,
    String? status,
  }) async => jsonList(
    (await api.get(
      '/projects/$projectId/documents',
      _q({'folderId': folderId, 'status': status}),
    ))['items'],
  );
  @override
  Future<String> downloadUrl(String projectId, String docId) async =>
      '${(await api.get('/projects/$projectId/documents/$docId/download'))['url']}';

  /// POST /projects/:id/documents/uploads → PUT bytes → POST /uploads/:id/complete.
  @override
  Future<void> uploadDocument(
    String projectId,
    String folderId,
    String name,
    List<int> bytes, {
    String? fulfils,
  }) async {
    final b = await api.post('/projects/$projectId/documents/uploads', {
      'folderId': folderId,
      'file': {'name': name, 'size': bytes.length},
      'fulfilsDocumentId': ?fulfils,
    });
    final t =
        (b['upload'] ??
                (b['uploads'] is List ? (b['uploads'] as List).first : b))
            as Json;
    await api.putBytes('${t['uploadUrl']}', {
      for (final e in ((t['headers'] as Map?) ?? const {}).entries)
        '${e.key}': '${e.value}',
    }, bytes);
    await api.post('/uploads/${t['id']}/complete');
  }

  @override
  Future<List<Json>> messages(String projectId) async =>
      jsonList((await api.get('/projects/$projectId/messages'))['items']);
  @override
  Future<void> postMessage(String projectId, Json body) =>
      api.post('/projects/$projectId/messages', body);

  @override
  Future<List<Json>> clients() async =>
      jsonList((await api.get('/clients', {'pageSize': '100'}))['items']);
  @override
  Future<Json> client(String id) async =>
      (await api.get('/clients/$id'))['client'] as Json;
  @override
  Future<List<Json>> clientContacts(String id) async =>
      jsonList((await api.get('/clients/$id/contacts'))['items']);
  @override
  Future<List<Json>> clientProjects(String id) async =>
      jsonList((await api.get('/clients/$id/projects'))['items']);
  @override
  Future<void> addContact(String clientId, Json body) =>
      api.post('/clients/$clientId/contacts', body);

  @override
  Future<Json> dashboard() => api.get('/dashboard');
  @override
  Future<List<Json>> myProjects() async =>
      jsonList((await api.get('/dashboard/my-projects'))['items']);
  @override
  Future<List<Json>> workload() async =>
      jsonList((await api.get('/workload'))['items']);
  @override
  Future<Json> report(String name) => api.get('/reports/$name');
  @override
  Future<List<Json>> waitingOnClient() async => jsonList(
    (await api.get('/document-requests/waiting-on-client'))['items'],
  );
  @override
  Future<List<Json>> myDocumentRequests() async =>
      jsonList((await api.get('/document-requests/mine'))['items']);

  @override
  Future<Json> profile(String userId) async =>
      (await api.get('/users/$userId'))['user'] as Json;
  @override
  Future<void> changePassword(String current, String next) => api.post(
    '/auth/change-password',
    {'currentPassword': current, 'newPassword': next},
  );
  @override
  Future<Json> verifyInvite(String token) =>
      api.post('/auth/invite/verify', {'token': token});
}

// ---------------- Mock ----------------

class MockP3Store {
  MockP3Store(MockStore s) {
    Json ref(String id, String name) => {'id': id, 'name': name};
    final acme = ref('p1', 'Acme Corp rollout');
    issues.addAll([
      {
        'id': 'i1',
        'key': 'ACME-12',
        'title': 'Login loop on Safari',
        'project': acme,
        'client': ref('c1', 'Acme Corp'),
        'stage': 'BEFORE_GO_LIVE',
        'category': 'BUG',
        'severity': 'CRITICAL',
        'status': 'OPEN',
        'owner': ref('u2', 'Queen Reyes'),
        'contact': {'id': 'k1', 'name': 'Ana Cruz', 'active': true},
        'dueDate': '2026-10-12',
        'overdue': false,
        'description':
            'Users on Safari 17 get sent back to the login page after SSO.',
        'reportedBy': ref('u1', 'Jonathan Esmalla'),
        'createdAt': '2026-10-09T02:00:00.000Z',
        'version': 0,
        'links': {
          'tasks': [
            {'id': 't4', 'name': 'Configure SSO', 'status': 'BLOCKED'},
          ],
          'messages': [],
        },
        'attachments': [],
        'resolution': null,
        'can': {'edit': true, 'comment': true, 'attach': true, 'delete': false},
      },
      {
        'id': 'i4',
        'key': 'ACME-9',
        'title': 'Slow import >10k rows',
        'project': acme,
        'client': ref('c1', 'Acme Corp'),
        'stage': 'BEFORE_GO_LIVE',
        'category': 'DATA',
        'severity': 'LOW',
        'status': 'RESOLVED',
        'owner': ref('u3', 'Mark Kim'),
        'contact': null,
        'dueDate': '2026-10-20',
        'overdue': false,
        'description': 'Imports over 10,000 rows take more than 5 minutes.',
        'reportedBy': ref('u3', 'Mark Kim'),
        'createdAt': '2026-09-30T02:00:00.000Z',
        'version': 2,
        'resolution': 'Batched the import.',
        'links': {'tasks': [], 'messages': []},
        'attachments': [],
        'can': {'edit': true, 'comment': true, 'attach': true, 'delete': false},
      },
    ]);
    for (final i in s.issues.where((i) => i.id != 'i1' && i.id != 'i4')) {
      issues.add({
        'id': i.id,
        'key': i.key,
        'title': i.title,
        'project': ref('p2', i.projectName),
        'client': ref('c2', i.projectName),
        'stage': 'BEFORE_GO_LIVE',
        'category': 'OTHER',
        'severity': i.severity.api,
        'status': i.status,
        'owner': i.ownerName == null ? null : ref('u3', i.ownerName!),
        'contact': null,
        'dueDate': null,
        'overdue': false,
        'description': i.title,
        'reportedBy': null,
        'createdAt': '2026-10-01T02:00:00.000Z',
        'version': 0,
        'links': {'tasks': [], 'messages': []},
        'attachments': [],
        'resolution': null,
        'can': {'edit': true, 'comment': true, 'attach': true, 'delete': false},
      });
    }
    activity['i1'] = [
      {
        'id': 'a1',
        'kind': 'EVENT',
        'actor': ref('u1', 'Jonathan Esmalla'),
        'at': '2026-10-09T02:00:00.000Z',
        'text': null,
        'action': 'issue_created',
        'changes': [],
        'reason': null,
      },
      {
        'id': 'a2',
        'kind': 'COMMENT',
        'actor': ref('u2', 'Queen Reyes'),
        'at': '2026-10-10T03:00:00.000Z',
        'text': 'Reproduced on Safari 17.4. Looking at the cookie settings.',
        'action': null,
        'changes': [],
        'reason': null,
      },
    ];
    folders.addAll([
      {
        'id': 'f1',
        'name': 'Contracts',
        'kind': 'CONTRACTS',
        'depth': 0,
        'documentCount': 2,
        'restricted': true,
        'parentId': null,
      },
      {
        'id': 'f2',
        'name': 'Phase 2 · Configuration',
        'kind': 'PHASE',
        'depth': 0,
        'documentCount': 2,
        'restricted': false,
        'parentId': null,
      },
    ]);
    documents.addAll([
      _doc('d1', 'f1', 'Signed SOW.pdf', 'SIGNED', by: 'Jonathan Esmalla'),
      _doc(
        'd2',
        'f1',
        'Change request CR-02.docx',
        'SUBMITTED',
        by: 'Ana Cruz',
      ),
      _doc(
        'd3',
        'f2',
        'IdP metadata XML',
        'REQUESTED',
        due: '2026-10-08',
        overdue: true,
        from: 'Ana Cruz',
      ),
      _doc(
        'd4',
        'f2',
        'Role matrix sign-off',
        'REQUESTED',
        due: '2026-10-16',
        from: 'Ben Tan',
      ),
    ]);
    messages.addAll([
      {
        'id': 'm1',
        'text': 'Kickoff done. Ana will send the IdP metadata by Oct 8.',
        'type': 'MEETING',
        'author': ref('u1', 'Jonathan Esmalla'),
        'at': '2026-10-01T03:00:00.000Z',
        'task': null,
        'contacts': [
          {'id': 'k1', 'name': 'Ana Cruz', 'active': true},
        ],
      },
      {
        'id': 'm2',
        'text': 'Called Ana: metadata delayed, their IT is reviewing.',
        'type': 'CALL',
        'author': ref('u2', 'Queen Reyes'),
        'at': '2026-10-09T05:30:00.000Z',
        'task': ref('t4', 'Configure SSO'),
        'contacts': [],
      },
    ]);
    clients.addAll([
      {
        'id': 'c1',
        'name': 'Acme Corp',
        'industry': 'Manufacturing',
        'address': 'Makati City',
        'notes': null,
        'active': true,
        'contactCount': 3,
        'projectCount': 1,
      },
      {
        'id': 'c2',
        'name': 'Globex',
        'industry': 'Retail',
        'address': 'Pasig City',
        'notes': null,
        'active': true,
        'contactCount': 1,
        'projectCount': 1,
      },
      {
        'id': 'c3',
        'name': 'Initech',
        'industry': 'Software',
        'address': null,
        'notes': null,
        'active': true,
        'contactCount': 0,
        'projectCount': 1,
      },
      {
        'id': 'c4',
        'name': 'Umbrella Corp',
        'industry': 'Pharma',
        'address': null,
        'notes': null,
        'active': true,
        'contactCount': 0,
        'projectCount': 1,
      },
    ]);
    contacts['c1'] = [
      {
        'id': 'k1',
        'name': 'Ana Cruz',
        'position': 'IT Manager',
        'email': 'ana@acme.example',
        'phone': '+63 917 000 0001',
        'active': true,
      },
      {
        'id': 'k2',
        'name': 'Ben Tan',
        'position': 'Finance Lead',
        'email': 'ben@acme.example',
        'phone': null,
        'active': true,
      },
      {
        'id': 'k3',
        'name': 'Carla Diaz',
        'position': 'HR Officer',
        'email': null,
        'phone': null,
        'active': true,
      },
    ];
    contacts['c2'] = [
      {
        'id': 'k9',
        'name': 'Gil Santos',
        'position': 'Ops Head',
        'email': 'gil@globex.example',
        'phone': null,
        'active': true,
      },
    ];
    for (final p in s.projects) {
      projects.add({
        'id': p.id,
        'name': p.name,
        'clientId': p.clientId,
        'status': p.status.api,
        'progress': p.progress,
        'manager': p.managerName,
      });
    }
  }

  static Json _doc(
    String id,
    String folder,
    String name,
    String status, {
    String? by,
    String? due,
    bool overdue = false,
    String? from,
  }) => {
    'id': id,
    'projectId': 'p1',
    'folderId': folder,
    'name': name,
    'status': status,
    'requiresSignature': folder == 'f1',
    'request': status == 'REQUESTED' || from != null
        ? {
            'requestedBy': {'id': 'u1', 'name': 'Jonathan Esmalla'},
            'requestedFrom': {'name': from ?? ''},
            'dueDate': due,
            'overdue': overdue,
            'cancelled': null,
          }
        : null,
    'latestVersion': status == 'REQUESTED' ? 0 : 1,
    'updatedAt': '2026-10-08T02:00:00.000Z',
    'uploadedBy': by == null ? null : {'id': 'x', 'name': by},
    'task': null,
    'archived': false,
  };

  final issues = <Json>[];
  final activity = <String, List<Json>>{};
  final folders = <Json>[];
  final documents = <Json>[];
  final messages = <Json>[];
  final clients = <Json>[];
  final contacts = <String, List<Json>>{};
  final projects = <Json>[];
  int n = 100;
}

class MockP3Repository implements P3Repository {
  MockP3Repository(this.s, this.store);
  final MockP3Store s;
  final MockStore store;
  static const _now = '2026-10-11T06:00:00.000Z';
  Json _me() => {'id': 'u1', 'name': 'Jonathan Esmalla'};

  ApiException _field(String path, String msg) =>
      ApiException(msg, status: 400, fields: {path: msg});

  @override
  Future<Json> issue(String id) async => s.issues.firstWhere(
    (i) => i['id'] == id,
    orElse: () => throw ApiException('Not found', status: 404),
  );
  @override
  Future<List<Json>> issueActivity(String id) async =>
      [...?s.activity[id]].reversed.toList();
  @override
  Future<List<Json>> issues({String? taskId, String? projectId}) async => s
      .issues
      .where(
        (i) =>
            taskId == null ||
            jsonList((i['links'] as Json)['tasks'])
                .any((t) => t['id'] == taskId),
      )
      .where((i) => projectId == null || refId(i['project']) == projectId)
      .toList();
  @override
  Future<Json> issueOptions(String projectId) async => {
    'users': [
      _me(),
      {'id': 'u2', 'name': 'Queen Reyes'},
      {'id': 'u3', 'name': 'Mark Kim'},
    ],
    'contacts': [
      for (final c in s.contacts['c1'] ?? const <Json>[])
        {'id': c['id'], 'name': c['name'], 'active': true},
    ],
    'tasks': [
      for (final t in store.tasks.where((t) => t.projectId == projectId))
        {'id': t.id, 'name': t.name, 'phase': t.phase},
    ],
    'defaultStage': 'BEFORE_GO_LIVE',
  };

  @override
  Future<String> createIssue(String projectId, Json b) async {
    final errors = <String, String>{
      if ('${b['title'] ?? ''}'.trim().isEmpty) 'title': 'Title is required.',
      if ('${b['description'] ?? ''}'.trim().isEmpty)
        'description': 'Description is required.',
      if (b['severity'] == null) 'severity': 'Choose a severity.',
      if (b['stage'] == null) 'stage': 'Choose a stage.',
    };
    if (errors.isNotEmpty)
      throw ApiException(
        'Check the highlighted fields.',
        status: 400,
        fields: errors,
      );
    final p = store.projects.firstWhere((x) => x.id == projectId);
    final opts = await issueOptions(projectId);
    final id = 'i${s.n++}';
    final tasks = [
      for (final t in jsonList(opts['tasks']))
        if ((b['taskIds'] as List? ?? const []).contains(t['id']))
          {'id': t['id'], 'name': t['name'], 'status': null},
    ];
    s.issues.insert(0, {
      'id': id,
      'key': '${(p.code ?? 'PRJ').split('-').first}-${s.n}',
      'title': '${b['title']}'.trim(),
      'project': {'id': p.id, 'name': p.name},
      'client': {'id': p.clientId, 'name': p.clientName},
      'stage': b['stage'],
      'category': b['category'] ?? 'OTHER',
      'severity': b['severity'],
      'status': 'OPEN',
      'owner': jsonList(opts['users'])
          .where((u) => u['id'] == b['ownerId'])
          .firstOrNull,
      'contact': jsonList(opts['contacts'])
          .where((u) => u['id'] == b['reportedByContactId'])
          .firstOrNull,
      'dueDate': null,
      'overdue': false,
      'description': '${b['description']}'.trim(),
      'reportedBy': _me(),
      'createdAt': _now,
      'version': 0,
      'links': {'tasks': tasks, 'messages': []},
      'attachments': [],
      'resolution': null,
      'can': {'edit': true, 'comment': true, 'attach': true, 'delete': false},
    });
    store.issues.insert(
      0,
      Issue(
        id: id,
        key: '${s.issues.first['key']}',
        title: '${b['title']}'.trim(),
        projectName: p.clientName,
        severity: Priority.fromApi('${b['severity']}'),
        status: 'OPEN',
        ownerName: refName(s.issues.first['owner']),
      ),
    );
    s.activity[id] = [
      {
        'id': 'e$id',
        'kind': 'EVENT',
        'actor': _me(),
        'at': _now,
        'text': null,
        'action': 'issue_created',
        'changes': [],
        'reason': null,
      },
    ];
    return id;
  }

  @override
  Future<void> issueStatus(String id, Json b) async {
    final i = await issue(id);
    final from = '${i['status']}', to = '${b['status']}';
    if (!(issueTransitions[from] ?? const []).contains(to))
      throw ApiException("This status change isn't allowed.", status: 422);
    if (to == 'RESOLVED' && '${b['resolution'] ?? ''}'.trim().isEmpty)
      throw _field('resolution', 'Describe the resolution.');
    if (transitionNeedsReason(from, to) &&
        '${b['reason'] ?? ''}'.trim().isEmpty)
      throw _field('reason', 'Give a reason.');
    i['status'] = to;
    final k = store.issues.indexWhere((x) => x.id == id);
    if (k >= 0) {
      final o = store.issues[k];
      store.issues[k] = Issue(
        id: o.id,
        key: o.key,
        title: o.title,
        projectName: o.projectName,
        severity: o.severity,
        status: to,
        ownerName: o.ownerName,
      );
    }
    if (to == 'RESOLVED') i['resolution'] = '${b['resolution']}'.trim();
    i['version'] = (i['version'] as int) + 1;
    s.activity.putIfAbsent(id, () => []).add({
      'id': 'e${s.n++}',
      'kind': 'EVENT',
      'actor': _me(),
      'at': _now,
      'text': null,
      'action': 'issue_status_changed',
      'changes': [
        {'field': 'status', 'old': from, 'new': to},
      ],
      'reason': b['reason'] ?? b['resolution'],
    });
  }

  @override
  Future<void> issueComment(String id, String text) async {
    if (text.trim().isEmpty) throw _field('text', 'Comment is required.');
    s.activity.putIfAbsent(id, () => []).add({
      'id': 'c${s.n++}',
      'kind': 'COMMENT',
      'actor': _me(),
      'at': _now,
      'text': text.trim(),
      'action': null,
      'changes': [],
      'reason': null,
    });
  }

  @override
  Future<void> updateIssue(String id, Json b) async {
    final i = await issue(id);
    if (b.containsKey('dueDate') &&
        b['dueDate'] != null &&
        '${b['dueReason'] ?? ''}'.trim().isEmpty) {
      throw _field('dueReason', 'Why is the due date changing?');
    }
    if (b['dueDate'] != null) i['dueDate'] = b['dueDate'];
    if (b['taskIds'] != null) {
      final opts = await issueOptions(refId(i['project'])!);
      (i['links'] as Json)['tasks'] = [
        for (final t in jsonList(opts['tasks']))
          if ((b['taskIds'] as List).contains(t['id']))
            {'id': t['id'], 'name': t['name'], 'status': null},
      ];
    }
    i['version'] = (i['version'] as int) + 1;
    s.activity.putIfAbsent(id, () => []).add({
      'id': 'e${s.n++}',
      'kind': 'EVENT',
      'actor': _me(),
      'at': _now,
      'text': null,
      'action': 'issue_updated',
      'changes': [
        if (b['dueDate'] != null)
          {'field': 'dueDate', 'old': null, 'new': b['dueDate']},
      ],
      'reason': b['dueReason'],
    });
  }

  @override
  Future<List<Json>> folders(String projectId) async => s.folders;
  @override
  Future<List<Json>> documents(
    String projectId, {
    String? folderId,
    String? status,
  }) async => s.documents
      .where((d) => folderId == null || d['folderId'] == folderId)
      .where((d) => status == null || d['status'] == status)
      .toList();
  @override
  Future<String> downloadUrl(String projectId, String docId) async =>
      'https://example.com/download/$docId';
  @override
  Future<void> uploadDocument(
    String projectId,
    String folderId,
    String name,
    List<int> bytes, {
    String? fulfils,
  }) async {
    if (fulfils != null) {
      final d = s.documents.firstWhere((d) => d['id'] == fulfils);
      d['status'] = 'SUBMITTED';
      d['latestVersion'] = 1;
      d['uploadedBy'] = _me();
      (d['request'] as Json)['overdue'] = false;
      return;
    }
    s.documents.add(_docFor(folderId, name));
  }

  Json _docFor(String folderId, String name) => {
    ...MockP3Store._doc(
      'd${s.n++}',
      folderId,
      name,
      'SUBMITTED',
      by: 'Jonathan Esmalla',
    ),
    'updatedAt': _now,
  };

  @override
  Future<List<Json>> messages(String projectId) async =>
      [...s.messages].reversed.toList();
  @override
  Future<void> postMessage(String projectId, Json b) async {
    if ('${b['text'] ?? ''}'.trim().isEmpty)
      throw _field('text', 'Write a message first.');
    final opts = await issueOptions(projectId);
    s.messages.add({
      'id': 'm${s.n++}',
      'text': '${b['text']}'.trim(),
      'type': b['type'] ?? 'NOTE',
      'author': _me(),
      'at': _now,
      'task': jsonList(opts['tasks'])
          .where((t) => t['id'] == b['taskId'])
          .map((t) => {'id': t['id'], 'name': t['name']})
          .firstOrNull,
      'contacts': [
        for (final c in jsonList(opts['contacts']))
          if ((b['contactIds'] as List? ?? const []).contains(c['id'])) c,
      ],
    });
  }

  @override
  Future<List<Json>> clients() async => s.clients;
  @override
  Future<Json> client(String id) async =>
      s.clients.firstWhere((c) => c['id'] == id);
  @override
  Future<List<Json>> clientContacts(String id) async =>
      s.contacts[id] ?? const [];
  @override
  Future<List<Json>> clientProjects(String id) async =>
      s.projects.where((p) => p['clientId'] == id).toList();
  @override
  Future<void> addContact(String clientId, Json b) async {
    if ('${b['name'] ?? ''}'.trim().isEmpty)
      throw _field('name', 'Name is required.');
    final email = '${b['email'] ?? ''}'.trim();
    if (email.isNotEmpty &&
        !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email))
      throw _field('email', 'Enter a valid email.');
    s.contacts.putIfAbsent(clientId, () => []).add({
      'id': 'k${s.n++}',
      'name': '${b['name']}'.trim(),
      'position': b['position'],
      'email': email.isEmpty ? null : email,
      'phone': b['phone'],
      'active': true,
    });
    final c = await client(clientId);
    c['contactCount'] = (c['contactCount'] as int) + 1;
  }

  @override
  Future<Json> dashboard() async => {
    'kpis': {
      'activeProjects': 2,
      'delayedProjects': 1,
      'overdueTasks': 3,
      'overdueWaitingOnClient': 1,
      'hoursThisWeek': 31.5,
      'teamUtilizationPct': 78,
    },
    'activeProjects': [
      {
        'id': 'p1',
        'name': 'Acme Corp rollout',
        'client': {'id': 'c1', 'name': 'Acme Corp'},
        'projectType': 'Implementation',
        'status': 'ACTIVE',
        'progress': 78,
        'health': 'AT_RISK',
        'goLive': '2026-10-30',
      },
      {
        'id': 'p2',
        'name': 'Globex migration',
        'client': {'id': 'c2', 'name': 'Globex'},
        'projectType': 'Migration',
        'status': 'ACTIVE',
        'progress': 45,
        'health': 'ON_TRACK',
        'goLive': '2026-11-20',
      },
    ],
    'waitingOnClient': [
      {
        'id': 't4',
        'name': 'Configure SSO',
        'project': {'id': 'p1', 'name': 'Acme Corp rollout'},
        'client': {'id': 'c1', 'name': 'Acme Corp'},
        'contact': {'id': 'k1', 'name': 'Ana Cruz', 'active': true},
        'dueDate': '2026-10-08',
        'daysOverdue': 3,
      },
    ],
    'upcomingMilestones': [
      {
        'id': 't7',
        'name': 'UAT sign-off',
        'project': {'id': 'p1', 'name': 'Acme Corp rollout'},
        'client': {'id': 'c1', 'name': 'Acme Corp'},
        'dueDate': '2026-10-14',
      },
      {
        'id': 'mx',
        'name': 'Go-live',
        'project': {'id': 'p1', 'name': 'Acme Corp rollout'},
        'client': {'id': 'c1', 'name': 'Acme Corp'},
        'dueDate': '2026-10-30',
      },
    ],
    'issues': {
      'open': 4,
      'overdue': 1,
      'bySeverity': {'CRITICAL': 1, 'HIGH': 1, 'MEDIUM': 1, 'LOW': 1},
      'byStage': {'BEFORE_GO_LIVE': 4, 'AFTER_GO_LIVE': 0},
      'avgDaysToResolve': 2.5,
      'resolvedCount': 6,
    },
    'myProjects': true,
  };

  @override
  Future<List<Json>> myProjects() async => [
    {
      'id': 'p1',
      'name': 'Acme Corp rollout',
      'client': {'id': 'c1', 'name': 'Acme Corp'},
      'status': 'ACTIVE',
      'health': 'AT_RISK',
      'progress': 78,
      'baselineEnd': '2026-10-30',
      'forecastEnd': '2026-11-04',
      'daysLate': 5,
      'overdueTasks': 2,
      'blockedTasks': 1,
      'openIssues': 2,
      'openCriticalHighIssues': 1,
      'waitingOnClient': 1,
      'followUps': {
        'people': [
          {
            'person': {'id': 'u2', 'name': 'Queen Reyes'},
            'overdue': 1,
            'aging': 0,
            'items': [
              {'name': 'Configure SSO'},
            ],
          },
        ],
        'contacts': [
          {
            'contact': {'id': 'k1', 'name': 'Ana Cruz', 'active': true},
            'overdueTasks': 1,
            'overdueDocuments': 1,
            'items': [
              {'name': 'IdP metadata XML'},
            ],
          },
        ],
      },
    },
    {
      'id': 'p4',
      'name': 'Umbrella onboarding',
      'client': {'id': 'c4', 'name': 'Umbrella Corp'},
      'status': 'PLANNING',
      'health': 'ON_TRACK',
      'progress': 8,
      'baselineEnd': '2027-01-10',
      'forecastEnd': '2027-01-10',
      'daysLate': 0,
      'overdueTasks': 0,
      'blockedTasks': 0,
      'openIssues': 0,
      'openCriticalHighIssues': 0,
      'waitingOnClient': 0,
      'followUps': {'people': [], 'contacts': []},
    },
  ];

  @override
  Future<List<Json>> workload() async => [
    {
      'person': {'id': 'u1', 'name': 'Jonathan Esmalla'},
      'jobRole': 'Project manager',
      'teams': [
        {'id': 'tm1', 'name': 'Delivery'},
      ],
      'capacityHours': 40,
      'assignedHours': 46,
      'recordedHours': 31.5,
      'utilizationPct': 79,
      'assignedPct': 115,
      'overAssigned': true,
    },
    {
      'person': {'id': 'u2', 'name': 'Queen Reyes'},
      'jobRole': 'Consultant',
      'teams': [
        {'id': 'tm1', 'name': 'Delivery'},
      ],
      'capacityHours': 40,
      'assignedHours': 28,
      'recordedHours': 30,
      'utilizationPct': 75,
      'assignedPct': 70,
      'overAssigned': false,
    },
    {
      'person': {'id': 'u3', 'name': 'Mark Kim'},
      'jobRole': 'Developer',
      'teams': [],
      'capacityHours': 0,
      'assignedHours': 12,
      'recordedHours': 8,
      'utilizationPct': null,
      'assignedPct': null,
      'overAssigned': false,
    },
  ];

  @override
  Future<Json> report(String name) async => switch (name) {
    'project-status' => {
      'items': [
        {
          'id': 'p1',
          'name': 'Acme Corp rollout',
          'client': {'name': 'Acme Corp'},
          'projectType': 'Implementation',
          'status': 'ACTIVE',
          'progress': 78,
          'health': 'AT_RISK',
          'baselineEnd': '2026-10-30',
          'forecastEnd': '2026-11-04',
          'varianceDays': 5,
          'overdueTasks': 2,
          'blockedTasks': 1,
          'pendingClientItems': 2,
        },
        {
          'id': 'p3',
          'name': 'Initech CRM',
          'client': {'name': 'Initech'},
          'projectType': null,
          'status': 'ON_HOLD',
          'progress': 30,
          'health': 'DELAYED',
          'baselineEnd': '2026-12-02',
          'forecastEnd': '2026-12-20',
          'varianceDays': 18,
          'overdueTasks': 0,
          'blockedTasks': 0,
          'pendingClientItems': 0,
        },
      ],
    },
    'effort-variance' => {
      'items': [
        {
          'id': 't3',
          'task': {'name': 'Configure roles'},
          'project': {'name': 'Acme Corp rollout'},
          'estHours': 12,
          'actualHours': 4,
          'varianceHours': -8,
        },
        {
          'id': 't2',
          'task': {'name': 'Environment setup'},
          'project': {'name': 'Acme Corp rollout'},
          'estHours': 4,
          'actualHours': 5,
          'varianceHours': 1,
        },
      ],
    },
    'overdue' => {
      'items': [
        {
          'id': 't4',
          'name': 'Configure SSO',
          'project': {'name': 'Acme Corp rollout'},
          'owner': {'name': 'Jonathan E.'},
          'dueDate': '2026-10-08',
          'daysOverdue': 3,
          'party': 'CLIENT',
        },
      ],
    },
    'issues' => {
      'items': [
        for (final i in s.issues)
          {...i, 'raisedAt': i['createdAt'], 'daysToResolve': null},
      ],
    },
    'timesheets' => {
      'items': [
        {
          'id': 'ts1',
          'workDate': '2026-10-09',
          'user': {'name': 'Jonathan Esmalla'},
          'project': {'name': 'Acme Corp rollout'},
          'task': {'name': 'Configure roles'},
          'type': 'EXECUTION',
          'hours': 3.5,
          'note': null,
        },
        {
          'id': 'ts2',
          'workDate': '2026-10-08',
          'user': {'name': 'Mark Kim'},
          'project': {'name': 'Globex migration'},
          'task': {'name': 'Data migration dry run'},
          'type': 'WAITING',
          'hours': 2,
          'note': 'Waiting on DB access',
        },
      ],
      'totals': {'EXECUTION': 3.5, 'WAITING': 2, 'REWORK': 0, 'all': 5.5},
    },
    _ => {'items': <Json>[]},
  };

  @override
  Future<List<Json>> waitingOnClient() async => [
    for (final d in s.documents.where((d) => d['status'] == 'REQUESTED'))
      {
        'id': d['id'],
        'name': d['name'],
        'project': {'id': 'p1', 'name': 'Acme Corp rollout'},
        'requestedFrom': (d['request'] as Json)['requestedFrom'],
        'dueDate': (d['request'] as Json)['dueDate'],
        'overdue': (d['request'] as Json)['overdue'],
      },
  ];
  @override
  Future<List<Json>> myDocumentRequests() async => const [];

  @override
  Future<Json> profile(String userId) async => {
    'id': userId,
    'name': 'Jonathan Esmalla',
    'email': 'jonathan@xceler8.com',
    'jobRole': 'Project manager',
    'systemRole': 'PROJECT_MANAGER',
    'supervisor': {'id': 'u9', 'name': 'Queen Reyes'},
    'reportCcEmails': ['ops@xceler8.com'],
    'capacityHours': 40,
  };
  String _password = 'pass1!word';
  @override
  Future<void> changePassword(String current, String next) async {
    if (current != _password && current != 'pass1')
      throw _field('currentPassword', 'Your current password is incorrect.');
    final p = passwordProblem(next);
    if (p != null) throw _field('newPassword', p);
    if (next == current)
      throw _field('newPassword', 'Choose a password you haven’t used before.');
    _password = next;
  }

  @override
  Future<Json> verifyInvite(String token) async {
    if (token == 'expired')
      throw ApiException(
        'This link is no longer valid.',
        status: 400,
        code: 'INVITE_INVALID',
      );
    return {'name': 'Jonathan', 'email': 'jonathan@xceler8.com'};
  }
}

/// "Oct 9, 2026, 1:00 PM" from an ISO instant (PH time).
String whenPh(Object? iso) {
  final d = iso is String ? DateTime.tryParse(iso) : null;
  return d == null ? '' : phDateTime(d);
}

/// "Oct 9" from a YYYY-MM-DD string.
String shortYmd(Object? v) => v is String && v.length >= 10
    ? shortDate(parseYmd(v.substring(0, 10)))
    : '—';
