import type { Types } from 'mongoose';

/** The leave label of a person's day ("On leave", "Half day leave (AM)"), if any (FR-LV-06). */
export type LeaveLabeler = (userId: Types.ObjectId, date: Date) => Promise<string | null>;
let labeler: LeaveLabeler = async () => null;

/** Set by the leave module (M7); the tracker and the DAR read it. */
export function setLeaveLabeler(fn: LeaveLabeler) {
  labeler = fn;
}
export function leaveLabelFor(userId: Types.ObjectId, date: Date) {
  return labeler(userId, date);
}
