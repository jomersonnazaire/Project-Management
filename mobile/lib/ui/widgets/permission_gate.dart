import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/v2_providers.dart';
import 'common.dart';

/// Deep-link guard: shows [child] only when useCan(record, action); a spinner while
/// permissions load, and a "no access" page otherwise.
class PermissionGate extends ConsumerWidget {
  const PermissionGate({
    super.key,
    required this.record,
    required this.action,
    required this.child,
  });
  final String record, action;
  final Widget child;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(permissionsProvider);
    if (!p.hasValue) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (canW(ref, record, action)) return child;
    return const NoAccessScreen();
  }
}

/// "You don't have access" page for deep links a role can't use.
class NoAccessScreen extends StatelessWidget {
  const NoAccessScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const Key('noAccessScreen'),
      appBar: AppBar(leading: const BackOrUpButton(fallback: '/')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            "You don't have access to this. Ask an Admin if you need it.",
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
