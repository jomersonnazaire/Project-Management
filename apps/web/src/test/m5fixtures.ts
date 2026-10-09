import type { TrackerDayDto, TrackerEntryDto } from '@xc8/shared';
import { PID } from './m2fixtures';

/** Milestone 5 tracker fixtures (Fri Oct 9, 2026, Philippine time). */
export const entry = (over: Partial<TrackerEntryDto> = {}): TrackerEntryDto => ({
  id: 'e1',
  kind: 'TASK',
  user: { id: 'me-MEMBER', name: 'Me MEMBER' },
  project: { id: PID, name: 'SAP B1 Rollout' },
  client: { id: 'c1', name: 'Acme Trading' },
  task: { id: 't1', name: 'Prepare UAT scripts' },
  title: null,
  date: '2026-10-09',
  startAt: '2026-10-09T02:30:00.000Z',
  endAt: '2026-10-09T03:45:00.000Z',
  running: false,
  minutes: 75,
  timed: true,
  autoStopped: false,
  activityType: { id: 'at1', name: 'Configuration' },
  module: 'Financials',
  location: { id: 'loc2', name: 'WFH' },
  locationOverridden: false,
  billable: true,
  type: 'EXECUTION',
  notes: 'Scenarios 1–6',
  locked: false,
  ...over,
});

export const trackerDay = (over: Partial<TrackerDayDto> = {}): TrackerDayDto => {
  const entries = over.entries ?? [entry()];
  return {
    user: { id: 'me-MEMBER', name: 'Me MEMBER' },
    date: '2026-10-09',
    location: { id: 'loc2', name: 'WFH' },
    status: 'OPEN',
    submittedAt: null,
    reopened: [],
    notSubmitted: false,
    weekLocked: false,
    totalMinutes: entries.reduce((s, e) => s + e.minutes, 0),
    own: true,
    can: { edit: true, submit: true, reopen: false },
    leave: null,
    ...over,
    entries,
  };
};
