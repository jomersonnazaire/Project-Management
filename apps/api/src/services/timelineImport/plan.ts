import {
  TIMELINE_COLUMN_LABEL,
  TIMELINE_MAX_DEPENDENCIES,
  TIMELINE_PLAN_FIELDS,
  TIMELINE_ROW_MESSAGES as MSG,
  TIMELINE_MAX_DEPENDS_TEXT,
  TIMELINE_MAX_NAME,
  TIMELINE_MAX_PHASE,
  nameTooLongMessage,
  phaseTooLongMessage,
  badDateMessage,
  badTaskIdMessage,
  cycleMessage,
  duplicateNumberMessage,
  duplicateTaskIdMessage,
  findCycle,
  missingDependencyMessage,
  notMemberMessage,
  parseDependsOn,
  parseMilestone,
  parseTaskNumber,
  parseTimelineDate,
  phaseNotAllowedMessage,
  unknownOwnerMessage,
  type TimelineImportCounts,
  type TimelineImportField,
  type TimelineImportResult,
  type TimelineImportRowDto,
  type TimelinePlanField,
} from '@xc8/shared';
import { phaseKey } from '../phases.js';
import type { TimelineFileRow } from './workbook.js';

/**
 * CR-22 FR-TL-17 to 21, 25, 26 (§B4, §B5): the import preview's result, row by row. Pure: the
 * route loads the project's tasks, phases, people and post-export history and passes them in, so
 * the same function runs for the preview and again inside the commit's transaction.
 */

export interface PlanTask {
  id: string;
  order: number;
  name: string;
  phase: string | null;
  isMilestone: boolean;
  plannedStart: string | null;
  dueDate: string | null;
  dependsOn: string[];
  ownerId: string | null;
  version: number;
}

export interface PlanContext {
  /** The project's tasks, in order. */
  tasks: PlanTask[];
  /** The project's phases in list order (records and text-only ones). */
  phases: { id: string | null; name: string }[];
  /** Active internal users by lower-case email, for the emails in the file. */
  usersByEmail: Map<string, { id: string; active: boolean }>;
  /** Owner emails of the current tasks, by user id (for the struck-through old value). */
  emailById: Map<string, string>;
  /** Manager and members. */
  memberIds: Set<string>;
  /** `phaseEditableNow` (Admin any time, PM in Planning, Q-141). */
  canAddPhase: boolean;
  /** The project status label, for the phase error ("…while the project is Active."). */
  statusLabel: string;
  /** FR-TL-25: tasks changed after the file's export time, with UIE's description. */
  changedSince: Map<string, string>;
}

/** What the commit writes for a row. Dates are YYYY-MM-DD; deps are row refs or task ids. */
export interface PlannedFields {
  name: string;
  phaseKey: string | null;
  phaseName: string | null;
  isMilestone: boolean;
  plannedStart: string | null;
  dueDate: string | null;
  /** `task:<id>` for existing tasks, `row:<excel row>` for new rows. */
  dependsOn: string[];
  ownerId: string | null;
}

export interface PlannedRow {
  dto: TimelineImportRowDto;
  taskId: string | null;
  version: number | null;
  fields: PlannedFields | null;
}

export interface TimelinePlan {
  rows: PlannedRow[];
  newPhases: string[];
  baselineFilled: boolean;
  counts: TimelineImportCounts;
}

const DATE_FIELDS = ['start', 'finish', 'baselineStart', 'baselineFinish'] as const;

const depText = (nums: number[]) => [...nums].sort((a, b) => a - b).join(', ');

