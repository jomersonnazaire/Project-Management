import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';

/// Port of m8-polish packages/shared findCycle: the ids in a cycle (first repeated at the end)
/// or null.
List<String>? findCycle(Map<String, List<String>> deps) {
  final state = <String, int>{};
  final stack = <String>[];
  List<String>? visit(String id) {
    state[id] = 1;
    stack.add(id);
    for (final d in deps[id] ?? const <String>[]) {
      if (!deps.containsKey(d)) continue;
      if (state[d] == 1) return [...stack.sublist(stack.indexOf(d)), d];
      if (!state.containsKey(d)) {
        final f = visit(d);
        if (f != null) return f;
      }
    }
    stack.removeLast();
    state[id] = 2;
    return null;
  }

  for (final id in deps.keys) {
    if (!state.containsKey(id)) {
      final f = visit(id);
      if (f != null) return f;
    }
  }
  return null;
}

/// Same checks and copy as the API (routes/tasks.ts validateTaskInput): no self, only tasks in
/// this project, no circular dependency. [taskId] is null for a new task.
String? dependencyProblem(
  String? taskId,
  List<String> ids,
  List<Task> projectTasks,
) {
  if (taskId != null && ids.contains(taskId)) {
    return "A task can't depend on itself.";
  }
  final known = {for (final t in projectTasks) t.id};
  if (ids.any((i) => !known.contains(i))) {
    return 'Dependencies must be tasks in this project.';
  }
  const me = '__this__';
  final self = taskId ?? me;
  final deps = {for (final t in projectTasks) t.id: t.dependsOn};
  deps[self] = ids;
  final cycle = findCycle(deps);
  if (cycle == null) return null;
  final names = {for (final t in projectTasks) t.id: t.name};
  return 'Circular dependency: ${cycle.map((i) => names[i] ?? 'this task').join(' → ')}.';
}

/// "Depends on" chips plus a searchable multi-select bottom sheet of this project's tasks.
class DependenciesField extends ConsumerWidget {
  const DependenciesField({
    super.key,
    required this.projectId,
    required this.taskId,
    required this.selected,
    required this.onChanged,
    this.errorText,
  });
  final String projectId;
  final String? taskId;
  final List<String> selected;
  final ValueChanged<List<String>> onChanged;
  final String? errorText;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks =
        ref.watch(projectTasksProvider(projectId)).value ?? const <Task>[];
    final names = {for (final t in tasks) t.id: t.name};
    final th = Theme.of(context);
    return Column(
      key: const Key('dependenciesField'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Depends on', style: th.textTheme.labelLarge),
        const SizedBox(height: 4),
        Wrap(
          spacing: Space.s,
          runSpacing: Space.s,
          children: [
            for (final id in selected)
              InputChip(
                key: Key('dependencyChip_$id'),
                label: Text(
                  names[id] ?? 'Task',
                  overflow: TextOverflow.ellipsis,
                ),
                deleteButtonTooltipMessage:
                    'Remove ${names[id] ?? 'dependency'}',
                onDeleted: () => onChanged([...selected]..remove(id)),
              ),
            ActionChip(
              key: const Key('addDependency'),
              avatar: const Icon(Icons.add, size: 18),
              label: Text(selected.isEmpty ? 'Add dependency' : 'Edit'),
              onPressed: () async {
                final r = await showModalBottomSheet<List<String>>(
                  context: context,
                  useRootNavigator: true,
                  isScrollControlled: true,
                  showDragHandle: true,
                  builder: (_) => _DependencySheet(
                    taskId: taskId,
                    tasks: tasks,
                    initial: selected,
                  ),
                );
                if (r != null) onChanged(r);
              },
            ),
          ],
        ),
        if (errorText != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              errorText!,
              key: const Key('dependenciesError'),
              style: th.textTheme.bodySmall?.copyWith(
                color: th.colorScheme.error,
              ),
            ),
          ),
      ],
    );
  }
}

class _DependencySheet extends StatefulWidget {
  const _DependencySheet({
    required this.taskId,
    required this.tasks,
    required this.initial,
  });
  final String? taskId;
  final List<Task> tasks;
  final List<String> initial;
  @override
  State<_DependencySheet> createState() => _DependencySheetState();
}

class _DependencySheetState extends State<_DependencySheet> {
  late final _sel = [...widget.initial];
  String _q = '';
  String? _error;

  @override
  Widget build(BuildContext context) {
    final options = widget.tasks
        .where((t) => t.id != widget.taskId)
        .where(
          (t) => _q.isEmpty || t.name.toLowerCase().contains(_q.toLowerCase()),
        )
        .toList();
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.8,
      maxChildSize: 0.95,
      builder: (context, sc) => Column(
        key: const Key('dependencySheet'),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.m, 0, Space.m, Space.s),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Depends on',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                FilledButton(
                  key: const Key('dependencyDone'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                  onPressed: () {
                    final p = dependencyProblem(
                      widget.taskId,
                      _sel,
                      widget.tasks,
                    );
                    if (p != null) {
                      setState(() => _error = p);
                      return;
                    }
                    Navigator.pop(context, _sel);
                  },
                  child: const Text('Done'),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Space.m),
            child: TextField(
              key: const Key('dependencySearch'),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search tasks in this project',
                filled: true,
              ),
              onChanged: (v) => setState(() => _q = v),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(Space.m),
              child: Text(
                _error!,
                key: const Key('dependencySheetError'),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          Expanded(
            child: options.isEmpty
                ? const Center(child: Text('No tasks match.'))
                : ListView(
                    controller: sc,
                    children: [
                      for (final t in options)
                        CheckboxListTile(
                          key: Key('dependencyOption_${t.id}'),
                          value: _sel.contains(t.id),
                          title: Text(t.name),
                          subtitle: t.phase == null ? null : Text(t.phase!),
                          onChanged: (v) => setState(() {
                            _error = null;
                            v == true ? _sel.add(t.id) : _sel.remove(t.id);
                          }),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}
