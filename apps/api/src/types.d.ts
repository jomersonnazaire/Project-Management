import type { UserDoc } from './models/User.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the session middleware for authenticated requests. */
      auth?: { user: UserDoc; sessionId: string };
      /** Request id used in logs and error responses (NFR-18). */
      id: string;
    }
  }
}

export {};
