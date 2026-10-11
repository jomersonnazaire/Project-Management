import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

class _Logo extends StatelessWidget {
  const _Logo({this.size = 56, this.inverse = false});
  final double size;
  final bool inverse;
  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: inverse ? s.onPrimary : s.primary,
        borderRadius: BorderRadius.circular(size / 4),
      ),
      child: Text(
        'X8',
        style: TextStyle(
          color: inverse ? s.primary : s.onPrimary,
          fontWeight: FontWeight.w700,
          fontSize: size * .36,
        ),
      ),
    );
  }
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Scaffold(
      key: const Key('splashScreen'),
      backgroundColor: s.primary,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const _Logo(size: 72, inverse: true),
            const SizedBox(height: Space.l),
            Text(
              'Xceler8 PM',
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: s.onPrimary),
            ),
            const SizedBox(height: Space.xs),
            Text('Implementation Tracker', style: TextStyle(color: s.onPrimary.withValues(alpha: .8))),
            const SizedBox(height: Space.xxl),
            CircularProgressIndicator(color: s.onPrimary),
          ],
        ),
      ),
    );
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true, _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).login(_email.text.trim(), _password.text);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.status == 429) {
        showError(context, e.message); // rate limited → SnackBar
      } else {
        setState(() => _error = e.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final s = Theme.of(context).colorScheme;
    return Scaffold(
      key: const Key('loginScreen'),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(Space.l),
            children: [
              const SizedBox(height: Space.l),
              const Align(alignment: Alignment.centerLeft, child: _Logo(size: 48)),
              const SizedBox(height: Space.l),
              Text('Welcome back', style: t.headlineMedium),
              const SizedBox(height: Space.s),
              Text(
                'Sign in to keep your implementations on track.',
                style: t.bodyMedium?.copyWith(color: s.onSurfaceVariant),
              ),
              const SizedBox(height: Space.l),
              TextFormField(
                key: const Key('loginEmail'),
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                decoration: const InputDecoration(labelText: 'Work email'),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Email is required.' : null,
              ),
              const SizedBox(height: Space.m),
              TextFormField(
                key: const Key('loginPassword'),
                controller: _password,
                obscureText: _obscure,
                autofillHints: const [AutofillHints.password],
                onFieldSubmitted: (_) => _submit(),
                decoration: InputDecoration(
                  labelText: 'Password',
                  suffixIcon: IconButton(
                    tooltip: _obscure ? 'Show password' : 'Hide password',
                    icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
                validator: (v) => (v == null || v.isEmpty) ? 'Password is required.' : null,
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: Space.s),
                  child: Text(
                    _error!,
                    key: const Key('loginError'),
                    style: TextStyle(color: s.error),
                  ),
                ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => showError(context, 'Ask your administrator to send a reset link.'),
                  child: const Text('Forgot password?'),
                ),
              ),
              const SizedBox(height: Space.m),
              FilledButton(
                key: const Key('loginSubmit'),
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Sign in'),
              ),
              const SizedBox(height: Space.l),
              Text(
                'New here? Open the invite link from your admin.',
                textAlign: TextAlign.center,
                style: t.bodySmall?.copyWith(color: s.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Password policy from packages/shared/src/password.ts: 8+ chars, a number, a symbol.
List<(String, bool)> passwordRules(String p) => [
  ('8+ characters', p.length >= 8),
  ('A number', RegExp(r'\d').hasMatch(p)),
  ('A symbol', RegExp(r'[^A-Za-z0-9]').hasMatch(p)),
];

class SetPasswordScreen extends ConsumerStatefulWidget {
  const SetPasswordScreen({super.key, required this.token});
  final String token;
  @override
  ConsumerState<SetPasswordScreen> createState() => _SetPasswordScreenState();
}

class _SetPasswordScreenState extends ConsumerState<SetPasswordScreen> {
  final _pw = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _pw.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final ok = passwordRules(_pw.text).every((r) => r.$2) && _pw.text == _confirm.text;
    if (!ok) return showError(context, 'Check the password rules and that both passwords match.');
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).setupPassword(widget.token, _pw.text);
      if (mounted) {
        showError(context, 'Password set. Please sign in.');
        context.go('/login');
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Scaffold(
      key: const Key('setPasswordScreen'),
      appBar: AppBar(title: const Text('Set your password')),
      body: ListView(
        padding: const EdgeInsets.all(Space.l),
        children: [
          Text(
            'Welcome! Your admin invited you to Xceler8 PM. Choose a password to finish setting up.',
            style: TextStyle(color: s.onSurfaceVariant),
          ),
          const SizedBox(height: Space.l),
          TextField(
            key: const Key('newPassword'),
            controller: _pw,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'New password'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: Space.s),
          Wrap(
            spacing: Space.m,
            children: [
              for (final (label, ok) in passwordRules(_pw.text))
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      ok ? Icons.check : Icons.close,
                      size: 16,
                      color: ok ? Colors.green.shade700 : s.outline,
                    ),
                    const SizedBox(width: 4),
                    Text(label, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
            ],
          ),
          const SizedBox(height: Space.m),
          TextField(
            key: const Key('confirmPassword'),
            controller: _confirm,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Confirm password'),
          ),
          const SizedBox(height: Space.l),
          FilledButton(
            key: const Key('setPasswordSubmit'),
            onPressed: _busy ? null : _submit,
            child: const Text('Set password & continue'),
          ),
        ],
      ),
    );
  }
}
