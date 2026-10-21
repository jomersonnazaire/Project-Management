// Access rules mirrored from m8-polish packages/shared/src/accessRules.ts (DEFAULT_SPEC + the
// 2026-10-09 member time-delete change). The live app uses GET /auth/me/permissions; the demo
// uses these defaults for the signed-in demo role.
typedef PermissionGrid = Map<String, Map<String, bool>>;

const systemRoles = ['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'];
const systemRoleLabels = {
  'ADMIN': 'Admin',
  'PROJECT_MANAGER': 'Project Manager',
  'MEMBER': 'Member',
  'VIEWER': 'Viewer',
};

const _spec = <String, Map<String, String>>{
  'ADMIN': {
    'users': 'VCED',
    'teams': 'VCED',
    'settings': 'VE',
    'accessRules': 'VE',
    'clients': 'VCED',
    'contacts': 'VCED',
    'templates': 'VCED',
    'projects': 'VCED',
    'tasks': 'VCED',
    'approvals': 'E',
    'time': 'VCED',
    'activities': 'VCED',
    'leave': 'VCED',
    'documents': 'VCED',
    'issues': 'VCED',
    'conversations': 'VC',
    'notifications': 'V',
    'reports': 'VX',
    'workload': 'V',
    'audit': 'V',
  },
  'PROJECT_MANAGER': {
    'users': '',
    'teams': '',
    'settings': '',
    'accessRules': '',
    'clients': 'VCED',
    'contacts': 'VCED',
    'templates': 'VCED',
    'projects': 'VCE',
    'tasks': 'VCED',
    'approvals': 'E',
    'time': 'VCED',
    'activities': 'VCED',
    'leave': 'VCED',
    'documents': 'VCED',
    'issues': 'VCE',
    'conversations': 'VC',
    'notifications': 'V',
    'reports': 'VX',
    'workload': 'V',
    'audit': '',
  },
  'MEMBER': {
    'users': '',
    'teams': '',
    'settings': '',
    'accessRules': '',
    'clients': 'V',
    'contacts': 'V',
    'templates': 'V',
    'projects': 'V',
    'tasks': 'VE',
    'approvals': 'E',
    'time': 'VCED',
    'activities': 'VCED',
    'leave': 'VCED',
    'documents': 'VC',
    'issues': 'VCE',
    'conversations': 'VC',
    'notifications': 'V',
    'reports': 'VX',
    'workload': 'V',
    'audit': '',
  },
  'VIEWER': {
    'users': '',
    'teams': '',
    'settings': '',
    'accessRules': '',
    'clients': 'V',
    'contacts': 'V',
    'templates': 'V',
    'projects': 'V',
    'tasks': 'V',
    'approvals': '',
    'time': '',
    'activities': '',
    'leave': '',
    'documents': 'V',
    'issues': 'V',
    'conversations': 'V',
    'notifications': 'V',
    'reports': 'VX',
    'workload': 'V',
    'audit': '',
  },
};

Map<String, bool> _grants(String s) => {
  'view': s.contains('V'),
  'create': s.contains('C'),
  'edit': s.contains('E'),
  'delete': s.contains('D'),
  'export': s.contains('X'),
};

PermissionGrid defaultPermissions(String role) => {
  for (final e in (_spec[role] ?? const <String, String>{}).entries)
    e.key: _grants(e.value),
};

/// Strict parse of `{permissions: {record: {action: bool}}}`: only a JSON `true` grants.
PermissionGrid parsePermissions(Object? body) {
  final p = body is Map ? body['permissions'] : null;
  if (p is! Map) return const {};
  return {
    for (final e in p.entries)
      if (e.value is Map)
        '${e.key}': {
          for (final a in (e.value as Map).entries) '${a.key}': a.value == true,
        },
  };
}

/// hasPermission(grid, record, action): false when not loaded or missing.
bool hasPermission(PermissionGrid? grid, String record, String action) =>
    grid?[record]?[action] == true;

/// FR-ACL-21 (m8-polish MY_TASKS_TABS): My tasks tabs and the permissions each needs, in order.
/// Mobile keys; the API's `day-timesheet` is `day` here.
const myTasksTabRules = <(String, List<(String, String)>)>[
  ('today', [('tasks', 'view'), ('time', 'view')]),
  ('day', [('time', 'view')]),
  ('due', [('tasks', 'view')]),
  ('assigned', [('tasks', 'view')]),
  ('accountable', [('tasks', 'view')]),
  ('review', [('approvals', 'edit')]),
  ('completed', [('tasks', 'view')]),
];

/// Allowed tab keys in display order; [] when none (My tasks is then hidden).
List<String> myTasksTabsFor(PermissionGrid? grid) => [
  for (final (k, need) in myTasksTabRules)
    if (need.every((n) => hasPermission(grid, n.$1, n.$2))) k,
];

/// `myTasksTabs` from GET /auth/me/permissions (API keys mapped to mobile keys), or null.
List<String>? parseMyTasksTabs(Object? body) {
  final l = body is Map ? body['myTasksTabs'] : null;
  if (l is! List) return null;
  return [for (final k in l) k == 'day-timesheet' ? 'day' : '$k'];
}

/// resolveMyTasksTab: the wanted tab if allowed, else the next allowed one to its right
/// (wrapping); unknown keys start at the first allowed tab. Null when none is allowed.
String? resolveMyTasksTab(String? wanted, List<String> allowed) {
  if (allowed.isEmpty) return null;
  if (wanted != null && allowed.contains(wanted)) return wanted;
  final keys = [for (final r in myTasksTabRules) r.$1];
  final idx = keys.indexOf(wanted ?? '');
  if (idx < 0) return allowed.first;
  for (var i = 1; i <= keys.length; i++) {
    final k = keys[(idx + i) % keys.length];
    if (allowed.contains(k)) return k;
  }
  return allowed.first;
}
