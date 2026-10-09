/**
 * Loads only the official Philippine holidays (2026 and 2027, see @xc8/shared phHolidays) into the
 * calendar. Safe on any database: dates that already have a holiday are left untouched, and nothing
 * else is created. Usage: `npm run seed:holidays --workspace @xc8/api` with MONGODB_URI set.
 */
import { OFFICIAL_HOLIDAY_YEARS } from '@xc8/shared';
import { connectDb, disconnectDb } from '../src/db.js';
import { loadOfficialHolidays } from '../src/services/officialHolidays.js';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_URI first.');
  await connectDb(uri, process.env.MONGODB_DB_NAME);
  for (const year of OFFICIAL_HOLIDAY_YEARS) {
    const r = await loadOfficialHolidays(year);
    console.log(`Philippine holidays ${year}: ${r.added} added, ${r.skipped} already there`);
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
