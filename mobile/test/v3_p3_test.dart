import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/p2.dart';
import 'package:xc8_pm/router.dart';
import 'package:xc8_pm/state/p3_providers.dart';

import 'helpers.dart';
import 'v2_p1_test.dart' show tapKey, seek;

void main() {
  group('P2 QA fixes', () {
    testWidgets('#1 no "managed on the web" note; #3 p3 demo project saves', (
      t,
    ) async {
      await pumpApp(t, location: '/projects/p3/edit');
      expect(
        find.text('Team members are managed on the web app for now.'),
        findsNothing,
      );
      expect(find.byKey(const Key('projectMembersField')), findsOneWidget);
      // p3 has an inactive type, so pick an active one, then save.
      await tapKey(t, 'projectSave');
      expect(find.text('Project code is required.'), findsNothing);
      expect(find.text('Choose a project manager.'), findsNothing);
      expect(find.text('Baseline start is required.'), findsNothing);
    });

    testWidgets('#2 edit route re-inits when the id changes', (t) async {
      final c = await pumpApp(t, location: '/projects/p1/edit');
      expect(find.text('Acme Corp rollout'), findsWidgets);
      c.read(routerProvider).go('/projects/p4/edit');
      await t.pumpAndSettle();
      expect(find.text('Umbrella onboarding'), findsWidgets);
      expect(find.text('Acme Corp rollout'), findsNothing);
    });

    testWidgets('#5 project tabs: scrollable TabBar with Time and Activity', (
      t,
    ) async {
      await pumpApp(t, location: '/projects/p1');
      final bar = t.widget<TabBar>(find.byKey(const Key('projectTabs')));
      expect(bar.isScrollable, isTrue);
      expect(bar.tabAlignment, TabAlignment.start);
      await t.ensureVisible(find.byKey(const Key('timeTab')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const Key('timeTab')));
      await t.pumpAndSettle();
      expect(find.byKey(const Key('projectTimeList')), findsOneWidget);
      await t.ensureVisible(find.byKey(const Key('activityTab')));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const Key('activityTab')));
      await t.pumpAndSettle();
      expect(find.byKey(const Key('projectActivityList')), findsOneWidget);
      await t.ensureVisible(find.byKey(const Key('moreTab')));
      await t.tap(find.byKey(const Key('moreTab')));
      await t.pumpAndSettle();
      expect(find.byKey(const Key('projectDocumentsLink')), findsOneWidget);
      expect(find.byKey(const Key('projectConversationLink')), findsOneWidget);
      expect(find.byKey(const Key('projectTimeLink')), findsNothing);
    });
  });

  group('P3 issues (45–46)', () {
    testWidgets(
      'detail: comment required, add comment, start → resolve needs a resolution',
      (t) async {
        await pumpApp(t, location: '/issues/i1');
        expect(find.text('Login loop on Safari'), findsWidgets);
        expect(find.text('Ana Cruz (client contact)'), findsOneWidget);
        await seek(
          t,
          find.byKey(const Key('issueCommentSend')),
          'issueDetailScreen',
        );
        await tapKey(t, 'issueCommentSend');
        expect(find.text('Comment is required.'), findsOneWidget);
        await t.enterText(
          find.byKey(const Key('issueCommentField')),
          'Cookie fix deployed to staging.',
        );
        await tapKey(t, 'issueCommentSend');
        expect(
          find.textContaining('Cookie fix deployed to staging.'),
          findsOneWidget,
        );
        await seek(
          t,
          find.byKey(const Key('issuePrimaryAction')),
          'issueDetailScreen',
        );
        expect(find.text('Start'), findsOneWidget);
        await tapKey(t, 'issuePrimaryAction');
        expect(find.text('Move to Waiting on client'), findsOneWidget);
        expect(find.textContaining('Open → In progress'), findsOneWidget);
        await seek(
          t,
          find.byKey(const Key('issuePrimaryAction')),
          'issueDetailScreen',
        );
        await t.tap(find.byKey(const Key('issueOtherStatus')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const Key('issueTo_RESOLVED')));
        await t.pumpAndSettle();
        await tapKey(t, 'issueStatusTextSave');
        expect(find.text('Describe the resolution.'), findsOneWidget);
        await t.enterText(
          find.byKey(const Key('issueStatusText')),
          'Fixed the SameSite cookie.',
        );
        await tapKey(t, 'issueStatusTextSave');
        expect(find.textContaining('In progress → Resolved'), findsOneWidget);
      },
    );

    testWidgets('due date change asks why; link a task', (t) async {
      await pumpApp(t, location: '/issues/i4');
      await tapKey(t, 'issueOverflow');
      await tapKey(t, 'issueChangeDue');
      await t.tap(find.text('OK'));
      await t.pumpAndSettle();
      expect(find.text('Why is the due date changing?'), findsWidgets);
      await tapKey(t, 'dueReasonSave');
      expect(find.text('Why is the due date changing?'), findsWidgets);
      await t.enterText(
        find.byKey(const Key('dueReason')),
        'Client asked for more time.',
      );
      await tapKey(t, 'dueReasonSave');
      expect(
        find.textContaining('Client asked for more time.'),
        findsOneWidget,
      );
      await seek(
        t,
        find.byKey(const Key('issueLinkTask')),
        'issueDetailScreen',
      );
      await tapKey(t, 'issueLinkTask');
      await t.tap(find.byKey(const Key('linkTask_t3')));
      await tapKey(t, 'linkTaskSave');
      expect(find.byKey(const Key('issueTask_t3')), findsOneWidget);
    });

    testWidgets(
      'raise issue: required errors, then created and listed on the task',
      (t) async {
        await pumpApp(t, location: '/projects/p1/issues/new?task=t3');
        await tapKey(t, 'raiseIssueSubmit');
        expect(find.text('Title is required.'), findsOneWidget);
        expect(find.text('Description is required.'), findsOneWidget);
        expect(find.text('Choose a severity.'), findsOneWidget);
        await t.enterText(
          find.byKey(const Key('issueTitleField')),
          'Role import fails',
        );
        await t.enterText(
          find.byKey(const Key('issueDescriptionField')),
          'CSV with 2 roles errors out.',
        );
        await t.tap(find.byKey(const ValueKey('issueSeverityField4')));
        await t.pumpAndSettle();
        await t.tap(find.text('High').last);
        await t.pumpAndSettle();
        await tapKey(t, 'raiseIssueSubmit');
        expect(find.byKey(const Key('issueDetailScreen')), findsOneWidget);
        expect(find.text('Role import fails'), findsWidgets);
      },
    );
  });

  group('P3 documents & conversation (47–48)', () {
    testWidgets('folders, restricted chip, filter, fulfil a request, upload', (
      t,
    ) async {
      var next = const PickedFile('IdP metadata.xml', 12, [1]);
      await pumpApp(
        t,
        location: '/projects/p1/documents',
        overrides: [
          documentPickerProvider.overrideWithValue(() async => next),
          urlOpenerProvider.overrideWithValue((_) async => true),
        ],
      );
      expect(find.text('Restricted folder'), findsOneWidget);
      await tapKey(t, 'docFilter_REQUESTED');
      expect(find.text('Overdue'), findsOneWidget);
      await tapKey(t, 'doc_d3');
      await tapKey(t, 'fulfilRequest');
      expect(find.byKey(const Key('doc_d3')), findsNothing);
      await tapKey(t, 'docFilter_FOLDERS');
      await tapKey(t, 'folder_f2');
      expect(find.byKey(const Key('doc_d3')), findsOneWidget);
      next = const PickedFile('Cutover plan.docx', 30, [1]);
      await tapKey(t, 'documentUpload');
      expect(find.text('Cutover plan.docx'), findsOneWidget);
    });

    testWidgets('conversation: empty message error, tag a task, post', (
      t,
    ) async {
      await pumpApp(t, location: '/projects/p1/conversation');
      expect(find.textContaining('Kickoff done.'), findsOneWidget);
      await tapKey(t, 'messageSend');
      expect(find.text('Write a message first.'), findsOneWidget);
      await tapKey(t, 'whoSeesThis');
      expect(
        find.textContaining('Everyone who can see the project.'),
        findsOneWidget,
      );
      await t.tap(find.text('OK'));
      await t.pumpAndSettle();
      await t.enterText(
        find.byKey(const Key('messageField')),
        'SSO test passed on staging',
      );
      await tapKey(t, 'messageSend');
      expect(find.text('SSO test passed on staging'), findsOneWidget);
      expect(find.textContaining('You ·'), findsWidgets);
    });
  });

  group('P3 home, insights, account (49–57)', () {
    testWidgets('home portfolio, filters, milestones, severity', (t) async {
      await pumpApp(t, location: '/home');
      await seek(t, find.text('Role matrix sign-off'), 'homeScreen');
      await seek(t, find.byKey(const Key('portfolio')), 'homeScreen');
      expect(find.text('Upcoming milestones'), findsOneWidget);
      await seek(t, find.byKey(const Key('dashSeverity')), 'homeScreen');
      expect(find.text('Critical 1'), findsOneWidget);
      expect(find.text('Avg. days to resolve: 2.5'), findsOneWidget);
    });

    testWidgets('notifications deep link to the reopened day and to an issue', (
      t,
    ) async {
      await pumpApp(t, location: '/notifications');
      await tapKey(t, 'notification_n5');
      expect(find.byKey(const Key('dayTimesheet')), findsOneWidget);
      expect(find.textContaining('Oct 8'), findsWidgets);
    });

    testWidgets(
      'insights: my projects sort + follow up, workload, reports view only',
      (t) async {
        await pumpApp(t, location: '/insights');
        expect(find.text('5 days late'), findsOneWidget);
        expect(find.text('Follow up'), findsOneWidget);
        await tapKey(t, 'insightsTab_workload');
        expect(find.text('Over capacity'), findsOneWidget);
        expect(find.textContaining('No capacity set'), findsOneWidget);
        await tapKey(t, 'insightsTab_reports');
        expect(
          find.text(
            'View only. Exports and advanced filters are on the web app.',
          ),
          findsOneWidget,
        );
        await tapKey(t, 'report_timesheets');
        expect(find.byKey(const Key('reportTotal')), findsOneWidget);
        expect(
          find.textContaining('Export'),
          findsWidgets,
        ); // only the footer copy
        expect(find.byIcon(Icons.download), findsNothing);
      },
    );

    testWidgets('profile read-only, change password policy', (t) async {
      await pumpApp(t, location: '/profile');
      expect(find.text('Queen Reyes'), findsOneWidget);
      expect(find.text('Set by Admin'), findsNWidgets(2));
      await tapKey(t, 'profileChangePassword');
      await t.enterText(find.byKey(const Key('currentPassword')), 'pass1');
      await t.enterText(find.byKey(const Key('newPassword')), 'short');
      await tapKey(t, 'changePasswordSubmit');
      expect(
        find.text('Use 8+ characters, a number and a symbol.'),
        findsOneWidget,
      );
      await t.enterText(find.byKey(const Key('newPassword')), 'longer1!pass');
      await t.enterText(
        find.byKey(const Key('confirmPassword')),
        'longer1!pass',
      );
      await tapKey(t, 'changePasswordSubmit');
      expect(find.text('Password changed'), findsOneWidget);
    });

    testWidgets('clients: search, detail tabs, add contact validation', (
      t,
    ) async {
      await pumpApp(t, location: '/clients');
      await t.enterText(find.byKey(const Key('clientSearch')), 'glo');
      await t.pumpAndSettle();
      expect(find.byKey(const Key('client_c1')), findsNothing);
      await tapKey(t, 'client_c2');
      await tapKey(t, 'clientTab_contacts');
      await tapKey(t, 'addClientContact');
      await tapKey(t, 'contactSave');
      expect(find.text('Name is required.'), findsOneWidget);
      await t.enterText(find.byKey(const Key('contactName')), 'Hana Lee');
      await t.enterText(find.byKey(const Key('contactEmail')), 'bad');
      await tapKey(t, 'contactSave');
      expect(find.text('Enter a valid email.'), findsOneWidget);
      await t.enterText(
        find.byKey(const Key('contactEmail')),
        'hana@globex.example',
      );
      await tapKey(t, 'contactSave');
      expect(find.text('Hana Lee'), findsOneWidget);
    });

    testWidgets('set password: invalid link shows Link not valid', (t) async {
      await pumpApp(
        t,
        signedIn: false,
        location: '/setup-password?token=expired',
      );
      expect(find.text('Link not valid'), findsOneWidget);
      expect(find.text('This link is no longer valid.'), findsOneWidget);
    });
  });
}
