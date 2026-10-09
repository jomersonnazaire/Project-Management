import { PROJECT_CODE_LOCKED, PROJECT_CODE_TAKEN, issueKey, issuePrefix } from '@xc8/shared';
import type { Types } from 'mongoose';
import { conflictWith } from '../lib/http422.js';
import type { Logger } from 'pino';
import { ClientModel, IssueModel, MigrationModel, ProjectModel } from '../models/index.js';

/** DR-23: project codes are the issue ID prefix, unique ignoring case (stored in capitals). */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const codeTaken = () =>
  conflictWith(PROJECT_CODE_TAKEN, 'PROJECT_CODE_TAKEN', [
    { path: 'code', message: PROJECT_CODE_TAKEN },
  ]);
export const codeLocked = () =>
  conflictWith(PROJECT_CODE_LOCKED, 'PROJECT_CODE_LOCKED', [
    { path: 'code', message: PROJECT_CODE_LOCKED },
  ]);

export async function codeInUse(code: string, excludeId?: Types.ObjectId): Promise<boolean> {
  return Boolean(
    await ProjectModel.exists({
      code: { $regex: `^${escape(code)}$`, $options: 'i' },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }),
  );
}

export async function assertCodeFree(code: string, excludeId?: Types.ObjectId) {
  if (await codeInUse(code, excludeId)) throw codeTaken();
}

/** First free code from `base`: "ACME-SAP", then "ACME-SAP-2", "ACME-SAP-3"… */
export async function uniqueCode(base: string, taken?: Set<string>): Promise<string> {
  const root = base.toUpperCase().slice(0, 17);
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    if (taken ? !taken.has(candidate) : !(await codeInUse(candidate))) return candidate;
  }
}

export const isDuplicateCode = (e: unknown) =>
  (e as { code?: number; keyPattern?: Record<string, unknown> }).code === 11000 &&
  Boolean((e as { keyPattern?: Record<string, unknown> }).keyPattern?.code);

/** A project's code, assigning a suggested one first if it has none yet (legacy rows). */
export async function ensureProjectCode(p: {
  _id: Types.ObjectId;
  code?: string | null;
  name: string;
  clientId: Types.ObjectId;
  type?: string | null;
  issuePrefix?: string | null;
}): Promise<string> {
  if (p.code) return p.code;
  const client = await ClientModel.findById(p.clientId).select('name').lean();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = await uniqueCode(p.issuePrefix ?? issuePrefix(client?.name ?? p.name, p.type));
    try {
      await ProjectModel.updateOne({ _id: p._id, code: null }, { $set: { code } });
    } catch (e) {
      if (isDuplicateCode(e)) continue;
      throw e;
    }
    const fresh = await ProjectModel.findById(p._id).select('code').lean();
    if (fresh?.code) return fresh.code;
  }
  throw codeTaken();
}

export const DR23_MIGRATION_ID = 'dr23-project-codes';

/**
 * DR-23 startup migration (idempotent): give every project a unique code (keeping the prefix its
 * issues already use where that's free, otherwise the next free "-2", "-3"…), then renumber
 * issues to `<project code>-ISS-<number>`. Numbers never change, only the prefix. Safe to run on
 * every start: projects with a code and issues with the right key are left alone.
 */
export async function migrateProjectCodes(logger?: Logger) {
  const projects = await ProjectModel.find({})
    .select('code name clientId type issuePrefix createdAt')
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const taken = new Set(projects.filter((p) => p.code).map((p) => p.code!.toUpperCase()));
  const clientIds = [...new Set(projects.filter((p) => !p.code).map((p) => p.clientId.toString()))];
  const clients = new Map(
    (
      await ClientModel.find({ _id: { $in: clientIds } })
        .select('name')
        .lean()
    ).map((c) => [c._id.toString(), c.name]),
  );
  let coded = 0;
  for (const p of projects) {
    if (p.code) continue;
    const base = p.issuePrefix ?? issuePrefix(clients.get(p.clientId.toString()) ?? p.name, p.type);
    const code = await uniqueCode(base, taken);
    const r = await ProjectModel.updateOne({ _id: p._id, code: null }, { $set: { code } });
    if (r.modifiedCount) {
      taken.add(code);
      p.code = code;
      coded += 1;
    } else {
      p.code = (await ProjectModel.findById(p._id).select('code').lean())?.code ?? null;
    }
  }
  let renumbered = 0;
  const codeOf = new Map(projects.map((p) => [p._id.toString(), p.code]));
  const issues = await IssueModel.find({}).select('projectId number key').lean();
  for (const i of issues) {
    const code = codeOf.get(i.projectId.toString());
    if (!code) continue;
    const key = issueKey(code, i.number);
    if (i.key === key) continue;
    await IssueModel.updateOne({ _id: i._id }, { $set: { key } }, { timestamps: false });
    renumbered += 1;
  }
  // The issue prefix follows the code from now on.
  for (const p of projects) {
    if (p.code && p.issuePrefix !== p.code)
      await ProjectModel.updateOne(
        { _id: p._id },
        { $set: { issuePrefix: p.code } },
        { timestamps: false },
      );
  }
  await MigrationModel.updateOne(
    { _id: DR23_MIGRATION_ID },
    {
      $set: {
        kind: 'data',
        status: 'DONE',
        finishedAt: new Date(),
        result: { coded, renumbered },
      },
      $setOnInsert: { startedAt: new Date() },
    },
    { upsert: true },
  );
  if (coded || renumbered)
    logger?.info({ migration: DR23_MIGRATION_ID, coded, renumbered }, 'Project codes migrated');
  return { coded, renumbered };
}
