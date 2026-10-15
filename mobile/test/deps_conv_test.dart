import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/data/p3.dart';
import 'package:xc8_pm/state/p3_providers.dart';
import 'package:xc8_pm/state/providers.dart';
import 'package:xc8_pm/ui/v2/dependencies.dart';

import 'helpers.dart';
import 'v2_p1_test.dart' show seek, tapKey;

bool has(String k) => find.byKey(Key(k)).evaluate().isNotEmpty;

class _Forbidden extends MockP3Repository {
  _Forbidden(super.s, super.store);
  @override
  Future<void> postMessage(String projectId, Json b) async =>
      throw ApiException(
        'Only people on this project can post here.',
        status: 403,
        code: 'FORBIDDEN',
      );
}

Task _t(String id, [List<String> deps = const []]) => Task(
  id: id,
  projectId: 'p',
  name: id.toUpperCase(),
  status: TaskStatus.todo,
  priority: Priority.medium,
  dependsOn: deps,
);

void main() {
  group('conversation canPost (FR-CNV-04)', () {
    testWidgets(
      'member of p1 posts; not a member / not managing p2 → read-only',
      (t) async {
        await pumpApp(t, role: 'MEMBER', location: '/projects/p1/conversation');
        expect(has('messageSend'), isTrue);
        await pumpApp(t, role: 'MEMBER', location: '/projects/p2/conversation');
        expect(has('messageSend'), isFalse);
        expect(
          find.text('You can read this conversation but not post.'),
          findsOneWidget,
        );
        await pumpApp(
          t,
          location: '/projects/p2/conversation',
        ); // PM, doesn't manage p2
        expect(has('conversationReadOnly'), isTrue);
        await pumpApp(t, role: 'ADMIN', location: '/projects/p2/conversation');
        expect(has('messageSend'), isTrue);
      },
    );

    testWidgets('server 403 switches to the read-only note', (t) async {
      await pumpApp(
        t,
        location: '/projects/p1/conversation',
        overrides: [
          p3RepositoryProvider.overrideWith(
            (ref) => _Forbidden(
              ref.watch(mockP3StoreProvider),
              ref.watch(mockStoreProvider),
            ),
          ),
        ],
      );
      await t.enterText(find.byKey(const Key('messageField')), 'Hello');
      await tapKey(t, 'messageSend');
      expect(has('conversationReadOnly'), isTrue);
      expect(
        find.text('Only people on this project can post here.'),
        findsOneWidget,
      );
    });
  });

  group('dependencies', () {
    test('same rules as the API: self, unknown, cycle', () {
      final ts = [
        _t('a'),
        _t('b', ['a']),
        _t('c', ['b']),
      ];
      expect(
        dependencyProblem('a', ['a'], ts),
        "A task can't depend on itself.",
      );
      expect(
        dependencyProblem('a', ['zz'], ts),
        'Dependencies must be tasks in this project.',
      );
      expect(
        dependencyProblem('a', ['c'], ts),
        'Circular dependency: A → C → B → A.',
      );
      expect(dependencyProblem('c', ['a'], ts), isNull);
      expect(dependencyProblem(null, ['c'], ts), isNull);
    });

    testWidgets(
      'edit: search, cycle blocked in the sheet, chips, saved via API',
      (t) async {
        final c = await pumpApp(t, location: '/tasks/t2/edit');
        await seek(t, find.byKey(const Key('addDependency')), 'editTaskList');
        await tapKey(t, 'addDependency');
        expect(has('dependencyOption_t2'), isFalse); // no self
        await t.enterText(find.byKey(const Key('dependencySearch')), 'sso');
        await t.pumpAndSettle();
        expect(has('dependencyOption_t1'), isFalse);
        await tapKey(t, 'dependencyOption_t4'); // t4 depends on t2
        await tapKey(t, 'dependencyDone');
        expect(
          find.text(
            'Circular dependency: Environment setup → Configure SSO → Environment setup.',
          ),
          findsOneWidget,
        );
        await tapKey(t, 'dependencyOption_t4');
        await t.enterText(find.byKey(const Key('dependencySearch')), '');
        await t.pumpAndSettle();
        await tapKey(t, 'dependencyOption_t1');
        await tapKey(t, 'dependencyDone');
        expect(has('dependencyChip_t1'), isTrue);
        await tapKey(t, 'taskSave');
        expect(storeOf(c).tasks.firstWhere((x) => x.id == 't2').dependsOn, [
          't1',
        ]);
      },
    );

    testWidgets('create: pick a dependency, sent with the new task', (t) async {
      final c = await pumpApp(t, location: '/projects/p1/tasks/new');
      await t.enterText(
        find.byKey(const Key('taskNameField')),
        'Go-live checklist',
      );
      await seek(t, find.byKey(const Key('addDependency')), 'createTaskList');
      await tapKey(t, 'addDependency');
      await tapKey(t, 'dependencyOption_t7');
      await tapKey(t, 'dependencyDone');
      expect(has('dependencyChip_t7'), isTrue);
      await tapKey(t, 'saveTask');
      expect(storeOf(c).tasks.last.name, 'Go-live checklist');
      expect(storeOf(c).tasks.last.dependsOn, ['t7']);
    });
  });
}
