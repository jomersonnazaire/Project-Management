import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xc8_pm/app.dart';
import 'package:xc8_pm/config.dart';
import 'package:xc8_pm/data/api_client.dart';
import 'package:xc8_pm/data/api_repositories.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/router.dart';
import 'package:xc8_pm/ui/v3/insights.dart' show dueText;
import 'package:xc8_pm/data/session_store.dart';
import 'package:xc8_pm/state/providers.dart';
import 'package:xc8_pm/state/v2_providers.dart';

const base = 'http://api.test/api/v1';
final serverTime = DateTime.utc(2026, 10, 11, 5, 0, 0); // 13:00 PH
String httpDate(DateTime d) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const mons = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  String two(int n) => n.toString().padLeft(2, '0');
  return '${days[d.weekday - 1]}, ${two(d.day)} ${mons[d.month - 1]} ${d.year} '
      '${two(d.hour)}:${two(d.minute)}:${two(d.second)} GMT';
}

/// A tiny fake m8-polish API.
class FakeApi {
  bool up = true;
  bool loggedIn = true;
  int status500 = 0;
  bool mobileApi = true;
  bool mobileOnly = false;
  final pathStatus = <String, int>{};
  final calls = <String>[];
  final headers = <Map<String, String>>[];
  late final client = MockClient((req) async {
    calls.add('${req.method} ${req.url.path.replaceFirst('/api/v1', '')}');
    headers.add(req.headers);
    if (!up) throw http.ClientException('Failed host lookup');
    final h = {
      'content-type': 'application/json',
      'date': httpDate(serverTime),
    };
    if (status500 > 0) {
      return http.Response(
        '{"error":{"message":"boom"}}',
        status500,
        headers: h,
      );
    }
    final p = req.url.path.replaceFirst('/api/v1', '');
    final forced = pathStatus[p];
    if (forced != null) {
      return http.Response(
        jsonEncode({
          'error': {
            'code': forced == 403
                ? (mobileOnly ? 'MOBILE_ONLY' : 'FORBIDDEN')
                : 'X',
            'message': "You don't have permission to do this.",
          },
        }),
        forced,
        headers: h,
      );
    }
    if (p.startsWith('/auth/mobile/') && !mobileApi) {
      return http.Response(
        '{"error":{"code":"NOT_FOUND","message":"Not found."}}',
        404,
        headers: h,
      );
    }
    final auth = req.headers['Authorization'];
    if (auth != null && req.headers['Cookie'] != null) {
      return http.Response(
        '{"error":{"code":"UNAUTHENTICATED"}}',
        401,
        headers: h,
      );
    }
    if (p == '/auth/mobile/login') {
      final b = jsonDecode(req.body) as Map;
      if (b['password'] != 'right') {
        return http.Response(
          '{"error":{"code":"INVALID_CREDENTIALS","message":"Email or password is incorrect."}}',
          401,
          headers: h,
        );
      }
      loggedIn = true;
      return http.Response(
        jsonEncode({
          'user': _user,
          'token': 'devtok-abcdefghijklmnopqrstuvwxyz',
          'expiresAt': serverTime
              .add(const Duration(days: 3))
              .toIso8601String(),
        }),
        200,
        headers: h,
      );
    }
    if (p == '/auth/mobile/refresh' && loggedIn) {
      if (auth == null) {
        return http.Response(
          '{"error":{"code":"MOBILE_ONLY"}}',
          403,
          headers: h,
        );
      }
      return http.Response(
        jsonEncode({
          'user': _user,
          'permissions': {},
          'expiresAt': serverTime
              .add(const Duration(days: 3))
              .toIso8601String(),
        }),
        200,
        headers: h,
      );
    }
    if (p == '/auth/login') {
      final b = jsonDecode(req.body) as Map;
      if (b['password'] != 'right') {
        return http.Response(
          '{"error":{"code":"INVALID_CREDENTIALS","message":"Email or password is incorrect."}}',
          401,
          headers: h,
        );
      }
      loggedIn = true;
      return http.Response(
        jsonEncode({'user': _user}),
        200,
        headers: {...h, 'set-cookie': 'xc8_sid=tok123; Path=/; HttpOnly'},
      );
    }
    if (!loggedIn) {
      return http.Response(
        '{"error":{"code":"SESSION_EXPIRED","message":"Your session expired. Please sign in again."}}',
        401,
        headers: h,
      );
    }
    if (p == '/auth/me') {
      return http.Response(jsonEncode({'user': _user}), 200, headers: h);
    }
    if (p == '/auth/me/permissions') {
      return http.Response(
        jsonEncode({'role': 'PROJECT_MANAGER', 'permissions': {}}),
        200,
        headers: h,
      );
    }
    if (p == '/tasks/x') {
      return http.Response(
        jsonEncode({
          'error': {
            'code': 'VALIDATION',
            'message': 'Invalid',
            'details': [
              {'path': 'name', 'message': 'Task name is required.'},
            ],
          },
        }),
        422,
        headers: h,
      );
    }
    if (p == '/tracker/running') {
      return http.Response(
        jsonEncode({'entry': null, 'now': serverTime.toIso8601String()}),
        200,
        headers: h,
      );
    }
    return http.Response('{"items":[]}', 200, headers: h);
  });
}

