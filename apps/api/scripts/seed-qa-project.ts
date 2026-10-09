/**
 * QA seed: one project where every task already has an accountable owner, so it can be moved to
 * Active straight away (AC-10.3) and then On Hold to check that time logging is blocked.
 *
 * Idempotent: the project is matched by name. If it exists, only tasks still missing an owner get
 * one; nothing else is changed. People come from env vars (never committed):
 *   MONGODB_URI, MONGODB_DB_NAME     database
 *   QA_PM_EMAIL                      project manager (also a member)
 *   QA_MEMBER_EMAIL                  owner of every task (a Member, so they can log time)
 *   QA_SEED_CLIENT (optional)        client name; defaults to the first client with an active contact
 * Usage: npm run seed:qa-project --workspace @xc8/api
 */
import { todayPH } from '@xc8/shared';
import mongoose, { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../src/db.js';
import {
  ClientContactModel,
  ClientModel,
  ProjectModel,
  TaskModel,
  TemplateModel,
  UserModel,
} from '../src/models/index.js';
import { audit } from '../src/services/audit.js';
import { loadCalendar } from '../src/services/calendar.js';
import { LAUNCH_TEMPLATE_KEY } from '../src/services/launchTemplate.js';
import { buildPlanTasks, recomputeProject } from '../src/services/projectService.js';

export const QA_PROJECT_NAME = 'QA M3 – Ready to activate';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} first.`);
  return v;
}

async function main() {
  await connectDb(need('MONGODB_URI'), process.env.MONGODB_DB_NAME);
  const pm = await UserModel.findOne({ email: need('QA_PM_EMAIL').toLowerCase(), active: true });
  const member = await UserModel.findOne({
    email: need('QA_MEMBER_EMAIL').toLowerCase(),
    active: true,
  });
  if (!pm || !member)
    throw new Error('The QA PM or Member account was not found (or is inactive).');

  const clientName = process.env.QA_SEED_CLIENT;
  let client = clientName
    ? await ClientModel.findOne({ nameKey: clientName.trim().toLowerCase() }).lean()
    : null;
  if (!client) {
    const withContact = await ClientContactModel.distinct('clientId', { active: true });
    client = await ClientModel.findOne({ _id: { $in: withContact } })
      .sort({ name: 1 })
      .lean();
  }
  if (!client) throw new Error('No client with an active contact was found.');
  const contact = await ClientContactModel.findOne({ clientId: client._id, active: true })
    .sort({ name: 1 })
    .lean();

  let project = await ProjectModel.findOne({ name: QA_PROJECT_NAME }).lean();
  if (!project) {
    const template = await TemplateModel.findOne({
      templateKey: LAUNCH_TEMPLATE_KEY,
      status: 'PUBLISHED',
      superseded: { $ne: true },
    }).lean();
    if (!template) throw new Error('The published launch template was not found.');
    const projectId = new Types.ObjectId();
    const start = todayPH();
    const tasks = buildPlanTasks(template, projectId, start, await loadCalendar());
    const end = tasks.reduce((max, t) => (t.dueDate && t.dueDate > max ? t.dueDate : max), start);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await ProjectModel.create(
          [
            {
              _id: projectId,
              name: QA_PROJECT_NAME,
              clientId: client._id,
              managerId: pm._id,
              memberIds: [pm._id, member._id],
              type: 'SAP_B1',
              description:
                'QA seed: every task has an owner, so the project can go Active and then On Hold (time logging blocked).',
              status: 'PLANNING',
              startDate: start,
              plannedEndDate: end,
              templateSnapshot: {
                templateId: template._id,
                templateKey: template.templateKey,
                version: template.version,
                name: template.name,
                copy: { phases: template.phases, activities: template.activities },
              },
              createdBy: pm._id,
            },
          ],
          { session },
        );
        if (tasks.length) await TaskModel.insertMany(tasks, { session });
      });
    } finally {
      await session.endSession();
    }
    await audit({
      actorId: pm._id,
      entityType: 'project',
      entityId: projectId,
      projectId,
      action: 'project_created',
      meta: {
        templateId: template._id.toString(),
        templateVersion: template.version,
        tasks: tasks.length,
        seed: 'qa-project',
      },
    });
    project = await ProjectModel.findById(projectId).lean();
    console.log(`Created "${QA_PROJECT_NAME}" with ${tasks.length} tasks.`);
  } else {
    console.log(`"${QA_PROJECT_NAME}" already exists; checking task owners.`);
  }

  // Every task gets the QA Member as accountable owner; client tasks also name a contact.
  const owned = await TaskModel.updateMany(
    { projectId: project!._id, ownerId: null },
    { $set: { ownerId: member._id } },
  );
  if (contact) {
    await TaskModel.updateMany(
      { projectId: project!._id, party: 'CLIENT', clientContactId: null },
      { $set: { clientContactId: contact._id } },
    );
  }
  await recomputeProject(project!._id);
  const missing = await TaskModel.countDocuments({ projectId: project!._id, ownerId: null });
  console.log(
    `Owners set on ${owned.modifiedCount} task(s); tasks without an owner: ${missing}. Status: ${project!.status}. Id: ${project!._id.toString()}.`,
  );
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
