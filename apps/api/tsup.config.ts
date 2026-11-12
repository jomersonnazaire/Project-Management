import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    seed: 'scripts/seed.ts',
    // AC-44.1 QA seed (Completed project with an open issue), run on demand like seed.js.
    'seed-qa-completed': 'scripts/seed-qa-completed.ts',
    // CR-22 FR-TL-24 one-time phase migration, runnable on App Service (no tsx there):
    // `node dist/scripts/migrate-phases.js [--apply]`.
    'scripts/migrate-phases': 'scripts/migrate-phases.ts',
    // CR-23 FR-DLV-04 one-time deliverable migration: `node dist/scripts/migrate-deliverables.js [--apply]`.
    'scripts/migrate-deliverables': 'scripts/migrate-deliverables.ts',
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
