import { normalizeTimeLock, timeLockBoundary, type TimeLockPolicy } from '@xc8/shared';
import { SettingModel } from '../models/index.js';

/** Q-09: the time lock policy is an Admin setting (Admin › Settings); Q-09 day lock: a day locks at 00:00 PHT on the third day. */
export const TIME_LOCK_KEY = 'timeLock';

export async function loadTimeLock(): Promise<{ policy: TimeLockPolicy; version: number }> {
  const s = await SettingModel.findOne({ key: TIME_LOCK_KEY }).lean();
  return {
    // Never saved, or `enabled` null/missing → ON. Legacy weekday/hour are never returned.
    policy: normalizeTimeLock(s?.timeLock),
    version: s?.version ?? 0,
  };
}

/** First work date still open under the current policy (FR-TIME-04). */
export async function currentLockBoundary(now = new Date()): Promise<Date> {
  return timeLockBoundary(now, (await loadTimeLock()).policy);
}
