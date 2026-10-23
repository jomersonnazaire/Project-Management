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
    // Audit: the app needs no other runtime permissions (file_picker uses the system
    // document picker, location is chosen from a list, notifications are in-app only).
    final perms = RegExp(r'uses-permission android:name="([^"]+)"')
        .allMatches(main)
        .map((m) => m[1])
        .toList();
    expect(perms, ['android.permission.INTERNET']);
    expect(main, contains('flutter_deeplinking_enabled'));
    expect(main, contains('android:value="false"'));
    expect(main, contains('android:scheme="opstrack"'));
    expect(main, contains('android:host="auth"'));
    // opstrack://auth/mail (DAR Send) is covered by the host-only auth filter: no path filter,
    // and no other send-result address.
    expect(main, isNot(contains('android:path')));
    expect(main, isNot(contains('android:host="ms"')));
    // iOS registers the whole opstrack scheme, which covers both hosts.
    final plist = File('ios/Runner/Info.plist').readAsStringSync();
    expect(plist, contains('<string>opstrack</string>'));
  });
}
