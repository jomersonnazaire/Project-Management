import 'package:flutter_test/flutter_test.dart';
import 'package:xc8_pm/config.dart';

void main() {
  tearDown(() {
    AppConfig.debugDemoMode = true;
    AppConfig.debugApiBaseUrl = null;
  });

  test('tests run in demo mode with no API URL', () {
    expect(AppConfig.demoMode, isTrue);
    expect(AppConfig.apiBaseUrl, isEmpty);
  });

  test('no flags: the live API, not demo', () {
    AppConfig.debugDemoMode = null; // as in `flutter run` without defines
    expect(AppConfig.demoMode, isFalse);
    expect(AppConfig.apiBaseUrl, AppConfig.liveApiBaseUrl);
    expect(AppConfig.liveApiBaseUrl, startsWith('https://'));
    expect(AppConfig.liveApiBaseUrl, endsWith('/api/v1'));
  });

  test('a fake API override wins over demo', () {
    AppConfig.debugApiBaseUrl = 'http://api.test/api/v1';
    expect(AppConfig.demoMode, isFalse);
    expect(AppConfig.apiBaseUrl, 'http://api.test/api/v1');
  });
}
