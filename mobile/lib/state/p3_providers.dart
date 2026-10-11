import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/p2.dart' show PickedFile;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config.dart';
import '../data/p3.dart';
import 'providers.dart';

final mockP3StoreProvider = Provider<MockP3Store>(
  (ref) => MockP3Store(ref.watch(mockStoreProvider)),
);

final p3RepositoryProvider = Provider<P3Repository>(
  (ref) => AppConfig.demoMode
      ? MockP3Repository(
          ref.watch(mockP3StoreProvider),
          ref.watch(mockStoreProvider),
        )
      : ApiP3Repository(ref.watch(apiClientProvider)),
);

P3Repository _r(Ref ref) => ref.watch(p3RepositoryProvider);

final issueDetailProvider = FutureProvider.family<Json, String>(
  (ref, id) => _r(ref).issue(id),
);
final issueActivityProvider = FutureProvider.family<List<Json>, String>(
  (ref, id) => _r(ref).issueActivity(id),
);
final taskIssuesProvider = FutureProvider.family<List<Json>, String>(
  (ref, id) => _r(ref).issues(taskId: id),
);
final issueOptionsProvider = FutureProvider.family<Json, String>(
  (ref, id) => _r(ref).issueOptions(id),
);
final foldersProvider = FutureProvider.family<List<Json>, String>(
  (ref, id) => _r(ref).folders(id),
);
final documentsProvider =
    FutureProvider.family<
      List<Json>,
      ({String projectId, String? folderId, String? status})
    >(
      (ref, k) =>
          _r(ref)
              .documents(k.projectId, folderId: k.folderId, status: k.status),
    );
final messagesProvider = FutureProvider.family<List<Json>, String>(
  (ref, id) => _r(ref).messages(id),
);
final clientsProvider = FutureProvider<List<Json>>((ref) => _r(ref).clients());
final clientProvider = FutureProvider.family<Json, String>(
  (ref, id) => _r(ref).client(id),
);
final clientContactsProvider = FutureProvider.family<List<Json>, String>(
  (ref, id) => _r(ref).clientContacts(id),
);
final clientProjectsProvider = FutureProvider.family<List<Json>, String>(
  (ref, id) => _r(ref).clientProjects(id),
);
final portfolioProvider = FutureProvider<Json>((ref) => _r(ref).dashboard());
final myProjectsReportProvider = FutureProvider<List<Json>>(
  (ref) => _r(ref).myProjects(),
);
final workloadProvider = FutureProvider<List<Json>>(
  (ref) => _r(ref).workload(),
);
final reportProvider = FutureProvider.family<Json, String>(
  (ref, name) => _r(ref).report(name),
);
final waitingOnClientProvider = FutureProvider<List<Json>>(
  (ref) => _r(ref).waitingOnClient(),
);
final profileProvider = FutureProvider<Json>((ref) async {
  final u = await ref.watch(authProvider.future);
  return _r(ref).profile(u?.id ?? 'me');
});

/// Picks any document file (Documents › Upload). Overridden in tests.
final documentPickerProvider = Provider<Future<PickedFile?> Function()>(
  (ref) => () async {
    final f = await FilePicker.pickFile();
    if (f == null) return null;
    final bytes = await f.readAsBytes();
    return PickedFile(f.name, bytes.length, bytes);
  },
);

/// Opens a URL (downloads, web links). Overridden in tests.
final urlOpenerProvider = Provider<Future<bool> Function(Uri)>(
  (ref) =>
      (u) => launchUrl(u, mode: LaunchMode.externalApplication),
);
