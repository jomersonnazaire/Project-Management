import { describe, expect, it } from 'vitest';
import {
  PM_PROJECT_EDIT_SCOPE,
  addWorkingDays,
  computeProject,
  createProjectSchema,
  effortSummary,
  effortVariance,
  findCycle,
  forecastEnd,
  formatHours,
  formatVariance,
  plural,
  moveWithinGroup,
  reorderTasksSchema,
  scheduleVarianceLabel,
  canViewProjectActivity,
  DEFAULT_ACCESS_RULES,
  parseDateOnly,
  progressPct,
  projectBadge,
  projectHealth,
  scheduleFromOffsets,
  templateActivitySchema,
  toDateOnly,
  updateTaskSchema,
  updateTemplateSchema,
  type CalcTask,
  type TaskStatus,
} from '../src/index.js';

const d = parseDateOnly;
const today = d('2026-10-09');
const t = (status: TaskStatus, due?: string, extra: Partial<CalcTask> = {}): CalcTask => ({
  status,
  dueDate: due ? d(due) : null,
  ...extra,
});

describe('progress (FR-PRJ-08, AC-11.1, EC-03)', () => {
  it('10 tasks, 2 cancelled, 4 completed = 50%; 0 tasks and all cancelled = 0%', () => {
    const tasks = [
      ...Array(4).fill(t('COMPLETED')),
      ...Array(2).fill(t('CANCELLED')),
      ...Array(4).fill(t('TODO')),
    ];
    expect(progressPct(tasks)).toBe(50);
    expect(progressPct([])).toBe(0);
    expect(progressPct([t('CANCELLED'), t('CANCELLED')])).toBe(0);
    expect(progressPct([t('COMPLETED'), t('TODO'), t('TODO')])).toBe(33);
  });
});

describe('forecast, variance and health (FR-PRJ-09/10, AC-11.2/11.3, G-1)', () => {
  it('forecast is the latest open due date, or today + remaining duration when overdue; baseline end without open tasks', () => {
    const end = d('2026-10-30');
    expect(toDateOnly(forecastEnd([], end, today))).toBe('2026-10-30');
    expect(
      toDateOnly(forecastEnd([t('TODO', '2026-11-04'), t('COMPLETED', '2026-12-01')], end, today)),
    ).toBe('2026-11-04');
    expect(
      toDateOnly(
        forecastEnd([t('TODO', '2026-10-05', { plannedStart: d('2026-10-01') })], end, today),
      ),
    ).toBe('2026-10-13');
    expect(
      toDateOnly(
        forecastEnd(
          [t('TODO', '2026-10-05', { plannedStart: d('2026-09-01') })],
          d('2026-10-01'),
          today,
        ),
      ),
    ).toBe('2026-11-12');
  });

  it('formats "+N days", "0 days", "−N days"', () => {
    expect([formatVariance(3), formatVariance(0), formatVariance(-2), formatVariance(1)]).toEqual([
      '+3 days',
      '0 days',
      '−2 days',
      '+1 day',
    ]);
  });

  it('evaluates Delayed, then At risk, then On track; On hold first', () => {
    expect(projectHealth('ACTIVE', 6, [], today)).toBe('DELAYED');
    expect(
      projectHealth('ACTIVE', 0, [t('BLOCKED', '2026-10-01', { mandatory: true })], today),
    ).toBe('DELAYED');
    expect(projectHealth('ACTIVE', 5, [], today)).toBe('AT_RISK');
    expect(projectHealth('ACTIVE', 1, [], today)).toBe('AT_RISK');
    // G-1: variance 0 and an overdue optional task = At risk.
    expect(projectHealth('ACTIVE', 0, [t('TODO', '2026-10-01', { mandatory: false })], today)).toBe(
      'AT_RISK',
    );
    expect(projectHealth('ACTIVE', 0, [t('TODO', '2026-10-20')], today)).toBe('ON_TRACK');
    expect(projectHealth('ACTIVE', -3, [], today)).toBe('ON_TRACK');
    expect(projectHealth('ON_HOLD', 10, [], today)).toBe('ON_HOLD');
    expect(computeProject('ACTIVE', d('2026-10-30'), [], today)).toMatchObject({
      progressPct: 0,
      scheduleVarianceDays: 0,
      health: 'ON_TRACK',
    });
  });

  it('badges show health for running projects', () => {
    expect(projectBadge({ status: 'ACTIVE', health: 'DELAYED' }).label).toBe('Delayed');
    expect(projectBadge({ status: 'ACTIVE', health: 'AT_RISK' }).label).toBe('At risk');
    expect(projectBadge({ status: 'PLANNING', health: 'DELAYED' }).label).toBe('Planning');
    expect(projectBadge({ status: 'ACTIVE', archived: true }).label).toBe('Archived');
  });
});

