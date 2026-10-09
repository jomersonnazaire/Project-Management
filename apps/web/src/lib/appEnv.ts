/**
 * Build-time deployment environment (NFR-26). Vite bakes VITE_APP_ENV in at build time; vite.config
 * sets it from VERCEL_ENV on Vercel ("production", "preview") or "development" locally, so a
 * production build can never show staging chrome.
 */
export function appEnv(): string {
  return import.meta.env.VITE_APP_ENV || 'development';
}

export const isProductionBuild = (env: string = appEnv()) => env === 'production';
