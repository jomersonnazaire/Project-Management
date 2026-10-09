import { PH_OFFICIAL_HOLIDAYS } from '@xc8/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityLogModel, HolidayModel } from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';

/** Seed data: the official Philippine holidays for 2026 and 2027 (FR-CAL-01). */
useDatabase();
const app = makeApp();
afterEach(() => HolidayModel.deleteMany({}));

describe('Seed data: official Philippine holidays', () => {
  it('2026 and 2027 lists match the proclamations (dates, unique, correct years and types)', () => {
    for (const year of [2026, 2027]) {
      const list = PH_OFFICIAL_HOLIDAYS[year]!;
      const dates = list.map((h) => h.date);
      expect(new Set(dates).size).toBe(dates.length);
      expect(dates.every((d) => d.startsWith(`${year}-`))).toBe(true);
      expect([...dates].sort()).toEqual(dates);
      // National Heroes Day is the last Monday of August.
      const heroes = list.find((h) => h.name === 'National Heroes Day')!;
      const d = new Date(`${heroes.date}T00:00:00Z`);
      expect(d.getUTCDay()).toBe(1);
      expect(new Date(d.getTime() + 7 * 86_400_000).getUTCMonth()).toBe(8);
      expect(list.find((h) => h.name.startsWith('EDSA'))!.type).toBe('SPECIAL_WORKING');
      for (const name of ['Ninoy Aquino Day', "All Saints' Day", 'Christmas Eve', 'Black Saturday'])
        expect(list.find((h) => h.name === name)!.type, name).toBe('SPECIAL_NON_WORKING');
      for (const name of ["New Year's Day", 'Good Friday', 'Rizal Day', 'Bonifacio Day'])
        expect(list.find((h) => h.name === name)!.type, name).toBe('REGULAR');
    }
    expect(PH_OFFICIAL_HOLIDAYS[2026]).toHaveLength(21); // 10 + 4 + 1 + 4 + 2 Eid
    expect(PH_OFFICIAL_HOLIDAYS[2027]).toHaveLength(19); // Eid dates not proclaimed yet
    const h2026 = Object.fromEntries(PH_OFFICIAL_HOLIDAYS[2026]!.map((h) => [h.date, h.name]));
    expect(h2026).toMatchObject({
      '2026-04-02': 'Maundy Thursday',
      '2026-04-03': 'Good Friday',
      '2026-03-20': "Eid'l Fitr",
      '2026-05-27': "Eid'l Adha",
      '2026-08-31': 'National Heroes Day',
    });
  });

  it('Admin loads a year once; existing dates are kept; PMs can’t; unknown years get 422', async () => {
    const w = await world(app);
    const add = await w.admin.agent
      .post('/api/v1/settings/holidays')
      .set(CSRF)
      .send({ date: '2026-12-24', name: 'Company Christmas party', type: 'SPECIAL_NON_WORKING' });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    const load = (year: number, agent = w.admin.agent) =>
      agent.post('/api/v1/settings/holidays/official').set(CSRF).send({ year });
    const first = await load(2026);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({ added: 20, skipped: 1 });
    expect((await load(2026)).body).toEqual({ added: 0, skipped: 21 });
    expect((await load(2027)).body).toEqual({ added: 19, skipped: 0 });
    const cal = (await w.admin.agent.get('/api/v1/settings/calendar?year=2026')).body;
    expect(cal.holidays).toHaveLength(21);
    expect(cal.holidays.find((h: { date: string }) => h.date === '2026-12-24').name).toBe(
      'Company Christmas party',
    );
    expect(cal.holidays.find((h: { date: string }) => h.date === '2026-02-25').type).toBe(
      'SPECIAL_WORKING',
    );
    expect((await load(2026, w.pm.agent)).status).toBe(403);
    const none = await load(2030);
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('NO_OFFICIAL_LIST');
    expect(await ActivityLogModel.exists({ action: 'holidays_loaded' })).toBeTruthy();
  });

  it('loaded holidays feed due-date calculation (Bonifacio Day is skipped)', async () => {
    const w = await world(app);
    await w.admin.agent.post('/api/v1/settings/holidays/official').set(CSRF).send({ year: 2026 });
    const impact = await w.admin.agent.get('/api/v1/settings/holidays/impact?date=2026-11-30');
    expect(impact.status).toBe(200);
    const cal = (await w.admin.agent.get('/api/v1/settings/calendar?year=2026')).body;
    expect(cal.holidays.find((h: { date: string }) => h.date === '2026-11-30')).toMatchObject({
      name: 'Bonifacio Day',
      type: 'REGULAR',
    });
  });
});
