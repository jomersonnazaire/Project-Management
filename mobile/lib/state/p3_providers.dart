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
