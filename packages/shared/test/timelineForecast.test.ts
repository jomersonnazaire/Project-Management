import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  doneFinish,
  floatLabel,
  forecastSchedule,
  forecastVarianceBadge,
  previousWorkingDayBefore,
  saveBaselineSchema,
  taskFlags,
  timelineLinks,
  workingDayOnOrAfter,
  workingDuration,
  type TimelineTaskInput,
  type WorkCalendar,
} from '../src/index.js';

/** CR-22 Part B slice 2: forecast, critical path, delays, variance (FR-TL-08 to 13, 27 to 31). */
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

describe('CR-22 B slice 2: calendar helpers', () => {
  it('rolls to working days and counts working-day durations (both ends included)', () => {
    expect(workingDayOnOrAfter('2026-11-14')).toBe('2026-11-16');
    expect(workingDayOnOrAfter('2026-11-13')).toBe('2026-11-13');
    expect(previousWorkingDayBefore('2026-11-16')).toBe('2026-11-13');
    expect(previousWorkingDayBefore('2026-11-17', MON_HOLIDAY)).toBe('2026-11-13');
    expect(workingDuration('2026-11-09', '2026-11-13')).toBe(5);
    expect(workingDuration('2026-11-14', '2026-11-17')).toBe(2);
    expect(workingDuration('2026-11-09', '2026-11-09')).toBe(1);
  });
});

describe('CR-22 B slice 2: forecast (FR-TL-27, 29, 31)', () => {
  it('AC-73.8: predecessor finishes Friday, Monday is a holiday: the successor starts Tuesday', () => {
    const a = task({
      id: 'a',
      status: 'IN_PROGRESS',
      plannedStart: '2026-11-09',
      dueDate: '2026-11-13',
    });
    const b = task({
      id: 'b',
      plannedStart: '2026-11-10',
      dueDate: '2026-11-10',
      dependsOn: ['a'],
    });
    const f = forecastSchedule([a, b], '2026-11-11', MON_HOLIDAY);
    expect(f.byId.a!.finish).toBe('2026-11-13');
    expect(f.byId.b).toMatchObject({ start: '2026-11-17', finish: '2026-11-17' });
  });

  it('AC-73.10: Completed uses actual finish; In progress past due forecasts today; a late start starts today and keeps its working-day length', () => {
    const today = '2026-11-11';
    const f = forecastSchedule(
      [
        task({
          id: 'done',
          status: 'COMPLETED',
          actualStart: '2026-11-02',
          actualFinish: '2026-11-05',
        }),
        task({
          id: 'wip',
          status: 'IN_PROGRESS',
          plannedStart: '2026-11-02',
          dueDate: '2026-11-09',
        }),
        task({ id: 'late', plannedStart: '2026-11-03', dueDate: '2026-11-05' }),
        task({
          id: 'after',
          plannedStart: '2026-11-04',
          dueDate: '2026-11-04',
          dependsOn: ['wip'],
        }),
      ],
      today,
    );
    expect(f.byId.done).toMatchObject({ start: '2026-11-02', finish: '2026-11-05', done: true });
    expect(f.byId.wip).toMatchObject({ start: '2026-11-02', finish: '2026-11-11' });
    expect(f.byId.late).toMatchObject({ start: '2026-11-11', finish: '2026-11-13' });
    expect(f.byId.after).toMatchObject({ start: '2026-11-12', finish: '2026-11-12' });
    expect(f.end).toBe('2026-11-13');
  });

  it('FR-TL-07 (Lead): a Saturday start after a Friday finish is not broken, and forecasts from Monday', () => {
    const a = task({
      id: 'a',
      status: 'IN_PROGRESS',
      plannedStart: '2026-11-09',
      dueDate: '2026-11-13',
    });
    const b = task({
      id: 'b',
      plannedStart: '2026-11-14',
      dueDate: '2026-11-17',
      dependsOn: ['a'],
    });
    expect(timelineLinks([a, b])[0]!.state).toBe('OK');
    expect(forecastSchedule([a, b], '2026-11-11').byId.b).toMatchObject({
      start: '2026-11-16',
      finish: '2026-11-17',
    });
  });

  it('FR-TL-28 / EC-188: unscheduled and cancelled tasks are left out; nothing scheduled means no forecast', () => {
    const f = forecastSchedule(
      [
        task({ id: 'u', plannedStart: null, dueDate: '2026-12-30' }),
        task({ id: 'c', status: 'CANCELLED', dueDate: '2026-12-30' }),
      ],
      '2026-11-11',
    );
    expect(f).toEqual({ byId: {}, end: null });
    const g = forecastSchedule(
      [
        task({ id: 'u', plannedStart: null, dueDate: '2026-12-30' }),
        task({ id: 'b', plannedStart: '2026-11-12', dueDate: '2026-11-12', dependsOn: ['u'] }),
      ],
      '2026-11-11',
    );
    expect(g.byId.b!.start).toBe('2026-11-12');
  });

  it('survives a dependency cycle (blocked by the API) without looping', () => {
    const f = forecastSchedule(
      [
        task({ id: 'a', plannedStart: '2026-11-12', dueDate: '2026-11-12', dependsOn: ['b'] }),
        task({ id: 'b', plannedStart: '2026-11-12', dueDate: '2026-11-12', dependsOn: ['a'] }),
      ],
      '2026-11-11',
    );
    expect(Object.keys(f.byId).sort()).toEqual(['a', 'b']);
  });

  it('AC-73.12: phase completion uses actual finish, else the date marked Done, else the due date', () => {
    expect(
      doneFinish({ actualFinish: '2026-11-03', doneOn: '2026-11-04', dueDate: '2026-11-05' }),
    ).toBe('2026-11-03');
    expect(doneFinish({ actualFinish: null, doneOn: '2026-11-04', dueDate: '2026-11-05' })).toBe(
      '2026-11-04',
    );
    expect(doneFinish({ actualFinish: null, doneOn: null, dueDate: '2026-11-05' })).toBe(
      '2026-11-05',
    );
  });
});

