/**
 * CR-22 FR-TL-24 (one-time phase migration): turns each project's text phases on tasks (and phase
 * evidence folders) into phase records on `Project.phases`. Names match ignoring case and spaces
 * (doc 14 §J); order follows the tasks' current order, then folder-only phases; target completion
 * date blank. Tasks and folders whose phase text is a different spelling are pointed at the
 * record's name. Idempotent: a project whose list already covers every phase, spelled the same,
 * is left alone and gets no audit entry. Each changed project is written and audited in one
 * transaction.
 */
import mongoose, { type ClientSession, type Types } from 'mongoose';
import { FolderModel, ProjectModel, TaskModel } from '../../src/models/index.js';
import { auditMany } from '../../src/services/audit.js';

export const PHASE_MIGRATION_AUDIT_ACTION = 'phases_migrated';

const key = (s: string) => s.trim().toLowerCase();

export interface ProjectPhaseMigration {
  projectId: string;
  projectName: string;
  /** Phase records added at the end of the list, in order. */
  added: string[];
  /** Tasks whose phase text was respelled to the record's name. */
  tasksRespelled: { taskId: string; from: string; to: string }[];
  foldersRespelled: number;
}

export interface PhaseMigrationResult {
  apply: boolean;
  projectsChecked: number;
  changed: ProjectPhaseMigration[];
}

async function planProject(
  projectId: Types.ObjectId,
  session?: ClientSession,
): Promise<
  Omit<ProjectPhaseMigration, 'projectName'> & {
    folderIds: Types.ObjectId[];
    canon: Map<string, string>;
  }
> {
  const project = await ProjectModel.findById(projectId)
    .select('phases')
    .session(session ?? null)
    .lean();
  const tasks = await TaskModel.find({ projectId }, { phase: 1, order: 1 })
    .sort({ order: 1, _id: 1 })
    .session(session ?? null)
    .lean();
  const folders = await FolderModel.find({ projectId, kind: 'PHASE' }, { phase: 1 })
    .sort({ order: 1, _id: 1 })
    .session(session ?? null)
    .lean();
  const canon = new Map<string, string>();
  for (const r of project?.phases ?? [])
    if (!canon.has(key(r.name))) canon.set(key(r.name), r.name);
  const added: string[] = [];
  for (const raw of [...tasks.map((t) => t.phase), ...folders.map((f) => f.phase)]) {
    if (!raw || !raw.trim()) continue;
    if (!canon.has(key(raw))) {
      canon.set(key(raw), raw.trim());
      added.push(raw.trim());
    }
  }
  const tasksRespelled = tasks
    .filter((t) => t.phase && t.phase.trim() && canon.get(key(t.phase)) !== t.phase)
    .map((t) => ({ taskId: t._id.toString(), from: t.phase!, to: canon.get(key(t.phase!))! }));
  const folderIds = folders
    .filter((f) => f.phase && f.phase.trim() && canon.get(key(f.phase)) !== f.phase)
    .map((f) => f._id);
  return {
    projectId: projectId.toString(),
    added,
    tasksRespelled,
    foldersRespelled: folderIds.length,
    folderIds,
    canon,
  };
}

/** Dry run unless `apply` is true: reports what would change and writes nothing. */
export async function migrateAllPhases(opts: { apply: boolean }): Promise<PhaseMigrationResult> {
  const projects = await ProjectModel.find({}, { _id: 1, name: 1 }).sort({ _id: 1 }).lean();
  const changed: ProjectPhaseMigration[] = [];
  for (const p of projects) {
    let plan = await planProject(p._id);
    const empty = () => !plan.added.length && !plan.tasksRespelled.length && !plan.foldersRespelled;
    if (empty()) continue;
    if (opts.apply) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          plan = await planProject(p._id, session);
          if (empty()) return;
          if (plan.added.length) {
            await ProjectModel.updateOne(
              { _id: p._id },
              {
                $push: {
                  phases: { $each: plan.added.map((name) => ({ name, targetDate: null })) },
                },
              },
              { session },
            );
          }
          if (plan.tasksRespelled.length) {
            await TaskModel.bulkWrite(
              plan.tasksRespelled.map((t) => ({
                updateOne: {
                  filter: { _id: t.taskId },
                  update: { $set: { phase: t.to }, $inc: { version: 1 } },
                },
              })),
              { session },
            );
          }
          for (const id of plan.folderIds) {
            const f = await FolderModel.findById(id).session(session);
            if (f?.phase) {
              f.phase = plan.canon.get(key(f.phase)) ?? f.phase;
              await f.save({ session });
            }
          }
          await auditMany(
            [
              {
                actorId: null,
                entityType: 'project',
                entityId: p._id,
                projectId: p._id,
                action: PHASE_MIGRATION_AUDIT_ACTION,
                reason: 'CR-22 FR-TL-24: one-time move of text phases into the phase list',
                changes: [{ field: 'phases', old: null, new: plan.added }],
                meta: {
                  tasksRespelled: plan.tasksRespelled,
                  foldersRespelled: plan.foldersRespelled,
                },
              },
            ],
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
      if (empty()) continue;
    }
    changed.push({
      projectId: plan.projectId,
      projectName: p.name,
      added: plan.added,
      tasksRespelled: plan.tasksRespelled,
      foldersRespelled: plan.foldersRespelled,
    });
  }
  return { apply: opts.apply, projectsChecked: projects.length, changed };
}
