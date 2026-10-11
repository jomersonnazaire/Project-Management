import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:xc8_pm/data/api_client.dart';
import 'package:xc8_pm/data/v2_repositories.dart';

void main() {
  test(
    'API without /project-types (older deploy): empty list, not an error',
    () async {
      final api = ApiClient(
        'http://api.test/api/v1',
        client: MockClient(
          (r) async => http.Response(
            '{"error":{"code":"NOT_FOUND","message":"Not found."}}',
            404,
          ),
        ),
      );
      expect(await ApiProjectAdminRepository(api).projectTypes(), isEmpty);
    },
  );

  test('other project-types errors still surface', () async {
    final api = ApiClient(
      'http://api.test/api/v1',
      client: MockClient(
        (r) async => http.Response('{"error":{"code":"FORBIDDEN"}}', 403),
      ),
    );
    await expectLater(
      ApiProjectAdminRepository(api).projectTypes(),
      throwsA(isA<Object>()),
    );
  });
}
