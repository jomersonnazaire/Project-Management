# MS365 sign-in for web (OpsTrack Portal) — draft PR

Repo: jomersonnazaire/Project-Management. Base: `main`.
Create branch `JonathanBot/feature/ms365-login` from latest `main`. Never commit to or merge into `main`.
Keep it simple: subtract before adding, reuse existing helpers (`createSession`, `revokeUserSessions`, `unauthorized`, zod config). Web only — do NOT touch the mobile app or `/mobile/*` routes in this PR.

## Decisions (acceptance criteria — from Lean, confirmed by Jonathan)
0. No guests. Refuse (create nothing, link nothing, log it) unless the ID token's optional claim `acct` is exactly `0` (tenant member). `acct` = 1 (guest) OR missing means refuse. Also refuse if an `idp` claim that is present and differs from `https://sts.windows.net/${tid}/`. Also, create OR link only when the email's domain is in `MS_ALLOWED_DOMAINS` (this applies to auto-create too, not only linking).
1. Single tenant only. Accept a token only if `tid` is in `MS_ALLOWED_TENANT_IDS` (comma list; will hold one ID). Anything else: refuse, create nothing, log the attempt.
2. First-time Microsoft user with no matching account gets a new User: `systemRole: 'VIEWER'`, `jobRole: null`, `active: true`, `mustChangePassword: false`, no `passwordHash`, `authProvider: 'microsoft'`, `msOid`, `msTid`, name and lowercased email from the ID token. Never Admin, never a client contact.
3. Match order: (a) user with `msOid` + `msTid` equal to the token's `oid` + `tid`; (b) else link an existing user by email ONLY when `tid` is allowed AND (`xms_edov === true` OR the email domain is in `MS_ALLOWED_DOMAINS`). Linking sets `msOid`/`msTid`. If email exists but neither check holds: no link, no create, log it, show a generic error. (c) else create (rule 2).
4. Deactivated users (`active: false` / `deactivatedAt`) stay blocked whichever method they use. Client contacts (FR-AUTH-08) can never sign in or be linked via Microsoft.
5. Users who have a password keep it and can use either method. Microsoft-only users skip password checks and the forced password-change screen.
6. Scopes: `openid profile email` only. No `User.Read`, no Graph calls.
7. Callback goes through the API (cookie session), reached via the web origin's `/api` proxy.

## Blockers to fix (Queen's list)
- `apps/api/src/middleware/auth.ts` (~line 48): `if (!user || !user.active || !user.passwordHash)` revokes the session. Change so a user with no `passwordHash` is valid when `msOid` is set. Keep revoking for inactive users and for users with neither a password nor a Microsoft link.
- `apps/api/src/models/User.ts`: `jobRole` is required. Make it `required: false, default: null`, allow null in the enum validation. Model uses `strict: 'throw'`, so add the new fields explicitly: `msOid` (string, default null), `msTid` (string, default null), `authProvider` (enum `'password' | 'microsoft'`, default `'password'`). Add a unique sparse compound index on `{ msOid: 1, msTid: 1 }`.
- `mustChangePassword` defaults to true: set false for Microsoft-created users (explicitly in the create call; do not change the schema default for password users).
- Shared types (`packages/shared`): `UserDto.jobRole` becomes `JobRole | null`; update `jobRoleSchema` and other zod schemas so read paths accept null. Admin user create, invite and edit forms keep requiring a real jobRole when an admin saves, so an admin can assign it later.
- Null-safe `jobRole` everywhere it's read (Users list, filters, reports, exports, supervisor views, the mobile account screen and any mobile code reading jobRole from the API DTO (null-safe display only, no other mobile changes)): render "Not set" for null (guard every `JOB_ROLE_LABELS[...]` lookup). Grep `jobRole` across `apps/` and `packages/` and fix every read.
- `checkCredentials` in `apps/api/src/routes/auth.ts`: a Microsoft-only user (no passwordHash) trying password login keeps returning the existing INVALID_CREDENTIALS (no account-type leak).

## Implementation
- Add dependency `@azure/msal-node` to `apps/api`.
- `apps/api/src/config.ts` zod env, all optional so the API still boots without them. FAIL CLOSED: Microsoft sign-in is disabled (`msEnabled: false`, login/callback routes return the generic error redirect, no user created) unless `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI` a non-empty `MS_ALLOWED_TENANT_IDS` and a non-empty `MS_ALLOWED_DOMAINS` are all set. Neither allowlist ever means "any". Empty list entries and whitespace are ignored; compare lowercased:
  `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI`, `MS_ALLOWED_TENANT_IDS`, `MS_ALLOWED_DOMAINS` (comma list). Never commit values. Add them, empty, to `.env.example`.
