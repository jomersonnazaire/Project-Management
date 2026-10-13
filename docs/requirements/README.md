# Phase 1 Requirements: AI-Powered Implementation Project Tracker

**Status:** v0.5.0 draft (M3 additions pending approval); Phase 1 v0.3.6, approved by Jomerson for the Phase 1 build (2026-10-09) · **Author:** Rich (Research & Requirements) · **Date:** 2026-10-09
**Sources:** Product blueprint PDF ("AI-Powered Implementation Project Tracker"), UI mockup v0.4 by UIE, Sneat style (incl. Documents, Login, My tasks, Admin, Template editor, dialogs, empty/error states), competitor research.

| # | Document | Primary reader |
|---|----------|----------------|
| 01 | [Project Overview](01_PROJECT_OVERVIEW.md) | Everyone |
| 02 | [Business Requirements](02_BUSINESS_REQUIREMENTS.md) | Jomerson, Lean |
| 03 | [Functional Requirements](03_FUNCTIONAL_REQUIREMENTS.md) | Deven, UIE, Queen |
| 04 | [User Stories](04_USER_STORIES.md) | UIE, Deven |
| 05 | [Acceptance Criteria](05_ACCEPTANCE_CRITERIA.md) | Queen, Deven |
| 06 | [Workflow](06_WORKFLOW.md) | UIE, Deven |
| 07 | [Technical Requirements](07_TECHNICAL_REQUIREMENTS.md) | Deven |
| 08 | [Edge Cases](08_EDGE_CASES.md) | Queen, Deven |
| 09 | [Open Questions & Assumptions](09_OPEN_QUESTIONS.md) | Jomerson |
| 10 | [Project Document Management](10_DOCUMENT_MANAGEMENT.md) | Everyone |

**ID conventions:** `BR-xx` business requirement · `FR-<MOD>-xx` functional requirement · `US-xx` user story · `AC-xx.y` acceptance criterion (maps to `US-xx`) · `NFR-xx` non-functional · `EC-xx` edge case · `Q-xx` open question · `A-xx` assumption.

Every FR traces to a BR and every user story lists the FRs it covers, so QA can trace a test back to a business need.

