/**
 * Shared QA seeding (used by seed-qa-project and seed-qa-completed). Everything
 * here is idempotent: projects are matched by name and re-runs only fill in what is missing.
 */
import { issueKey, parseDateOnly, toDateOnly, todayPH } from '@xc8/shared';
import mongoose, { Types } from 'mongoose';
import {
  ClientContactModel,
  ClientModel,
  IssueModel,
  ProjectModel,
  TaskModel,
  TemplateModel,
  UserModel,
} from '../../src/models/index.js';
import { audit } from '../../src/services/audit.js';
import { loadCalendar } from '../../src/services/calendar.js';
import { defaultIssueDue, nextIssueNumber } from '../../src/services/issues.js';
import { LAUNCH_TEMPLATE_KEY } from '../../src/services/launchTemplate.js';
import { buildPlanTasks, recomputeProject } from '../../src/services/projectService.js';

export const QA_PROJECT_NAME = 'QA M3 – Ready to activate';
export const QA_COMPLETED_PROJECT_NAME = 'QA M3.5 – Completed with open issue';
export const QA_COMPLETED_ISSUE_TITLE = 'QA: post go-live report totals differ (AC-44.1)';

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} first.`);
  return v;
}

type UserDoc = { _id: Types.ObjectId };
export interface QaPeople {
  pm: UserDoc;
  member: UserDoc;
}

export async function qaPeople(pmEmail: string, memberEmail: string): Promise<QaPeople> {
  const pm = await UserModel.findOne({ email: pmEmail.toLowerCase(), active: true }).lean();
  const member = await UserModel.findOne({ email: memberEmail.toLowerCase(), active: true }).lean();
  if (!pm || !member)
    throw new Error('The QA PM or Member account was not found (or is inactive).');
  return { pm, member };
}

export async function qaClient(clientName?: string) {
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
  return { client, contact };
}

/** Creates the project from the published launch template once (by name); returns it. */
async function ensureTemplateProject(opts: {
  name: string;
  description: string;
  people: QaPeople;
  clientId: Types.ObjectId;
  start: Date;
  seed: string;
}) {
  const existing = await ProjectModel.findOne({ name: opts.name }).lean();
  if (existing) return { project: existing, created: false };
  const template = await TemplateModel.findOne({
    templateKey: LAUNCH_TEMPLATE_KEY,
    status: 'PUBLISHED',
    superseded: { $ne: true },
  }).lean();
  if (!template) throw new Error('The published launch template was not found.');
  const { pm, member } = opts.people;
  const projectId = new Types.ObjectId();
  const tasks = buildPlanTasks(template, projectId, opts.start, await loadCalendar());
  const end = tasks.reduce(
    (max, t) => (t.dueDate && t.dueDate > max ? t.dueDate : max),
    opts.start,
  );
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await ProjectModel.create(
        [
          {
            _id: projectId,
            name: opts.name,
            clientId: opts.clientId,
            managerId: pm._id,
            memberIds: [pm._id, member._id],
            type: 'SAP_B1',
            description: opts.description,
            status: 'PLANNING',
            startDate: opts.start,
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
      seed: opts.seed,
    },
  });
  console.log(`Created "${opts.name}" with ${tasks.length} tasks.`);
  return { project: (await ProjectModel.findById(projectId).lean())!, created: true };
}

async function ownAllTasks(
  projectId: Types.ObjectId,
  memberId: Types.ObjectId,
  contactId?: Types.ObjectId,
) {
  const owned = await TaskModel.updateMany(
    { projectId, ownerId: null },
    { $set: { ownerId: memberId } },
  );
  if (contactId) {
    await TaskModel.updateMany(
      { projectId, party: 'CLIENT', clientContactId: null },
      { $set: { clientContactId: contactId } },
    );
  }
  return owned.modifiedCount;
}

/** AC-10.3 QA project: every task has an owner, so it can go Active straight away. */
export async function seedReadyProject(people: QaPeople, clientName?: string) {
  const { client, contact } = await qaClient(clientName);
  const { project, created } = await ensureTemplateProject({
    name: QA_PROJECT_NAME,
    description:
      'QA seed: every task has an owner, so the project can go Active and then On Hold (time logging blocked).',
    people,
    clientId: client._id,
    start: todayPH(),
    seed: 'qa-project',
  });
  if (!created) console.log(`"${QA_PROJECT_NAME}" already exists; checking task owners.`);
  const owned = await ownAllTasks(project._id, people.member._id, contact?._id);
  await recomputeProject(project._id);
  const missing = await TaskModel.countDocuments({ projectId: project._id, ownerId: null });
  console.log(
    `Owners set on ${owned} task(s); tasks without an owner: ${missing}. Status: ${project.status}. Id: ${project._id.toString()}.`,
  );
  return project;
}

/**
 * AC-44.1 QA project: fully Completed (every task Completed, approvals Approved, project status
 * Completed) with one open issue, so QA can check the Completed banner and support-mode issues.
 * Re-runs complete anything left open and re-open nothing; a missing open issue is raised again.
 */
export async function seedCompletedProject(people: QaPeople, clientName?: string) {
  const { client, contact } = await qaClient(clientName);
  // Planned in the past (about 12 weeks ago), so the finished plan reads naturally.
  const start = parseDateOnly(toDateOnly(new Date(todayPH().getTime() - 84 * 86_400_000)));
  const { project } = await ensureTemplateProject({
    name: QA_COMPLETED_PROJECT_NAME,
    description:
      'QA seed (AC-44.1): every task is Completed and the project is Completed; one issue stays open.',
    people,
    clientId: client._id,
    start,
    seed: 'qa-completed',
  });
  await ownAllTasks(project._id, people.member._id, contact?._id);
  const done = await TaskModel.updateMany(
    { projectId: project._id, status: { $nin: ['COMPLETED', 'CANCELLED'] } },
    { $set: { status: 'COMPLETED', blockerReason: null, previousStatus: null } },
  );
  await TaskModel.updateMany(
    { projectId: project._id, requiresApproval: true, 'approval.state': { $ne: 'APPROVED' } },
    {
      $set: {
        'approval.state': 'APPROVED',
        'approval.decidedBy': people.pm._id,
        'approval.decidedAt': new Date(),
      },
    },
  );
  if (project.status !== 'COMPLETED') {
    await ProjectModel.updateOne({ _id: project._id }, { $set: { status: 'COMPLETED' } });
    await audit({
      actorId: people.pm._id,
      entityType: 'project',
      entityId: project._id,
      projectId: project._id,
      action: 'project_updated',
      changes: [{ field: 'status', old: project.status, new: 'COMPLETED' }],
      meta: { seed: 'qa-completed' },
    });
  }
  await recomputeProject(project._id);

  const existingIssue = await IssueModel.findOne({
    projectId: project._id,
    status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT'] },
  }).lean();
  let issue = existingIssue ? { id: existingIssue._id.toString(), key: existingIssue.key } : null;
  if (!issue) {
    const fresh = (await ProjectModel.findById(project._id).lean())!;
    const { number, prefix } = await nextIssueNumber(fresh);
    const now = new Date();
    const created = await IssueModel.create({
      projectId: project._id,
      number,
      key: issueKey(prefix, number),
      title: QA_COMPLETED_ISSUE_TITLE,
      description:
        'QA seed: an issue raised after go-live on a Completed project. It stays Open so AC-44.1 can be run.',
      stage: 'AFTER_GO_LIVE',
      category: 'OTHER',
      severity: 'MEDIUM',
      status: 'OPEN',
      reportedById: people.pm._id,
      reportedByContactId: contact?._id ?? null,
      ownerId: null,
      dueDate: defaultIssueDue('MEDIUM', now, await loadCalendar()),
      createdBy: people.pm._id,
    });
    await audit({
      actorId: people.pm._id,
      entityType: 'issue',
      entityId: created._id,
      projectId: project._id,
      action: 'issue_created',
      changes: [{ field: 'severity', old: null, new: 'MEDIUM' }],
      meta: { key: created.key, title: created.title, seed: 'qa-completed' },
    });
    issue = { id: created._id.toString(), key: created.key };
  }
  const open = await TaskModel.countDocuments({
    projectId: project._id,
    status: { $nin: ['COMPLETED', 'CANCELLED'] },
  });
  console.log(
    `"${QA_COMPLETED_PROJECT_NAME}": ${done.modifiedCount} task(s) completed now, ${open} not completed. Status: COMPLETED. Open issue: ${issue.key}. Id: ${project._id.toString()}.`,
  );
  return { project, issue };
}
