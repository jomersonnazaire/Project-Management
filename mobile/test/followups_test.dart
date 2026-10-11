import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/data/p3.dart';
import 'package:xc8_pm/state/p3_providers.dart';
import 'package:xc8_pm/state/providers.dart';

import 'helpers.dart';
import 'v2_p1_test.dart' show seek, tapKey;

bool has(String k) => find.byKey(Key(k)).evaluate().isNotEmpty;

class _NoPost extends MockP3Repository {
  _NoPost(super.s, super.store);
  @override
  Future<bool?> messagesCanPost(String projectId) async => false;
}

void main() {
  testWidgets('#1 dependencies picker only with planTasks', (t) async {
    await pumpApp(t, location: '/tasks/t2/edit'); // PM managing p1
    await seek(t, find.byKey(const Key('addDependency')), 'editTaskList');
    expect(has('addDependency'), isTrue);
    await pumpApp(
      t,
      role: 'MEMBER',
      location: '/tasks/t2/edit',
    ); // own task, not a planner
    expect(has('editTaskScreen'), isTrue);
    await seek(t, find.byKey(const Key('editTaskMandatory')), 'editTaskList');
    expect(has('addDependency'), isFalse);
    await pumpApp(t, location: '/tasks/t8/edit'); // PM, p2 not managed
    expect(has('editTaskScreen'), isTrue);
    await seek(t, find.byKey(const Key('editTaskMandatory')), 'editTaskList');
    expect(has('addDependency'), isFalse);
  });

  testWidgets('#2 /tasks/:id/edit gated: Viewer gets no-access', (t) async {
    await pumpApp(t, role: 'VIEWER', location: '/tasks/t3/edit');
    expect(has('noAccessScreen'), isTrue);
    expect(has('taskSave'), isFalse);
  });

  testWidgets(
    '#3 conversation: archived project and can.post=false are read-only',
    (t) async {
      await pumpApp(
        t,
        location: '/projects/p1/conversation',
        overrides: [
          p3RepositoryProvider.overrideWith(
            (ref) => _NoPost(
              ref.watch(mockP3StoreProvider),
              ref.watch(mockStoreProvider),
            ),
          ),
        ],
      );
      expect(has('conversationReadOnly'), isTrue);
      await pumpApp(
        t,
        location: '/projects/p1/conversation',
        overrides: [
          projectProvider.overrideWith(
            (ref, id) async => const Project(
              id: 'p1',
              name: 'Acme rollout',
              clientName: 'Acme',
              status: ProjectStatus.active,
              progress: 0,
              managerId: 'u1',
              archived: true,
            ),
          ),
        ],
      );
      expect(has('conversationReadOnly'), isTrue);
    },
  );

  testWidgets('#4 create has no web-only note; edit sets a reviewer', (
    t,
  ) async {
    await pumpApp(t, location: '/projects/p1/tasks/new');
    expect(find.textContaining('on the web'), findsNothing);
    final c = await pumpApp(t, location: '/tasks/t2/edit');
    await seek(t, find.byKey(const Key('editTaskApproval')), 'editTaskList');
    await tapKey(t, 'editTaskApproval');
    await seek(t, find.byKey(const Key('editTaskReviewer')), 'editTaskList');
    await tapKey(t, 'editTaskReviewer');
    await t.tap(find.text('Mark Kim').last);
    await t.pumpAndSettle();
    await tapKey(t, 'taskSave');
    expect(
      storeOf(c).tasks.firstWhere((x) => x.id == 't2').reviewerName,
      'Mark Kim',
    );
  });

  testWidgets(
    '#5 demo task can follows the server: Viewer cannot edit, Member not planner',
    (t) async {
      await pumpApp(t, role: 'VIEWER', location: '/tasks/t4');
      expect(has('taskEdit'), isFalse);
      await pumpApp(t, role: 'MEMBER', location: '/projects/p1');
      expect(has('newTaskFab'), isFalse);
    },
  );

  testWidgets(
    'non-planner editing own task: plan fields read-only, nothing sent',
    (t) async {
      final c = await pumpApp(t, role: 'MEMBER', location: '/tasks/t2/edit');
      expect(find.byKey(const Key('editTaskReadOnly')), findsOneWidget);
      expect(find.byKey(const Key('taskSave')), findsNothing);
      await seek(t, find.byKey(const Key('editTaskEst')), 'editTaskList');
      final est = t.widget<TextField>(find.byKey(const Key('editTaskEst')));
      expect(est.readOnly, isTrue);
      final v = storeOf(c).tasks.firstWhere((x) => x.id == 't2').version;
      await t.tap(
        find.byKey(const Key('editTaskPlanned')),
        warnIfMissed: false,
      );
      await t.pumpAndSettle();
      expect(find.byType(DatePickerDialog), findsNothing);
      expect(storeOf(c).tasks.firstWhere((x) => x.id == 't2').version, v);
    },
  );
}
