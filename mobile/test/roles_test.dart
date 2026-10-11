import 'dart:async';

import 'package:flutter/material.dart';
import 'package:xc8_pm/router.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/access.dart';
import 'package:xc8_pm/state/v2_providers.dart';

import 'helpers.dart';
import 'v2_p1_test.dart' show seek, tapKey;

bool has(String key) => find.byKey(Key(key)).evaluate().isNotEmpty;

/// Gating matrix per role (m8-polish DEFAULT_SPEC, web useCan + project.can).
/// Demo PM is u1, who manages p1 and p4 but not p2/p3.
const roles = ['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'];
const expect_ = <String, Map<String, bool>>{
  'newProjectFab': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': false,
    'VIEWER': false,
  },
  'editProject@p1': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': false,
    'VIEWER': false,
  },
  'editProject@p2': {
    'ADMIN': true,
    'PROJECT_MANAGER': false,
    'MEMBER': false,
    'VIEWER': false,
  },
  'newTaskFab@p1': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': false,
    'VIEWER': false,
  },
  'checklistCheckbox': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': true,
    'VIEWER': false,
  },
  'hoursLogTime': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': true,
    'VIEWER': false,
  },
  'raiseIssue': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': true,
    'VIEWER': false,
  },
  'documentUpload': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': true,
    'VIEWER': false,
  },
  'messageSend': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': true,
    'VIEWER': false,
  },
  'addClientContact': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': false,
    'VIEWER': false,
  },
  'addFollowUp': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': true,
    'VIEWER': false,
  },
  'timeTab': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': true,
    'VIEWER': false,
  },
  'activityTab': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': false,
    'VIEWER': false,
  },
  'insightsTab_projects': {
    'ADMIN': true,
    'PROJECT_MANAGER': true,
    'MEMBER': false,
    'VIEWER': true,
  },
};

