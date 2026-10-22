import {
  ACCESS_ACTIONS,
  RECORD_TYPE_KEYS,
  actionApplies,
  type AccessAction,
  type RecordType,
} from '@xc8/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';

/**
 * Every API route declares who may call it (doc 11 §8). The central gate (middleware/authorize.ts)
 * looks the request up here BEFORE any route handler runs:
 *   - `public`        no session needed (sign-in, health, invite links)
 *   - `authenticated` any signed-in user (own profile, own permissions)
 *   - `permission`    signed in AND the role's access rules grant `record.action`
 * A request that matches no declared route is denied (404) and never reaches a handler, so a
 * route added without a declaration is unreachable rather than open.
 */
export type RoutePolicy =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | {
      kind: 'permission';
      record: RecordType;
      action: AccessAction;
      /**
       * Refuse a role without `record.action` with 403 BEFORE the record scope check (and so
       * before any lookup of the addressed record): the answer then depends only on the role,
       * never on whether the id exists (DEF-018: a Viewer gets 403 on DAR Send / Notify even
       * for a made-up id). Callers who hold the permission still get the scope 404 for records
       * they can't see.
       */
      beforeScope?: boolean;
    };

export const PUBLIC: RoutePolicy = { kind: 'public' };
export const AUTHENTICATED: RoutePolicy = { kind: 'authenticated' };

export function perm(
  record: RecordType,
  action: AccessAction,
  opts: { beforeScope?: boolean } = {},
): RoutePolicy {
  if (!RECORD_TYPE_KEYS.includes(record) || !ACCESS_ACTIONS.includes(action)) {
    throw new Error(`Unknown permission ${record}.${action}`);
  }
  if (!actionApplies(record, action)) {
    throw new Error(`${action} doesn't apply to ${record}`);
  }
  return { kind: 'permission', record, action, ...(opts.beforeScope ? { beforeScope: true } : {}) };
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RouteEntry {
  method: HttpMethod;
  path: string;
  policy: RoutePolicy;
  regex: RegExp;
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
type Declare = (path: string, policy: RoutePolicy, ...handlers: Handler[]) => void;

export interface SecuredRouter {
  router: Router;
  get: Declare;
  post: Declare;
  patch: Declare;
  put: Declare;
  delete: Declare;
}

function compile(path: string): RegExp {
  const body = path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  // Express matches case-insensitively and tolerates one trailing slash by default.
  return new RegExp(`^${body}/?$`, 'i');
}

export class RouteRegistry {
  readonly entries: RouteEntry[] = [];

  /** A router (mounted at the API root) whose routes can only be added with their policy. */
  router(base = ''): SecuredRouter {
    const router = Router();
    const declare =
      (method: HttpMethod): Declare =>
      (path, policy, ...handlers) => {
        const full = `${base}${path === '/' ? '' : path}` || '/';
        if (this.entries.some((e) => e.method === method && e.path === full)) {
          throw new Error(`Route declared twice: ${method} ${full}`);
        }
        this.entries.push({ method, path: full, policy, regex: compile(full) });
        const m = method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
        (router[m] as (p: string, ...h: Handler[]) => void)(full, ...handlers);
      };
    return {
      router,
      get: declare('GET'),
      post: declare('POST'),
      patch: declare('PATCH'),
      put: declare('PUT'),
      delete: declare('DELETE'),
    };
  }

  match(method: string, path: string): RouteEntry | undefined {
    const m = method === 'HEAD' ? 'GET' : method;
    return this.entries.find((e) => e.method === m && e.regex.test(path));
  }
}
