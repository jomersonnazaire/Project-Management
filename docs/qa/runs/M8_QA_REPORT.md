# M8 QA Report (final): OpsTrack m8-polish

## Summary
- **Result: PASS. No open defects.** DEF-010's fix passed at code level, but its live restart retest could not be run (see Known gaps).
- **Date:** 14 Oct 2026 (SGT).
- **Build under test:** live API `8fdb005` and web `fdbeecb`, branch `m8-polish`. Preview: `xc8-projectmgmt-web-git-m8-polish-jomerson-team.vercel.app`.
- **Status:** M8 is complete except for the Q-09 2-day lock build, which is still in progress. This report will be updated after the lock retest and before the merge to main.
- The round history (round 1, round 2, regression and the TC-Q03 rerun) is in the Appendix.

## 1. Defects
| ID | Severity | Defect | Final status | Evidence |
|---|---|---|---|---|
| DEF-010 | Medium | The module migration (`migrateModuleText`) ran again on every API start, so a cleared Module came back after a restart | **Fix passed at code level. The live restart retest was blocked and not run** (a live restart was not possible from QA) | `m8/qa_def010.test.ts`, `m8/def010_check.py`, `m8/def010.json` |
| DEF-011 | High | Viewer got 403 on all Reports routes and exports under the starting grid (permission cache not refreshed after the startup seed) | Closed | Round 2 log `m8/m8r2_live.log`; retest script `regress/def011_014.py` (no saved run log on the box) |
| DEF-012 | Medium | An access rule with Export on and View off was accepted (FR-ACL-14) | Closed | as DEF-011 |
| DEF-013 | Medium | Someone else's saved DAR gave a different response from a made-up ID (existence leak), and Viewer got 403 instead of 404 (NFR-25, FR-ACL-17) | Closed | as DEF-011 |
| DEF-014 | Low | Viewer PATCH/DELETE on another user's tracker entry returned 403 instead of 404 (FR-ACT-27) | Closed | as DEF-011 |
| DEF-015 | — | A PM not on the project could act on PM actions (task delete) instead of getting 404 (FR-PRJ-21). Fixed in `b5f54c2` | Closed | `regress/m8c_live3.log`: "pm2 (PROJECT_MANAGER) not on team DELETE -> 404" PASS |
| DEF-016 | — | Apply template added duplicate phases and activities on reapply, and empty template phases weren't saved. Fixed in `b5f54c2` and `8130425` | Closed: suite **26 pass / 0 fail** | `regress/def016_2.log` (the first run, `def016.log`, was 25/1) |

Closed earlier in M8 (see Appendix): DEF-007, DEF-008 and DEF-009. No severity was recorded for DEF-015 or DEF-016.

## 2. Decisions and retests
| Item | Decision / change | Retest | Result |
|---|---|---|---|
| Q-70 B | Viewers have no time, tracker or DAR access | On `d233083`: AC-56.1, EC-112 and A-25. EC-111 is covered by Deven's automated test, because the qa.viewer account could not sign in | Pass. Note: the saved `regress/q70b.log` (20:13 SGT, 13 Oct) shows 7 pass / 3 fail. The 3 fails are probes of `GET /tracker/entries` and `GET /dar/<date>`. Those paths also returned 404 for pm2, so they are script paths, not defects. That log also predates Q-72 (it checks that the Viewer still has `/leave`). There is no cleaner rerun log on the box |
| Q-71 | Kept: weekly totals include quick activities and leave out leave | `regress/ac551.log`: qa.member with quick activities only shows `loggedTotal 4` and Team & workload `recordedHours 4` | Pass (EC-109). The exact 01:30 example in AC-55.1 and the leave part were not run live |
| Q-72 | Viewers have no leave. Only Admins and the Viewer's direct supervisor see existing Viewer leave | `regress/q72.log` on `8fdb005`: **6 pass / 0 fail**, including "reset keeps leave+activities off". EC-113 is covered by an automated test | Pass. (`reset_check.log` at 20:52 still showed leave on after reset. That run was before `8fdb005`, and `q72.log` at 21:17 supersedes it) |
| Location changes (`109912c`) | `PUT /tracker/days/<date>/location` | `regress/loc109.log`: **5 pass / 0 fail**. It writes an audit record, returns 422 `DAY_LOCKED` on a locked day, and returns 400 on an empty location | Pass |
| AC-52.8 locked-day buttons (`fdbeecb`) | The Day timesheet buttons follow the viewed day, and My tasks follows today. Locked buttons are disabled with "This day is locked" | UIE design pass (`/workspace/review/m16`) | Pass |
| TC-Q03 / TC-T19 auto-stop | Timer running past 23:59 PHT | `regress/q03_verify.log`: entry `6ace44c565186bb9aa329c3a` ended at 23:59 PHT (`endAt 2026-10-13T15:59:00Z`) with `autoStopped: true`. The audit shows `timer_auto_stopped` by `System` | **PASS on 14 Oct.** The timer was started by hand at 22:48 PHT as pm2 (`q03_start.log`), because qa.autostop is not on the seeded QA project team |
| Doc 16 mobile summary | — | QA-reviewed against the code and logs | Reviewed |

