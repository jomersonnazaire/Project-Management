import {
  CLIENT_IMPORT_MAX_BYTES,
  CLIENT_IMPORT_MESSAGES as MSG,
  CLIENT_IMPORT_PERMISSIONS,
  CLIENT_IMPORT_TEMPLATE_NAME,
  XLSX_MIME,
  type ClientImportCommitDto,
  type ClientImportPreviewDto,
} from '@xc8/shared';
import { createHash } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { permAll, type RouteRegistry } from '../access/registry.js';
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
import { buildTemplate, readWorkbook } from '../services/clientImport/workbook.js';
import { visibleClientIds } from '../services/scope.js';

/**
 * CR-19: Clients Excel template download and import (FR-CLI-23..41).
 *   GET  /clients/import/template  the blank two-sheet template (FR-CLI-25..28)
 *   POST /clients/import/preview   raw .xlsx body; validates and matches, saves nothing (FR-CLI-34)
 *   POST /clients/import/commit    the same file again; re-validates and writes the valid rows in
 *                                  ONE transaction, all or nothing (FR-CLI-35)
 * All three need create AND edit on BOTH clients and contacts (FR-CLI-24, Q-111), checked by the
 * central gate from the Access Rules. The upload is parsed in memory and never stored (NFR-37).
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
  } satisfies ClientImportPreviewDto;
}

const isDuplicateKey = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

export function clientImportRouter(registry: RouteRegistry) {
  const r = registry.router('/clients/import');

  r.get('/template', IMPORT_GATE, async (_req, res) => {
    const buf = await buildTemplate();
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${CLIENT_IMPORT_TEMPLATE_NAME}"`);
    res.send(buf);
  });

  r.post('/preview', IMPORT_GATE, rawXlsx, async (req, res) => {
    const { buf, fileName } = uploadOf(req);
    const file = await readWorkbook(buf);
    const plan = await planImport(file, await contextFor(req));
    // Previews change nothing, so they aren't audited (FR-CLI-39).
    res.json(previewDto(plan, fileName, buf.length, file.notes));
  });

  r.post('/commit', IMPORT_GATE, rawXlsx, async (req, res) => {
    const { buf, fileName } = uploadOf(req);
    const file = await readWorkbook(buf);
    const ctx = await contextFor(req);
    const actorId = currentUser(req)._id;
    const importId = new Types.ObjectId();
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const meta = { importId: importId.toString() };
    let plan: ImportPlan | null = null;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // FR-CLI-35 / Q-116: re-validate against the data as it is now, inside the transaction.
        plan = await planImport(file, { ...ctx, session });
        const entries: Parameters<typeof auditMany>[0] = [];
        const newClients = plan.clients.filter((c) => c.result === 'NEW');
        const updClients = plan.clients.filter((c) => c.result === 'UPDATE');
        const newContacts = plan.contacts.filter((c) => c.result === 'NEW');
        const updContacts = plan.contacts.filter((c) => c.result === 'UPDATE');

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
      // Everything rolled back (AC-62.8); record the failure outside the transaction.
      await audit({
        actorId,
        entityType: 'clientImport',
        entityId: importId,
        action: 'clients_import_failed',
        meta: { ...meta, fileName, size: buf.length, sha256 },
      }).catch(() => undefined);
      if (err instanceof HttpError || isDatabaseUnavailable(err)) throw err;
      if (isDuplicateKey(err)) throw new HttpError(409, 'IMPORT_CONFLICT', MSG.IMPORT_CONFLICT);
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
