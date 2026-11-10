import {
  CLIENT_IMPORT_COMMIT_LIMIT,
  CLIENT_IMPORT_MAX_BYTES,
  CLIENT_IMPORT_MESSAGES,
  CLIENT_IMPORT_PREVIEW_LIMIT,
  CLIENT_IMPORT_RATE_WINDOW_MS,
  CLIENT_IMPORT_TOKEN_HEADER,
  PROJECT_STATUS_LABELS,
  TIMELINE_FILE_ERRORS,
  TIMELINE_IMPORT_COPY,
  TIMELINE_ROW_MESSAGES,
  TIMELINE_TEMPLATE_NAME,
  XLSX_MIME,
  otherProjectError,
  phDateOf,
  timelineExportFileName,
  toDateOnly,
  type ProjectStatus,
  type TimelineImportCommitDto,
  type TimelineImportPreviewDto,
  type TimelinePlanField,
} from '@xc8/shared';
import { createHash } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { perm, type RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { now as clockNow } from '../lib/clock.js';
import { forbidden, HttpError } from '../lib/errors.js';
import { unprocessable } from '../lib/http422.js';
import { parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import { isDatabaseUnavailable } from '../middleware/errors.js';
import {
  ActivityLogModel,
  FolderModel,
  ProjectModel,
  TaskModel,
  UserModel,
  type Project,
} from '../models/index.js';
import { audit, auditMany } from '../services/audit.js';
import {
  canonical,
  issuePreviewToken,
  sameHash,
  verifyPreviewToken,
} from '../services/clientImport/previewToken.js';
import { phaseKey, syncProjectPhases } from '../services/phases.js';
import { recomputeProject, userRefs } from '../services/projectService.js';
import type { ScopeUser } from '../services/scope.js';
import {
  planTimelineImport,
  type PlanContext,
  type PlanTask,
  type TimelinePlan,
} from '../services/timelineImport/plan.js';
import {
  buildTimelineWorkbook,
  readTimelineWorkbook,
  timelineFileError,
  type ParsedTimeline,
  type TimelineExportRow,
} from '../services/timelineImport/workbook.js';
import { assertNotArchived, assertPlanOpen, loadProject } from './projects.js';
import {
  phaseEditableNow,
  projectPhases,
  timelineExcelAllowed,
  timelineImportAllowed,
} from './tasks.js';

/**
 * CR-22 Part B slice 3: timeline Excel template, export and import (FR-TL-14 to 22, 25, 26).
 *   GET  /projects/:id/timeline/template        blank workbook (FR-TL-16, A-54)
 *   GET  /projects/:id/timeline/export          the project's tasks in it (FR-TL-15)
 *   POST /projects/:id/timeline/import/preview  raw .xlsx; checks every row, saves nothing (FR-TL-17)
 *   POST /projects/:id/timeline/import/commit   the same file, the preview token and the confirmed
 *        Changed-since-export rows (`confirm=12,15`); re-plans inside one transaction and saves only
 *        if the result equals the preview (else 409 PREVIEW_STALE), all or nothing (FR-TL-18, 25)
 * Planners only (Admin, PM on the project; AC-74.5): Members get 403, a PM outside the project 404.
 * Same file checks, limits, signed preview token and busy rule as CR-19 (NFR-52).
 */

type ProjectDoc = Project & { _id: Types.ObjectId };

const uploadQuerySchema = z.strictObject({
  fileName: z.string().trim().max(255).optional(),
  confirm: z
    .string()
    .max(20_000)
    .regex(/^(\d+(,\d+)*)?$/, 'Use row numbers separated by commas.')
    .optional(),
});

const rawParser = express.raw({ type: () => true, limit: CLIENT_IMPORT_MAX_BYTES + 64 * 1024 });
function rawXlsx(req: Request, res: Response, next: NextFunction) {
  rawParser(req, res, (err?: unknown) => {
    if ((err as { type?: string } | undefined)?.type === 'entity.too.large') {
      return next(timelineFileError(413, 'FILE_TOO_LARGE', TIMELINE_FILE_ERRORS.FILE_TOO_LARGE));
    }
    next(err);
  });
}

function uploadOf(req: Request) {
  const q = parseQuery(uploadQuerySchema, req);
  if (!Buffer.isBuffer(req.body) || !req.body.length)
    throw timelineFileError(415, 'NOT_XLSX', TIMELINE_FILE_ERRORS.NOT_XLSX);
  const confirm = new Set((q.confirm ? q.confirm.split(',') : []).map(Number));
  return { buf: req.body as Buffer, fileName: q.fileName || 'timeline.xlsx', confirm };
}

const sha256Of = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
const stale = () =>
  new HttpError(
    409,
    'PREVIEW_STALE',
    `${TIMELINE_IMPORT_COPY.STALE_LEAD} ${TIMELINE_IMPORT_COPY.STALE_REST}`,
  );

const PH_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Manila',
});
const PH_LONG = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Manila',
});
const shortDay = (d: unknown) =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)
    ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null;

