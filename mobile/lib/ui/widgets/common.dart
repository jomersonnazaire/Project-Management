import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../theme/app_theme.dart';

const _months = [
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

/// Indexed by DateTime.weekday - 1 (Monday first).
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
String fmtDate(DateTime? d) =>
    d == null ? '—' : '${_months[d.month - 1]} ${d.day}';
String fmtShort(DateTime? d) => d == null
    ? '—'
    : '${_months[d.month - 1]} ${d.day.toString().padLeft(2, '0')}';
String fmtHours(double h) => h == h.roundToDouble() ? '${h.toInt()}' : '$h';

extension StatusColorsX on BuildContext {
  StatusColors get statusColors => Theme.of(this).extension<StatusColors>()!;
}

class TaskStatusChip extends StatelessWidget {
  const TaskStatusChip(this.status, {super.key});
  final TaskStatus status;
  @override
  Widget build(BuildContext context) => StatusChip(
    label: status.label,
    colors: context.statusColors.forStatus(status),
  );
}

class PriorityChip extends StatelessWidget {
  const PriorityChip(this.priority, {super.key});
  final Priority priority;
  @override
  Widget build(BuildContext context) => StatusChip(
    label: priority.label,
    colors: context.statusColors.forPriority(priority),
  );
}

class ProjectStatusChip extends StatelessWidget {
  const ProjectStatusChip(this.status, {super.key});
  final ProjectStatus status;
  @override
  Widget build(BuildContext context) => StatusChip(
    label: status.label,
    colors: context.statusColors.forProject(status),
  );
}

class InitialsAvatar extends StatelessWidget {
  const InitialsAvatar(this.name, {super.key, this.radius = 16});
  final String name;
  final double radius;
  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return CircleAvatar(
      radius: radius,
      backgroundColor: s.secondaryContainer,
      child: Text(
        initials(name),
        style: TextStyle(
          fontSize: radius * .7,
          fontWeight: FontWeight.w600,
          color: s.onSecondaryContainer,
        ),
      ),
    );
  }
}

/// Loading / error / data wrapper for FutureProviders.
class AsyncView<T> extends StatelessWidget {
  const AsyncView({
    super.key,
    required this.value,
    required this.data,
    this.onRetry,
  });
  final AsyncValue<T> value;
  final Widget Function(T) data;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => value.when(
    data: data,
    loading: () => const Center(child: CircularProgressIndicator()),
    error: (e, _) => Center(
      child: Padding(
        padding: const EdgeInsets.all(Space.l),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, color: Theme.of(context).colorScheme.error),
            const SizedBox(height: Space.s),
            Text('$e', textAlign: TextAlign.center),
            if (onRetry != null)
              TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    ),
  );
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.trailing});
  final String title;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(Space.m, Space.m, Space.s, Space.s),
    child: Row(
      children: [
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleSmall),
        ),
        ?trailing,
      ],
    ),
  );
}

void showError(BuildContext context, Object e) => ScaffoldMessenger.of(context)
  ..hideCurrentSnackBar()
  ..showSnackBar(SnackBar(content: Text('$e')));

/// Pops if there is a back stack (in-app navigation), otherwise goes to [fallback]
/// (deep links / cold starts have nothing to pop).
void popOrGo(BuildContext context, String fallback) {
  if (context.canPop()) {
    context.pop();
  } else {
    context.go(fallback);
  }
}

/// AppBar leading that always offers a way back: the normal back button when the
/// route can pop, otherwise an up arrow to [fallback].
class BackOrUpButton extends StatelessWidget {
  const BackOrUpButton({
    super.key,
    required this.fallback,
    this.icon = Icons.arrow_back,
  });
  final String fallback;
  final IconData icon;
  @override
  Widget build(BuildContext context) => IconButton(
    key: const Key('backButton'),
    icon: Icon(icon),
    tooltip: MaterialLocalizations.of(context).backButtonTooltip,
    onPressed: () => popOrGo(context, fallback),
  );
}

/// One-line label that shrinks instead of wrapping mid-word at large text scales.
class FitLabel extends StatelessWidget {
  const FitLabel(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => FittedBox(
    fit: BoxFit.scaleDown,
    child: Text(text, maxLines: 1, softWrap: false),
  );
}
