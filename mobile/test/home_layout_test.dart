import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/ui/widgets/kpi.dart';

import 'helpers.dart';
import 'v2_p1_test.dart' show seek;

void main() {
  List<Rect> rects(WidgetTester t) => [
    for (final e in find.byType(KpiCard).evaluate())
      t.getRect(find.byWidget(e.widget)),
  ];
  void grid(List<Rect> g) {
    expect(g.length, 4);
    expect(g[0].left, 16);
    expect(390 - g[1].right, 16);
    expect(g[1].left - g[0].right, 12); // column gutter
    expect(g[2].top - g[0].bottom, 12); // row gap
  }

  Future<void> checkGrid(WidgetTester t) async {
    final task = rects(t).sublist(0, 4);
    grid(task);
    final due = t.getTopLeft(find.text('Due soon')).dx;
    await seek(t, find.byKey(const Key('dashOpenIssues')), 'homeScreen');
    final port = rects(t)
        .where((r) => r.top > task.last.bottom || true)
        .toList();
    final p = port.sublist(port.length - 4);
    grid(p);
    expect(p[0].width, task[0].width);
    expect(p[0].height, moreOrLessEquals(task[0].height, epsilon: 0.01));
    expect(t.getTopLeft(find.text('Portfolio')).dx, due);
  }

  for (final dark in [false, true]) {
    testWidgets(
      'Home: shared KPI grid, aligned headers (${dark ? 'dark' : 'light'})',
      (t) async {
        await pumpApp(
          t,
          location: '/home',
          themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        );
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile('goldens/home_${dark ? 'dark' : 'light'}.png'),
        );
        await checkGrid(t);
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile(
            'goldens/home_portfolio_${dark ? 'dark' : 'light'}.png',
          ),
        );
      },
    );
  }

  testWidgets('Home at 2x text: one column, no overflow', (t) async {
    t.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpApp(t, location: '/home');
    await seek(t, find.byKey(const Key('dashActive')), 'homeScreen');
    final r = [
      for (final e in find.byType(KpiCard).evaluate())
        t.getRect(find.byWidget(e.widget)),
    ];
    expect(r.every((x) => x.left == 16 && x.width == 390 - 32), isTrue);
    expect(t.takeException(), isNull);
  });
}
