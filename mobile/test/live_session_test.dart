import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xc8_pm/app.dart';
import 'package:xc8_pm/config.dart';
import 'package:xc8_pm/data/api_client.dart';
import 'package:xc8_pm/data/models.dart';
import 'package:xc8_pm/router.dart';
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
    if (status500 > 0)
      return http.Response(
        '{"error":{"message":"boom"}}',
        status500,
        headers: h,
      );
    final p = req.url.path.replaceFirst('/api/v1', '');
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
    if (p == '/auth/me')
      return http.Response(jsonEncode({'user': _user}), 200, headers: h);
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
    test('mobile header, cookie persisted, sliding 3-day window', () async {
      final f = FakeApi();
      final store = MemorySessionStore();
      var now = device();
      final api = ApiClient(
        base,
        client: f.client,
        store: store,
        deviceClock: () => now,
      );
      await api.post('/auth/login', {'email': 'a', 'password': 'right'});
      expect(f.headers.last['X-Client'], 'mobile');
      expect(store.value!.cookies['xc8_sid'], 'tok123');
      // 2 days later: still valid, and a call slides the window.
      now = now.add(const Duration(days: 2));
      final api2 = ApiClient(
        base,
        client: f.client,
        store: store,
        deviceClock: () => now,
      );
      expect(await api2.restoreSession(), isTrue);
      await api2.get('/auth/me');
      expect(f.headers.last['Cookie'], 'xc8_sid=tok123');
      expect(store.value!.lastActive, now.toUtc());
      // 3 days + 1 minute of inactivity: back to sign-in.
      now = now.add(const Duration(days: 3, minutes: 1));
      final api3 = ApiClient(
        base,
        client: f.client,
        store: store,
        deviceClock: () => now,
      );
      expect(await api3.restoreSession(), isFalse);
      expect(store.value, isNull);
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

// Keep the import used.
typedef _U = AppUser;
