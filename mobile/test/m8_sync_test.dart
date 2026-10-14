import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/access.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/data/tracker_models.dart';
import 'package:xc8_pm/state/v2_providers.dart';

import 'helpers.dart';
import 'v2_p1_test.dart' show tapKey;

/// M8 sync with origin/m8-polish (docs/requirements/16_M8_CHANGES_FOR_MOBILE.md).
void main() {
  group('My tasks tabs (FR-ACL-21)', () {
    test('local rule matches the API order and Viewer gets no time tabs', () {
      expect(myTasksTabsFor(defaultPermissions('MEMBER')), [
        'today',
        'day',
        'due',
        'assigned',
        'accountable',
        'review',
        'completed',
      ]);
      expect(myTasksTabsFor(defaultPermissions('VIEWER')), [
        'due',
        'assigned',
        'accountable',
        'completed',
      ]);
      expect(myTasksTabsFor(defaultPermissions('ADMIN')), contains('review'));
    });

    test('parseMyTasksTabs maps day-timesheet; missing → null', () {
      expect(
        parseMyTasksTabs({
          'myTasksTabs': ['today', 'day-timesheet', 'due'],
        }),
        ['today', 'day', 'due'],
      );
      expect(parseMyTasksTabs({'permissions': {}}), isNull);
      expect(parseMyTasksTabs(null), isNull);
    });

    test('resolveMyTasksTab falls forward to the next allowed tab', () {
      const allowed = ['due', 'assigned', 'completed'];
      expect(resolveMyTasksTab('assigned', allowed), 'assigned');
      expect(resolveMyTasksTab('today', allowed), 'due');
      expect(resolveMyTasksTab(null, allowed), 'due');
      expect(resolveMyTasksTab('due', const []), isNull);
    });

    testWidgets('Viewer sees no Today / Day timesheet tabs', (t) async {
      await pumpApp(t, role: 'VIEWER', location: '/tasks?tab=today');
      expect(find.text('Due'), findsWidgets);
      expect(find.widgetWithText(Tab, 'Today'), findsNothing);
      expect(find.widgetWithText(Tab, 'Day timesheet'), findsNothing);
    });
  });

  group('Viewer: no tracker, DAR, leave (Q-70 B, Q-72)', () {
    testWidgets('bottom nav, More and routes', (t) async {
      final c = await pumpApp(t, role: 'VIEWER');
      expect(find.byKey(const Key('nav_day')), findsNothing);
      expect(find.byKey(const Key('nav_more')), findsOneWidget);
      await tapKey(t, 'nav_more');
      for (final k in [
        'moreDar',
        'moreSavedReports',
        'moreLeave',
        'moreTimesheetReview',
      ]) {
        expect(find.byKey(Key(k)), findsNothing, reason: k);
      }
      expect(c, isNotNull);
    });

    testWidgets('member keeps them', (t) async {
      await pumpApp(t, role: 'MEMBER');
      expect(find.byKey(const Key('nav_day')), findsOneWidget);
      await tapKey(t, 'nav_more');
      expect(find.byKey(const Key('moreDar')), findsOneWidget);
      expect(find.byKey(const Key('moreLeave')), findsOneWidget);
    });

    testWidgets('Home hides Logged this week for Viewer', (t) async {
      await pumpApp(t, role: 'VIEWER');
      expect(find.text('Logged this week'), findsNothing);
    });

    testWidgets('Home shows Logged this week for a PM', (t) async {
      await pumpApp(t);
      expect(find.text('Logged this week'), findsOneWidget);
    });
  });

  group('Q-09 day lock', () {
    testWidgets('locked own day keeps buttons visible but disabled', (t) async {
      final c = await pumpApp(t, location: '/day');
      c.read(selectedDayProvider.notifier).set(DateTime(2026, 10, 2));
      await t.pumpAndSettle();
      final add = t.widget<ButtonStyleButton>(
        find.byKey(const Key('addEntry')),
      );
      expect(add.onPressed, isNull);
      expect(
        t
            .widget<ButtonStyleButton>(find.byKey(const Key('submitDay')))
            .onPressed,
        isNull,
      );
      expect(
        t
            .widget<ButtonStyleButton>(find.byKey(const Key('changeLocation')))
            .onPressed,
        isNull,
      );
      expect(find.byTooltip('This day is locked'), findsWidgets);
      expect(
        find.textContaining('Oct 13 locks at 12:00 AM PHT on Oct 16'),
        findsOneWidget,
      );
    });
  });

  group('models', () {
    test('TimeWeek.logged prefers loggedTotal', () {
      final w = TimeWeek(
        weekStart: DateTime(2026, 10, 5),
        entries: const [],
        total: 3,
        loggedTotal: 7.5,
      );
      expect(w.logged, 7.5);
      expect(
        TimeWeek(
          weekStart: DateTime(2026, 10, 5),
          entries: const [],
          total: 3,
        ).logged,
        3,
      );
    });

    test('Lookup parses key/system', () {
      final l = Lookup.fromJson({
        'id': 'x',
        'name': 'Quick Activity',
        'key': 'quick_activity',
        'system': true,
      });
      expect(l.key, quickActivityKey);
      expect(l.system, isTrue);
    });
  });
}
