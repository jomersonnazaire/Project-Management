// P3 47–48: project Documents (folders, status filters, upload, respond to a request, download)
// and Conversation (GET/POST /projects/:id/messages; m8-polish has no /conversations/:id route).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../data/p3.dart';
import '../../state/p3_providers.dart';
import '../../state/v2_providers.dart';
import '../../state/p2_providers.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

StatusPair _docColors(BuildContext c, Json d) {
  final sc = c.statusColors;
  if (d['request']?['overdue'] == true && d['status'] == 'REQUESTED') {
    return sc.blocked;
  }
  return switch (d['status']) {
    'SIGNED' => sc.done,
    'SUBMITTED' => sc.forReview,
    'REQUESTED' => sc.inProgress,
    _ => sc.todo,
  };
}

String docStatusLabel(Json d) =>
    d['request']?['overdue'] == true && d['status'] == 'REQUESTED'
    ? 'Overdue'
    : documentStatusLabels['${d['status']}'] ?? '${d['status']}';

class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key, required this.projectId});
  final String projectId;
  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  String? _status; // null = Folders view
  String? _folder;
  String? _error;
  bool _busy = false;

  ({String projectId, String? folderId, String? status}) get _key => (
    projectId: widget.projectId,
    folderId: _status == null ? _folder : null,
    status: _status,
  );

  Future<void> _upload({String? fulfils, String? folderId}) async {
    final folder =
        folderId ??
        _folder ??
        (ref.read(foldersProvider(widget.projectId)).value?.firstOrNull?['id']
            as String?);
    if (folder == null) return;
    final f = await ref.read(documentPickerProvider)();
    if (f == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(p3RepositoryProvider)
          .uploadDocument(
            widget.projectId,
            folder,
            f.name,
            f.bytes,
            fulfils: fulfils,
          );
      ref.invalidate(documentsProvider);
      ref.invalidate(foldersProvider(widget.projectId));
      ref.invalidate(waitingOnClientProvider);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('${f.name} uploaded')));
      }
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download(Json d) async {
    try {
      final url = await ref
          .read(p3RepositoryProvider)
          .downloadUrl(widget.projectId, '${d['id']}');
      await ref.read(urlOpenerProvider)(Uri.parse(url));
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final folders = ref.watch(foldersProvider(widget.projectId));
    final docs = ref.watch(documentsProvider(_key));
    final t = Theme.of(context).textTheme;
    final folderName = folders.value
        ?.where((f) => f['id'] == _folder)
        .firstOrNull?['name'];
    return Scaffold(
      key: const Key('documentsScreen'),
      appBar: AppBar(
        leading: _folder != null && _status == null
            ? IconButton(
                key: const Key('documentsUp'),
                tooltip: 'All folders',
                icon: const Icon(Icons.arrow_back),
                onPressed: () => setState(() => _folder = null),
              )
            : BackOrUpButton(
                fallback: '/projects/${widget.projectId}?tab=more',
              ),
        title: Text(folderName as String? ?? 'Documents'),
      ),
      floatingActionButton:
          canW(ref, 'documents', 'create') &&
              (_folder != null ||
                  (_status == null && (folders.value?.isNotEmpty ?? false)))
          ? FloatingActionButton.extended(
              key: const Key('documentUpload'),
              onPressed: _busy ? null : () => _upload(),
              icon: const Icon(Icons.upload),
              label: Text(_busy ? 'Uploading…' : 'Upload'),
            )
          : null,
      body: ListView(
        key: const Key('documentsList'),
        padding: const EdgeInsets.fromLTRB(Space.m, Space.s, Space.m, 96),
        children: [
          Wrap(
            spacing: Space.s,
            runSpacing: Space.s,
            children: [
              for (final (k, label) in [
                (null, 'Folders'),
                ('REQUESTED', 'Requested'),
                ('SUBMITTED', 'Submitted'),
                ('SIGNED', 'Signed'),
              ])
                ChoiceChip(
                  key: Key('docFilter_${k ?? 'FOLDERS'}'),
                  label: Text(label),
                  selected: _status == k,
                  onSelected: (_) => setState(() => _status = k),
                ),
            ],
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: Space.s),
              child: Text(
                _error!,
                key: const Key('documentError'),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: Space.m),
          if (_status == null && _folder == null)
            AsyncView(
              value: folders,
              onRetry: () => ref.invalidate(foldersProvider(widget.projectId)),
              data: (fs) => Card(
                child: Column(
                  children: [
                    if (fs.isEmpty)
                      const ListTile(title: Text('No folders yet.')),
                    for (final (i, f) in fs.indexed) ...[
                      if (i > 0) const Divider(indent: 56, height: 1),
                      ListTile(
                        key: Key('folder_${f['id']}'),
                        leading: const Icon(Icons.folder_outlined),
                        title: Text('${f['name']}'),
                        subtitle: Wrap(
                          spacing: Space.s,
                          runSpacing: 4,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(
                              '${f['documentCount']} ${f['documentCount'] == 1 ? 'document' : 'documents'}',
                            ),
                            if (f['restricted'] == true)
                              StatusChip(
                                label: 'Restricted folder',
                                colors: context.statusColors.todo,
                              ),
                          ],
                        ),
                        onTap: () => setState(() => _folder = '${f['id']}'),
                      ),
                    ],
                  ],
                ),
              ),
            )
          else ...[
            if (_status != null)
              Text(documentStatusLabels[_status] ?? '', style: t.titleSmall),
            const SizedBox(height: Space.s),
            AsyncView(
              value: docs,
              onRetry: () => ref.invalidate(documentsProvider(_key)),
              data: (ds) => Card(
                child: Column(
                  children: [
                    if (ds.isEmpty)
                      const ListTile(
                        key: Key('documentsEmpty'),
                        title: Text('No documents here yet.'),
                      ),
                    for (final (i, d) in ds.indexed) ...[
                      if (i > 0) const Divider(indent: 56, height: 1),
                      _docTile(d),
                    ],
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: Space.m),
          Text(
            'Folder access settings are on the web app.',
            style: t.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _docTile(Json d) {
    final req = d['request'] as Map?;
    final requested = d['status'] == 'REQUESTED';
    final sub = requested
        ? [
            'Requested by ${refName(req?['requestedBy']) ?? '—'}',
            if (refName(req?['requestedFrom']) != null)
              'from ${refName(req?['requestedFrom'])}',
            if (req?['dueDate'] != null) 'due ${shortYmd(req?['dueDate'])}',
          ]
        : [
            if ((d['latestVersion'] ?? 0) > 1) 'v${d['latestVersion']}',
            '${documentStatusLabels[d['status']]} by ${refName(d['uploadedBy']) ?? '—'}',
            shortYmd(d['updatedAt']),
          ];
    return ListTile(
      key: Key('doc_${d['id']}'),
      leading: Icon(
        requested ? Icons.pending_actions : Icons.description_outlined,
      ),
      title: Text('${d['name']}'),
      subtitle: Text(sub.join(' · ')),
      trailing: StatusChip(
        label: docStatusLabel(d),
        colors: _docColors(context, d),
      ),
      onTap: () => requested
          ? (canW(ref, 'documents', 'create') ? _respond(d) : null)
          : _download(d),
    );
  }

  Future<void> _respond(Json d) async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text('${d['name']}'),
              subtitle: const Text('Upload the file to fulfil this request.'),
            ),
            ListTile(
              key: const Key('fulfilRequest'),
              leading: const Icon(Icons.upload),
              title: const Text('Upload file'),
              onTap: () => Navigator.pop(ctx, true),
            ),
          ],
        ),
      ),
    );
    if (ok == true) {
      await _upload(fulfils: '${d['id']}', folderId: '${d['folderId']}');
    }
  }
}

class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({super.key, required this.projectId});
  final String projectId;
  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> {
  final _text = TextEditingController();
  String _type = 'NOTE';
  String? _task, _contact, _error, _filter;
  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _post() async {
    if (_text.text.trim().isEmpty) {
      setState(() => _error = 'Write a message first.');
      return;
    }
    try {
      await ref.read(p3RepositoryProvider).postMessage(widget.projectId, {
        'text': _text.text.trim(),
        'type': _type,
        'taskId': _task,
        'contactIds': [?_contact],
      });
      _text.clear();
      setState(() {
        _error = null;
        _task = _contact = null;
      });
      ref.invalidate(messagesProvider(widget.projectId));
    } on ApiException catch (e) {
      if (e.status == 403) {
        // The server decides (FR-CNV-04); switch to the read-only note and say why.
        setState(() {
          _forbidden = true;
          _error = null;
        });
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                e.message.isEmpty
                    ? 'Only people on this project can post here.'
                    : e.message,
              ),
            ),
          );
        }
        return;
      }
      setState(() => _error = e.fields['text'] ?? e.message);
    }
  }

  bool _forbidden = false;

  /// FR-CNV-04 canPost: conversations.create AND (edit rights on the project OR membership),
  /// and the project isn't archived.
  bool _canPost() {
    if (_forbidden || !canW(ref, 'conversations', 'create')) return false;
    final p = ref.watch(projectProvider(widget.projectId)).value;
    final me = ref.watch(authProvider).value;
    if (p == null || me == null || p.archived) return false;
    if (ref.watch(messagesCanPostProvider(widget.projectId)).value == false) {
      return false;
    }
    if (canEditProject(ref, p) || p.managerId == me.id) return true;
    final members = ref
        .watch(projectExtrasProvider(widget.projectId))
        .value
        ?.members;
    return members?.any((m) => m.id == me.id) ?? false;
  }

  Future<void> _tag() async {
    final opts = await ref.read(issueOptionsProvider(widget.projectId).future);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(Space.m),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Tag this message',
                  style: Theme.of(ctx).textTheme.titleMedium,
                ),
                const SizedBox(height: Space.m),
                DropdownMenu<String>(
                  key: const Key('messageTypeField'),
                  expandedInsets: EdgeInsets.zero,
                  label: const Text('Type'),
                  initialSelection: _type,
                  dropdownMenuEntries: [
                    for (final e in messageTypeLabels.entries)
                      DropdownMenuEntry(value: e.key, label: e.value),
                  ],
                  onSelected: (v) => setState(() => _type = v ?? 'NOTE'),
                ),
                const SizedBox(height: Space.m),
                DropdownMenu<String>(
                  key: const Key('messageTaskField'),
                  expandedInsets: EdgeInsets.zero,
                  label: const Text('Tag a task (optional)'),
                  initialSelection: _task,
                  dropdownMenuEntries: [
                    for (final x in jsonList(opts['tasks']))
                      DropdownMenuEntry(
                        value: '${x['id']}',
                        label: '${x['name']}',
                      ),
                  ],
                  onSelected: (v) => setState(() => _task = v),
                ),
                const SizedBox(height: Space.m),
                DropdownMenu<String>(
                  key: const Key('messageContactField'),
                  expandedInsets: EdgeInsets.zero,
                  label: const Text('Tag a contact'),
                  initialSelection: _contact,
                  dropdownMenuEntries: [
                    for (final x in jsonList(opts['contacts']))
                      DropdownMenuEntry(
                        value: '${x['id']}',
                        label: '${x['name']}',
                      ),
                  ],
                  onSelected: (v) => setState(() => _contact = v),
                ),
                const SizedBox(height: Space.m),
                FilledButton(
                  key: const Key('messageTagDone'),
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Done'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _whoSees() => showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Who sees this'),
      content: const Text(
        'Everyone who can see the project. Messages are plain text, links open in a new tab, and an Admin can hide a message that breaks the conduct policy.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('OK'),
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).value?.id;
    final msgs = ref.watch(messagesProvider(widget.projectId));
    final s = Theme.of(context).colorScheme;
    final t = Theme.of(context).textTheme;
    final tags = [
      if (_type != 'NOTE') messageTypeLabels[_type]!,
      if (_task != null) 'task',
      if (_contact != null) 'contact',
    ];
    return Scaffold(
      key: const Key('conversationScreen'),
      appBar: AppBar(
        leading: BackOrUpButton(
          fallback: '/projects/${widget.projectId}?tab=more',
        ),
        title: const Text('Conversation'),
        actions: [
          IconButton(
            key: const Key('whoSeesThis'),
            tooltip: 'Who sees this',
            icon: const Icon(Icons.visibility_outlined),
            onPressed: _whoSees,
          ),
          PopupMenuButton<String?>(
            key: const Key('messageFilter'),
            tooltip: 'Filter by type',
            icon: const Icon(Icons.filter_list),
            onSelected: (v) => setState(() => _filter = v == 'ALL' ? null : v),
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'ALL', child: Text('All messages')),
              for (final e in messageTypeLabels.entries)
                PopupMenuItem(value: e.key, child: Text(e.value)),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: AsyncView(
              value: msgs,
              onRetry: () => ref.invalidate(messagesProvider(widget.projectId)),
              data: (all) {
                final ms = all
                    .where((m) => _filter == null || m['type'] == _filter)
                    .toList()
                    .reversed
                    .toList();
                if (ms.isEmpty) {
                  return const Center(
                    child: Text(
                      'No messages yet. Start the conversation.',
                      key: Key('conversationEmpty'),
                    ),
                  );
                }
                return ListView(
                  key: const Key('messagesList'),
                  padding: const EdgeInsets.all(Space.m),
                  children: [
                    for (final m in ms)
                      _bubble(m, mine: refId(m['author']) == me, s: s, t: t),
                  ],
                );
              },
            ),
          ),
          if (!_canPost())
            const SafeArea(
              top: false,
              child: Padding(
                padding: EdgeInsets.all(Space.m),
                child: Text(
                  'You can read this conversation but not post.',
                  key: Key('conversationReadOnly'),
                ),
              ),
            )
          else
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  Space.s,
                  Space.s,
                  Space.s,
                  Space.s,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    IconButton(
                      key: const Key('messageTag'),
                      tooltip: 'Tag a task or contact',
                      icon: Badge(
                        isLabelVisible: tags.isNotEmpty,
                        label: Text(
                          '${tags.length}',
                          textScaler: TextScaler.noScaling,
                        ),
                        child: const Icon(Icons.sell_outlined),
                      ),
                      onPressed: _tag,
                    ),
                    Expanded(
                      child: TextField(
                        key: const Key('messageField'),
                        controller: _text,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 4000,
                        decoration: InputDecoration(
                          hintText: 'Write a message for the project team…',
                          filled: true,
                          counterText: '',
                          errorText: _error,
                          helperText: tags.isEmpty
                              ? null
                              : 'Tagged: ${tags.join(', ')}',
                        ),
                      ),
                    ),
                    IconButton.filledTonal(
                      key: const Key('messageSend'),
                      tooltip: 'Post',
                      icon: const Icon(Icons.send),
                      onPressed: _post,
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _bubble(
    Json m, {
    required bool mine,
    required ColorScheme s,
    required TextTheme t,
  }) {
    final who = mine ? 'You' : (refName(m['author']) ?? '—');
    final meta = [
      who,
      if (m['type'] != 'NOTE') messageTypeLabels[m['type']] ?? '${m['type']}',
      whenPh(m['at']),
    ].join(' · ');
    final tagged = [
      if (m['task'] != null) refName(m['task']),
      for (final c in jsonList(m['contacts'])) refName(c),
    ].whereType<String>();
    return Align(
      key: Key('message_${m['id']}'),
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * .8,
        ),
        child: Container(
          margin: const EdgeInsets.only(bottom: Space.s),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: mine ? s.primaryContainer : s.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(meta, style: t.labelSmall),
              const SizedBox(height: 2),
              Text(
                m['hidden'] != null ? 'Hidden by an Admin.' : '${m['text']}',
              ),
              if (tagged.isNotEmpty)
                Text('Tagged: ${tagged.join(', ')}', style: t.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}
