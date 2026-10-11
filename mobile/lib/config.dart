/// Build-time configuration. Pass with --dart-define:
///   API_BASE_URL  e.g. https://api.example.com/api/v1   (empty = demo mode with mock data)
///   WEB_APP_URL   e.g. https://pm.example.com           (opened by "Admin tools")
abstract final class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL');
  static const webAppUrl = String.fromEnvironment('WEB_APP_URL', defaultValue: 'https://example.com');
  static bool get demoMode => apiBaseUrl.isEmpty;
}
