# 01 · Phase 1 Test Plan

**Project:** AI-Powered Implementation Project Tracker · **Version:** v0.1.4 (2026-10-09) · **Owner:** Queen The QA
**Based on:** Requirements v0.3.3 (`docs/requirements`), Mockup v0.4.1 (Sneat theme, `docs/design/THEME_TOKENS.md`) (`docs/design/mockup`)

## 1. Objective
Verify that every Phase 1 requirement works as specified before a build reaches Lean and Jomerson. Every acceptance criterion (AC) in `05_ACCEPTANCE_CRITERIA.md` and `10_DOCUMENT_MANAGEMENT.md §4` and every edge case (EC-01 to EC-51) maps to at least one test case in `02_TEST_CASES.md`.

## 2. Scope
**In scope (Phase 1):** auth and sessions, users/teams/roles, clients and client contacts, templates and versioning, project creation and plan generation, task board and state machine, dependencies, evidence and approvals, time logging and timesheets, dashboard, workload, reports and CSV, audit log, project document management, permissions, security, performance, accessibility, responsiveness.

**Out of scope:** AI insights (only verify the panel is labelled Phase 2 and makes no AI calls, AC-20.3), in-app e-signature (Phase 2, Q-20), client portal, email notifications to clients (Q-02 default: track only).

## 3. Test levels and who runs them
| Level | What | Owner |
|---|---|---|
| Unit | All calculations and permission rules (NFR-22) | Deven (dev), Queen reviews coverage |
| API integration | Every "(API)" criterion plus the security cases in this plan (NFR-23) | Deven writes, Queen verifies and adds negative cases |
| Functional UI | Every UI criterion, against the preview build | Queen |
| Edge cases | EC-01 to EC-51 | Queen |
| Security | Authorization matrix, client-contact isolation, NoSQL injection, file upload abuse, signed-URL expiry | Queen |
| Regression | Smoke and core suites on every build (§8) | Queen |
| Performance | NFR-10 to NFR-12 and the document NFRs | Queen, on a seeded large dataset |
| Accessibility and responsive | NFR-14, NFR-15 | Queen |
| UAT support | SAP B1 template walkthrough with Jomerson | Queen and Jomerson |

**API rule:** a criterion marked "(API)" passes only if it holds when the endpoint is called directly (curl/Postman/test script), bypassing the UI. Hiding a button is never a pass.