void main() {
  for (final role in roles) {
    group('role $role', () {
      bool want(String k) => expect_[k]![role]!;

      testWidgets(
        'projects: new, edit (own / not managed), new task, checklist, tabs',
        (t) async {
          await pumpApp(t, role: role, location: '/projects');
          expect(has('newProjectFab'), want('newProjectFab'));
          await pumpApp(t, role: role, location: '/projects/p1');
          expect(has('editProject'), want('editProject@p1'));
          expect(has('newTaskFab'), want('newTaskFab@p1'));
          expect(has('timeTab'), want('timeTab'));
          expect(has('activityTab'), want('activityTab'));
          final box = t.widgetList<Checkbox>(find.byType(Checkbox)).first;
          expect(box.onChanged != null, want('checklistCheckbox'));
          await pumpApp(t, role: role, location: '/projects/p2');
          expect(has('editProject'), want('editProject@p2'));
          await pumpApp(t, role: role, location: '/projects/new');
          expect(has('noAccessScreen'), !want('newProjectFab'));
        },
      );

      testWidgets('hours, issues, documents, conversation', (t) async {
        await pumpApp(t, role: role, location: '/day');
        await tapKey(t, 'hoursListSegment');
        expect(has('hoursLogTime'), want('hoursLogTime'));
        await pumpApp(t, role: role, location: '/issues');
        expect(has('raiseIssue'), want('raiseIssue'));
        await pumpApp(t, role: role, location: '/projects/p1/documents');
        expect(has('documentUpload'), want('documentUpload'));
        await pumpApp(t, role: role, location: '/projects/p1/conversation');
        expect(has('messageSend'), want('messageSend'));
        expect(has('conversationReadOnly'), !want('messageSend'));
      });

      testWidgets('clients add contact, follow-up, insights tabs', (t) async {
        await pumpApp(t, role: role, location: '/clients/c1');
        await tapKey(t, 'clientTab_contacts');
        expect(has('addClientContact'), want('addClientContact'));
        await pumpApp(t, role: role, location: '/tasks/t4/history');
        expect(has('addFollowUp'), want('addFollowUp'));
        await pumpApp(t, role: role, location: '/insights');
        expect(has('insightsTab_projects'), want('insightsTab_projects'));
        expect(has('insightsTab_workload'), isTrue);
      });
    });
  }

  group('permissions', () {
    test('strict parse: only JSON true grants', () {
      final g = parsePermissions({
        'permissions': {
          'tasks': {'edit': true, 'create': 'true', 'delete': 1},
          'bad': 'VCED',
        },
      });
      expect(hasPermission(g, 'tasks', 'edit'), isTrue);
      expect(hasPermission(g, 'tasks', 'create'), isFalse);
      expect(hasPermission(g, 'tasks', 'delete'), isFalse);
      expect(g.containsKey('bad'), isFalse);
      expect(hasPermission(null, 'tasks', 'edit'), isFalse);
    });

    testWidgets('actions hidden while permissions load', (t) async {
      await pumpApp(
        t,
        location: '/projects',
        overrides: [
          permissionsProvider.overrideWith(
            (ref) => Completer<PermissionGrid>().future,
          ),
        ],
      );
      expect(has('newProjectFab'), isFalse);
    });
  });

  group('S4 fixes', () {
    testWidgets(
      'insights: deep link to another tab while open; title lists tabs; All teams',
      (t) async {
        final c = await pumpApp(t, location: '/insights');
        expect(
          find.text('My projects · Team & workload · Reports'),
          findsOneWidget,
        );
        c.read(routerProvider).go('/insights?tab=workload');
        await t.pumpAndSettle();
        expect(find.byKey(const Key('workloadTeamFilter')), findsOneWidget);
        expect(find.text('Queen Reyes\nConsultant'), findsOneWidget);
        await tapKey(t, 'workloadTeamFilter');
        await t.tap(find.text('Delivery').last);
        await t.pumpAndSettle();
        expect(find.text('Queen Reyes\nConsultant'), findsNothing);
        await tapKey(t, 'workloadTeamFilter');
        await t.tap(find.text('All teams').last);
        await t.pumpAndSettle();
        expect(find.text('Queen Reyes\nConsultant'), findsOneWidget);
      },
    );

    testWidgets('set password: unknown demo token shows Link not valid', (
      t,
    ) async {
      await pumpApp(t, signedIn: false, location: '/setup-password?token=bad');
      expect(find.text('Link not valid'), findsOneWidget);
    });

    testWidgets(
      'task detail: project in app bar, task name after scrolling past heading',
      (t) async {
        await pumpApp(t, location: '/tasks/t4');
        final name = t.widget<Text>(find.byKey(const Key('taskTitle'))).data;
        final title = t.widget<Text>(find.byKey(const Key('taskAppBarTitle')));
        expect(
          title.data,
          isNot(
            contains(t.widget<Text>(find.byKey(const Key('taskTitle'))).data!),
          ),
        );
        await t.drag(
          find.byKey(const Key('taskDetailsList')),
          const Offset(0, -300),
        );
        await t.pumpAndSettle();
        expect(
          t.widget<Text>(find.byKey(const Key('taskAppBarTitle'))).data,
          name,
        );
      },
    );

    testWidgets('home: Portfolio only with reports.view', (t) async {
      await pumpApp(t, role: 'VIEWER');
      expect(find.byKey(const Key('homeScreen')), findsOneWidget);
      await seek(t, find.byKey(const Key('portfolio')), 'homeScreen');
      expect(has('portfolio'), isTrue);
    });
  });

  testWidgets('H2 create task: owner and assignees from the project team', (
    t,
  ) async {
    final c = await pumpApp(t, location: '/projects/p1/tasks/new');
    await t.enterText(find.byType(TextFormField).first, 'Owner test task');
    await seek(t, find.byKey(const Key('taskAssignee_u3')), 'createTaskList');
    await tapKey(t, 'taskAssignee_u3');
    expect(
      t.widget<FilterChip>(find.byKey(const Key('taskAssignee_u3'))).selected,
      isTrue,
    );
    expect(find.byKey(const Key('taskOwner')), findsOneWidget);
    expect(c, isNotNull);
  });
}
