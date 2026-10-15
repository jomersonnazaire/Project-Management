import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { HttpError } from '../lib/errors.js';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, 'NOT_FOUND', 'Not found.'));
}

/** Consistent error shape `{ error: { code, message, details? } }` (07 §3). */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again.';
  let details: unknown;

  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof Error && err.name === 'CalendarLimitError') {
    // FR-CAL-05: the bounded date calculation found no working day within its limit.
    status = 422;
    code = 'CALENDAR_LIMIT';
    message = err.message;
  } else if (isBodyParserError(err)) {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body must be valid JSON.';
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Some fields are invalid.';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.StrictModeError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Unknown field.';
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid value.';
  } else if (isDuplicateKey(err)) {
    status = 409;
    code = 'DUPLICATE';
    message = 'This record already exists.';
  } else if (isDatabaseUnavailable(err)) {
    status = 503;
    code = 'DATABASE_UNAVAILABLE';
    message = 'The database is temporarily unavailable. Please try again.';
  }

  if (status >= 500) {
    req.log?.error({ err }, 'Unhandled error');
    // In test mode, log 500 errors with full details to help diagnose CI failures
    if (process.env.NODE_ENV === 'test') {
      const errDetails =
        err instanceof Error
          ? {
              name: err.name,
              message: err.message,
              stack: err.stack,
              cause: (err as { cause?: unknown }).cause,
            }
          : err;
      console.error('[TEST] 500 Error:', JSON.stringify(errDetails, null, 2));
    }
  }
  res.status(status).json({
    error: { code, message, ...(details !== undefined ? { details } : {}) },
    requestId: req.id,
  });
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

function isBodyParserError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    ((err as { type?: string }).type === 'entity.parse.failed' ||
      (err as { type?: string }).type === 'entity.too.large')
  );
}

function isDatabaseUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // MongooseError: Connection operation buffering timed out
  if (err.name === 'MongooseError' && err.message.includes('buffering timed out')) return true;
  // MongoServerError: connection errors
  if (err.name === 'MongoServerError' && err.message.includes('connection')) return true;
  // MongoNetworkError
  if (err.name === 'MongoNetworkError') return true;
  return false;
}
