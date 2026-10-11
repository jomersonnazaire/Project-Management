import {
  AFTERNOON_TAKEN,
  DAY_PART_LABELS,
  MORNING_TAKEN,
  NO_WORKING_DAYS,
  PAST_LEAVE_ADMIN_ONLY,
  carryOverLimitMessage,
  entitlementSchema,
  fullDayTypeMessage,
  leaveListQuerySchema,
  leaveOverlapMessage,
  leaveRangeLabel,
  leaveTypeSchema,
  negativeBalanceWarning,
  overBalanceMessage,
  parseDateOnly,
  recordLeaveSchema,
  todayPH,
  toDateOnly,
  updateLeaveTypeSchema,
  addDays,
  type EntitlementRowDto,
} from '@xc8/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { conflictWith, unprocessable } from '../lib/http422.js';
import { idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import { LeaveEntitlementModel, LeaveModel, LeaveTypeModel, UserModel } from '../models/index.js';
import { audit } from '../services/audit.js';
import {
  balancesFor,
  calendar,
  leaveRecipients,
  leaveSpan,
  recordedByType,
  toLeaveDtos,
  toLeaveTypeDto,
  type LeaveDoc,
  type LeaveTypeDoc,
} from '../services/leave.js';
import { notifyPersonal } from '../services/notify.js';
import { canViewPerson, touchDay } from '../services/tracker.js';

type Id = Types.ObjectId;
const yearNow = () => todayPH().getUTCFullYear();
const fail = (path: string, message: string, code = 'VALIDATION_ERROR') =>
  badRequest(message, [{ path, message }], code);

/**
 * Leave (doc 14 §4, §12 Q-46, §16): record Full day / Half day AM / Half day PM without approval,
 * yearly balances, cancel, privacy (FR-LV-07), Admin types and entitlements (FR-LV-01, -02).
 */
export function leaveRouter(registry: RouteRegistry) {
  const r = registry.router('/leave');

  // ----- Types (FR-LV-01) -----
  r.get('/types', perm('leave', 'view'), async (_req, res) => {
    const types = await LeaveTypeModel.find({ active: true }).sort({ order: 1, name: 1 }).lean();
    res.json({ items: types.map((t) => toLeaveTypeDto(t as LeaveTypeDoc)) });
  });
  r.get('/types/all', perm('settings', 'view'), async (_req, res) => {
    const types = await LeaveTypeModel.find().sort({ order: 1, name: 1 }).lean();
    res.json({ items: types.map((t) => toLeaveTypeDto(t as LeaveTypeDoc)) });
  });
  const dupCheck = async (name: string, except?: Id) => {
    const existing = await LeaveTypeModel.findOne({
      nameKey: name.trim().toLowerCase(),
      ...(except ? { _id: { $ne: except } } : {}),
    }).lean();
    if (existing)
      throw conflictWith(`"${existing.name}" already exists.`, 'DUPLICATE_NAME', [
        { path: 'name', message: `"${existing.name}" already exists.` },
      ]);
  };
  r.post('/types', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(leaveTypeSchema, req);
    await dupCheck(input.name);
    const order = await LeaveTypeModel.countDocuments();
    const t = await LeaveTypeModel.create({ ...input, nameKey: input.name.toLowerCase(), order });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'leaveType',
      entityId: t._id,
      action: 'leave_type_created',
      changes: [{ field: 'name', old: null, new: t.name }],
    });
    res.status(201).json({ item: toLeaveTypeDto(t.toObject() as LeaveTypeDoc) });
  });
  r.patch('/types/:id', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(updateLeaveTypeSchema, req);
    const t = await LeaveTypeModel.findById(idParam(req));
    if (!t) throw notFound();
    if (input.name) await dupCheck(input.name, t._id);
    const changes: { field: string; old: unknown; new: unknown }[] = [];
    for (const [k, v] of Object.entries(input)) {
      if (t.get(k) !== v) {
        changes.push({ field: k, old: t.get(k), new: v });
        t.set(k, v);
      }
    }
    if (input.name) t.nameKey = input.name.toLowerCase();
    if (changes.length) {
      await t.save();
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'leaveType',
        entityId: t._id,
        action: 'leave_type_updated',
        changes,
      });
    }
    res.json({ item: toLeaveTypeDto(t.toObject() as LeaveTypeDoc) });
  });

  // ----- Entitlements (FR-LV-02, EC-79) -----
  const entQuery = z.strictObject({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    leaveTypeId: z.string().regex(/^[a-f0-9]{24}$/i),
  });
  const entitlementRow = async (
    user: { _id: Id; name: string },
    typeId: Id,
    year: number,
  ): Promise<EntitlementRowDto> => {
    const [type, e, used] = await Promise.all([
      LeaveTypeModel.findById(typeId).select('paid').lean(),
      LeaveEntitlementModel.findOne({ userId: user._id, leaveTypeId: typeId, year }).lean(),
      recordedByType(user._id, year),
    ]);
    const taken = used.get(typeId.toString()) ?? 0;
    const balance = type?.paid ? (e?.days ?? 0) + (e?.carryOver ?? 0) - taken : null;
    return {
      user: { id: user._id.toString(), name: user.name },
      leaveTypeId: typeId.toString(),
      year,
      entitlement: e ? e.days : null,
      carryOver: e?.carryOver ?? 0,
      taken,
      balance,
      negative: balance !== null && balance < 0,
    };
  };
  r.get('/entitlements', perm('settings', 'view'), async (req, res) => {
    const q = parseQuery(entQuery, req);
    const year = q.year ?? yearNow();
    const typeId = new Types.ObjectId(q.leaveTypeId);
    if (!(await LeaveTypeModel.exists({ _id: typeId }))) throw notFound();
    const users = await UserModel.find({ active: true }).select('name').sort({ name: 1 }).lean();
    const items = [];
    for (const u of users) items.push(await entitlementRow(u, typeId, year));
    res.json({ items });
  });
  r.put('/entitlements', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(entitlementSchema, req);
    const [user, type] = await Promise.all([
      UserModel.findById(input.userId).select('name').lean(),
      LeaveTypeModel.findById(input.leaveTypeId).lean(),
    ]);
    if (!user || !type) throw notFound();
    if (type.carryOverLimit !== null && type.carryOverLimit !== undefined) {
      if (input.carryOver > type.carryOverLimit)
        throw fail('carryOver', carryOverLimitMessage(type.name, type.carryOverLimit));
    }
    const filter = { userId: user._id, leaveTypeId: type._id, year: input.year };
    const old = await LeaveEntitlementModel.findOne(filter).lean();
    await LeaveEntitlementModel.updateOne(
      filter,
      { $set: { days: input.days, carryOver: input.carryOver } },
      { upsert: true },
    );
    const row = await entitlementRow(user, type._id, input.year);
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'leaveEntitlement',
      entityId: user._id,
      action: 'leave_entitlement_changed',
      changes: [
        {
          field: `${type.name} ${input.year}`,
          old: old ? { days: old.days, carryOver: old.carryOver } : null,
          new: { days: input.days, carryOver: input.carryOver },
        },
        ...(row.negative ? [{ field: 'balance', old: null, new: row.balance }] : []),
      ],
    });
    res.json({
      item: row,
      warning:
        row.negative && row.balance !== null
          ? negativeBalanceWarning(user.name, row.taken, type.name, input.days, row.balance)
          : null,
    });
  });

  // ----- Balances and lists -----
  const personParam = async (req: Request, userId?: string) => {
    const viewer = currentUser(req);
    if (!userId) return { viewer, userId: viewer._id };
    const id = new Types.ObjectId(userId);
    if (!(await canViewPerson(viewer, id))) throw notFound();
    return { viewer, userId: id };
  };

  r.get('/balances', perm('leave', 'view'), async (req, res) => {
    const q = parseQuery(leaveListQuerySchema, req);
    const { userId } = await personParam(req, q.userId);
    const year = q.year ?? yearNow();
    const u = await UserModel.findById(userId).select('supervisorId').lean();
    const supervisor = u?.supervisorId
      ? await UserModel.findOne({ _id: u.supervisorId, active: true }).select('name').lean()
      : null;
    res.json({
      year,
      items: await balancesFor(userId, year),
      supervisor: supervisor ? { id: supervisor._id.toString(), name: supervisor.name } : null,
    });
  });

  r.get('/', perm('leave', 'view'), async (req, res) => {
    const q = parseQuery(leaveListQuerySchema, req);
    const { viewer, userId } = await personParam(req, q.userId);
    const year = q.year ?? yearNow();
    const docs = (await LeaveModel.find({
      userId,
      from: { $lte: parseDateOnly(`${year}-12-31`) },
      to: { $gte: parseDateOnly(`${year}-01-01`) },
    })
      .sort({ from: -1, createdAt: -1 })
      .lean()) as LeaveDoc[];
    res.json({ items: await toLeaveDtos(docs, viewer, todayPH()) });
  });

  // Team on leave, next 30 days (direct reports; Admins: everyone).
  r.get('/team', perm('leave', 'view'), async (req, res) => {
    const viewer = currentUser(req);
    const people = await UserModel.find(
      viewer.systemRole === 'ADMIN'
        ? { active: true, _id: { $ne: viewer._id } }
        : { active: true, supervisorId: viewer._id },
    )
      .select('name supervisorId')
      .sort({ name: 1 })
      .lean();
    const today = todayPH();
    const docs = (await LeaveModel.find({
      userId: { $in: people.map((p) => p._id) },
      status: 'RECORDED',
      to: { $gte: today },
      from: { $lte: addDays(today, 30) },
    })
      .sort({ from: 1 })
      .lean()) as LeaveDoc[];
    const year = today.getUTCFullYear();
    const balances = [];
    for (const p of people) {
      balances.push({
        user: { id: p._id.toString(), name: p.name },
        noSupervisor: !p.supervisorId,
        items: (await balancesFor(p._id, year)).filter((b) => b.type.paid),
      });
    }
    res.json({ items: await toLeaveDtos(docs, viewer, today), people: balances, year });
  });

  r.get('/:id', perm('leave', 'view'), async (req, res) => {
    const doc = (await LeaveModel.findById(idParam(req)).lean()) as LeaveDoc | null;
    if (!doc) throw notFound();
    const viewer = currentUser(req);
    if (!(await canViewPerson(viewer, doc.userId))) throw notFound();
    const [item] = await toLeaveDtos([doc], viewer, todayPH());
    res.json({ item });
  });

  // ----- Record (Q-46: no approval; FR-LV-05, FR-LV-11, EC-78) -----
  r.post('/', perm('leave', 'create'), async (req, res) => {
    const input = parseBody(recordLeaveSchema, req);
    const user = currentUser(req);
    const type = await LeaveTypeModel.findOne({ _id: input.leaveTypeId, active: true }).lean();
    if (!type) throw fail('leaveTypeId', 'Choose a leave type.');
    if (input.dayPart !== 'FULL' && type.unit === 'DAY')
      throw fail('dayPart', fullDayTypeMessage(type.name));
    const span = leaveSpan(input.from, input.to, input.dayPart, await calendar());
    if (!span.days)
      throw unprocessable(NO_WORKING_DAYS, 'NO_WORKING_DAYS', [
        { path: 'from', message: NO_WORKING_DAYS },
      ]);

    const from = parseDateOnly(input.from);
    const to = parseDateOnly(input.to);
    const existing = await LeaveModel.find({
      userId: user._id,
      status: 'RECORDED',
      from: { $lte: to },
      to: { $gte: from },
    })
      .sort({ from: 1 })
      .lean();
    for (const e of existing) {
      const range = leaveRangeLabel(toDateOnly(e.from), toDateOnly(e.to));
      let message: string | null = null;
      if (input.dayPart === 'FULL' || e.dayPart === 'FULL') message = leaveOverlapMessage(range);
      else if (e.dayPart === input.dayPart)
        message = input.dayPart === 'AM' ? MORNING_TAKEN : AFTERNOON_TAKEN;
      if (message)
        throw unprocessable(message, 'LEAVE_OVERLAP', [
          { path: input.dayPart === 'FULL' ? 'from' : 'dayPart', message },
        ]);
    }

    if (type.paid) {
      const used = new Map<number, Map<string, number>>();
      for (const y of span.byYear) {
        used.set(y.year, await recordedByType(user._id, y.year));
        const ent = await LeaveEntitlementModel.findOne({
          userId: user._id,
          leaveTypeId: type._id,
          year: y.year,
        }).lean();
        const left =
          (ent?.days ?? 0) +
          (ent?.carryOver ?? 0) -
          (used.get(y.year)!.get(type._id.toString()) ?? 0);
        if (y.days > left) {
          const message = overBalanceMessage(Math.max(0, left), type.name, y.days);
          throw unprocessable(message, 'OVER_BALANCE', [{ path: 'leaveTypeId', message }]);
        }
      }
    }

    const doc = await LeaveModel.create({
      userId: user._id,
      leaveTypeId: type._id,
      dayPart: input.dayPart,
      from,
      to,
      dates: span.dates,
      days: span.days,
      byYear: span.byYear,
      reason: input.reason?.trim() || null,
      recordedBy: user._id,
    });
    for (const d of span.dates) await touchDay(user._id, d);
    const dates = leaveRangeLabel(input.from, input.to);
    await audit({
      actorId: user._id,
      entityType: 'leave',
      entityId: doc._id,
      action: 'leave_recorded',
      changes: [
        {
          field: 'leave',
          old: null,
          new: `${type.name} · ${dates} · ${DAY_PART_LABELS[input.dayPart]} · ${span.days}`,
        },
      ],
    });
    const notified = await notifyPersonal({
      type: 'LEAVE_RECORDED',
      actorId: user._id,
      recipients: await leaveRecipients(user._id),
      message: `${user.name} recorded ${type.name} leave for ${dates} (${DAY_PART_LABELS[input.dayPart]}).`,
      link: '/leave?tab=team',
    });
    const [item] = await toLeaveDtos([doc.toObject() as LeaveDoc], user, todayPH());
    res.status(201).json({ item, notified });
  });

  // ----- Cancel (§10, FR-LV-08) -----
  r.post('/:id/cancel', perm('leave', 'edit'), async (req, res) => {
    const doc = await LeaveModel.findById(idParam(req));
    if (!doc) throw notFound();
    const user = currentUser(req);
    const relation = await canViewPerson(user, doc.userId);
    if (!relation) throw notFound();
    const own = relation === 'self';
    const isAdmin = user.systemRole === 'ADMIN';
    if (!own && !isAdmin)
      throw forbidden('Only the person or an Admin can cancel leave.', 'FORBIDDEN_CANCEL');
    if (doc.status !== 'RECORDED')
      throw unprocessable('This leave is already cancelled.', 'ALREADY_CANCELLED');
    if (!isAdmin && doc.from <= todayPH()) throw unprocessable(PAST_LEAVE_ADMIN_ONLY, 'PAST_LEAVE');
    doc.status = 'CANCELLED';
    doc.cancelledAt = new Date();
    doc.cancelledBy = user._id;
    await doc.save();
    for (const d of doc.dates) await touchDay(doc.userId, new Date(d as unknown as Date));
    const type = await LeaveTypeModel.findById(doc.leaveTypeId).select('name').lean();
    const dates = leaveRangeLabel(toDateOnly(doc.from), toDateOnly(doc.to));
    await audit({
      actorId: user._id,
      entityType: 'leave',
      entityId: doc._id,
      action: 'leave_cancelled',
      changes: [{ field: 'status', old: 'RECORDED', new: 'CANCELLED' }],
    });
    const owner = await UserModel.findById(doc.userId).select('name').lean();
    if (own) {
      await notifyPersonal({
        type: 'LEAVE_CANCELLED',
        actorId: user._id,
        recipients: await leaveRecipients(doc.userId),
        message: `${user.name} cancelled ${type?.name ?? ''} leave for ${dates}.`,
        link: '/leave?tab=team',
      });
    } else {
      // An Admin cancelled someone's leave: the person and their supervisor are told (§10).
      await notifyPersonal({
        type: 'LEAVE_CANCELLED',
        actorId: user._id,
        recipients: [doc.userId],
        message: `${user.name} cancelled your ${type?.name ?? ''} leave for ${dates}.`,
        link: '/leave',
      });
      await notifyPersonal({
        type: 'LEAVE_CANCELLED',
        actorId: user._id,
        recipients: await leaveRecipients(doc.userId),
        message: `${user.name} cancelled ${owner?.name ?? 'a'}'s ${type?.name ?? ''} leave for ${dates}.`,
        link: '/leave?tab=team',
      });
    }
    const [item] = await toLeaveDtos([doc.toObject() as LeaveDoc], user, todayPH());
    res.json({ item });
  });

  return [r.router];
}
