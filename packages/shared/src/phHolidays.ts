import type { HolidayType } from './projects.js';

/**
 * Official Philippine national holidays (seed data for the Holidays page, FR-CAL-01).
 *
 * 2026: Proclamation No. 1006 (3 Sep 2025), plus Eid'l Fitr (Proclamation No. 1189, 12 Mar 2026)
 *       and Eid'l Adha (Proclamation No. 1264, 21 May 2026).
 * 2027: Proclamation No. 1427 (8 Sep 2026). Eid'l Fitr and Eid'l Adha follow the Islamic calendar
 *       and are proclaimed separately closer to the date, so they aren't listed yet; add them on the
 *       Holidays page once proclaimed.
 *
 * Types follow the proclamations: Regular holidays, Special (non-working) days (including the
 * "additional" ones), and the EDSA anniversary as a Special (working) day.
 */
export interface OfficialHoliday {
  date: string;
  name: string;
  type: HolidayType;
  note: string;
}

const R: HolidayType = 'REGULAR';
const S: HolidayType = 'SPECIAL_NON_WORKING';
const W: HolidayType = 'SPECIAL_WORKING';

const P2026 = 'Proclamation No. 1006, s. 2025';
const P2027 = 'Proclamation No. 1427, s. 2026';

export const PH_OFFICIAL_HOLIDAYS: Record<number, OfficialHoliday[]> = {
  2026: [
    { date: '2026-01-01', name: "New Year's Day", type: R, note: P2026 },
    { date: '2026-02-17', name: 'Chinese New Year', type: S, note: `${P2026} (additional)` },
    {
      date: '2026-02-25',
      name: 'EDSA People Power Revolution Anniversary',
      type: W,
      note: P2026,
    },
    { date: '2026-03-20', name: "Eid'l Fitr", type: R, note: 'Proclamation No. 1189, s. 2026' },
    { date: '2026-04-02', name: 'Maundy Thursday', type: R, note: P2026 },
    { date: '2026-04-03', name: 'Good Friday', type: R, note: P2026 },
    { date: '2026-04-04', name: 'Black Saturday', type: S, note: `${P2026} (additional)` },
    { date: '2026-04-09', name: 'Araw ng Kagitingan', type: R, note: P2026 },
    { date: '2026-05-01', name: 'Labor Day', type: R, note: P2026 },
    { date: '2026-05-27', name: "Eid'l Adha", type: R, note: 'Proclamation No. 1264, s. 2026' },
    { date: '2026-06-12', name: 'Independence Day', type: R, note: P2026 },
    { date: '2026-08-21', name: 'Ninoy Aquino Day', type: S, note: P2026 },
    { date: '2026-08-31', name: 'National Heroes Day', type: R, note: P2026 },
    { date: '2026-11-01', name: "All Saints' Day", type: S, note: P2026 },
    { date: '2026-11-02', name: "All Souls' Day", type: S, note: `${P2026} (additional)` },
    { date: '2026-11-30', name: 'Bonifacio Day', type: R, note: P2026 },
    {
      date: '2026-12-08',
      name: 'Feast of the Immaculate Conception of Mary',
      type: S,
      note: P2026,
    },
    { date: '2026-12-24', name: 'Christmas Eve', type: S, note: `${P2026} (additional)` },
    { date: '2026-12-25', name: 'Christmas Day', type: R, note: P2026 },
    { date: '2026-12-30', name: 'Rizal Day', type: R, note: P2026 },
    { date: '2026-12-31', name: 'Last Day of the Year', type: S, note: P2026 },
  ],
  2027: [
    { date: '2027-01-01', name: "New Year's Day", type: R, note: P2027 },
    { date: '2027-02-06', name: 'Chinese New Year', type: S, note: `${P2027} (additional)` },
    {
      date: '2027-02-25',
      name: 'EDSA People Power Revolution Anniversary',
      type: W,
      note: P2027,
    },
    { date: '2027-03-25', name: 'Maundy Thursday', type: R, note: P2027 },
    { date: '2027-03-26', name: 'Good Friday', type: R, note: P2027 },
    { date: '2027-03-27', name: 'Black Saturday', type: S, note: `${P2027} (additional)` },
    { date: '2027-04-09', name: 'Araw ng Kagitingan', type: R, note: P2027 },
    { date: '2027-05-01', name: 'Labor Day', type: R, note: P2027 },
    { date: '2027-06-12', name: 'Independence Day', type: R, note: P2027 },
    { date: '2027-08-21', name: 'Ninoy Aquino Day', type: S, note: P2027 },
    { date: '2027-08-30', name: 'National Heroes Day', type: R, note: P2027 },
    { date: '2027-11-01', name: "All Saints' Day", type: S, note: P2027 },
    { date: '2027-11-02', name: "All Souls' Day", type: S, note: `${P2027} (additional)` },
    { date: '2027-11-30', name: 'Bonifacio Day', type: R, note: P2027 },
    {
      date: '2027-12-08',
      name: 'Feast of the Immaculate Conception of Mary',
      type: S,
      note: P2027,
    },
    { date: '2027-12-24', name: 'Christmas Eve', type: S, note: `${P2027} (additional)` },
    { date: '2027-12-25', name: 'Christmas Day', type: R, note: P2027 },
    { date: '2027-12-30', name: 'Rizal Day', type: R, note: P2027 },
    { date: '2027-12-31', name: 'Last Day of the Year', type: S, note: P2027 },
  ],
};

export const OFFICIAL_HOLIDAY_YEARS = Object.keys(PH_OFFICIAL_HOLIDAYS).map(Number);
