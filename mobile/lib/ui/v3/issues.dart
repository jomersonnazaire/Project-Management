// P3 45–46: issue detail (status, comments, due date, link a task), Raise issue, task Linked issues.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/p3.dart';
import '../../data/ph_time.dart';
import '../../state/p3_providers.dart';
import '../../state/providers.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

StatusPair severityColors(BuildContext c, String s) {
  final sc = c.statusColors;
  return switch (s) {
    'CRITICAL' => sc.blocked,
    'HIGH' => sc.forReview,
    'MEDIUM' => sc.inProgress,
    _ => sc.todo,
  };
}

StatusPair issueStatusColors(BuildContext c, String s) {
  final sc = c.statusColors;
  return switch (s) {
    'IN_PROGRESS' => sc.inProgress,
    'WAITING_ON_CLIENT' => sc.forReview,
    'RESOLVED' || 'CLOSED' => sc.done,
    _ => sc.todo,
  };
}

void invalidateIssue(WidgetRef ref, String id) {
  ref.invalidate(issueDetailProvider(id));
  ref.invalidate(issueActivityProvider(id));
  ref.invalidate(issuesProvider);
  ref.invalidate(taskIssuesProvider);
}

class IssueRow extends StatelessWidget {
  const IssueRow(this.i, {super.key});
  final Json i;
  @override
  Widget build(BuildContext context) {
    final st = '${i['status']}', sev = '${i['severity']}';
    return ListTile(
      key: Key('issueRow_${i['id']}'),
      title: Text('${i['key']} · ${i['title']}'),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Wrap(
          spacing: Space.s,
          runSpacing: 4,
          children: [
            StatusChip(
              label: issueStatusLabels[st] ?? st,
              colors: issueStatusColors(context, st),
            ),
            StatusChip(
              label: issueSeverityLabels[sev] ?? sev,
              colors: severityColors(context, sev),
            ),
          ],
        ),
      ),
      onTap: () => context.push('/issues/${i['id']}'),
    );
  }
}