## 4. Environments and test data
- **Preview per PR** (NFR-20): the main QA environment. Each build to test must come with its preview URL, commit SHA, and the list of covered requirement IDs.
- **Seed data** (needed from Deven): the SAP B1 template; 2 clients with 3 contacts each (one inactive); one user per access role (Admin, PM, Member, Viewer), plus a second PM and a Member who isn't on the test project; one deactivated user; a project per health state (On track, At risk, Delayed); a project with 0 tasks; tasks matching AC-22.1 (8/12, 16/14, 10/18, 0/2).
- **Large dataset** for performance: 200 projects, 20,000 tasks, 200,000 time entries, and one project with 1,000 documents.
- **Test files:** 0 B, 25.0 MB, 25.1 MB, a `.exe` renamed to `.pdf`, an HTML file renamed to `.pdf`, a `.docx` that is a zip of executables, and file names with 200+ characters, emoji, `/`, `\`, `..`, and `ñ`.
- **Accounts:** test credentials go in a secret store, never in the repo or chat.

## 5. Entry criteria (QA starts a build when)
1. Requirements and mockup for the feature are approved.
2. The build is deployed to a preview URL, and CI (lint, type check, unit and API tests) is green (NFR-24).
3. The handover lists the requirement IDs covered, known gaps, and the seed data state.

## 6. Exit criteria (QA passes a build when)
1. 100% of Must test cases in scope were executed.
2. 0 open Critical or High defects.
3. Medium defects are either fixed or accepted by Lean in writing, with a target build.
4. All "(API)" and security cases pass.
5. The regression suite passes.
6. The QA report has been delivered (template in `03_QA_REPORT_TEMPLATE.md`).

## 7. Defect workflow
Build → QA → **FAIL**: a defect goes to Deven → fix → QA retests the defect, then runs regression on the affected area → **PASS**: the QA report goes to Lean.

**Severity**
| Severity | Meaning | Examples |
|---|---|---|
| Critical | Data loss, security or permission breach, app unusable | Client contact can authenticate; Signed file can be replaced; a non-member can download documents |
| High | Core requirement broken, no workaround | Plan generation creates partial project; variance math wrong |
| Medium | Requirement broken with a workaround, or a wrong message/state | Wrong error text; filter count off |
| Low | Cosmetic, copy, or minor layout | Alignment, typo |

**Defect record:** ID (DEF-###), title, severity, build/commit, environment URL, requirement/AC/TC IDs, steps, expected, actual, evidence (screenshot or request/response), status (New, In Fix, Ready for Retest, Closed, Reopened, Deferred).

## 8. Regression strategy
- **Smoke (every build, about 15 min):** sign-in, create a project from the SAP B1 template, move a task through the board, log time, upload a document, open the dashboard.
- **Core (every build heading to Lean):** all Critical-path TCs, i.e. those tagged `P1` in `02_TEST_CASES.md`.
- **Full (before Phase 1 sign-off):** every TC.
- Every fixed defect gets a regression TC added to the suite.

## 9. Deliverables
1. This test plan and `02_TEST_CASES.md`.
2. A defect log for each build.
3. A QA report for each build (`03_QA_REPORT_TEMPLATE.md`).
4. A traceability matrix (AC/EC → TC → result), included in each QA report.
5. The Phase 1 user manual, written from the build that passes final QA.

## 10. Risks and requirement gaps found during test design
These need a decision from Rich/Lean before the matching tests can be finalized:

| # | Item | Why it matters for testing | Suggested resolution |
|---|---|---|---|
| G-1 | FR-PRJ-10 health thresholds overlap. With variance 0 and an overdue **optional** task, "On track" (no overdue *mandatory* task) and "At risk" (*any* overdue task) both apply. | Can't write a single expected result | Evaluate Delayed first, then At risk, then On track; an overdue optional task means At risk |
| G-2 | EC-28 says time logging on On Hold projects is open ("allowed?"), but the Q-15 default says it's blocked. | Conflicting expected results | Update EC-28 to "blocked" per Q-15 |
| G-3 | 25 MB isn't defined as 25,000,000 or 26,214,400 bytes (AC-27.1, EC-41). | Boundary tests need an exact byte count | Define as 26,214,400 bytes (25 MiB) |
| G-4 | Session idle timeout length isn't stated (AC-01.5). | Can't time the test | State the value, e.g. 30 minutes |
| G-5 | AC-01.3 lockout: unclear whether the count resets after a successful sign-in and whether it applies per account or per IP. | Ambiguous expected result | Per account; resets on success |
| G-6 | Q-21 Viewer access to documents is still open, but the §5 permissions table marks Viewer ✓ for viewing. | Permission matrix tests | Confirm the default (Viewers can view and download) |
| G-7 | Mockup v0.3 invite form mixes access role and job role (already raised by Rich). | AC-02 tests depend on the split | UIE to split the fields in v0.4 |

**Resolved 2026-10-09 by Lean (requirements v0.3.1):** G-1 health is checked in order (Delayed, then At risk, then On track), so 0 variance with an overdue optional task means At risk, and On Hold projects show "On hold". G-2 On Hold projects block time logging on the server. G-3 the limit is 25 MiB, which is 26,214,400 bytes. G-4 sessions time out after 30 min idle. G-5 the lockout is 5 failures per account for 15 min, plus a per-IP rate limit. G-7 the access role and job role are now separate fields (mockup v0.4). G-6 (Viewer access to documents, Q-21) is still open, and its default applies.

**Changed 2026-10-09 (Jomerson via Deven):** the password minimum is 8 characters (TC-A13). Sign-in lands on My tasks until Milestone 4 (TC-A01). Invite and reset links are shared by hand because email is deferred (TC-A14). E-signature is deferred indefinitely and stays out of scope.

**Changed for requirements v0.3.3:** invite links expire after 72 h and reset links after 24 h, and a new link cancels any earlier unused one (TC-A14).

**Changed for PR #1:** passwords now also need a number and a symbol (TC-A13). There is a new 12 h absolute session cap (TC-A15), tracing to AC-01.5b in requirements v0.3.4.
