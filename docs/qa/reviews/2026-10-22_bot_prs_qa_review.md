# QA review: JonathanBot merges 68263fe..1f6492e (Oct 16–22) + open PR #41
Reviewed 2026-10-22, 3:40–4:10 PM SGT. Read-only: a detached worktree at /workspace/pm-review (1f6492e). Nothing committed, pushed or deployed. The deep security review moved to Deven partway through (parent's change of scope), so the notes below are what I found before that, plus the defects. Test cases are in `send_flows_test_cases.md` (TC-U01 to U66).

## Verdicts (light review, not a full security sign-off)
| PR | Verdict |
|---|---|
| #27 MS sign-in web (c0e4301) | PASS with notes (D2 decision, D3) |
| #29 DAR Send via M365 (cb3b48b) | PASS with notes (D4, D5, D6, D11) |
| #28 MS sign-in mobile (b66b2e5) | PASS with notes (D9) |
| #32 MSAL nonce fix (bf70967) | PASS |
| #34 action emails (d2a07a7) | PASS with notes (D6, D7) |
| #21 mobile-sync-m8 (bf37ab1) | Not reviewed in depth (Flutter; UIE owns screens) |
| #35 DAR sent status (434dca0) | PASS (Sent time in PH time, audit fallback) |
| #37 / #36 mobile return path (3bb2c73, 1f6492e) | PASS (single-use 60 s code, PKCE bound to the user, fixed return address, tests cover it) |
| PR #41 (open, 996d0a5) | Not merged. Merges cleanly into main (`git merge-tree`). D10 noted. Flutter tests not run here |

## Defects
1. **D1 High: DEF-017 still open on main.** `apps/api/src/routes/tasks.ts:230` uses `const today = clockNow()` (an instant) and compares it with date-only due dates (`isOverdue`, `packages/shared/src/projects.ts:349`), so from 08:00 PHT a task due today shows as overdue. **Fix:** `todayPH(clockNow())`, as PR #26 does. PR #26 is **open, not merged**, and GitHub shows conflicts ("dirty"), so it needs a rebase. Its `leave.ts` part already landed on main through #21.
2. **D2 Medium (needs a decision): Microsoft sign-in creates new users.** `apps/api/src/services/microsoftSignIn.ts:79-102` creates an unknown allowed-tenant, allowed-domain account as a **Viewer** with no job role. Doc 14 FR-SSO-04 and Q-37 (v1.2.26) were changed to say this, "approved by Jonathan", replacing Jomerson's original rule ("Refuse; Admins invite first"). If the rule really is "never auto-create", this is a defect. Jomerson needs to confirm. **Fix if refused:** return `refuse('not_invited')` instead of create.
3. **D3 Medium: an already-linked user can be relinked to a different Microsoft account.** `microsoftSignIn.ts:53-61`: when an email matches, the code overwrites `msOid`/`msTid` even if the user is already linked to a different `oid`. `xms_edov` is read but never checked. The risk is limited because only member accounts (`acct`=0) from the allowed tenants get in. **Fix:** refuse and audit when `existing.msOid && existing.msOid !== claims.oid`.
4. **D4 Medium: a Graph timeout can cause a duplicate send.** `apps/api/src/services/graphMail.ts:91-99, 125-136` uses `AbortSignal.timeout(20s)`. If the timeout hits after Graph has accepted the mail, the code reports `graph_unavailable` (failed), doesn't record Sent, and the user is prompted to retry, so the email goes out twice. **Fix:** treat a timeout as "result unknown, check Sent Items" and don't suggest a retry.
5. **D5 Low: no warning before re-sending a DAR.** `apps/web/src/pages/dar/DarPage.tsx:504-512`: the confirm dialog doesn't say the report was already sent. On mobile, two quick starts create two valid server-side states. **Fix:** say "Already sent on {date} – send again?" and/or add a per-report in-flight lock on the server.
6. **D6 Low: Mail.Send scope isn't strictly minimal.** MSAL adds `offline_access` (plus `openid profile`) by default, so a refresh token is issued (it's thrown away with the per-request client). The comment at `apps/api/src/services/actionEmail.ts:34` says "no offline_access, no refresh tokens", which is wrong. **Fix:** correct the comment and docs, or drop `offline_access` if MSAL allows.
7. **D7 Low: a second web action email breaks the first.** There's only one `xc8_ms_act` cookie, so starting a second email in another tab makes the first callback fall through to `/login?error=ms_signin_failed` (`apps/api/src/routes/auth.ts` callback tail). The user sees a sign-in error while they're signed in. **Fix:** send them back to the project with `email_error=expired`.
8. **D8 Low (pre-existing pattern):** Microsoft sign-in success and refusal aren't audited, only logged. The first link and create are audited (`sso_linked` / `sso_user_created`). Password sign-in doesn't audit success either.
9. **D9 Low: the custom `opstrack://` scheme can be claimed by another app.** PKCE protects the code from interception, but a malicious app on the same phone could start its own flow and receive the sign-in. **Fix (later):** Android App Links / iOS Universal Links (https) for the return.
10. **D10 Low (PR #41): the fallback check depends on the phone's clock.** `mobile/lib/ui/v2/dar_send_ui.dart:110` compares the server's `sentAt` with the phone's clock minus 1 minute. If the phone clock is off by more than a minute, the result shown can be wrong. **Fix:** use the server's time from the start response.
11. **D11 Low (decision): DAR CC can go to outside addresses.** `reportCc` (set by Admins, up to 5) accepts any email domain, so a DAR can be CC'd outside `MS_ALLOWED_DOMAINS`. Confirm this is intended.

No secrets found in the diff: grep for keys, client secrets, connection strings and tokens. `.env.example` has empty `MS_CLIENT_SECRET=`.
Regressions checked: Viewer has no `/dar/*` access (activities all off, so Send, send-status and notify are 403; route policy table tests cover it). Another user's saved report gets 404. PH time for Sent status (`formatTime12` +8). Day lock untouched.

## Tests and CI
- Local (worktree 1f6492e, `npm ci`, Node 22, mongodb-memory-server): API **543/543 passed** (49 files), shared **77/77**, web **313/313**; `typecheck`, `lint` and `prettier --check` all clean.
- GitHub Actions on 1f6492e (read through the cursor-github MCP): "Lint, typecheck, test, build" **success** (finished 10:32 AM SGT Oct 22); "deploy" (production) **success** (10:32 AM SGT).
- PR #41 head 996d0a5: CI success, Vercel preview check success. **CI doesn't run Flutter**, and Flutter isn't installed on this box, so the mobile tests (278 claimed in the PR) weren't checked.
- New routes are in the route policy table test (`apps/api/test/routes.test.ts:78-89, 210-213, 280-281`). PKCE TTLs (59/61 s), single use, wrong-verifier burn, nonce, replay and state tampering all have tests.

## Not verified
Real Microsoft and Graph behaviour: consent screens, Sent Items, admin consent, timeouts. Phone round trips and deep links. Flutter tests. Live deployment config (EDGE_PROXY_SECRET length, redirect URI registered in Entra).
