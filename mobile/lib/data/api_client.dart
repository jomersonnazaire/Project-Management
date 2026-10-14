import 'dart:convert';

import 'package:http/http.dart' as http;

import 'http_factory.dart';
import 'models.dart';
import 'session_store.dart';

/// Thin JSON client for the OpsTrack API (/api/v1).
///
/// Auth is a session cookie set by POST /auth/login. State-changing requests must
/// carry `X-Requested-With: xc8-web` (CSRF guard in apps/api/src/middleware/security.ts).
class ApiClient {
  ApiClient(
    this.baseUrl, {
    http.Client? client,
    this.store,
    DateTime Function()? deviceClock,
    this.timeout = const Duration(seconds: 20),
  }) : _http = client ?? createHttpClient(),
       _device = deviceClock ?? DateTime.now;

  final String baseUrl;
  final http.Client _http;
  final Map<String, String> _cookies = {};
  final SessionStore? store;
  final Duration timeout;
  final DateTime Function() _device;

  /// Called on a 401 (session ended) and when the server becomes (un)reachable.
  void Function()? onUnauthorized;
  void Function(bool reachable)? onReachability;

  /// Server minus device clock, from the `Date` header (and tracker `now` values).
  Duration serverOffset = Duration.zero;

  /// Server time (UTC). Use this, never the device clock, for timers and "today".
  DateTime serverNow() => _device().toUtc().add(serverOffset);

  /// Tracker endpoints return `now`; it's more precise than the Date header (seconds).
  void observeServerNow(DateTime serverUtc) =>
      serverOffset = serverUtc.toUtc().difference(_device().toUtc());

  void _observeDate(String? header) {
    if (header == null) return;
    final d = _parseHttpDate(header);
    if (d != null) {
      final off = d.difference(_device().toUtc());
      // The Date header only has whole seconds; ignore sub-second jitter.
      if ((off - serverOffset).abs() > const Duration(seconds: 1)) {
        serverOffset = off;
      }
    }
  }

  /// Mobile device token from POST /auth/mobile/login (sent as a bearer, never a cookie).
  String? bearer;

  /// Restores a stored session. Never expires it locally (offline time doesn't sign
  /// you out); the server decides on the next refresh.
  Future<bool> restoreSession() async {
    final s = await store?.read();
    if (s == null) return false;
    final c = Map.of(s.cookies);
    bearer = c.remove(bearerKey);
    if (isPortalToken(bearer)) bearer = null; // D6: never a portal token
    _cookies
      ..clear()
      ..addAll(c);
    return bearer != null || _cookies.isNotEmpty;
  }

  /// Persists the session with the last-active time.
  Future<void> touch() async {
    if (store == null || (bearer == null && _cookies.isEmpty)) return;
    await store!.write(
      StoredSession({..._cookies, bearerKey: ?bearer}, _device().toUtc()),
    );
  }