describe('working-day schedule (FR-PRJ-03, Q-07 Mon–Fri, EC-37)', () => {
  it('skips weekends and rolls a weekend start to Monday', () => {
    expect(toDateOnly(addWorkingDays(d('2026-10-09'), 1))).toBe('2026-10-12'); // Fri → Mon
    expect(toDateOnly(addWorkingDays(d('2026-10-10'), 0))).toBe('2026-10-12'); // Sat → Mon
    const s = scheduleFromOffsets(d('2026-10-12'), 5, 3);
    expect([toDateOnly(s.plannedStart), toDateOnly(s.dueDate)]).toEqual([
      '2026-10-19',
      '2026-10-21',
    ]);
    const m = scheduleFromOffsets(d('2026-10-12'), 0, 0);
    expect(toDateOnly(m.dueDate)).toBe('2026-10-12');
  });
});

describe('dependency cycles (FR-TPL-07, AC-07.2, EC-15)', () => {
  it('finds A→B→A and longer cycles, ignores unknown ids, returns null when acyclic', () => {
    expect(
      findCycle([
        { id: 'A', dependsOn: ['B'] },
        { id: 'B', dependsOn: ['A'] },
      ]),
    ).toEqual(['A', 'B', 'A']);
    expect(
      findCycle([
        { id: 'A', dependsOn: ['C'] },
        { id: 'B', dependsOn: ['A'] },
        { id: 'C', dependsOn: ['B'] },
      ]),
    ).toHaveLength(4);
    expect(
      findCycle([
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: ['A', 'Z'] },
      ]),
    ).toBeNull();
  });
});

describe('EC-58: tasks without an estimate', () => {
  it('keeps a missing estimate as null (never 0) in schemas', () => {
    expect(templateActivitySchema.parse({ id: 'a', phaseId: 'p', name: 'A' }).estHours).toBeNull();
    expect(
      templateActivitySchema.parse({ id: 'a', phaseId: 'p', name: 'A', estHours: 0 }).estHours,
    ).toBe(0);
    expect(updateTaskSchema.parse({ version: 1, estHours: null }).estHours).toBeNull();
  });

  it('shows "–", has no variance and is never over budget; summaries count unestimated tasks; time still counts', () => {
    expect(formatHours(null)).toBe('–');
    expect(formatHours(0)).toBe('00:00');
    expect(formatHours(2.5)).toBe('02:30');
    expect(formatHours(4)).toBe('04:00');
    expect(effortVariance({ estHours: null, actualHours: 5 })).toEqual({
      variance: null,
      overrunPct: null,
      overBudget: false,
    });
    expect(effortVariance({ estHours: 8, actualHours: 12 })).toEqual({
      variance: 4,
      overrunPct: 50,
      overBudget: true,
    });
    expect(effortVariance({ estHours: 0, actualHours: 2 })).toEqual({
      variance: 2,
      overrunPct: null,
      overBudget: true,
    });
    expect(
      effortSummary([
        { estHours: 8, actualHours: 12 },
        { estHours: null, actualHours: 3 },
        { estHours: null },
        { estHours: 10, actualHours: 2 },
      ]),
    ).toEqual({ estimatedHours: 18, actualHours: 17, unestimatedCount: 2, overBudgetCount: 1 });
  });
});

