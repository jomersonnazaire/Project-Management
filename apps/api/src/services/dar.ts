import {
  addDays,
  formatHHMM,
  formatTime12,
  parseDateOnly,
  phDateOf,
  toDateOnly,
  type DarDayDto,
  type DarDayStatus,
  type DarReportDto,
  type DarRowDto,
  type SavedReportDto,
  type SavedReportSummaryDto,
  type SavedTag,
} from '@xc8/shared';
import type { Types } from 'mongoose';
import {
  SavedReportModel,
  TimeEntryModel,
  TimesheetDayModel,
  UserModel,
  type SavedReport,
} from '../models/index.js';
import { leaveLabelFor } from './leaveHook.js';
import { userRefs } from './projectService.js';
import { sweepAutoStop, toTrackerDtos, type EntryDoc } from './tracker.js';

type Id = Types.ObjectId;

/**
 * Builds a person's Daily Accomplishment Report for a range (FR-DAR-02, -07 to -09).
 * Future days are left out (EC-80); running timers are left out until Time out.
 */
export async function buildDar(
  userId: Id,
  from: string,
  to: string,
  now = new Date(),
): Promise<DarReportDto> {
  await sweepAutoStop(now, userId);
  const today = phDateOf(now);
  const shownTo = from > today ? null : to > today ? today : to;
  const user = await UserModel.findById(userId).select('name supervisorId reportCc').lean();
  const supervisor = user?.supervisorId
    ? await UserModel.findById(user.supervisorId).select('name').lean()
    : null;

  let entries: EntryDoc[] = [];
  let runningExcluded = 0;
  const dayDocs = shownTo
    ? await TimesheetDayModel.find({
        userId,
        date: { $gte: parseDateOnly(from), $lte: parseDateOnly(shownTo) },
      }).lean()
    : [];
  if (shownTo) {
    const all = (await TimeEntryModel.find({
      userId,
      workDate: { $gte: parseDateOnly(from), $lte: parseDateOnly(shownTo) },
    })
      .sort({ workDate: 1, startAt: 1, createdAt: 1 })
      .lean()) as EntryDoc[];
    entries = all.filter((e) => !e.running);
    runningExcluded = all.length - entries.length;
  }
  const dtos = await toTrackerDtos(entries, {
    dayLocations: new Map(
      dayDocs.map((d) => [`${userId.toString()}|${toDateOnly(d.date)}`, d.locationId ?? null]),
    ),
  });
  const rows: DarRowDto[] = dtos.map((e) => {
    // FR-DAR-19: blank remarks fall back to the task name or the quick activity's title, no prefix.
    const remarks = e.notes?.trim() || (e.kind === 'QUICK' ? e.title : e.task?.name) || '';
    return {
      date: e.date,
      timeIn: e.startAt ? formatTime12(e.startAt) : '',
      timeOut: e.endAt ? formatTime12(e.endAt) : '',
      minutes: e.minutes,
      rendered: formatHHMM(e.minutes),
      client: e.project ? (e.client?.name ?? '') : '',
      project: e.project?.name ?? '',
      activityType: e.activityType?.name ?? '',
      location: e.location?.name ?? '',
      billable: e.billable ? 'Yes' : 'No',
      // FR-ACT-20: free text; a blank module shows as "–" when rendered (moduleLabel).
      module: e.module ?? '',
      remarks,
    };
  });

  const byDate = new Map(dayDocs.map((d) => [toDateOnly(d.date), d]));
  const reopeners = await userRefs(
    dayDocs.flatMap((d) => (d.status === 'REOPENED' ? d.reopened.slice(-1).map((r) => r.by) : [])),
  );
  const days: DarDayDto[] = [];
  if (shownTo) {
    for (let d = parseDateOnly(from); toDateOnly(d) <= shownTo; d = addDays(d, 1)) {
      const key = toDateOnly(d);
      const doc = byDate.get(key);
      const status: DarDayStatus =
        doc?.status === 'SUBMITTED'
          ? 'Submitted'
          : doc?.status === 'REOPENED'
            ? 'Reopened'
            : 'Not submitted';
      const last = doc?.status === 'REOPENED' ? doc.reopened.at(-1) : undefined;
      const dayRows = rows.filter((r) => r.date === key);
      days.push({
        date: key,
        status,
        reopenedBy: last ? (reopeners.get(last.by.toString())?.name ?? 'Unknown user') : null,
        leave: await leaveLabelFor(userId, d),
        minutes: dayRows.reduce((s, r) => s + r.minutes, 0),
        activities: dayRows.length,
      });
    }
  }
  // Leave days show "On leave" (FR-DAR-02, FR-LV-06) as a row that isn't an activity.
  const leaveDays = new Map(days.filter((d) => d.leave).map((d) => [d.date, d.leave!]));
  const shown: DarRowDto[] = [];
  for (const d of days) {
    const label = leaveDays.get(d.date);
    if (label) shown.push(leaveRow(d.date, label));
    shown.push(...rows.filter((r) => r.date === d.date));
  }
  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  return {
    user: { id: userId.toString(), name: user?.name ?? 'Unknown user' },
    supervisor: supervisor ? { id: supervisor._id.toString(), name: supervisor.name } : null,
    cc: [...(user?.reportCc ?? [])],
    from,
    to,
    shownTo,
    generatedAt: now.toISOString(),
    totalActivities: rows.length,
    totalMinutes,
    totalRendered: formatHHMM(totalMinutes),
    rows: shown,
    days,
    runningExcluded,
  };
}

