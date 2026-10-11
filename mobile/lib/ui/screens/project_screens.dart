import '../v2/project_form.dart';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';
import '../widgets/status_flow.dart';
import 'home_screens.dart';

class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});
  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final filter = ref.watch(projectFilterProvider);
    return Scaffold(
      key: const Key('projectsScreen'),
      appBar: AppBar(title: const Text('Projects')),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('newProjectFab'),
        onPressed: () => context.push('/projects/new'),
        icon: const Icon(Icons.add),
        label: const Text('New project'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.m, 0, Space.m, Space.s),
            child: SearchBar(
              key: const Key('projectSearch'),
              hintText: 'Search projects',
              leading: const Icon(Icons.search),
              elevation: const WidgetStatePropertyAll(0),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: Space.m),
              children: [
                const Padding(
                  padding: EdgeInsets.only(right: Space.s),
                  child: ProjectTypeFilterChip(),
                ),
                for (final s in [
                  null,
                  ProjectStatus.active,
                  ProjectStatus.onHold,
                  ProjectStatus.planning,
                  ProjectStatus.completed,
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: Space.s),
                    child: FilterChip(
                      label: Text(s?.label ?? 'All'),
                      selected: filter == s,
                      onSelected: (_) =>
                          ref.read(projectFilterProvider.notifier).set(s),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: AsyncView(
              value: ref.watch(projectsProvider),
              onRetry: () => ref.invalidate(projectsProvider),
              data: (list) {
                final shown = list
                    .where(
                      (p) =>
                          p.name.toLowerCase().contains(_query.toLowerCase()),
                    )
                    .toList();
                if (shown.isEmpty) {
                  return const Center(child: Text('No projects match.'));
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(
                    Space.m,
                    Space.s,
                    Space.m,
                    96,
                  ),
                  itemCount: shown.length,
                  separatorBuilder: (_, _) => const SizedBox(height: Space.s),
                  itemBuilder: (_, i) => _ProjectCard(shown[i]),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _ProjectCard extends StatelessWidget {
  const _ProjectCard(this.p);
  final Project p;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Card(
      key: Key('projectCard_${p.id}'),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.go('/projects/${p.id}'),
        child: Padding(
          padding: const EdgeInsets.all(Space.m),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(p.name, style: t.titleMedium)),
                  ProjectStatusChip(p.status),
                ],
              ),
              Text(
                '${p.clientName} · Go-live ${fmtDate(p.goLive)}',
                style: t.bodySmall,
              ),
              const SizedBox(height: Space.xs),
              ProjectTypeChip(project: p),
              const SizedBox(height: Space.s),
              LinearProgressIndicator(
                value: p.progress / 100,
                borderRadius: BorderRadius.circular(4),
              ),
              const SizedBox(height: Space.s),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${p.progress.round()}% complete',
                      style: t.bodySmall,
                    ),
                  ),
                  if (p.managerName != null)
                    InitialsAvatar(p.managerName!, radius: 14),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum ProjectTab { checklist, board, issues, more }

class ProjectDetailScreen extends ConsumerStatefulWidget {
  const ProjectDetailScreen({
    super.key,
    required this.projectId,
    this.initialTab = ProjectTab.checklist,
    this.navNonce = '',
  });

  /// The full location; changes on every navigation to this route.
  final String navNonce;
  final String projectId;
  final ProjectTab initialTab;
  @override
  ConsumerState<ProjectDetailScreen> createState() =>
      _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends ConsumerState<ProjectDetailScreen> {
  late ProjectTab _tab = widget.initialTab;

  @override
  void didUpdateWidget(ProjectDetailScreen old) {
    super.didUpdateWidget(old);
    // The shell keeps this page alive; follow ?tab= changes from later navigation.
    if (widget.initialTab != old.initialTab ||
        widget.navNonce != old.navNonce) {
      _tab = widget.initialTab;
    }
  }

  @override
  Widget build(BuildContext context) {
    final project = ref.watch(projectProvider(widget.projectId));
    final t = Theme.of(context).textTheme;
    return Scaffold(
      key: const Key('projectDetailScreen'),
      appBar: AppBar(
        title: Text(project.value?.name ?? ''),
        actions: [
          IconButton(
            key: const Key('editProject'),
            tooltip: 'Edit project',
            icon: const Icon(Icons.edit_outlined),
            onPressed: () => context.push('/projects/${widget.projectId}/edit'),
          ),
        ],
      ),
      floatingActionButton: _tab == ProjectTab.checklist
          ? FloatingActionButton(
              key: const Key('newTaskFab'),
              tooltip: 'New task',
              onPressed: () =>
                  context.push('/projects/${widget.projectId}/tasks/new'),
              child: const Icon(Icons.add),
            )
          : null,
      body: AsyncView(
        value: project,
        onRetry: () => ref.invalidate(projectProvider(widget.projectId)),
        data: (p) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Space.m),
              child: Column(
                key: const Key('projectHeader'),
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: Space.s,
                    runSpacing: 4,
                    children: [
                      ProjectStatusChip(p.status),
                      if (p.projectTypeName != null && !p.projectTypeActive)
                        StatusChip(
                          label: 'Inactive type',
                          colors: context.statusColors.todo,
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    [
                      p.projectTypeName ?? 'Type not set',
                      'Go-live ${fmtDate(p.goLive)}',
                      'PM ${p.managerName ?? '—'}',
                    ].join(' · '),
                    key: const Key('projectHeaderLine'),
                    style: t.bodySmall,
                    maxLines: 2,
                    softWrap: true,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.m,
                Space.s,
                Space.m,
                Space.s,
              ),
              child: LinearProgressIndicator(
                value: p.progress / 100,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Space.m),
              child: SegmentedButton<ProjectTab>(
                key: const Key('projectTabs'),
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(
                    value: ProjectTab.checklist,
                    label: FitLabel('Checklist'),
                  ),
                  ButtonSegment(
                    value: ProjectTab.board,
                    label: FitLabel('Board', key: Key('boardTab')),
                  ),
                  ButtonSegment(
                    value: ProjectTab.issues,
                    label: FitLabel('Issues'),
                  ),
                  ButtonSegment(
                    value: ProjectTab.more,
                    label: FitLabel('More'),
                  ),
                ],
                selected: {_tab},
                onSelectionChanged: (v) => setState(() => _tab = v.first),
              ),
            ),
            const SizedBox(height: Space.s),
            Expanded(
              child: switch (_tab) {
                ProjectTab.checklist => ChecklistView(projectId: p.id),
                ProjectTab.board => KanbanBoard(projectId: p.id),
                ProjectTab.issues => IssuesList(projectId: p.id),
                ProjectTab.more => _ProjectInfo(p),
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ProjectInfo extends StatelessWidget {
  const _ProjectInfo(this.p);
  final Project p;
  @override
  Widget build(BuildContext context) => ListView(
    children: [
      ListTile(
        leading: const Icon(Icons.business),
        title: const Text('Client'),
        subtitle: Text(p.clientName),
      ),
      ListTile(
        leading: const Icon(Icons.person_outline),
        title: const Text('Project manager'),
        subtitle: Text(p.managerName ?? '—'),
      ),
      ListTile(
        leading: const Icon(Icons.flag_outlined),
        title: const Text('Go-live'),
        subtitle: Text(fmtDate(p.goLive)),
      ),
      ListTile(
        leading: const Icon(Icons.checklist),
        title: const Text('Tasks'),
        subtitle: Text('${p.taskCount}'),
      ),
      const ListTile(
        leading: Icon(Icons.open_in_new),
        title: Text('Documents, conversation, handover'),
        subtitle: Text('Available on the web app'),
      ),
    ],
  );
}

class ChecklistView extends ConsumerWidget {
  const ChecklistView({super.key, required this.projectId});
  final String projectId;
  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncView(
    value: ref.watch(projectTasksProvider(projectId)),
    onRetry: () => ref.invalidate(projectTasksProvider(projectId)),
    data: (tasks) {
      final phases = <String, List<Task>>{};
      for (final t in tasks) {
        phases.putIfAbsent(t.phase ?? 'Unphased', () => []).add(t);
      }
      return ListView(
        key: const Key('checklist'),
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          for (final (i, e) in phases.entries.indexed)
            ExpansionTile(
              initiallyExpanded: i < 2,
              title: Text(e.key),
              trailing: Text(
                '${e.value.where((t) => t.status == TaskStatus.done).length}/${e.value.length}',
              ),
              children: [
                for (final t in e.value)
                  ListTile(
                    key: Key('checklistTask_${t.id}'),
                    leading: Checkbox(
                      value: t.status == TaskStatus.done,
                      onChanged: (v) {
                        final to = v == true
                            ? TaskStatus.done
                            : TaskStatus.inProgress;
                        requestStatusChange(context, ref, t, to);
                      },
                    ),
                    title: Text(t.name),
                    subtitle: Text(
                      '${fmtDate(t.dueDate)} · ${t.ownerName == null ? '' : initials(t.ownerName!)}',
                    ),
                    trailing: TaskStatusChip(t.status),
                    onTap: () => context.push('/tasks/${t.id}'),
                  ),
              ],
            ),
        ],
      );
    },
  );
}

/// Kanban: one status column per swiped page (PageView, viewportFraction .85) with page dots.
/// Long-press a card to move it; moving to Blocked asks for a reason.
class KanbanBoard extends ConsumerStatefulWidget {
  const KanbanBoard({super.key, required this.projectId, this.initialPage = 1});
  final String projectId;
  final int initialPage;
  @override
  ConsumerState<KanbanBoard> createState() => _KanbanBoardState();
}

class _KanbanBoardState extends ConsumerState<KanbanBoard> {
  late final _pages = PageController(
    viewportFraction: .85,
    initialPage: widget.initialPage,
  );
  late int _page = widget.initialPage;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  Future<void> _move(Task t) async {
    final to = await showStatusPicker(context, t, title: 'Move "${t.name}" to');
    if (to == null || !mounted) return;
    final updated = await requestStatusChange(context, ref, t, to);
    if (updated != null && mounted) {
      final idx = TaskStatus.board.indexOf(updated.status);
      if (idx >= 0) {
        _pages.animateToPage(
          idx,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final t = Theme.of(context).textTheme;
    return AsyncView(
      value: ref.watch(projectTasksProvider(widget.projectId)),
      data: (tasks) => Column(
        children: [
          Expanded(
            child: PageView.builder(
              key: const Key('kanbanPageView'),
              controller: _pages,
              itemCount: TaskStatus.board.length,
              onPageChanged: (p) => setState(() => _page = p),
              itemBuilder: (_, i) {
                final status = TaskStatus.board[i];
                final col = tasks.where((x) => x.status == status).toList();
                return Container(
                  key: Key('kanbanColumn_${status.name}'),
                  margin: const EdgeInsets.symmetric(
                    horizontal: Space.xs + 2,
                    vertical: Space.s,
                  ),
                  decoration: BoxDecoration(
                    color: s.surfaceContainerHigh,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(Space.m),
                        child: Row(
                          children: [
                            Flexible(
                              child: Text(
                                status.label,
                                style: t.titleMedium,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: Space.s),
                            Badge(
                              label: Text('${col.length}'),
                              backgroundColor: s.secondaryContainer,
                              textColor: s.onSecondaryContainer,
                            ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: col.isEmpty
                            ? Center(
                                child: Text('No tasks', style: t.bodySmall),
                              )
                            : ListView(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: Space.m - 4,
                                ),
                                children: [
                                  for (final task in col)
                                    _BoardCard(
                                      task: task,
                                      onLongPress: () => _move(task),
                                    ),
                                ],
                              ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(Space.m),
                        child: Row(
                          children: [
                            Icon(
                              Icons.swipe,
                              size: 20,
                              color: s.onSurfaceVariant,
                            ),
                            const SizedBox(width: Space.s),
                            Expanded(
                              child: Text(
                                'Swipe or long-press a card to move it',
                                style: t.bodySmall,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < TaskStatus.board.length; i++)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.all(3),
                  width: i == _page ? 24 : 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: i == _page ? s.primary : s.primaryContainer,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Space.s,
              Space.xs,
              Space.s,
              Space.s,
            ),
            child: Text.rich(
              TextSpan(
                children: [
                  for (var i = 0; i < TaskStatus.board.length; i++) ...[
                    if (i > 0) const TextSpan(text: ' · '),
                    TextSpan(
                      text: TaskStatus.board[i].label,
                      style: TextStyle(
                        fontWeight: i == _page
                            ? FontWeight.w700
                            : FontWeight.w400,
                      ),
                    ),
                  ],
                ],
              ),
              style: t.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

class _BoardCard extends StatelessWidget {
  const _BoardCard({required this.task, required this.onLongPress});
  final Task task;
  final VoidCallback onLongPress;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Space.s + 4),
    child: Card(
      key: Key('boardCard_${task.id}'),
      color: Theme.of(context).colorScheme.surfaceContainerLowest,
      elevation: 1,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/tasks/${task.id}'),
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.all(Space.m - 2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(task.name, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: Space.s + 4),
              Row(
                children: [
                  Expanded(
                    child: Wrap(
                      spacing: Space.s,
                      runSpacing: Space.xs,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        PriorityChip(task.priority),
                        Text(
                          fmtDate(task.dueDate),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  if (task.assignees.isNotEmpty)
                    InitialsAvatar(task.assignees.first, radius: 13),
                ],
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// Create task (TaskFormModal fields subset). POST /projects/:id/tasks.
class CreateTaskScreen extends ConsumerStatefulWidget {
  const CreateTaskScreen({super.key, required this.projectId});
  final String projectId;
  @override
  ConsumerState<CreateTaskScreen> createState() => _CreateTaskScreenState();
}

class _CreateTaskScreenState extends ConsumerState<CreateTaskScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phase = TextEditingController();
  final _est = TextEditingController();
  Priority _priority = Priority.medium;
  Party _party = Party.internal;
  DateTime? _start, _due;
  bool _approval = false, _mandatory = false, _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _phase.dispose();
    _est.dispose();
    super.dispose();
  }

  Future<void> _pick(bool start) async {
    final now = ref.read(clockProvider)();
    final d = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 3),
      initialDate: (start ? _start : _due) ?? now,
    );
    if (d != null) setState(() => start ? _start = d : _due = d);
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_start != null && _due != null && _due!.isBefore(_start!)) {
      return showError(context, 'Due date can\'t be before the start date.');
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(projectRepositoryProvider)
          .createTask(
            widget.projectId,
            NewTask(
              name: _name.text.trim(),
              phase: _phase.text.trim(),
              priority: _priority,
              party: _party,
              plannedStart: _start,
              dueDate: _due,
              estHours: double.tryParse(_est.text),
              requiresApproval: _approval,
              mandatory: _mandatory,
            ),
          );
      ref.invalidate(projectTasksProvider(widget.projectId));
      if (mounted) {
        popOrGo(context, '/projects/${widget.projectId}?tab=checklist');
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const Key('createTaskScreen'),
      appBar: AppBar(
        leading: BackOrUpButton(
          fallback: '/projects/${widget.projectId}',
          icon: Icons.close,
        ),
        title: const Text('New task'),
        actions: [
          TextButton(
            key: const Key('saveTask'),
            onPressed: _busy ? null : _save,
            child: const Text('Save'),
          ),
        ],
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(Space.m),
          children: [
            TextFormField(
              key: const Key('taskNameField'),
              controller: _name,
              decoration: const InputDecoration(labelText: 'Task name *'),
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Task name is required.'
                  : null,
            ),
            const SizedBox(height: Space.m),
            TextFormField(
              controller: _phase,
              decoration: const InputDecoration(labelText: 'Phase'),
            ),
            const SizedBox(height: Space.m),
            const Text('Priority'),
            const SizedBox(height: Space.xs),
            SegmentedButton<Priority>(
              showSelectedIcon: false,
              segments: [
                for (final p in Priority.values)
                  ButtonSegment(value: p, label: Text(p.label)),
              ],
              selected: {_priority},
              onSelectionChanged: (v) => setState(() => _priority = v.first),
            ),
            const SizedBox(height: Space.m),
            const Text('Party'),
            const SizedBox(height: Space.xs),
            SegmentedButton<Party>(
              segments: [
                for (final p in Party.values)
                  ButtonSegment(value: p, label: Text(p.label)),
              ],
              selected: {_party},
              onSelectionChanged: (v) => setState(() => _party = v.first),
            ),
            const SizedBox(height: Space.m),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _pick(true),
                    child: Text('Start ${fmtShort(_start)}'),
                  ),
                ),
                const SizedBox(width: Space.s),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _pick(false),
                    child: Text('Due ${fmtShort(_due)}'),
                  ),
                ),
                const SizedBox(width: Space.s),
                SizedBox(
                  width: 80,
                  child: TextField(
                    controller: _est,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(labelText: 'Est. h'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: Space.m),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Requires approval'),
              value: _approval,
              onChanged: (v) => setState(() => _approval = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Mandatory'),
              value: _mandatory,
              onChanged: (v) => setState(() => _mandatory = v),
            ),
            const Text(
              'Owner, assignees, reviewer and dependencies can be set on the web for now.',
              style: TextStyle(fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}
