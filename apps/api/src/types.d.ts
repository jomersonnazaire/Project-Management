import type { PermissionGrid, SystemRole } from '@xc8/shared';
import type { UserDoc } from './models/User.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the session middleware for authenticated requests. */
      auth?: { user: UserDoc; sessionId: string };
      /** Set by the central access gate: the caller's role and effective permissions (doc 11). */
      access?: { role: SystemRole; permissions: PermissionGrid };
      /** Request id used in logs and error responses (NFR-18). */
      id: string;
    }
  }
}

export {};
