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
