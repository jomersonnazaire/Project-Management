import type { TimelineDto, TimelineTaskInput } from '@xc8/shared';
import { PID } from './m2fixtures';

const PHASE_IDS: Record<string, string> = { Initiation: 'ph1', Build: 'ph2', Spare: 'ph3' };

/** CR-22 Part B: a timeline like UIE's mockup (fake data, today Wed Nov 11, 2026). */
const t = (
  over: Partial<TimelineTaskInput> & { id: string; order: number; name: string },
): TimelineTaskInput => ({
  phase: null,
  // Tasks point at their phase record by id (Lead); `phase` is its name.
  phaseId: over.phase ? (PHASE_IDS[over.phase] ?? null) : null,
  status: 'TODO',
  plannedStart: '2026-11-02',
  dueDate: '2026-11-06',
  isMilestone: false,
  dependsOn: [],
  owner: { id: 'u1', name: 'Test PM' },
  ...over,
});

export const timelineDto = (over: Partial<TimelineDto> = {}): TimelineDto => ({
  project: {
    id: PID,
    name: 'SAP B1 Rollout',
    status: 'ACTIVE',
    archived: false,
    plannedEndDate: '2026-12-14',
  },
  today: '2026-11-11',
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: { '2026-11-30': 'REGULAR' },
    holidayNames: { '2026-11-30': 'Bonifacio Day' },
  },
  phases: [
    { id: 'ph1', name: 'Initiation', targetDate: '2026-10-12', taskCount: 2, documentCount: 0 },
    { id: 'ph2', name: 'Build', targetDate: '2026-12-04', taskCount: 3, documentCount: 0 },
    { id: 'ph3', name: 'Spare', targetDate: null, taskCount: 0, documentCount: 0 },
  ],
  tasks: [
    t({
      id: 'a1',
      order: 1,
      name: 'Project kickoff',
      phase: 'Initiation',
      status: 'COMPLETED',
      plannedStart: '2026-10-05',
      dueDate: '2026-10-05',
    }),
    t({
      id: 'a2',
      order: 2,
      name: 'Charter signed',
      phase: 'Initiation',
      status: 'COMPLETED',
      isMilestone: true,
      plannedStart: '2026-10-12',
      dueDate: '2026-10-12',
      dependsOn: ['a1'],
    }),
    t({
      id: 'b1',
      order: 3,
      name: 'Data migration scripts',
      phase: 'Build',
      plannedStart: '2026-10-29',
      dueDate: '2026-11-09',
      owner: { id: 'u2', name: 'Dev Two' },
    }),
    t({
      id: 'b2',
      order: 4,
      name: 'Load test data',
      phase: 'Build',
      plannedStart: '2026-11-09',
      dueDate: '2026-11-11',
      dependsOn: ['b1'],
    }),
    t({
      id: 'b3',
      order: 5,
      name: 'Data cutover',
      phase: 'Build',
      plannedStart: '2026-12-01',
      dueDate: '2026-12-03',
      dependsOn: ['u1'],
      owner: null,
    }),
    t({
      id: 'u1',
      order: 6,
      name: 'Security review',
      phase: null,
      plannedStart: null,
      dueDate: null,
    }),
  ],
  can: { plan: true, editPhaseTargets: true, editPhaseNames: false },
  ...over,
});
