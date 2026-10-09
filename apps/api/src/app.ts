import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { AppConfig } from './config.js';
import { dbState } from './db.js';
import { HttpError } from './lib/errors.js';
import { createLogger, httpLogger } from './logger.js';
import { clientIp } from './middleware/clientIp.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import {
  CSRF_HEADER,
  csrfProtection,
  originMatcher,
  rejectOperatorKeys,
} from './middleware/security.js';
import './models/index.js';
import { authRouter } from './routes/auth.js';
import { clientsRouter, contactsRouter } from './routes/clients.js';
import { teamsRouter } from './routes/teams.js';
import { usersRouter } from './routes/users.js';

export function createApp(config: AppConfig, logger: Logger = createLogger(config.LOG_LEVEL)) {
  const app = express();
  app.disable('x-powered-by');
  // We resolve client IPs ourselves (see clientIp.ts); keep Express from trusting XFF.
  app.set('trust proxy', false);

  const isAllowedOrigin = originMatcher(config.CORS_ORIGINS);

  app.use(httpLogger(logger));
  app.set('etag', false);
  app.use(helmet());
  // API responses carry per-user data; never let browsers or proxies cache them.
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', CSRF_HEADER, 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Per-IP limiter on sign-in and password setup (NFR-05). Its counters live in this process's
  // memory (the default MemoryStore), so the App Service must stay pinned to ONE instance.
  // Tech debt TD-01: move the limiter (and lockout counters) to a shared store such as MongoDB
  // or Redis before scaling out to more than one instance.
  const authLimiter = rateLimit({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    limit: config.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req, config.TRUST_PROXY_HOPS)),
    handler: (_req, _res, next) =>
      next(
        new HttpError(
          429,
          'RATE_LIMITED',
          'Too many attempts. Please wait a few minutes and try again.',
        ),
      ),
  });

  const api = Router();
  api.use(rejectOperatorKeys);
  api.use(csrfProtection(isAllowedOrigin));
  api.get('/health', (_req, res) => {
    const db = dbState();
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db });
  });
  api.use('/auth', authRouter(config, authLimiter));
  api.use('/users', usersRouter(config));
  api.use('/teams', teamsRouter(config));
  api.use('/clients', clientsRouter(config));
  api.use('/contacts', contactsRouter(config));

  app.use('/api/v1', api);
  app.get('/', (_req, res) => res.json({ name: 'xc8-projectmgmt-api', docs: '/api/v1/health' }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
