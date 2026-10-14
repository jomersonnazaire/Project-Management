import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/access.dart';
import 'package:xc8_pm/data/api_client.dart';
import 'package:xc8_pm/data/phases.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/data/tracker_models.dart';
import 'package:xc8_pm/state/v2_providers.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xc8_pm/data/v2_repositories.dart';
import 'package:xc8_pm/router.dart';

import 'helpers.dart';
import 'v2_p1_test.dart' show tapKey, pickMenu;

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

    testWidgets('Viewer deep link to /day or /leave is blocked', (t) async {
      final c = await pumpApp(t, role: 'VIEWER');
      for (final loc in ['/leave', '/dar']) {
        c.read(routerProvider).go(loc);
        await t.pumpAndSettle();
        expect(
          find.text("You don't have access to that view."),
          findsOneWidget,
        );
      }
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
        findsWidgets,
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

  group('errors and tokens', () {
    test('friendly copy for M8 codes, 404 and 429', () {
      expect(
        friendlyApiMessage(403, 'VIEW_ONLY', 'Forbidden'),
        'You can view this entry, but only its owner can change it.',
      );
      expect(
        friendlyApiMessage(409, 'ACTIVITY_IN_USE', null),
        "Can't delete: this activity has logged time, documents and issues.",
      );
      expect(friendlyApiMessage(404, null, 'Not found'), notFoundMessage);
      expect(friendlyApiMessage(429, null, null), rateLimitMessage);
      expect(friendlyApiMessage(400, null, 'Bad'), 'Bad');
    });

    test('ptl_ tokens are rejected', () {
      expect(isPortalToken('ptl_abc'), isTrue);
      expect(isPortalToken('mob_abc'), isFalse);
      expect(isPortalToken(null), isFalse);
    });

    test('time-lock setting: old and new shapes', () {
      expect(
        TimeLockPolicy.fromJson({
          'policy': {'weekday': 1, 'hour': 0},
        }).enabled,
        isTrue,
      );
      expect(
        TimeLockPolicy.fromJson({
          'policy': {'weekday': 1, 'hour': 0},
        }).legacyWeekly,
        isTrue,
      );
      expect(
        TimeLockPolicy.fromJson({
          'policy': {'enabled': false, 'version': 2},
        }).enabled,
        isFalse,
      );
      expect(TimeLockPolicy.fromJson({'enabled': false}).enabled, isFalse);
    });
  });

  group('D12 day location', () {
    testWidgets('changing it PUTs the day location before saving', (t) async {
      final c = await pumpApp(t, location: '/tasks');
      await tapKey(t, 'quickActivityButton');
      expect(
        find.textContaining('Where are you working today?'),
        findsOneWidget,
      );
      await t.enterText(find.byKey(const Key('entryTitle')), 'Inbox triage');
      await pickMenu(t, 'entryDayLocation', 'Office');
      await tapKey(t, 'entrySave');
      expect(find.byKey(const Key('entrySheet')), findsNothing);
      final store = c.read(mockTrackerStoreProvider);
      expect(store.dayOf('u1', DateTime(2026, 10, 11)).locationId, 'l3');
    });
  });

  group('D10 buttons', () {
    testWidgets('Day timesheet shows Log task time + Add quick activity', (
      t,
    ) async {
      await pumpApp(t, location: '/day');
      expect(find.text('Log task time'), findsOneWidget);
      expect(find.text('Add quick activity'), findsOneWidget);
      expect(find.text('Add entry'), findsNothing);
    });
  });

  group('Phases and Apply template (D21–D23)', () {
    test('apply template toast and already applied', () {
      expect(
        const ApplyTemplateResult(
          templateName: 'ERP rollout',
          phasesAdded: 2,
        ).toast,
        'Added 2 phases from ERP rollout.',
      );
      expect(
        const ApplyTemplateResult(
          templateName: 'ERP rollout',
          alreadyApplied: true,
        ).toast,
        contains('already applied'),
      );
    });

    testWidgets('blank Planning project: No phases yet → add phase', (t) async {
      final c = await pumpApp(t, location: '/projects/new');
      final store = storeOf(c);
      final id = await MockProjectIds.createBlank(c);
      c.read(routerProvider).go('/projects/$id');
      await t.pumpAndSettle();
      expect(find.text('No phases yet'), findsOneWidget);
      expect(find.byKey(const Key('applyTemplate')), findsOneWidget);
      await tapKey(t, 'addPhase');
      await tapKey(t, 'savePhase');
      expect(find.text('Add a phase name.'), findsOneWidget);
      await t.enterText(find.byKey(const Key('phaseNameField')), 'Discovery');
      await tapKey(t, 'savePhase');
      expect(find.text('Discovery'), findsOneWidget);
      expect(store.projects.any((p) => p.id == id), isTrue);
    });

    testWidgets('apply template adds its phases', (t) async {
      final c = await pumpApp(t);
      final id = await MockProjectIds.createBlank(c);
      c.read(routerProvider).go('/projects/$id');
      await t.pumpAndSettle();
      await tapKey(t, 'applyTemplate');
      await tapKey(t, 'applyTemplate_tp1');
      await tapKey(t, 'confirmApplyTemplate');
      expect(
        find.text('Added 3 phases from SAP B1 Implementation.'),
        findsOneWidget,
      );
      expect(find.text('Build'), findsOneWidget);
    });
  });
}

class MockProjectIds {
  static Future<String> createBlank(ProviderContainer c) => c
      .read(projectAdminRepositoryProvider)
      .create(
        const ProjectInput(
          name: 'Blank one',
          code: 'BLK',
          clientId: 'c1',
          projectTypeId: 'pt1',
          managerId: 'u1',
        ),
      );
}
