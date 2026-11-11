import { Types, type ClientSession } from 'mongoose';
import { FolderModel, ProjectModel, TaskModel } from '../models/index.js';

/** Doc 14 §J: phase identity ignores case and leading/trailing spaces. */
export function phaseKey(name: string) {
  return name.trim().toLowerCase();
}

export interface PhaseSyncPlan {
  /** Phase records to add at the end of the list (name and the new id). */
  added: { id: Types.ObjectId; name: string }[];
  /** Tasks whose phaseId and/or phase name change. */
  tasks: {
    taskId: string;
    fromId: string | null;
    from: string | null;
    toId: string | null;
    to: string | null;
  }[];
  /** Phase folders whose `phase` name is respelled to the record's name. */
  folders: { folderId: Types.ObjectId; to: string }[];
}

export const emptyPlan = (p: PhaseSyncPlan) =>
  !p.added.length && !p.tasks.length && !p.folders.length;

/**
 * CR-22 (Lead) / FR-TL-24: makes a project's tasks point at phase records by id. Every phase name
 * on a task (or a phase evidence folder) without a record gets one at the end of the list, in
 * task order then folder order (target date blank); each task gets its record's `phaseId` and
 * the record's spelling in `phase`. Idempotent: a project already in step plans nothing. Dry run
 * unless `apply` is true. Used by the one-time migration and after template plans are inserted.
 */
export async function syncProjectPhases(
  projectId: Types.ObjectId,
  opts: { apply?: boolean; session?: ClientSession } = {},
): Promise<PhaseSyncPlan> {
  const session = opts.session ?? null;
  const project = await ProjectModel.findById(projectId).select('phases').session(session).lean();
  const tasks = await TaskModel.find({ projectId }, { phase: 1, phaseId: 1, order: 1 })
    .sort({ order: 1, _id: 1 })
    .session(session)
    .lean();
  const folders = await FolderModel.find({ projectId, kind: 'PHASE' }, { phase: 1 })
    .sort({ order: 1, _id: 1 })
    .session(session)
    .lean();
  const records = (project?.phases ?? []).map((r) => ({
    id: r._id as Types.ObjectId,
    name: r.name,
  }));
  const byId = new Map(records.map((r) => [r.id.toString(), r]));
  const byKey = new Map(records.map((r) => [phaseKey(r.name), r]));
  const plan: PhaseSyncPlan = { added: [], tasks: [], folders: [] };
  const recordFor = (name: string) => {
    const k = phaseKey(name);
    let r = byKey.get(k);
    if (!r) {
      r = { id: new Types.ObjectId(), name: name.trim() };
      byKey.set(k, r);
      byId.set(r.id.toString(), r);
      plan.added.push(r);
    }
    return r;
  };
  for (const t of tasks) {
    const linked = t.phaseId ? byId.get(t.phaseId.toString()) : undefined;
    const target = linked ?? (t.phase && t.phase.trim() ? recordFor(t.phase) : null);
    const toId = target ? target.id.toString() : null;
    const to = target ? target.name : null;
    const fromId = t.phaseId ? t.phaseId.toString() : null;
    if (fromId !== toId || (t.phase ?? null) !== to) {
      plan.tasks.push({ taskId: t._id.toString(), fromId, from: t.phase ?? null, toId, to });
    }
  }
  for (const f of folders) {
    if (!f.phase || !f.phase.trim()) continue;
    const r = recordFor(f.phase);
    if (f.phase !== r.name) plan.folders.push({ folderId: f._id, to: r.name });
  }
  if (opts.apply && !emptyPlan(plan)) {
    const s = opts.session ? { session: opts.session } : {};
    if (plan.added.length) {
      await ProjectModel.updateOne(
        { _id: projectId },
        {
          $push: {
            phases: {
              $each: plan.added.map((a) => ({ _id: a.id, name: a.name, targetDate: null })),
            },
          },
        },
        s,
      );
    }
    if (plan.tasks.length) {
      await TaskModel.bulkWrite(
        plan.tasks.map((t) => ({
          updateOne: {
            filter: { _id: new Types.ObjectId(t.taskId) },
            update: {
              $set: { phaseId: t.toId ? new Types.ObjectId(t.toId) : null, phase: t.to },
            },
          },
        })),
        s,
      );
    }
    if (plan.folders.length) {
      await FolderModel.bulkWrite(
        plan.folders.map((f) => ({
          updateOne: { filter: { _id: f.folderId }, update: { $set: { phase: f.to } } },
        })),
        s,
      );
    }
  }
  return plan;
}
