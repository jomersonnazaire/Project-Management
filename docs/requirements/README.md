# Phase 1 Requirements: AI-Powered Implementation Project Tracker

**Status:** v0.3.5, approved by Jomerson for the Phase 1 build (2026-10-09) · **Author:** Rich (Research & Requirements) · **Date:** 2026-10-09
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
