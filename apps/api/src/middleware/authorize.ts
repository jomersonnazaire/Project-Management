import type { NextFunction, Request, Response } from 'express';
import type { SystemRole } from '@xc8/shared';
import type { RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { forbidden, notFound } from '../lib/errors.js';
import { permissionsFor } from '../services/accessRules.js';
import { recordScope } from '../access/recordScope.js';
import { authenticate } from './auth.js';

/**
 * The one permission check every API request goes through (doc 11 §8, FR-ACL-08):
 * route lookup → authentication → record scope (NFR-25) → access rules → route handler.
 * Routes declared with `perm(…, { beforeScope: true })` check the access rules before the record
 * scope, so a role without the action gets 403 whether or not the record exists (DEF-018).
 * A record outside the caller's scope answers 404 before the rules are consulted, so an outsider
 * never learns it exists (403 only for records the caller can see but lacks the action for).
 * Unknown routes are denied by default: they answer 404 without reaching any handler.
 * Rules are read fresh on every request, so changes apply on the next request (FR-ACL-06).
 */
export function authorize(config: AppConfig, registry: RouteRegistry) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const route = registry.match(req.method, req.path);
    if (!route) return next(notFound());
    if (route.policy.kind === 'public') return next();

    await authenticate(config, req, res);
    const role = req.auth!.user.systemRole as SystemRole;
    const permissions = await permissionsFor(role);
    req.access = { role, permissions };

    const policy = route.policy;
    const denied = policy.kind === 'permission' && !permissions[policy.record]?.[policy.action];
    const deny = () => {
      if (policy.kind === 'permission') {
        const { record, action } = policy;
        req.log?.info({ access: { role, record, action } }, 'access denied');
      }
      return next(forbidden());
    };
    // The role lacks the action outright: 403 before the record is looked up (DEF-018).
    if (denied && policy.kind === 'permission' && policy.beforeScope) return deny();

    if ((await recordScope(route.path, req.path, req.auth!.user)) === 'hidden') {
      req.log?.info({ access: { role, path: route.path } }, 'record outside scope');
      return next(notFound());
    }

    if (denied) return deny();
    next();
  };
}
