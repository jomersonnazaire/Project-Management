import { PH_OFFICIAL_HOLIDAYS, parseDateOnly } from '@xc8/shared';
import { HolidayModel } from '../models/index.js';

/**
 * Adds the official Philippine holidays for `year` (see @xc8/shared phHolidays) to the calendar.
 * Dates that already have an entry are left alone, so Admin edits are never overwritten and it is
 * safe to run more than once. Like any holiday change, it doesn't move existing due dates (FR-CAL-03).
 */
export async function loadOfficialHolidays(
  year: number,
): Promise<{ added: number; skipped: number }> {
  const list = PH_OFFICIAL_HOLIDAYS[year] ?? [];
  let added = 0;
  let skipped = 0;
  for (const h of list) {
    const date = parseDateOnly(h.date);
    const res = await HolidayModel.updateOne(
      { date },
      { $setOnInsert: { date, year, name: h.name, type: h.type, note: h.note } },
      { upsert: true },
    );
    if (res.upsertedCount) added += 1;
    else skipped += 1;
  }
  return { added, skipped };
}