  static const bearerKey = '__bearer';

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    return Uri.parse('$base$path').replace(queryParameters: query);
  }

  Map<String, String> get _headers => {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Requested-With': 'xc8-web',
    if (bearer != null) 'Authorization': 'Bearer $bearer',
    // Never mix a cookie with the bearer: the API treats a Cookie header as a browser.
    if (bearer == null && !browserManagesCookies && _cookies.isNotEmpty)
      'Cookie': _cookies.entries.map((e) => '${e.key}=${e.value}').join('; '),
  };

  Future<Map<String, dynamic>> get(String path, [Map<String, String>? query]) =>
      _send(_http.get(_uri(path, query), headers: _headers));

  Future<Map<String, dynamic>> post(String path, [Object? body]) => _send(
    _http.post(_uri(path), headers: _headers, body: jsonEncode(body ?? {})),
  );

  Future<Map<String, dynamic>> put(String path, [Object? body]) => _send(
    _http.put(_uri(path), headers: _headers, body: jsonEncode(body ?? {})),
  );

  Future<Map<String, dynamic>> patch(String path, [Object? body]) => _send(
    _http.patch(_uri(path), headers: _headers, body: jsonEncode(body ?? {})),
  );

  /// PUT raw bytes to a short-lived upload link (UploadTicketDto.uploadUrl).
  Future<void> putBytes(
    String url,
    Map<String, String> headers,
    List<int> bytes,
  ) async {
    final res = await _http.put(Uri.parse(url), headers: headers, body: bytes);
    if (res.statusCode >= 300) {
      throw ApiException(
        'Upload failed (${res.statusCode}).',
        status: res.statusCode,
      );
    }
  }

  Future<Map<String, dynamic>> delete(String path) =>
      _send(_http.delete(_uri(path), headers: _headers));

  Future<Map<String, dynamic>> _send(Future<http.Response> req) async {
    final http.Response res;
    try {
      res = await req.timeout(timeout);
    } catch (e) {
      onReachability?.call(false);
      throw ApiException(disconnectedMessage, status: 0, code: 'OFFLINE');
    }
    _observeDate(res.headers['date']);
    _storeCookies(res.headers['set-cookie']);
    if (res.statusCode >= 500) {
      onReachability?.call(false);
      throw ApiException(
        disconnectedMessage,
        status: res.statusCode,
        code: 'SERVER_ERROR',
      );
    }
    onReachability?.call(true);
    if (res.statusCode == 401) {
      _cookies.clear();
      bearer = null;
      await store?.clear();
      onUnauthorized?.call();
    } else if (res.statusCode < 400) {
      await touch();
    }
    final decoded = res.body.isEmpty ? null : jsonDecode(res.body);
    final map = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    if (res.statusCode >= 400) {
      final err = map['error'];
      final msg = err is Map
          ? err['message'] as String?
          : map['message'] as String?;
      final code = err is Map ? err['code'] as String? : map['code'] as String?;
      final details = err is Map ? err['details'] : null;
      final fields = <String, String>{
        if (details is List)
          for (final d in details)
            if (d is Map && d['path'] != null)
              '${d['path']}': '${d['message'] ?? ''}',
      };
      throw ApiException(
        friendlyApiMessage(res.statusCode, code, msg),
        status: res.statusCode,
        code: code,
        fields: fields,
        details: details,
      );
    }
    return map;
  }

  void _storeCookies(String? header) {
    if (header == null || browserManagesCookies) return;
    // dart:io folds multiple Set-Cookie headers into one comma-separated value.
    for (final part in header.split(RegExp(r',(?=\s*[A-Za-z0-9_\-]+=)'))) {
      final pair = part.split(';').first.trim();
      final i = pair.indexOf('=');
      if (i <= 0) continue;
      final value = pair.substring(i + 1);
      if (value.isEmpty) {
        _cookies.remove(pair.substring(0, i));
      } else {
        _cookies[pair.substring(0, i)] = value;
      }
    }
  }

  Future<void> clearSession() async {
    _cookies.clear();
    bearer = null;
    await store?.clear();
  }
}

const disconnectedMessage =
    'Disconnected from the server. Please contact your System Admin.';

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// RFC 7231 IMF-fixdate, e.g. "Sun, 11 Oct 2026 13:40:48 GMT".
DateTime? _parseHttpDate(String s) {
  final m = RegExp(r'(\d{1,2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2})')
      .firstMatch(s);
  if (m == null) return null;
  final mon = _months.indexOf(m[2]!);
  if (mon < 0) return null;
  return DateTime.utc(
    int.parse(m[3]!),
    mon + 1,
    int.parse(m[1]!),
    int.parse(m[4]!),
    int.parse(m[5]!),
    int.parse(m[6]!),
  );
}

/// Copy for M8 error codes (doc 16 / design delta). Server text otherwise.
const apiCodeMessages = <String, String>{
  'VIEW_ONLY': 'You can view this entry, but only its owner can change it.',
  'ACTIVITY_IN_USE':
      "Can't delete: this activity has logged time, documents and issues.",
  'PROJECT_NOT_PLANNING':
      'Phase details can only be changed while the project is in Planning.',
  'TEMPLATE_NOT_PUBLISHED':
      'This template is no longer available. Choose another or start blank.',
  'TEMPLATE_CHANGED':
      'This template has a newer version. Review the preview again.',
  'DUPLICATE_NAME': 'A phase with this name already exists.',
  'FUTURE_DATE': "You can't log time for a future date.",
};

/// 404 copy: DEF-015 (a PM not on the project) and DEF-014 (an entry you can't view).
const notFoundMessage =
    "This isn't available. It may have been removed, or you're not on this project.";
const rateLimitMessage =
    'Too many attempts. Wait a few minutes, then try again.';

String friendlyApiMessage(int status, String? code, String? serverMsg) {
  if (code != null && apiCodeMessages.containsKey(code)) {
    // Keep a specific server message (e.g. PHASE_NOT_EMPTY counts) when present.
    return code == 'VIEW_ONLY' || code == 'FUTURE_DATE' || serverMsg == null
        ? apiCodeMessages[code]!
        : serverMsg;
  }
  if (status == 404) return notFoundMessage;
  if (status == 429) return rateLimitMessage;
  return serverMsg ?? 'Request failed ($status).';
}

/// D6: client-portal session/invite tokens (`ptl_…`) are web-only.
bool isPortalToken(String? t) => t != null && t.trim().startsWith('ptl_');
