import 'package:http/http.dart' as http;

/// Native: cookies are handled by ApiClient (the API authenticates by session cookie).
http.Client createHttpClient() => http.Client();
const bool browserManagesCookies = false;
