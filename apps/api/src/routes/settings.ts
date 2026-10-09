import {
  HOLIDAY_TYPE_LABELS,
  KEEP_ONE_WORKING_DAY,
  OPEN_TASK_STATUSES,
  copyHolidaysSchema,
  officialHolidaysSchema,
  PH_OFFICIAL_HOLIDAYS,
  holidaySchema,
  parseDateOnly,
  toDateOnly,
  updateHolidaySchema,
  workingDaysSchema,
  type CalendarDto,
  type HolidayDto,
  type HolidayImpactDto,
  type HolidayType,
} from '@xc8/shared';
import { Types } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { unprocessable } from '../lib/http422.js';
import { idParam, parseBody } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import {
  HolidayModel,
  ProjectModel,
  SettingModel,
  TaskModel,
  type Holiday,
} from '../models/index.js';
import { loadOfficialHolidays } from '../services/officialHolidays.js';
import { audit } from '../services/audit.js';
import { CALENDAR_KEY, workingDaysSetting } from '../services/calendar.js';

/**
 * Working-day calendar (FR-CAL-01..05): Admin › Settings › Holidays and Working days. Reading
 * needs View on settings, every change Edit on settings, and every change is audited (FR-CAL-04).
 * Changes only affect dates calculated afterwards: nothing here touches existing due dates (FR-CAL-03).
 */
const SETTINGS_ENTITY = new Types.ObjectId('000000000000000000000ca1');

type HolidayDoc = Holiday & { _id: Types.ObjectId };

const toDto = (h: HolidayDoc): HolidayDto => ({
  id: h._id.toString(),
  date: toDateOnly(h.date),
  name: h.name,
  type: h.type as HolidayType,
  note: h.note ?? null,
});

const prettyDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

function duplicate(existing: HolidayDoc) {
  const d = toDateOnly(existing.date);
  return conflict(
    `${prettyDate(d)} already has a holiday ("${existing.name}").`,
    'DUPLICATE_HOLIDAY',
  );
}

async function dueTasks(date: Date) {
  const tasks = await TaskModel.find({ dueDate: date, status: { $in: OPEN_TASK_STATUSES } })
    .select('name projectId dueDate')
    .sort({ projectId: 1, order: 1 })
    .limit(500)
    .lean();
  const projects = await ProjectModel.find({ _id: { $in: tasks.map((t) => t.projectId) } })
    .select('name archived')
    .lean();
  const names = new Map(projects.filter((p) => !p.archived).map((p) => [p._id.toString(), p.name]));
  return tasks
    .filter((t) => names.has(t.projectId.toString()))
    .map((t) => ({
      id: t._id.toString(),
      name: t.name,
      project: { id: t.projectId.toString(), name: names.get(t.projectId.toString())! },
      dueDate: toDateOnly(t.dueDate!),
    }));
}

