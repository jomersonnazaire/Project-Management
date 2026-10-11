import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'config.dart';
import 'data/api_client.dart' show disconnectedMessage;
import 'router.dart';
import 'state/providers.dart';
import 'theme/app_theme.dart';

class XceleratePmApp extends ConsumerStatefulWidget {
  const XceleratePmApp({super.key});
  @override
  ConsumerState<XceleratePmApp> createState() => _XceleratePmAppState();
}

class _XceleratePmAppState extends ConsumerState<XceleratePmApp> {
  // Every resume refreshes the sliding 3-day session.
  late final _life = AppLifecycleListener(
    onResume: () => ref.read(authProvider.notifier).refreshSession(),
  );

  @override
  void dispose() {
    _life.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _life;
    return MaterialApp.router(
      title: 'OpsTrack',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ref.watch(themeModeProvider),
      routerConfig: ref.watch(routerProvider),
      builder: (context, child) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (AppConfig.demoMode) const DemoBanner(),
          if (!ref.watch(connectionProvider)) const DisconnectedBanner(),
          Expanded(child: child ?? const SizedBox()),
        ],
      ),
    );
  }
}

/// Always visible in demo mode so nobody mistakes it for the real Portal.
class DemoBanner extends StatelessWidget {
  const DemoBanner({super.key});
  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Material(
      key: const Key('demoBanner'),
      color: s.tertiaryContainer,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Semantics(
            liveRegion: true,
            child: Text(
              'Demo mode · sample data, not connected to the Portal',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelMedium
                  ?.copyWith(color: s.onTertiaryContainer),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown while the API is unreachable. Never signs the user out.
class DisconnectedBanner extends ConsumerWidget {
  const DisconnectedBanner({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = Theme.of(context).colorScheme;
    return Material(
      key: const Key('disconnectedBanner'),
      color: s.errorContainer,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
          child: Row(
            children: [
              Icon(Icons.cloud_off, color: s.onErrorContainer),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  disconnectedMessage,
                  style: TextStyle(color: s.onErrorContainer),
                ),
              ),
              TextButton(
                key: const Key('disconnectedRetry'),
                onPressed: () => retryConnection(ref),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Future<void> retryConnection(WidgetRef ref) async {
  final auth = ref.read(authProvider);
  if (auth.hasError || auth.value == null) {
    await ref.read(authProvider.notifier).retry();
  } else {
    await ref.read(authProvider.notifier).refreshSession();
  }
}

/// Start-up with no server: keep the stored session and offer Retry.
class DisconnectedScreen extends ConsumerWidget {
  const DisconnectedScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    key: const Key('disconnectedScreen'),
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 48),
            const SizedBox(height: 16),
            const Text(disconnectedMessage, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('disconnectedScreenRetry'),
              onPressed: () => retryConnection(ref),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    ),
  );
}
