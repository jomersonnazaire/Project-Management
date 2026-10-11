import { darRangeSchema, phDateOf, savedReportQuerySchema, type DarReportDto } from '@xc8/shared';
import type { Request, Response } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';
import { perm, type RouteRegistry } from '../access/registry.js';
import { notFound } from '../lib/errors.js';
import { idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import { SavedReportModel, type SavedReport } from '../models/index.js';
import { audit } from '../services/audit.js';
import { buildDar, toSavedDto, toSavedDtos } from '../services/dar.js';
import { darFileName, darToPdf, darToXlsx } from '../services/darExport.js';

const formatParam = z.enum(['pdf', 'xlsx']);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Default range: today (FR-DAR-02). */
function rangeQuery(req: Request) {
  const today = phDateOf(new Date());
  const q = req.query as Record<string, unknown>;
  return parseQuery(darRangeSchema, {
    query: { ...q, from: q.from ?? q.to ?? today, to: q.to ?? q.from ?? today },
  } as unknown as Request);
}

function format(req: Request) {
  const f = formatParam.safeParse(req.params.format);
  if (!f.success) throw notFound();
  return f.data;
}

async function sendFile(res: Response, report: DarReportDto, fmt: 'pdf' | 'xlsx') {
  const body = fmt === 'pdf' ? await darToPdf(report) : await darToXlsx(report);
  res.setHeader('Content-Type', fmt === 'pdf' ? 'application/pdf' : XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="${darFileName(report, fmt)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(body);
}

/**
 * Daily Accomplishment Report (doc 14 §3, §14, §15): view, save and export the caller's own
 * report. No send and no email endpoint (Q-49). Saved reports are private to the saver
 * (404 for everyone else, NFR-25) and have no update or delete route (FR-DAR-15).
 */
export function darRouter(registry: RouteRegistry) {
  const r = registry.router('/dar');

  r.get('/', perm('activities', 'view'), async (req, res) => {
    const { from, to } = rangeQuery(req);
    res.json({ report: await buildDar(currentUser(req)._id, from, to) });
  });

  r.get('/export/:format', perm('activities', 'view'), async (req, res) => {
    const fmt = format(req);
    const { from, to } = rangeQuery(req);
    await sendFile(res, await buildDar(currentUser(req)._id, from, to), fmt);
  });

  r.get('/saved', perm('activities', 'view'), async (req, res) => {
    const q = parseQuery(savedReportQuerySchema, req);
    const user = currentUser(req);
    const filter: FilterQuery<SavedReport> = { userId: user._id };
    // "Saved from/to" filters by the PH date the report was saved.
    if (q.from || q.to) {
      filter.savedAt = {};
      if (q.from) filter.savedAt.$gte = new Date(`${q.from}T00:00:00+08:00`);
      if (q.to) filter.savedAt.$lt = new Date(new Date(`${q.to}T00:00:00+08:00`).getTime() + 864e5);
    }
    const docs = await SavedReportModel.find(filter)
      .select('-report')
      .sort({ savedAt: -1, _id: -1 })
      .limit(500)
      .lean();
    let items = await toSavedDtos(user._id, docs as never);
    if (q.label === 'LATEST') items = items.filter((i) => i.tag === 'LATEST');
    if (q.label === 'EARLIER') items = items.filter((i) => i.tag === 'EARLIER');
    res.json({ items });
  });

  // Saving stores exactly what the preview shows now (FR-DAR-12).
  r.post('/saved', perm('activities', 'view'), async (req, res) => {
    const { from, to } = parseBody(darRangeSchema, req);
    const user = currentUser(req);
    const report = await buildDar(user._id, from, to);
    const doc = await SavedReportModel.create({
      userId: user._id,
      from,
      to,
      savedAt: new Date(),
      totalActivities: report.totalActivities,
      totalMinutes: report.totalMinutes,
      report,
    });
    await audit({
      actorId: user._id,
      entityType: 'savedReport',
      entityId: doc._id,
      action: 'report_saved',
      changes: [{ field: 'range', old: null, new: `${from} to ${to}` }],
    });
    res.status(201).json({ item: await toSavedDto(user._id, doc.toObject() as never) });
  });

  const ownSaved = async (req: Request) => {
    const id = idParam(req);
    const doc = await SavedReportModel.findOne({
      _id: new Types.ObjectId(id),
      userId: currentUser(req)._id,
    }).lean();
    if (!doc) throw notFound();
    return doc;
  };

  r.get('/saved/:id', perm('activities', 'view'), async (req, res) => {
    const doc = await ownSaved(req);
    res.json({ item: await toSavedDto(currentUser(req)._id, doc as never) });
  });

  r.get('/saved/:id/export/:format', perm('activities', 'view'), async (req, res) => {
    const fmt = format(req);
    const doc = await ownSaved(req);
    await sendFile(res, doc.report as DarReportDto, fmt);
  });

  return [r.router];
}
