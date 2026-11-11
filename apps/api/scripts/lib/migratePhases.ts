/**
 * CR-22 FR-TL-24 (one-time phase migration, Lead's phaseId ruling): turns each project's text
 * phases on tasks (and phase evidence folders) into phase records on `Project.phases` and sets
 * `phaseId` on every task (services/phases.ts `syncProjectPhases`). Names match ignoring case and
 * spaces (doc 14 §J); order follows the tasks' current order, then folder-only phases; target
 * completion date blank. Idempotent: a project already in step gets no write and no audit entry.
 * Each changed project is written and audited in one transaction.
 */
import mongoose from 'mongoose';
import { ProjectModel } from '../../src/models/index.js';
import { auditMany } from '../../src/services/audit.js';
import { emptyPlan, syncProjectPhases, type PhaseSyncPlan } from '../../src/services/phases.js';

export const PHASE_MIGRATION_AUDIT_ACTION = 'phases_migrated';

export interface ProjectPhaseMigration {
  projectId: string;
  projectName: string;
  /** Phase records added at the end of the list, in order. */
  added: string[];
  /** Tasks that get a phaseId (and/or the record's spelling). */
  tasksLinked: {
    taskId: string;
    from: string | null;
    to: string | null;
    fromId: string | null;
    toId: string | null;
  }[];
  foldersRespelled: number;
}

export interface PhaseMigrationResult {
  apply: boolean;
  projectsChecked: number;
  changed: ProjectPhaseMigration[];
}

const summary = (p: { _id: mongoose.Types.ObjectId; name: string }, plan: PhaseSyncPlan) => ({
  projectId: p._id.toString(),
  projectName: p.name,
  added: plan.added.map((a) => a.name),
  tasksLinked: plan.tasks.map((t) => ({
    taskId: t.taskId,
    from: t.from,
    to: t.to,
    fromId: t.fromId,
    toId: t.toId,
  })),
  foldersRespelled: plan.folders.length,
});

/** Dry run unless `apply` is true: reports what would change and writes nothing. */
export async function migrateAllPhases(opts: { apply: boolean }): Promise<PhaseMigrationResult> {
  const projects = await ProjectModel.find({}, { _id: 1, name: 1 }).sort({ _id: 1 }).lean();
  const changed: ProjectPhaseMigration[] = [];
  for (const p of projects) {
    let plan = await syncProjectPhases(p._id);
    if (emptyPlan(plan)) continue;
    if (opts.apply) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          plan = await syncProjectPhases(p._id, { apply: true, session });
          if (emptyPlan(plan)) return;
          await auditMany(
            [
              {
                actorId: null,
                entityType: 'project',
                entityId: p._id,
                projectId: p._id,
                action: PHASE_MIGRATION_AUDIT_ACTION,
                reason:
                  'CR-22 FR-TL-24: one-time move of text phases into the phase list (phaseId)',
                changes: [{ field: 'phases', old: null, new: plan.added.map((a) => a.name) }],
                meta: {
                  tasksLinked: plan.tasks.length,
                  tasks: plan.tasks,
                  foldersRespelled: plan.folders.length,
                },
              },
            ],
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
      if (emptyPlan(plan)) continue;
    }
    changed.push(summary(p, plan));
  }
  return { apply: opts.apply, projectsChecked: projects.length, changed };
}