describe('request schemas and decisions', () => {
  it('end must be after start; partial template updates never reset content', () => {
    const r = createProjectSchema.safeParse({
      name: 'P',
      clientId: 'a'.repeat(24),
      managerId: 'b'.repeat(24),
      templateId: 'c'.repeat(24),
      startDate: '2026-10-12',
      plannedEndDate: '2026-10-12',
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe('End date must be after the start date.');
    expect(updateTemplateSchema.parse({ name: 'X' })).toEqual({ name: 'X' });
  });

  it('Q-12 default: PMs edit only their own projects', () => {
    expect(PM_PROJECT_EDIT_SCOPE).toBe('OWN');
  });
});

describe('M2 follow-ups (DR-09, DR-10, doc 11 §12)', () => {
  it('DR-10 pluralizes counts', () => {
    expect([plural(1, 'task'), plural(2, 'task'), plural(0, 'task')]).toEqual([
      '1 task',
      '2 tasks',
      '0 tasks',
    ]);
    expect([plural(1, 'activity', 'activities'), plural(3, 'activity', 'activities')]).toEqual([
      '1 activity',
      '3 activities',
    ]);
  });

  it('DR-09 describes forecast vs baseline in words', () => {
    expect(scheduleVarianceLabel(-38)).toEqual({
      text: '38 days before baseline end',
      variant: 'success',
    });
    expect(scheduleVarianceLabel(-1).text).toBe('1 day before baseline end');
    expect(scheduleVarianceLabel(1)).toEqual({ text: '1 day late', variant: 'danger' });
    expect(scheduleVarianceLabel(5).text).toBe('5 days late');
    expect(scheduleVarianceLabel(0)).toEqual({ text: 'On baseline', variant: 'secondary' });
  });

  it('§12: Admins and PMs read project Activity logs by default; Members and Viewers do not', () => {
    const can = (r: keyof typeof DEFAULT_ACCESS_RULES) =>
      canViewProjectActivity(r, DEFAULT_ACCESS_RULES[r]);
    expect([can('ADMIN'), can('PROJECT_MANAGER'), can('MEMBER'), can('VIEWER')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    // PMs keep it even without the global audit permission.
    expect(DEFAULT_ACCESS_RULES.PROJECT_MANAGER.audit.view).toBe(false);
  });
});

describe('Reordering (template activities and project tasks)', () => {
  it('moveWithinGroup reorders one group and leaves the others in place', () => {
    const items = ['a1', 'b1', 'a2', 'b2', 'a3'];
    const inA = (x: string) => x.startsWith('a');
    expect(moveWithinGroup(items, inA, 2, 0)).toEqual(['a3', 'b1', 'a1', 'b2', 'a2']);
    expect(moveWithinGroup(items, inA, 0, 1)).toEqual(['a2', 'b1', 'a1', 'b2', 'a3']);
    // Out of range or no move: unchanged copy.
    expect(moveWithinGroup(items, inA, 0, 5)).toEqual(items);
    expect(moveWithinGroup(items, inA, 1, 1)).toEqual(items);
  });

  it('reorderTasksSchema needs task ids and accepts a null phase', () => {
    expect(reorderTasksSchema.safeParse({ phase: null, taskIds: ['a'.repeat(24)] }).success).toBe(
      true,
    );
    expect(reorderTasksSchema.safeParse({ phase: 'P', taskIds: [] }).success).toBe(false);
  });
});

describe('DR-25: hours as HH:MM', () => {
  it('formats decimal hours from timed entries without raw decimals', async () => {
    const { hoursHHMM, formatSignedHours } = await import('../src/index');
    expect(hoursHHMM(0.03333333333333333)).toBe('00:02');
    expect(hoursHHMM(4.883333333333333)).toBe('04:53');
    expect(hoursHHMM(0.3666666666666667)).toBe('00:22');
    expect(hoursHHMM(40)).toBe('40:00');
    expect(hoursHHMM(null)).toBe('–');
    expect(formatSignedHours(-0.25)).toBe('−00:15');
  });
});
