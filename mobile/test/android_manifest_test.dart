import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  // Release APKs only get permissions from src/main (debug/profile add INTERNET themselves).
  // Without it every request fails and the app shows "Disconnected from the server".
  test('main AndroidManifest declares INTERNET; release has no cleartext', () {
    final main = File('android/app/src/main/AndroidManifest.xml')
        .readAsStringSync();
    expect(main, contains('android.permission.INTERNET'));
    expect(main, isNot(contains('usesCleartextTraffic="true"')));
  });
}
