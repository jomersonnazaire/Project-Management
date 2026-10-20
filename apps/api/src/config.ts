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
  /**
   * Mobile app sessions (POST /auth/mobile/login, bearer token): sliding idle window that
   * every request and POST /auth/mobile/refresh extend. Mobile exception to FR-AUTH-03.
   */
  MOBILE_SESSION_IDLE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(72),
  /** Optional hard cap for mobile sessions in days; 0 (default) = no cap. */
  MOBILE_SESSION_MAX_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
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
  AZURE_STORAGE_CONTAINER: z.string().trim().default('project-documents'),
  /** Lifetime of the write-only upload link given to the browser. */
  UPLOAD_LINK_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Microsoft 365 sign-in (web). All must be set with non-empty allowlists or sign-in stays disabled. */
  MS_TENANT_ID: z.string().optional().default(''),
  MS_CLIENT_ID: z.string().optional().default(''),
  MS_CLIENT_SECRET: z.string().optional().default(''),
  MS_REDIRECT_URI: z.string().optional().default(''),
  MS_ALLOWED_TENANT_IDS: z.string().optional().default(''),
  MS_ALLOWED_DOMAINS: z.string().optional().default(''),
});

type EnvConfig = z.infer<typeof EnvSchema>;

export type AppConfig = EnvConfig & {
  msEnabled: boolean;
  msAllowedTenantIds: string[];
  msAllowedDomains: string[];
};

function parseCsvList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

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
  const msAllowedTenantIds = parseCsvList(cfg.MS_ALLOWED_TENANT_IDS).map((t) => t.toLowerCase());
  const msAllowedDomains = parseCsvList(cfg.MS_ALLOWED_DOMAINS).map((d) => d.toLowerCase());
  const msCore =
    cfg.MS_TENANT_ID.trim() &&
    cfg.MS_CLIENT_ID.trim() &&
    cfg.MS_CLIENT_SECRET.trim() &&
    cfg.MS_REDIRECT_URI.trim();
  const msEdgeSecretOk = (cfg.EDGE_PROXY_SECRET?.trim().length ?? 0) >= 32;
  const msEnabled = Boolean(
    msCore && msAllowedTenantIds.length > 0 && msAllowedDomains.length > 0 && msEdgeSecretOk,
  );
  return { ...cfg, msEnabled, msAllowedTenantIds, msAllowedDomains };
}

/** HMAC key for short-lived OAuth state cookies (same shared secret as the Vercel edge proxy). */
export function oauthStateCookieSecret(config: AppConfig): string {
  const secret = config.EDGE_PROXY_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      'EDGE_PROXY_SECRET must be set (32+ chars) for Microsoft sign-in state cookies',
    );
  }
  return secret;
}