/** Fields of a task's history that a timeline row also sets (FR-TL-25). */
const PLAN_LOG_FIELDS = new Set([
  'name',
  'phase',
  'phaseId',
  'isMilestone',
  'plannedStart',
  'dueDate',
  'dependsOn',
  'ownerId',
]);

/**
 * FR-TL-25: matched tasks whose plan changed after the file's export time, with UIE's line
 * ("Owner set to dev2@… by Test PM, Nov 10, 3:12 PM."). Without an export time (blank template,
 * missing or edited metadata) every matched task counts as changed, so nothing is overwritten
 * without the PM's confirm.
 */
async function changedSince(
  taskIds: string[],
  since: Date | null,
  session: mongoose.ClientSession | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!taskIds.length) return out;
  if (!since) {
    for (const id of taskIds) out.set(id, TIMELINE_ROW_MESSAGES.CHANGED_SINCE_EXPORT);
    return out;
  }
  const logs = await ActivityLogModel.find({
    entityType: 'task',
    entityId: { $in: taskIds.map((id) => new Types.ObjectId(id)) },
    at: { $gt: since },
    'changes.field': { $in: [...PLAN_LOG_FIELDS] },
  })
    .select('entityId actorId at changes')
    .sort({ at: -1 })
    .session(session)
    .lean();
  const latest = new Map<string, (typeof logs)[number]>();
  for (const l of logs) if (!latest.has(String(l.entityId))) latest.set(String(l.entityId), l);
  const people = await userRefs([...latest.values()].map((l) => l.actorId));
  const emails = new Map(
    (
      await UserModel.find({
        _id: {
          $in: [...latest.values()].flatMap((l) =>
            (l.changes ?? [])
              .filter((c) => c.field === 'ownerId' && c.new)
              .map((c) => String(c.new)),
          ),
        },
      })
        .select('email')
        .session(session)
        .lean()
    ).map((u) => [u._id.toString(), u.email]),
  );
  for (const [id, l] of latest) {
    const parts: string[] = [];
    for (const c of l.changes ?? []) {
      if (!c.field || !PLAN_LOG_FIELDS.has(c.field)) continue;
      if (c.field === 'ownerId')
        parts.push(
          `Owner set to ${c.new ? (emails.get(String(c.new)) ?? 'another user') : 'nobody'}`,
        );
      else if (c.field === 'plannedStart' || c.field === 'dueDate') {
        const label = c.field === 'plannedStart' ? 'Start' : 'Finish';
        const [o, n] = [shortDay(c.old), shortDay(c.new)];
        parts.push(
          o && n ? `${label} moved ${o} → ${n}` : n ? `${label} set to ${n}` : `${label} cleared`,
        );
      } else if (c.field === 'name') parts.push('Task name changed');
      else if (c.field === 'phase' || c.field === 'phaseId') {
        if (!parts.includes('Phase changed')) parts.push('Phase changed');
      } else if (c.field === 'isMilestone') parts.push('Milestone changed');
      else if (c.field === 'dependsOn') parts.push('Depends on changed');
    }
    const who = l.actorId ? people.get(String(l.actorId))?.name : null;
    out.set(
      id,
      `Changed in OpsTrack after export: ${parts.join(', ')}${who ? ` by ${who}` : ''}, ${PH_TIME.format(l.at)}.`,
    );
  }
  return out;
}

