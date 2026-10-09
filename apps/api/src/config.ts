import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().optional(),
  /** Public URL of the web app, used to build invite links. */
  WEB_APP_URL: z.string().url().default('http://localhost:5173'),
  /**
   * Comma-separated list of allowed browser origins. `*` wildcards are allowed inside a
   * host label, e.g. `https://xc8-pm-*.vercel.app` for Vercel preview deployments.
   */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** SameSite for the session cookie: `lax` when web and API share a site, `none` when cross-site. */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: bool(true),
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
  LOCKOUT_THRESHOLD: z.coerce.number().int().min(1).default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  INVITE_TTL_HOURS: z.coerce.number().int().min(1).default(72),
  /**
   * Number of reverse proxies in front of the API that append to X-Forwarded-For.
   * Azure App Service direct = 1; behind the Vercel /api rewrite = 2; local = 0.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.COOKIE_SAMESITE === 'none' && !cfg.COOKIE_SECURE) {
    throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  }
  return cfg;
}