## 3. Known gaps
- Older entries that have their own location can show a different location in the DAR than the day's location. There is no data migration for these.
- The DEF-010 restart retest was not run live.
- EC-111 and EC-113 are covered by automated tests only. The live data had no such records.
- **Q-09 2-day lock is not built yet** (planned after 00:41). A day will lock at 00:00 PHT on the third day; for example, Oct 11 locks at 00:00 PHT on Oct 14. After that, only an Admin reopen allows changes. The cases are listed as "Pending build" in `07_M8_TEST_CASES.md`.
- The client portal is planned, and invites are on hold (Q-84). The outline cases are in `07_M8_TEST_CASES.md`.

## 4. Test accounts
QA accounts only. member@ and Jomerson's account are not test accounts, and their data was not touched.
| Email | Role |
|---|---|
| admin@xceler8.example | ADMIN |
| pm@xceler8.example | PROJECT_MANAGER |
| pm2@xceler8.example | PROJECT_MANAGER |
| outsider@xceler8.example | MEMBER (on no QA project team) |
| viewer@xceler8.example | VIEWER |
| qa.viewer@xceler8.example | VIEWER (could not sign in for EC-111) |
| qa.member@xceler8.example | MEMBER |
| qa.autostop@xceler8.example | Role not recorded in the QA scripts or logs (not on the seeded QA project team) |

Roles are taken from `/auth/me/permissions` in `regress/m8c_live3.log` (admin, pm, pm2, outsider, viewer) and from the account-creation scripts (`ec111b.py` for qa.viewer, `member_timer.py` for qa.member).

## 5. Test-case coverage
`07_M8_TEST_CASES.md` now covers FR-PRJ-27 to 34 (AC-53.x, AC-54.1–54.8, EC-95, EC-100–108, EC-110), AC-55.1/EC-109, AC-56.1, EC-111–113 and AC-52.8. Each case has a status from the evidence. It also adds the Q-09 2-day lock section (Pending build) and the Client portal outline (pending contract build, including the invite-hold UI from mockup v0.9.15). Cases without a matching log line are marked "Not evidenced".

---

# Appendix: round history (as recorded)

## Round 1 report: M8 polish, round 1 (PR #14, server build 0c23ce6). Result: BLOCKED (live API not run), 1 new defect from code-level testing

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

### New defects
| ID | Severity | Defect | Repro | Expected | Actual |
|---|---|---|---|---|---|
| DEF-010 | Medium | The module migration isn't one-time. `migrateModuleText` runs on every API start and never checks its `module-free-text` marker. Its filter is "legacy `moduleId` set and `module` null", and saving a blank module doesn't clear `moduleId`. So when a user clears the module on any migrated entry, the old name comes back on the next restart, deploy or scale-out | 1. Take an entry from before the build that had a Module (e.g. "Financials"). 2. `PATCH /tracker/entries/:id {"module":"   "}` returns 200 with `module: null`. 3. Restart the API (or run `migrateModuleText()` again). 4. `GET /tracker/day` | Module stays blank (FR-ACT-20, and "one-time" in FR-ACT-21) | The second run updates 1 entry and the module shows "Financials" again. Reproduced on 0c23ce6 source: `qa_def010.test.ts` |