describe('CR-22 B slice 2: critical path (FR-TL-12)', () => {
  it('AC-73.13: on A → B → C with A Done, B and C are critical and A is not; a side task has float', () => {
    const tasks = [
      task({
        id: 'A',
        status: 'COMPLETED',
        plannedStart: '2026-11-02',
        dueDate: '2026-11-06',
        actualFinish: '2026-11-06',
      }),
      task({ id: 'B', plannedStart: '2026-11-09', dueDate: '2026-11-13', dependsOn: ['A'] }),
      task({ id: 'C', plannedStart: '2026-11-16', dueDate: '2026-11-20', dependsOn: ['B'] }),
      task({ id: 'D', plannedStart: '2026-11-09', dueDate: '2026-11-10' }),
    ];
    const f = forecastSchedule(tasks, '2026-11-09');
    expect(f.end).toBe('2026-11-20');
    expect(f.byId.A).toMatchObject({ critical: false, float: null });
    expect(f.byId.B).toMatchObject({ critical: true, float: 0, lateFinish: '2026-11-13' });
    expect(f.byId.C).toMatchObject({ critical: true, float: 0 });
    expect(f.byId.D).toMatchObject({ critical: false, float: 8 });
    expect(floatLabel(0)).toBe('0 \u00b7 Critical');
    expect(floatLabel(1)).toBe('1 working day');
    expect(floatLabel(8)).toBe('8 working days');
  });

  it('AC-73.13: a Done task with no actual finish uses the FR-TL-31 fallback in the forecast', () => {
    const f = forecastSchedule(
      [
        task({
          id: 'A',
          status: 'COMPLETED',
          plannedStart: '2026-11-02',
          dueDate: '2026-11-06',
          doneOn: '2026-11-11',
        }),
        task({ id: 'B', plannedStart: '2026-11-09', dueDate: '2026-11-09', dependsOn: ['A'] }),
      ],
      '2026-11-09',
    );
    expect(f.byId.A!.finish).toBe('2026-11-11');
    expect(f.byId.B).toMatchObject({ start: '2026-11-12', critical: true });
  });
});

