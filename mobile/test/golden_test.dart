@Tags(['golden'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

/// Goldens at 390x844. Regenerate with: flutter test --update-goldens test/golden_test.dart
/// Text renders with the test font (Ahem boxes), so these catch layout regressions, not typography.
void main() {
  const screens = {
    'login': '/login',
    'home': '/home',
    'board': '/projects/p1?tab=board',
    'task_detail': '/tasks/t4',
    'log_time': '/log',
    'my_tasks': '/tasks',
    'day_timesheet': '/day',
    'dar': '/dar',
    'projects': '/projects',
  };
  for (final e in screens.entries) {
    testWidgets('golden ${e.key}', (tester) async {
      await pumpApp(
        tester,
        signedIn: e.key != 'login',
        location: e.key == 'login' ? null : e.value,
      );
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/${e.key}.png'),
      );
    });
  }
  testWidgets('golden day timesheet dark', (tester) async {
    await pumpApp(tester, location: '/day', themeMode: ThemeMode.dark);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/day_timesheet_dark.png'),
    );
  });
  testWidgets('golden home dark', (tester) async {
    await pumpApp(tester, location: '/home', themeMode: ThemeMode.dark);
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/home_dark.png'),
    );
  });
}
