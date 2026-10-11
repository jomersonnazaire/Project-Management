// P2 34–35: project detail More tab — details, handover, team, active contacts, Time and Activity.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/p2.dart';
import '../../data/ph_time.dart';
import '../../data/v2_repositories.dart';
import '../../state/p2_providers.dart';
import '../../state/providers.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';
import 'task_actions.dart';

const _typeLabels = {
  'EXECUTION': 'Execution',
  'WAITING': 'Waiting',
  'REWORK': 'Rework',
};

class ProjectInfoView extends ConsumerWidget {
  const ProjectInfoView(this.p, {super.key});
  final Project p;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final x = ref.watch(projectExtrasProvider(p.id));
    final canEdit = x.value?.canEdit ?? false;
    return ListView(
      key: const Key('projectInfo'),
      padding: const EdgeInsets.only(bottom: Space.xxl),
      children: [
        if (canW(ref, 'documents', 'view'))
          ListTile(
            key: const Key('projectDocumentsLink'),
            leading: const Icon(Icons.folder_outlined),
            title: const Text('Documents'),
            subtitle: const Text('Folders, requests and files'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/projects/${p.id}/documents'),
          ),
        if (canW(ref, 'conversations', 'view'))
          ListTile(
            key: const Key('projectConversationLink'),
            leading: const Icon(Icons.forum_outlined),
            title: const Text('Conversation'),
            subtitle: const Text('Notes, calls, meetings and decisions'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/projects/${p.id}/conversation'),
          ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.business),
          title: const Text('Client'),
          subtitle: Text(p.clientName),
        ),
        ListTile(
          leading: const Icon(Icons.category_outlined),
          title: const Text('Project type'),
          subtitle: Text(p.projectTypeName ?? 'Not set'),
        ),
        ListTile(
          key: const Key('projectManagerTile'),
          leading: const Icon(Icons.person_outline),
          title: const Text('Project manager'),
          subtitle: Text(p.managerName ?? '—'),
          trailing: canEdit
              ? TextButton(
                  key: const Key('handoverButton'),
                  onPressed: () => showHandover(context, ref, p),
                  child: const Text('Hand over'),
                )
              : null,
        ),
        ListTile(
          leading: const Icon(Icons.flag_outlined),
          title: const Text('Baseline'),
          subtitle: Text('${fmtDate(p.startDate)} → ${fmtDate(p.goLive)}'),
        ),
        const Divider(),
        const _Header('Team members'),
        for (final m in x.value?.members ?? const <NamedRef>[])
          ListTile(
            key: Key('member_${m.id}'),
            leading: InitialsAvatar(m.name),
            title: Text(m.name),
            subtitle: m.id == p.managerId
                ? const Text('Project manager')
                : null,
          ),
        const Divider(),
        _Header(
          'Active contacts',
          action: canEdit
              ? IconButton(
                  key: const Key('addContact'),
                  tooltip: 'Add a contact',
                  icon: const Icon(Icons.person_add_alt),
                  onPressed: () => _addContact(context, ref, p.id),
                )
              : null,
        ),
        if ((x.value?.contacts ?? const []).isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: Space.m),
            child: Text('No active contacts yet.', key: Key('noContacts')),
          ),
        for (final c in x.value?.contacts ?? const <Contact>[])
          ListTile(
            key: Key('contact_${c.id}'),
            leading: InitialsAvatar(c.name),
            title: Text(c.name),
            subtitle: Text([?c.position, ?c.email].join(' · ')),
            trailing: canEdit
                ? IconButton(
                    key: Key('removeContact_${c.id}'),
                    tooltip: 'Remove ${c.name}',
                    icon: const Icon(Icons.remove_circle_outline),
                    onPressed: () async {
                      try {
                        await ref
                            .read(projectExtrasRepositoryProvider)
                            .removeContact(p.id, c.id);
                        _refresh(ref, p.id);
                      } catch (e) {
                        if (context.mounted) showError(context, e);
                      }
                    },
                  )
                : null,
          ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.title, {this.action});
  final String title;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(Space.m, Space.s, Space.s, 0),
    child: Row(
      children: [
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleSmall),
        ),
        ?action,
      ],
    ),
  );
}

void _refresh(WidgetRef ref, String id) {
  ref.invalidate(projectExtrasProvider(id));
  ref.invalidate(projectActivityProvider(id));
  ref.invalidate(projectProvider(id));
  ref.invalidate(projectsProvider);
}

