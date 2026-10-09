import { formatHHMM, minutesBetween } from '@xc8/shared';
import { useEffect, useState } from 'react';
import { Button } from 'react-bootstrap';
import { useRunning, useTrackerMutation } from '../../api/trackerHooks';

/**
 * The running timer in the top bar on every page (doc 14 FR-ACT-03, §10): task or activity,
 * elapsed HH:MM and Time out. Elapsed time follows the server clock, not the browser's.
 */
export function RunningTimerPill({ enabled }: { enabled: boolean }) {
  const running = useRunning(enabled);
  const stop = useTrackerMutation();
  const entry = running.data?.entry ?? null;
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!entry) return;
    const t = setInterval(() => setTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [entry]);
  if (!entry?.startAt || !running.data) return null;
  // Server "now" plus the time since that answer arrived.
  const skew = new Date(running.data.now).getTime() - running.dataUpdatedAt;
  const minutes = minutesBetween(
    new Date(entry.startAt),
    new Date(Math.max(tick, running.dataUpdatedAt) + skew),
  );
  const label = entry.task?.name ?? entry.title ?? 'Timer';
  return (
    <div
      className="d-flex align-items-center gap-2 rounded-pill bg-label-success px-3 py-1 small text-nowrap"
      role="status"
      aria-label={`Timer running on ${label}: ${formatHHMM(minutes)}`}
      data-testid="running-timer"
    >
      <span className="notif-dot bg-success" aria-hidden="true" />
      <span className="text-truncate fw-medium" style={{ maxWidth: 180 }}>
        {label}
      </span>
      <span className="font-monospace">{formatHHMM(minutes)}</span>
      <Button
        size="sm"
        variant="outline-danger"
        className="py-0"
        disabled={stop.isPending}
        onClick={() => stop.mutate({ path: '/stop' })}
      >
        ■ Time out
      </Button>
    </div>
  );
}
