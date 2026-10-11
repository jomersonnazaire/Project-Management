import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/router.dart';

import 'helpers.dart';

void main() {
  group('QA #1 create task via deep link', () {
    testWidgets('Save lands on the project instead of throwing', (
      tester,
    ) async {
      final c = await pumpApp(tester, location: '/projects/p1/tasks/new');
      await tester.enterText(
        find.byKey(const Key('taskNameField')),
        'Deep link task',
      );
      await tester.tap(find.byKey(const Key('saveTask')));
      await tester.pumpAndSettle();
      expect(find.textContaining('GoError'), findsNothing);
      expect(find.byKey(const Key('projectDetailScreen')), findsOneWidget);
      expect(storeOf(c).tasks.any((t) => t.name == 'Deep link task'), isTrue);
    });

    testWidgets('Close (X) goes to the project', (tester) async {
      await pumpApp(tester, location: '/projects/p1/tasks/new');
      await tester.tap(find.byKey(const Key('backButton')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('projectDetailScreen')), findsOneWidget);
    });
  });

  group('QA #2 deep-linked screens have a way back', () {
    for (final (loc, screen, parent) in [
      ('/tasks/t4', 'taskDetailScreen', 'projectDetailScreen'),
      ('/notifications', 'notificationsScreen', 'homeScreen'),
      ('/issues', 'issuesScreen', 'moreScreen'),
    ]) {
      testWidgets('$loc → up', (tester) async {
        await pumpApp(tester, location: loc);
        expect(find.byKey(Key(screen)), findsOneWidget);
        await tester.tap(find.byKey(const Key('backButton')));
        await tester.pumpAndSettle();
        expect(find.byKey(Key(parent)), findsOneWidget);
      });
    }

    testWidgets('task detail has Edit and overflow actions', (tester) async {
      await pumpApp(tester, location: '/tasks/t4');
      expect(find.byKey(const Key('taskEdit')), findsOneWidget);
      expect(find.byKey(const Key('taskOverflow')), findsOneWidget);
    });
  });

  group('QA #6 query params on an open page', () {
    testWidgets('?tab=board switches an open project to Board', (tester) async {
      final c = await pumpApp(tester, location: '/projects/p1');
      expect(find.byKey(const Key('checklist')), findsOneWidget);
      c.read(routerProvider).go('/projects/p1?tab=board');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('kanbanPageView')), findsOneWidget);
      c.read(routerProvider).go('/projects/p1?tab=checklist');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('checklist')), findsOneWidget);
    });

    testWidgets(
      '/log?task= preselects a new task when Log time is already open',
      (tester) async {
        final c = await pumpApp(tester, location: '/log?task=t3&project=p1');
        expect(find.byKey(const Key('taskDropdown_p1_t3')), findsOneWidget);
        c.read(routerProvider).go('/log?task=t6&project=p1');
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('taskDropdown_p1_t6')), findsOneWidget);
      },
    );
  });

  group('QA #8 log time limits', () {
    testWidgets('cannot move into a future week', (tester) async {
      await pumpApp(tester, location: '/log');
      final next = tester.widget<IconButton>(find.byKey(const Key('nextWeek')));
      expect(next.onPressed, isNull);
      await tester.tap(find.byKey(const Key('prevWeek')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<IconButton>(find.byKey(const Key('nextWeek'))).onPressed,
        isNotNull,
      );
    });

    testWidgets('day total over 24h is rejected', (tester) async {
      final c = await pumpApp(tester, location: '/log?task=t3&project=p1');
      await tester.tap(
        find.byKey(const Key('day_0')),
      ); // Mon Oct 5: already 16.5h
      await tester.pumpAndSettle();
      final before = storeOf(c).entries.length;
      await tester.enterText(find.byKey(const Key('hoursField')), '8');
      await tester.ensureVisible(find.byKey(const Key('saveEntry')));
      await tester.tap(find.byKey(const Key('saveEntry')));
      await tester.pumpAndSettle();
      expect(find.textContaining('at most 24h'), findsOneWidget);
      expect(storeOf(c).entries.length, before);

      await tester.enterText(find.byKey(const Key('hoursField')), '7.5');
      await tester.tap(find.byKey(const Key('saveEntry')));
      await tester.pumpAndSettle();
      expect(storeOf(c).entries.length, before + 1);
    });

    testWidgets(
      'week controls and calendar have labels; More shows open issues count',
      (tester) async {
        final c = await pumpApp(tester, location: '/log');
        expect(find.byTooltip('Previous week'), findsOneWidget);
        expect(find.byTooltip('Next week'), findsOneWidget);
        expect(find.byTooltip('Pick a date'), findsOneWidget);
        c.read(routerProvider).go('/more');
        await tester.pumpAndSettle();
        expect(find.text('4 open'), findsOneWidget);
      },
    );
  });

  testWidgets('QA #5 2x text scale: no overflow on Home, Task detail, Board', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final c = await pumpApp(tester);
    expect(tester.takeException(), isNull);
    for (final loc in [
      '/tasks/t4',
      '/projects/p1?tab=board',
      '/projects/p1',
      '/log',
      '/projects',
      '/tasks',
      '/more',
      '/notifications',
      '/day',
      '/dar',
      '/dar/saved',
      '/projects/new',
      '/tasks?tab=day',
      '/timesheet-review',
      '/leave',
      '/leave?tab=team',
      '/tasks/t7',
      '/tasks/t4/edit',
      '/tasks/t4/history',
      '/projects/p1?tab=more',
      '/projects/p1/time',
      '/projects/p1/activity',
      '/projects/p1/edit',
      '/projects/p1?tab=time',
      '/projects/p1?tab=activity',
      '/issues/i1',
      '/issues/new',
      '/projects/p1/documents',
      '/projects/p1/conversation',
      '/insights',
      '/insights?tab=workload',
      '/insights?tab=reports',
      '/reports/project-status',
      '/reports/timesheets',
      '/profile',
      '/change-password',
      '/clients',
      '/clients/c1',
      '/tasks/t4/history',
    ]) {
      c.read(routerProvider).go(loc);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: loc);
    }
  });
}
