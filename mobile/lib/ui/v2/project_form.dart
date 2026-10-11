import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/tracker_models.dart';
import '../../data/v2_repositories.dart';
import '../../state/providers.dart';
import '../../state/p2_providers.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

/// Type chip on project cards/detail: name, "Not set", plus "Inactive".
class ProjectTypeChip extends StatelessWidget {
  const ProjectTypeChip({super.key, required this.project});
  final Project project;
  @override
  Widget build(BuildContext context) {
    final sc = context.statusColors;
    return Wrap(
      key: Key('projectType_${project.id}'),
      spacing: 4,
      children: [
        StatusChip(
          label: project.projectTypeName ?? 'Not set',
          colors: project.projectTypeName == null ? sc.todo : sc.planning,
        ),
        if (project.projectTypeName != null && !project.projectTypeActive)
          StatusChip(label: 'Inactive', colors: sc.blocked),
      ],
    );
  }
}

/// "All project types" FilterChip with a menu (30).
class ProjectTypeFilterChip extends ConsumerWidget {
  const ProjectTypeFilterChip({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sel = ref.watch(projectTypeFilterProvider);
    final types =
        ref.watch(projectTypesProvider).value ?? const <ProjectTypeInfo>[];
    final label = sel == null
        ? 'All project types'
        : sel == 'none'
        ? 'Not set'
        : types.where((t) => t.id == sel).firstOrNull?.name ?? 'Project type';
    return MenuAnchor(
      menuChildren: [
        MenuItemButton(
          key: const Key('projectTypeOption_all'),
          onPressed: () =>
              ref.read(projectTypeFilterProvider.notifier).set(null),
          child: const Text('All project types'),
        ),
        for (final t in types)
          MenuItemButton(
            key: Key('projectTypeOption_${t.id}'),
            onPressed: () =>
                ref.read(projectTypeFilterProvider.notifier).set(t.id),
            child: Text(t.name),
          ),
        MenuItemButton(
          key: const Key('projectTypeOption_none'),
          onPressed: () =>
              ref.read(projectTypeFilterProvider.notifier).set('none'),
          child: const Text('Not set'),
        ),
      ],
      builder: (_, c, _) => FilterChip(
        key: const Key('projectTypeFilter'),
        label: Row(
          mainAxisSize: MainAxisSize.min,
          children: [Text(label), const Icon(Icons.arrow_drop_down, size: 18)],
        ),
        selected: sel != null,
        onSelected: (_) => c.isOpen ? c.close() : c.open(),
      ),
    );
  }
}

/// New project (31) / Edit project (32/33).
class ProjectFormScreen extends ConsumerStatefulWidget {
  const ProjectFormScreen({super.key, this.projectId});
  final String? projectId;
  @override
  ConsumerState<ProjectFormScreen> createState() => _ProjectFormScreenState();
}

class _ProjectFormScreenState extends ConsumerState<ProjectFormScreen> {
  final _name = TextEditingController();
  final _code = TextEditingController();
  final _desc = TextEditingController();
  final _reason = TextEditingController();
  String? _template, _client, _type, _manager, _status;
  Set<String> _members = {};
  DateTime? _start, _end;
  Map<String, String> _errors = {};
  bool _loaded = false, _busy = false;
  Project? _orig;

  bool get _edit => widget.projectId != null;

  List<NamedRef> _templates = const [], _clients = const [], _people = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final repo = ref.read(projectAdminRepositoryProvider);
    try {
      final r = await Future.wait([
        if (!_edit) repo.templates() else Future.value(const <NamedRef>[]),
        repo.clients(),
        repo.people(),
      ]);
      Project? p;
      if (_edit) {
        p = await ref.read(projectRepositoryProvider).get(widget.projectId!);
        final x = await ref
            .read(projectExtrasRepositoryProvider)
            .extras(widget.projectId!);
        _members = {for (final m in x.members) m.id};
      }
      if (!mounted) return;
      setState(() {
        _templates = r[0];
        _clients = r[1];
        _people = r[2];
        if (p != null) {
          _orig = p;
          _name.text = p.name;
          _code.text = p.code ?? '';
          _desc.text = p.description ?? '';
          _client = p.clientId;
          _type = p.projectTypeId;
          _manager = p.managerId;
          _status = p.status.api;
          _start = p.startDate;
          _end = p.goLive;
        }
        _loaded = true;
      });
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _code, _desc, _reason]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _baselineChanged =>
      _edit && (_start != _orig?.startDate || _end != _orig?.goLive);

