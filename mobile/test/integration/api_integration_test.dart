@Tags(['integration'])
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/data/api_client.dart';
import 'package:xc8_pm/data/api_repositories.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/data/p2.dart';
import 'package:xc8_pm/data/p3.dart';
import 'package:xc8_pm/data/session_store.dart';
import 'package:xc8_pm/data/v2_repositories.dart';

/// Runs the app's API layer against a real m8-polish API. Skipped unless configured:
///   IT_API_BASE_URL=http://localhost:4000/api/v1
///   IT_ACCOUNTS='admin@x|pw;pm@x|pw;member@x|pw;viewer@x|pw'   (never commit credentials)
/// flutter test test/integration/api_integration_test.dart
void main() {
  final base = Platform.environment['IT_API_BASE_URL'] ?? '';
  final accounts = [
    for (final a in (Platform.environment['IT_ACCOUNTS'] ?? '').split(';'))
      if (a.contains('|'))
        (a.substring(0, a.indexOf('|')), a.substring(a.indexOf('|') + 1)),
  ];
  final skip = base.isEmpty || accounts.isEmpty
      ? 'set IT_API_BASE_URL and IT_ACCOUNTS'
      : null;

  for (final (email, password) in accounts) {
    group('live API as $email', skip: skip, () {
      late ApiClient api;
      late AppUser me;
      final results = <String, String>{};

      Future<void> check(
        String name,
        Future<Object?> Function() f, {
        Set<int> allowed = const {},
      }) async {
        try {
          await f();
          results[name] = 'ok';
        } on ApiException catch (e) {
          if (allowed.contains(e.status)) {
            results[name] = '${e.status} (expected for role)';
          } else {
            results[name] = 'FAIL ${e.status} ${e.code} ${e.message}';
          }
        } catch (e) {
          results[name] = 'FAIL parse: $e';
        }
      }

      setUpAll(() async {
        api = ApiClient(base, store: MemorySessionStore());
        me = await ApiAuthRepository(api).login(email, password);
      });
      tearDownAll(() async {
        // ignore: avoid_print
        print(
          '\n== $email (${me.systemRole}) ==\n${results.entries.map((e) => '${e.key.padRight(28)} ${e.value}').join('\n')}',
        );
      });

      test(
        'session: mobile cookie stored, /auth/me, permissions, server clock',
        () async {
          final cur = await ApiAuthRepository(api).currentUser();
          expect(cur?.id, me.id);
          final p = await api.get('/auth/me/permissions');
          expect(p['permissions'], isA<Map>());
          expect(
            api.serverNow().difference(DateTime.now().toUtc()).inMinutes.abs(),
            lessThan(5),
          );
        },
      );

      test('every read endpoint the app uses parses', () async {
        final projects = ApiProjectRepository(api);
        List<Project> ps = const [];
        await check('projects', () async => ps = await projects.list());
        if (ps.isNotEmpty) {
          final pid = ps.first.id;
          await check('project', () => projects.get(pid));
          List<Task> ts = const [];
          await check(
            'project tasks',
            () async => ts = await projects.tasks(pid),
          );
          final x = ApiProjectExtrasRepository(api);
          await check('project extras', () => x.extras(pid));
          await check('project time', () => x.time(pid), allowed: {403});
          await check(
            'project activity',
            () => x.activity(pid),
            allowed: {403},
          );
          final p3 = ApiP3Repository(api);
          await check(
            'issues (project)',
            () => p3.issues(projectId: pid),
            allowed: {403},
          );
          await check(
            'issue options',
            () => p3.issueOptions(pid),
            allowed: {403},
          );
          await check('folders', () => p3.folders(pid), allowed: {403});
          await check('messages', () => p3.messages(pid), allowed: {403});
          if (ts.isNotEmpty) {
            await check('task', () => ApiTaskRepository(api).get(ts.first.id));
            await check(
              'task extras',
              () => ApiTaskActionsRepository(api).extras(ts.first.id),
            );
            await check(
              'task history',
              () => ApiTaskActionsRepository(api).history(ts.first.id),
            );
          }
        }
        await check('my tasks (v1)', () => ApiTaskRepository(api).mine());
        await check(
          'my tasks (today)',
          () => ApiMyTasksRepository(api).mine(view: 'today'),
        );
        final tr = ApiTrackerRepository(api);
        await check('tracker day', () => tr.day(DateTime.now()));
        await check('tracker running', () => tr.running());
        await check('tracker lookups', () => tr.lookups());
        await check('tracker people', () => tr.people(), allowed: {403});
        await check(
          'hours week',
          () => ApiHoursRepository(api).week(DateTime.now()),
          allowed: {403},
        );
        await check(
          'time options',
          () => ApiTimeRepository(api).options(),
          allowed: {403},
        );
        await check(
          'dar saved',
          () => ApiDarRepository(api).saved(),
          allowed: {403},
        );
        await check(
          'notifications',
          () => ApiNotificationRepository(api).list(),
        );
        await check(
          'issues (all)',
          () => ApiIssueRepository(api).list(),
          allowed: {403},
        );
        final lv = ApiLeaveRepository(api);
        await check('leave types', () => lv.types());
        await check('leave balances', () => lv.balances(DateTime.now().year));
        await check('leave mine', () => lv.mine(DateTime.now().year));
        await check('leave team', () => lv.team(), allowed: {403});
        final p3 = ApiP3Repository(api);
        await check('dashboard', () => p3.dashboard(), allowed: {403});
        await check('my projects', () => p3.myProjects(), allowed: {403});
        await check('workload', () => p3.workload(), allowed: {403});
        await check(
          'report project-status',
          () => p3.report('project-status'),
          allowed: {403},
        );
        await check(
          'waiting on client',
          () => p3.waitingOnClient(),
          allowed: {403},
        );
        await check(
          'my document requests',
          () => p3.myDocumentRequests(),
          allowed: {403},
        );
        await check('clients', () => p3.clients(), allowed: {403});
        await check('profile', () => p3.profile(me.id));
        final adm = ApiProjectAdminRepository(api);
        await check('project types', () => adm.projectTypes());
        await check('templates', () => adm.templates(), allowed: {403});
        final fails = results.entries
            .where((e) => e.value.startsWith('FAIL'))
            .toList();
        expect(
          fails,
          isEmpty,
          reason: fails.map((e) => '${e.key}: ${e.value}').join('\n'),
        );
      });

      test(
        'errors: 422 maps details to fields; 403 for forbidden writes',
        () async {
          try {
            await api.post('/projects', {'name': ''});
            fail('expected an error');
          } on ApiException catch (e) {
            expect([400, 403, 422], contains(e.status));
            if (e.status != 403) expect(e.fields, isNotEmpty);
          }
        },
      );

      test('logout ends the session (401 afterwards)', () async {
        await ApiAuthRepository(api).logout();
        await expectLater(
          api.get('/auth/me'),
          throwsA(isA<ApiException>().having((e) => e.status, 's', 401)),
        );
      });
    });
  }
}
