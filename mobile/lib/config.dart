import 'package:flutter/foundation.dart';

/// Build-time configuration (all optional; `flutter run` / `flutter build apk` need no flags):
///   API_BASE_URL  API base incl. /api/v1. Default: the live OpsTrack API ([liveApiBaseUrl]).
///                 `API_BASE_URL=demo` turns on demo mode.
///   DEMO=true     Demo mode: in-memory sample data, no network, "Demo mode" banner.
///   WEB_APP_URL   Web app origin (opened by "Admin tools").
abstract final class AppConfig {
  static const liveApiBaseUrl =
      'https://xc8-projectmgmt-api-tc3w.azurewebsites.net/api/v1';

  static const _rawApiBaseUrl = String.fromEnvironment('API_BASE_URL');
  static const _demoDefine = bool.fromEnvironment('DEMO');
  static const webAppUrl = String.fromEnvironment(
    'WEB_APP_URL',
    defaultValue: 'https://example.com',
  );

  /// Tests only: run in live mode against a fake/local API (wins over [debugDemoMode]).
  @visibleForTesting
  static String? debugApiBaseUrl;

  /// Tests only: force demo mode (set for every test in test/flutter_test_config.dart).
  @visibleForTesting
  static bool? debugDemoMode;

  /// Demo mode is opt-in only: DEMO=true or API_BASE_URL=demo.
  static bool get demoMode {
    if (debugApiBaseUrl != null) return false;
    return debugDemoMode ??
        (_demoDefine || _rawApiBaseUrl.toLowerCase() == 'demo');
  }

  static String get apiBaseUrl {
    if (debugApiBaseUrl != null) return debugApiBaseUrl!;
    if (demoMode) return '';
    return _rawApiBaseUrl.isEmpty ? liveApiBaseUrl : _rawApiBaseUrl;
  }
}
