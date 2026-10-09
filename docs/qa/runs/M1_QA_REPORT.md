# QA Report: Milestone 1 (setup, sign-in, roles, users, teams, clients)

**Build:** PR #1 at `8671d68`, preview https://xc8-projectmgmt-web-git-milestone-1-setup-8966d1-jomerson-team.vercel.app
**Tester:** Queen The QA · **Date:** 2026-10-09 · **Requirements:** v0.3.5 (v0.3.6 pending merge) · **Plan:** QA v0.1.4
**Result: PASS.** No open Critical or High defects. Two Low design items are deferred to the start of Milestone 1.5 by Lean's decision.

## Summary
| Area | Run | Pass | Fail | Notes |
|---|---|---|---|---|
| A Sign-in and sessions | 15 | 15 | 0 | A05, A11 and A15 rely on automated fake-timer tests; I'll check them live in the Nov 3–5 regression |
| B Users and teams | 9 | 9 | 0 | B04 and B06 have nothing to show until tasks exist (M2), so the UI is covered by UIE's review |
| K Security | 7 | 7 | 0 | K01 is limited to users, clients and contacts until projects exist |
| Automated suite | 94 | 94 | 0 | CI green on `8671d68` |

## Live results
- **Pass, API on the preview:** A02, A03 (silent lockout, plus unlock after 15 min), A04, A06 (incl. EC-21), A08, A09 (429 `RATE_LIMITED` with `Retry-After`, forged headers ignored), A10, A12, A13 (setup and change password), A14 (verify, single use, replacement, 72 h invite, 24 h reset, old GET path returns 404), B01, B02, B03, B05, K02, K03, K04 (no secrets in the bundle), K05 (HSTS, CSP, Helmet, foreign-origin CORS rejected).
- **Pass, UI** (UIE's design review plus my check of the code): A01 lands on My tasks, the 429 message copy is right, B07 and B09 (invite pop-up with separate Access and Job roles), and K07 (React escapes all text, and nothing uses `dangerouslySetInnerHTML`).

## Defects
| ID | Severity | Title | Status |
|---|---|---|---|
| DEF-001 | High | Invite and reset links pointed to a domain with no deployment | Fixed in `8671d68`, re-tested, closed |
| DEF-002 | High | Per-IP sign-in rate limit never triggered (limiter key wasn't the real client IP) | Fixed in `8671d68`, re-tested, closed |
| DR-01–04 | Medium/Low | Users table overflow, page title placement, phone layout, teams comma | Fixed, re-checked by UIE, closed |
| DR-05 | Low | The Admin tab row cuts off "Settings" on phones | Deferred to M1.5 |
| DR-06 | Low | The invite pop-up's × button sits outside the pop-up | Deferred to M1.5 |

## Notes
- ARRAffinity cookies pass through the Vercel rewrite. They're harmless, but ARR affinity can be turned off now that the app is pinned to one instance.
- Test data I created on the preview: users `qa.newuser.*` and `qa.retest.*`, and the client "QA A12 client". admin@ also has one unused reset link from Deven's check.

**Next:** PASS goes to Lean. Merge PR #1, then QA moves to the Milestone 1.5 permission-grid tests.