  Map<String, String> _validate(List<ProjectTypeInfo> types) {
    final e = <String, String>{};
    if (!_edit && _template == null) e['templateId'] = 'Choose a template.';
    if (_name.text.trim().isEmpty) e['name'] = 'Project name is required.';
    if (_code.text.trim().isEmpty) {
      e['code'] = 'Project code is required.';
    } else if (_code.text.trim().length < 2 ||
        _code.text.trim().length > 20 ||
        !RegExp(r'^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$')
            .hasMatch(_code.text.trim())) {
      e['code'] = 'Invalid code.';
    }
    if (_client == null) e['clientId'] = 'Choose a client.';
    final t = types.where((x) => x.id == _type).firstOrNull;
    if (_type == null) {
      e['projectTypeId'] = _edit
          ? 'Not set. Pick a project type to save.'
          : 'Choose a project type.';
    } else if (t != null && !t.active && (_orig?.projectTypeId != _type)) {
      e['projectTypeId'] =
          'This project type is inactive. Choose an active one.';
    }
    if (_manager == null) e['managerId'] = 'Choose a project manager.';
    if (_start == null) e['startDate'] = 'Baseline start is required.';
    if (_end == null) e['plannedEndDate'] = 'Baseline end is required.';
    if (_baselineChanged && _reason.text.trim().isEmpty) {
      e['reason'] = 'Give a reason for changing the baseline.';
    }
    return e;
  }

