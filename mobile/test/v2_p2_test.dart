import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/data/p2.dart';
import 'package:xc8_pm/router.dart';
import 'package:xc8_pm/state/p2_providers.dart';
import 'package:xc8_pm/theme/app_theme.dart';

import 'helpers.dart';
import 'v2_p1_test.dart' show tapKey, pickMenu, seek;

/// No word broken mid-way and nothing ellipsized in the paragraphs under [f].
void expectNoClip(Finder f, {String? reason}) {
  for (final e in f.evaluate()) {
    final rp = e.renderObject;
    if (rp is! RenderParagraph) continue;
    final txt = rp.text.toPlainText();
    expect(rp.didExceedMaxLines, isFalse, reason: '$txt ellipsized $reason');
    expect(
      rp.size.width + 0.5 >= rp.getMinIntrinsicWidth(double.infinity),
      isTrue,
      reason: '$txt breaks mid-word $reason',
    );
  }
}

Finder para(String text) => find.descendant(
  of: find.text(text),
  matching: find.byType(RichText),
  matchRoot: true,
);

void main() {
  group('QA fixes on PR #17', () {
    testWidgets('#3 2x: My tasks KPI labels wrap at word boundaries', (
      t,
    ) async {
      t.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
      await pumpApp(t, location: '/tasks');
      expect(t.takeException(), isNull);
      for (final l in [
        'Overdue',
        'Due this week',
        'Waiting for my review',
        'Logged this week',
      ]) {
        expectNoClip(para(l), reason: l);
      }
    });

    testWidgets(
      '#3/#5 2x: project detail header, status chip, baseline labels',
      (t) async {
        t.platformDispatcher.textScaleFactorTestValue = 2;
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        final c = await pumpApp(t, location: '/projects/p1');
        expect(t.takeException(), isNull);
        final line = t.widget<Text>(find.byKey(const Key('projectHeaderLine')));
        expect(line.data, startsWith('Implementation · Go-live'));
        expect(line.maxLines, 2);
        expect(line.overflow, TextOverflow.ellipsis);
        expectNoClip(
          find.descendant(
            of: find.byKey(const Key('projectHeader')),
            matching: find.descendant(
              of: find.byType(StatusChip),
              matching: find.byType(RichText),
            ),
          ),
        );
        for (final tab in ['board', 'issues', 'more']) {
          c.read(routerProvider).go('/projects/p1?tab=$tab');
          await t.pumpAndSettle();
          expect(t.takeException(), isNull, reason: tab);
        }
        c.read(routerProvider).go('/projects/p1/edit');
        await t.pumpAndSettle();
        for (final l in ['Baseline start *', 'Baseline end *']) {
          await seek(t, find.text(l), 'projectFormList');
          await t.pumpAndSettle();
          expectNoClip(para(l), reason: l);
        }
        expect(t.takeException(), isNull);
      },
    );

    testWidgets('#5 1x: header line reads type · go-live · PM', (t) async {
      await pumpApp(t, location: '/projects/p1');
      expect(
        t.widget<Text>(find.byKey(const Key('projectHeaderLine'))).data,
        startsWith('Implementation · Go-live '),
      );
    });

    testWidgets(
      '#4 Timesheet review: hint "Choose a person…", dropdown icon labelled',
      (t) async {
        // Web/desktop (where QA ran) expose the trailing button; on phones it's part of the field.
        debugDefaultTargetPlatformOverride = TargetPlatform.linux;
        addTearDown(() => debugDefaultTargetPlatformOverride = null);
        final h = t.ensureSemantics();
        await pumpApp(t, location: '/timesheet-review');
        expect(find.text('Choose a person…'), findsWidgets);
        expect(find.text('Person'), findsNothing);
        expect(
          find.bySemanticsLabel(RegExp('Open the person list')),
          findsOneWidget,
        );
        h.dispose();
        debugDefaultTargetPlatformOverride = null;
      },
    );
  });

  group('Leave (41–44)', () {
    testWidgets(
      'More › Leave: balances, merged AM+PM, past leave hint, years, team',
      (t) async {
        final c = await pumpApp(t, location: '/more');
        await tapKey(t, 'moreLeave');
        expect(find.byKey(const Key('leaveScreen')), findsOneWidget);
        expect(find.text('Calendar year Jan–Dec'), findsOneWidget);
        await seek(t, find.text('$fullDayAmPm · 1 day'), 'myLeaveList');
        await seek(t, find.byKey(const Key('pastLeave_l1')), 'myLeaveList');
        c.read(leaveYearProvider.notifier).set(2025);
        await t.pumpAndSettle();
        await t.drag(
          find.byKey(const Key('myLeaveList')),
          const Offset(0, 2000),
        );
        await t.pumpAndSettle();
        expect(find.text('2025'), findsOneWidget);
        await tapKey(t, 'leaveNextYear');
        expect(find.text('2026'), findsOneWidget);
        await t.tap(find.byKey(const Key('leaveTab_team')));
        await t.pumpAndSettle();
        expect(find.text('Next 30 days'), findsOneWidget);
        expect(find.text('Supervisor needed'), findsOneWidget);
        expect(find.textContaining('Negative'), findsOneWidget);
      },
    );

    testWidgets('record leave sheet: validation and full-day-only types', (
      t,
    ) async {
      await pumpApp(t, location: '/leave');
      await tapKey(t, 'recordLeaveFab');
      expect(find.byKey(const Key('recordLeaveSheet')), findsOneWidget);
      expect(
        find.textContaining("Don't include medical details"),
        findsOneWidget,
      );
      await tapKey(t, 'recordLeaveSubmit');
      expect(find.text('Choose a leave type.'), findsOneWidget);
      await pickMenu(t, 'leaveTypeField', 'Emergency');
      final seg = t.widget<SegmentedButton<String>>(
        find.byKey(const Key('leaveDayPart')),
      );
      expect(seg.segments.where((s) => s.enabled).map((s) => s.value), [
        'FULL',
      ]);
      await pickMenu(t, 'leaveTypeField', 'Vacation');
      await tapKey(t, 'recordLeaveSubmit');
      expect(find.text(noWorkingDays), findsOneWidget); // today is a Sunday
    });

    testWidgets(
      '+ Add leave on Day timesheet opens the sheet with the day prefilled',
      (t) async {
        await pumpApp(t, location: '/day');
        await seek(t, find.byKey(const Key('addLeave')), 'dayTimesheet');
        await tapKey(t, 'addLeave');
        expect(find.byKey(const Key('recordLeaveSheet')), findsOneWidget);
        expect(find.text('Sun, Oct 11'), findsWidgets);
      },
    );

    testWidgets(
      'mock rules: over balance, morning taken, half day single date, success + cancel',
      (t) async {
        final c = await pumpApp(t);
        final repo = c.read(leaveRepositoryProvider);
        Matcher msg(String m) =>
            throwsA(isA<ApiException>().having((e) => e.message, 'message', m));
        await expectLater(
          repo.record(
            LeaveInput(
              typeId: 'lt3',
              dayPart: 'FULL',
              from: DateTime(2026, 11, 2),
              to: DateTime(2026, 11, 6),
            ),
          ),
          msg(overBalanceMessage(3, 'Emergency', 5)),
        );
        await expectLater(
          repo.record(
            LeaveInput(
              typeId: 'lt1',
              dayPart: 'AM',
              from: DateTime(2026, 10, 15),
              to: DateTime(2026, 10, 15),
            ),
          ),
          msg(morningTaken),
        );
        await expectLater(
          repo.record(
            LeaveInput(
              typeId: 'lt1',
              dayPart: 'AM',
              from: DateTime(2026, 10, 26),
              to: DateTime(2026, 10, 27),
            ),
          ),
          msg(halfDaySingleDate),
        );
        final ok = await repo.record(
          LeaveInput(
            typeId: 'lt1',
            dayPart: 'FULL',
            from: DateTime(2026, 10, 26),
            to: DateTime(2026, 10, 27),
          ),
        );
        expect(ok.days, 2);
        await expectLater(repo.cancel('l1'), msg(pastLeaveAdminOnly));
      },
    );

    testWidgets('cancel one half of a merged day', (t) async {
      await pumpApp(t, location: '/leave');
      await seek(t, find.byKey(const Key('cancelLeave_l3+l4')), 'myLeaveList');
      await tapKey(t, 'cancelLeave_l3+l4');
      expect(find.text('Cancel morning (AM)'), findsOneWidget);
      await t.tap(find.text('Cancel afternoon (PM)'));
      await t.pumpAndSettle();
      await tapKey(t, 'confirmCancelLeave');
      expect(find.text('$fullDayAmPm · 1 day'), findsNothing);
    });

    testWidgets('no-supervisor banner', (t) async {
      final c = await pumpApp(t);
      c.read(mockLeaveStoreProvider).hasSupervisor = false;
      c.read(routerProvider).go('/leave');
      await t.pumpAndSettle();
      expect(find.text(noSupervisorLeave), findsOneWidget);
    });
  });

  group('Task actions (36–40)', () {
    testWidgets('approve a For review task', (t) async {
      final c = await pumpApp(t, location: '/tasks/t7');
      await seek(t, find.byKey(const Key('approveTask')), 'taskDetailScreen');
      await tapKey(t, 'approveTask');
      expect(
        storeOf(c).tasks.firstWhere((x) => x.id == 't7').status,
        TaskStatus.done,
      );
    });

    testWidgets(
      'request changes needs a comment, then shows "Changes requested:"',
      (t) async {
        final c = await pumpApp(t, location: '/tasks/t7');
        await seek(
          t,
          find.byKey(const Key('requestChanges')),
          'taskDetailScreen',
        );
        await tapKey(t, 'requestChanges');
        await tapKey(t, 'requestChangesSubmit');
        expect(find.text('Comment is required.'), findsOneWidget);
        await t.enterText(
          find.byKey(const Key('requestChangesComment')),
          'Attach the signed UAT form.',
        );
        await tapKey(t, 'requestChangesSubmit');
        expect(
          storeOf(c).tasks.firstWhere((x) => x.id == 't7').status,
          TaskStatus.inProgress,
        );
        await seek(
          t,
          find.byKey(const Key('changesRequested')),
          'taskDetailScreen',
        );
      },
    );

    testWidgets(
      'evidence: legacy link label, file type check, upload adds the file',
      (t) async {
        PickedFile next = const PickedFile('notes.txt', 10, [1]);
        await pumpApp(
          t,
          location: '/tasks/t4',
          overrides: [
            evidencePickerProvider.overrideWithValue(() async => next),
          ],
        );
        await seek(
          t,
          find.byKey(const Key('uploadEvidence')),
          'taskDetailScreen',
        );
        expect(
          find.text('Link (legacy) · added before file uploads'),
          findsOneWidget,
        );
        await tapKey(t, 'uploadEvidence');
        expect(find.byKey(const Key('evidenceError')), findsOneWidget);
        expect(
          evidenceProblem(
            const PickedFile('big.pdf', evidenceMaxBytes + 1, [1]),
          ),
          contains('25 MB'),
        );
        next = const PickedFile('Signed SSO form.pdf', 2048, [1, 2]);
        await tapKey(t, 'uploadEvidence');
        expect(find.byKey(const Key('evidenceError')), findsNothing);
        expect(find.text('Signed SSO form.pdf'), findsOneWidget);
      },
    );

    testWidgets('follow-ups: empty state, required note, add', (t) async {
      await pumpApp(t, location: '/tasks/t3');
      await seek(t, find.byKey(const Key('addFollowUp')), 'taskDetailScreen');
      expect(find.text('No follow-ups yet.'), findsOneWidget);
      await tapKey(t, 'addFollowUp');
      expect(find.text('Note is required.'), findsOneWidget);
      await t.enterText(
        find.byKey(const Key('followUpField')),
        'Chased Acme for the roles list.',
      );
      await tapKey(t, 'addFollowUp');
      expect(find.text('Chased Acme for the roles list.'), findsOneWidget);
    });

    testWidgets(
      'edit task: name required, save updates the task, history lists it',
      (t) async {
        final c = await pumpApp(t, location: '/tasks/t3');
        await tapKey(t, 'taskEdit');
        expect(find.byKey(const Key('editTaskScreen')), findsOneWidget);
        await t.enterText(find.byKey(const Key('editTaskName')), '');
        await tapKey(t, 'taskSave');
        expect(find.text('Task name is required.'), findsOneWidget);
        await t.enterText(
          find.byKey(const Key('editTaskName')),
          'Configure roles and groups',
        );
        await seek(t, find.byKey(const Key('assignee_u3')), 'editTaskList');
        await t.tap(find.byKey(const Key('assignee_u3')));
        await t.pumpAndSettle();
        await tapKey(t, 'taskSave');
        final task = storeOf(c).tasks.firstWhere((x) => x.id == 't3');
        expect(task.name, 'Configure roles and groups');
        expect(task.assignees, contains('Mark Kim'));
        c.read(routerProvider).go('/tasks/t3/history');
        await t.pumpAndSettle();
        expect(find.text('Updated'), findsOneWidget);
        expect(find.text('Created'), findsOneWidget);
      },
    );

    testWidgets(
      'delete: blocked explains why; deletable is removed after confirm',
      (t) async {
        final c = await pumpApp(t, location: '/tasks/t4');
        await t.tap(find.byKey(const Key('taskOverflow')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const Key('taskDelete')));
        await t.pumpAndSettle();
        expect(find.textContaining('Delete those first.'), findsOneWidget);
        c.read(routerProvider).go('/tasks/t8');
        await t.pumpAndSettle();
        await t.tap(find.byKey(const Key('taskOverflow')).last);
        await t.pumpAndSettle();
        await t.tap(find.byKey(const Key('taskDelete')).last);
        await t.pumpAndSettle();
        expect(
          find.text(
            'Nothing has been recorded on it yet. This cannot be undone.',
          ),
          findsOneWidget,
        );
        await tapKey(t, 'confirmDeleteTask');
        expect(storeOf(c).tasks.any((x) => x.id == 't8'), isFalse);
      },
    );
  });

  group('Project detail & form (31–35)', () {
    testWidgets('More tab: handover, contacts, time and activity', (t) async {
      final c = await pumpApp(t, location: '/projects/p1?tab=more');
      await tapKey(t, 'handoverButton');
      await tapKey(t, 'handoverSubmit');
      expect(find.text('Choose a project manager.'), findsOneWidget);
      await pickMenu(t, 'handoverTo', 'Queen Reyes');
      await tapKey(t, 'handoverSubmit');
      expect(
        storeOf(c).projects.firstWhere((p) => p.id == 'p1').managerName,
        'Queen Reyes',
      );
      await seek(t, find.byKey(const Key('addContact')), 'projectInfo');
      await tapKey(t, 'addContact');
      await t.tap(find.byKey(const Key('contactOption_k2')));
      await t.pumpAndSettle();
      await seek(t, find.byKey(const Key('removeContact_k1')), 'projectInfo');
      await tapKey(t, 'removeContact_k1');
      expect(find.byKey(const Key('contact_k1')), findsNothing);
      expect(find.byKey(const Key('contact_k2')), findsOneWidget);
      c.read(routerProvider).go('/projects/p1/time');
      await t.pumpAndSettle();
      expect(find.text('12:00 total'), findsOneWidget);
      c.read(routerProvider).go('/projects/p1/activity');
      await t.pumpAndSettle();
      expect(find.text('Handover'), findsOneWidget);
      expect(find.text('Contact added'), findsOneWidget);
    });

    testWidgets('edit project: status and members saved', (t) async {
      final c = await pumpApp(t, location: '/projects/p1/edit');
      await seek(
        t,
        find.byKey(const Key('projectMember_u2')),
        'projectFormList',
      );
      await t.tap(find.byKey(const Key('projectMember_u2')));
      await t.pumpAndSettle();
      await pickMenu(t, 'projectStatusField', 'On hold');
      await tapKey(t, 'projectSave');
      expect(
        storeOf(c).projects.firstWhere((p) => p.id == 'p1').status,
        ProjectStatus.onHold,
      );
      final x = await c.read(projectExtrasRepositoryProvider).extras('p1');
      expect(x.members.map((m) => m.id), containsAll(['u1', 'u2']));
    });
  });
}
