# Xceler8 Project Management (Implementation Tracker)

Web app for managing Xceler8 implementation projects: templates, tasks, time, client follow-up and documents.
Requirements, the QA plan and the design (mockup v0.4, theme tokens) are in [`docs/`](docs/).

**Status:** Phase 1, Milestone 1. Covers tooling, authentication, access and job roles, users, teams, clients and client contacts.

## Repository layout

```
apps/
  api/       Node 22 + Express 5 + TypeScript REST API (/api/v1), MongoDB 7 via Mongoose
  web/       React 18 + TypeScript + Vite SPA, UI built on the Sneat (MIT) Bootstrap 5 theme
packages/
  shared/    Roles, permissions, password policy and zod request schemas shared by api and web
docs/        Requirements, QA plan, design (source of truth; not modified by code changes)
```

## Local setup

Prerequisites: **Node.js 22** (`.nvmrc`) and npm 10+. You don't need a MongoDB install. The dev script downloads a MongoDB 7 binary the first time it runs (about 70 MB, cached under `~/.cache/mongodb-binaries`).

```bash
npm ci

# 1. Start a local MongoDB 7 single-node replica set on port 27027 (keep it running)
npm run dev:db

# 2. Configure the API and web app
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
#    Set SEED_ADMIN_PASSWORD and SEED_USER_PASSWORD in apps/api/.env
#    (8+ chars, at least one number and one symbol)

# 3. Load the QA milestone data (idempotent, so it's safe to re-run)
npm run seed

# 4. Run the API (http://localhost:4000) and the web app (http://localhost:5173)
npm run dev:api
npm run dev:web
```

Open http://localhost:5173 and sign in as `admin@xceler8.example` with `SEED_ADMIN_PASSWORD`.

The local data lives in `.data/mongo`. Set `DEV_DB_PATH` to keep it somewhere else, or delete the folder to start fresh.
If you leave the seed passwords empty, the seed creates the users in the _invited_ state and prints one-time setup links.

### Seed data (QA plan §4, Milestone 1 subset)

All other users get `SEED_USER_PASSWORD`. Set `SEED_RESET_PASSWORDS=true` to overwrite the passwords of existing users.

| Email (`@xceler8.example`) | Access role     | Job role        | Notes                                       |
| -------------------------- | --------------- | --------------- | ------------------------------------------- |
| `admin`                    | Admin           | Project Manager | uses `SEED_ADMIN_PASSWORD`                  |
| `pm`, `pm2`                | Project Manager | Project Manager |                                             |
| `member`                   | Member          | Consultant      | shares an email with contact M. Lim (EC-21) |
| `outsider`                 | Member          | Developer       |                                             |
| `viewer`                   | Viewer          | Project Manager |                                             |
| `deactivated`              | Member          | Support         | deactivated; can't sign in                  |

The seed also creates 6 teams and two clients (Acme Trading, Northwind Foods), each with 3 contacts (one inactive).

## Scripts (repo root)

| Script                                | What it does                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev:db`                      | Local MongoDB 7 replica set (mongodb-memory-server, persistent)              |
| `npm run dev:api` / `npm run dev:web` | API with reload (tsx watch) / Vite dev server (proxies `/api` to the API)    |
| `npm run seed`                        | Idempotent seed of teams, users, clients and contacts                        |
| `npm run lint`                        | ESLint (flat config, typescript-eslint, react-hooks)                         |
| `npm run format` / `format:check`     | Prettier                                                                     |
| `npm run typecheck`                   | `tsc --noEmit` for every workspace                                           |
| `npm test`                            | Vitest. The API tests use Supertest against an in-memory MongoDB replica set |
| `npm run build`                       | Builds the API bundle (`apps/api/dist`) and the web app (`apps/web/dist`)    |
| `npm run verify`                      | Everything CI runs                                                           |

## Environment variables

Configuration comes from environment variables only. See `apps/api/.env.example` and `apps/web/.env.example`.

### API (`apps/api`, Azure App Service application settings)

| Variable                                                            | Default                 | Notes                                                                                     |
| ------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                          | `development`           | `production` on Azure                                                                     |
| `PORT`                                                              | `4000`                  | Azure sets this automatically                                                             |
| `MONGODB_URI`                                                       | (required)              | MongoDB Atlas connection string                                                           |
| `MONGODB_DB_NAME`                                                   | `xc8_pm`                |                                                                                           |
| `WEB_APP_URL`                                                       | `http://localhost:5173` | Public web URL, used in invite and reset links                                            |
| `CORS_ORIGINS`                                                      | `WEB_APP_URL`           | Comma-separated. `*` matches within one host label (e.g. `https://xc8-pm-*.vercel.app`)   |
| `COOKIE_SECURE`                                                     | `true` in production    | Must be `true` whenever `COOKIE_SAMESITE=none`                                            |
| `COOKIE_SAMESITE`                                                   | `lax`                   | `lax` behind the Vercel rewrite (default). `none` if the web app calls the API cross-site |
| `SESSION_IDLE_MINUTES` / `SESSION_ABSOLUTE_HOURS`                   | `30` / `12`             | Idle timeout (FR-AUTH-06) and hard cap                                                    |
| `LOCKOUT_THRESHOLD` / `LOCKOUT_MINUTES`                             | `5` / `15`              | Per-account lockout (FR-AUTH-07). Silent: a locked account gets the same generic 401      |
| `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_MINUTES`            | `20` / `15`             | Per-IP limit on sign-in and link verify/setup. In memory: one instance only (TD-01)       |
| `INVITE_TTL_HOURS` / `RESET_TTL_HOURS`                              | `72` / `24`             | Lifetime of single-use invite links and Admin-issued reset links                          |
| `TRUST_PROXY_HOPS`                                                  | `0`                     | `1` when browsers call Azure directly. `2` behind the Vercel rewrite                      |
| `LOG_LEVEL`                                                         | `info`                  | pino level                                                                                |
| `SEED_ADMIN_PASSWORD`, `SEED_USER_PASSWORD`, `SEED_RESET_PASSWORDS` |                         | Seed script only                                                                          |

