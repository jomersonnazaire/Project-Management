import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/dar_send.dart';
import '../../data/models.dart';
import '../../data/ph_time.dart';
import '../../data/tracker_models.dart';
import '../../state/v2_providers.dart';
import '../../theme/app_theme.dart';
import '../widgets/common.dart';

/// PR #35 badge: "Sent · Oct 21, 2026, 09:52 AM (UTC+8) · 2 recipients" / "Not sent".
/// Hidden when the API doesn't report send status yet.
class SentStatusBadge extends StatelessWidget {
  const SentStatusBadge({super.key, required this.report});
  final SavedReport report;
  @override
  Widget build(BuildContext context) {
    if (!report.sentKnown) return const SizedBox.shrink();
    final sc = context.statusColors;
    return StatusChip(
      key: Key('sentStatus_${report.id}'),
      label: sentStatusLabel(report),
      colors: report.sentAt != null ? sc.done : sc.todo,
    );
  }
}

String sentStatusLabel(SavedReport r) {
  final at = r.sentAt;
  if (at == null) return 'Not sent';
  final n = r.sentRecipientCount;
  final who = n == null ? '' : ' · $n ${n == 1 ? 'recipient' : 'recipients'}';
  return 'Sent · ${phDateTime(at)} (UTC+8)$who';
}

/// Saved-report detail: Send by email (Microsoft-linked users) or Notify supervisor.
class DarSendCard extends ConsumerStatefulWidget {
  const DarSendCard({super.key, required this.report});
  final SavedReport report;
  @override
  ConsumerState<DarSendCard> createState() => _DarSendCardState();
}

class _DarSendCardState extends ConsumerState<DarSendCard> {
  bool _busy = false;

  /// A send was started and we're waiting for the browser to return.
  bool _awaiting = false;
  DateTime? _startedAt;
  String? _error;
  String? _info;
  late final AppLifecycleListener _life = AppLifecycleListener(
    onResume: _onResume,
  );
  Timer? _resumeTimer;

