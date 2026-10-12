import 'dart:async';

import 'package:xc8_pm/config.dart';

/// Every test runs in demo mode (mock repositories) unless it opts into a fake API with
/// AppConfig.debugApiBaseUrl. Tests never reach the live API.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  AppConfig.debugDemoMode = true;
  await testMain();
}
