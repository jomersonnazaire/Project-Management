import type { NextFunction, Request, Response } from 'express';
import type { SystemRole } from '@xc8/shared';
import type { RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { forbidden, notFound } from '../lib/errors.js';
import { permissionsFor } from '../services/accessRules.js';
import { authenticate } from './auth.js';

/**
 * The one permission check every API request goes through (doc 11 §8, FR-ACL-08):
 * route lookup → authentication → access rules → (route handler applies the fixed scope).
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

    if (route.policy.kind === 'permission') {
      const { record, action } = route.policy;
      if (!permissions[record]?.[action]) {
        req.log?.info({ access: { role, record, action } }, 'access denied');
        return next(forbidden());
      }
    }
    next();
  };
}
