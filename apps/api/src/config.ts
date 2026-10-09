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
  /** Lifetime of first-time invite links (FR-AUTH-04). */
  INVITE_TTL_HOURS: z.coerce.number().int().min(1).default(72),
  /** Lifetime of password reset links (FR-AUTH-05). */
  RESET_TTL_HOURS: z.coerce.number().int().min(1).default(24),
  /**
   * Number of trusted reverse proxies that APPEND to X-Forwarded-For on the direct path.
   * Azure App Service = 1 (its front end appends `client:port`); local = 0. Traffic through
   * the Vercel /api proxy is identified by EDGE_PROXY_SECRET instead (see README, DEF-002).
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Shared secret the Vercel Routing Middleware sends with the visitor IP. When it matches,
   * the API trusts `x-xc8-client-ip`; otherwise it uses the IP Azure's front end appended.
   */
  EDGE_PROXY_SECRET: z
    .string()
    .min(32, 'EDGE_PROXY_SECRET must be at least 32 characters')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** IPv4 addresses in the same /N share one auth rate-limit bucket (IPv6 uses /56). */
  AUTH_RATE_LIMIT_IPV4_PREFIX: z.coerce.number().int().min(8).max(32).default(24),
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
