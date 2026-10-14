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
