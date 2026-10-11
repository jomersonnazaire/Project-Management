import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/app.dart';
import 'package:xc8_pm/data/mock_repositories.dart';
import 'package:xc8_pm/data/repositories.dart';
import 'package:xc8_pm/router.dart';
import 'package:xc8_pm/state/providers.dart';

/// Pumps the full app at the design size (390x844) on mock repositories.
Future<ProviderContainer> pumpApp(
  WidgetTester tester, {
  bool signedIn = true,
  String? location,
  ThemeMode themeMode = ThemeMode.light,
}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final store = MockStore();
  final container = ProviderContainer(
    overrides: [
      mockStoreProvider.overrideWithValue(store),
      authRepositoryProvider.overrideWithValue(MockAuthRepository(signedIn: signedIn)),
      clockProvider.overrideWithValue(() => DateTime(2026, 10, 11, 14)),
    ],
  );
  addTearDown(container.dispose);
  container.read(themeModeProvider.notifier).set(themeMode);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const XceleratePmApp()));
  await tester.pumpAndSettle();
  if (location != null) {
    container.read(routerProvider).go(location);
    await tester.pumpAndSettle();
  }
  return container;
}

MockStore storeOf(ProviderContainer c) => c.read(mockStoreProvider);
TaskRepository tasksOf(ProviderContainer c) => c.read(taskRepositoryProvider);
