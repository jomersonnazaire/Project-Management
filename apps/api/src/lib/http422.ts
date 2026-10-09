import { HttpError } from './errors.js';

/** 422: the request is well-formed but breaks a business rule. */
export const unprocessable = (message: string, code = 'UNPROCESSABLE', details?: unknown) =>
  new HttpError(422, code, message, details);

/** 409 with details (e.g. the predecessors that block a move, or the newer template version). */
export const conflictWith = (message: string, code: string, details?: unknown) =>
  new HttpError(409, code, message, details);