Suggested fix: skip the migration when the `module-free-text` marker is DONE, or unset `moduleId` when `module` is written.

### Notes
1. The Module limit counts UTF-16 code units (zod and mongoose `.length`), so "100 characters" refuses 100 emoji (400) and accepts 50. Accented letters such as é count as 1. Rich to confirm whether this is acceptable.
2. `POST /tracker/stop` without `entryId`, when no timer is running, still returns 422 NO_TIMER. The live web app always sends `entryId`, so this doesn't affect FR-ACT-23.
3. Spec version: the user brief and README cite doc 14 v0.9.9, but the pushed branch has v0.9.8 (header v0.9.7).

### To finish round 1
Run `cd /workspace/qa-run && QA_TEST_PASSWORD=… python3 m8/m8_live.py | tee m8/m8_live.log`, then rerun the fix-round scripts as described above.

### Round 1 live run (01:01-01:05 PHT Oct 10, build 0c23ce6)
Log: /workspace/qa-run/m8/m8_live.log. All PASS live:
- FR-ACT-24 / DEF-007: 422 DAY_LOCKED on POST/PATCH/DELETE via both /time and /tracker on a submitted day; edits work after Admin reopen. Locked-week create refused 422. DEF-007 CLOSED.
- FR-ACT-25 / DEF-008: real vs made-up user IDs return identical 404 (outsider, pm2) and identical 403 (viewer); Member own day 403 NOT_SUPERVISOR. DEF-008 CLOSED.
- FR-ACT-20: trim, blank=null, 100 ok, 101 -> 400 with field message, HTML stored as text, legacy moduleId refused; DAR preview, PDF and XLSX show modules, blank as dash.
- FR-ACT-21: pre-build entries keep module names (Financials, ADFS Remote). DEF-010 open (restart re-applies migration).
- FR-ACT-22: modules endpoints 404, activity types/locations 200, no lookup audit events.
- FR-ACT-10/23: Time in creates day row; bar and row Time out return the same end time; one timer_stopped audit.

### Round 2 (build 5a56782, 01:54-01:57 PHT Oct 10): FAIL, 66 pass / 7 fail
Log: /workspace/qa-run/m8/m8r2_live.log. DEF-009 CLOSED. Defect numbering (final, supersedes any earlier post):
- DEF-011 (High): Viewer gets 403 on all Reports routes and exports under the starting grid (permission cache not refreshed after the startup seed); works after the grid is re-saved.
- DEF-012 (Medium): access rule with Export on and View off is accepted (200); FR-ACL-14 requires refusing it or clearing Export.
- DEF-013 (Medium): someone else's saved DAR returns a response that differs from a made-up ID (existence leak), and Viewer gets 403 instead of 404 (NFR-25, FR-ACL-17).
- DEF-014 (Low): Viewer PATCH/DELETE on another user's tracker entry returns 403 instead of 404 (FR-ACT-27).
Open: DEF-010 (awaiting API restart), TC-T19 (auto-stop audit, tonight), 11 UI checks for UIE.

### TC-Q03 / TC-T19 auto-stop rerun (14 Oct 2026 ~01:03 SGT) — PASS

Entry `6ace44c565186bb9aa329c3a` (pm2@, started 13 Oct 22:48 PHT). Verify: endAt `2026-10-13T15:59:00.000Z` (23:59 PHT), autoStopped=`true`, audit `timer_auto_stopped` by `System` at `2026-10-13T16:01:46.977Z`. Log: `/workspace/qa-run/q03_rerun.json` + `regress/q03_verify.log`. TC-T19 closed on this rerun. No new DEF.

### Regression on 13 Oct (build 5a56782)
`regress/run_all.log`: 84 pass / 9 fail / 3 skip / 24 UI (`summary.json`). `regress/m8r2_sub.log`: 46 pass / 0 fail / 2 error. `regress/m8c_live3.log`: 79 pass / 2 fail. Its TC-M8C-08 fail was DEF-016, later closed. Its TC-M8C-06 fail is "phases carry editable flag"; no follow-up was recorded.
