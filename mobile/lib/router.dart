import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'state/providers.dart';
import 'ui/screens/auth_screens.dart';
import 'ui/screens/home_screens.dart';
import 'ui/screens/project_screens.dart';
import 'ui/screens/task_screens.dart';
import 'ui/v2/dar.dart';
import 'ui/v2/leave.dart';
import 'ui/v2/project_p2.dart';
import 'ui/v2/task_actions.dart';
import 'ui/v2/day_timesheet.dart';
import 'ui/v2/my_tasks_v2.dart';
import 'ui/v2/project_form.dart';
import 'ui/v2/running_bar.dart';

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
      if (auth.isLoading && !auth.hasValue) {
        return loc == '/splash' ? null : '/splash';
      }
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
        builder: (_, s) =>
            SetPasswordScreen(token: s.uri.queryParameters['token'] ?? ''),
      ),
      GoRoute(
        path: '/tasks/:id/edit',
        builder: (_, s) => EditTaskScreen(taskId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/tasks/:id/history',
        builder: (_, s) => TaskHistoryScreen(taskId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/projects/:id/time',
        builder: (_, s) =>
            ProjectTimeScreen(projectId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/projects/:id/activity',
        builder: (_, s) =>
            ProjectActivityScreen(projectId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/tasks/:id',
        builder: (_, s) => TaskDetailScreen(taskId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/projects/:id/tasks/new',
        builder: (_, s) => CreateTaskScreen(projectId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/projects/new',
        builder: (_, _) => const ProjectFormScreen(),
      ),
      GoRoute(
        path: '/projects/:id/edit',
        builder: (_, s) =>
            ProjectFormScreen(projectId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/log',
        builder: (_, s) => LogTimeScreen(
          taskId: s.uri.queryParameters['task'],
          projectId: s.uri.queryParameters['project'],
        ),
      ),
      GoRoute(
        path: '/leave',
        builder: (_, s) =>
            LeaveScreen(initialTab: s.uri.queryParameters['tab']),
      ),
      GoRoute(path: '/dar', builder: (_, _) => const DarGenerateScreen()),
      GoRoute(
        path: '/dar/saved',
        builder: (_, _) => const SavedReportsScreen(),
      ),
      GoRoute(
        path: '/dar/saved/:id',
        builder: (_, s) => SavedReportDetailScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/timesheet-review',
        builder: (_, _) => const TimesheetReviewScreen(),
      ),
      GoRoute(
        path: '/notifications',
        builder: (_, _) => const NotificationsScreen(),
      ),
      GoRoute(path: '/issues', builder: (_, _) => const IssuesScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
            ],
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
                              .where(
                                (t) => t.name == s.uri.queryParameters['tab'],
                              )
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
            routes: [
              GoRoute(
                path: '/tasks',
                builder: (_, s) =>
                    MyTasksV2Screen(initialTab: s.uri.queryParameters['tab']),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/day',
                builder: (_, _) => const DayTimesheetScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/more', builder: (_, _) => const MoreScreen()),
            ],
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
    bottomNavigationBar: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const RunningTimerBar(),
        NavigationBarTheme(
          data: NavigationBarTheme.of(context).copyWith(
            labelTextStyle: WidgetStatePropertyAll(
              Theme.of(context).textTheme.labelSmall?.copyWith(fontSize: 11),
            ),
          ),
          child: NavigationBar(
            key: const Key('bottomNav'),
            selectedIndex: shell.currentIndex,
            onDestinationSelected: (i) =>
                shell.goBranch(i, initialLocation: i == shell.currentIndex),
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
                label: 'My tasks',
              ),
              NavigationDestination(
                key: Key('nav_day'),
                icon: Icon(Icons.schedule_outlined),
                selectedIcon: Icon(Icons.schedule),
                label: 'Day timesheet',
              ),
              NavigationDestination(
                key: Key('nav_more'),
                icon: Icon(Icons.menu),
                selectedIcon: Icon(Icons.menu_open),
                label: 'More',
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
