import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'state/providers.dart';
import 'ui/screens/auth_screens.dart';
import 'ui/screens/home_screens.dart';
import 'ui/screens/project_screens.dart';
import 'ui/screens/task_screens.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier(0);
  ref.listen(authProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final loc = state.matchedLocation;
      final public = loc == '/login' || loc == '/setup-password';
      if (auth.isLoading && !auth.hasValue) return loc == '/splash' ? null : '/splash';
      final signedIn = auth.value != null;
      if (!signedIn) return public ? null : '/login';
      if (public || loc == '/splash') return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(
        path: '/setup-password',
        builder: (_, s) => SetPasswordScreen(token: s.uri.queryParameters['token'] ?? ''),
      ),
      GoRoute(
        path: '/tasks/:id',
        builder: (_, s) => TaskDetailScreen(taskId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/projects/:id/tasks/new',
        builder: (_, s) => CreateTaskScreen(projectId: s.pathParameters['id']!),
      ),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(path: '/issues', builder: (_, _) => const IssuesScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: '/home', builder: (_, _) => const HomeScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/projects',
                builder: (_, _) => const ProjectsScreen(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (_, s) => ProjectDetailScreen(
                      projectId: s.pathParameters['id']!,
                      initialTab:
                          ProjectTab.values
                              .where((t) => t.name == s.uri.queryParameters['tab'])
                              .firstOrNull ??
                          ProjectTab.checklist,
                      navNonce: s.uri.toString(),
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/tasks', builder: (_, _) => const MyTasksScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/log',
                builder: (_, s) => LogTimeScreen(
                  taskId: s.uri.queryParameters['task'],
                  projectId: s.uri.queryParameters['project'],
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/more', builder: (_, _) => const MoreScreen())],
          ),
        ],
      ),
    ],
  );
});

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: shell,
    bottomNavigationBar: NavigationBar(
      key: const Key('bottomNav'),
      selectedIndex: shell.currentIndex,
      onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
      destinations: const [
        NavigationDestination(
          key: Key('nav_home'),
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home),
          label: 'Home',
        ),
        NavigationDestination(
          key: Key('nav_projects'),
          icon: Icon(Icons.folder_outlined),
          selectedIcon: Icon(Icons.folder),
          label: 'Projects',
        ),
        NavigationDestination(
          key: Key('nav_tasks'),
          icon: Icon(Icons.task_alt_outlined),
          selectedIcon: Icon(Icons.task_alt),
          label: 'Tasks',
        ),
        NavigationDestination(
          key: Key('nav_log'),
          icon: Icon(Icons.timer_outlined),
          selectedIcon: Icon(Icons.timer),
          label: 'Log time',
        ),
        NavigationDestination(
          key: Key('nav_more'),
          icon: Icon(Icons.menu),
          selectedIcon: Icon(Icons.menu_open),
          label: 'More',
        ),
      ],
    ),
  );
}
