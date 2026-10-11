import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'state/providers.dart';
import 'theme/app_theme.dart';

class XceleratePmApp extends ConsumerWidget {
  const XceleratePmApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp.router(
    title: 'OpsTrack',
    debugShowCheckedModeBanner: false,
    theme: AppTheme.light,
    darkTheme: AppTheme.dark,
    themeMode: ref.watch(themeModeProvider),
    routerConfig: ref.watch(routerProvider),
  );
}
