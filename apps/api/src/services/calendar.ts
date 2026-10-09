import { DEFAULT_WORKING_DAYS, toDateOnly, type HolidayType, type WorkCalendar } from '@xc8/shared';
import { HolidayModel, SettingModel } from '../models/index.js';

export const CALENDAR_KEY = 'calendar';

/** Working days (FR-CAL-05): stored setting, Mon–Fri by default. */
export async function workingDaysSetting() {
  const s = await SettingModel.findOne({ key: CALENDAR_KEY }).lean();
  const days = s?.workingDays?.length ? [...s.workingDays] : [...DEFAULT_WORKING_DAYS];
  return { days: days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)), version: s?.version ?? 0 };
}

/**
 * The calendar used for every newly calculated date (FR-CAL-02/03). Existing due dates are never
 * recalculated when it changes.
 */
export async function loadCalendar(): Promise<WorkCalendar> {
  const [{ days }, holidays] = await Promise.all([
    workingDaysSetting(),
    HolidayModel.find().select('date type').lean(),
  ]);
  return {
    workingDays: days,
    holidays: Object.fromEntries(holidays.map((h) => [toDateOnly(h.date), h.type as HolidayType])),
  };
}