const leaveRow = (date: string, label: string): DarRowDto => ({
  date,
  timeIn: '',
  timeOut: '',
  minutes: 0,
  rendered: '',
  client: '',
  project: '',
  activityType: '',
  location: '',
  billable: '',
  module: '',
  remarks: label,
  leave: true,
});

type SavedDoc = SavedReport & { _id: Id };

/**
 * Tags (FR-DAR-15): only an exact range saved more than once is tagged; the newest is "Latest",
 * older ones "Earlier version". Changed dates (FR-DAR-13) come from each day's last change.
 */
export async function toSavedDtos(userId: Id, docs: SavedDoc[]): Promise<SavedReportSummaryDto[]> {
  if (!docs.length) return [];
  const ranges = [...new Set(docs.map((d) => `${d.from}|${d.to}`))];
  const groups = await SavedReportModel.aggregate<{
    _id: { from: string; to: string };
    count: number;
    newest: Types.ObjectId;
  }>([
    {
      $match: {
        userId,
        $or: ranges.map((r) => ({ from: r.split('|')[0], to: r.split('|')[1] })),
      },
    },
    { $sort: { savedAt: -1, _id: -1 } },
    {
      $group: {
        _id: { from: '$from', to: '$to' },
        count: { $sum: 1 },
        newest: { $first: '$_id' },
      },
    },
  ]);
  const g = new Map(groups.map((x) => [`${x._id.from}|${x._id.to}`, x]));
  const minFrom = docs.reduce((m, d) => (d.from < m ? d.from : m), docs[0]!.from);
  const maxTo = docs.reduce((m, d) => (d.to > m ? d.to : m), docs[0]!.to);
  const changed = await TimesheetDayModel.find({
    userId,
    date: { $gte: parseDateOnly(minFrom), $lte: parseDateOnly(maxTo) },
    changedAt: { $ne: null },
  })
    .select('date changedAt')
    .lean();
  return docs.map((d) => {
    const grp = g.get(`${d.from}|${d.to}`);
    const tag: SavedTag =
      grp && grp.count > 1 ? (grp.newest.equals(d._id) ? 'LATEST' : 'EARLIER') : null;
    const changedDates = changed
      .filter((c) => {
        const k = toDateOnly(c.date);
        return k >= d.from && k <= d.to && c.changedAt! > d.savedAt;
      })
      .map((c) => toDateOnly(c.date))
      .sort();
    return {
      id: d._id.toString(),
      savedAt: d.savedAt.toISOString(),
      from: d.from,
      to: d.to,
      totalActivities: d.totalActivities,
      totalMinutes: d.totalMinutes,
      totalRendered: formatHHMM(d.totalMinutes),
      tag,
      changedDates,
    };
  });
}

export async function toSavedDto(userId: Id, doc: SavedDoc): Promise<SavedReportDto> {
  const [summary] = await toSavedDtos(userId, [doc]);
  return { ...summary!, report: doc.report as DarReportDto };
}
