import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/tracker_models.dart';
import 'package:xc8_pm/router.dart';
import 'package:xc8_pm/state/v2_providers.dart';

import 'helpers.dart';

Future<void> tapKey(WidgetTester t, String k) async {
  await t.ensureVisible(find.byKey(Key(k)));
  await t.pumpAndSettle();
  await t.tap(find.byKey(Key(k)));
  await t.pumpAndSettle();
}

/// Scrolls the list with [view] key until [f] is built and visible.
Future<void> seek(WidgetTester t, Finder f, String view) async {
  await t.scrollUntilVisible(
    f,
    200,
    scrollable: find
        .descendant(
          of: find.byKey(Key(view)),
          matching: find.byType(Scrollable),
        )
        .first,
  );
  await t.pumpAndSettle();
}

Future<void> pickMenu(WidgetTester t, String key, String label) async {
  await t.ensureVisible(find.byKey(Key(key)));
  await t.pumpAndSettle();
  await t.tap(find.byKey(Key(key)));
  await t.pumpAndSettle();
  await t.tap(find.text(label).last);
  await t.pumpAndSettle();
}

void main() {
  group('navigation & branding', () {
    testWidgets('bottom nav: Home, Projects, My tasks, Day timesheet, More', (
      t,
    ) async {
      await pumpApp(t);
      for (final l in [
        'Home',
        'Projects',
        'My tasks',
        'Day timesheet',
        'More',
      ]) {
        expect(
          find.descendant(
            of: find.byKey(const Key('bottomNav')),
            matching: find.text(l),
          ),
          findsOneWidget,
        );
      }
      expect(find.text('Log time'), findsNothing);
    });

    testWidgets('login is branded OpsTrack', (t) async {
      await pumpApp(t, signedIn: false);
      expect(find.text('Sign in to OpsTrack'), findsOneWidget);
      expect(find.text('OpsTrack · by Jomerson & Grok'), findsOneWidget);
      final app = t.widget<MaterialApp>(find.byType(MaterialApp));
      expect(app.title, 'OpsTrack');
    });

    testWidgets(
      'Day timesheet tab and My tasks › Day timesheet share the date',
      (t) async {
        final c = await pumpApp(t, location: '/day');
        expect(find.text('Sunday, Oct 11, 2026'), findsOneWidget);
        await tapKey(t, 'prevDay');
        expect(find.text('Saturday, Oct 10, 2026'), findsOneWidget);
        // next is disabled on today
        c.read(routerProvider).go('/tasks?tab=day');
        await t.pumpAndSettle();
        expect(find.byKey(const Key('myTasksScreen')), findsOneWidget);
        expect(find.text('Saturday, Oct 10, 2026'), findsOneWidget);
        await tapKey(t, 'nextDay');
        expect(find.text('Sunday, Oct 11, 2026'), findsOneWidget);
        final next = t.widget<IconButton>(find.byKey(const Key('nextDay')));
        expect(next.onPressed, isNull);
      },
    );
  });

  group('My tasks', () {
    testWidgets('7 tabs, KPIs, search empty state', (t) async {
      await pumpApp(t, location: '/tasks');
      for (final k in [
        'today',
        'day',
        'due',
        'assigned',
        'accountable',
        'review',
        'completed',
      ]) {
        expect(find.byKey(Key('myTasksTab_$k')), findsOneWidget);
      }
      expect(find.text('Overdue'), findsOneWidget);
      expect(find.text('Logged this week'), findsOneWidget);
      expect(find.text('Philippine time · by planned date'), findsOneWidget);
      expect(find.byKey(const Key('quickActivityButton')), findsOneWidget);
      await tapKey(t, 'taskSearchToggle');
      await t.enterText(find.byKey(const Key('taskSearch')), 'zzz');
      await t.pumpAndSettle();
      expect(find.text('No tasks match your search.'), findsOneWidget);
    });

    testWidgets('Time in from Today starts a timer; running bar + Time out', (
      t,
    ) async {
      final c = await pumpApp(t, location: '/tasks');
      expect(find.byKey(const Key('runningTimerBar')), findsNothing);
      await tapKey(t, 'timeIn_t4');
      expect(find.byKey(const Key('entrySheet')), findsOneWidget);
      expect(find.text('Time in'), findsWidgets);
      expect(
        find.text('From project type: Implementation. You can change it.'),
        findsOneWidget,
      );
      await tapKey(t, 'entrySave');
      expect(find.byKey(const Key('entrySheet')), findsNothing);
      expect(find.byKey(const Key('runningTimerBar')), findsOneWidget);
      expect(find.byKey(const Key('runningChip_t4')), findsOneWidget);

      testNow = testNow.add(const Duration(minutes: 12, seconds: 8));
      c.invalidate(runningProvider);
      await t.pumpAndSettle();
      expect(find.text('0:12:08'), findsOneWidget);

      await tapKey(t, 'runningTimerStop');
      expect(find.byKey(const Key('runningTimerBar')), findsNothing);
    });

    testWidgets(
      'switch prompt stops the running timer and starts the new one',
      (t) async {
        await pumpApp(t, location: '/tasks');
        await tapKey(t, 'timeIn_t4');
        await tapKey(t, 'entrySave');
        await tapKey(t, 'timeIn_t5');
        await tapKey(t, 'entrySave');
        expect(find.byKey(const Key('switchPrompt')), findsOneWidget);
        expect(
          find.text("Stop 'Configure SSO' and start this one?"),
          findsOneWidget,
        );
        await tapKey(t, 'switchTimer');
        expect(find.byKey(const Key('runningChip_t5')), findsOneWidget);
        expect(find.byKey(const Key('runningChip_t4')), findsNothing);
      },
    );

    testWidgets('quick activity requires a title; Quick Activity type preselected', (t) async {
      await pumpApp(t, location: '/tasks');
      await tapKey(t, 'quickActivityButton');
      await tapKey(t, 'entrySave');
      expect(find.text('Add a title.'), findsOneWidget);
      expect(find.text('Choose an activity type.'), findsNothing);
      expect(find.byKey(const ValueKey('entryActivityType_aq')), findsOneWidget);
      await t.enterText(find.byKey(const Key('entryTitle')), 'Inbox triage');
      await pickMenu(t, 'entryActivityType', 'Integration');
      await tapKey(t, 'entrySave');
      expect(find.byKey(const Key('runningTimerBar')), findsOneWidget);
      expect(find.text('Inbox triage'), findsWidgets);
    });
  });

  group('Day timesheet', () {
    testWidgets(
      'not submitted: entries, hours rendered, submit locks the day',
      (t) async {
        await pumpApp(t, location: '/day');
        expect(find.byKey(const Key('dayTimesheet')), findsOneWidget);
        expect(find.text('Onsite'), findsWidgets);
        expect(find.text('Not submitted'), findsOneWidget);
        await seek(t, find.byKey(const Key('hoursRendered')), 'dayTimesheet');
        expect(find.text('04:30'), findsOneWidget); // 2:30 + 0:45 + 1:15
        await t.drag(
          find.byKey(const Key('dayTimesheet')),
          const Offset(0, 2000),
        );
        await t.pumpAndSettle();
        await tapKey(t, 'submitDay');
        expect(find.text('Submit Oct 11?'), findsOneWidget);
        expect(find.textContaining('04:30 in 3 entries.'), findsOneWidget);
        await tapKey(t, 'confirmSubmit');
        expect(find.byKey(const Key('submittedBanner')), findsOneWidget);
        expect(find.byKey(const Key('addEntry')), findsNothing);
        expect(find.byIcon(Icons.lock_outline), findsWidgets);
      },
    );

    testWidgets('running timer disables Submit day with helper', (t) async {
      final c = await pumpApp(t, location: '/tasks');
      await tapKey(t, 'timeIn_t4');
      await tapKey(t, 'entrySave');
      c.read(routerProvider).go('/day');
      await t.pumpAndSettle();
      expect(
        find.text('Stop the running timer before submitting this day.'),
        findsOneWidget,
      );
      expect(
        t.widget<FilledButton>(find.byKey(const Key('submitDay'))).onPressed,
        isNull,
      );
      final running = find.byWidgetPredicate(
        (w) =>
            w.key is ValueKey &&
            '${(w.key! as ValueKey).value}'.startsWith('rowTimeOut_'),
      );
      expect(running, findsOneWidget);
      await t.tap(running);
      await t.pumpAndSettle();
      expect(
        t.widget<FilledButton>(find.byKey(const Key('submitDay'))).onPressed,
        isNotNull,
      );
    });

    testWidgets(
      'states: submitted, reopened, half-day leave, full leave, locked, empty',
      (t) async {
        final c = await pumpApp(t, location: '/day');
        Future<void> go(int day) async {
          c.read(selectedDayProvider.notifier).set(DateTime(2026, 10, day));
          await t.pumpAndSettle();
        }

        await go(9);
        expect(find.byKey(const Key('submittedBanner')), findsOneWidget);
        expect(find.text('✓ Submitted'), findsOneWidget);
        expect(find.byKey(const Key('submitDay')), findsNothing);

        await go(8);
        expect(
          find.textContaining('↺ Reopened by Queen Reyes'),
          findsOneWidget,
        );
        expect(find.text('Submit Oct 8'), findsOneWidget);
        expect(find.text('Auto-stopped – please check'), findsOneWidget);

        await go(7);
        expect(find.text('Half day leave (AM)'), findsOneWidget);
        expect(find.byKey(const Key('leaveRow_lv1')), findsOneWidget);

        await go(6);
        expect(find.text('Sick · Full day'), findsOneWidget);
        expect(find.byKey(const Key('addEntry')), findsNothing);

        await go(2);
        expect(
          find.text(
            "🔒 Oct 2 wasn't submitted. It was locked as it stood at the weekly lock.",
          ),
          findsOneWidget,
        );
        expect(find.text('Reopen day… (Admin)'), findsOneWidget);
        expect(
          find.byTooltip('Locked. Ask an Admin to reopen this day.'),
          findsWidgets,
        );

        await go(10);
        expect(find.text('No entries on Oct 10'), findsOneWidget);
        expect(
          find.text('Add an entry (asks for the day’s location first).'),
          findsOneWidget,
        );
        expect(find.text('Location not set'), findsOneWidget);
      },
    );

    testWidgets('reopen needs a reason', (t) async {
      final c = await pumpApp(t, location: '/day');
      c.read(selectedDayProvider.notifier).set(DateTime(2026, 10, 2));
      await t.pumpAndSettle();
      await tapKey(t, 'reopenDay');
      expect(find.text('Reopen Oct 2 · Jomerson Nazaire'), findsOneWidget);
      await tapKey(t, 'confirmReopen');
      expect(find.text('Add a reason for reopening.'), findsOneWidget);
      await t.enterText(find.byKey(const Key('reopenReason')), 'Missed Friday');
      await tapKey(t, 'confirmReopen');
      expect(find.textContaining('Reason: "Missed Friday"'), findsOneWidget);
      expect(find.byKey(const Key('addEntry')), findsOneWidget);
    });

    testWidgets(
      'add entry on an empty day asks the location; validation; overlap',
      (t) async {
        final c = await pumpApp(t, location: '/day');
        c.read(selectedDayProvider.notifier).set(DateTime(2026, 10, 10));
        await t.pumpAndSettle();
        await tapKey(t, 'addEntry');
        expect(find.text('Add entry'), findsWidgets);
        await tapKey(t, 'entrySave');
        expect(find.text('Choose a task or Quick activity.'), findsOneWidget);
        expect(find.text('Enter the time in.'), findsOneWidget);
        expect(find.text('Enter the time out.'), findsOneWidget);
        expect(find.text('Choose where you’re working today.'), findsOneWidget);
        expect(
          find.textContaining('Where were you working on Sat, Oct 10?'),
          findsOneWidget,
        );

        await pickMenu(t, 'entryTarget', 'Configure SSO');
        expect(
          find.text('From project type: Implementation. You can change it.'),
          findsOneWidget,
        );
        await tapKey(t, 'entryTimeIn');
        await t.tap(find.text('OK'));
        await t.pumpAndSettle();
        await tapKey(t, 'entryTimeOut');
        await t.tap(find.text('OK'));
        await t.pumpAndSettle();
        expect(find.text('08:00 AM'), findsOneWidget);
        expect(find.text('09:00 AM'), findsOneWidget);
        await pickMenu(t, 'entryDayLocation', 'WFH');
        await tapKey(t, 'entrySave');
        expect(find.byKey(const Key('entrySheet')), findsNothing);
        expect(find.text('08:00 AM – 09:00 AM'), findsOneWidget);
        expect(find.text('WFH'), findsWidgets);

        // Same slot again → overlap (server message in the sheet).
        await tapKey(t, 'addEntry');
        await pickMenu(t, 'entryTarget', 'Collect org chart');
        await tapKey(t, 'entryTimeIn');
        await t.tap(find.text('OK'));
        await t.pumpAndSettle();
        await tapKey(t, 'entryTimeOut');
        await t.tap(find.text('OK'));
        await t.pumpAndSettle();
        await tapKey(t, 'entrySave');
        expect(find.byKey(const Key('entryError')), findsOneWidget);
        expect(
          find.textContaining(
            'This overlaps Configure SSO (08:00 AM–09:00 AM)',
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets('edit and delete an entry', (t) async {
      await pumpApp(t, location: '/day');
      final edit = find.byWidgetPredicate(
        (w) =>
            w.key is ValueKey &&
            '${(w.key! as ValueKey).value}'.startsWith('editEntry_'),
      );
      await seek(t, find.byKey(const Key('hoursRendered')), 'dayTimesheet');
      expect(edit, findsNWidgets(3));
      await t.ensureVisible(edit.first);
      await t.pumpAndSettle();
      await t.tap(edit.first);
      await t.pumpAndSettle();
      expect(find.text('Edit entry'), findsOneWidget);
      await t.enterText(find.byKey(const Key('entryModule')), 'A' * 85);
      await t.pumpAndSettle();
      expect(find.text('85/100'), findsOneWidget);
      await tapKey(t, 'entryDelete');
      expect(find.text('Delete this entry?'), findsOneWidget);
      await tapKey(t, 'confirmDeleteEntry');
      expect(edit, findsNWidgets(2));
    });

    testWidgets('change the day location', (t) async {
      await pumpApp(t, location: '/day');
      await tapKey(t, 'changeLocation');
      expect(find.text('Where are you working today?'), findsOneWidget);
      await tapKey(t, 'locationOption_l3');
      await tapKey(t, 'locationSave');
      expect(
        find.descendant(
          of: find.byKey(const Key('locationChip')),
          matching: find.text('Office'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('Day | Hours list switch', (t) async {
      await pumpApp(t, location: '/day');
      await tapKey(t, 'hoursListSegment');
      expect(find.byKey(const Key('hoursList')), findsOneWidget);
      expect(find.textContaining('My entries this week ·'), findsOneWidget);
      expect(find.text('‹ Oct 5–11 ›'), findsOneWidget);
      expect(find.byKey(const Key('hoursLogTime')), findsOneWidget);
    });

    testWidgets(
      'timesheet review: pick a person, read-only, reopen a submitted day',
      (t) async {
        final c = await pumpApp(t, location: '/timesheet-review');
        expect(find.text('Choose a person'), findsOneWidget);
        await pickMenu(t, 'reviewPerson', 'Queen Reyes');
        c.read(selectedDayProvider.notifier).set(DateTime(2026, 10, 10));
        await t.pumpAndSettle();
        expect(find.byKey(const Key('submittedBanner')), findsOneWidget);
        expect(find.byKey(const Key('addEntry')), findsNothing);
        expect(find.byIcon(Icons.lock_outline), findsWidgets);
        await tapKey(t, 'reopenDay');
        expect(find.text('Reopen Oct 10 · Queen Reyes'), findsOneWidget);
        await t.enterText(
          find.byKey(const Key('reopenReason')),
          'Fix the SSO hours',
        );
        await tapKey(t, 'confirmReopen');
        expect(
          find.textContaining('Reason: "Fix the SSO hours"'),
          findsOneWidget,
        );
      },
    );
  });

  group('DAR', () {
    test('range validation', () {
      expect(
        validateDarRange(DateTime(2026, 10, 9), DateTime(2026, 10, 8))?.$2,
        '"From" must be on or before "To".',
      );
      expect(
        validateDarRange(DateTime(2026, 9, 1), DateTime(2026, 10, 8))?.$2,
        'The range can be up to 31 days. Pick a shorter range.',
      );
      expect(
        validateDarRange(DateTime(2026, 10, 5), DateTime(2026, 10, 11)),
        isNull,
      );
    });

    testWidgets('generate → preview → save → saved list → detail (no export)', (
      t,
    ) async {
      await pumpApp(t, location: '/dar');
      await tapKey(t, 'darPreview');
      expect(find.text('Set by Admin'), findsNWidgets(2));
      expect(find.text('Coming with Microsoft sign-in'), findsOneWidget);
      await seek(t, find.byKey(const Key('darOpenPreview')), 'darGenerateList');
      expect(
        find.text('Day status in this range (not part of the report):'),
        findsOneWidget,
      );
      expect(
        find.textContaining(RegExp('export|Export|PDF|Excel|Share')),
        findsNothing,
      );
      await tapKey(t, 'darOpenPreview');
      expect(find.text('Daily Accomplishment Report'), findsOneWidget);
      expect(find.text('Oct 6 · On leave'), findsOneWidget);
      expect(find.text('Oct 7 · Half day leave (AM)'), findsOneWidget);
      await seek(t, find.byKey(const Key('darSave')), 'darPreviewList');
      expect(find.text('Generated by OpsTrack.'), findsOneWidget);
      await tapKey(t, 'darSave');
      expect(find.text('Report saved'), findsOneWidget);
      await t.pageBack();
      t
          .state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger).first)
          .clearSnackBars();
      await t.pumpAndSettle();
      await seek(
        t,
        find.byKey(const Key('viewSavedReports')),
        'darGenerateList',
      );
      await tapKey(t, 'viewSavedReports');
      expect(find.byKey(const Key('savedReportsScreen')), findsOneWidget);
      expect(find.text('Changed after saving'), findsOneWidget);
      await tapKey(t, 'savedReport_sr1');
      expect(find.textContaining('Saved copy from'), findsOneWidget);
      expect(find.text('Read-only'), findsOneWidget);
      expect(find.byKey(const Key('oldNameNote')), findsOneWidget);
      await seek(
        t,
        find.text('Generated by Project Activity Tracker Application.'),
        'savedReportDetail',
      );
    });
  });

  group('Project type', () {
    testWidgets('filter by type, Not set and Inactive chips', (t) async {
      await pumpApp(t, location: '/projects');
      expect(find.text('Not set'), findsWidgets);
      expect(find.text('Inactive'), findsOneWidget);
      await tapKey(t, 'projectTypeFilter');
      await tapKey(t, 'projectTypeOption_pt7');
      expect(find.text('Globex ERP'), findsOneWidget);
      expect(find.text('Acme Corp rollout'), findsNothing);
    });

    testWidgets('new project requires a project type', (t) async {
      final c = await pumpApp(t, location: '/projects');
      await tapKey(t, 'newProjectFab');
      expect(find.byKey(const Key('newProjectScreen')), findsOneWidget);
      await tapKey(t, 'projectSave');
      for (final m in [
        'Choose a template.',
        'Project name is required.',
        'Project code is required.',
        'Choose a client.',
        'Choose a project type.',
        'Choose a project manager.',
        'Baseline start is required.',
        'Baseline end is required.',
      ]) {
        expect(find.text(m), findsOneWidget, reason: m);
      }
      // Inactive types are not offered for new projects.
      await t.tap(find.byKey(const Key('projectTypeField')));
      await t.pumpAndSettle();
      expect(find.text('Legacy rollout (Inactive)'), findsNothing);
      await t.tap(find.text('Support').last);
      await t.pumpAndSettle();
      expect(find.text('Choose a project type.'), findsNothing);
      expect(c, isNotNull);
    });
  });
}