const dateOf = (d: Date | null | undefined) => (d ? toDateOnly(d) : null);

async function planTasks(projectId: Types.ObjectId, session: mongoose.ClientSession | null) {
  const project = await ProjectModel.findById(projectId).select('phases').session(session).lean();
  const names = new Map((project?.phases ?? []).map((p) => [p._id.toString(), p.name]));
  const tasks = await TaskModel.find({ projectId })
    .select('order name phase phaseId isMilestone plannedStart dueDate dependsOn ownerId version')
    .sort({ order: 1, _id: 1 })
    .session(session)
    .lean();
  return tasks.map((t): PlanTask => ({
    id: t._id.toString(),
    order: t.order ?? 0,
    name: t.name,
    phase: (t.phaseId ? names.get(t.phaseId.toString()) : null) ?? t.phase ?? null,
    isMilestone: Boolean(t.isMilestone),
    plannedStart: dateOf(t.plannedStart),
    dueDate: dateOf(t.dueDate),
    dependsOn: (t.dependsOn ?? []).map(String),
    ownerId: t.ownerId ? t.ownerId.toString() : null,
    version: t.version ?? 0,
  }));
}

/** FR-TL-26: a file exported from another project is refused before any row is checked. */
function assertSameProject(file: ParsedTimeline, project: ProjectDoc) {
  const pid = file.meta?.projectId;
  if (pid && pid !== project._id.toString()) {
    throw timelineFileError(422, 'OTHER_PROJECT', otherProjectError(project.name));
  }
}

async function contextFor(
  file: ParsedTimeline,
  project: ProjectDoc,
  user: ScopeUser,
  canAddPhase: boolean,
  session: mongoose.ClientSession | null,
): Promise<PlanContext> {
  const tasks = await planTasks(project._id, session);
  const phases = (await projectPhases(project._id, session ?? undefined)).map((p) => ({
    id: p.id ? p.id.toString() : null,
    name: p.name,
  }));
  const emails = [
    ...new Set(file.rows.map((r) => r.values.owner.trim().toLowerCase()).filter(Boolean)),
  ];
  const ownerIds = [...new Set(tasks.map((t) => t.ownerId).filter(Boolean))] as string[];
  const [byEmail, owners] = await Promise.all([
    UserModel.find({ email: { $in: emails } })
      .select('email active')
      .session(session)
      .lean(),
    UserModel.find({ _id: { $in: ownerIds } })
      .select('email')
      .session(session)
      .lean(),
  ]);
  // A matched task's export-time check: the file's own export time, for this project only.
  const since =
    file.meta?.projectId === project._id.toString() ? (file.meta?.exportedAt ?? null) : null;
  const fileIds = new Set(file.rows.map((r) => r.values.taskId).filter(Boolean));
  const matched = tasks.filter((t) => fileIds.has(t.id)).map((t) => t.id);
  void user;
  return {
    tasks,
    phases,
    usersByEmail: new Map(
      byEmail.map((u) => [
        u.email.toLowerCase(),
        { id: u._id.toString(), active: Boolean(u.active) },
      ]),
    ),
    emailById: new Map(owners.map((u) => [u._id.toString(), u.email])),
    memberIds: new Set(
      [...(project.memberIds ?? []).map(String), project.managerId?.toString()].filter(
        Boolean,
      ) as string[],
    ),
    canAddPhase,
    statusLabel: PROJECT_STATUS_LABELS[project.status as ProjectStatus] ?? String(project.status),
    changedSince: await changedSince(matched, since, session),
  };
}

/** FR-TL-17 / FR-CLI-35b: what the preview showed, as one hash the commit must reproduce. */
function planHash(fileSha: string, projectId: string, plan: TimelinePlan): string {
  const body = {
    kind: 'timeline-import',
    file: fileSha,
    projectId,
    newPhases: plan.newPhases,
    rows: plan.rows.map((r) => ({
      ...r.dto,
      taskId: r.taskId,
      version: r.version,
    })),
  };
  return createHash('sha256').update(canonical(body)).digest('hex');
}