export function settingsRouter(registry: RouteRegistry) {
  const r = registry.router('/settings');

  r.get('/calendar', perm('settings', 'view'), async (req, res) => {
    const y = Number(req.query.year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw badRequest('Invalid year.');
    const { days, version } = await workingDaysSetting();
    const holidays = (await HolidayModel.find({ year: y })
      .sort({ date: 1 })
      .lean()) as HolidayDoc[];
    const body: CalendarDto = {
      workingDays: days,
      version,
      year: y,
      holidays: holidays.map(toDto),
    };
    res.json(body);
  });

  // FR-CAL-05 / AC-CAL-3: at least one weekday stays ticked (422 otherwise).
  r.put('/working-days', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(workingDaysSchema, req);
    if (!input.days.length) {
      throw unprocessable(KEEP_ONE_WORKING_DAY, 'NO_WORKING_DAYS', [
        { path: 'days', message: KEEP_ONE_WORKING_DAY },
      ]);
    }
    const before = await workingDaysSetting();
    if (before.version !== input.version) {
      throw conflict(
        'Working days were changed by someone else. Refresh and try again.',
        'VERSION_CONFLICT',
      );
    }
    const updated = await SettingModel.findOneAndUpdate(
      { key: CALENDAR_KEY, version: input.version },
      {
        $set: { workingDays: [...input.days].sort(), updatedBy: currentUser(req)._id },
        $inc: { version: 1 },
      },
      { upsert: true, new: true },
    ).catch((e: { code?: number }) => {
      if (e.code === 11000)
        throw conflict('Working days were changed by someone else.', 'VERSION_CONFLICT');
      throw e;
    });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'settings',
      entityId: SETTINGS_ENTITY,
      action: 'working_days_updated',
      changes: [{ field: 'workingDays', old: before.days, new: input.days }],
    });
    const now = await workingDaysSetting();
    res.json({ workingDays: now.days, version: updated?.version ?? now.version });
  });

  // FR-CAL-03 / AC-CAL-2: how many open tasks are due on a date, shown before saving a holiday.
  r.get('/holidays/impact', perm('settings', 'view'), async (req, res) => {
    const date = String(req.query.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Invalid date.');
    const d = parseDateOnly(date);
    const tasks = await dueTasks(d);
    const existing = (await HolidayModel.findOne({ date: d }).lean()) as HolidayDoc | null;
    const body: HolidayImpactDto = {
      date,
      count: tasks.length,
      tasks,
      existing: existing ? toDto(existing) : null,
    };
    res.json(body);
  });

  r.post('/holidays', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(holidaySchema, req);
    const date = parseDateOnly(input.date);
    const existing = (await HolidayModel.findOne({ date }).lean()) as HolidayDoc | null;
    if (existing) throw duplicate(existing);
    const h = await HolidayModel.create({
      date,
      year: date.getUTCFullYear(),
      name: input.name,
      type: input.type,
      note: input.note || null,
    }).catch(async (e: { code?: number }) => {
      if (e.code === 11000)
        throw duplicate((await HolidayModel.findOne({ date }).lean()) as HolidayDoc);
      throw e;
    });
    const due = (await dueTasks(date)).length;
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'holiday',
      entityId: h._id,
      action: 'holiday_added',
      changes: [
        {
          field: 'holiday',
          old: null,
          new: `${input.date} ${input.name} (${HOLIDAY_TYPE_LABELS[input.type]})`,
        },
      ],
      // FR-CAL-03: existing due dates are left as they are.
      meta: { tasksDueThatDay: due, dueDatesChanged: 0 },
    });
    res.status(201).json({ holiday: toDto(h.toObject() as HolidayDoc), tasksDue: due });
  });

  r.patch('/holidays/:id', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(updateHolidaySchema, req);
    const h = await HolidayModel.findById(idParam(req));
    if (!h) throw notFound();
    const before = toDto(h.toObject() as HolidayDoc);
    if (input.date && input.date !== before.date) {
      const date = parseDateOnly(input.date);
      const clash = (await HolidayModel.findOne({
        date,
        _id: { $ne: h._id },
      }).lean()) as HolidayDoc | null;
      if (clash) throw duplicate(clash);
      h.date = date;
      h.year = date.getUTCFullYear();
    }
    if (input.name !== undefined) h.name = input.name;
    if (input.type !== undefined) h.type = input.type;
    if (input.note !== undefined) h.note = input.note || null;
    await h.save();
    const after = toDto(h.toObject() as HolidayDoc);
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'holiday',
      entityId: h._id,
      action: 'holiday_updated',
      changes: (['date', 'name', 'type', 'note'] as const)
        .filter((k) => before[k] !== after[k])
        .map((k) => ({ field: k, old: before[k], new: after[k] })),
    });
    res.json({ holiday: after });
  });

  r.delete('/holidays/:id', perm('settings', 'edit'), async (req, res) => {
    const h = await HolidayModel.findById(idParam(req));
    if (!h) throw notFound();
    await h.deleteOne();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'holiday',
      entityId: h._id,
      action: 'holiday_removed',
      changes: [{ field: 'holiday', old: `${toDateOnly(h.date)} ${h.name}`, new: null }],
    });
    res.status(204).end();
  });

  // "Copy from <previous year>" (FR-CAL-01): same month and day; dates already taken are skipped.
  r.post('/holidays/copy', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(copyHolidaysSchema, req);
    if (input.fromYear === input.toYear) throw badRequest('Choose a different year to copy from.');
    const source = await HolidayModel.find({ year: input.fromYear }).sort({ date: 1 }).lean();
    let copied = 0;
    let skipped = 0;
    for (const h of source) {
      const md = toDateOnly(h.date).slice(5);
      const target = `${input.toYear}-${md}`;
      const date = parseDateOnly(target);
      if (toDateOnly(date) !== target || (await HolidayModel.exists({ date }))) {
        skipped += 1; // Feb 29 in a non-leap year, or a date that already has a holiday.
        continue;
      }
      await HolidayModel.create({
        date,
        year: input.toYear,
        name: h.name,
        type: h.type,
        note: h.note ?? null,
      });
      copied += 1;
    }
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'settings',
      entityId: SETTINGS_ENTITY,
      action: 'holidays_copied',
      meta: { fromYear: input.fromYear, toYear: input.toYear, copied, skipped },
    });
    res.json({ copied, skipped });
  });

  // Seed data: the official Philippine holidays for 2026 and 2027 (types per the proclamations).
  r.post('/holidays/official', perm('settings', 'edit'), async (req, res) => {
    const { year } = parseBody(officialHolidaysSchema, req);
    if (!PH_OFFICIAL_HOLIDAYS[year]) {
      throw unprocessable(
        `There's no official holiday list for ${year} yet. Add the holidays one by one.`,
        'NO_OFFICIAL_LIST',
      );
    }
    const result = await loadOfficialHolidays(year);
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'settings',
      entityId: SETTINGS_ENTITY,
      action: 'holidays_loaded',
      meta: { year, ...result },
    });
    res.json(result);
  });

  return r.router;
}