- New `apps/api/src/services/microsoftAuth.ts`: `ConfidentialClientApplication` with authority `https://login.microsoftonline.com/${MS_TENANT_ID}`. Functions: `getAuthUrl()` (PKCE, `state`, `nonce`, scopes from rule 6) and `exchangeCode()` returning validated claims (`oid`, `tid`, `email`/`preferred_username`, `name`, `xms_edov`, `acct`, `idp`). Verify nonce and `tid`.
- New routes (in `routes/auth.ts` or a small `routes/authMicrosoft.ts`):
  - `GET /auth/microsoft/login`: store PKCE verifier + state + nonce in a short-lived (10 min) httpOnly signed cookie, SameSite=Lax; redirect to Microsoft.
  - `GET /auth/microsoft/callback`: check state, exchange code, apply rules 1–5, update `lastLoginAt`, reset `failedLogins`, call existing `createSession(...)`, clear the temp cookie, redirect to `WEB_APP_URL`. On any failure redirect to `WEB_APP_URL/login?error=ms_signin_failed` (generic; details go only to server logs). Apply the existing auth rate limiter.
  - Expose `msEnabled` (boolean) on an existing public endpoint or a new `GET /auth/providers` so the web can hide the button when not configured.
- `apps/web/src/pages/LoginPage.tsx`: add a "Sign in with Microsoft" button (plain link to `/api/auth/microsoft/login`) under the existing form, shown only when `msEnabled`. Show a friendly Alert for `?error=ms_signin_failed`. Don't redesign the page.
- `/me` must work for a Microsoft-only user; the change-password screen must not be forced for them.

## Tests (add to the API test suite, mock msal — no network)
1. Wrong `tid`: refused, no user created.
2. New user: created with VIEWER, `jobRole: null`, active, mustChangePassword false, authProvider microsoft; session cookie set.
3. Returning user matched by `msOid`+`msTid` (even if email changed).
4. Existing password user + `xms_edov: true`: linked, password still works afterwards.
5. Existing user, email domain allowed, `xms_edov` absent: linked.
6. Existing user, domain not allowed, `xms_edov` false: no link, no create, error redirect.
7. Deactivated user: blocked via Microsoft.
8. Client contact email: never linked or created.
9. Middleware: Microsoft-only user session survives `authenticate`; user with neither password nor msOid is still revoked.
10. Microsoft-only user on `/auth/login` with any password: INVALID_CREDENTIALS.
11. Bad/missing `state`: rejected.
12. Users list, user details (web and mobile account screen), job-role filters, workload and report endpoints all work with a `jobRole: null` user (no crash, "Not set").
13. Admin sets jobRole on a Microsoft-created user; systemRole and permissions unchanged.
14. Invite flow and admin create still reject a missing jobRole.
15. Viewer created via Microsoft cannot use time logging / activities / leave (existing permission check).

16. Fail closed: with `MS_ALLOWED_TENANT_IDS` empty/missing, `msEnabled` is false and the callback creates no user even with a valid-looking token.
17. Fail closed: with `MS_ALLOWED_DOMAINS` empty/missing, `msEnabled` is false and the callback creates or links no user.
18. Invite flow and existing-user admin edits still require a jobRole; only Microsoft-created users may have null.

19. Guest (B2B) user from another company's tenant, signing in to our tenant (`acct: 1` or foreign `idp`): refused, nothing created or linked.
20a. Token with no `acct` claim: refused, nothing created or linked.
20. Member of our tenant whose email domain is not in `MS_ALLOWED_DOMAINS`: refused, nothing created.

## Setup guide in the repo
Add `docs/setup/MS365_LOGIN_SETUP.md` with the exact contents of the attached `MS365_LOGIN_SETUP.md` (Jonathan will place it in `.cursor/commands/` next to this file; copy it from there). Link it from the root README (one line under setup/docs). This is the ONLY setup guide: do not add `MS365_SIGNIN_SETUP.md` or `MS365_ENTRA_APP_REGISTRATION.md`. The Entra app display name is `OpsTrack`.

## Verify before pushing
Run the repo's install, typecheck, lint, API tests and web build (use the scripts in the root `package.json`; e.g. `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`). All must pass. Paste the summary output into a file `ms365-test-output.txt` (do NOT commit it) so Jonathan can share it with Queen.

## Commit / push
One logical commit (or a few small ones), message prefix `feat(auth): Microsoft 365 sign-in for web`. Push `JonathanBot/feature/ms365-login`. Do not open the PR — Deven opens it as a draft and hands it to Queen.

## PR description notes (for Deven)
State: new users default to `systemRole: VIEWER`, `jobRole: null` (shown as "Not set"), active; admin promotes. List the six env settings. Include a list of EVERY file/place that reads `jobRole` (from the grep) for Queen. Also write that list into `ms365-test-output.txt`. Note sessions of users removed in Entra can live up to 12h (accepted for now).
