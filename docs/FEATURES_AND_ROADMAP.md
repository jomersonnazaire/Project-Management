# AI-Powered Implementation Project Tracker: Features and Roadmap

Version 1.1, Oct 9, 2026. Owner: Lean The Lead (project lead). Approver: Jomerson Nazaire.

Stack: React + TypeScript + Vite with the Sneat theme, Node.js 22 + Express, MongoDB Atlas, Azure Blob storage, Azure App Service (API), Vercel (web).
Repo: https://github.com/jomersonnazaire/Project-Management. Production: https://xc8-projectmgmt-web.vercel.app

Guiding rule: finish the **internal process** first (Phase 1). **External integrations**, such as email, e-signature, and the client portal, come only after that.

## 1. Phase 1: Core internal tracking

Progress is reported as events, not dates (Jomerson's rule).

| Milestone | Features | Status |
|---|---|---|
| M1 Setup, sign-in, roles | Email and password sign-in (8+ characters with a number and a symbol); 30-minute idle timeout and 12-hour cap; silent lockout after 5 tries; per-IP rate limit; single-use invite and reset links copied by an Admin; Access role and Job role kept separate; Admin screens | Done, in production |
| M1.5 Access rules and contacts | Editable View/Create/Edit/Delete grid for Admin, PM, Member, Viewer; locked Admin protections; Members limited to their projects; Clients with Details, Contacts, Projects tabs | Done |
| M2 Templates, projects, tasks | Versioned templates and the SAP B1 Implementation template; projects with health; task board with dependencies; My tasks; Active contacts; PM handover; add-activity per phase; reordering; one-step add-and-assign; Admins edit user emails | Done |
| M3 Time, documents, collaboration | Time logging; document folders with Requested/Submitted/Signed and restricted folders; file-only evidence (PDF, Word, Excel, 25 MiB, real-type and malware checks); in-app notifications; Conversation tab; My tasks Today (planned and aging) and Due tabs; PH holidays and Working days settings | Done |
| M3.5 Issue tracking | Issues before and after go-live with severity-based due dates, status flow, Issues tab and All issues page; outsiders get "not found" on every record | Done (PR #8 follow-up awaiting merge) |
| M4 Dashboard, reports, PM view | Portfolio dashboard and health; team workload; effort variance; issue reports; **My projects** PM view with days late and who needs a follow-up | In build |
| M5 Activity Tracker | Time in/out on Today rows; quick activities; daily timesheet with Submit day; location once per day; Activity type, Billable, Module | Specced (doc 14), awaiting approval |
| M6 Daily Accomplishment Report | Date range, HTML email in the sample layout, preview with To and CC, PDF/Excel export, Sent reports record with saved copies | Specced: view, save (Saved reports record) and export; sending is on the roadmap |
| M7 Leave | Record leave as full day or half day AM/PM, yearly balances, no approval step | Specced, awaiting approval |
| M8 Regression | Full QA regression and the user manual | Planned |

## 2. Phase 2: AI insights (after Phase 1)

- A Grok insights service that runs the blueprint's specialist agents as read-only analyses. Every insight cites the records it's based on, and a PM approves any change it suggests.
- Estimated cost is about $35/month for 20 projects, with a proposed $50/month pilot cap.
- **Decision needed from Jomerson before the build:** whether project data can be sent to xAI under the Data Privacy Act.
- Candidates still to be sized: Gantt timeline, QA review workflows, and deeper client dependency tracking.

## 3. Phase 3: AI agents

- Grok agents that recommend actions such as reassignments and schedule changes. A PM approves each one, and routine reminders can run automatically.

## 4. External integrations (after the internal process is complete)

| Integration | Notes |
|---|---|
| **Email notifications** | Follow-ups, assignments, and due or overdue reminders sent by email, on top of in-app notifications. Includes emailed invite and password reset links (replacing the links copied by hand). Needs an email sending service and Jomerson's sign-off on the sender address. |
| **Microsoft (Entra ID) sign-in** | On hold (Jomerson, 2026-10-09). Spec kept in doc 14 §1: alongside passwords, Xceler8 tenant only, existing users only. Also enables Outlook calendar in the tracker. |
| **Report sending from own account** | Once Entra ID is set up, Daily Accomplishment Reports send from each person's own Outlook account (Jomerson), Saved reports gain a Send button. Until then reports are viewed, saved and exported. |
| In-app e-signature | On hold. Researched options are BoldSign and Docusign (RA 8792 compliant). |
| Client portal | On hold. Client contacts have no login until then. |
| Native mobile apps | On hold. |
| Multi-company (SaaS) | On hold. Xceler8 only for now. |

## 5. Known tech debt

- TD-01: the rate limiter keeps its state in memory, so the API is pinned to 1 App Service instance. A shared store is needed before scaling out.
- Staging environment (NFR-26): on hold until Jomerson adds the planned features.
- Q-06: hours and order per template activity, to come from the SAP B1 team.
