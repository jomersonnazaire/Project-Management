// P3 55–57: Profile (read-only supervisor / Report CC), Change password, Clients list + detail.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/p3.dart';
import '../../state/p3_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

const _roles = {
  'ADMIN': 'Admin',
  'PROJECT_MANAGER': 'Project Manager',
  'MEMBER': 'Member',
  'VIEWER': 'Viewer',
};

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    key: const Key('profileScreen'),
    appBar: AppBar(
      leading: const BackOrUpButton(fallback: '/more'),
      title: const Text('Profile'),
    ),
    body: AsyncView(
      value: ref.watch(profileProvider),
      onRetry: () => ref.invalidate(profileProvider),
      data: (u) {
        final t = Theme.of(context).textTheme;
        final cc = [
          for (final e in (u['reportCcEmails'] as List? ?? const [])) '$e',
        ];
        return ListView(
          key: const Key('profileList'),
          padding: const EdgeInsets.all(Space.m),
          children: [
            Center(child: InitialsAvatar('${u['name']}', radius: 32)),
            const SizedBox(height: Space.s),
            Text(
              '${u['name']}',
              textAlign: TextAlign.center,
              style: t.titleLarge,
            ),
            Text(
              [
                _roles[u['systemRole']] ?? u['systemRole'],
                u['jobRole'],
              ].whereType<String>().where((x) => x.isNotEmpty).join(' · '),
              textAlign: TextAlign.center,
              style: t.bodySmall,
            ),
            const SizedBox(height: Space.m),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: const Icon(Icons.mail_outline),
                    title: const Text('Email'),
                    subtitle: Text('${u['email'] ?? ''}'),
                  ),
                  const Divider(indent: 56, height: 1),
                  ListTile(
                    key: const Key('profileSupervisor'),
                    leading: const Icon(Icons.supervisor_account_outlined),
                    title: const Text('Direct supervisor'),
                    subtitle: Text(refName(u['supervisor']) ?? 'Not set'),
                    trailing: const Text('Set by Admin'),
                  ),
                  const Divider(indent: 56, height: 1),
                  ListTile(
                    key: const Key('profileCc'),
                    leading: const Icon(Icons.forward_to_inbox_outlined),
                    title: const Text('Report CC emails'),
                    subtitle: Text(cc.isEmpty ? 'None' : cc.join(', ')),
                    trailing: const Text('Set by Admin'),
                  ),
                  if (u['capacityHours'] != null) ...[
                    const Divider(indent: 56, height: 1),
                    ListTile(
                      leading: const Icon(Icons.timelapse),
                      title: const Text('Weekly capacity (hours)'),
                      subtitle: Text('${u['capacityHours']}'),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: Space.s),
            Text(
              'Ask an Admin to change your supervisor or Report CC emails.',
              style: t.bodySmall,
            ),
            const SizedBox(height: Space.m),
            OutlinedButton.icon(
              key: const Key('profileChangePassword'),
              icon: const Icon(Icons.lock_outline),
              label: const Text('Change password'),
              onPressed: () => context.push('/change-password'),
            ),
          ],
        );
      },
    ),
  );
}

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});
  @override
  ConsumerState<ChangePasswordScreen> createState() =>
      _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _cur = TextEditingController(),
      _new = TextEditingController(),
      _confirm = TextEditingController();
  Map<String, String> _e = {};
  bool _busy = false;
  @override
  void dispose() {
    _cur.dispose();
    _new.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final e = <String, String>{
      if (_cur.text.isEmpty) 'currentPassword': 'Enter your current password.',
      if (passwordProblem(_new.text) != null)
        'newPassword': passwordProblem(_new.text)!,
      if (_confirm.text != _new.text) 'confirm': 'The passwords don’t match.',
    };
    setState(() => _e = e);
    if (e.isNotEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(p3RepositoryProvider).changePassword(_cur.text, _new.text);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Password changed')));
      popOrGo(context, '/more');
    } on ApiException catch (x) {
      setState(() => _e = x.fields.isEmpty ? {'form': x.message} : x.fields);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _f(
    String key,
    String label,
    TextEditingController c,
    String err, {
    String? helper,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: Space.m),
    child: TextField(
      key: Key(key),
      controller: c,
      obscureText: true,
      decoration: InputDecoration(
        labelText: label,
        helperText: helper,
        errorText: _e[err],
        filled: true,
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    key: const Key('changePasswordScreen'),
    appBar: AppBar(
      leading: const BackOrUpButton(fallback: '/more'),
      title: const Text('Change password'),
    ),
    body: ListView(
      padding: const EdgeInsets.all(Space.m),
      children: [
        if (_e['form'] != null)
          Padding(
            padding: const EdgeInsets.only(bottom: Space.m),
            child: Text(
              _e['form']!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        _f('currentPassword', 'Current password', _cur, 'currentPassword'),
        _f(
          'newPassword',
          'New password',
          _new,
          'newPassword',
          helper: passwordPolicy[0].toUpperCase() + passwordPolicy.substring(1),
        ),
        _f('confirmPassword', 'Confirm new password', _confirm, 'confirm'),
        FilledButton(
          key: const Key('changePasswordSubmit'),
          onPressed: _busy ? null : _save,
          child: const Text('Change password'),
        ),
      ],
    ),
  );
}

class ClientsScreen extends ConsumerStatefulWidget {
  const ClientsScreen({super.key});
  @override
  ConsumerState<ClientsScreen> createState() => _ClientsScreenState();
}

class _ClientsScreenState extends ConsumerState<ClientsScreen> {
  String _q = '';
  @override
  Widget build(BuildContext context) => Scaffold(
    key: const Key('clientsScreen'),
    appBar: AppBar(
      leading: const BackOrUpButton(fallback: '/more'),
      title: const Text('Clients'),
    ),
    body: AsyncView(
      value: ref.watch(clientsProvider),
      onRetry: () => ref.invalidate(clientsProvider),
      data: (all) {
        final list = all
            .where(
              (c) => '${c['name']}'.toLowerCase().contains(_q.toLowerCase()),
            )
            .toList();
        return ListView(
          key: const Key('clientsList'),
          padding: const EdgeInsets.all(Space.m),
          children: [
            TextField(
              key: const Key('clientSearch'),
              decoration: const InputDecoration(
                hintText: 'Search clients…',
                prefixIcon: Icon(Icons.search),
                filled: true,
              ),
              onChanged: (v) => setState(() => _q = v),
            ),
            const SizedBox(height: Space.s),
            if (list.isEmpty)
              const ListTile(title: Text('No clients match your search.')),
            for (final c in list)
              ListTile(
                key: Key('client_${c['id']}'),
                leading: InitialsAvatar('${c['name']}'),
                title: Text('${c['name']}'),
                subtitle: Text(
                  [
                    c['industry'],
                    '${c['contactCount']} contacts',
                    '${c['projectCount']} projects',
                  ].whereType<String>().join(' · '),
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/clients/${c['id']}'),
              ),
          ],
        );
      },
    ),
  );
}

class ClientDetailScreen extends ConsumerWidget {
  const ClientDetailScreen({super.key, required this.clientId});
  final String clientId;

  Future<void> _addContact(BuildContext context, WidgetRef ref) async {
    final name = TextEditingController(),
        pos = TextEditingController(),
        email = TextEditingController(),
        phone = TextEditingController();
    Map<String, String> e = {};
    await showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: EdgeInsets.fromLTRB(
            Space.m,
            Space.m,
            Space.m,
            MediaQuery.viewInsetsOf(ctx).bottom + Space.m,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Add contact', style: Theme.of(ctx).textTheme.titleMedium),
                const SizedBox(height: Space.m),
                TextField(
                  key: const Key('contactName'),
                  controller: name,
                  decoration: InputDecoration(
                    labelText: 'Name *',
                    errorText: e['name'],
                  ),
                ),
                TextField(
                  key: const Key('contactPosition'),
                  controller: pos,
                  decoration: const InputDecoration(labelText: 'Position'),
                ),
                TextField(
                  key: const Key('contactEmail'),
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: InputDecoration(
                    labelText: 'Email',
                    errorText: e['email'],
                  ),
                ),
                TextField(
                  key: const Key('contactPhone'),
                  controller: phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Phone'),
                ),
                const SizedBox(height: Space.m),
                FilledButton(
                  key: const Key('contactSave'),
                  onPressed: () async {
                    try {
                      await ref.read(p3RepositoryProvider).addContact(
                        clientId,
                        {
                          'name': name.text.trim(),
                          if (pos.text.trim().isNotEmpty)
                            'position': pos.text.trim(),
                          if (email.text.trim().isNotEmpty)
                            'email': email.text.trim(),
                          if (phone.text.trim().isNotEmpty)
                            'phone': phone.text.trim(),
                        },
                      );
                      ref.invalidate(clientContactsProvider(clientId));
                      ref.invalidate(clientProvider(clientId));
                      ref.invalidate(clientsProvider);
                      if (ctx.mounted) Navigator.pop(ctx);
                    } on ApiException catch (x) {
                      set(
                        () => e = x.fields.isEmpty
                            ? {'name': x.message}
                            : x.fields,
                      );
                    }
                  },
                  child: const Text('Add contact'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = ref.watch(clientProvider(clientId));
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        key: const Key('clientDetailScreen'),
        appBar: AppBar(
          leading: const BackOrUpButton(fallback: '/clients'),
          title: Text(c.value?['name'] as String? ?? 'Client'),
          bottom: const TabBar(
            tabs: [
              Tab(key: Key('clientTab_details'), text: 'Details'),
              Tab(key: Key('clientTab_contacts'), text: 'Contacts'),
              Tab(key: Key('clientTab_projects'), text: 'Projects'),
            ],
          ),
        ),
        body: AsyncView(
          value: c,
          onRetry: () => ref.invalidate(clientProvider(clientId)),
          data: (x) => TabBarView(
            children: [
              ListView(
                padding: const EdgeInsets.all(Space.m),
                children: [
                  Card(
                    child: Column(
                      children: [
                        ListTile(
                          title: const Text('Industry'),
                          subtitle: Text('${x['industry'] ?? '—'}'),
                        ),
                        ListTile(
                          title: const Text('Address'),
                          subtitle: Text('${x['address'] ?? '—'}'),
                        ),
                        if (x['notes'] != null)
                          ListTile(
                            title: const Text('Notes'),
                            subtitle: Text('${x['notes']}'),
                          ),
                        ListTile(
                          title: const Text('Status'),
                          subtitle: Text(
                            x['active'] == false ? 'Inactive' : 'Active',
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: Space.s),
                  Text(
                    'Editing a client is on the web app.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
              AsyncView(
                value: ref.watch(clientContactsProvider(clientId)),
                data: (cs) => ListView(
                  key: const Key('clientContactsList'),
                  padding: const EdgeInsets.all(Space.m),
                  children: [
                    if (cs.isEmpty)
                      const ListTile(title: Text('No contacts yet.')),
                    for (final k in cs)
                      ListTile(
                        key: Key('contact_${k['id']}'),
                        leading: InitialsAvatar('${k['name']}'),
                        title: Text('${k['name']}'),
                        subtitle: Text(
                          [
                            k['position'],
                            k['email'],
                            k['phone'],
                          ].whereType<String>().join(' · '),
                        ),
                      ),
                    const SizedBox(height: Space.s),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        key: const Key('addClientContact'),
                        icon: const Icon(Icons.person_add_alt),
                        label: const Text('Add contact'),
                        onPressed: () => _addContact(context, ref),
                      ),
                    ),
                  ],
                ),
              ),
              AsyncView(
                value: ref.watch(clientProjectsProvider(clientId)),
                data: (ps) => ListView(
                  padding: const EdgeInsets.all(Space.m),
                  children: [
                    if (ps.isEmpty)
                      const ListTile(title: Text('No projects yet.')),
                    for (final p in ps)
                      ListTile(
                        key: Key('clientProject_${p['id']}'),
                        title: Text('${p['name']}'),
                        subtitle: Text(
                          [
                            ProjectStatus.fromApi('${p['status']}').label,
                            if (p['progress'] != null) '${_n(p['progress'])}%',
                          ].join(' · '),
                        ),
                        onTap: () => context.go('/projects/${p['id']}'),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _n(Object? v) => v is num ? '${v.round()}' : '$v';
}