## Change log
| Version | Date | Change |
|---------|------|--------|
| v0.1 | 2026-10-09 | Initial Phase 1 requirements from blueprint and mockup v0.1 |
| v0.2 | 2026-10-09 | Added Project Document Management (doc 10: BR-16..20, FR-DOC-*, US-24..32, EC-39..51, Q-20..25). Database confirmed as MongoDB. Task evidence file types aligned with documents. |
| v0.3 | 2026-10-09 | Jomerson accepted the proposed defaults for Q-01, Q-02, Q-04, Q-05, Q-20 (all blocking questions now resolved). Scope now references mockup v0.3. |
| v0.3.1 | 2026-10-09 | Added Lean's decisions on QA's questions: health rule, On Hold blocks time logging, 25 MiB = 26,214,400 bytes, 30-minute idle timeout, per-account lockout plus per-IP rate limit. Added the Sneat UI theme and contrast rule to 07. |
| v0.3.2 | 2026-10-09 | Jomerson approved Phase 1. 07 updated: Node.js 22 LTS (Azure has no Node 20), plus the hosting setup (Vercel, Azure App Service, MongoDB Atlas, Azure Blob `project-documents`). |
| v0.3.3 | 2026-10-09 | Milestone 1 decisions: 8-character password minimum; sign-in lands on My tasks until Milestone 4; invite and reset links are single-use and shared by hand (72 hours and 24 hours), with emailed reset deferred. |
| v0.3.4 | 2026-10-09 | PR #1 deviations accepted: passwords need a number and a symbol, and sessions have a 12-hour absolute cap. |
| v0.3.5 | 2026-10-09 | Lean's calls on QA findings: silent lockout (AC-01.3), invite and reset tokens in a POST body, rate limiter tech debt TD-01. |
| v0.3.6 | 2026-10-09 | From M1 testing: 429 sign-in copy (AC-01.3) and trusted client-IP rule for the rate limiter (NFR-05). |
| v0.4.0 draft | 2026-10-09 | Doc 11: access rules module per Access role (Milestone 1.5), Clients › Contacts tab, project Active contacts (M2). |
| v0.4.1 | 2026-10-09 | Jomerson: four fixed Access roles (no custom roles); Q-26 only Admins delete projects, PMs archive; Q-27 PMs can't see access rules. |
| v0.4.2 | 2026-10-09 | Client Projects tab (FR-CLI-11) with Member scope rule (FR-CLI-12), AC-35.2, AC-35.3. |
| v0.4.3 | 2026-10-09 | Doc 11 §11 records Lean-accepted PR #2 deviations. |
| v0.4.4 | 2026-10-09 | Q-11 resolved (PMs publish templates via Edit), Q-12 resolved (PMs edit/archive own projects only). |
| v0.4.5 | 2026-10-09 | EC-58: tasks without estimates show "–" and are excluded from variance; seed template ships with proposed order, no estimates (Lean). |
| v0.4.6 | 2026-10-09 | M2 rulings: template short name, accepted placeholders, holidays still required, three proposals pending Lean (doc 11 §12). |
| v0.4.7 | 2026-10-09 | Lean decided the three M2 proposals (PM activity log, draft visibility, PM handover); PH holidays scheduled for M3. |
| v0.5.0 draft | 2026-10-09 | Doc 12: add-activity, reordering, phase-card click (PR #3); evidence uploads, follow-up notifications, Conversation tab (M3). |
| v0.6.0 draft | 2026-10-09 | Doc 13: Project Issue Tracking (Milestone 3.5), with access rows for issues, conversations and notifications. |
| v0.6.1 | 2026-10-09 | Q-28 resolved (in-app only; email in External integrations). FR-PRJ-18 Move up/down, FR-PRJ-19 DEF-003 add-and-assign. M3.5 approved with Q-32 to Q-35 defaults. |
| v0.6.2 | 2026-10-09 | FR-USR-06: Admins can edit a user's email. |
| v0.6.3 | 2026-10-09 | FR-PRJ-20 Checklist Edit button; FR-USR-06 confirmed with confirmation wording. |
| v0.6.4 | 2026-10-09 | Doc 12 approved (Q-29 to Q-31 defaults); FR-PRJ-19 adds on save. PR #4 merged. |
| v0.6.5 | 2026-10-09 | Doc 12 §3.1b: Today tab (FR-TSK-20/21, Philippine time), holiday calendar rules (FR-CAL-01 to 04), Lean's calls. |
| v0.6.6 | 2026-10-09 | FR-CAL-05 Working days setting with at-least-one-day guard; FR-CAL-02 uses it. |
| v0.6.7 | 2026-10-09 | Doc 12 aligned with M3 build calls: Holidays tab, 90-day notifications label, PMs read-only on others' conversations; Defender pending. |
| v0.6.8 | 2026-10-09 | M3 done: phase folders unrestrictable, official holidays loading + later proclamations, Members delete own time (doc 11 §6). |
| v0.6.9 | 2026-10-09 | My tasks: Today (planned/aging) and Due tabs, FR-TSK-22 to 25, AC-TODAY-2 to 5. |
| v0.7.0 | 2026-10-09 | PR #7 calls confirmed: My tasks tabs after Due, PMs view-only on other projects' issues, phase deletion rule, M3.5 items deferred to M4. |
| v0.7.1 | 2026-10-09 | NFR-25: out-of-scope records return 404 on every method (after DEF-005 and DEF-006). |
| v0.7.2 | 2026-10-09 | Q-08 resolved, Q-09 as setting; NFR-26 separate staging environment. |
| v0.8.0 draft | 2026-10-09 | Doc 14: Microsoft sign-in (M5), Activity Tracker (M6), Daily Activity Report (M7), Leave (M8), PM view folded into M4. Q-36 to Q-47. |
| v0.8.1 | 2026-10-09 | Doc 14: daily timesheet with Submit day, reopen and weekly-lock flag (FR-ACT-10 to 14); DAR fallback for non-Outlook users (FR-DAR-04b). |
| v0.8.2 | 2026-10-09 | Doc 14 §10 Lean's calls on mockup gaps; §11 message wording draft. |
| v0.8.3 | 2026-10-09 | Doc 14 §12: Jomerson's Q-36/37/41/46 decisions, Location/Billable/Module fields, exact-minute rendered time (proposed), wording fixes. |
| v0.8.4 | 2026-10-09 | Doc 14 §12.4: location once per day (FR-ACT-17), exact report layout (FR-DAR-08), column mapping; Lean confirmed exact minutes and Admin-only reopen after lock. |
| v0.8.5 | 2026-10-09 | FR-DAR-09: Activity Type is a category on every entry (UIE). |
| v0.8.6 | 2026-10-09 | Time type kept on project entries (FR-ACT-18); no-supervisor rules for report and leave (FR-DAR-10, FR-LV-10). |
| v0.8.7 | 2026-10-09 | Sent reports record with saved copies (FR-DAR-11 to 16), Q-48 retention. |
| v0.9.0 | 2026-10-09 | Microsoft sign-in on hold (roadmap); milestones renumbered M5 tracker, M6 report, M7 leave, M8 regression; company sender with server-built recipients (FR-DAR-17); roadmap v1.1. |
| v0.9.1 | 2026-10-09 | Q-49 resolved: report view/export only; sending and Sent reports record move to the Microsoft sign-in roadmap item. |
| v0.9.2 | 2026-10-09 | Saved reports (FR-DAR-11 to 16, 18): save is final, supervisor sees all saves, no deletes, Latest/Earlier version. |
| v0.9.3 | 2026-10-09 | Saved reports private to the owner (FR-DAR-14); no purge; Q-48 deferred. |
| v0.9.4 | 2026-10-09 | Doc 14 approved for build; FR-LV-11 same-day AM+PM leave rule. |
| v0.9.5 | 2026-10-09 | M4–M7 build notes: remarks fallback (FR-DAR-19), quick-activity delete (FR-ACT-19), accepted deviations, deferred leave items. |
| v0.9.6 | 2026-10-09 | FR-TSK-22 tab order adds Day timesheet after Today. |
- v0.9.7 (2026-10-09): doc 14 FR-ACT-20 to 23: Module optional free text (100 chars, trimmed), Modules settings screen removed (data kept), Day timesheet row Time out button.
- v0.9.8 (2026-10-10): doc 14 FR-ACT-24 (locked days refuse non-Admin changes on every route), FR-ACT-25 (out-of-scope user IDs return 404).
- v0.4.8 / doc 11 (2026-10-10): FR-ACL-14 to 17: Reports (View + Export) and Team & workload (View) access rows; starting values mirror today; saved DARs stay private.
- v0.9.9 (2026-10-10): doc 14 FR-ACT-26 to 28, FR-LV-12/13, NFR-27 from Jomerson M8 feedback.
- v1.0.0 (2026-10-10): doc 14 NFR-28 (system auto-stops audited), NFR-29 (audit IP and user agent).
- v1.1.0 draft (2026-10-10): doc 14 FR-PTY-01 to 07 Project Type with default activity type; Q-50, Q-51.
- v1.1.1 (2026-10-10): app renamed OpsTrack (FR-DAR-08 footer); nine starting Project types (Q-51); Q-50 yes.
- v1.2.0 (2026-10-13): doc 14 m8-polish: FR-PRJ-21 to 26 (PM-only checklist delete, Planning-only phase edit, team-scoped Projects list/Task board with 404), FR-TSK-26 to 30 (Planned date column, next allowed My tasks tab), FR-NAV-01/02 (hide empty Setup), FR-ACT-29 to 33 (Log task time / Add quick activity, system "Quick Activity" type), NFR-30 to 32 (plannedStart in payloads, stable `quick_activity` key, `GET /me/permissions`); US-46 to 52, EC-81 to 92; Q-52 to Q-63 open.
- v0.4.9 / doc 11 (2026-10-13): FR-ACL-18 to 21 mirror m8-polish access rules (team scope supersedes Q-12 pending Q-57 to Q-59; tab/Setup permission mapping; effective permissions endpoint); AC-46.4, AC-49.5, AC-50.3, AC-51.5, EC-93.
- v1.2.1 (2026-10-13): doc 14 m8-polish, Lead's decisions: Project PM = manager or a PM on the team list; Admins delete activities and edit phases at any status; 409 `ACTIVITY_IN_USE` with `details.blockedBy` (time, evidence, documents, issues), fixed inline message wording (web and mobile, #b8240a), no confirm dialog; Viewer default My tasks tab Due; Quick Activity "System type" badge, no Edit/Deactivate; Q-56 format by default (A-20); PM phase lock (name, order, dates, add/delete) outside Planning; Planned date omitted when empty; server-side team filter (also the Log time and Create task pickers; Viewers on the team count; contacts don't); tab fallback to the right with wrap, hide My tasks if none allowed; 422 `FUTURE_DATE`; "Add quick activity"; Setup hiding web-only; Quick Activity can't be deactivated, no backfill. Q-52, 54, 56, 61, 63 resolved; Q-64, Q-65 added.
- v0.4.10 / doc 11 (2026-10-13): FR-ACL-18 to 22 updated to match (team definition, Admin exemptions, ACTIVITY_IN_USE, Viewer default tab Due, System type badge, permission-driven Setup, New project and + Task, per-tab keys from Deven, Quick Activity system type).
- v1.2.2 (2026-10-13): doc 14: My tasks tab permissions (Today needs `tasks.view` and `time.view`); defaultTab = first allowed tab (Viewer-default-Due rule removed); `ACTIVITY_IN_USE` applies to Admins too, refused deletes not audited; EC-90/A-21 existing custom "Quick Activity" renamed "Quick Activity (custom)", no merge; Q-66 added.
- v0.4.11 / doc 11 (2026-10-13): Setup child items and My tasks tab permission keys (Deven); FR-ACL-19 to 21 and AC-46.4 updated; full open-question list.
- v1.2.3 (2026-10-13): doc 14: team-only project filter dropped by Jomerson (FR-PRJ-24 to 26, US-49, AC-49.1 to 49.4, EC-85 to 87 struck; IDs not reused); project visibility unchanged; Q-57 to Q-60 withdrawn; mobile on hold.
- v0.4.12 / doc 11 (2026-10-13): FR-ACL-18 and AC-49.5 dropped; FR-ACL-07 and Q-12 stand; open questions Q-53, Q-55, Q-62, Q-64 to Q-66.
- v1.2.4 (2026-10-13): doc 14 m8-polish approved for build (Jomerson, "proceed" with defaults): Q-53 yes (all phase fields locked), Q-55 yes (reopens in Planning), Q-62 replace, Q-64 no status lock on activities, Q-65 Quick Activity not billable, Q-66 yes (A-21 decided). No open m8-polish questions. Ships as one combined m8-polish update with the DR-48 fix.
- v0.4.13 / doc 11 (2026-10-13): m8-polish access changes approved for build; open questions none.
- v1.2.5 (2026-10-13): doc 14 §I (Jomerson): optional template on New project ("Template (optional)", "None – start blank"), template = editable copies with no link back, blank Checklist empty state with + Add phase / Apply template (Planning only), append on apply (A-22), Planning-stage add/edit/delete of phases and activities (FR-PRJ-27 to 31, US-53, AC-53.1 to 53.7, EC-94 to 99); PM activity delete at any status clarified; Planned column order and phone placement (A-20 decided); overrides FR-PRJ-01 / AC-09.1 template required. Q-67 to Q-69 open.
- v0.4.14 / doc 11 (2026-10-13): Planning-stage editing and Apply template rights mirrored from doc 14 §I.
- v1.2.6 (2026-10-13): doc 14 §I, Jomerson "yes proceed": Q-67 append only (A-22 decided); Q-68 template name and version kept as plain history (Checklist "Started from {template} v{version}" / "Started blank"; FR-TPL-06 count and dashboard Template column use it; FR-TPL-10 "remain linked" no longer applies); Q-69 leave Planning with no phases allowed with confirmation dialog (EC-96); apply toast; AC-53.8, AC-53.9. No open questions.
- v0.4.15 / doc 11 (2026-10-13): open-questions note updated (Q-67 to Q-69 resolved).