  @override
  void initState() {
    super.initState();
    _life;
    // A result that arrived before this screen was built (cold start from the link).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final r = mounted ? ref.read(darSendResultProvider) : null;
      if (r != null) _onResult(r);
    });
  }

  @override
  void dispose() {
    _resumeTimer?.cancel();
    _life.dispose();
    super.dispose();
  }

  String get _id => widget.report.id;

  /// Back in the app without a deep link (browser closed, bad/expired state): after a short
  /// grace period, re-read the report and treat it as not sent unless `sentAt` moved.
  void _onResume() {
    if (!_awaiting) return;
    _resumeTimer?.cancel();
    _resumeTimer = Timer(const Duration(seconds: 3), () async {
      if (!mounted || !_awaiting) return;
      // The confirm result is on its way.
      if (ref.read(darMailSendProvider).busy) return;
      final confirmed = await _sentConfirmed();
      if (!mounted || !_awaiting) return;
      setState(() {
        _awaiting = false;
        if (confirmed == true) {
          _info = _sentMessage();
        } else {
          _error = darNoResult;
        }
      });
    });
  }

  /// PR #35: true if the server recorded a send after we started, null if unknown.
  Future<bool?> _sentConfirmed() async {
    ref.invalidate(savedReportProvider(_id));
    ref.invalidate(savedReportsProvider);
    try {
      final fresh = await ref.read(savedReportProvider(_id).future);
      if (!fresh.sentKnown) return null;
      final at = fresh.sentAt;
      final since = _startedAt?.subtract(const Duration(minutes: 1));
      return at != null && (since == null || at.isAfter(since));
    } catch (_) {
      return null;
    }
  }

  String _sentMessage() {
    final to = ref.read(darSendStatusProvider).value?.to?.name;
    return to == null || to.isEmpty
        ? 'Report sent from your Outlook.'
        : 'Report sent to $to from your Outlook.';
  }

  /// From the app's confirm call (POST /auth/mobile/mail/confirm), never from a bare link.
  void _onResult(DarSendResult r) {
    if (r.reportId.isNotEmpty && r.reportId != _id) return;
    if (r.reportId.isEmpty && !_awaiting) return;
    ref.read(darSendResultProvider.notifier).set(null);
    _resumeTimer?.cancel();
    ref.invalidate(savedReportProvider(_id));
    ref.invalidate(savedReportsProvider);
    setState(() {
      _awaiting = false;
      if (r.sent) {
        _error = null;
        _info = _sentMessage();
      } else {
        _info = null;
        _error = darSendMessage(r.reason);
      }
    });
  }

  Future<void> _send(DarSendStatus st) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('darSendConfirm'),
        title: const Text('Send this report?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'To: ${st.to?.name ?? ''}${(st.to?.email ?? '').isEmpty ? '' : ' <${st.to!.email}>'}',
              key: const Key('darSendTo'),
            ),
            if (st.cc.isNotEmpty)
              Text('CC: ${st.cc.join(', ')}', key: const Key('darSendCc')),
            const SizedBox(height: Space.s),
            const Text(
              'Microsoft opens in your browser to confirm. The email goes from your own Outlook with the report as a PDF.',
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('darSendContinue'),
            style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      final url = await ref.read(darMailSendProvider).begin(_id);
      final opened = await ref.read(externalLauncherProvider)(url);
      if (!mounted) return;
      setState(() {
        _busy = false;
        if (opened) {
          _awaiting = true;
          _startedAt = DateTime.now().toUtc();
        } else {
          _error = "Couldn't open the browser. Try again.";
        }
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = darApiErrorMessage(e);
      });
      ref.invalidate(darSendStatusProvider);
    }
  }

  Future<void> _notify() async {
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await ref.read(darSendRepositoryProvider).notifySupervisor(_id);
      if (!mounted) return;
      final to = ref.read(darSendStatusProvider).value?.to?.name;
      setState(() {
        _busy = false;
        _info = to == null || to.isEmpty
            ? 'Your supervisor was notified that this report is ready.'
            : '$to was notified that this report is ready.';
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = darApiErrorMessage(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final sc = context.statusColors;
    ref.listen(darSendResultProvider, (_, next) {
      if (next != null) _onResult(next);
    });
    final status = ref.watch(darSendStatusProvider);
    final st = status.value;
    Widget body;
    if (st == null) {
      body = status.hasError
          ? Text(
              "Couldn't check email sending. Pull to refresh or try again later.",
              style: t.bodySmall,
            )
          : const LinearProgressIndicator();
    } else if (st.enabled) {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'To: ${st.to?.name ?? ''}${st.cc.isEmpty ? '' : ' · CC: ${st.cc.length}'}',
            key: const Key('darSendSummary'),
            style: t.bodySmall,
          ),
          const SizedBox(height: Space.s),
          FilledButton.icon(
            key: const Key('darSend'),
            icon: const Icon(Icons.send_outlined),
            label: Text(_awaiting ? 'Waiting for Microsoft…' : 'Send'),
            onPressed: _busy || _awaiting ? null : () => _send(st),
          ),
          if (_awaiting)
            TextButton(
              key: const Key('darSendCancelWait'),
              onPressed: () => setState(() {
                _awaiting = false;
                _error = darNoResult;
              }),
              child: const Text("I closed the browser"),
            ),
        ],
      );
    } else {
      final notify = st.canNotify || st.reason == 'not_linked';
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            darSendMessage(st.reason),
            key: const Key('darSendUnavailable'),
            style: t.bodyMedium,
          ),
          if (st.reason == 'not_linked' && st.to == null) ...[
            const SizedBox(height: Space.xs),
            Text(
              darNoSupervisor,
              key: const Key('darNoSupervisor'),
              style: t.bodySmall,
            ),
          ],
          if (notify && st.reason != 'no_supervisor' && st.to != null) ...[
            const SizedBox(height: Space.s),
            OutlinedButton.icon(
              key: const Key('darNotifySupervisor'),
              icon: const Icon(Icons.notifications_outlined),
              label: const Text('Notify supervisor'),
              onPressed: _busy ? null : _notify,
            ),
          ],
        ],
      );
    }
    return Card(
      key: const Key('darSendCard'),
      child: Padding(
        padding: const EdgeInsets.all(Space.m),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Email this report', style: t.titleSmall),
            // Own line: "Sent · <date, time> (UTC+8) · N recipients" is too long to share a row.
            if (widget.report.sentKnown) ...[
              const SizedBox(height: Space.xs),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: SentStatusBadge(report: widget.report),
              ),
            ],
            const SizedBox(height: Space.s),
            body,
            if (_info != null)
              Padding(
                padding: const EdgeInsets.only(top: Space.s),
                child: Container(
                  key: const Key('darSendInfo'),
                  padding: const EdgeInsets.all(Space.s),
                  color: sc.done.container,
                  child: Text(
                    _info!,
                    style: t.bodyMedium?.copyWith(color: sc.done.onContainer),
                  ),
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: Space.s),
                child: Container(
                  key: const Key('darSendError'),
                  padding: const EdgeInsets.all(Space.s),
                  color: Theme.of(context).colorScheme.errorContainer,
                  child: Text(
                    _error!,
                    style: t.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onErrorContainer,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
