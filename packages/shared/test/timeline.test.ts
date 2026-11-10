import { describe, expect, it } from 'vitest';
import {
  brokenBannerLead,
  brokenDependencies,
  buildTimeline,
  isScheduled,
  mondayOnOrBefore,
  nextWorkingDayAfter,
  noDatesLine,
  phasesLockedAlert,
  savePhaseListSchema,
  shortVarianceLabel,
  timelineLinks,
  workingDayVariance,
  type TimelineTaskInput,
  type WorkCalendar,
} from '../src/index.js';

let n = 0;
const task = (over: Partial<TimelineTaskInput> & { id: string }): TimelineTaskInput => ({
  order: ++n,
  name: over.id,
  phaseId: null,
  phase: null,
  status: 'TODO',
  plannedStart: '2026-11-02',
  dueDate: '2026-11-06',
  isMilestone: false,
  dependsOn: [],
  owner: null,
  ...over,
});

const MON_HOLIDAY: WorkCalendar = {
  workingDays: [1, 2, 3, 4, 5],
  holidays: { '2026-11-16': 'REGULAR' },
};

describe('CR-22 B slice 1: scheduling basics', () => {
  it('FR-TL-02: a task needs both dates; a milestone with Finish = Start is scheduled', () => {
    expect(isScheduled({ plannedStart: '2026-11-02', dueDate: null })).toBe(false);
    expect(isScheduled({ plannedStart: null, dueDate: '2026-11-02' })).toBe(false);
    expect(isScheduled({ plannedStart: '2026-11-02', dueDate: '2026-11-02' })).toBe(true);
  });

  it('FR-TL-27 / AC-73.8: Friday finish, Monday holiday → Tuesday', () => {
    expect(nextWorkingDayAfter('2026-11-13', MON_HOLIDAY)).toBe('2026-11-17');
    expect(nextWorkingDayAfter('2026-11-11')).toBe('2026-11-12');
  });

  it('FR-TL-30: working-day variance, late positive, weekends skipped (UIE §2.1.1 examples)', () => {
    expect(workingDayVariance('2026-12-14', '2026-12-15')).toBe(1);
    expect(workingDayVariance('2026-12-14', '2026-12-16')).toBe(2);
    expect(workingDayVariance('2026-12-14', '2026-12-11')).toBe(-1);
    expect(workingDayVariance('2026-12-14', '2026-12-14')).toBe(0);
    expect(shortVarianceLabel(0)).toBe('On time');
    expect(shortVarianceLabel(1)).toBe('+1d');
    expect(shortVarianceLabel(-2)).toBe('\u22122d');
  });

  it('weeks start on Monday', () => {
    expect(mondayOnOrBefore('2026-11-11')).toBe('2026-11-09');
    expect(mondayOnOrBefore('2026-11-09')).toBe('2026-11-09');
    expect(mondayOnOrBefore('2026-11-15')).toBe('2026-11-09');
  });
});

