import { halfDayTimerWarning, onLeaveTimerMessage, formatShortDate, toDateOnly } from '@xc8/shared';
import type { Types } from 'mongoose';
import { conflictWith, unprocessable } from '../lib/http422.js';

/** A person's leave on one date: a full day (or both halves), or one half. */
export interface LeaveDay {
  full: boolean;
  half: 'AM' | 'PM' | null;
  label: string | null;
}
export type LeaveDayLookup = (userId: Types.ObjectId, date: Date) => Promise<LeaveDay>;
const NONE: LeaveDay = { full: false, half: null, label: null };
let lookup: LeaveDayLookup = async () => NONE;

/** Set by the leave module (M7); the tracker and the DAR read it. */
export function setLeaveDayLookup(fn: LeaveDayLookup) {
  lookup = fn;
}
export function leaveDayFor(userId: Types.ObjectId, date: Date) {
  return lookup(userId, date);
}
/** "On leave", "Half day leave (AM)", … (FR-LV-06, FR-LV-11), or null. */
export async function leaveLabelFor(userId: Types.ObjectId, date: Date) {
  return (await lookup(userId, date)).label;
}
/** Kept for tests that stub only the label. */
export function setLeaveLabeler(
  fn: (userId: Types.ObjectId, date: Date) => Promise<string | null>,
) {
  lookup = async (u, d) => {
    const label = await fn(u, d);
    return label ? { full: true, half: null, label } : NONE;
  };
}

/**
 * Time on a leave day (FR-LV-06, TC-S09): refused on a full day; on a half day a warning the
 * user can confirm (`confirmLeave`).
 */
export async function assertLeaveAllowsTime(
  userId: Types.ObjectId,
  date: Date,
  confirmed: boolean | undefined,
) {
  const day = await lookup(userId, date);
  const label = formatShortDate(toDateOnly(date));
  if (day.full) throw unprocessable(onLeaveTimerMessage(label), 'ON_LEAVE');
  if (day.half && !confirmed)
    throw conflictWith(halfDayTimerWarning(day.half, label), 'HALF_DAY_LEAVE', {
      half: day.half,
    });
}