function importLimiter(step: 'preview' | 'commit', limit: number) {
  return rateLimit({
    windowMs: CLIENT_IMPORT_RATE_WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => `timeline-import-${step}:${currentUser(req)._id.toString()}`,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'RATE_LIMITED', CLIENT_IMPORT_MESSAGES.RATE_LIMITED)),
  });
}

const FIELD_OF: Record<TimelinePlanField, string[]> = {
  name: ['name'],
  phase: ['phaseId', 'phase'],
  milestone: ['isMilestone'],
  start: ['plannedStart'],
  finish: ['dueDate'],
  dependsOn: ['dependsOn'],
  owner: ['ownerId'],
};

export function timelineImportRouter(config: AppConfig, registry: RouteRegistry) {
  const p = registry.router('/projects');
  const key = config.clientImportTokenSecret;
  const requireKey = (_req: Request, _res: Response, next: NextFunction) =>
    key
      ? next()
      : next(
          new HttpError(503, 'IMPORT_NOT_CONFIGURED', CLIENT_IMPORT_MESSAGES.IMPORT_NOT_CONFIGURED),
        );
  const previewLimiter = importLimiter('preview', CLIENT_IMPORT_PREVIEW_LIMIT);
  const commitLimiter = importLimiter('commit', CLIENT_IMPORT_COMMIT_LIMIT);
  const committing = new Set<string>();

  /** AC-74.5: planners only; downloads also for a completed project, never an archived one. */
  async function excelProject(req: Request) {
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    assertNotArchived(project);
    if (!timelineExcelAllowed(currentUser(req), currentPermissions(req), project)) {
      throw forbidden('Only an Admin or this project\u2019s PM can use Excel for its timeline.');
    }
    return project;
  }

  /** Q-141: import while Planning, Active or On hold. */
  async function importProject(req: Request) {
    const project = await excelProject(req);
    assertPlanOpen(project);
    if (!timelineImportAllowed(currentUser(req), currentPermissions(req), project)) {
      throw unprocessable(TIMELINE_IMPORT_COPY.IMPORT_NOT_ALLOWED, 'PROJECT_NOT_IMPORTABLE');
    }
    return project;
  }

  async function workbookFor(project: ProjectDoc, req: Request, withRows: boolean) {
    const user = currentUser(req);
    const phases = (await projectPhases(project._id)).map((ph) => ph.name);
    const at = clockNow();
    let rows: TimelineExportRow[] = [];
    if (withRows) {
      const tasks = await TaskModel.find({ projectId: project._id })
        .select(
          'order name phase phaseId isMilestone plannedStart dueDate dependsOn ownerId baseline',
        )
        .sort({ order: 1, _id: 1 })
        .lean();
      const orderOf = new Map(tasks.map((t) => [t._id.toString(), t.order ?? 0]));
      const names = new Map((project.phases ?? []).map((ph) => [ph._id.toString(), ph.name]));
      const owners = new Map(
        (
          await UserModel.find({ _id: { $in: tasks.map((t) => t.ownerId).filter(Boolean) } })
            .select('email')
            .lean()
        ).map((u) => [u._id.toString(), u.email]),
      );
      rows = tasks.map((t) => ({
        number: t.order ?? 0,
        name: t.name,
        phase: (t.phaseId ? names.get(t.phaseId.toString()) : null) ?? t.phase ?? null,
        milestone: Boolean(t.isMilestone),
        start: dateOf(t.plannedStart),
        finish: dateOf(t.dueDate),
        dependsOn: (t.dependsOn ?? [])
          .map((d) => orderOf.get(String(d)))
          .filter((n): n is number => typeof n === 'number')
          .sort((a, b) => a - b),
        owner: t.ownerId ? (owners.get(t.ownerId.toString()) ?? null) : null,
        baselineStart: dateOf(t.baseline?.start),
        baselineFinish: dateOf(t.baseline?.finish),
        taskId: t._id.toString(),
      }));
    }
    const when = `${PH_LONG.format(at)} (Philippine time)`;
    const buf = await buildTimelineWorkbook({
      project: withRows ? { id: project._id.toString(), name: project.name } : null,
      phases,
      rows,
      exportedAt: at,
      exportedBy: user.email,
      note: withRows
        ? `Timeline of ${project.name}, exported ${when} by ${user.email}. Rows with a Task ID update their task when you import this file back into this project.`
        : `Blank timeline template, downloaded ${when}. Every row imports as a new task.`,
    });
    return { buf, rows: rows.length, at };
  }

  p.get('/:id/timeline/template', perm('tasks', 'edit'), async (req, res) => {
    const project = await excelProject(req);
    const { buf } = await workbookFor(project, req, false);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${TIMELINE_TEMPLATE_NAME}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  });

  p.get('/:id/timeline/export', perm('tasks', 'edit'), async (req, res) => {
    const project = await excelProject(req);
    const { buf, rows, at } = await workbookFor(project, req, true);
    const fileName = timelineExportFileName(project.name, phDateOf(at));
    // FR-AUD-01: project data leaving the app is recorded (who, when, how many), no values.
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'project',
      entityId: project._id,
      projectId: project._id,
      action: 'timeline_exported',
      meta: { fileName, size: buf.length, rows },
    });
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  });

  p.post(
    '/:id/timeline/import/preview',
    perm('tasks', 'edit'),
    requireKey,
    previewLimiter,
    rawXlsx,
    async (req, res) => {
      const project = await importProject(req);
      const { buf, fileName } = uploadOf(req);
      const file = await readTimelineWorkbook(buf);
      assertSameProject(file, project);
      const user = currentUser(req);
      const canAddPhase = phaseEditableNow(user, currentPermissions(req), project);
      const plan = planTimelineImport(
        file.rows,
        await contextFor(file, project, user, canAddPhase, null),
      );
      const token = issuePreviewToken(
        key as string,
        user._id.toString(),
        planHash(sha256Of(buf), project._id.toString(), plan),
      );
      const fromHere = file.meta?.projectId === project._id.toString();
      const body: TimelineImportPreviewDto = {
        fileName,
        size: buf.length,
        exported:
          fromHere && file.meta
            ? {
                at: file.meta.exportedAt ? file.meta.exportedAt.toISOString() : null,
                by: file.meta.exportedBy,
              }
            : null,
        rows: plan.rows.map((r) => r.dto),
        counts: plan.counts,
        newPhases: plan.newPhases,
        baselineFilled: plan.baselineFilled,
        token,
      };
      res.json(body);
    },
  );

  p.post(
    '/:id/timeline/import/commit',
    perm('tasks', 'edit'),
    requireKey,
    commitLimiter,
    rawXlsx,
    async (req, res) => {
      const userKey = currentUser(req)._id.toString();
      if (committing.has(userKey)) {
        res.setHeader('Retry-After', '5');
        throw new HttpError(429, 'IMPORT_BUSY', CLIENT_IMPORT_MESSAGES.IMPORT_BUSY);
      }
      committing.add(userKey);
      try {
        await runCommit(req, res);
      } finally {
        committing.delete(userKey);
      }
    },
  );

  async function runCommit(req: Request, res: Response) {
    const project = await importProject(req);
    const { buf, fileName, confirm } = uploadOf(req);
    const file = await readTimelineWorkbook(buf);
    assertSameProject(file, project);
    const user = currentUser(req);
    const check = verifyPreviewToken(
      key as string,
      req.get(CLIENT_IMPORT_TOKEN_HEADER) ?? undefined,
      user._id.toString(),
    );
    if (!check.ok) {
      req.log?.info({ reason: check.why }, 'timeline import preview token rejected');
      throw stale();
    }
    const canAddPhase = phaseEditableNow(user, currentPermissions(req), project);
    const importId = new Types.ObjectId();
    const sha256 = sha256Of(buf);
    const meta = { via: 'timeline_import', importId: importId.toString() };
    let result: TimelineImportCommitDto | null = null;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Overlapping imports on one project always conflict (the loser re-runs and differs).
        await ProjectModel.updateOne(
          { _id: project._id },
          { $inc: { __v: 1 } },
          { session, timestamps: false },
        );
        // Every phase has its record before new tasks point at one (Lead).
        await syncProjectPhases(project._id, { apply: true, session });
        const fresh = (await ProjectModel.findById(project._id)
          .session(session)
          .lean()) as ProjectDoc | null;
        if (!fresh) throw stale();
        const plan = planTimelineImport(
          file.rows,
          await contextFor(file, fresh, user, canAddPhase, session),
        );
        if (!sameHash(planHash(sha256, project._id.toString(), plan), check.hash)) throw stale();
        if (plan.counts.error) {
          throw unprocessable(
            `Fix ${plan.counts.errorMessages} errors in the file and upload again. Nothing was saved.`,
            'IMPORT_HAS_ERRORS',
          );
        }
        const entries: Parameters<typeof auditMany>[0] = [];

        // New phases go to the end of the list, each with its evidence folder (FR-TL-20).
        const phaseIds = new Map(
          (fresh.phases ?? []).map((ph) => [phaseKey(ph.name), { id: ph._id, name: ph.name }]),
        );
        let folderOrder = await FolderModel.countDocuments({
          projectId: project._id,
          parentId: null,
          kind: 'PHASE',
        }).session(session);
        for (const name of plan.newPhases) {
          const id = new Types.ObjectId();
          let folderName = name;
          for (
            let n = 2;
            await FolderModel.exists({
              projectId: project._id,
              parentId: null,
              nameKey: folderName.trim().toLowerCase(),
            }).session(session);
            n++
          )
            folderName = `${name} (${n})`;
          folderOrder += 1;
          await FolderModel.create(
            [
              {
                projectId: project._id,
                name: folderName,
                nameKey: folderName.trim().toLowerCase(),
                parentId: null,
                kind: 'PHASE',
                phase: name,
                order: folderOrder,
              },
            ],
            { session },
          );
          await ProjectModel.updateOne(
            { _id: project._id },
            { $push: { phases: { _id: id, name, targetDate: null } } },
            { session },
          );
          phaseIds.set(phaseKey(name), { id, name });
          entries.push({
            actorId: user._id,
            entityType: 'project',
            entityId: project._id,
            projectId: project._id,
            action: 'phase_created',
            changes: [{ field: 'name', old: null, new: name }],
            meta,
          });
        }

        const newIds = new Map<number, Types.ObjectId>();
        for (const r of plan.rows)
          if (r.dto.result === 'NEW') newIds.set(r.dto.row, new Types.ObjectId());
        const depIds = (refs: string[]) =>
          refs.map((ref) =>
            ref.startsWith('task:')
              ? new Types.ObjectId(ref.slice(5))
              : newIds.get(Number(ref.slice(4)))!,
          );
        const phaseOf = (k: string | null) => (k ? (phaseIds.get(k) ?? null) : null);
        const docValue = (field: string, f: NonNullable<(typeof plan.rows)[number]['fields']>) => {
          switch (field) {
            case 'name':
              return f.name;
            case 'phaseId':
              return phaseOf(f.phaseKey)?.id ?? null;
            case 'phase':
              return phaseOf(f.phaseKey)?.name ?? null;
            case 'isMilestone':
              return f.isMilestone;
            case 'plannedStart':
              return f.plannedStart ? new Date(`${f.plannedStart}T00:00:00.000Z`) : null;
            case 'dueDate':
              return f.dueDate ? new Date(`${f.dueDate}T00:00:00.000Z`) : null;
            case 'dependsOn':
              return depIds(f.dependsOn);
            case 'ownerId':
              return f.ownerId ? new Types.ObjectId(f.ownerId) : null;
          }
          return null;
        };
        const show = (v: unknown): unknown =>
          v instanceof Date
            ? toDateOnly(v)
            : v instanceof Types.ObjectId
              ? v.toString()
              : Array.isArray(v)
                ? v.map(show)
                : (v ?? null);

        // New tasks at the end, in file order, with the numbers the preview showed (FR-TL-18).
        const created: number[] = [];
        const newRows = plan.rows.filter((r) => r.dto.result === 'NEW');
        if (newRows.length) {
          const docs = newRows.map((r) => {
            const f = r.fields!;
            const doc: Record<string, unknown> = {
              _id: newIds.get(r.dto.row),
              projectId: project._id,
              order: r.dto.willBe,
            };
            for (const field of Object.values(FIELD_OF).flat()) doc[field] = docValue(field, f);
            return doc;
          });
          await TaskModel.insertMany(docs, { session });
          for (const [i, r] of newRows.entries()) {
            created.push(r.dto.willBe!);
            const doc = docs[i]!;
            entries.push({
              actorId: user._id,
              entityType: 'task',
              entityId: doc._id as Types.ObjectId,
              projectId: project._id,
              action: 'task_created',
              changes: Object.values(FIELD_OF)
                .flat()
                .filter((field) => {
                  const v = doc[field];
                  return v !== null && v !== false && !(Array.isArray(v) && !v.length);
                })
                .map((field) => ({ field, old: null, new: show(doc[field]) })),
              meta: { ...meta, row: r.dto.row },
            });
          }
        }

        // Updates: Update rows, plus Changed-since-export rows the PM confirmed (FR-TL-25).
        const toUpdate = plan.rows.filter(
          (r) =>
            r.dto.result === 'UPDATE' || (r.dto.result === 'CHANGED' && confirm.has(r.dto.row)),
        );
        const before = new Map(
          (
            await TaskModel.find({ _id: { $in: toUpdate.map((r) => r.taskId!) } })
              .session(session)
              .lean()
          ).map((t) => [t._id.toString(), t as unknown as Record<string, unknown>]),
        );
        for (const r of toUpdate) {
          const f = r.fields!;
          const set: Record<string, unknown> = {};
          for (const field of r.dto.changes.flatMap((c) => FIELD_OF[c]))
            set[field] = docValue(field, f);
          const done = await TaskModel.updateOne(
            { _id: r.taskId, version: r.version },
            { $set: set, $inc: { version: 1 } },
            { session },
          );
          if (!done.modifiedCount) throw stale();
          const old = before.get(r.taskId!) ?? {};
          entries.push({
            actorId: user._id,
            entityType: 'task',
            entityId: new Types.ObjectId(r.taskId!),
            projectId: project._id,
            action: 'task_updated',
            changes: Object.keys(set).map((field) => ({
              field,
              old: show(old[field]),
              new: show(set[field]),
            })),
            meta: {
              ...meta,
              row: r.dto.row,
              ...(r.dto.result === 'CHANGED' ? { confirmedOverwrite: true } : {}),
            },
          });
        }

        const leftUnconfirmed = plan.rows.filter(
          (r) => r.dto.result === 'CHANGED' && !confirm.has(r.dto.row),
        ).length;
        result = {
          importId: importId.toString(),
          created,
          updated: toUpdate.length,
          unchanged: plan.counts.unchanged,
          leftUnconfirmed,
          newPhases: plan.newPhases,
        };
        // FR-TL-19: one summary entry per import.
        entries.push({
          actorId: user._id,
          entityType: 'project',
          entityId: project._id,
          projectId: project._id,
          action: 'timeline_imported',
          meta: {
            ...meta,
            fileName,
            size: buf.length,
            sha256,
            counts: {
              added: created.length,
              updated: toUpdate.length,
              unchanged: plan.counts.unchanged,
              leftUnconfirmed,
              newPhases: plan.newPhases.length,
            },
          },
        });
        await auditMany(entries, { session });
      });
    } catch (err) {
      if (err instanceof HttpError && (err.status === 409 || err.status === 422)) throw err;
      await audit({
        actorId: user._id,
        entityType: 'project',
        entityId: project._id,
        projectId: project._id,
        action: 'timeline_import_failed',
        meta: { ...meta, fileName, size: buf.length, sha256 },
      }).catch(() => undefined);
      if (err instanceof HttpError || isDatabaseUnavailable(err)) throw err;
      req.log?.error({ err }, 'timeline import failed');
      throw new HttpError(500, 'IMPORT_FAILED', CLIENT_IMPORT_MESSAGES.IMPORT_FAILED);
    } finally {
      await session.endSession();
    }
    // FR-TL-22: dates, health and forecast follow the new plan.
    await recomputeProject(project._id);
    res.json(result);
  }

  return p.router;
}