Future<void> _addContact(
  BuildContext context,
  WidgetRef ref,
  String projectId,
) async {
  final repo = ref.read(projectExtrasRepositoryProvider);
  final options = (await repo.contactOptions(projectId))
      .where((c) => !c.added)
      .toList();
  if (!context.mounted) return;
  final picked = await showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    builder: (ctx) => ListView(
      key: const Key('contactOptions'),
      shrinkWrap: true,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Space.m, 0, Space.m, Space.s),
          child: Text(
            'Add an active contact',
            style: Theme.of(ctx).textTheme.titleLarge,
          ),
        ),
        if (options.isEmpty)
          const Padding(
            padding: EdgeInsets.all(Space.m),
            child: Text(
              'All of this client’s contacts are already on the project.',
            ),
          ),
        for (final c in options)
          ListTile(
            key: Key('contactOption_${c.id}'),
            leading: InitialsAvatar(c.name),
            title: Text(c.name),
            subtitle: c.position == null ? null : Text(c.position!),
            onTap: () => Navigator.pop(ctx, c.id),
          ),
      ],
    ),
  );
  if (picked == null) return;
  try {
    await repo.addContact(projectId, picked);
    _refresh(ref, projectId);
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

/// Handover (35). m8-polish: PATCH /projects/:id {managerId}, audited as project_handover.
Future<void> showHandover(
  BuildContext context,
  WidgetRef ref,
  Project p,
) async {
  final people = await ref.read(projectAdminRepositoryProvider).people();
  if (!context.mounted) return;
  final to = await showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (_) => _HandoverSheet(project: p, people: people),
  );
  if (to == null) return;
  try {
    await ref.read(projectExtrasRepositoryProvider).handover(p.id, to);
    _refresh(ref, p.id);
    if (context.mounted) {
      final name = people.where((x) => x.id == to).firstOrNull?.name ?? '';
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Project handed over to $name')));
    }
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

class _HandoverSheet extends StatefulWidget {
  const _HandoverSheet({required this.project, required this.people});
  final Project project;
  final List<NamedRef> people;
  @override
  State<_HandoverSheet> createState() => _HandoverSheetState();
}

class _HandoverSheetState extends State<_HandoverSheet> {
  String? _to, _error;
  @override
  Widget build(BuildContext context) {
    final others = widget.people
        .where((x) => x.id != widget.project.managerId)
        .toList();
    return Padding(
      padding: const EdgeInsets.fromLTRB(Space.m, 0, Space.m, Space.l),
      child: Column(
        key: const Key('handoverSheet'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Hand over the project',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: Space.s),
          const Text(
            'The new project manager joins the team and gets this project’s PM rights. '
            'The change is recorded in the project activity.',
          ),
          const SizedBox(height: Space.m),
          DropdownMenu<String>(
            key: const Key('handoverTo'),
            expandedInsets: EdgeInsets.zero,
            label: const Text('New project manager *'),
            errorText: _error,
            dropdownMenuEntries: [
              for (final x in others)
                DropdownMenuEntry(value: x.id, label: x.name),
            ],
            onSelected: (v) => setState(() => _to = v),
          ),
          const SizedBox(height: Space.m),
          FilledButton(
            key: const Key('handoverSubmit'),
            onPressed: () {
              if (_to == null) {
                setState(() => _error = 'Choose a project manager.');
                return;
              }
              Navigator.pop(context, _to);
            },
            child: const Text('Hand over'),
          ),
        ],
      ),
    );
  }
}

/// Time (GET /projects/:id/time).
class ProjectTimeScreen extends StatelessWidget {
  const ProjectTimeScreen({super.key, required this.projectId});
  final String projectId;
  @override
  Widget build(BuildContext context) => Scaffold(
    key: const Key('projectTimeScreen'),
    appBar: AppBar(
      leading: BackOrUpButton(fallback: '/projects/$projectId?tab=time'),
      title: const Text('Time'),
    ),
    body: ProjectTimeView(projectId: projectId),
  );
}

/// Project › Time tab: GET /projects/:id/time.
class ProjectTimeView extends ConsumerWidget {
  const ProjectTimeView({super.key, required this.projectId});
  final String projectId;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return AsyncView(
      value: ref.watch(projectTimeProvider(projectId)),
      onRetry: () => ref.invalidate(projectTimeProvider(projectId)),
      data: (pt) => ListView(
        key: const Key('projectTimeList'),
        padding: const EdgeInsets.all(Space.m),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Space.m),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${formatHHMM(pt.total * 60)} total',
                    key: const Key('projectTimeTotal'),
                    style: t.titleLarge,
                  ),
                  const SizedBox(height: Space.s),
                  Wrap(
                    spacing: Space.m,
                    runSpacing: 4,
                    children: [
                      for (final e in pt.byType.entries)
                        Text(
                          '${_typeLabels[e.key] ?? e.key} ${formatHHMM(e.value * 60)}',
                          style: t.bodySmall,
                        ),
                    ],
                  ),
                  if (!pt.allPeople)
                    Text('Showing your own time', style: t.bodySmall),
                ],
              ),
            ),
          ),
          if (pt.items.isEmpty)
            const Padding(
              padding: EdgeInsets.all(Space.l),
              child: Text('No time logged yet.', textAlign: TextAlign.center),
            ),
          for (final r in pt.items)
            ListTile(
              key: Key('projectTime_${r.id}'),
              contentPadding: EdgeInsets.zero,
              leading: InitialsAvatar(r.person),
              title: Text(r.task),
              subtitle: Text(
                '${r.person} · ${longDayShort(r.date)} · ${_typeLabels[r.type] ?? r.type}',
              ),
              trailing: Text(formatHHMM(r.hours * 60), style: t.titleSmall),
            ),
        ],
      ),
    );
  }
}

/// Activity (GET /projects/:id/activity).
class ProjectActivityScreen extends StatelessWidget {
  const ProjectActivityScreen({super.key, required this.projectId});
  final String projectId;
  @override
  Widget build(BuildContext context) => Scaffold(
    key: const Key('projectActivityScreen'),
    appBar: AppBar(
      leading: BackOrUpButton(fallback: '/projects/$projectId?tab=activity'),
      title: const Text('Activity'),
    ),
    body: ProjectActivityView(projectId: projectId),
  );
}

class ProjectActivityView extends ConsumerWidget {
  const ProjectActivityView({super.key, required this.projectId});
  final String projectId;
  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncView(
    value: ref.watch(projectActivityProvider(projectId)),
    onRetry: () => ref.invalidate(projectActivityProvider(projectId)),
    data: (items) => HistoryList(
      items: items,
      listKey: 'projectActivityList',
      empty: 'No activity yet.',
    ),
  );
}
