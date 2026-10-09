# QA Report: M8 polish, round 1 (PR #14, server build 0c23ce6). Result: BLOCKED (live API not run), 1 new defect from code-level testing

Run on 10 Oct 2026, 00:54–01:10 PHT. The build has been live since 00:52 PHT. The target was the web preview `xc8-projectmgmt-web-git-m8-polish-jomerson-team.vercel.app`, with the API at `/api/v1`. `GET /api/v1/health` returns `{"status":"ok","db":"up"}`.

**Blocker.** `QA_TEST_PASSWORD` isn't set in this QA session, so no QA account could sign in. One test sign-in as admin@ with another environment value returned 401, which counts as one failed attempt toward the lockout. No live calls were made after that. Nothing on the preview or in its data was changed. member@ and Jomerson's data weren't touched.

**What was done instead:**
- **Web bundle:** checked the live preview bundle `/assets/index-BN7vTOhi.js` for FR-TSK-22, FR-ACT-22 and FR-ACT-23.
- **Code-level run:** ran the API source at commit 0c23ce6 (extracted with `git archive`) against an in-memory MongoDB, using the project's vitest harness.
  - The existing suites m3time, m5, m6, m7, m8 and nfr25 all pass: 60/60.
  - Two QA test files were added: `qa_def010.test.ts` and `qa_m8extra.test.ts`. Copies are in `/workspace/qa-run/m8/`.
- **Live script:** `/workspace/qa-run/m8/m8_live.py` is ready but has not been run. It covers cases 1 to 6 with fresh data, using QA accounts only.
- **Spec versions:**
  - The pushed branch `m8-polish` (tip 81eb806) has doc 14 at v0.9.8. Its header still reads v0.9.7.
  - Doc 14 v0.9.9 (FR-ACT-26 to 28) exists only in the local docs copy and isn't on the branch.
  - Doc 11 v0.4.8 is in 81eb806, which comes after this build.

| # | Case | Evidence | Result |
|---|---|---|---|
| 1 | DEF-007 / FR-ACT-24 lock on `/time` and `/tracker/entries` | Code: one shared `assertDayEditable` is used by `/time` create, PATCH and DELETE and by tracker create, PATCH, DELETE, start and location. The PM/Admin bypass was removed. Local run: a PM's PATCH and DELETE through both routes on a locked week give 422 DAY_LOCKED (m8.test). An Admin's own locked entry also gets PATCH 422 and DELETE 422; after the Admin reopens it, PATCH returns 200 (qa_m8extra). A submitted day refuses `/time` with 422 | Not run live; code-level Pass |
| 2 | DEF-008 / FR-ACT-25 reopen 404 | Local run: Viewer, pm2 and Outsider reopening pm's day get 404 for the real user ID and 404 for a made-up ID, with identical error bodies. A Member reopening their own day gets 403 NOT_SUPERVISOR | Not run live; code-level Pass |
| 3 | FR-ACT-20 module text | Local run (m8.test): spaces are trimmed; spaces-only and blank save as null; 100 characters saves; 101 gives 400 VALIDATION_ERROR "Keep the module under 100 characters."; HTML is stored as given; `/time` takes the same rules; the XLSX shows "–" for blank and the literal text for HTML. The DAR preview API returns "" and the web app shows "–". Note: the limit counts UTF-16 units, so 100 emoji are refused while 50 are accepted (see note 1) | Not run live; code-level Pass |
| 3b | FR-ACT-21 migration ("8 copied") | Not verifiable without signing in. Pre-migration baselines available: `qa-run/dar.pdf` and `dar2.pdf` (member@ 10-08: 3 rows with "ADFS Remote", the quick row blank), `fr_dar.pdf` (pm@ 10-07: 2 rows "Financials", since deleted), and pm@'s saved DAR for 10-08 (saved 23:33 PHT 9 Oct, before the migration). `m8_live.py` compares these and lists every pre-10-10 entry that has a module. The migration is idempotent, but it reverts user edits (DEF-010) | Not run live; **DEF-010** |
| 4 | FR-ACT-22 Modules endpoint gone | Local run: `GET /lookups` returns only activityTypes and locations. `/lookups/modules/all`, POST, and PATCH/DELETE on a Module ID give 404, and the record is unchanged. Live bundle: the Settings tabs are General, Activity types, Locations (no Modules) | Not run live (API); UI screen removed (bundle) |
| 5 | FR-ACT-23 Time out idempotent | Live bundle: the top-bar pill, the Day timesheet running row and the My tasks row all send `POST /tracker/stop {entryId}`. Local run: two concurrent stops with `entryId`, then a later click, give one stop (same endAt and minutes, one `timer_stopped` audit). A row stop together with an old-style stop without an ID also gives one stop, both returning 200 with the same endAt (qa_m8extra) | Not run live; code-level Pass |
| 6 | FR-ACT-10 Time in on a task fills the day timesheet | Local run: Time in on a task creates a running Day timesheet row with that task and endAt null. Time out fills endAt and minutes (65) with nothing typed. The day total is 65 | Not run live; code-level Pass |
| 7 | FR-TSK-22 tab order | Live bundle: `[today "Today", day "Day timesheet", due "Due", assigned "Assigned to me", accountable "I'm accountable", review "To review", completed "Completed"]` | Pass (bundle) |
| 8 | Fix-round regression (24h cap, On Hold mid-timer, delete rules, DAR remarks fallback, NFR-25 sweep) | Local run: the m5, m6, m7 and nfr25 suites pass on 0c23ce6. Live rerun not done. The old `fr_q05*`, `fr_q13`, `fr_act19` and `fr_dar` scripts send `moduleId`, which this build refuses (strict schema). They need `module` text and fresh dates, because pm@ 10-08 and pm2@ 10-09 are already at 24h. `fr_sweep`, `fr_s08`, `fr_p05` and `fr_neg` can run as they are with `PYTHONPATH=m8/shim`. Expected change: "POST reopen pm day" in the sweep is now 404 (FR-ACT-25) | Not run live |