/// Task detail › Linked issues: GET /issues?taskId= (FR-ISS-09).
class LinkedIssuesTab extends ConsumerWidget {
  const LinkedIssuesTab({super.key, required this.task});
  final Task task;
  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncView(
    value: ref.watch(taskIssuesProvider(task.id)),
    onRetry: () => ref.invalidate(taskIssuesProvider(task.id)),
    data: (items) => ListView(
      key: const Key('linkedIssuesList'),
      padding: const EdgeInsets.symmetric(vertical: Space.s),
      children: [
        if (items.isEmpty)
          const Padding(
            padding: EdgeInsets.all(Space.m),
            child: Text(
              'No issues are linked to this task.',
              key: Key('linkedIssuesEmpty'),
            ),
          ),
        for (final i in items) IssueRow(i),
        if (canW(ref, 'issues', 'create'))
          Padding(
            padding: const EdgeInsets.all(Space.m),
            child: Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                key: const Key('raiseIssueFromTask'),
                icon: const Icon(Icons.add),
                label: const Text('Raise issue'),
                onPressed: () => context.push(
                  '/projects/${task.projectId}/issues/new?task=${task.id}',
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

class IssueDetailScreen extends ConsumerStatefulWidget {
  const IssueDetailScreen({super.key, required this.issueId});
  final String issueId;
  @override
  ConsumerState<IssueDetailScreen> createState() => _IssueDetailScreenState();
}

class _IssueDetailScreenState extends ConsumerState<IssueDetailScreen> {
  final _comment = TextEditingController();
  String? _commentError;
  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  P3Repository get _repo => ref.read(p3RepositoryProvider);

  Future<void> _addComment() async {
    try {
      await _repo.issueComment(widget.issueId, _comment.text);
      _comment.clear();
      setState(() => _commentError = null);
      invalidateIssue(ref, widget.issueId);
    } on ApiException catch (e) {
      setState(() => _commentError = e.fields['text'] ?? e.message);
    }
  }

  Future<void> _status(Json i, String to) async {
    final from = '${i['status']}';
    final needsText = to == 'RESOLVED' || transitionNeedsReason(from, to);
    String? text;
    if (needsText) {
      text = await _askText(
        title: transitionLabel(from, to),
        label: to == 'RESOLVED' ? 'Resolution' : 'Reason',
        key: 'issueStatusText',
        required: to == 'RESOLVED'
            ? 'Describe the resolution.'
            : 'Give a reason.',
      );
      if (text == null) return;
    }
    try {
      await _repo.issueStatus(widget.issueId, {
        'version': i['version'],
        'status': to,
        if (to == 'RESOLVED') 'resolution': text,
        if (to != 'RESOLVED' && text != null) 'reason': text,
      });
      invalidateIssue(ref, widget.issueId);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<String?> _askText({
    required String title,
    required String label,
    required String key,
    required String required,
  }) {
    final c = TextEditingController();
    String? err;
    return showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(title),
          content: TextField(
            key: Key(key),
            controller: c,
            maxLines: 3,
            maxLength: 2000,
            decoration: InputDecoration(labelText: label, errorText: err),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: Key('${key}Save'),
              onPressed: () => c.text.trim().isEmpty
                  ? set(() => err = required)
                  : Navigator.pop(ctx, c.text.trim()),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _otherStatus(Json i) async {
    final from = '${i['status']}';
    final to = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(title: Text('Change status')),
            for (final t in _transitions(i))
              ListTile(
                key: Key('issueTo_$t'),
                title: Text(transitionLabel(from, t)),
                subtitle: Text('→ ${issueStatusLabels[t]}'),
                onTap: () => Navigator.pop(ctx, t),
              ),
          ],
        ),
      ),
    );
    if (to != null) await _status(i, to);
  }

  List<String> _transitions(Json i) {
    final can = (i['can'] as Map?)?['transitions'];
    return can is List
        ? [for (final t in can) '$t']
        : [...?issueTransitions['${i['status']}']];
  }

  Future<void> _linkTask(Json i) async {
    final opts = await ref.read(
      issueOptionsProvider(refId(i['project'])!).future,
    );
    final chosen = {
      for (final t in jsonList((i['links'] as Map?)?['tasks'])) '${t['id']}',
    };
    if (!mounted) return;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(ctx).height * .7,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const ListTile(title: Text('Link a task')),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final t in jsonList(opts['tasks']))
                        CheckboxListTile(
                          key: Key('linkTask_${t['id']}'),
                          value: chosen.contains(t['id']),
                          title: Text('${t['name']}'),
                          subtitle: t['phase'] == null
                              ? null
                              : Text('${t['phase']}'),
                          onChanged: (v) => set(
                            () => v == true
                                ? chosen.add('${t['id']}')
                                : chosen.remove(t['id']),
                          ),
                        ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(Space.m),
                  child: FilledButton(
                    key: const Key('linkTaskSave'),
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('Save links'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (ok != true) return;
    try {
      await _repo.updateIssue(widget.issueId, {
        'version': i['version'],
        'taskIds': chosen.toList(),
      });
      invalidateIssue(ref, widget.issueId);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _dueDate(Json i) async {
    final cur = jsonDate(i['dueDate']) ?? ref.read(todayPhProvider);
    final d = await showDatePicker(
      context: context,
      initialDate: cur,
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
    );
    if (d == null || !mounted) return;
    final reason = await _askText(
      title: 'Change due date to ${shortDate(d)}',
      label: 'Why is the due date changing?',
      key: 'dueReason',
      required: 'Why is the due date changing?',
    );
    if (reason == null) return;
    try {
      await _repo.updateIssue(widget.issueId, {
        'version': i['version'],
        'dueDate': ymd(d),
        'dueReason': reason,
      });
      invalidateIssue(ref, widget.issueId);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final issue = ref.watch(issueDetailProvider(widget.issueId));
    return Scaffold(
      key: const Key('issueDetailScreen'),
      appBar: AppBar(
        leading: const BackOrUpButton(fallback: '/issues'),
        title: Text(
          issue.value?['title'] as String? ?? 'Issue',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (issue.value?['can']?['edit'] == true)
            PopupMenuButton<String>(
              key: const Key('issueOverflow'),
              tooltip: 'More options',
              onSelected: (v) {
                if (v == 'due') _dueDate(issue.requireValue);
              },
              itemBuilder: (_) => const [
                PopupMenuItem(
                  key: Key('issueChangeDue'),
                  value: 'due',
                  child: Text('Change due date'),
                ),
              ],
            ),
        ],
      ),
      body: AsyncView(
        value: issue,
        onRetry: () => ref.invalidate(issueDetailProvider(widget.issueId)),
        data: (i) => _body(context, i),
      ),
    );
  }

  Widget _body(BuildContext context, Json i) {
    final t = Theme.of(context).textTheme;
    final st = '${i['status']}',
        sev = '${i['severity']}',
        stage = '${i['stage']}';
    final can = (i['can'] as Map?) ?? const {};
    final transitions = can['edit'] == true
        ? _transitions(i)
        : const <String>[];
    final primary = transitions.isEmpty ? null : transitions.first;
    final activity =
        ref.watch(issueActivityProvider(widget.issueId)).value ??
        const <Json>[];
    final contact = i['contact'];
    final tasks = jsonList((i['links'] as Map?)?['tasks']);
    return ListView(
      key: const Key('issueDetailList'),
      padding: const EdgeInsets.all(Space.m),
      children: [
        Text(
          '${i['key']} · ${refName(i['project']) ?? ''}',
          style: t.bodySmall,
        ),
        const SizedBox(height: Space.s),
        Wrap(
          spacing: Space.s,
          runSpacing: 4,
          children: [
            StatusChip(
              key: const Key('issueStatusChip'),
              label: issueStatusLabels[st] ?? st,
              colors: issueStatusColors(context, st),
            ),
            StatusChip(
              label: issueSeverityLabels[sev] ?? sev,
              colors: severityColors(context, sev),
            ),
            StatusChip(
              label: issueStageLabels[stage] ?? stage,
              colors: context.statusColors.todo,
            ),
          ],
        ),
        const SizedBox(height: Space.m),
        if ('${i['description'] ?? ''}'.isNotEmpty) ...[
          Text('${i['description']}'),
          const SizedBox(height: Space.m),
        ],
        Card(
          child: Column(
            children: [
              ListTile(
                leading: InitialsAvatar(refName(i['owner']) ?? '?'),
                title: const Text('Owner'),
                subtitle: Text(refName(i['owner']) ?? 'No owner yet'),
              ),
              const Divider(indent: 56, height: 1),
              ListTile(
                leading: const Icon(Icons.person_outline),
                title: const Text('Reported by'),
                subtitle: Text(
                  contact != null
                      ? '${refName(contact)} (client contact)'
                      : (refName(i['reportedBy']) ?? '—'),
                ),
              ),
              const Divider(indent: 56, height: 1),
              ListTile(
                key: const Key('issueDue'),
                leading: const Icon(Icons.event_outlined),
                title: const Text('Due date'),
                subtitle: Text(
                  i['dueDate'] == null
                      ? 'Not set'
                      : '${shortYmd(i['dueDate'])}${i['dueManual'] == true ? '' : ' (from severity)'}${i['overdue'] == true ? ' · Overdue' : ''}',
                ),
              ),
              const Divider(indent: 56, height: 1),
              ListTile(
                leading: const Icon(Icons.category_outlined),
                title: const Text('Category'),
                subtitle: Text(_cat('${i['category']}')),
              ),
              if (i['resolution'] != null) ...[
                const Divider(indent: 56, height: 1),
                ListTile(
                  leading: const Icon(Icons.check_circle_outline),
                  title: const Text('Resolution'),
                  subtitle: Text('${i['resolution']}'),
                ),
              ],
            ],
          ),
        ),
        if (tasks.isNotEmpty) ...[
          const SizedBox(height: Space.m),
          Text('Linked tasks', style: t.titleSmall),
          for (final x in tasks)
            ListTile(
              key: Key('issueTask_${x['id']}'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.task_alt),
              title: Text('${x['name']}'),
              onTap: () => context.push('/tasks/${x['id']}'),
            ),
        ],
        const SizedBox(height: Space.m),
        Text('Comments & history', style: t.titleSmall),
        const SizedBox(height: Space.s),
        Card(
          key: const Key('issueActivity'),
          child: Column(
            children: [
              if (activity.isEmpty)
                const ListTile(title: Text('No comments yet.')),
              for (final (n, a) in activity.indexed) ...[
                if (n > 0) const Divider(indent: 56, height: 1),
                _activity(a),
              ],
            ],
          ),
        ),
        const SizedBox(height: Space.m),
        if (can['comment'] != false) ...[
          TextField(
            key: const Key('issueCommentField'),
            controller: _comment,
            minLines: 1,
            maxLines: 4,
            maxLength: 5000,
            decoration: InputDecoration(
              labelText: 'Add a comment',
              hintText: 'Write a comment…',
              filled: true,
              errorText: _commentError,
              suffixIcon: IconButton(
                key: const Key('issueCommentSend'),
                tooltip: 'Add comment',
                icon: const Icon(Icons.send),
                onPressed: _addComment,
              ),
            ),
          ),
        ],
        Wrap(
          spacing: Space.s,
          runSpacing: Space.s,
          children: [
            if (primary != null)
              FilledButton(
                key: const Key('issuePrimaryAction'),
                onPressed: () => _status(i, primary),
                child: Text(transitionLabel(st, primary)),
              ),
            if (transitions.length > 1)
              OutlinedButton(
                key: const Key('issueOtherStatus'),
                onPressed: () => _otherStatus(i),
                child: const Text('Other status changes'),
              ),
            if (can['edit'] == true)
              OutlinedButton(
                key: const Key('issueLinkTask'),
                onPressed: () => _linkTask(i),
                child: const Text('Link a task'),
              ),
          ],
        ),
      ],
    );
  }

  static String _cat(String c) =>
      const {
        'BUG': 'Bug',
        'CONFIGURATION': 'Configuration',
        'DATA': 'Data',
        'TRAINING': 'Training',
        'CHANGE_REQUEST': 'Change request',
        'OTHER': 'Other',
      }[c] ??
      c;

  Widget _activity(Json a) {
    final who = refName(a['actor']) ?? 'System';
    if (a['kind'] == 'COMMENT') {
      return ListTile(
        leading: InitialsAvatar(who),
        title: Text(who),
        subtitle: Text('${a['text']} · ${whenPh(a['at'])}'),
      );
    }
    final ch = jsonList(a['changes']);
    final status = ch.where((c) => c['field'] == 'status').firstOrNull;
    final title = switch (a['action']) {
      'issue_created' => 'Raised the issue',
      'issue_status_changed' => 'Changed the status',
      _ =>
        ch.any((c) => c['field'] == 'dueDate')
            ? 'Changed the due date'
            : 'Updated the issue',
    };
    final detail = [
      who,
      if (status != null)
        '${issueStatusLabels[status['old']] ?? status['old']} → ${issueStatusLabels[status['new']] ?? status['new']}',
      for (final c in ch.where((c) => c['field'] == 'dueDate'))
        shortYmd(c['new']),
      if (a['reason'] != null) '"${a['reason']}"',
      whenPh(a['at']),
    ].join(' · ');
    return ListTile(
      leading: const Icon(Icons.sync_alt),
      title: Text(title),
      subtitle: Text(detail),
    );
  }
}

/// 46 Raise issue: POST /projects/:id/issues.
class RaiseIssueScreen extends ConsumerStatefulWidget {
  const RaiseIssueScreen({super.key, this.projectId, this.taskId});
  final String? projectId, taskId;
  @override
  ConsumerState<RaiseIssueScreen> createState() => _RaiseIssueScreenState();
}

class _RaiseIssueScreenState extends ConsumerState<RaiseIssueScreen> {
  final _title = TextEditingController(), _desc = TextEditingController();
  String? _project, _severity, _stage, _owner, _contact, _task;
  Map<String, String> _errors = {};
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _project = widget.projectId;
    _task = widget.taskId;
  }

  @override
  void dispose() {
    _title.dispose();
    _desc.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final e = <String, String>{
      if (_project == null) 'project': 'Choose a project.',
      if (_title.text.trim().isEmpty) 'title': 'Title is required.',
      if (_desc.text.trim().isEmpty) 'description': 'Description is required.',
      if (_severity == null) 'severity': 'Choose a severity.',
      if (_stage == null) 'stage': 'Choose a stage.',
    };
    setState(() => _errors = e);
    if (e.isNotEmpty) return;
    setState(() => _busy = true);
    try {
      final id = await ref.read(p3RepositoryProvider).createIssue(_project!, {
        'title': _title.text.trim(),
        'description': _desc.text.trim(),
        'severity': _severity,
        'stage': _stage,
        'ownerId': _owner,
        'reportedByContactId': _contact,
        'taskIds': [?_task],
      });
      ref.invalidate(issuesProvider);
      ref.invalidate(taskIssuesProvider);
      if (mounted) context.pushReplacement('/issues/$id');
    } on ApiException catch (x) {
      setState(
        () => _errors = x.fields.isEmpty ? {'form': x.message} : x.fields,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _drop(
    String key,
    String label,
    String? value,
    Map<String, String> items,
    ValueChanged<String?> on, {
    String? errorKey,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: Space.m),
    child: DropdownMenu<String>(
      key: ValueKey('$key${items.length}'),
      expandedInsets: EdgeInsets.zero,
      label: Text(label),
      initialSelection: value,
      errorText: _errors[errorKey ?? ''],
      dropdownMenuEntries: [
        for (final e in items.entries)
          DropdownMenuEntry(value: e.key, label: e.value),
      ],
      onSelected: (v) => setState(() => on(v)),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final projects = ref.watch(projectsProvider).value ?? const <Project>[];
    final opts = _project == null
        ? null
        : ref.watch(issueOptionsProvider(_project!)).value;
    if (opts != null && _stage == null && opts['defaultStage'] != null) {
      _stage = '${opts['defaultStage']}';
    }
    return Scaffold(
      key: const Key('raiseIssueScreen'),
      appBar: AppBar(
        leading: BackOrUpButton(
          fallback: widget.projectId == null
              ? '/issues'
              : '/projects/${widget.projectId}',
          icon: Icons.close,
        ),
        title: const Text('Raise issue'),
        actions: [
          TextButton(
            key: const Key('raiseIssueSubmit'),
            onPressed: _busy ? null : _save,
            child: const Text('Raise'),
          ),
        ],
      ),
      body: ListView(
        key: const Key('raiseIssueList'),
        padding: const EdgeInsets.all(Space.m),
        children: [
          if (_errors['form'] != null)
            Padding(
              padding: const EdgeInsets.only(bottom: Space.m),
              child: Text(
                _errors['form']!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          _drop(
            'issueProjectField',
            'Project',
            _project,
            {for (final p in projects) p.id: p.name},
            (v) {
              _project = v;
              _owner = _contact = _task = null;
              _stage = null;
            },
            errorKey: 'project',
          ),
          TextField(
            key: const Key('issueTitleField'),
            controller: _title,
            maxLength: 200,
            decoration: InputDecoration(
              labelText: 'Title',
              filled: true,
              errorText: _errors['title'],
            ),
          ),
          const SizedBox(height: Space.s),
          TextField(
            key: const Key('issueDescriptionField'),
            controller: _desc,
            minLines: 3,
            maxLines: 6,
            decoration: InputDecoration(
              labelText: 'Description',
              filled: true,
              errorText: _errors['description'],
            ),
          ),
          const SizedBox(height: Space.m),
          _drop(
            'issueSeverityField',
            'Severity',
            _severity,
            issueSeverityLabels,
            (v) => _severity = v,
            errorKey: 'severity',
          ),
          _drop(
            'issueStageField',
            'Stage',
            _stage,
            issueStageLabels,
            (v) => _stage = v,
            errorKey: 'stage',
          ),
          if (opts != null) ...[
            _drop('issueOwnerField', 'Owner', _owner, {
              for (final u in jsonList(opts['users']))
                '${u['id']}': '${u['name']}',
            }, (v) => _owner = v),
            _drop(
              'issueContactField',
              'Reported by (client contact)',
              _contact,
              {
                for (final u in jsonList(opts['contacts']))
                  '${u['id']}': '${u['name']}',
              },
              (v) => _contact = v,
            ),
            _drop('issueTaskField', 'Linked task', _task, {
              for (final u in jsonList(opts['tasks']))
                '${u['id']}': '${u['name']}',
            }, (v) => _task = v),
          ],
        ],
      ),
    );
  }
}
