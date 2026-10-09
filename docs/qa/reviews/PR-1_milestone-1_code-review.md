# Code review · PR #1 Milestone 1 (sign-in, roles, users, teams, clients)

**Reviewer:** Queen The QA · **Date:** 2026-10-09 · **Commit:** 0e7e5ae · **Scope:** test plan sections A, B, C (contacts), K
**Result:** No blocking defects in the code review. Functional QA is still pending the preview link.

## Test run
I ran `npm ci && npm test` locally. All 68 tests pass (7 shared, 51 API, 10 web), against an in-memory MongoDB replica set.

## Coverage of the QA plan by automated tests
API tests cover TC-A01–A06, A08–A10, A12, A13 (the 7-character case), A14 (expiry, single use, replacement), B01–B03, B05, B09, C01, C02, C07 (auth side), C08, C14, K02, K03, K05–K07.
These still need manual or preview testing: A07, A11, B04, B06–B08, C03 (UI notices), K01 (full IDOR sweep once projects exist), K04 (bundle secret scan on the built app).

## Findings
| # | Severity | Finding | Recommendation |
|---|---|---|---|
| R-1 | Low (decision) | **Account enumeration via lockout.** Unknown emails always return 401, but a real account returns 423 "locked" after 5 failures, so someone can confirm which emails exist. AC-01.3 requires the locked message, so this is a requirements trade-off, not a code bug. | Lean to accept as a known risk, or show the generic message and lock silently. The per-IP rate limit already slows this down. |
| R-2 | Low | **Invite/reset token in a GET URL path** (`GET /auth/invite/:token`). The app's own logger redacts it, but Azure App Service platform HTTP logs and any proxy would record the full path. | Change to `POST /auth/invite/lookup` with the token in the body, the same as `setup-password`. |
| R-3 | Low (ops) | **In-memory rate limiter.** The per-IP limit resets on restart and isn't shared if the App Service scales out. Account lockout is stored in the database, so it isn't affected. | Keep the App Service at 1 instance for Phase 1, or move the limiter to a MongoDB store before scaling out. |
| R-4 | Info | The deviations in the PR (12 h absolute session cap; password needs a number and a symbol) aren't in requirements v0.3.3 yet. | Rich to add them to FR-AUTH-02/03. QA added TC-A13 (updated) and TC-A15. |

## What looks good
- Contact emails behave exactly like unknown emails; login only ever queries `users`.
- Lockout uses an atomic counter, resets on success, and is per account.
- Sessions are re-read on every request, so role changes and deactivation apply immediately.
- Links are single-use (atomic consume), hashed at rest, carry the token in the URL fragment, and a new link replaces the old one.
- Strict schemas reject unknown fields; `$` and dotted keys are rejected globally; CSRF uses a custom header plus an origin allowlist; Helmet is on; logs redact secrets.
