# AI-Powered Implementation Project Tracker: Features and Roadmap

Version 1.0, Oct 9, 2026. Owner: Lean The Lead (project lead). Approver: Jomerson Nazaire.

Stack: React + TypeScript + Vite with the Sneat theme, Node.js 22 + Express, MongoDB Atlas, Azure Blob storage, Azure App Service (API), Vercel (web).
Repo: https://github.com/jomersonnazaire/Project-Management. Production: https://xc8-projectmgmt-web.vercel.app

Guiding rule: finish the **internal process** first (Phase 1). **External integrations**, such as email, e-signature, and the client portal, come only after that.

## 1. Phase 1: Core internal tracking (target Nov 5, 2026)

| Milestone | Features | Status |
|---|---|---|
| M1 Setup, sign-in, roles | Sign-in with 8+ character passwords that include a number and a symbol; 30-minute idle timeout and 12-hour session cap; silent lockout after 5 tries; per-IP rate limit; single-use invite and reset links (72h and 24h) that an Admin copies by hand; Access role and Job role kept separate; Admin screens for users, teams, clients, and settings | Done, in production |
| M1.5 Access rules and contacts | Editable View, Create, Edit, and Delete grid for the 4 fixed roles (Admin, PM, Member, Viewer); Admin protections that can't be removed; Members limited to their own projects; Clients with Details, Contacts, and Projects tabs | Done |
| M2 Templates, projects, tasks | Versioned templates (projects keep their snapshot) and the SAP B1 Implementation launch template (10 activities); projects created from a template, with health status; task board with dependencies; My tasks; project Active contacts; PM handover; PMs can read their projects' activity log; per-phase "+ Add activity"; drag reordering | Passed QA, finishing PR #3 |
| M3 Time, documents, collaboration | Time logging (refused on On Hold projects); project document folders with Requested, Submitted, and Signed status and locked signed versions; evidence uploads (PDF, Word, or Excel up to 25 MiB, checked for real file type and malware); **in-app notifications** for follow-ups; Project Conversation tab; configurable Philippine holidays | Spec and mockup v0.6 ready |
| M3.5 Issue tracking | Issues raised before and after go-live, with severity, owner, client contact, and due dates by severity (1, 3, 7, and 15 working days); status runs Open, In progress, Waiting on client, Resolved, Closed; resolved issues auto-close after 7 days; per-project Issues tab and an All issues page | Approved |
| M4 Dashboard and reports | Portfolio dashboard with health rules; team workload; effort variance (tasks with no estimate excluded); issue counts; reports | Planned |
| M5 Regression | Full regression run by QA, plus the user manual | Planned (Nov 3–5) |

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
| In-app e-signature | On hold. Researched options are BoldSign and Docusign (RA 8792 compliant). |
| Client portal | On hold. Client contacts have no login until then. |
| Native mobile apps | On hold. |
| Multi-company (SaaS) | On hold. Xceler8 only for now. |

## 5. Known tech debt

- TD-01: the rate limiter keeps its state in memory, so the API is pinned to 1 App Service instance. A shared store is needed before scaling out.
- Q-06: hours and order per template activity, to come from the SAP B1 team.
