import 'dart:convert';

import 'package:http/http.dart' as http;

import 'http_factory.dart';
import 'models.dart';

/// Thin JSON client for the OpsTrack API (/api/v1).
///
/// Auth is a session cookie set by POST /auth/login. State-changing requests must
/// carry `X-Requested-With: xc8-web` (CSRF guard in apps/api/src/middleware/security.ts).
class ApiClient {
  ApiClient(this.baseUrl, {http.Client? client})
    : _http = client ?? createHttpClient();

  final String baseUrl;
  final http.Client _http;
  final Map<String, String> _cookies = {};

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
    if (!browserManagesCookies && _cookies.isNotEmpty)
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

  Future<Map<String, dynamic>> delete(String path) =>
      _send(_http.delete(_uri(path), headers: _headers));

  Future<Map<String, dynamic>> _send(Future<http.Response> req) async {
    final http.Response res;
    try {
      res = await req;
    } catch (e) {
      throw ApiException('Can\'t reach the server. Check your connection.');
    }
    _storeCookies(res.headers['set-cookie']);
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
        res.statusCode == 404
            ? 'Not found'
            : (msg ?? 'Request failed (${res.statusCode}).'),
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

  void clearSession() => _cookies.clear();
}