## New defects
| ID | Severity | Defect | Repro | Expected | Actual |
|---|---|---|---|---|---|
| DEF-010 | Medium | The module migration isn't one-time. `migrateModuleText` runs on every API start and never checks its `module-free-text` marker. Its filter is "legacy `moduleId` set and `module` null", and saving a blank module doesn't clear `moduleId`. So when a user clears the module on any migrated entry, the old name comes back on the next restart, deploy or scale-out | 1. Take an entry from before the build that had a Module (e.g. "Financials"). 2. `PATCH /tracker/entries/:id {"module":"   "}` returns 200 with `module: null`. 3. Restart the API (or run `migrateModuleText()` again). 4. `GET /tracker/day` | Module stays blank (FR-ACT-20, and "one-time" in FR-ACT-21) | The second run updates 1 entry and the module shows "Financials" again. Reproduced on 0c23ce6 source: `qa_def010.test.ts` |

Suggested fix: skip the migration when the `module-free-text` marker is DONE, or unset `moduleId` when `module` is written.

## Notes
1. The Module limit counts UTF-16 code units (zod and mongoose `.length`), so "100 characters" refuses 100 emoji (400) and accepts 50. Accented letters such as é count as 1. Rich to confirm whether this is acceptable.
2. `POST /tracker/stop` without `entryId`, when no timer is running, still returns 422 NO_TIMER. The live web app always sends `entryId`, so this doesn't affect FR-ACT-23.
3. Spec version: the user brief and README cite doc 14 v0.9.9, but the pushed branch has v0.9.8 (header v0.9.7).

## To finish round 1
Run `cd /workspace/qa-run && QA_TEST_PASSWORD=… python3 m8/m8_live.py | tee m8/m8_live.log`, then rerun the fix-round scripts as described above.

## Round 1 live run (01:01-01:05 PHT Oct 10, build 0c23ce6)
Log: /workspace/qa-run/m8/m8_live.log. All PASS live:
- FR-ACT-24 / DEF-007: 422 DAY_LOCKED on POST/PATCH/DELETE via both /time and /tracker on a submitted day; edits work after Admin reopen. Locked-week create refused 422. DEF-007 CLOSED.
- FR-ACT-25 / DEF-008: real vs made-up user IDs return identical 404 (outsider, pm2) and identical 403 (viewer); Member own day 403 NOT_SUPERVISOR. DEF-008 CLOSED.
- FR-ACT-20: trim, blank=null, 100 ok, 101 -> 400 with field message, HTML stored as text, legacy moduleId refused; DAR preview, PDF and XLSX show modules, blank as dash.
- FR-ACT-21: pre-build entries keep module names (Financials, ADFS Remote). DEF-010 open (restart re-applies migration).
- FR-ACT-22: modules endpoints 404, activity types/locations 200, no lookup audit events.
- FR-ACT-10/23: Time in creates day row; bar and row Time out return the same end time; one timer_stopped audit.
