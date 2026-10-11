// Xceler8 PM — Material 3 theme from the pm-mobile-design handoff (flutter_theme.dart),
// adapted to the app's domain enums.
import 'package:flutter/material.dart';

import '../data/models.dart';

const _seed = Color(0xFF3F51B5); // indigo

/// A container/on-container pair used for status chips and badges.
@immutable
class StatusPair {
  final Color container;
  final Color onContainer;
  const StatusPair(this.container, this.onContainer);
  static StatusPair lerp(StatusPair a, StatusPair b, double t) =>
      StatusPair(Color.lerp(a.container, b.container, t)!, Color.lerp(a.onContainer, b.onContainer, t)!);
}

@immutable
class StatusColors extends ThemeExtension<StatusColors> {
  final StatusPair todo, inProgress, blocked, forReview, done, planning;
  const StatusColors({
    required this.todo,
    required this.inProgress,
    required this.blocked,
    required this.forReview,
    required this.done,
    required this.planning,
  });

  static const light = StatusColors(
    todo: StatusPair(Color(0xFFE4E1EC), Color(0xFF46464F)),
    inProgress: StatusPair(Color(0xFFD6E3FF), Color(0xFF0B4DAA)),
    blocked: StatusPair(Color(0xFFFFDAD6), Color(0xFF93000A)),
    forReview: StatusPair(Color(0xFFFFDDB3), Color(0xFF7A4800)),
    done: StatusPair(Color(0xFFC3EFCB), Color(0xFF0B6B2E)),
    planning: StatusPair(Color(0xFFEADDFF), Color(0xFF5A3D99)),
  );
  static const dark = StatusColors(
    todo: StatusPair(Color(0xFF34343C), Color(0xFFC6C5D0)),
    inProgress: StatusPair(Color(0xFF00468F), Color(0xFFD6E3FF)),
    blocked: StatusPair(Color(0xFF93000A), Color(0xFFFFDAD6)),
    forReview: StatusPair(Color(0xFF5C3600), Color(0xFFFFDDB3)),
    done: StatusPair(Color(0xFF00531F), Color(0xFFC3EFCB)),
    planning: StatusPair(Color(0xFF42277F), Color(0xFFEADDFF)),
  );

  StatusPair forStatus(TaskStatus s) => switch (s) {
    TaskStatus.todo => todo,
    TaskStatus.inProgress => inProgress,
    TaskStatus.blocked => blocked,
    TaskStatus.forReview => forReview,
    TaskStatus.done => done,
    TaskStatus.cancelled => todo,
  };
  StatusPair forProject(ProjectStatus s) => switch (s) {
    ProjectStatus.planning => planning,
    ProjectStatus.active => done,
    ProjectStatus.onHold => forReview,
    ProjectStatus.completed => todo,
    ProjectStatus.other => todo,
  };
  StatusPair forPriority(Priority p) => switch (p) {
    Priority.low => todo,
    Priority.medium => inProgress,
    Priority.high => forReview,
    Priority.critical => blocked,
  };

  @override
  StatusColors copyWith({
    StatusPair? todo,
    StatusPair? inProgress,
    StatusPair? blocked,
    StatusPair? forReview,
    StatusPair? done,
    StatusPair? planning,
  }) => StatusColors(
    todo: todo ?? this.todo,
    inProgress: inProgress ?? this.inProgress,
    blocked: blocked ?? this.blocked,
    forReview: forReview ?? this.forReview,
    done: done ?? this.done,
    planning: planning ?? this.planning,
  );

  @override
  StatusColors lerp(ThemeExtension<StatusColors>? other, double t) {
    if (other is! StatusColors) return this;
    return StatusColors(
      todo: StatusPair.lerp(todo, other.todo, t),
      inProgress: StatusPair.lerp(inProgress, other.inProgress, t),
      blocked: StatusPair.lerp(blocked, other.blocked, t),
      forReview: StatusPair.lerp(forReview, other.forReview, t),
      done: StatusPair.lerp(done, other.done, t),
      planning: StatusPair.lerp(planning, other.planning, t),
    );
  }
}

/// 8pt spacing tokens.
abstract final class Space {
  static const xs = 4.0, s = 8.0, m = 16.0, l = 24.0, xl = 32.0, xxl = 48.0;
}

abstract final class AppTheme {
  static ThemeData get light => _build(Brightness.light);
  static ThemeData get dark => _build(Brightness.dark);

  static ThemeData _build(Brightness b) {
    final scheme = ColorScheme.fromSeed(seedColor: _seed, brightness: b);
    const text = TextTheme(
      displaySmall: TextStyle(fontSize: 36, fontWeight: FontWeight.w400, height: 1.22),
      headlineMedium: TextStyle(fontSize: 28, fontWeight: FontWeight.w400, height: 1.29),
      titleLarge: TextStyle(fontSize: 22, fontWeight: FontWeight.w400, height: 1.27),
      titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, height: 1.5, letterSpacing: .15),
      bodyLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w400, height: 1.5),
      bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w400, height: 1.43),
      labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, letterSpacing: .1),
      labelMedium: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, letterSpacing: .5),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: 'Roboto',
      textTheme: text.apply(bodyColor: scheme.onSurface, displayColor: scheme.onSurface),
      scaffoldBackgroundColor: scheme.surface,
      extensions: [b == Brightness.light ? StatusColors.light : StatusColors.dark],
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        scrolledUnderElevation: 3,
        centerTitle: false,
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 80,
        backgroundColor: scheme.surfaceContainer,
        indicatorColor: scheme.secondaryContainer,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      chipTheme: ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: scheme.primaryContainer,
        foregroundColor: scheme.onPrimaryContainer,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
      ),
      inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: scheme.surfaceContainerHighest),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      ),
      listTileTheme: const ListTileThemeData(contentPadding: EdgeInsets.symmetric(horizontal: 16)),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant, space: 1),
    );
  }
}

/// Status chip used across lists, board cards and task detail.
class StatusChip extends StatelessWidget {
  final String label;
  final StatusPair colors;
  const StatusChip({super.key, required this.label, required this.colors});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(color: colors.container, borderRadius: BorderRadius.circular(8)),
    child: Text(label, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: colors.onContainer)),
  );
}
