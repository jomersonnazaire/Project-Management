import { formatHHMM } from '@xc8/shared';
import { useEffect, useState } from 'react';
import { Button } from 'react-bootstrap';
import { useRunning, useTrackerMutation } from '../../api/trackerHooks';

/**
 * The running timer in the top bar on every page (doc 14 FR-ACT-03, §10): task or activity,
 * elapsed HH:MM:SS (DR-31) and Time out. Elapsed time follows the server clock, not the browser's.
 * Below 576px only the dot, the time and an icon-only Time out remain (DR-24).
 */
function elapsedHMS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${formatHHMM(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export function RunningTimerPill({ enabled }: { enabled: boolean }) {
  const running = useRunning(enabled);
  const stop = useTrackerMutation();
  const entry = running.data?.entry ?? null;
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!entry) return;
    const t = setInterval(() => setTick(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [entry]);
  if (!entry?.startAt || !running.data) return null;
  // Server "now" plus the time since that answer arrived.
  const skew = new Date(running.data.now).getTime() - running.dataUpdatedAt;
  const seconds =
    (Math.max(tick, running.dataUpdatedAt) + skew - new Date(entry.startAt).getTime()) / 1000;
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const label = entry.task?.name ?? entry.title ?? 'Timer';
  return (
    <div
      className="timer-pill d-flex align-items-center gap-2 rounded-pill bg-label-success px-3 py-1 small text-nowrap"
      role="status"
      aria-label={`Timer running on ${label}: ${formatHHMM(minutes)}`}
      data-testid="running-timer"
    >
      <span className="notif-dot bg-success timer-pulse" aria-hidden="true" />
      <span className="timer-pill-label text-truncate fw-medium">{label}</span>
      <span className="font-monospace">{elapsedHMS(seconds)}</span>
      <Button
        size="sm"
        variant="danger"
        className="py-0 timer-pill-stop"
        aria-label="Time out"
        title="Time out"
        disabled={stop.isPending}
        onClick={() => stop.mutate({ path: '/stop' })}
      >
        <span aria-hidden="true">■</span>
        <span className="timer-pill-stop-text ms-1">Time out</span>
      </Button>
    </div>
  );
}
