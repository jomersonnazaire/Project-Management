# Fix Queen's review of PR #27 (Microsoft 365 sign-in, web)

Branch: `JonathanBot/feature/ms365-login`. Do not open or merge a PR. Commit and push only.
Keep changes small. Don't touch anything outside these items.

## 1. Audit events (blocker)
- In `apps/api/src/services/microsoftSignIn.ts`, call the repo's existing `audit()` helper (find it with a search for how `routes/auth.ts` / `routes/users.ts` log events; use the same signature).
- Log `sso_user_created` when a new user is created, and `sso_linked` when an existing account is linked (msOid/msTid set).
- Include userId, msTid, and email. Never log tokens or claims beyond that.
- Add tests to `apps/api/test/auth.microsoft.test.ts`: one entry for create, one for link, none for a plain repeat sign-in by msOid+msTid.

## 2. Email source and link rule
- Take the email from the `email` claim only. Do not use `preferred_username`. If `email` is missing or empty, refuse with reason `no_email`, and show the web login page a clear message: "Your Microsoft account has no email address. Ask an admin to check your account." Add a test for a token with no `email` claim (refused, no user created, no link).
- Agreed rule (Lean): link an existing account only when the email domain is in `MS_ALLOWED_DOMAINS`. Simplify `canLinkByEmail` to just the domain check (remove the dead `xms_edov` branch).
- Rename test 4 to match that rule, and add a test that `preferred_username` alone is refused.

## 3. Mount only the Microsoft routes under /api
- Remove `app.use('/api', api)` in `apps/api/src/app.ts`.
- Mount only `/api/auth/microsoft/login` and `/api/auth/microsoft/callback` (same handlers, same middleware).
- Add a test: `GET /api/users` returns 404, and `/api/auth/microsoft/login` still works.

## 4. Remove committed local files
`git rm .cursor/commands/ms365-login.md .cursor/commands/MS365_LOGIN_SETUP.md ms365-test-output.txt`
Add `ms365-test-output.txt` to `.gitignore`.

## 5. Small cleanups
- `package-lock.json`: restore it from `main` (`git checkout main -- package-lock.json`), then `npm install @azure/msal-node@^6.0.1 -w apps/api` so the only change is msal-node.
- `packages/shared/src/projects.ts`: type `PersonDto.jobRole` as `JobRole | null`, and make sure the project people lists show it through `jobRoleLabel` ("Not set"). Add one test with a Viewer that has no job role on a project.
- Sign the Microsoft state cookie (`services/microsoftOAuthCookie.ts`) with the API's existing session/cookie secret from `config.ts` (the one cookie-parser or sessions already use), not `MS_CLIENT_SECRET`. Do not add a new setting. If no such secret exists in config, stop and report that instead of inventing one.

## Verify, then push
Run from the repo root and paste the results into `ms365-test-output.txt` (not committed):
- `npm run lint`, `npm run typecheck`, `npm run build`
- `npx vitest run --pool=forks --maxWorkers=2` in `apps/api` and `apps/web`
- `flutter test` in `mobile/` (if Flutter is installed; otherwise write "not run")
Commit: `fix(auth): audit events, email claim, scoped /api mount, cleanup`, then `git push`.
