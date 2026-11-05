/**
 * CR-20 FR-TSK-31 (one-time renumber): one-time renumber of every project's checklist to #1…n in its current order (order,
 * then _id). Idempotent: a project already numbered 1…n is left alone and gets no audit entry, so a
 * second run changes nothing. Each changed project is renumbered and audited in one transaction.
 */
import mongoose, { type ClientSession } from 'mongoose';
import { ProjectModel, TaskModel } from '../../src/models/index.js';
import { auditMany } from '../../src/services/audit.js';
import { renumberProjectTasks, type TaskRenumber } from '../../src/services/taskOrder.js';

export const RENUMBER_AUDIT_ACTION = 'tasks_renumbered';

export interface ProjectRenumber {
  projectId: string;
  projectName: string;
  tasks: (TaskRenumber & { name: string })[];
}

export interface RenumberResult {
  apply: boolean;
  projectsChecked: number;
  changed: ProjectRenumber[];
}

/** Names the renumbered tasks for the audit entry and the script's report. */
async function withNames(tasks: TaskRenumber[], session?: ClientSession) {
  const docs = await TaskModel.find({ _id: { $in: tasks.map((t) => t.taskId) } }, { name: 1 })
    .session(session ?? null)
    .lean();
  const names = new Map(docs.map((t) => [t._id.toString(), t.name]));
  return tasks.map((t) => ({ ...t, name: names.get(t.taskId) ?? '' }));
}

/** Dry run unless `apply` is true: reports what would change and writes nothing. */
export async function renumberAllProjects(opts: { apply: boolean }): Promise<RenumberResult> {
  const projects = await ProjectModel.find({}, { _id: 1, name: 1 }).sort({ _id: 1 }).lean();
  const changed: ProjectRenumber[] = [];
  for (const p of projects) {
    let tasks: ProjectRenumber['tasks'] = [];
    if (!opts.apply) {
      tasks = await withNames(await renumberProjectTasks(p._id, { apply: false }));
    } else {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          tasks = await withNames(await renumberProjectTasks(p._id, { session }), session);
          if (!tasks.length) return;
          // One entry per changed project, listing every task whose number moved.
          await auditMany(
            [
              {
                actorId: null,
                entityType: 'project',
                entityId: p._id,
                projectId: p._id,
                action: RENUMBER_AUDIT_ACTION,
                reason: 'CR-20: one-time renumber of the checklist to #1…n',
                changes: [
                  { field: 'order', old: tasks.map((t) => t.from), new: tasks.map((t) => t.to) },
                ],
                meta: { script: 'renumber-tasks', tasks },
              },
            ],
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
    }
    if (tasks.length) changed.push({ projectId: p._id.toString(), projectName: p.name, tasks });
  }
  return { apply: opts.apply, projectsChecked: projects.length, changed };
}
