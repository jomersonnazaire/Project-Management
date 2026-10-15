import 'package:http/browser_client.dart';
import 'package:http/http.dart' as http;

/// Web: the browser stores the HttpOnly session cookie; send it cross-origin.
http.Client createHttpClient() => BrowserClient()..withCredentials = true;
const bool browserManagesCookies = true;
