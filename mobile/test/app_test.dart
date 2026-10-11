import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/models.dart';

import 'helpers.dart';

void main() {
  group('login', () {
    testWidgets('validates, shows API error, then signs in to Home', (
      tester,
    ) async {
      await pumpApp(tester, signedIn: false);
      expect(find.byKey(const Key('loginScreen')), findsOneWidget);

      await tester.tap(find.byKey(const Key('loginSubmit')));
      await tester.pumpAndSettle();
      expect(find.text('Email is required.'), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('loginEmail')),
        'jonathan@xceler8.com',
      );
      await tester.enterText(find.byKey(const Key('loginPassword')), 'x');
      await tester.tap(find.byKey(const Key('loginSubmit')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('loginError')), findsOneWidget);

      await tester.enterText(find.byKey(const Key('loginPassword')), 'locked');
      await tester.tap(find.byKey(const Key('loginSubmit')));
      await tester.pumpAndSettle();
      expect(find.byType(SnackBar), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('loginPassword')),
        'Secret#123',
      );
      await tester.tap(find.byKey(const Key('loginSubmit')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('homeScreen')), findsOneWidget);
      expect(find.text('Good afternoon, Jonathan'), findsOneWidget);
    });
  });

  testWidgets('bottom navigation reaches all 5 tabs', (tester) async {
    await pumpApp(tester);
    expect(find.byKey(const Key('bottomNav')), findsOneWidget);
    const tabs = {
      'nav_projects': 'projectsScreen',
      'nav_tasks': 'myTasksScreen',
      'nav_day': 'dayTimesheetScreen',
      'nav_more': 'moreScreen',
      'nav_home': 'homeScreen',
    };
    for (final e in tabs.entries) {
      await tester.tap(find.byKey(Key(e.key)));
      await tester.pumpAndSettle();
      expect(find.byKey(Key(e.value)), findsOneWidget, reason: e.key);
    }
  });

  testWidgets('blocking a task requires a reason', (tester) async {
    final c = await pumpApp(tester, location: '/tasks/t3');
    expect(find.byKey(const Key('taskDetailScreen')), findsOneWidget);
    expect(find.byKey(const Key('blockedBanner')), findsNothing);

    await tester.tap(find.byKey(const Key('taskChangeStatus')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('statusOption_blocked')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('blockSheet')), findsOneWidget);

    // Empty reason is rejected.
    await tester.tap(find.byKey(const Key('confirmBlockButton')));
    await tester.pumpAndSettle();
    expect(find.text('A reason is required to block a task.'), findsOneWidget);
    expect((await tasksOf(c).get('t3')).status, TaskStatus.inProgress);

    await tester.enterText(
      find.byKey(const Key('blockReasonField')),
      'Waiting on client VPN access',
    );
    await tester.tap(find.byKey(const Key('confirmBlockButton')));
    await tester.pumpAndSettle();

    final t = await tasksOf(c).get('t3');
    expect(t.status, TaskStatus.blocked);
    expect(t.blockerReason, 'Waiting on client VPN access');
    expect(find.byKey(const Key('blockedBanner')), findsOneWidget);
    expect(find.text('Waiting on client VPN access'), findsOneWidget);
  });

  testWidgets('kanban: long-press moves a card to another column', (
    tester,
  ) async {
    final c = await pumpApp(tester, location: '/projects/p1?tab=board');
    expect(find.byKey(const Key('kanbanColumn_inProgress')), findsOneWidget);
    expect(find.byKey(const Key('boardCard_t6')), findsOneWidget);

    await tester.longPress(find.byKey(const Key('boardCard_t6')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('statusPicker')), findsOneWidget);
    await tester.tap(find.byKey(const Key('statusOption_done')));
    await tester.pumpAndSettle();

    expect((await tasksOf(c).get('t6')).status, TaskStatus.done);
    expect(find.text('Moved to Done'), findsOneWidget);
    // Board followed the card to the Done column.
    expect(find.byKey(const Key('boardCard_t6')), findsOneWidget);
  });

  testWidgets(
    'kanban: moving to Blocked asks for a reason; cancel keeps status',
    (tester) async {
      final c = await pumpApp(tester, location: '/projects/p1?tab=board');
      await tester.longPress(find.byKey(const Key('boardCard_t3')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('statusOption_blocked')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('blockSheet')), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect((await tasksOf(c).get('t3')).status, TaskStatus.inProgress);
    },
  );

  testWidgets(
    'hours form (Day timesheet › Hours list › Log time) adds an entry',
    (tester) async {
      final c = await pumpApp(tester, location: '/log?task=t3&project=p1');
      expect(find.byKey(const Key('logTimeScreen')), findsOneWidget);
      expect(find.text('This week · 31.5h'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('hoursField')), '0.3');
      await tester.tap(find.byKey(const Key('saveEntry')));
      await tester.pumpAndSettle();
      expect(
        find.text('Enter hours in steps of 0.25 (max 24).'),
        findsOneWidget,
      );

      await tester.enterText(find.byKey(const Key('hoursField')), '2.5');
      await tester.enterText(
        find.byKey(const Key('noteField')),
        'IdP config call',
      );
      await tester.ensureVisible(find.byKey(const Key('saveEntry')));
      await tester.tap(find.byKey(const Key('saveEntry')));
      await tester.pumpAndSettle();

      expect(find.text('This week · 34h'), findsOneWidget);
      expect(storeOf(c).entries.last.hours, 2.5);
      expect((await tasksOf(c).get('t3')).actualHours, 5.5);
    },
  );

  testWidgets('admin tools and appearance toggle are on More', (tester) async {
    await pumpApp(tester, location: '/more');
    expect(find.byKey(const Key('adminTools')), findsOneWidget);
    await tester.ensureVisible(find.text('Dark'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();
    final ctx = tester.element(find.byKey(const Key('moreScreen')));
    expect(Theme.of(ctx).brightness, Brightness.dark);
  });
}
