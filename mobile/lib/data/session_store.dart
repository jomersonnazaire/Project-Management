import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persisted session: the API session cookie(s) and when the app was last active.
class StoredSession {
  const StoredSession(this.cookies, this.lastActive);
  final Map<String, String> cookies;
  final DateTime lastActive;
  Map<String, Object> toJson() => {
    'cookies': cookies,
    'lastActive': lastActive.toUtc().toIso8601String(),
  };
  static StoredSession? fromJson(String? s) {
    if (s == null) return null;
    try {
      final j = jsonDecode(s) as Map<String, dynamic>;
      return StoredSession({
        for (final e in (j['cookies'] as Map).entries) '${e.key}': '${e.value}',
      }, DateTime.parse('${j['lastActive']}'));
    } catch (_) {
      return null;
    }
  }
}

abstract class SessionStore {
  Future<StoredSession?> read();
  Future<void> write(StoredSession s);
  Future<void> clear();
}

/// flutter_secure_storage (Keychain / Android Keystore-backed EncryptedSharedPreferences).
class SecureSessionStore implements SessionStore {
  SecureSessionStore([FlutterSecureStorage? s])
    : _s = s ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;
  static const _key = 'opstrack.session';
  @override
  Future<StoredSession?> read() async {
    try {
      return StoredSession.fromJson(await _s.read(key: _key));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(StoredSession s) async {
    try {
      await _s.write(key: _key, value: jsonEncode(s.toJson()));
    } catch (_) {}
  }

  @override
  Future<void> clear() async {
    try {
      await _s.delete(key: _key);
    } catch (_) {}
  }
}

class MemorySessionStore implements SessionStore {
  StoredSession? value;
  @override
  Future<StoredSession?> read() async => value;
  @override
  Future<void> write(StoredSession s) async => value = s;
  @override
  Future<void> clear() async => value = null;
}

/// The sliding inactivity window (matches the API's MOBILE_SESSION_IDLE_HOURS default).
const sessionIdle = Duration(days: 3);