describe('CR-22 B slice 2: Delayed and Finished late (FR-TL-11, AC-73.3)', () => {
  const today = '2026-11-11';
  const flags = (t: TimelineTaskInput) =>
    taskFlags(t, forecastSchedule([t], today).byId[t.id], today);
  it('an open task past its planned finish is Delayed', () => {
    expect(flags(task({ id: 'x', status: 'IN_PROGRESS', dueDate: '2026-11-10' }))).toMatchObject({
      delayed: true,
      delayReason: 'PAST_DUE',
    });
  });
  it('an open task forecast after its baseline finish is Delayed, with the working-day variance', () => {
    const t = task({
      id: 'x',
      plannedStart: '2026-11-09',
      dueDate: '2026-11-12',
      baselineStart: '2026-11-02',
      baselineFinish: '2026-11-05',
    });
    // Starts today (Nov 11), 4 working days → Nov 16; baseline finish Nov 5 → +7.
    expect(flags(t)).toMatchObject({
      delayed: true,
      delayReason: 'FORECAST_AFTER_BASELINE',
      variance: 7,
    });
  });
  it('no baseline: judged on the planned finish only', () => {
    expect(
      flags(task({ id: 'x', plannedStart: '2026-11-12', dueDate: '2026-11-13' })),
    ).toMatchObject({ delayed: false, variance: null });
  });
  it('Completed after its baseline finish is Finished late, never Delayed; Cancelled is never flagged', () => {
    const done = task({
      id: 'x',
      status: 'COMPLETED',
      actualFinish: '2026-11-03',
      baselineFinish: '2026-10-29',
    });
    expect(flags(done)).toMatchObject({ delayed: false, finishedLate: true, variance: 3 });
    expect(flags(task({ id: 'c', status: 'CANCELLED', dueDate: '2026-10-01' }))).toMatchObject({
      delayed: false,
      finishedLate: false,
    });
  });
  it('an unscheduled task is judged on its due date if it has one', () => {
    expect(flags(task({ id: 'u', plannedStart: null, dueDate: '2026-11-02' })).delayed).toBe(true);
    expect(flags(task({ id: 'u', plannedStart: null, dueDate: null })).delayed).toBe(false);
  });
});

describe('CR-22 B slice 2: variance copy and the model (FR-TL-13, 30)', () => {
  it('AC-73.11: +3 / −2 working days, singular for one, On track for the same day', () => {
    expect(forecastVarianceBadge(3)).toEqual({ text: '+3 working days late', tone: 'danger' });
    expect(forecastVarianceBadge(-2)).toEqual({
      text: '\u22122 working days early',
      tone: 'success',
    });
    expect(forecastVarianceBadge(1).text).toBe('+1 working day late');
    expect(forecastVarianceBadge(-1).text).toBe('\u22121 working day early');
    expect(forecastVarianceBadge(0)).toEqual({ text: 'On track', tone: 'success' });
  });

  it('buildTimeline: forecast end vs target, counts, critical links, phase forecast, baseline flag', () => {
    const tasks = [
      task({
        id: 'a',
        phase: 'Build',
        status: 'IN_PROGRESS',
        plannedStart: '2026-12-07',
        dueDate: '2026-12-11',
        baselineFinish: '2026-12-11',
      }),
      task({
        id: 'b',
        phase: 'Build',
        plannedStart: '2026-12-14',
        dueDate: '2026-12-16',
        dependsOn: ['a'],
        baselineFinish: '2026-12-14',
      }),
      task({
        id: 'm',
        phase: 'Build',
        isMilestone: true,
        plannedStart: '2026-12-01',
        dueDate: '2026-12-01',
      }),
    ];
    const r = buildTimeline({
      tasks,
      phases: [{ id: 'p1', name: 'Build', targetDate: '2026-12-14' }],
      plannedEndDate: '2026-12-14',
      today: '2026-11-11',
    });
    expect(r.forecastEnd).toBe('2026-12-16');
    expect(r.forecastVariance).toBe(2);
    expect(r.delayedCount).toBe(1);
    expect(r.flags.b!.delayReason).toBe('FORECAST_AFTER_BASELINE');
    expect(r.criticalCount).toBe(2);
    expect(r.criticalLinks.map((l) => [l.from, l.to])).toEqual([['a', 'b']]);
    expect(r.groups[0]).toMatchObject({ forecastFinish: '2026-12-16', variance: 2 });
    expect(r.hasBaseline).toBe(true);
  });

  it('save baseline: the reason is optional and trimmed', () => {
    expect(saveBaselineSchema.parse({})).toEqual({});
    expect(saveBaselineSchema.parse({ reason: '  Signed off  ' })).toEqual({
      reason: 'Signed off',
    });
    expect(saveBaselineSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});
