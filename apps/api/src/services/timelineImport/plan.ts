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
  DELIVERABLE_EMPTY_LINE_MESSAGE,
  DELIVERABLE_MAX_ITEMS,
  DELIVERABLE_MAX_TEXT,
  deliverableLineTooLongMessage,
  deliverablesChanged,
  deliverablesLose,
  diffDeliverables,
  formatDeliverablesCell,
  ownerMissingMessage,
  cantOwnMessage,
  parseDeliverablesCell,
  tooManyDeliverablesMessage,
  type DeliverableLine,
  type DeliverablesDiff,
  parseDependsOn,
  parseMilestone,
  parseTaskNumber,
  parseTimelineDate,
  phaseNotAllowedMessage,
  type TimelineImportCounts,
  type TimelineImportField,
  type TimelineImportResult,
  type TimelineImportRowDto,
  type TimelinePlanField,
} from '@xc8/shared';
import { phaseKey } from '../phases.js';
import type { TimelineFileRow } from './workbook.js';

/**
 * CR-22 FR-TL-17 to 20, 25, 26 (§B4, §B5), moved to the Checklist by CR-23 (FR-CLX-02 to 13): the
 * import preview's result, row by row. Pure: the route loads the project's tasks, phases, people
 * and post-export history and passes them in, so the same function runs for the preview and again
 * inside the commit's transaction.
 *
 * Owners (CR-23 Q-151, Jomerson, replaces FR-TL-21 for this import): an active user who isn't on
 * the project is added to the team on import (listed in the preview); an email with no user, or a
 * deactivated one, isn't an error: the row imports without an owner and says so.
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
  /** CR-23: the task's deliverable items, in `order`. */
  deliverableItems: DeliverableLine[];
}

export interface PlanContext {
  /** The project's tasks, in order. */
  tasks: PlanTask[];
  /** The project's phases in list order (records and text-only ones). */
  phases: { id: string | null; name: string }[];
  /** Internal users by lower-case email, for the emails in the file. */
  usersByEmail: Map<
    string,
    { id: string; active: boolean; email: string; addable: boolean; canOwn: boolean }
  >;
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
  /** CR-23 FR-CLX-11: the file has a Deliverables column (an older Timeline file may not). */
  hasDeliverables: boolean;
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
  /** CR-23: the Deliverables cell's items; null = column missing, items unchanged (FR-CLX-11). */
  deliverables: DeliverableLine[] | null;
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
  /** CR-23 Q-151: active users the import adds to the project team, in file order. */
  addMembers: { id: string; email: string }[];
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
    warnings: { field: TimelineImportField | null; message: string }[];
    addMember: { id: string; email: string } | null;
    diff: DeliverablesDiff | null;
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

    // Owner (CR-23 Q-151): an active user; one who isn't on the team is added on import. An
    // unknown or deactivated email isn't an error: the row imports without an owner and says so.
    // A task keeps an owner whose account was deactivated when the file names that same owner.
    let ownerId: string | null = null;
    let addMember: Work['addMember'] = null;
    const warnings: Work['warnings'] = [];
    const email = v.owner.trim();
    if (email) {
      const u = ctx.usersByEmail.get(email.toLowerCase());
      if (u && u.active && !u.canOwn) {
        // Lean: a Viewer can't own tasks from the file, on the team or not (this import only).
        warnings.push({ field: 'owner', message: cantOwnMessage(email) });
      } else if (u && u.active && (ctx.memberIds.has(u.id) || u.addable)) {
        ownerId = u.id;
        // Anyone already on the project (manager or member) is skipped.
        if (!ctx.memberIds.has(u.id)) addMember = { id: u.id, email: u.email };
      } else if (u && task && task.ownerId === u.id) ownerId = u.id;
      else warnings.push({ field: 'owner', message: ownerMissingMessage(email) });
    }

    // Deliverables (CR-23 FR-CLX-04, Q-158): one item per line, `[x] ` = done. A missing column
    // leaves the items as they are; a blank cell in a present column clears them (FR-CLX-11).
    let deliverables: DeliverableLine[] | null = null;
    if (ctx.hasDeliverables) {
      deliverables = parseDeliverablesCell(v.deliverables);
      // Text already on this task may stay longer than the cap (migrated, Q-160).
      const keep = new Set((task?.deliverableItems ?? []).map((i) => i.text));
      deliverables.forEach((line, i) => {
        if (!line.text) err('deliverables', DELIVERABLE_EMPTY_LINE_MESSAGE);
        else if (line.text.length > DELIVERABLE_MAX_TEXT && !keep.has(line.text))
          err('deliverables', deliverableLineTooLongMessage(i + 1, line.text.length));
      });
      if (deliverables.length > DELIVERABLE_MAX_ITEMS)
        err('deliverables', tooManyDeliverablesMessage(deliverables.length));
    }
    const diff = deliverables ? diffDeliverables(task?.deliverableItems ?? [], deliverables) : null;

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
      warnings,
      addMember,
      diff,
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
        deliverables,
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
  const cycleMessages = new Set<string>();
  for (let i = 0; i < 25; i++) {
    const cycle = findCycle([...nodes].map(([id, dependsOn]) => ({ id, dependsOn })));
    if (!cycle) break;
    // findCycle walks successor → predecessor; show it in the order work flows.
    const labels = [...cycle].reverse().map(label);
    const msg = cycleMessage(labels);
    cycleMessages.add(msg);
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
      warnings: w.warnings,
      changedSince: null as string | null,
      willBe: null as number | null,
      deliverables: w.diff,
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
      deliverables: {
        same: !w.diff || !deliverablesChanged(w.diff),
        old: formatDeliverablesCell(t.deliverableItems),
        cleared:
          Boolean(f.deliverables) && t.deliverableItems.length > 0 && !f.deliverables!.length,
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
    // One cycle is one error, however many rows it runs through (UIE review).
    errorMessages:
      dtos.reduce((n, r) => n + r.errors.filter((e) => !cycleMessages.has(e.message)).length, 0) +
      [...cycleMessages].filter((m) => dtos.some((r) => r.errors.some((e) => e.message === m)))
        .length,
    clears: dtos.filter((r) => r.clears.length > 0).length,
    losesDeliverables: out.filter(
      (r) =>
        r.fields &&
        r.dto.result !== 'UNCHANGED' &&
        r.dto.deliverables &&
        deliverablesLose(r.dto.deliverables),
    ).length,
  };
  // Q-151: who joins the team, once each, from rows that save.
  const addMembers = new Map<string, { id: string; email: string }>();
  for (const w of work)
    if (w.addMember && !w.errors.length && !addMembers.has(w.addMember.id))
      addMembers.set(w.addMember.id, w.addMember);
  // New phases only matter when they'd be used by a row that saves.
  const used = new Set(out.filter((r) => r.fields).map((r) => r.fields!.phaseKey));
  return {
    rows: out,
    newPhases: [...newPhaseByKey].filter(([k]) => used.has(k)).map(([, n]) => n),
    addMembers: [...addMembers.values()],
    baselineFilled: rows.some((r) => r.values.baselineStart || r.values.baselineFinish),
    counts,
  };
}
