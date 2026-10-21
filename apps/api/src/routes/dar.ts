import {
  DAR_NOTIFY_RECENT,
  darRangeSchema,
  darSendError,
  generatedRangeLabel,
  phDateOf,
  savedReportQuerySchema,
  type DarReportDto,
} from '@xc8/shared';
import type { Request, RequestHandler, Response } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';
import { perm, type RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { now as clockNow } from '../lib/clock.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import {
  ActivityLogModel,
  SavedReportModel,
  UserModel,
  type SavedReport,
} from '../models/index.js';
import { audit } from '../services/audit.js';
import { buildDar, toSavedDto, toSavedDtos } from '../services/dar.js';
import { darSendStatusPayload, resolveDarSupervisor } from '../services/darSend.js';
import { darFileName, darToPdf, darToXlsx } from '../services/darExport.js';
import { buildMicrosoftLoginUrl } from '../services/microsoftAuth.js';
import { setMicrosoftMailOAuthCookie } from '../services/microsoftOAuthCookie.js';
import { MOBILE_SEND_ONLY, isMobileSend, saveMobileDarState } from '../services/msSendReturn.js';
import { notifyPersonal } from '../services/notify.js';

const formatParam = z.enum(['pdf', 'xlsx']);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Default range: today (FR-DAR-02). */
function rangeQuery(req: Request) {
  const today = phDateOf(clockNow());
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
 * Daily Accomplishment Report (doc 14 §3, §14, §15, §N): view, save and export the caller's own
 * report, and Send a saved report from the user's own Microsoft 365 mailbox (FR-DAR-20, a
 * CSRF-protected POST) or, for password-only users, Notify supervisor (FR-DAR-24). Saved
 * reports are private to the saver (404 for everyone else, NFR-25) and have no update or
 * delete route (FR-DAR-15).
 */
export function darRouter(config: AppConfig, registry: RouteRegistry, sendLimiter: RequestHandler) {
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
      savedAt: clockNow(),
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

  r.get('/send-status', perm('activities', 'view'), async (req, res) => {
    const user = await UserModel.findById(currentUser(req)._id);
    if (!user) throw notFound();
    res.json(await darSendStatusPayload(config, user));
  });

  // Send starts with a POST (CSRF header + Origin allow-list, D1) and returns the Microsoft
  // URL; the browser then navigates there. Its own per-user limiter (D5).
  // Mobile Send (bearer only): same checks, the OAuth state is kept server-side instead of a
  // cookie and the callback returns to the app (services/msSendReturn.ts).
  r.post('/saved/:id/send/mobile', perm('activities', 'view'), sendLimiter, async (req, res) => {
    if (!isMobileSend(res)) throw MOBILE_SEND_ONLY;
    await startSend(req, res, true);
  });

  r.post('/saved/:id/send', perm('activities', 'view'), sendLimiter, async (req, res) => {
    await startSend(req, res, false);
  });

  async function startSend(req: Request, res: Response, mobile: boolean) {
    parseBody(z.strictObject({}), req);
    const doc = await ownSaved(req);
    const user = await UserModel.findById(currentUser(req)._id);
    if (!user) throw notFound();
    const status = await darSendStatusPayload(config, user);
    if (!status.enabled) {
      // Early refusals are audited like any failed send (FR-DAR-23, D6).
      const reason =
        status.reason === 'ms_disabled' ? 'not_enabled' : (status.reason ?? 'send_failed');
      await audit({
        actorId: user._id,
        entityType: 'savedReport',
        entityId: doc._id,
        action: 'report_send_failed',
        meta: { reason, stage: 'start' },
      });
      throw new HttpError(409, 'SEND_UNAVAILABLE', darSendError(reason), { reason });
    }
    const login = await buildMicrosoftLoginUrl(config, {
      scopes: ['Mail.Send'],
      loginHint: user.email,
    });
    const mailState = {
      codeVerifier: login.codeVerifier,
      state: login.state,
      nonce: login.nonce,
      userId: user._id.toString(),
      savedReportId: doc._id.toString(),
    };
    if (mobile) await saveMobileDarState(mailState);
    else setMicrosoftMailOAuthCookie(config, res, mailState);
    res.json({ url: login.url });
  }

  r.post('/saved/:id/notify-supervisor', perm('activities', 'view'), async (req, res) => {
    parseBody(z.strictObject({}), req);
    const doc = await ownSaved(req);
    const user = await UserModel.findById(currentUser(req)._id);
    if (!user) throw notFound();
    if (user.msOid) {
      throw conflict('Use Send to email your report.', 'USE_SEND');
    }
    const supervisor = await resolveDarSupervisor(user);
    if (!supervisor) {
      throw conflict('Ask an Admin to set your supervisor.', 'NO_SUPERVISOR');
    }
    // One notice per report per hour (D7). The in-flight set stops a double click racing
    // past the audit check (the API runs as one instance, see TD-01).
    const key = doc._id.toString();
    if (notifyInFlight.has(key)) throw conflict(DAR_NOTIFY_RECENT, 'NOTIFY_RECENT');
    notifyInFlight.add(key);
    try {
      const recent = await ActivityLogModel.exists({
        entityType: 'savedReport',
        entityId: doc._id,
        action: 'dar_supervisor_notified',
        at: { $gt: new Date(Date.now() - NOTIFY_WINDOW_MS) },
      });
      if (recent) throw conflict(DAR_NOTIFY_RECENT, 'NOTIFY_RECENT');
      res.json({ notified: await notifySupervisorOnce(user, supervisor, doc) });
    } finally {
      notifyInFlight.delete(key);
    }
  });

  return [r.router];
}

const NOTIFY_WINDOW_MS = 60 * 60 * 1000;
const notifyInFlight = new Set<string>();

async function notifySupervisorOnce(
  user: { _id: Types.ObjectId; name: string },
  supervisor: { _id: Types.ObjectId },
  doc: { _id: Types.ObjectId; from: string; to: string },
) {
  const range = generatedRangeLabel(doc.from, doc.to);
  const notified = await notifyPersonal({
    type: 'DAR_READY',
    actorId: user._id,
    recipients: [supervisor._id],
    message: `${user.name}'s DAR for ${range} is ready; ask them for the exported PDF.`,
    link: null,
  });
  if (notified > 0) {
    await audit({
      actorId: user._id,
      entityType: 'savedReport',
      entityId: doc._id,
      action: 'dar_supervisor_notified',
      meta: { supervisorId: supervisor._id.toString(), range },
    });
  }
  return notified;
}
