import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

/** NFR-26: the environment's data (database, blob container, web URL) comes only from settings. */
const base = { MONGODB_URI: 'mongodb://localhost:27017' };
const prod = {
  ...base,
  NODE_ENV: 'production',
  MONGODB_DB_NAME: 'pm-staging',
  AZURE_STORAGE_CONTAINER: 'project-documents-staging',
  WEB_APP_URL: 'https://staging.example',
} as const;

describe('Environment settings (NFR-26)', () => {
  it('production refuses to start without the database, container and web URL', () => {
    for (const key of ['MONGODB_DB_NAME', 'AZURE_STORAGE_CONTAINER', 'WEB_APP_URL'] as const) {
      const env: Record<string, string> = { ...prod };
      delete env[key];
      expect(() => loadConfig(env), key).toThrow(new RegExp(`${key}.*must be set in production`));
    }
  });

  it('uses exactly what the settings say', () => {
    const cfg = loadConfig({ ...prod });
    expect(cfg.MONGODB_DB_NAME).toBe('pm-staging');
    expect(cfg.AZURE_STORAGE_CONTAINER).toBe('project-documents-staging');
    expect(cfg.WEB_APP_URL).toBe('https://staging.example');
  });

  it('local development keeps local defaults', () => {
    const cfg = loadConfig({ ...base, NODE_ENV: 'development' });
    expect(cfg.WEB_APP_URL).toBe('http://localhost:5173');
    expect(cfg.AZURE_STORAGE_CONTAINER).toBe('project-documents');
  });
});