### Web (`apps/web`, Vercel project environment variables)

| Variable             | Notes                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`  | Leave empty (recommended) to call `/api/v1` on the same origin, proxied to Azure by `vercel.json`. Or set the API origin to call it cross-site |
| `VITE_DEV_API_PROXY` | Local dev only: where Vite proxies `/api` (default `http://localhost:4000`)                                                                    |

Only `VITE_*` variables reach the browser. Never put secrets in them.

## Deployment

### Web on Vercel

- Import the repo and set **Root Directory** to `apps/web`. `apps/web/vercel.json` sets the install command (`npm ci` at the repo root), the build and the output.
- `vercel.json` rewrites `/api/*` to `https://xc8-projectmgmt-api-tc3w.azurewebsites.net/api/*`. The browser only ever talks to the Vercel origin, so the session cookie is first-party. This works in Safari and other browsers that block third-party cookies. The API's `WEB_APP_URL` and `CORS_ORIGINS` should be the Vercel URL(s).
- Cross-site mode is the alternative. Set `VITE_API_BASE_URL` to the Azure URL, and on the API set `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true` and `CORS_ORIGINS` to the Vercel origin(s).

### API on Azure App Service (`xc8-projectmgmt-api-tc3w`)

- Runtime: Linux, Node 22 LTS. Startup command: `npm start` (runs `node dist/server.js`).
- App settings: the API variables above. At minimum set `NODE_ENV=production`, `MONGODB_URI`, `WEB_APP_URL`, `CORS_ORIGINS`, `COOKIE_SECURE=true` and `TRUST_PROXY_HOPS`. Also set `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, because the workflow ships a ready-to-run package.
- Health check path: `/api/v1/health`. It returns `{"status":"ok","db":"up"}` and responds 503 when the database is down.
- Atlas network access must allow the App Service outbound IPs.
- `.github/workflows/deploy-api.yml` deploys on pushes to `main` that touch the API or the shared package, and can also be run manually. It needs the repository secret **`AZURE_WEBAPP_PUBLISH_PROFILE`** (download the publish profile from the Web App's Overview page). If the secret isn't set, the job logs a notice and skips the deploy.
- To build the same package by hand: `npm run build --workspace @xc8/api && node apps/api/scripts/prepare-deploy.mjs`, then run `npm install --omit=dev` inside `apps/api/deploy`.
- To seed a deployed database, run `npm run seed` from the App Service SSH console (`node dist/seed.js`) with the seed variables set.
- **Pin the App Service to ONE instance** (instance count 1, autoscale off). The per-IP sign-in rate limiter (NFR-05) keeps its counters in the API process's memory, so with two or more instances each one counts separately and the limit stops working as intended. **Tech debt TD-01:** move the limiter (and the lockout counters) to a shared store such as MongoDB or Redis before scaling out. Don't scale out until TD-01 is done.

## Security notes

- Invite and reset links are single use. Email is deferred, so an Admin copies the link and shares it by hand: "Create invite link" in Admin › Users, "New invite link" for invited users, and "Copy reset link" for active users. Invite links expire after 72 hours and reset links after 24 hours. Each user holds at most one link, so creating a new link cancels any earlier unused one. Used, expired and replaced links all get the same message: "This link has expired. Ask an Admin for a new one." The sign-in page has no self-service reset; it tells people to ask an Admin.
- Link tokens never travel in a URL path or query string. The link the Admin shares carries the token in the URL fragment (`/setup-password#token=…`), which browsers don't send to any server, and the web app submits it to the API only in a JSON POST body. Both calls need the CSRF header below:
  - `POST /api/v1/auth/invite/verify` with `{ "token": "…" }` checks the link and returns `{ name, email, invitedByName, purpose }` (it doesn't use the link up). This replaces the old `GET /api/v1/auth/invite/:token`.
  - `POST /api/v1/auth/setup-password` with `{ "token": "…", "password": "…" }` sets the password, uses up the link and signs the user in.
  - Unknown, malformed, used, expired and replaced tokens all get the same 400 `INVALID_TOKEN` response.
- Sign-in lockout is silent. After 5 consecutive failures the account is locked for 15 minutes, but a locked account gets the same 401 "Email or password is incorrect." as a wrong password or an unknown email, even when the correct password is entered. A correct sign-in works again once the 15 minutes are up.
- Passwords are hashed with argon2id. Sessions are server-side: the httpOnly cookie holds a random token, and the database stores only its SHA-256.
- Every request reloads the user, so deactivation or a role change takes effect immediately. Deactivating a user also revokes their sessions.
- State-changing requests need the `X-Requested-With: xc8-web` header and an allowed `Origin` (CSRF defence in depth on top of SameSite).
- Client contacts are a separate collection with no credentials. They can never sign in.
- Authorization is enforced in API middleware (`requireAuth` and `requirePermission`). The UI only hides what the API already forbids.

## Licenses

The UI reuses the SCSS of [Sneat Bootstrap 5 HTML Admin Template – Free](https://github.com/themeselection/sneat-bootstrap-html-admin-template-free) v3.0.0 by ThemeSelection, under the MIT license. See `apps/web/src/vendor/sneat/LICENSE`. Its jQuery and vendor JS are not used.
