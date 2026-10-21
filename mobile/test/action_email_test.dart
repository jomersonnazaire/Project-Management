import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xc8_pm/app.dart' show handleMailLink;
import 'package:xc8_pm/data/action_email.dart';
import 'package:xc8_pm/data/api_client.dart';
import 'package:xc8_pm/data/api_repositories.dart';
import 'package:xc8_pm/data/dar_send.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/data/ms_sign_in.dart';
import 'package:xc8_pm/data/p2.dart';
import 'package:xc8_pm/data/v2_repositories.dart';
import 'package:xc8_pm/state/v2_providers.dart';
import 'package:xc8_pm/ui/v2/action_email_ui.dart' show followUpAlreadyEmailed;

import 'helpers.dart';

const _code = 'one-time-code-0123456789abcdef';
final _link = Uri.parse('opstrack://auth/mail?code=$_code');

const _emailKeys = [
  'emailNewAssignees',
  'emailAddedMembers',
  'emailReturn',
  'code_challenge',
  'code_challenge_method',
];

/// Queen #1: a ticked box sends the flag AND emailReturn:'mobile' AND both PKCE fields.
void expectEmailFields(
  Map<String, dynamic> body,
  String flag,
  String challenge,
) {
  expect(body[flag], true, reason: flag);
  expect(body['emailReturn'], 'mobile');
  expect(body['code_challenge'], challenge);
  expect(body['code_challenge_method'], 'S256');
}

/// …and an unticked box sends none of them.
void expectNoEmailFields(Map<String, dynamic> body) {
  for (final k in _emailKeys) {
    expect(body.containsKey(k), isFalse, reason: k);
  }
}

