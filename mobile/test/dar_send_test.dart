import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xc8_pm/data/api_client.dart';
import 'package:xc8_pm/data/dar_send.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/data/ms_sign_in.dart';
import 'package:xc8_pm/data/tracker_models.dart';
import 'package:xc8_pm/state/v2_providers.dart';
import 'package:xc8_pm/ui/v2/dar_send_ui.dart';

import 'helpers.dart';

const _linked = DarSendStatus(
  enabled: true,
  canNotify: false,
  to: (name: 'Queen Reyes', email: 'queen@xceler8.example'),
  cc: ['mark@xceler8.example'],
);

void main() {
  group('mail return link + confirm (API PR #36)', () {
    late MockDarSendRepository repo;
    late MemoryMsPkceStorage store;
    late DateTime now;
    DarMailSend mk() {
      repo = MockDarSendRepository();
      store = MemoryMsPkceStorage();
      now = DateTime.utc(2026, 10, 21, 2);
      return DarMailSend(repo: repo, storage: store, now: () => now);
    }

    Uri link(String q) => Uri.parse('opstrack://auth/mail$q');
    const code = 'one-time-code-0123456789abcdef';

    test('begin: fresh S256 pair per send, verifier stored', () async {
      final m = mk();
      await m.begin('sr1');
      await m.begin('sr1');
      expect(repo.challenges.toSet(), hasLength(2));
      final j = jsonDecode(store.map.values.single) as Map<String, dynamic>;
      final v = j['verifier'] as String;
      expect(j['report'], 'sr1');
      expect(
        repo.challenges.last,
        base64Url
            .encode(sha256.convert(ascii.encode(v)).bytes)
            .replaceAll('=', ''),
      );
    });

    test('begin failure clears the verifier', () async {
      final m = mk();
      repo.startError = ApiException('x', status: 429);
      await expectLater(m.begin('sr1'), throwsA(isA<ApiException>()));
      expect(store.map, isEmpty);
    });

    test('successful confirm: sends code + stored verifier, sent only from the body', () async {
      final m = mk();
      await m.begin('sr1');
      final v = (jsonDecode(
        store.map.values.single,
      ) as Map<String, dynamic>)['verifier'];
      repo.confirmBody = {'flow': 'dar', 'report': 'sr1', 'sent': 'sr1'};
      final r = (await m.handle(link('?code=$code')))!;
      expect(repo.confirms.single, (code, v));
      expect((r.reportId, r.sent), ('sr1', true));
      expect(store.map, isEmpty, reason: 'verifier is single use');
    });

    test('confirm body with send_error → not sent, reason kept', () async {
      final m = mk();
      await m.begin('sr1');
      repo.confirmBody = {
        'flow': 'dar',
        'report': 'sr1',
        'send_error': 'consent_declined',
      };
      final r = (await m.handle(link('?code=$code')))!;
      expect((r.sent, r.reason), (false, 'consent_declined'));
    });

    test('forged links never count as sent and call nothing', () async {
      for (final q in ['', '?sent=sr1', '?report=sr1&sent=sr1', '?code=']) {
        final m = mk();
        await m.begin('sr1');
        final r = (await m.handle(link(q)))!;
        expect(r.sent, isFalse, reason: q);
        expect(r.reason, DarSendResult.noResult, reason: q);
        expect(darSendMessage(r.reason), darNoResult);
        expect(repo.confirms, isEmpty, reason: q);
      }
    });

    test(
      '?error=result_unavailable → check Sent status copy, no confirm',
      () async {
        final m = mk();
        await m.begin('sr1');
        final r = (await m.handle(link('?error=result_unavailable')))!;
        expect((r.reportId, r.sent), ('sr1', false));
        expect(r.reason, DarSendResult.resultUnavailable);
        expect(
          darSendMessage(r.reason),
          "We couldn't confirm whether the report was sent. Check its Sent status before sending again.",
        );
        expect(repo.confirms, isEmpty);
        expect(
          store.map,
          isNotEmpty,
          reason: 'kept: a real link may still come',
        );
      },
    );

    test('confirm body that does not prove a send is not sent', () async {
      for (final body in <Map<String, dynamic>>[
        {},
        {'flow': 'dar', 'report': 'sr1'},
        {'flow': 'action', 'report': 'sr1', 'sent': 'sr1'},
        {'flow': 'dar', 'report': 'sr1', 'sent': 'other'},
      ]) {
        final m = mk();
        await m.begin('sr1');
        repo.confirmBody = body;
        expect(
          (await m.handle(link('?code=$code')))!.sent,
          isFalse,
          reason: '$body',
        );
      }
    });

    test('QA E2: INVALID_CODE while a send is pending → check Sent status, verifier kept', () async {
      final m = mk();
      await m.begin('sr1');
      repo.confirmError = ApiException(
        'This send result has expired or was already read.',
        status: 400,
        code: 'INVALID_CODE',
      );
      final r = (await m.handle(link('?code=$code')))!;
      expect((r.reportId, r.sent), ('sr1', false));
      expect(r.reason, DarSendResult.resultUnavailable);
      expect(
        darSendMessage(r.reason),
        "We couldn't confirm whether the report was sent. Check its Sent status before sending again.",
      );
      expect(store.map, isNotEmpty, reason: 'kept until a 200 or 10 minutes');
    });

    test('QA E2: a forged code first does not spoil the real result', () async {
      final m = mk();
      await m.begin('sr1');
      repo.confirmError = ApiException('x', status: 400, code: 'INVALID_CODE');
      final forged = (await m.handle(link('?code=forged-forged-forged-0000')))!;
      expect(forged.sent, isFalse);
      repo.confirmError = null;
      repo.confirmBody = {'flow': 'dar', 'report': 'sr1', 'sent': 'sr1'};
      final real = (await m.handle(link('?code=$code')))!;
      expect((real.reportId, real.sent), ('sr1', true));
      expect(repo.confirms.map((c) => c.$1), [
        'forged-forged-forged-0000',
        code,
      ]);
      expect(store.map, isEmpty, reason: 'cleared after the 200');
    });

    test('QA E2: no pending verifier (missing or already used) → check Sent status', () async {
      final m = mk();
      await m.begin('sr1');
      repo.confirmBody = {'flow': 'dar', 'report': 'sr1', 'sent': 'sr1'};
      expect((await m.handle(link('?code=$code')))!.sent, isTrue);
      final again = (await m.handle(link('?code=${code}2')))!;
      expect(again.reason, DarSendResult.resultUnavailable);
      expect(repo.confirms, hasLength(1));
      final none = (await mk().handle(link('?code=$code')))!;
      expect(none.reason, DarSendResult.resultUnavailable);
      expect(darSendMessage(none.reason), darResultUnavailable);
      expect(repo.confirms, isEmpty);
    });

    test('QA E1: a confirm for another report is not this send', () async {
      final m = mk();
      await m.begin('sr1');
      repo.confirmBody = {'flow': 'dar', 'report': 'other', 'sent': 'other'};
      final r = (await m.handle(link('?code=$code')))!;
      expect((r.reportId, r.sent), ('sr1', false));
      expect(r.reason, DarSendResult.resultUnavailable);
    });

    test('sent confirm with optional recipients (count or list)', () async {
      for (final (recipients, count, names) in <(Object?, int?, List<String>)>[
        (2, 2, []),
        (
          ['Queen Reyes', 'mark@xceler8.example'],
          2,
          ['Queen Reyes', 'mark@xceler8.example'],
        ),
        (null, null, []),
      ]) {
        final r = DarSendResult.fromConfirm({
          'flow': 'dar',
          'report': 'sr1',
          'sent': 'sr1',
          'recipients': ?recipients,
        }, startedReport: 'sr1');
        expect(r.sent, isTrue);
        expect(r.recipientCount, count);
        expect(r.recipientNames, names);
      }
    });

    test('the same code twice is tried once', () async {
      final m = mk();
      await m.begin('sr1');
      final both = await Future.wait([
        m.handle(link('?code=$code')),
        m.handle(link('?code=$code')),
      ]);
      expect(repo.confirms, hasLength(1));
      expect(both.whereType<DarSendResult>(), hasLength(1));
    });

    test(
      'verifier older than 10 minutes → Send expired, cleared, no confirm',
      () async {
        final m = mk();
        await m.begin('sr1');
        now = now.add(const Duration(minutes: 11));
        final r = (await m.handle(link('?code=$code')))!;
        expect(r.reason, DarSendResult.expired);
        expect(darSendMessage(r.reason), 'Send expired. Try again.');
        expect(store.map, isEmpty);
        expect(repo.confirms, isEmpty);
      },
    );

    test(
      'QA G1: other schemes, hosts and paths are ignored, verifier kept',
      () async {
        final m = mk();
        await m.begin('sr1');
        for (final u in [
          'opstrack://other/mail?code=x',
          'opstrack://ms/mail?code=x',
          'opstrack://auth/mailx?code=x',
          'opstrack://auth/?code=x',
          'myapp://auth/mail?code=x',
        ]) {
          expect(await m.handle(Uri.parse(u)), isNull, reason: u);
        }
        expect(
          isMailReturnLink(Uri.parse('opstrack://auth/mail?code=x')),
          isTrue,
        );
        expect(store.map, isNotEmpty);
        expect(repo.confirms, isEmpty);
      },
    );

    test('other links are ignored', () async {
      final m = mk();
      expect(
        await m.handle(Uri.parse('opstrack://auth/microsoft?code=x')),
        isNull,
      );
      expect(
        await m.handle(Uri.parse('opstrack://ms/send-result?sent=sr1')),
        isNull,
      );
      expect(await m.handle(Uri.parse('https://auth/mail?code=x')), isNull);
    });

    test('ApiDarSendRepository confirm/start bodies', () async {
      final calls = <http.Request>[];
      final api = ApiClient(
        'http://api.test/api/v1',
        client: MockClient((req) async {
          calls.add(req);
          return http.Response(
            jsonEncode(
              req.url.path.endsWith('/send/mobile')
                  ? {'url': 'https://login.microsoftonline.com/x'}
                  : {'flow': 'dar', 'report': 'sr1', 'sent': 'sr1'},
            ),
            200,
          );
        }),
      );
      final r = ApiDarSendRepository(api);
      await r.start('sr1', codeChallenge: 'chal');
      await r.confirm(code, codeVerifier: 'ver');
      expect(calls[0].url.path, '/api/v1/dar/saved/sr1/send/mobile');
      expect(jsonDecode(calls[0].body), {
        'code_challenge': 'chal',
        'code_challenge_method': 'S256',
      });
      expect(calls[1].url.path, '/api/v1/auth/mobile/mail/confirm');
      expect(jsonDecode(calls[1].body), {'code': code, 'code_verifier': 'ver'});
    });
    test('every reason has friendly copy; unknown → generic', () {
      for (final r in [
        'not_linked',
        'no_supervisor',
        'ms_disabled',
        'consent_declined',
        'admin_consent_required',
        'wrong_account',
        'not_found',
        'no_mailbox',
        'send_forbidden',
        'ms_auth_failed',
        'bad_recipient',
        'too_large',
        'graph_unavailable',
        'rate_limited',
      ]) {
        expect(darSendMessage(r), isNot(darSendMessage('weird')), reason: r);
      }
      expect(darSendMessage('not_linked'), darPasswordOnly);
      // QA G2: Lean's exact wording, not just the constant.
      expect(
        darPasswordOnly,
        'Link your Microsoft account to send emails. You can export this report on the web or notify your supervisor.',
      );
      expect(
        darSendMessage('no_supervisor'),
        'Ask an Admin to set your supervisor.',
      );
    });

    test('API errors: 429, NOTIFY_RECENT, SEND_UNAVAILABLE reason, 5xx', () {
      expect(
        darApiErrorMessage(
          ApiException('x', status: 429, code: 'RATE_LIMITED'),
        ),
        darRateLimited,
      );
      expect(
        darApiErrorMessage(
          ApiException('x', status: 409, code: 'NOTIFY_RECENT'),
        ),
        darNotifyRecent,
      );
      expect(
        darApiErrorMessage(
          ApiException(
            'x',
            status: 409,
            code: 'SEND_UNAVAILABLE',
            details: {'reason': 'not_linked'},
          ),
        ),
        darPasswordOnly,
      );
      expect(
        darApiErrorMessage(ApiException('boom', status: 503)),
        disconnectedMessage,
      );
    });
  });

  group('ApiDarSendRepository', () {
    late List<http.Request> calls;
    ApiClient api(Map<String, Object?> body, {int status = 200}) {
      calls = [];
      return ApiClient(
        'http://api.test/api/v1',
        client: MockClient((req) async {
          calls.add(req);
          return http.Response(jsonEncode(body), status);
        }),
      );
    }

    test('status parses to/cc', () async {
      final s = await ApiDarSendRepository(
        api({
          'enabled': true,
          'reason': null,
          'canNotify': false,
          'to': {'name': 'Queen', 'email': 'q@x.example'},
          'cc': ['a@x.example'],
        }),
      ).status();
      expect(calls.single.url.path, '/api/v1/dar/send-status');
      expect((s.enabled, s.to?.email), (true, 'q@x.example'));
      expect(s.cc, ['a@x.example']);
    });

    test('start POSTs to /send/mobile and returns the https URL', () async {
      final r = ApiDarSendRepository(
        api({'url': 'https://login.microsoftonline.com/x/authorize?state=s'}),
      );
      final u = await r.start('sr1', codeChallenge: 'c');
      expect(calls.single.method, 'POST');
      expect(calls.single.url.path, '/api/v1/dar/saved/sr1/send/mobile');
      expect(u.host, 'login.microsoftonline.com');
    });

    test('start rejects a non-https URL', () async {
      final r = ApiDarSendRepository(api({'url': 'javascript:alert(1)'}));
      expect(r.start('sr1', codeChallenge: 'c'), throwsA(isA<ApiException>()));
    });

    test('notify-supervisor', () async {
      final r = ApiDarSendRepository(api({'notified': true}));
      expect(await r.notifySupervisor('sr1'), isTrue);
      expect(calls.single.url.path, '/api/v1/dar/saved/sr1/notify-supervisor');
    });
  });

  group('saved report sent status (API PR #35)', () {
    Map<String, dynamic> j(Map<String, dynamic> extra) => {
      'id': 'sr1',
      'savedAt': '2026-10-20T09:00:00.000Z',
      'from': '2026-10-13',
      'to': '2026-10-19',
      'totalActivities': 3,
      'totalRendered': '08:00',
      ...extra,
    };
    test('unknown / not sent / sent', () {
      expect(SavedReport.fromJson(j({})).sentKnown, isFalse);
      final ns = SavedReport.fromJson(j({'sentAt': null}));
      expect((ns.sentKnown, sentStatusLabel(ns)), (true, 'Not sent'));
      final s = SavedReport.fromJson(
        j({'sentAt': '2026-10-21T01:52:00.000Z', 'sentRecipientCount': 2}),
      );
      expect(sentStatusLabel(s), contains('Sent · '));
      expect(sentStatusLabel(s), contains('09:52 AM (UTC+8) · 2 recipients'));
    });
  });

  test('QA D1: a non-JSON body is a friendly ApiException', () async {
    for (final status in [200, 404, 403]) {
      final api = ApiClient(
        'http://api.test/api/v1',
        client: MockClient(
          (_) async => http.Response('<html>Site stopped</html>', status),
        ),
      );
      await expectLater(
        api.get('/projects'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.message, 'message', unexpectedResponseMessage)
              .having((e) => e.status, 'status', status),
        ),
      );
    }
  });

  group('saved report detail: Send / Notify supervisor', () {
    late MockDarSendRepository repo;
    late List<Uri> launched;
    Future pump(WidgetTester tester, DarSendStatus st, {bool opens = true}) {
      repo = MockDarSendRepository(current: st);
      launched = [];
      return pumpApp(
        tester,
        location: '/dar/saved/sr1',
        overrides: [
          darSendRepositoryProvider.overrideWithValue(repo),
          externalLauncherProvider.overrideWithValue((u) async {
            launched.add(u);
            return opens;
          }),
        ],
      );
    }

    Future<void> showCard(WidgetTester tester) async {
      await tester.scrollUntilVisible(
        find.byKey(const Key('darSendCard')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
    }

    testWidgets('linked: To/CC confirm → browser → sent banner', (
      tester,
    ) async {
      final c = await pump(tester, _linked);
      await showCard(tester);
      expect(find.text('To: Queen Reyes · CC: 1'), findsOneWidget);
      await tester.tap(find.byKey(const Key('darSend')));
      await tester.pumpAndSettle();
      expect(
        find.text('To: Queen Reyes <queen@xceler8.example>'),
        findsOneWidget,
      );
      expect(find.text('CC: mark@xceler8.example'), findsOneWidget);
      await tester.tap(find.byKey(const Key('darSendContinue')));
      await tester.pumpAndSettle();
      expect(repo.started, ['sr1']);
      expect(launched.single.host, 'login.microsoftonline.com');
      expect(find.text('Waiting for Microsoft…'), findsOneWidget);
      // The return link is traded in with confirm; only that answer says "sent".
      final r = await c
          .read(darMailSendProvider)
          .handle(
            Uri.parse('opstrack://auth/mail?code=one-time-code-0123456789'),
          );
      expect(repo.confirms.single.$1, 'one-time-code-0123456789');
      c.read(darSendResultProvider.notifier).set(r);
      await tester.pumpAndSettle();
      expect(find.text('Sent.'), findsOneWidget);
      expect(find.text('Send'), findsOneWidget);
    });

    testWidgets('linked: send_error from Microsoft shows friendly copy', (
      tester,
    ) async {
      final c = await pump(tester, _linked);
      await showCard(tester);
      await tester.tap(find.byKey(const Key('darSend')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('darSendContinue')));
      await tester.pumpAndSettle();
      c
          .read(darSendResultProvider.notifier)
          .set(
            const DarSendResult(
              reportId: 'sr1',
              sent: false,
              reason: 'consent_declined',
            ),
          );
      await tester.pumpAndSettle();
      expect(find.textContaining("You didn't allow OpsTrack"), findsOneWidget);
    });

    for (final (recipients, text) in <(Object?, String)>[
      (3, 'Sent to 3 people.'),
      (1, 'Sent to 1 person.'),
      (0, 'Sent.'),
      (null, 'Sent.'),
    ]) {
      testWidgets('sent with recipients=$recipients shows "$text"', (
        tester,
      ) async {
        final c = await pump(tester, _linked);
        repo.confirmBody = {
          'flow': 'dar',
          'report': 'sr1',
          'sent': 'sr1',
          'recipients': ?recipients,
        };
        await showCard(tester);
        await tester.tap(find.byKey(const Key('darSend')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('darSendContinue')));
        await tester.pumpAndSettle();
        final r = await c
            .read(darMailSendProvider)
            .handle(
              Uri.parse('opstrack://auth/mail?code=one-time-code-0123456789'),
            );
        c.read(darSendResultProvider.notifier).set(r);
        await tester.pumpAndSettle();
        expect(find.text(text), findsOneWidget);
        expect(find.textContaining('Sent to 0'), findsNothing);
      });
    }

    testWidgets(
      'send_error with recipients:0 → error copy, never "Sent to 0"',
      (tester) async {
        final c = await pump(tester, _linked);
        repo.confirmBody = {
          'flow': 'dar',
          'report': 'sr1',
          'send_error': 'send_forbidden',
          'recipients': 0,
        };
        await showCard(tester);
        await tester.tap(find.byKey(const Key('darSend')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('darSendContinue')));
        await tester.pumpAndSettle();
        final r = await c
            .read(darMailSendProvider)
            .handle(
              Uri.parse('opstrack://auth/mail?code=one-time-code-0123456789'),
            );
        c.read(darSendResultProvider.notifier).set(r);
        await tester.pumpAndSettle();
        expect(find.text(darSendMessage('send_forbidden')), findsOneWidget);
        expect(find.textContaining('Sent to'), findsNothing);
        expect(find.text('Sent.'), findsNothing);
        expect(find.byKey(const Key('darSendInfo')), findsNothing);
      },
    );

    testWidgets('a forged link (no code) shows no result, never sent', (
      tester,
    ) async {
      final c = await pump(tester, _linked);
      await showCard(tester);
      await tester.tap(find.byKey(const Key('darSend')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('darSendContinue')));
      await tester.pumpAndSettle();
      final r = await c
          .read(darMailSendProvider)
          .handle(Uri.parse('opstrack://auth/mail?sent=sr1&report=sr1'));
      c.read(darSendResultProvider.notifier).set(r);
      await tester.pumpAndSettle();
      expect(find.text(darNoResult), findsOneWidget);
      expect(find.byKey(const Key('darSendInfo')), findsNothing);
      expect(repo.confirms, isEmpty);
    });

    testWidgets(
      'result_unavailable: copy + report refreshed so the badge updates',
      (tester) async {
        final c = await pump(tester, _linked);
        await showCard(tester);
        await tester.tap(find.byKey(const Key('darSend')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('darSendContinue')));
        await tester.pumpAndSettle();
        // Meanwhile the server recorded the send (as if the email did go out).
        final saved = c.read(mockTrackerStoreProvider).saved;
        final i = saved.indexWhere((r) => r.id == 'sr1');
        final o = saved[i];
        saved[i] = SavedReport(
          id: o.id,
          savedAt: o.savedAt,
          from: o.from,
          to: o.to,
          totalActivities: o.totalActivities,
          totalRendered: o.totalRendered,
          tag: o.tag,
          changedDates: o.changedDates,
          sentKnown: true,
          sentAt: DateTime.utc(2026, 10, 21, 2, 30),
          sentRecipientCount: 2,
        );
        final r = await c
            .read(darMailSendProvider)
            .handle(Uri.parse('opstrack://auth/mail?error=result_unavailable'));
        c.read(darSendResultProvider.notifier).set(r);
        await tester.pumpAndSettle();
        expect(find.text(darResultUnavailable), findsOneWidget);
        expect(find.byKey(const Key('darSendInfo')), findsNothing);
        expect(find.text(sentStatusLabel(saved[i])), findsOneWidget);
        expect(find.byKey(const Key('sentStatus_sr1')), findsOneWidget);
      },
    );

    testWidgets(
      'INVALID_CODE while pending → check Sent status, not Send expired',
      (tester) async {
        final c = await pump(tester, _linked);
        repo.confirmError = ApiException(
          'x',
          status: 400,
          code: 'INVALID_CODE',
        );
        await showCard(tester);
        await tester.tap(find.byKey(const Key('darSend')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('darSendContinue')));
        await tester.pumpAndSettle();
        final r = await c
            .read(darMailSendProvider)
            .handle(
              Uri.parse('opstrack://auth/mail?code=one-time-code-0123456789'),
            );
        c.read(darSendResultProvider.notifier).set(r);
        await tester.pumpAndSettle();
        expect(find.text(darResultUnavailable), findsOneWidget);
        expect(find.text('Send expired. Try again.'), findsNothing);
      },
    );

    testWidgets('a result for another report is ignored', (tester) async {
      final c = await pump(tester, _linked);
      await showCard(tester);
      c
          .read(darSendResultProvider.notifier)
          .set(const DarSendResult(reportId: 'other', sent: true));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('darSendInfo')), findsNothing);
    });

    testWidgets('closed browser without a result → may not have been sent', (
      tester,
    ) async {
      await pump(tester, _linked);
      await showCard(tester);
      await tester.tap(find.byKey(const Key('darSend')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('darSendContinue')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('darSendCancelWait')));
      await tester.pumpAndSettle();
      expect(find.text(darNoResult), findsOneWidget);
    });

    testWidgets('429 on start → rate-limited copy', (tester) async {
      await pump(tester, _linked);
      repo.startError = ApiException('Too many', status: 429);
      await showCard(tester);
      await tester.tap(find.byKey(const Key('darSend')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('darSendContinue')));
      await tester.pumpAndSettle();
      expect(find.text(darRateLimited), findsOneWidget);
      expect(launched, isEmpty);
    });

    testWidgets('not linked: copy + Notify supervisor (+ NOTIFY_RECENT)', (
      tester,
    ) async {
      await pump(
        tester,
        const DarSendStatus(
          enabled: false,
          reason: 'not_linked',
          canNotify: true,
          to: (name: 'Queen Reyes', email: 'queen@xceler8.example'),
        ),
      );
      await showCard(tester);
      expect(find.text(darPasswordOnly), findsOneWidget);
      expect(find.byKey(const Key('darSend')), findsNothing);
      await tester.tap(find.byKey(const Key('darNotifySupervisor')));
      await tester.pumpAndSettle();
      expect(repo.notified, ['sr1']);
      expect(
        find.text('Queen Reyes was notified that this report is ready.'),
        findsOneWidget,
      );
      repo.notifyError = ApiException('x', status: 409, code: 'NOTIFY_RECENT');
      await tester.tap(find.byKey(const Key('darNotifySupervisor')));
      await tester.pumpAndSettle();
      expect(find.text(darNotifyRecent), findsOneWidget);
    });

    testWidgets('no supervisor: ask an Admin, no buttons', (tester) async {
      await pump(
        tester,
        const DarSendStatus(enabled: false, reason: 'no_supervisor'),
      );
      await showCard(tester);
      expect(find.text('Ask an Admin to set your supervisor.'), findsOneWidget);
      expect(find.byKey(const Key('darSend')), findsNothing);
      expect(find.byKey(const Key('darNotifySupervisor')), findsNothing);
    });

    testWidgets('Microsoft off: export-on-web copy', (tester) async {
      await pump(
        tester,
        const DarSendStatus(enabled: false, reason: 'ms_disabled'),
      );
      await showCard(tester);
      expect(find.text(darMsDisabled), findsOneWidget);
    });
  });
}
