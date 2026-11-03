import {
  CLIENT_IMPORT_MAX_BYTES,
  CLIENT_IMPORT_MESSAGES as MSG,
  CLIENT_IMPORT_PERMISSIONS,
  CLIENT_IMPORT_TEMPLATE_NAME,
  CLIENT_IMPORT_TOKEN_HEADER,
  XLSX_MIME,
  type ClientImportCommitDto,
  type ClientImportPreviewDto,
} from '@xc8/shared';
import { createHash } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { permAll, type RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import { isDatabaseUnavailable } from '../middleware/errors.js';
import { ClientContactModel, ClientModel } from '../models/index.js';
import { audit, auditMany } from '../services/audit.js';
import {
  countsOf,
  planImport,
  rowDto,
  sumCounts,
  type ImportPlan,
} from '../services/clientImport/plan.js';
import {
  issuePreviewToken,
  resultHash,
  sameHash,
  verifyPreviewToken,
} from '../services/clientImport/previewToken.js';
import { buildTemplate, readWorkbook } from '../services/clientImport/workbook.js';
import { visibleClientIds } from '../services/scope.js';

/**
 * CR-19: Clients Excel template download and import (FR-CLI-23..41).
 *   GET  /clients/import/template  the blank two-sheet template (FR-CLI-25..28)
 *   POST /clients/import/preview   raw .xlsx body; validates and matches, saves nothing (FR-CLI-34)
 *   POST /clients/import/commit    the same file again plus the preview's signed token; re-runs
 *                                  the result and writes the valid rows in ONE transaction, all or
 *                                  nothing (FR-CLI-35), only if the result equals the preview
 *                                  (FR-CLI-35b, Q-116), else 409 PREVIEW_STALE
 * All three need create AND edit on BOTH clients and contacts (FR-CLI-24, Q-111), checked by the
 * central gate from the Access Rules. The upload is parsed in memory and never stored (NFR-37).
 * Without the signing key (NFR-42) all three return 503 IMPORT_NOT_CONFIGURED (AC-62.23).
 */

const IMPORT_GATE = permAll(CLIENT_IMPORT_PERMISSIONS);

const uploadQuerySchema = z.strictObject({
  fileName: z.string().trim().max(255).optional(),
});

const rawParser = express.raw({ type: () => true, limit: CLIENT_IMPORT_MAX_BYTES + 64 * 1024 });

/** Raw body up to 5 MB (NFR-36); a larger body is the §9 413, not the JSON parser's error. */
function rawXlsx(req: Request, res: Response, next: NextFunction) {
  rawParser(req, res, (err?: unknown) => {
    if ((err as { type?: string } | undefined)?.type === 'entity.too.large') {
      return next(new HttpError(413, 'FILE_TOO_LARGE', MSG.FILE_TOO_LARGE));
    }
    next(err);
  });
}

function uploadOf(req: Request) {
  const { fileName } = parseQuery(uploadQuerySchema, req);
  if (!Buffer.isBuffer(req.body))
    throw new HttpError(415, 'UNSUPPORTED_FILE', MSG.UNSUPPORTED_FILE);
  return { buf: req.body, fileName: fileName || 'upload.xlsx' };
}

async function contextFor(req: Request) {
  const scope = await visibleClientIds(currentUser(req));
  return {
    canChangeStatus: Boolean(currentPermissions(req).clients?.delete),
    scope: scope ? new Set(scope.map((id) => id.toString())) : null,
  };
}

const stale = () => new HttpError(409, 'PREVIEW_STALE', MSG.PREVIEW_STALE);

const sha256Of = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function previewDto(plan: ImportPlan, fileName: string, size: number, notes: string[]) {
  const clients = countsOf(plan.clients);
  const contacts = countsOf(plan.contacts);
  return {
    fileName,
    size,
    counts: { clients, contacts, total: sumCounts(clients, contacts) },
    clients: plan.clients.map(rowDto),
    contacts: plan.contacts.map(rowDto),
    notes,
  } satisfies Omit<ClientImportPreviewDto, 'token'>;
}

const isDuplicateKey = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

export function clientImportRouter(config: AppConfig, registry: RouteRegistry) {
  const r = registry.router('/clients/import');
  const key = config.clientImportTokenSecret;

  /** AC-62.23 / EC-158: no signing key, no import (same shape as STORAGE_NOT_CONFIGURED). */
  const requireKey = (_req: Request, _res: Response, next: NextFunction) =>
    key ? next() : next(new HttpError(503, 'IMPORT_NOT_CONFIGURED', MSG.IMPORT_NOT_CONFIGURED));
  const signingKey = () => key as string;

  r.get('/template', IMPORT_GATE, requireKey, async (_req, res) => {
    const buf = await buildTemplate();
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${CLIENT_IMPORT_TEMPLATE_NAME}"`);
    res.send(buf);
  });

  r.post('/preview', IMPORT_GATE, requireKey, rawXlsx, async (req, res) => {
    const { buf, fileName } = uploadOf(req);
    const file = await readWorkbook(buf);
    const plan = await planImport(file, await contextFor(req));
    // FR-CLI-35b: sign what this preview showed, for this user, now. Nothing is stored.
    const token = issuePreviewToken(
      signingKey(),
      currentUser(req)._id.toString(),
      resultHash(sha256Of(buf), plan),
    );
    // Previews change nothing, so they aren't audited (FR-CLI-39).
    const body: ClientImportPreviewDto = {
      ...previewDto(plan, fileName, buf.length, file.notes),
      token,
    };
    res.json(body);
  });

  r.post('/commit', IMPORT_GATE, requireKey, rawXlsx, async (req, res) => {
    const { buf, fileName } = uploadOf(req);
    const file = await readWorkbook(buf);
    const actorId = currentUser(req)._id;
    // FR-CLI-35b: signature, user and 15-minute age first. A failure never says why or whose
    // token it was (AC-62.21); the reason goes to the server log only.
    const check = verifyPreviewToken(
      signingKey(),
      req.get(CLIENT_IMPORT_TOKEN_HEADER) ?? undefined,
      actorId.toString(),
    );
    if (!check.ok) {
      req.log?.info({ reason: check.why }, 'client import preview token rejected');
      throw stale();
    }
    const ctx = await contextFor(req);
    const importId = new Types.ObjectId();
    const sha256 = sha256Of(buf);
    const meta = { importId: importId.toString() };
    let plan: ImportPlan | null = null;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // FR-CLI-35b / Q-116: recompute against the data as it is now, inside the transaction,
        // and save only if it equals what the preview showed. A transient write conflict makes
        // the driver re-run this callback, and the recomputed result then differs (EC-149).
        plan = await planImport(file, { ...ctx, session });
        if (!sameHash(resultHash(sha256, plan), check.hash)) throw stale();
        const entries: Parameters<typeof auditMany>[0] = [];
        const newClients = plan.clients.filter((c) => c.result === 'NEW');
        const updClients = plan.clients.filter((c) => c.result === 'UPDATE');
        const newContacts = plan.contacts.filter((c) => c.result === 'NEW');
        const updContacts = plan.contacts.filter((c) => c.result === 'UPDATE');

        // EC-149: bump the version of every existing client this import writes to or under, so
        // two overlapping imports always hit a write conflict (the loser re-runs, differs, 409)
        // instead of both inserting the same new contact. updatedAt is left alone.
        const newIds = new Set(newClients.map((c) => c.newId!.toString()));
        const touched = new Map<string, Types.ObjectId>();
        for (const c of updClients) touched.set(c.existing!._id.toString(), c.existing!._id);
        for (const c of [...newContacts, ...updContacts]) {
          const id = c.clientId!;
          if (!newIds.has(id.toString())) touched.set(id.toString(), id);
        }
        if (touched.size) {
          await ClientModel.updateMany(
            { _id: { $in: [...touched.values()] } },
            { $inc: { __v: 1 } },
            { session, timestamps: false },
          );
        }

        // Clients first, so new contacts can link to new clients from the same file.
        if (newClients.length)
          await ClientModel.insertMany(
            newClients.map((c) => c.doc!),
            { session },
          );
        if (updClients.length) {
          await ClientModel.bulkWrite(
            updClients.map((c) => ({
              updateOne: {
                filter: { _id: c.existing!._id },
                update: {
                  $set: { ...c.set, ...(c.activeChange ? { active: c.activeChange.new } : {}) },
                },
              },
            })),
            { session },
          );
        }
        if (newContacts.length) {
          await ClientContactModel.insertMany(
            newContacts.map((c) => c.doc!),
            { session },
          );
        }
        if (updContacts.length) {
          await ClientContactModel.bulkWrite(
            updContacts.map((c) => ({
              updateOne: { filter: { _id: c.existing!._id }, update: { $set: c.set! } },
            })),
            { session },
          );
        }

        for (const c of newClients) {
          entries.push({
            actorId,
            entityType: 'client',
            entityId: c.newId!,
            action: 'client_created',
            changes: c.changes,
            meta,
          });
        }
        for (const c of updClients) {
          if (c.changes.length) {
            entries.push({
              actorId,
              entityType: 'client',
              entityId: c.existing!._id,
              action: 'client_updated',
              changes: c.changes,
              meta,
            });
          }
          if (c.activeChange) {
            entries.push({
              actorId,
              entityType: 'client',
              entityId: c.existing!._id,
              action: c.activeChange.new ? 'client_reactivated' : 'client_deactivated',
              changes: [{ field: 'active', old: c.activeChange.old, new: c.activeChange.new }],
              meta,
            });
          }
        }
        for (const c of newContacts) {
          entries.push({
            actorId,
            entityType: 'clientContact',
            entityId: c.newId!,
            action: 'contact_created',
            changes: c.changes,
            meta,
          });
        }
        for (const c of updContacts) {
          entries.push({
            actorId,
            entityType: 'clientContact',
            entityId: c.existing!._id,
            action: 'contact_updated',
            changes: c.changes,
            meta,
          });
        }
        entries.push({
          actorId,
          entityType: 'clientImport',
          entityId: importId,
          action: 'clients_imported',
          meta: {
            ...meta,
            fileName,
            size: buf.length,
            sha256,
            counts: { clients: countsOf(plan.clients), contacts: countsOf(plan.contacts) },
          },
        });
        await auditMany(entries, { session });
      });
    } catch (err) {
      // A stale preview wrote nothing and is not audited (AC-62.19).
      if (err instanceof HttpError && err.code === 'PREVIEW_STALE') throw err;
      // Everything rolled back (AC-62.8); record the failure outside the transaction.
      await audit({
        actorId,
        entityType: 'clientImport',
        entityId: importId,
        action: 'clients_import_failed',
        meta: { ...meta, fileName, size: buf.length, sha256 },
      }).catch(() => undefined);
      if (err instanceof HttpError || isDatabaseUnavailable(err)) throw err;
      // Another import wrote the same record first (AC-62.20, EC-149).
      if (isDuplicateKey(err)) throw stale();
      req.log?.error({ err }, 'client import failed');
      throw new HttpError(500, 'IMPORT_FAILED', MSG.IMPORT_FAILED);
    } finally {
      await session.endSession();
    }

    const done = plan as unknown as ImportPlan;
    const preview = previewDto(done, fileName, buf.length, file.notes);
    const total = preview.counts.total;
    const body: ClientImportCommitDto = {
      ...preview,
      importId: importId.toString(),
      applied: { created: total.new, updated: total.update, skipped: total.error },
    };
    res.json(body);
  });

  return r.router;
}
