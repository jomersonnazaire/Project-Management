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
    expect(formatHours(0)).toBe('0');
    expect(formatHours(2.5)).toBe('2.5');
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