describe('CR-22 B slice 1: dependency links (FR-TL-06, 07, 28; EC-190)', () => {
  it('AC-72.4 (Lead): broken only when the successor starts on or before the predecessor finish', () => {
    const a = task({ id: 'a', plannedStart: '2026-11-02', dueDate: '2026-11-06' }); // Fri
    const ok = task({
      id: 'ok',
      plannedStart: '2026-11-09',
      dependsOn: ['a'],
      dueDate: '2026-11-10',
    });
    const sameDay = task({
      id: 'same',
      plannedStart: '2026-11-06',
      dueDate: '2026-11-10',
      dependsOn: ['a'],
    });
    const before = task({
      id: 'before',
      plannedStart: '2026-11-05',
      dueDate: '2026-11-10',
      dependsOn: ['a'],
    });
    const weekend = task({
      id: 'sat',
      plannedStart: '2026-11-07',
      dueDate: '2026-11-10',
      dependsOn: ['a'],
    });
    const links = timelineLinks([a, ok, sameDay, before, weekend]);
    expect(links.map((l) => [l.to, l.state])).toEqual([
      ['ok', 'OK'],
      ['same', 'BROKEN'],
      ['before', 'BROKEN'],
      ['sat', 'OK'],
    ]);
    // The forecast (slice 2) starts a Saturday successor on the next working day, Monday.
    expect(links[3]!.earliestStart).toBe('2026-11-09');
  });

  it('links to an unscheduled or cancelled task are ignored, not broken', () => {
    const u = task({ id: 'u', plannedStart: null, dueDate: null });
    const c = task({ id: 'c', status: 'CANCELLED', dueDate: '2026-11-30' });
    const s = task({ id: 's', dependsOn: ['u', 'c', 'missing'] });
    expect(timelineLinks([u, c, s]).map((l) => l.state)).toEqual(['UNSCHEDULED', 'CANCELLED']);
  });

  it('AC-72.8: the task-form warning lists broken predecessors only', () => {
    const a = task({ id: 'a', order: 9, name: 'Data migration', dueDate: '2026-11-09' });
    const b = task({ id: 'b', order: 3, dueDate: '2026-11-02', plannedStart: '2026-11-02' });
    const res = brokenDependencies(
      { id: 'x', plannedStart: '2026-11-09', dueDate: '2026-11-11', dependsOn: ['a', 'b'] },
      [a, b],
    );
    // Starting the day after a Friday finish (a Saturday) is not broken.
    const fri = task({ id: 'f', dueDate: '2026-11-13' });
    expect(
      brokenDependencies(
        { id: 'x', plannedStart: '2026-11-14', dueDate: '2026-11-16', dependsOn: ['f'] },
        [fri],
      ),
    ).toEqual([]);
    expect(res).toEqual([{ id: 'a', order: 9, name: 'Data migration', finish: '2026-11-09' }]);
    expect(
      brokenDependencies({ id: 'x', plannedStart: null, dueDate: null, dependsOn: ['a'] }, [a]),
    ).toEqual([]);
  });
});