void main() {
  tearDown(() => mockSaveEmail = demoMockSaveEmail);

  group('contract (PR #37 ed2d6b5)', () {
    late List<http.Request> calls;
    ApiClient api(Object Function(http.Request) body) {
      calls = [];
      return ApiClient(
        'http://api.test/api/v1',
        client: MockClient((req) async {
          calls.add(req);
          return http.Response(jsonEncode(body(req)), 200);
        }),
      );
    }

    Map<String, dynamic> sent(int i) =>
        jsonDecode(calls[i].body) as Map<String, dynamic>;

    test('email-status and follow-up start bodies', () async {
      final r = ApiActionEmailRepository(
        api(
          (q) => q.url.path.endsWith('email-status')
              ? {'enabled': true, 'linked': false}
              : {'url': 'https://login.microsoftonline.com/x', 'recipients': 3},
        ),
      );
      final st = await r.status();
      expect((st.enabled, st.linked), (true, false));
      expect(calls[0].url.path, '/api/v1/auth/me/email-status');
      final s = await r.followUp('t1', 'f1', codeChallenge: 'c' * 43);
      expect(calls[1].url.path, '/api/v1/action-emails/mobile');
      expect(sent(1), {
        'kind': 'FOLLOW_UP',
        'taskId': 't1',
        'followUpId': 'f1',
        'code_challenge': 'c' * 43,
        'code_challenge_method': 'S256',
      });
      expect((s.url!.host, s.recipients), ('login.microsoftonline.com', 3));
    });

    test(
      'task create/update and project create/update carry the email fields',
      () async {
        final emailBody = {
          'url': 'https://login.microsoftonline.com/x',
          'error': null,
          'message': null,
          'recipients': 2,
        };
        final a = api(
          (q) => {
            'task': {
              'id': 't9',
              'name': 'T',
              'projectId': 'p1',
              'followUps': [],
            },
            'project': {'id': 'p9'},
            'email': emailBody,
          },
        );
        final e1 = EmailOnSave('a' * 43);
        await ApiProjectRepository(a).createTask(
          'p1',
          const NewTask(name: 'T', assigneeIds: ['u2']),
          email: e1,
        );
        expect(calls[0].url.path, '/api/v1/projects/p1/tasks');
        expect(sent(0), containsPair('emailNewAssignees', true));
        expect(sent(0), containsPair('emailReturn', 'mobile'));
        expect(sent(0), containsPair('code_challenge', 'a' * 43));
        expect(sent(0), containsPair('code_challenge_method', 'S256'));
        expect(e1.start!.recipients, 2);

        final e2 = EmailOnSave('b' * 43);
        await ApiTaskActionsRepository(a).update(
          't9',
          const TaskEdit(version: 1, assigneeIds: ['u2']),
          email: e2,
        );
        expect(
          (calls[1].method, calls[1].url.path),
          ('PATCH', '/api/v1/tasks/t9'),
        );
        expect(sent(1)['emailNewAssignees'], true);
        expect(e2.start!.url, isNotNull);

        final e3 = EmailOnSave('c' * 43);
        await ApiProjectAdminRepository(a).create(
          const ProjectInput(name: 'P', memberIds: ['u2']),
          email: e3,
        );
        expect(sent(2), containsPair('emailAddedMembers', true));
        expect(sent(2), containsPair('emailReturn', 'mobile'));
        final e4 = EmailOnSave('d' * 43);
        await ApiProjectAdminRepository(a).update(
          'p9',
          const ProjectInput(name: 'P', memberIds: ['u2']),
          email: e4,
        );
        expect(
          (calls[3].method, sent(3)['emailAddedMembers']),
          ('PATCH', true),
        );
      },
    );

    test(
      'saves without email send none of the email fields (all four)',
      () async {
        final a = api(
          (q) => {
            'task': {'id': 't9', 'name': 'T', 'projectId': 'p1'},
            'project': {'id': 'p9'},
          },
        );
        await ApiProjectRepository(a)
            .createTask('p1', const NewTask(name: 'T'));
        await ApiTaskActionsRepository(a)
            .update('t9', const TaskEdit(version: 1));
        await ApiProjectAdminRepository(a)
            .create(const ProjectInput(name: 'P'));
        await ApiProjectAdminRepository(a)
            .update('p9', const ProjectInput(name: 'P'));
        for (var i = 0; i < 4; i++) {
          expectNoEmailFields(sent(i));
        }
      },
    );

    test('save email with url null keeps the server message', () {
      final s = EmailStart.fromJson({
        'url': null,
        'error': 'NO_RECIPIENTS',
        'message': 'Nobody new to email.',
        'recipients': 0,
      })!;
      expect(s.url, isNull);
      expect(s.notStartedMessage, 'Nobody new to email.');
      expect(
        EmailStart.fromJson({'url': null, 'error': 'MICROSOFT_NOT_LINKED'})!
            .notStartedMessage,
        'Email not sent. Link your Microsoft account to send emails.',
      );
      // Only https URLs are opened.
      expect(EmailStart.fromJson({'url': 'javascript:x'})!.url, isNull);
    });

    test('addFollowUp returns the new follow-up id', () async {
      final a = api(
        (q) => {
          'task': {
            'id': 't1',
            'followUps': [
              {'id': 'f1'},
              {'id': 'f2'},
            ],
          },
        },
      );
      expect(await ApiTaskActionsRepository(a).addFollowUp('t1', 'n'), 'f2');
    });

    test('follow-up 409 errors map to copy', () {
      for (final (code, text) in [
        ('EMAIL_DISABLED', 'Email not sent: emails are switched off.'),
        (
          'MICROSOFT_NOT_LINKED',
          'Email not sent. Link your Microsoft account to send emails.',
        ),
        ('PROJECT_ARCHIVED', 'Email not sent: this project is archived.'),
        ('ALREADY_EMAILED', alreadyEmailedMessage),
        ('NO_RECIPIENTS', 'Email not sent: there was nobody to email.'),
      ]) {
        expect(
          actionEmailApiErrorMessage(
            ApiException('x', status: 409, code: code),
          ),
          text,
        );
      }
      expect(
        actionEmailApiErrorMessage(ApiException('x', status: 429)),
        contains('too many'),
      );
    });
  });

  group('one confirm handler, routed by flow', () {
    late MockDarSendRepository repo;
    late MockActionEmailRepository actions;
    late MemoryMsPkceStorage store;
    DarMailSend mk() {
      repo = MockDarSendRepository();
      actions = MockActionEmailRepository(demo: false);
      store = MemoryMsPkceStorage();
      return DarMailSend(repo: repo, storage: store);
    }

    test('follow-up: verifier stored with flow + ids, confirm sent', () async {
      final m = mk();
      actions.recipients = 3;
      await m.beginFollowUp(
        actions,
        taskId: 't1',
        followUpId: 'f1',
        projectId: 'p1',
      );
      final j = jsonDecode(store.map.values.single) as Map<String, dynamic>;
      expect(j['flow'], 'action_email');
      expect(
        (j['task'], j['followUp'], j['project'], j['total']),
        ('t1', 'f1', 'p1', 3),
      );
      repo.confirmBody = {
        'flow': 'action_email',
        'project': 'p1',
        'task': 't1',
        'followUp': 'f1',
        'email': 'sent',
        'recipients': 3,
      };
      final r = await m.handleAny(_link) as ActionEmailResult;
      expect(repo.confirms.single.$2, j['verifier']);
      expect((r.sent, r.partial, r.recipients), (true, false, 3));
      expect(
        r.message,
        'Emailed the team about this follow-up from your Outlook. Sent to 3 people.',
      );
      expect(store.map, isEmpty);
      // The DAR-only handle() never returns an action result.
      expect(await m.handle(_link), isNull);
    });

    for (final (flow, ids, who) in [
      ('task_assigned', {'project': 'p1', 'task': 't1'}, 'the new assignees'),
      ('project_added', {'project': 'p1'}, 'the new members'),
    ]) {
      test('$flow confirm', () async {
        final m = mk();
        final p = m.newPair();
        await m.remember(
          p,
          flow: flow,
          project: ids['project'],
          task: ids['task'],
          total: 1,
        );
        repo.confirmBody = {
          'flow': flow,
          ...ids,
          'email': 'sent',
          'recipients': 1,
        };
        final r = await m.handleAny(_link) as ActionEmailResult;
        expect((r.flow, r.sent), (flow, true));
        expect(r.message, 'Emailed $who from your Outlook. Sent to 1 person.');
      });
    }

    test('sent with recipients missing or 0 → no count', () async {
      for (final n in [null, 0]) {
        final r = ActionEmailResult.fromConfirm(
          {
            'flow': 'project_added',
            'project': 'p1',
            'email': 'sent',
            'recipients': ?n,
          },
          flow: 'project_added',
          projectId: 'p1',
        );
        expect(r.message, 'Emailed the new members from your Outlook.');
      }
    });

    test('partial: own wording, never the plain Emailed success', () {
      ActionEmailResult partial(int? n, {int total = 0}) =>
          ActionEmailResult.fromConfirm(
            {
              'flow': 'task_assigned',
              'task': 't1',
              'email': 'partial',
              'recipients': ?n,
            },
            flow: 'task_assigned',
            taskId: 't1',
            total: total,
          );
      expect(
        partial(2, total: 3).message,
        "Some emails couldn't be sent. Emailed 2 of 3 people.",
      );
      expect(
        partial(1).message,
        "Some emails couldn't be sent. Emailed 1 person.",
      );
      expect(partial(0).message, "Some emails couldn't be sent.");
      expect(partial(null).message, "Some emails couldn't be sent.");
      for (final r in [partial(2, total: 3), partial(0)]) {
        expect(r.message, isNot(startsWith('Emailed')));
        expect(r.message, isNot(contains('from your Outlook')));
      }
    });

    test('email_error: known copy, unknown → send_failed, never "Sent to"', () {
      ActionEmailResult err(String e) => ActionEmailResult.fromConfirm(
        {
          'flow': 'action_email',
          'task': 't1',
          'email_error': e,
          'recipients': 0,
        },
        flow: 'action_email',
        taskId: 't1',
      );
      expect(err('consent_declined').sent, isFalse);
      expect(
        err('consent_declined').message,
        'Email not sent: you cancelled or declined the Microsoft prompt.',
      );
      expect(err('something_new').reason, 'send_failed');
      for (final e in ActionEmailResult.knownErrors) {
        expect(err(e).message, isNot(contains('Sent to')), reason: e);
        expect(err(e).message, isNot(startsWith('Emailed')), reason: e);
      }
    });

    test('a 200 for another flow or other ids is not this email', () async {
      for (final body in <Map<String, dynamic>>[
        {'flow': 'project_added', 'project': 'p1', 'email': 'sent'},
        {
          'flow': 'task_assigned',
          'project': 'p1',
          'task': 'other',
          'email': 'sent',
        },
        {'flow': 'dar', 'report': 'sr1', 'sent': 'sr1'},
      ]) {
        final m = mk();
        await m.remember(
          m.newPair(),
          flow: 'task_assigned',
          project: 'p1',
          task: 't1',
        );
        repo.confirmBody = body;
        final r = await m.handleAny(_link) as ActionEmailResult;
        expect(r.sent, isFalse, reason: '$body');
        expect(r.reason, 'result_unavailable');
      }
    });

    test('400 INVALID_CODE → expired, try again (verifier kept)', () async {
      final m = mk();
      await m.remember(m.newPair(), flow: 'project_added', project: 'p1');
      repo.confirmError = ApiException('x', status: 400, code: 'INVALID_CODE');
      final r = await m.handleAny(_link) as ActionEmailResult;
      expect(r.reason, 'expired');
      expect(r.message, contains('expired. Try again.'));
      expect(store.map, isNotEmpty);
    });

    test('a link with no code is never Emailed', () async {
      final m = mk();
      await m.remember(m.newPair(), flow: 'project_added', project: 'p1');
      final r = await m.handleAny(
        Uri.parse('opstrack://auth/mail?email=sent'),
      ) as ActionEmailResult;
      expect((r.sent, r.reason), (false, 'no_result'));
      expect(repo.confirms, isEmpty);
    });

    test('M comes from the start response, N from confirm', () async {
      final m = mk();
      actions.recipients = 3; // start: {url, recipients: 3}
      await m.beginFollowUp(actions, taskId: 't1', followUpId: 'f1');
      repo.confirmBody = {
        'flow': 'action_email',
        'task': 't1',
        'followUp': 'f1',
        'email': 'partial',
        'recipients': 2, // confirm: emails actually sent
      };
      final r = await m.handleAny(_link) as ActionEmailResult;
      expect((r.recipients, r.total), (2, 3));
      expect(r.message, "Some emails couldn't be sent. Emailed 2 of 3 people.");
      // Saves: M from the save's email.recipients, kept with the verifier.
      final p = m.newPair();
      await m.remember(p, flow: 'project_added', project: 'p1', total: 4);
      repo.confirmBody = {
        'flow': 'project_added',
        'project': 'p1',
        'email': 'partial',
        'recipients': 1,
      };
      final s = await m.handleAny(
        Uri.parse('opstrack://auth/mail?code=${_code}2'),
      ) as ActionEmailResult;
      expect(s.message, "Some emails couldn't be sent. Emailed 1 of 4 people.");
    });

    test(
      'Queen #2: an emailed or partly emailed follow-up is never emailed again',
      () {
        final fus = [
          FollowUp.fromJson({
            'id': 'f1',
            'note': 'a',
            'emailedAt': '2026-10-21T02:00:00Z',
          }),
          FollowUp.fromJson({'id': 'f2', 'note': 'b', 'emailedAt': null}),
          FollowUp.fromJson({'id': 'f3', 'note': 'c'}),
        ];
        expect(fus[0].emailedAt, isNotNull);
        expect(followUpAlreadyEmailed({}, fus, 'f1'), isTrue);
        expect(followUpAlreadyEmailed({}, fus, 'f2'), isFalse);
        expect(followUpAlreadyEmailed({'f3'}, fus, 'f3'), isTrue);
      },
    );

    test('DAR still routes to DAR', () async {
      final m = mk();
      await m.begin('sr1');
      repo.confirmBody = {
        'flow': 'dar',
        'report': 'sr1',
        'sent': 'sr1',
        'recipients': 3,
      };
      final r = await m.handleAny(_link) as DarSendResult;
      expect((r.sent, r.recipientCount), (true, 3));
    });
  });

  group('screens', () {
    late MockDarSendRepository repo;
    late MockActionEmailRepository actions;
    late List<Uri> launched;
    Future pump(
      WidgetTester tester, {
      required String location,
      EmailStatus status = const EmailStatus(enabled: true, linked: true),
    }) {
      repo = MockDarSendRepository();
      actions = MockActionEmailRepository(current: status, demo: false);
      launched = [];
      return pumpApp(
        tester,
        location: location,
        overrides: [
          darSendRepositoryProvider.overrideWithValue(repo),
          actionEmailRepositoryProvider.overrideWithValue(actions),
          externalLauncherProvider.overrideWithValue((u) async {
            launched.add(u);
            return true;
          }),
        ],
      );
    }

    Future<void> show(WidgetTester tester, Finder f) async {
      await tester.scrollUntilVisible(
        f,
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
    }

    testWidgets('follow-up: Email the team → browser → confirm → banner', (
      tester,
    ) async {
      final c = await pump(tester, location: '/tasks/t4/history');
      expect(find.text('Email the team'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('followUpField')),
        'Chased Acme',
      );
      await tester.tap(find.byKey(const Key('addFollowUp')));
      await tester.pumpAndSettle();
      expect(actions.followUps.single.$1, 't4');
      expect(launched.single.host, 'login.microsoftonline.com');
      repo.confirmBody = {
        'flow': 'action_email',
        'project': 'p1',
        'task': 't4',
        'followUp': actions.followUps.single.$2,
        'email': 'sent',
        'recipients': 2,
      };
      await handleMailLink(c, _link);
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Emailed the team about this follow-up from your Outlook. Sent to 2 people.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('emailResultDismiss')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('emailResultBanner')), findsNothing);
    });

    testWidgets('follow-up unticked: saved, no email', (tester) async {
      await pump(tester, location: '/tasks/t4/history');
      await tester.tap(find.text('Email the team'));
      await tester.enterText(find.byKey(const Key('followUpField')), 'No mail');
      await tester.tap(find.byKey(const Key('addFollowUp')));
      await tester.pumpAndSettle();
      expect(actions.followUps, isEmpty);
      expect(launched, isEmpty);
    });

    testWidgets('follow-up ALREADY_EMAILED → banner', (tester) async {
      await pump(tester, location: '/tasks/t4/history');
      actions.followUpError = ApiException(
        'x',
        status: 409,
        code: 'ALREADY_EMAILED',
      );
      await tester.enterText(find.byKey(const Key('followUpField')), 'Again');
      await tester.tap(find.byKey(const Key('addFollowUp')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          "This follow-up was already emailed, so it wasn't sent again.",
        ),
        findsOneWidget,
      );
      expect(launched, isEmpty);
    });

    testWidgets('not linked: disabled with hint; not enabled: hidden', (
      tester,
    ) async {
      await pump(
        tester,
        location: '/tasks/t4/history',
        status: const EmailStatus(enabled: true, linked: false),
      );
      final box = tester.widget<CheckboxListTile>(
        find.byType(CheckboxListTile),
      );
      expect((box.value, box.onChanged), (false, null));
      expect(
        find.text('Link your Microsoft account to send emails.'),
        findsOneWidget,
      );
    });

    testWidgets('email disabled hides the option', (tester) async {
      await pump(
        tester,
        location: '/tasks/t4/history',
        status: const EmailStatus(enabled: false, linked: true),
      );
      expect(find.text('Email the team'), findsNothing);
    });

    testWidgets('task edit: Email {name} for one new assignee → browser', (
      tester,
    ) async {
      mockSaveEmail = urlMockSaveEmail;
      final c = await pump(tester, location: '/tasks/t4/edit');
      await show(tester, find.byKey(const Key('assignee_u3')));
      expect(find.byKey(const ValueKey('taskAssignedEmail')), findsNothing);
      await tester.tap(find.byKey(const Key('assignee_u3')));
      await tester.pumpAndSettle();
      expect(find.text('Email Mark Kim'), findsOneWidget);
      await tester.tap(find.byKey(const Key('assignee_u2')));
      await tester.pumpAndSettle();
      expect(find.text('Email new assignees'), findsOneWidget);
      await tester.tap(find.byKey(const Key('taskSave')));
      await tester.pumpAndSettle();
      expect(launched.single.query, 'emailNewAssignees');
      repo.confirmBody = {
        'flow': 'task_assigned',
        'project': 'p1',
        'task': 't4',
        'email': 'partial',
        'recipients': 1,
      };
      await handleMailLink(c, _link);
      await tester.pumpAndSettle();
      expect(
        find.text("Some emails couldn't be sent. Emailed 1 of 2 people."),
        findsOneWidget,
      );
    });

    testWidgets(
      'Queen #1: ticked task save sends all three; unticked sends none',
      (tester) async {
        final got = <Map<String, Object>>[];
        mockSaveEmail = (f, n, e) {
          got.add(e.fields(f));
          return urlMockSaveEmail(f, n, e);
        };
        await pump(tester, location: '/tasks/t4/edit');
        await show(tester, find.byKey(const Key('assignee_u3')));
        await tester.tap(find.byKey(const Key('assignee_u3')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('taskSave')));
        await tester.pumpAndSettle();
        expect(got, hasLength(1));
        expectEmailFields(
          got.single,
          'emailNewAssignees',
          got.single['code_challenge'] as String,
        );
        expect(got.single['code_challenge'] as String, hasLength(43));

        got.clear();
        launched.clear();
        await pump(tester, location: '/tasks/t4/edit');
        await show(tester, find.byKey(const Key('assignee_u3')));
        await tester.tap(find.byKey(const Key('assignee_u3')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Email Mark Kim'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('taskSave')));
        await tester.pumpAndSettle();
        expect(got, isEmpty, reason: 'no email fields when unticked');
        expect(launched, isEmpty);
      },
    );

    testWidgets('Queen #1: unticked project save sends no email fields', (
      tester,
    ) async {
      final got = <Map<String, Object>>[];
      mockSaveEmail = (f, n, e) {
        got.add(e.fields(f));
        return urlMockSaveEmail(f, n, e);
      };
      await pump(tester, location: '/projects/p1/edit');
      await show(tester, find.byKey(const Key('projectMember_u2')));
      await tester.tap(find.byKey(const Key('projectMember_u2')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Email new members'));
      await tester.pumpAndSettle();
      await show(tester, find.byKey(const Key('projectSave')));
      await tester.tap(find.byKey(const Key('projectSave')));
      await tester.pumpAndSettle();
      expect(got, isEmpty);
      expect(launched, isEmpty);
    });

    testWidgets(
      'Queen #2: partial follow-up shows partial wording and is not offered again',
      (tester) async {
        final c = await pump(tester, location: '/tasks/t4/history');
        await tester.enterText(
          find.byKey(const Key('followUpField')),
          'Chased',
        );
        await tester.tap(find.byKey(const Key('addFollowUp')));
        await tester.pumpAndSettle();
        final fu = actions.followUps.single.$2;
        repo.confirmBody = {
          'flow': 'action_email',
          'project': 'p1',
          'task': 't4',
          'followUp': fu,
          'email': 'partial',
          'recipients': 1,
        };
        await handleMailLink(c, _link);
        await tester.pumpAndSettle();
        expect(
          find.text("Some emails couldn't be sent. Emailed 1 of 2 people."),
          findsOneWidget,
        );
        expect(find.textContaining('Emailed the team'), findsNothing);
        expect(c.read(partlyEmailedFollowUpsProvider), {fu});
        expect(
          find.textContaining("Emailed · some couldn't be sent"),
          findsOneWidget,
        );
        // The only email option is for a new note; the partly sent one has none.
        expect(find.text('Email the team'), findsOneWidget);
        expect(actions.followUps, hasLength(1));
      },
    );

    testWidgets('task save with url null shows the message, save kept', (
      tester,
    ) async {
      mockSaveEmail = (f, n, e) => const EmailStart(
        error: 'NO_RECIPIENTS',
        message: 'Nobody new to email.',
      );
      await pump(tester, location: '/tasks/t4/edit');
      await show(tester, find.byKey(const Key('assignee_u3')));
      await tester.tap(find.byKey(const Key('assignee_u3')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('taskSave')));
      await tester.pumpAndSettle();
      expect(launched, isEmpty);
      expect(find.text('Nobody new to email.'), findsOneWidget);
      expect(find.byKey(const Key('editTaskScreen')), findsNothing);
    });

    testWidgets('project edit: Email new members → browser → banner', (
      tester,
    ) async {
      mockSaveEmail = urlMockSaveEmail;
      final c = await pump(tester, location: '/projects/p1/edit');
      await show(tester, find.byKey(const Key('projectMember_u2')));
      expect(find.text('Email new members'), findsNothing);
      await tester.tap(find.byKey(const Key('projectMember_u2')));
      await tester.pumpAndSettle();
      expect(find.text('Email new members'), findsOneWidget);
      await show(tester, find.byKey(const Key('projectSave')));
      await tester.tap(find.byKey(const Key('projectSave')));
      await tester.pumpAndSettle();
      expect(launched.single.query, 'emailAddedMembers');
      repo.confirmBody = {
        'flow': 'project_added',
        'project': 'p1',
        'email_error': 'send_forbidden',
        'recipients': 0,
      };
      await handleMailLink(c, _link);
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Email not sent: Microsoft refused to send from your mailbox. The change itself was saved.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Sent to'), findsNothing);
    });
  });
}
