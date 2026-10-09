// Builds a self-contained deploy folder for Azure App Service:
//   deploy/dist/*        bundled server (tsup output; @xc8/shared is inlined)
//   deploy/package.json  runtime dependencies pinned to the versions in package-lock.json
// Then run `npm install --omit=dev` inside deploy/ on Linux so native modules (argon2) match.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = resolve(apiDir, '../..');
const out = resolve(process.argv[2] ?? join(apiDir, 'deploy'));

if (!existsSync(join(apiDir, 'dist/server.js'))) {
  console.error('dist/server.js not found. Run `npm run build --workspace @xc8/api` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(apiDir, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(rootDir, 'package-lock.json'), 'utf8'));
const pinned = {};
for (const name of Object.keys(pkg.dependencies ?? {})) {
  const entry =
    lock.packages[`apps/api/node_modules/${name}`] ?? lock.packages[`node_modules/${name}`];
  if (!entry?.version) throw new Error(`No locked version for ${name}`);
  pinned[name] = entry.version;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(apiDir, 'dist'), join(out, 'dist'), { recursive: true });
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: 'module',
      engines: pkg.engines,
      main: 'dist/server.js',
      scripts: { start: 'node dist/server.js', seed: 'node dist/seed.js' },
      dependencies: pinned,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Deploy folder ready at ${out}`);