describe('CR-22 B slice 1: buildTimeline (FR-TL-01 to 05, 23; AC-72.1, 72.5, 73.7)', () => {
  const phases = [
    { id: 'p1', name: 'Initiation', targetDate: '2026-10-12' },
    { id: 'p2', name: 'Design', targetDate: '2026-10-30' },
    { id: 'p3', name: 'Add-ons', targetDate: '2026-12-18' },
    { id: 'p4', name: 'Empty', targetDate: '2026-12-01' },
  ];
  const tasks = [
    task({
      id: 't1',
      phase: 'Initiation',
      status: 'COMPLETED',
      plannedStart: '2026-10-05',
      dueDate: '2026-10-09',
    }),
    task({
      id: 't2',
      phase: 'initiation ',
      status: 'COMPLETED',
      plannedStart: '2026-10-06',
      dueDate: '2026-10-13',
    }),
    task({ id: 't3', phase: 'Design', plannedStart: '2026-10-13', dueDate: '2026-10-20' }),
    task({ id: 't4', phase: 'Design', plannedStart: null, dueDate: '2026-10-27' }),
    task({
      id: 't5',
      phase: 'Add-ons',
      status: 'CANCELLED',
      plannedStart: '2026-11-23',
      dueDate: '2026-12-04',
    }),
    task({
      id: 't6',
      phase: null,
      isMilestone: true,
      plannedStart: '2026-12-11',
      dueDate: '2026-12-11',
    }),
    task({ id: 't7', phase: 'Go-live', plannedStart: '2026-12-14', dueDate: '2026-12-16' }),
  ];
  const m = buildTimeline({ tasks, phases, plannedEndDate: '2026-12-14', today: '2026-11-11' });
  const g = (name: string) => m.groups.find((x) => x.name === name)!;

  it('groups by the phase list order, then text-only phases, No phase, and Unscheduled last', () => {
    expect(m.groups.map((x) => x.name)).toEqual([
      'Initiation',
      'Design',
      'Add-ons',
      'Empty',
      'Go-live',
      'No phase',
      'Unscheduled',
    ]);
    expect(g('Initiation').tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(g('Design').tasks.map((t) => t.id)).toEqual(['t3']);
    expect(g('Design').memberCount).toBe(2);
    expect(g('Unscheduled').tasks.map((t) => t.id)).toEqual(['t4']);
    expect(m.scheduledCount).toBe(6);
    expect(m.unscheduledCount).toBe(1);
    expect(m.milestoneCount).toBe(1);
  });

  it('phase summary, completion and variance vs its target date', () => {
    expect(g('Initiation')).toMatchObject({
      start: '2026-10-05',
      finish: '2026-10-13',
      complete: true,
      completedOn: '2026-10-13',
      variance: 1,
    });
    expect(g('Design')).toMatchObject({ complete: false, completedOn: null, variance: -8 });
  });

  it('A-53: a phase whose tasks are all cancelled has no completion and no summary bar', () => {
    expect(g('Add-ons')).toMatchObject({
      allCancelled: true,
      complete: false,
      completedOn: null,
      start: null,
      finish: null,
    });
    expect(g('Add-ons').tasks.map((t) => t.id)).toEqual(['t5']);
  });

  it('range covers bars, today and the target, padded to Mondays', () => {
    expect(m.range.start).toBe('2026-09-28');
    expect(m.range.end >= '2026-12-18').toBe(true);
  });

  it('tasks join their phase by id, so a renamed phase keeps its tasks', () => {
    const r = buildTimeline({
      tasks: [
        task({ id: 'x', phaseId: 'p9', phase: 'Old name' }),
        task({ id: 'y', phase: 'new NAME ' }),
      ],
      phases: [{ id: 'p9', name: 'New name', targetDate: null }],
      plannedEndDate: null,
      today: '2026-11-11',
    });
    expect(r.groups.map((g) => [g.name, g.tasks.map((t) => t.id)])).toEqual([
      ['New name', ['x', 'y']],
    ]);
  });

  it('No phase is left out when its only tasks are unscheduled', () => {
    const only = buildTimeline({
      tasks: [task({ id: 'x', plannedStart: null, dueDate: null })],
      phases: [],
      plannedEndDate: null,
      today: '2026-11-11',
    });
    expect(only.groups.map((x) => x.kind)).toEqual(['UNSCHEDULED']);
  });

  it('EC-188: no tasks → no groups but a range around today and the target', () => {
    const e = buildTimeline({
      tasks: [],
      phases: [],
      plannedEndDate: '2026-12-14',
      today: '2026-11-11',
    });
    expect(e.groups).toEqual([]);
    expect(e.scheduledCount).toBe(0);
    expect(e.range.start <= '2026-11-11' && e.range.end >= '2026-12-14').toBe(true);
  });
});

describe('CR-22 B slice 1: copy and schema', () => {
  it('UIE copy', () => {
    expect(brokenBannerLead(1)).toBe('1 broken dependency.');
    expect(brokenBannerLead(3)).toBe('3 broken dependencies.');
    expect(noDatesLine(1)).toBe('1 task has no dates yet.');
    expect(noDatesLine(2)).toBe('2 tasks have no dates yet.');
    expect(phasesLockedAlert('ON_HOLD')).toContain('This project is On hold.');
    expect(phasesLockedAlert('ACTIVE')).toContain('This project is Active.');
  });

  it('phase list schema needs names and YYYY-MM-DD targets', () => {
    expect(
      savePhaseListSchema.safeParse({ phases: [{ name: ' Design ', targetDate: '2026-10-30' }] })
        .success,
    ).toBe(true);
    expect(
      savePhaseListSchema.safeParse({ phases: [{ name: '', targetDate: null }] }).success,
    ).toBe(false);
    expect(
      savePhaseListSchema.safeParse({ phases: [{ name: 'X', targetDate: '30/10/2026' }] }).success,
    ).toBe(false);
  });
});
