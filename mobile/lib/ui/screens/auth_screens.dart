import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api_client.dart' show isPortalToken;
import '../../data/models.dart' show ApiException;
import '../../state/p3_providers.dart';

import 'package:go_router/go_router.dart';

import '../../data/models.dart';
import '../../data/ms_sign_in.dart';
import '../../state/providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/brand.dart';
import '../widgets/common.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    key: const Key('splashScreen'),
    body: Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Brand.purple, Brand.purpleLight],
        ),
      ),
      alignment: Alignment.center,
      child: const Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          BrandLogo(height: 72, white: true),
          SizedBox(height: Space.xxl),
          SizedBox.square(
            dimension: 28,
            child: CircularProgressIndicator(
              color: Colors.white,
              strokeWidth: 3,
            ),
          ),
        ],
      ),
    ),
  );
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
  void initState() {
    super.initState();
    // A Microsoft deep link can fail before this screen is built (cold start).
    _error = ref.read(msSignInErrorProvider);
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signInWithMicrosoft() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    ref.read(msSignInErrorProvider.notifier).set(null);
    try {
      await ref.read(msSignInProvider).start();
    } on MicrosoftSignInFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    ref.read(msSignInErrorProvider.notifier).set(null);
    try {
      await ref
          .read(authProvider.notifier)
          .login(_email.text.trim(), _password.text);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.status == 429) {
        // Rate limited → SnackBar with a friendly message.
        showError(
          context,
          'Too many sign-in attempts. Wait a few minutes, then try again.',
        );
      } else {
        setState(() => _error = e.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(msSignInErrorProvider, (prev, next) {
      if (next != null && mounted) setState(() => _error = next);
    });
    ref.listen(authProvider, (prev, next) {
      if (next.hasValue && next.value != null && mounted) {
        setState(() => _busy = false);
      }
    });
    final msAvailable = ref
        .watch(msAvailableProvider)
        .maybeWhen(data: (v) => v, orElse: () => false);
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
              const Align(
                alignment: Alignment.centerLeft,
                child: BrandLogo(height: 44),
              ),
              const SizedBox(height: Space.l),
              Text(
                'Sign in to OpsTrack',
                key: const Key('loginHeading'),
                style: t.headlineMedium,
              ),
              const SizedBox(height: Space.l),
              TextFormField(
                key: const Key('loginEmail'),
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                decoration: const InputDecoration(labelText: 'Work email'),
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Email is required.'
                    : null,
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
                    icon: Icon(
                      _obscure ? Icons.visibility_off : Icons.visibility,
                    ),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
                validator: (v) =>
                    (v == null || v.isEmpty) ? 'Password is required.' : null,
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
                  onPressed: () => showError(
                    context,
                    'Ask your administrator to send a reset link.',
                  ),
                  child: const Text('Forgot password?'),
                ),
              ),
              const SizedBox(height: Space.m),
              FilledButton(
                key: const Key('loginSubmit'),
                onPressed: _busy ? null : _submit,
                child: Text(_busy ? 'Signing in…' : 'Sign in'),
              ),
              if (msAvailable) ...[
                const SizedBox(height: Space.m),
                OutlinedButton(
                  key: const Key('loginMicrosoft'),
                  onPressed: _busy ? null : _signInWithMicrosoft,
                  child: const Text('Sign in with Microsoft'),
                ),
              ],
              const SizedBox(height: Space.l),
              Text(
                'New here? Open the invite link from your admin.',
                textAlign: TextAlign.center,
                style: t.bodySmall?.copyWith(color: s.onSurfaceVariant),
              ),
              const SizedBox(height: Space.xl),
              Text(
                Brand.footer,
                key: const Key('brandFooter'),
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
  // D6: client-portal (`ptl_`) tokens are web-only; never accept them here.
  late final Future<Map<String, dynamic>> _info =
      widget.token.isEmpty || isPortalToken(widget.token)
      ? Future.error(Exception())
      : ref.read(p3RepositoryProvider).verifyInvite(widget.token);

  @override
  void dispose() {
    _pw.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final ok =
        passwordRules(_pw.text).every((r) => r.$2) && _pw.text == _confirm.text;
    if (!ok) {
      return showError(
        context,
        'Check the password rules and that both passwords match.',
      );
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(authRepositoryProvider)
          .setupPassword(widget.token, _pw.text);
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
    return FutureBuilder(
      future: _info,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (snap.hasError) {
          final e = snap.error;
          return Scaffold(
            key: const Key('linkNotValidScreen'),
            body: ListView(
              padding: const EdgeInsets.all(Space.l),
              children: [
                const SizedBox(height: Space.xl),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: BrandLogo(height: 40),
                ),
                const SizedBox(height: Space.l),
                Text(
                  'Link not valid',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: Space.s),
                Text(
                  e is ApiException
                      ? e.message
                      : 'This link has expired. Ask an Admin for a new one.',
                ),
                const SizedBox(height: Space.l),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    key: const Key('backToSignIn'),
                    onPressed: () => context.go('/login'),
                    child: const Text('Back to sign in'),
                  ),
                ),
              ],
            ),
          );
        }
        final reset = snap.data?['purpose'] == 'RESET';
        return Scaffold(
          key: const Key('setPasswordScreen'),
          appBar: AppBar(
            title: Text(reset ? 'Choose a new password' : 'Set your password'),
          ),
          body: ListView(
            padding: const EdgeInsets.all(Space.l),
            children: [
              const Align(
                alignment: Alignment.centerLeft,
                child: BrandLogo(height: 40),
              ),
              const SizedBox(height: Space.l),
              Text(
                'Welcome to OpsTrack. Choose a password to finish setting up.',
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
                        Text(
                          label,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: Space.m),
              TextField(
                key: const Key('confirmPassword'),
                controller: _confirm,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Confirm password',
                ),
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
      },
    );
  }
}
