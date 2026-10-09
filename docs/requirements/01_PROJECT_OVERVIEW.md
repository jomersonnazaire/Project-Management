# 01 · Project Overview

## 1. Problem
Implementation service companies (e.g. SAP Business One partners like Xceler8) run projects whose plans, assignments, client requests, timesheets, and status updates are scattered across spreadsheets, email, and chat. Managers can't quickly answer:
- Which projects are delayed?
- What is blocked, and is it blocked by us or by the client?
- Who is overloaded?
- What are we still waiting for from the client?
- Did we spend more effort than we estimated, and where?

## 2. Product vision
One web application that manages the full implementation lifecycle: create a project from a reusable implementation template, assign and track the generated tasks, log time against them, follow up on client deliverables, and report on schedule and effort. Later phases add Grok-powered AI agents that analyze this data and recommend actions, with the Project Manager keeping approval authority.

## 3. Phase 1 scope ("Core tracking")
Phase 1 builds the reliable data foundation the AI phases depend on.

**In scope**
1. Authentication and role-based access (internal users only).
2. Users, roles, and teams administration.
3. Clients and client contacts (tracked records, **never** logins).
4. Implementation templates with versioning; projects keep a snapshot.
5. Project creation from a template (plan generation) and plan review.
6. Tasks: fields, statuses, assignment (one accountable owner + optional assignees), dependencies, blockers, evidence, approval state, follow-up notes.
7. Task board (Kanban) and project checklist view.
8. Time logging against tasks (execution / waiting / rework).
9. Portfolio dashboard and projects list with health and schedule variance.
10. Team & workload view (assigned vs recorded vs available hours).
11. Basic reports: effort variance, overdue tasks, timesheets, project status, with CSV export.
12. Audit trail of consequential changes.
13. **Project document management** (v0.2): per-project folder tree (Contracts, phase folders, custom), document lifecycle Requested → Submitted → Signed, locked signed versions. See [10](10_DOCUMENT_MANAGEMENT.md).

**Out of scope for Phase 1** (shown in mockup as placeholders or deferred)
- AI insights panel, Grok integration, AI agents (Phase 2/3).
- Gantt timeline view (Phase 2); the project detail "Timeline" tab is a placeholder.
- Tickets / defect tracking, formal QA workflows (Phase 2).
- Client portal or any client login (future, separate access level).
- Any email to client contacts (Q-02 resolved: contacts tracked only). Internal password-reset email is still allowed.
- In-app e-signature: deferred indefinitely (Jomerson, 2026-10-09). Documents are signed outside the app and uploaded (Q-20).
- Mobile native apps.
- Multi-company (multi-tenant) SaaS; Phase 1 is for Xceler8 only (Q-01).
- Seeded templates other than SAP Business One (Q-04); others can be built in-app.

> Note: The blueprint lists "workload and effort variance reports" under Phase 2, but the mockup includes them. Jomerson confirmed a **basic** version stays in Phase 1 (Q-05).

## 4. Users (internal)
| Role | Main goal in Phase 1 |
|------|----------------------|
| Admin | Manage users, roles, teams, clients, templates, settings |
| Project Manager (PM) | Create and plan projects, assign work, approve, monitor health |
| Team member (Consultant, Developer, BA/Researcher, Support, QA/Tester, Technical/Data Specialist) | Work assigned tasks, update status, attach evidence, log time |
| Viewer / Executive (assumed, A-04) | Read-only dashboards and reports |

**Client contacts** are people, not users. They are tagged on tasks so internal users can follow up with them.

## 5. Market context (research summary)
| Product | Relevant strengths | Gap this product fills |
|---------|-------------------|------------------------|
| Rocketlane | Purpose-built for client onboarding/implementation; templates, customer portal, time tracking, AI | Priced for SaaS onboarding teams; client collaboration assumes portal logins; no ERP-implementation templates |
| GUIDEcx | Client onboarding with task assignment to customers, automated reminders | Customers become platform users; less focus on internal effort variance |
| Asana / Monday.com / ClickUp | Flexible boards, templates, workload views | Generic; templates don't snapshot per project; client contacts need guest seats; effort variance is manual |
| Jira + Tempo | Strong time tracking and reporting | Developer-centric; heavy setup for consultants; no implementation checklist concept |
| Smartsheet | Spreadsheet-style plans, Gantt, dashboards | Weak task-level time vs estimate; client follow-up is ad hoc |
| Kantata (Mavenlink) / Projector PSA | Professional-services resource and utilization management | Enterprise cost and complexity; overkill for a focused implementation team |

**Differentiators to protect in the design**
1. Implementation checklists generated from versioned templates (in-flight projects never silently change).
2. Client contacts tracked as responsible parties **without** seats or logins.
3. Time split into execution vs waiting-on-client vs rework, so delays are attributed fairly.
4. Estimated vs actual effort at task level, with zero-estimate handling.
5. A clean data model ready for Grok agents in Phase 2.

## 6. Success measures (proposed, to be confirmed in Q-10)
- 100% of active projects created from a template within 1 month of launch.
- Every team member logs time weekly (≥90% of working days covered).
- PM can answer the five questions in §1 from the dashboard in under 1 minute.
- Zero client-contact authentication paths (verified by QA security tests).

## 7. Tech stack (from blueprint)
React + TypeScript · Node.js + Express + TypeScript · MongoDB · (Grok API in Phase 2).
