import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import { PUBLIC, RouteRegistry } from './access/registry.js';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { AppConfig } from './config.js';
import { dbState } from './db.js';
import { HttpError } from './lib/errors.js';
import { createLogger, httpLogger } from './logger.js';
import { rateLimitKey, resolveClientIp } from './middleware/clientIp.js';
import { authorize } from './middleware/authorize.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import {
  CSRF_HEADER,
  csrfProtection,
  originMatcher,
  rejectOperatorKeys,
} from './middleware/security.js';
import './models/index.js';
import { accessRulesRouter } from './routes/accessRules.js';
import { auditRouter } from './routes/audit.js';
import { authRouter } from './routes/auth.js';
import { clientsRouter, contactsRouter } from './routes/clients.js';
import { projectsRouter } from './routes/projects.js';
import { tasksRouter } from './routes/tasks.js';
import { teamsRouter } from './routes/teams.js';
import { templatesRouter } from './routes/templates.js';
import { usersRouter } from './routes/users.js';
import { conversationsRouter } from './routes/conversations.js';
import { documentRequestsRouter } from './routes/documentRequests.js';
import { issuesRouter } from './routes/issues.js';
import { reportsRouter } from './routes/reports.js';
import { documentsRouter } from './routes/documents.js';
import { notificationsRouter } from './routes/notifications.js';
import { settingsRouter } from './routes/settings.js';
import { trackerRouter } from './routes/tracker.js';
import { darRouter } from './routes/dar.js';
import { leaveRouter } from './routes/leave.js';
import { timeRouter } from './routes/time.js';
import { createBlobStore, type BlobStore } from './storage/blobStore.js';

export function createApp(
  config: AppConfig,
  logger: Logger = createLogger(config.LOG_LEVEL),
  /** Test hook: mount extra routes (used to prove undeclared routes are denied). */
  extraRoutes?: (registry: RouteRegistry) => Router,
  /** File storage; defaults to Azure Blob from config (or in-memory outside production). */
  blobStore: BlobStore | null = createBlobStore(config),
) {
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
  const ipOpts = { trustedHops: config.TRUST_PROXY_HOPS, edgeSecret: config.EDGE_PROXY_SECRET };
  const authLimiter = rateLimit({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    limit: config.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => {
      const { ip, source } = resolveClientIp(req, ipOpts);
      const key = rateLimitKey(ip, config.AUTH_RATE_LIMIT_IPV4_PREFIX);
      req.log?.debug({ rateLimit: { ip, source, key } }, 'auth limiter key');
      return key;
    },
    handler: (_req, _res, next) =>
      next(
        new HttpError(
          429,
          'RATE_LIMITED',
          `Too many sign-in attempts. Please wait ${config.AUTH_RATE_LIMIT_WINDOW_MINUTES} minutes and try again.`,
        ),
      ),
  });

  // Every route is declared with its access policy; the central gate checks it before any
  // handler runs, and requests matching no declared route are denied (doc 11 §8).
  const registry = new RouteRegistry();
  const health = registry.router();
  health.get('/health', PUBLIC, (_req, res) => {
    const db = dbState();
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db });
  });
  const routers = [
    health.router,
    authRouter(config, registry, authLimiter),
    usersRouter(config, registry),
    teamsRouter(registry),
    clientsRouter(registry),
    contactsRouter(registry),
    templatesRouter(registry),
    ...tasksRouter(registry),
    ...projectsRouter(registry),
    accessRulesRouter(registry),
    auditRouter(registry),
    settingsRouter(registry),
    ...timeRouter(registry),
    ...trackerRouter(registry),
    ...darRouter(registry),
    ...leaveRouter(registry),
    ...documentsRouter(config, registry, blobStore),
    documentRequestsRouter(registry),
    notificationsRouter(registry),
    conversationsRouter(registry),
    ...issuesRouter(registry),
    ...reportsRouter(registry),
    ...(extraRoutes ? [extraRoutes(registry)] : []),
  ];

  const api = Router();
  api.use(rejectOperatorKeys);
  api.use(csrfProtection(isAllowedOrigin));
  api.use(authorize(config, registry));
  for (const router of routers) api.use(router);

  app.use('/api/v1', api);
  app.get('/', (_req, res) => res.json({ name: 'xc8-projectmgmt-api', docs: '/api/v1/health' }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  app.locals.routes = registry.entries;
  app.locals.blobStore = blobStore;
  return app;
}