  Future<void> _save(List<ProjectTypeInfo> types) async {
    final e = _validate(types);
    setState(() => _errors = e);
    if (e.isNotEmpty) return;
    if (_edit && _client != _orig?.clientId) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Change the client?'),
          content: const Text(
            'Changing the client clears the project’s active client contacts.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: const Key('confirmChangeClient'),
              style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Change the client anyway'),
            ),
          ],
        ),
      );
      if (ok != true) return;
    }
    setState(() => _busy = true);
    final input = ProjectInput(
      templateId: _template,
      templateVersion: _templates
          .where((t) => t.id == _template)
          .firstOrNull
          ?.version,
      name: _name.text.trim(),
      code: _code.text.trim(),
      clientId: _client,
      projectTypeId: _type,
      managerId: _manager,
      startDate: _start,
      endDate: _end,
      description: _desc.text.trim(),
      rebaselineReason: _baselineChanged ? _reason.text.trim() : null,
      status: _edit ? _status : null,
      memberIds: {..._members, ?_manager}.toList(),
    );
    try {
      final repo = ref.read(projectAdminRepositoryProvider);
      if (_edit) {
        await repo.update(widget.projectId!, input);
        ref.invalidate(projectProvider(widget.projectId!));
        ref.invalidate(projectsProvider);
        if (mounted) popOrGo(context, '/projects/${widget.projectId}');
      } else {
        final id = await repo.create(input);
        ref.invalidate(projectsProvider);
        if (mounted) context.go('/projects/$id');
      }
    } on ApiException catch (err) {
      if (!mounted) return;
      setState(
        () => _errors = err.fields.isNotEmpty ? err.fields : {'_': err.message},
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickDate(bool start) async {
    final d = await showDatePicker(
      context: context,
      initialDate: (start ? _start : _end) ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (d != null) setState(() => start ? _start = d : _end = d);
  }

  @override
  Widget build(BuildContext context) {
    final types =
        ref.watch(projectTypesProvider).value ?? const <ProjectTypeInfo>[];
    final current = types.where((t) => t.id == _type).firstOrNull;
    // Active types only, plus the project's current (possibly inactive) type when editing.
    final options = types
        .where((t) => t.active || (_edit && t.id == _orig?.projectTypeId))
        .toList();
    final t = Theme.of(context).textTheme;
    Widget gap() => const SizedBox(height: Space.m);
    DropdownMenu<String> dd(
      String key,
      String label,
      String field,
      String? value,
      List<NamedRef> items,
      ValueChanged<String?> on,
    ) => DropdownMenu<String>(
      key: Key(key),
      expandedInsets: EdgeInsets.zero,
      label: Text(label),
      errorText: _errors[field],
      initialSelection: value,
      dropdownMenuEntries: [
        for (final i in items) DropdownMenuEntry(value: i.id, label: i.name),
      ],
      onSelected: on,
    );
    return Scaffold(
      key: Key(_edit ? 'editProjectScreen' : 'newProjectScreen'),
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Close',
          icon: const Icon(Icons.close),
          onPressed: () => popOrGo(
            context,
            _edit ? '/projects/${widget.projectId}' : '/projects',
          ),
        ),
        title: Text(_edit ? 'Edit project' : 'New project'),
        actions: [
          TextButton(
            key: const Key('projectSave'),
            onPressed: !_loaded || _busy ? null : () => _save(types),
            child: Text(_edit ? 'Save' : 'Create'),
          ),
        ],
      ),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              key: const Key('projectFormList'),
              padding: const EdgeInsets.all(Space.m),
              children: [
                if (_errors['_'] != null)
                  Text(
                    _errors['_']!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                if (!_edit) ...[
                  dd(
                    'projectTemplateField',
                    'Template *',
                    'templateId',
                    _template,
                    _templates,
                    (v) => setState(() => _template = v),
                  ),
                  gap(),
                ],
                TextField(
                  key: const Key('projectNameField'),
                  controller: _name,
                  decoration: InputDecoration(
                    labelText: 'Project name *',
                    errorText: _errors['name'],
                  ),
                ),
                gap(),
                TextField(
                  key: const Key('projectCodeField'),
                  controller: _code,
                  decoration: InputDecoration(
                    labelText: 'Project code *',
                    errorText: _errors['code'],
                  ),
                ),
                gap(),
                dd(
                  'projectClientField',
                  'Client *',
                  'clientId',
                  _client,
                  _clients,
                  (v) => setState(() => _client = v),
                ),
                gap(),
                DropdownMenu<String>(
                  key: const Key('projectTypeField'),
                  expandedInsets: EdgeInsets.zero,
                  label: const Text('Project type *'),
                  errorText: _errors['projectTypeId'],
                  hintText: 'Choose…',
                  initialSelection: _type,
                  helperText: current != null && !current.active
                      ? 'This type is no longer offered for new projects.'
                      : null,
                  dropdownMenuEntries: [
                    for (final x in options)
                      DropdownMenuEntry(
                        value: x.id,
                        label: x.active ? x.name : '${x.name} (Inactive)',
                      ),
                  ],
                  onSelected: (v) => setState(() {
                    _type = v;
                    _errors.remove('projectTypeId');
                  }),
                ),
                gap(),
                dd(
                  'projectManagerField',
                  'Project manager *',
                  'managerId',
                  _manager,
                  _people,
                  (v) => setState(() => _manager = v),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 4, left: Space.m),
                  child: Text(
                    'The project manager is always on the team.',
                    style: t.bodySmall,
                  ),
                ),
                gap(),
                Text('Team members', style: t.labelLarge),
                Wrap(
                  key: const Key('projectMembersField'),
                  spacing: Space.s,
                  children: [
                    for (final p in _people)
                      FilterChip(
                        key: Key('projectMember_${p.id}'),
                        label: Text(p.name),
                        selected: _members.contains(p.id) || p.id == _manager,
                        onSelected: p.id == _manager
                            ? null
                            : (v) => setState(
                                () => v
                                    ? _members.add(p.id)
                                    : _members.remove(p.id),
                              ),
                      ),
                  ],
                ),
                if (_edit) ...[
                  gap(),
                  DropdownMenu<String>(
                    key: const Key('projectStatusField'),
                    expandedInsets: EdgeInsets.zero,
                    label: const Text('Status'),
                    initialSelection: _status,
                    dropdownMenuEntries: [
                      for (final st in ProjectStatus.values.where(
                        (x) => x != ProjectStatus.other,
                      ))
                        DropdownMenuEntry(value: st.api, label: st.label),
                    ],
                    onSelected: (v) => setState(() => _status = v),
                  ),
                ],
                gap(),
                Builder(
                  builder: (context) {
                    final start = InkWell(
                      key: const Key('projectStartField'),
                      onTap: () => _pickDate(true),
                      child: InputDecorator(
                        decoration: InputDecoration(
                          label: const Text(
                            'Baseline start *',
                            maxLines: 2,
                            softWrap: true,
                            overflow: TextOverflow.visible,
                          ),
                          errorText: _errors['startDate'],
                          errorMaxLines: 2,
                        ),
                        child: Text(_start == null ? '' : fmtDate(_start)),
                      ),
                    );
                    final end = InkWell(
                      key: const Key('projectEndField'),
                      onTap: () => _pickDate(false),
                      child: InputDecorator(
                        decoration: InputDecoration(
                          label: const Text(
                            'Baseline end *',
                            maxLines: 2,
                            softWrap: true,
                            overflow: TextOverflow.visible,
                          ),
                          errorText: _errors['plannedEndDate'],
                          errorMaxLines: 2,
                        ),
                        child: Text(_end == null ? '' : fmtDate(_end)),
                      ),
                    );
                    return MediaQuery.textScalerOf(context).scale(10) > 14
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              start,
                              const SizedBox(height: Space.m),
                              end,
                            ],
                          )
                        : Row(
                            children: [
                              Expanded(child: start),
                              const SizedBox(width: Space.s),
                              Expanded(child: end),
                            ],
                          );
                  },
                ),
                if (_baselineChanged) ...[
                  gap(),
                  TextField(
                    key: const Key('projectReasonField'),
                    controller: _reason,
                    maxLength: 500,
                    decoration: InputDecoration(
                      labelText: 'Reason for re-baselining *',
                      errorText: _errors['reason'],
                    ),
                  ),
                ],
                gap(),
                TextField(
                  key: const Key('projectDescriptionField'),
                  controller: _desc,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Description'),
                ),
                const SizedBox(height: Space.s),
                Text(
                  'Team members are managed on the web app for now.',
                  style: t.bodySmall,
                ),
              ],
            ),
    );
  }
}
