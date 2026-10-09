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
  /** Database name, e.g. the production one or `pm-staging` (NFR-26). Required in production. */
  MONGODB_DB_NAME: z.string().trim().optional(),
  /** Public URL of the web app, used to build invite links. Required in production (NFR-26). */
  WEB_APP_URL: z.string().url().optional(),
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
  /**
   * File storage for documents and evidence (doc 10, doc 12 §3.2): private Azure Blob container.
   * Set AZURE_STORAGE_ACCOUNT to use the App Service's managed identity (user delegation SAS), or
   * AZURE_STORAGE_CONNECTION_STRING to sign links with the account key. With neither, an in-memory
   * store is used in development and tests, and uploads are disabled in production.
   */
  AZURE_STORAGE_ACCOUNT: z.string().trim().optional(),
  AZURE_STORAGE_CONNECTION_STRING: z.string().trim().optional(),
  /** Blob container for this environment (NFR-26: staging uses its own). Required in production. */
  AZURE_STORAGE_CONTAINER: z.string().trim().optional(),
  /** Lifetime of the write-only upload link given to the browser. */
  UPLOAD_LINK_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

type ParsedEnv = z.infer<typeof EnvSchema>;
export type AppConfig = Omit<ParsedEnv, 'WEB_APP_URL' | 'AZURE_STORAGE_CONTAINER'> & {
  WEB_APP_URL: string;
  AZURE_STORAGE_CONTAINER: string;
};

/**
 * NFR-26: production and staging differ only by their settings. Nothing that picks the
 * environment's data (database, blob container, web URL for links) has a production default; a
 * production process missing one refuses to start. Local development and tests get local defaults.
 */
export const ENVIRONMENT_SETTINGS = [
  'MONGODB_DB_NAME',
  'AZURE_STORAGE_CONTAINER',
  'WEB_APP_URL',
] as const;
const LOCAL_DEFAULTS = {
  WEB_APP_URL: 'http://localhost:5173',
  AZURE_STORAGE_CONTAINER: 'project-documents',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env0 = parsed.data;
  if (env0.NODE_ENV === 'production') {
    const missing = ENVIRONMENT_SETTINGS.filter((k) => !env0[k]);
    if (missing.length) {
      throw new Error(
        `Invalid environment configuration: ${missing.join(', ')} must be set in production (NFR-26)`,
      );
    }
  }
  const cfg: AppConfig = {
    ...env0,
    WEB_APP_URL: env0.WEB_APP_URL ?? LOCAL_DEFAULTS.WEB_APP_URL,
    AZURE_STORAGE_CONTAINER: env0.AZURE_STORAGE_CONTAINER ?? LOCAL_DEFAULTS.AZURE_STORAGE_CONTAINER,
  };
  if (cfg.COOKIE_SAMESITE === 'none' && !cfg.COOKIE_SECURE) {
    throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  }
  return cfg;
}