export function planTimelineImport(rows: TimelineFileRow[], ctx: PlanContext): TimelinePlan {
  const taskById = new Map(ctx.tasks.map((t) => [t.id, t]));
  const phaseByKey = new Map(ctx.phases.map((p) => [phaseKey(p.name), p]));
  const newPhaseByKey = new Map<string, string>();
  const maxOrder = ctx.tasks.reduce((m, t) => Math.max(m, t.order), 0);

  // Duplicates across the file (every copy is an error, Q-149 / §B4 Task ID).
  const numberCount = new Map<number, number>();
  const idCount = new Map<string, number>();
  for (const r of rows) {
    const n = parseTaskNumber(r.values.number);
    if (n !== null) numberCount.set(n, (numberCount.get(n) ?? 0) + 1);
    const id = r.values.taskId;
    if (id) idCount.set(id, (idCount.get(id) ?? 0) + 1);
  }
  const rowByNumber = new Map<number, TimelineFileRow>();
  for (const r of rows) {
    const n = parseTaskNumber(r.values.number);
    if (n !== null && numberCount.get(n) === 1) rowByNumber.set(n, r);
  }

  type Work = {
    file: TimelineFileRow;
    errors: { field: TimelineImportField | null; message: string }[];
    number: number | null;
    deps: number[];
    task: PlanTask | null;
    fields: PlannedFields;
    shownDeps: string;
  };
  const work: Work[] = rows.map((file) => {
    const v = file.values;
    const errors: Work['errors'] = [];
    const err = (field: TimelineImportField | null, message: string) =>
      errors.push({ field, message });

    const number = parseTaskNumber(v.number);
    if (number === null) err('number', MSG.BAD_NUMBER);
    else if ((numberCount.get(number) ?? 0) > 1) err('number', duplicateNumberMessage(number));

    const name = v.name.trim();
    if (!name) err('name', MSG.NAME_REQUIRED);
    else if (name.length > TIMELINE_MAX_NAME) err('name', nameTooLongMessage(name.length));

    let task: PlanTask | null = null;
    if (v.taskId) {
      if ((idCount.get(v.taskId) ?? 0) > 1) err('taskId', duplicateTaskIdMessage(v.taskId));
      else {
        task = taskById.get(v.taskId) ?? null;
        if (!task) err('taskId', badTaskIdMessage(v.taskId));
      }
    }

    const dates = {} as Record<(typeof DATE_FIELDS)[number], string | null>;
    for (const f of DATE_FIELDS) {
      dates[f] = v[f] ? parseTimelineDate(v[f]) : null;
      if (v[f] && !dates[f]) err(f, badDateMessage(TIMELINE_COLUMN_LABEL[f]));
    }
    if (dates.start && dates.finish && dates.finish < dates.start)
      err('finish', MSG.FINISH_BEFORE_START);
    if (dates.baselineStart && dates.baselineFinish && dates.baselineFinish < dates.baselineStart)
      err('baselineFinish', MSG.BASELINE_FINISH_BEFORE_START);

    const milestone = parseMilestone(v.milestone);
    if (milestone === null) err('milestone', MSG.MILESTONE);

    // Phase: matched ignoring case and spaces; a new name only where phases may change.
    let phase: { key: string; name: string } | null = null;
    const phaseText = v.phase.trim();
    if (phaseText) {
      const key = phaseKey(phaseText);
      if (phaseText.length > TIMELINE_MAX_PHASE) err('phase', phaseTooLongMessage());
      else if (phaseByKey.has(key)) phase = { key, name: phaseByKey.get(key)!.name };
      else if (!ctx.canAddPhase) err('phase', phaseNotAllowedMessage(phaseText, ctx.statusLabel));
      else {
        if (!newPhaseByKey.has(key)) newPhaseByKey.set(key, phaseText);
        phase = { key, name: newPhaseByKey.get(key)! };
      }
    }

    // Owner: an active internal user who is on the project (FR-TL-21, Q-140).
    let ownerId: string | null = null;
    const email = v.owner.trim();
    if (email) {
      const u = ctx.usersByEmail.get(email.toLowerCase());
      if (!u || !u.active) err('owner', unknownOwnerMessage(email));
      else if (!ctx.memberIds.has(u.id)) err('owner', notMemberMessage(email));
      else ownerId = u.id;
    }

    // Depends on: Task numbers in this file (Q-149).
    let deps: number[] = [];
    const depsTooLong = v.dependsOn.trim().length > TIMELINE_MAX_DEPENDS_TEXT;
    const parsed = depsTooLong ? null : parseDependsOn(v.dependsOn);
    if (depsTooLong) err('dependsOn', MSG.DEPENDS_ON_TOO_LONG);
    else if (parsed === null) err('dependsOn', MSG.DEPENDENCY_FORMAT);
    else {
      deps = parsed;
      if (deps.length > TIMELINE_MAX_DEPENDENCIES) err('dependsOn', MSG.TOO_MANY_DEPENDENCIES);
      if (number !== null && deps.includes(number)) err('dependsOn', MSG.SELF_DEPENDENCY);
      for (const d of deps) {
        if (d !== number && !rowByNumber.has(d) && !numberCount.has(d))
          err('dependsOn', missingDependencyMessage(d));
      }
    }

    return {
      file,
      errors,
      number,
      deps,
      task,
      shownDeps: parsed && parsed.length ? depText(parsed) : v.dependsOn,
      fields: {
        name,
        phaseKey: phase?.key ?? null,
        phaseName: phase?.name ?? null,
        isMilestone: Boolean(milestone),
        plannedStart: dates.start,
        dueDate: dates.finish,
        dependsOn: [],
        ownerId,
      },
    };
  });

  // Dependency targets: an existing task (by its Task ID) or a new row of this file.
  const refOf = (w: Work) => (w.task ? `task:${w.task.id}` : `row:${w.file.row}`);
  const workByRow = new Map(work.map((w) => [w.file.row, w]));
  for (const w of work) {
    w.fields.dependsOn = w.deps
      .filter((d) => d !== w.number && rowByNumber.has(d))
      .map((d) => refOf(workByRow.get(rowByNumber.get(d)!.row)!));
  }

  // Cycles (findCycle) over the plan as it would be saved: the file's rows replace the
  // dependencies of their tasks; tasks not in the file keep theirs.
  const inFile = new Map<string, Work>();
  for (const w of work) inFile.set(refOf(w), w);
  const nodes = new Map<string, string[]>();
  for (const t of ctx.tasks) {
    const ref = `task:${t.id}`;
    if (!inFile.has(ref))
      nodes.set(
        ref,
        t.dependsOn.map((d) => `task:${d}`),
      );
  }
  for (const w of work) nodes.set(refOf(w), [...w.fields.dependsOn]);
  const label = (ref: string) => {
    const w = inFile.get(ref);
    if (w) return w.number ?? `row ${w.file.row}`;
    return `#${taskById.get(ref.slice(5))?.order ?? '?'}`;
  };
  for (let i = 0; i < 25; i++) {
    const cycle = findCycle([...nodes].map(([id, dependsOn]) => ({ id, dependsOn })));
    if (!cycle) break;
    // findCycle walks successor → predecessor; show it in the order work flows.
    const labels = [...cycle].reverse().map(label);
    const msg = cycleMessage(labels);
    for (const ref of new Set(cycle)) {
      const w = inFile.get(ref);
      if (w && !w.errors.some((e) => e.message === msg))
        w.errors.push({ field: 'dependsOn', message: msg });
    }
    const [from, to] = [cycle[cycle.length - 2]!, cycle[cycle.length - 1]!];
    nodes.set(
      from,
      (nodes.get(from) ?? []).filter((d) => d !== to),
    );
  }

  // Results, changes and clears (FR-TL-17, Q-145).
  let nextNumber = maxOrder;
  const out: PlannedRow[] = work.map((w) => {
    const v = w.file.values;
    const values = { ...v, dependsOn: w.shownDeps };
    for (const f of DATE_FIELDS) {
      const d = v[f] ? parseTimelineDate(v[f]) : null;
      if (d) values[f] = d;
    }
    const base = {
      row: w.file.row,
      values,
      old: {} as TimelineImportRowDto['old'],
      changes: [] as TimelinePlanField[],
      clears: [] as TimelinePlanField[],
      errors: w.errors,
      changedSince: null as string | null,
      willBe: null as number | null,
    };
    if (w.errors.length) {
      return {
        dto: { ...base, result: 'ERROR' as TimelineImportResult },
        taskId: w.task?.id ?? null,
        version: w.task?.version ?? null,
        fields: null,
      };
    }
    if (!w.task) {
      nextNumber += 1;
      return {
        dto: { ...base, result: 'NEW' as TimelineImportResult, willBe: nextNumber },
        taskId: null,
        version: null,
        fields: w.fields,
      };
    }
    const t = w.task;
    const f = w.fields;
    const ownerEmail = t.ownerId ? (ctx.emailById.get(t.ownerId) ?? '') : '';
    const currentDeps = t.dependsOn.map((id) => `task:${id}`);
    const sameDeps =
      currentDeps.length === f.dependsOn.length &&
      currentDeps.every((d) => f.dependsOn.includes(d));
    const oldDepNumbers = t.dependsOn
      .map((id) => taskById.get(id)?.order)
      .filter((n): n is number => typeof n === 'number');
    const compare: Record<TimelinePlanField, { same: boolean; old: string; cleared: boolean }> = {
      name: { same: t.name === f.name, old: t.name, cleared: false },
      phase: {
        same: (t.phase ? phaseKey(t.phase) : null) === f.phaseKey,
        old: t.phase ?? '',
        cleared: Boolean(t.phase) && !f.phaseKey,
      },
      milestone: {
        same: t.isMilestone === f.isMilestone,
        old: t.isMilestone ? 'Y' : 'N',
        cleared: false,
      },
      start: {
        same: t.plannedStart === f.plannedStart,
        old: t.plannedStart ?? '',
        cleared: Boolean(t.plannedStart) && !f.plannedStart,
      },
      finish: {
        same: t.dueDate === f.dueDate,
        old: t.dueDate ?? '',
        cleared: Boolean(t.dueDate) && !f.dueDate,
      },
      dependsOn: {
        same: sameDeps,
        old: depText(oldDepNumbers),
        cleared: currentDeps.length > 0 && f.dependsOn.length === 0,
      },
      owner: {
        same: (t.ownerId ?? null) === f.ownerId,
        old: ownerEmail,
        cleared: Boolean(t.ownerId) && !f.ownerId,
      },
    };
    for (const field of TIMELINE_PLAN_FIELDS) {
      const c = compare[field];
      if (c.same) continue;
      base.changes.push(field);
      base.old[field] = c.old;
      if (c.cleared) base.clears.push(field);
    }
    let result: TimelineImportResult = 'UNCHANGED';
    if (base.changes.length) {
      const since = ctx.changedSince.get(t.id);
      if (since) {
        result = 'CHANGED';
        base.changedSince = since;
      } else result = 'UPDATE';
    }
    return { dto: { ...base, result }, taskId: t.id, version: t.version, fields: f };
  });

  const dtos = out.map((r) => r.dto);
  const counts: TimelineImportCounts = {
    total: dtos.length,
    new: dtos.filter((r) => r.result === 'NEW').length,
    update: dtos.filter((r) => r.result === 'UPDATE').length,
    unchanged: dtos.filter((r) => r.result === 'UNCHANGED').length,
    changed: dtos.filter((r) => r.result === 'CHANGED').length,
    error: dtos.filter((r) => r.result === 'ERROR').length,
    errorMessages: dtos.reduce((n, r) => n + r.errors.length, 0),
    clears: dtos.filter((r) => r.clears.length > 0).length,
  };
  // New phases only matter when they'd be used by a row that saves.
  const used = new Set(out.filter((r) => r.fields).map((r) => r.fields!.phaseKey));
  return {
    rows: out,
    newPhases: [...newPhaseByKey].filter(([k]) => used.has(k)).map(([, n]) => n),
    baselineFilled: rows.some((r) => r.values.baselineStart || r.values.baselineFinish),
    counts,
  };
}
