import { DEFAULT_TIME_LOCK, timeLockBoundary, type TimeLockPolicy } from '@xc8/shared';
import { SettingModel } from '../models/index.js';

/** Q-09: the time lock policy is an Admin setting (Admin › Settings); default Monday 12:00 PM PHT. */
export const TIME_LOCK_KEY = 'timeLock';

export async function loadTimeLock(): Promise<{ policy: TimeLockPolicy; version: number }> {
  const s = await SettingModel.findOne({ key: TIME_LOCK_KEY }).lean();
  const t = s?.timeLock;
  return {
    policy: t ? { enabled: t.enabled, weekday: t.weekday, hour: t.hour } : { ...DEFAULT_TIME_LOCK },
    version: s?.version ?? 0,
  };
}

/** First work date still open under the current policy (FR-TIME-04). */
export async function currentLockBoundary(now = new Date()): Promise<Date> {
  return timeLockBoundary(now, (await loadTimeLock()).policy);
}