const _user = {
  'id': 'u1',
  'name': 'Jomerson Nazaire',
  'email': 'pm@x.test',
  'systemRole': 'PROJECT_MANAGER',
};

void main() {
  // Device clock 10 minutes behind the server.
  DateTime device() => serverTime.subtract(const Duration(minutes: 10));

  group('ApiClient', () {
    test('mobile sign-in: body token as bearer, stored securely, no X-Client, no cookie', () async {
      final f = FakeApi();
      final store = MemorySessionStore();
      final api = ApiClient(
        base,
        client: f.client,
        store: store,
        deviceClock: device,
      );
      final u = await ApiAuthRepository(api).login('a@x', 'right');
      expect(u.name, 'Jomerson Nazaire');
      expect(f.calls.last, 'POST /auth/mobile/login');
      expect(f.headers.last.containsKey('X-Client'), isFalse);
      expect(store.value!.cookies[ApiClient.bearerKey], startsWith('devtok-'));
      await api.get('/auth/me');
      expect(f.headers.last['Authorization'], startsWith('Bearer devtok-'));
      expect(f.headers.last.containsKey('Cookie'), isFalse);
    });

    test(
      'restart refreshes the session; offline time never signs out locally',
      () async {
        final f = FakeApi();
        final store = MemorySessionStore();
        await ApiAuthRepository(
          ApiClient(base, client: f.client, store: store, deviceClock: device),
        ).login('a@x', 'right');
        // 10 days later (e.g. offline the whole time): still restored; the server decides.
        DateTime later() => device().add(const Duration(days: 10));
        final api = ApiClient(
          base,
          client: f.client,
          store: store,
          deviceClock: later,
        );
        final repo = ApiAuthRepository(api);
        expect((await repo.currentUser())?.id, 'u1');
        expect(f.calls.last, 'POST /auth/mobile/refresh');
        // Server says expired → sign-in.
        f.loggedIn = false;
        expect(await repo.currentUser(), isNull);
        expect(store.value, isNull);
      },
    );

    test(
      'live sign-in with a wrong password fails and stores nothing',
      () async {
        final f = FakeApi()..loggedIn = false;
        final store = MemorySessionStore();
        final api = ApiClient(
          base,
          client: f.client,
          store: store,
          deviceClock: device,
        );
        await expectLater(
          ApiAuthRepository(api).login('a@x', 'rights'),
          throwsA(isA<ApiException>().having((e) => e.status, 's', 401)),
        );
        expect(f.calls.last, 'POST /auth/mobile/login');
        expect(store.value, isNull);
        expect(api.bearer, isNull);
      },
    );

    test('403 MOBILE_ONLY falls back to the cookie sign-in, not "disconnected"', () async {
      final f = FakeApi()..pathStatus['/auth/mobile/login'] = 403;
      final api = ApiClient(
        base,
        client: f.client,
        store: MemorySessionStore(),
        deviceClock: device,
      );
      // pathStatus answers code FORBIDDEN; simulate the API's MOBILE_ONLY code.
      f.mobileOnly = true;
      final u = await ApiAuthRepository(api).login('a@x', 'right');
      expect(u.id, 'u1');
      expect(f.calls.last, 'POST /auth/login');
    });

    test('stored token but refresh route gone (404): falls back to /auth/me, not disconnected', () async {
      final f = FakeApi();
      final store = MemorySessionStore();
      await ApiAuthRepository(
        ApiClient(base, client: f.client, store: store, deviceClock: device),
      ).login('a@x', 'right');
      f.mobileApi = false;
      final api = ApiClient(
        base,
        client: f.client,
        store: store,
        deviceClock: device,
      );
      expect((await ApiAuthRepository(api).currentUser())?.id, 'u1');
      expect(f.calls.last, 'GET /auth/me');
    });

    test('older API without /auth/mobile/*: falls back to the standard cookie session', () async {
      final f = FakeApi()..mobileApi = false;
      final store = MemorySessionStore();
      final api = ApiClient(
        base,
        client: f.client,
        store: store,
        deviceClock: device,
      );
      await ApiAuthRepository(api).login('a@x', 'right');
      expect(f.calls.sublist(f.calls.length - 2), [
        'POST /auth/mobile/login',
        'POST /auth/login',
      ]);
      expect(store.value!.cookies['xc8_sid'], 'tok123');
      expect(api.bearer, isNull);
      expect((await ApiAuthRepository(api).currentUser())?.id, 'u1');
      expect(f.calls.last, 'GET /auth/me');
    });

    test('401 signs out; offline and 5xx keep the session', () async {
      final f = FakeApi();
      final store = MemorySessionStore()
        ..value = StoredSession({'xc8_sid': 't'}, device());
      final api = ApiClient(
        base,
        client: f.client,
        store: store,
        deviceClock: device,
      );
      final reach = <bool>[];
      var signedOut = 0;
      api.onReachability = reach.add;
      api.onUnauthorized = () => signedOut++;
      await api.restoreSession();
      f.up = false;
      await expectLater(
        api.get('/auth/me'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'm',
            disconnectedMessage,
          ),
        ),
      );
      f.up = true;
      f.status500 = 503;
      await expectLater(
        api.get('/auth/me'),
        throwsA(isA<ApiException>().having((e) => e.code, 'c', 'SERVER_ERROR')),
      );
      expect(store.value, isNotNull);
      expect(signedOut, 0);
      expect(reach, [false, false]);
      f.status500 = 0;
      f.loggedIn = false;
      await expectLater(api.get('/auth/me'), throwsA(isA<ApiException>()));
      expect(signedOut, 1);
      expect(store.value, isNull);
    });

    test('422 details map to fields', () async {
      final api = ApiClient(
        base,
        client: FakeApi().client,
        deviceClock: device,
      );
      await expectLater(
        api.patch('/tasks/x', {}),
        throwsA(
          isA<ApiException>().having(
            (e) => e.fields['name'],
            'f',
            'Task name is required.',
          ),
        ),
      );
    });

    test(
      'server clock from the Date header and tracker now, not the device',
      () async {
        final api = ApiClient(
          base,
          client: FakeApi().client,
          deviceClock: device,
        );
        expect(api.serverNow(), device());
        await api.get('/anything');
        expect(api.serverNow(), serverTime);
        api.observeServerNow(serverTime.add(const Duration(milliseconds: 400)));
        expect(
          api.serverNow(),
          serverTime.add(const Duration(milliseconds: 400)),
        );
      },
    );
  });

  group('live app', () {
    setUp(() => AppConfig.debugApiBaseUrl = base);
    tearDown(() => AppConfig.debugApiBaseUrl = null);

    Future<ProviderContainer> boot(
      WidgetTester t,
      FakeApi f,
      MemorySessionStore store,
    ) async {
      t.view.physicalSize = const Size(390, 844);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.reset);
      final c = ProviderContainer(
        retry: noAutoRetry,
        overrides: [
          sessionStoreProvider.overrideWithValue(store),
          deviceClockProvider.overrideWithValue(device),
          apiClientProvider.overrideWith((ref) {
            final api = ApiClient(
              base,
              client: f.client,
              store: store,
              deviceClock: device,
            );
            api.onUnauthorized = () => Future(() {
              try {
                ref.read(authProvider.notifier).sessionEnded();
              } catch (_) {}
            });
            api.onReachability = (ok) => Future.microtask(
              () => ref.read(connectionProvider.notifier).set(ok),
            );
            return api;
          }),
          tickerProvider.overrideWith((ref) => Stream.value(0)),
        ],
      );
      addTearDown(c.dispose);
      await t.pumpWidget(
        UncontrolledProviderScope(container: c, child: const XceleratePmApp()),
      );
      await t.pumpAndSettle();
      return c;
    }

    testWidgets(
      'restart with a stored session stays signed in; no demo banner',
      (t) async {
        final f = FakeApi();
        final store = MemorySessionStore()
          ..value = StoredSession({'xc8_sid': 'tok123'}, device());
        final c = await boot(t, f, store);
        expect(c.read(authProvider).value?.name, 'Jomerson Nazaire');
        expect(find.byKey(const Key('loginScreen')), findsNothing);
        expect(find.byKey(const Key('demoBanner')), findsNothing);
        // Resume refreshes the session.
        final before = f.calls.where((x) => x == 'GET /auth/me').length;
        await c.read(authProvider.notifier).refreshSession();
        expect(f.calls.where((x) => x == 'GET /auth/me').length, before + 1);
      },
    );

    testWidgets('no stored session → sign in', (t) async {
      final c = await boot(t, FakeApi(), MemorySessionStore());
      expect(c.read(authProvider).value, isNull);
      expect(
        c.read(routerProvider).routerDelegate.currentConfiguration.uri.path,
        '/login',
      );
    });

    testWidgets(
      'start offline: Disconnected screen, Retry signs back in, session kept',
      (t) async {
        final f = FakeApi()..up = false;
        final store = MemorySessionStore()
          ..value = StoredSession({'xc8_sid': 'tok123'}, device());
        await boot(t, f, store);
        expect(find.byKey(const Key('disconnectedScreen')), findsOneWidget);
        expect(find.text(disconnectedMessage), findsWidgets);
        expect(store.value, isNotNull);
        f.up = true;
        await t.tap(find.byKey(const Key('disconnectedScreenRetry')));
        await t.pumpAndSettle();
        expect(find.byKey(const Key('disconnectedScreen')), findsNothing);
        expect(find.byKey(const Key('disconnectedBanner')), findsNothing);
      },
    );

    testWidgets(
      'server goes down while signed in: banner, not logged out; 401 logs out',
      (t) async {
        final f = FakeApi();
        final store = MemorySessionStore()
          ..value = StoredSession({'xc8_sid': 'tok123'}, device());
        final c = await boot(t, f, store);
        f.status500 = 502;
        await c.read(authProvider.notifier).refreshSession();
        await t.pumpAndSettle();
        expect(find.byKey(const Key('disconnectedBanner')), findsOneWidget);
        expect(c.read(authProvider).value, isNotNull);
        f.status500 = 0;
        await t.tap(find.byKey(const Key('disconnectedRetry')));
        await t.pumpAndSettle();
        expect(find.byKey(const Key('disconnectedBanner')), findsNothing);
        f.loggedIn = false;
        await c.read(authProvider.notifier).refreshSession();
        await t.pumpAndSettle();
        expect(c.read(authProvider).value, isNull);
        expect(store.value, isNull);
      },
    );

    testWidgets('timer and today use server time', (t) async {
      final f = FakeApi();
      final store = MemorySessionStore()
        ..value = StoredSession({'xc8_sid': 'tok123'}, device());
      final c = await boot(t, f, store);
      await c.read(apiClientProvider).get('/tracker/running');
      expect(c.read(nowProvider)(), serverTime);
      expect(c.read(clockProvider)(), DateTime(2026, 10, 11, 13));
    });
  });

  group('error states (no auto-retry)', () {
    setUp(() => AppConfig.debugApiBaseUrl = base);
    tearDown(() => AppConfig.debugApiBaseUrl = null);

    Future<void> open(WidgetTester t, FakeApi f, String loc) async {
      t.view.physicalSize = const Size(390, 844);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.reset);
      final store = MemorySessionStore()
        ..value = StoredSession({'xc8_sid': 'tok123'}, device());
      final c = ProviderContainer(
        retry: noAutoRetry,
        overrides: [
          sessionStoreProvider.overrideWithValue(store),
          apiClientProvider.overrideWith((ref) {
            final api = ApiClient(
              base,
              client: f.client,
              store: store,
              deviceClock: device,
            );
            api.onReachability = (ok) => Future.microtask(
              () => ref.read(connectionProvider.notifier).set(ok),
            );
            return api;
          }),
          tickerProvider.overrideWith((ref) => Stream.value(0)),
        ],
      );
      addTearDown(c.dispose);
      await t.pumpWidget(
        UncontrolledProviderScope(container: c, child: const XceleratePmApp()),
      );
      await t.pumpAndSettle();
      c.read(routerProvider).go(loc);
      await t.pumpAndSettle();
    }

    testWidgets('403 shows "You don\'t have access" after a single request', (
      t,
    ) async {
      final f = FakeApi()..pathStatus['/projects'] = 403;
      await open(t, f, '/projects');
      for (var i = 0; i < 60; i++) {
        await t.pump(const Duration(seconds: 1));
      }
      expect(find.textContaining("You don't have access"), findsOneWidget);
      expect(f.calls.where((c) => c == 'GET /projects').length, 1);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('5xx shows the error state with Retry, not a spinner', (
      t,
    ) async {
      final f = FakeApi()..pathStatus['/projects'] = 503;
      await open(t, f, '/projects');
      await t.pump(const Duration(seconds: 30));
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byKey(const Key('asyncError')), findsOneWidget);
      expect(f.calls.where((c) => c == 'GET /projects').length, 1);
      f.pathStatus.clear();
      await t.tap(find.widgetWithText(TextButton, 'Retry').last);
      await t.pumpAndSettle();
      expect(find.byKey(const Key('asyncError')), findsNothing);
      expect(f.calls.where((c) => c == 'GET /projects').length, 2);
    });
  });

  test('due text matches the web (negative = not yet due)', () {
    expect(dueText(-19), 'Due in 19 days');
    expect(dueText(-1), 'Due in 1 day');
    expect(dueText(0), 'Due today');
    expect(dueText(1), '1 day overdue');
    expect(dueText(3), '3 days overdue');
  });

  test('role line uses labels, no duplicates', () {
    AppUser u(String s, [String? j]) =>
        AppUser.fromJson({'id': '1', 'systemRole': s, 'jobRole': ?j});
    expect(u('PROJECT_MANAGER', 'PROJECT_MANAGER').role, 'Project Manager');
    expect(u('MEMBER', 'SAP consultant').role, 'Member · SAP consultant');
  });

  testWidgets('demo mode shows the Demo mode banner', (t) async {
    final c = ProviderContainer();
    addTearDown(c.dispose);
    await t.pumpWidget(
      UncontrolledProviderScope(container: c, child: const XceleratePmApp()),
    );
    await t.pumpAndSettle();
    expect(find.byKey(const Key('demoBanner')), findsOneWidget);
    expect(find.textContaining('Demo mode'), findsOneWidget);
  });
}
