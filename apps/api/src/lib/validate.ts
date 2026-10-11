import type { Request } from 'express';
import type { z } from 'zod';
import { badRequest, notFound } from './errors.js';

export function parseBody<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    throw badRequest('Some fields are invalid.', formatIssues(result.error), 'VALIDATION_ERROR');
  }
  return result.data;
}

export function parseQuery<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) {
    throw badRequest('Invalid query parameters.', formatIssues(result.error), 'VALIDATION_ERROR');
  }
  return result.data;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Returns a valid ObjectId string or throws 404 (avoids leaking whether ids exist). */
export function idParam(req: Request, name = 'id'): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) throw notFound();
  return value;
}

/**
 * One `{ path, message }` per failing field (FR-ACT-28), so the web app can show each error under
 * its field. An unknown key (e.g. a field an older API doesn't have) is named, not left pathless.
 */
export function formatIssues(error: z.ZodError) {
  return error.issues.flatMap((i) => {
    if (i.code === 'unrecognized_keys') {
      const base = i.path.join('.');
      return i.keys.map((k) => ({
        path: base ? `${base}.${k}` : k,
        message: `${k} isn't a field this server accepts.`,
      }));
    }
    return [{ path: i.path.join('.'), message: i.message }];
  });
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
