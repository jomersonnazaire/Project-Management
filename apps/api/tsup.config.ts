import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    seed: 'scripts/seed.ts',
    // NFR-26: staging bootstrap and the AC-44.1 QA seed (both refuse non-staging databases).
    'bootstrap-staging': 'scripts/bootstrap-staging.ts',
    'seed-qa-completed': 'scripts/seed-qa-completed.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // `dependencies` stay external (installed on the server); the workspace
  // package @xc8/shared is a devDependency, so it is bundled in.
  noExternal: ['@xc8/shared'],
});
