# 02 · Business Requirements

| ID | Business requirement | Rationale | Priority |
|----|---------------------|-----------|----------|
| BR-01 | Manage all implementation projects in one system, replacing spreadsheets/email/chat for plans and status. | Single source of truth | Must |
| BR-02 | Create projects from reusable implementation templates so every project follows the company's standard method. | Consistency, speed, fewer missed steps | Must |
| BR-03 | Template changes must not silently change projects already in progress. | Protects committed plans and client agreements | Must |
| BR-04 | Distribute work by project, team, and person, with one clearly accountable owner per task. | Accountability | Must |
| BR-05 | Track client-side responsibilities (data, templates, approvals) against named client contacts **without** giving clients access to the system. | Client delays are the #1 cause of slippage; licensing and data-exposure risk | Must |
| BR-06 | Record hours against specific tasks and compare estimated vs actual effort. | Pricing accuracy, overrun detection | Must |
| BR-07 | Distinguish internal execution time from time spent waiting on the client/external parties, and from rework. | Fair attribution of delays; better estimates | Must |
| BR-08 | Show at a glance which projects are delayed, what is blocked, who is overloaded, and what is pending from clients. | Management visibility | Must |
| BR-09 | Compare planned (baseline) vs forecast completion for each project. | Schedule control | Must |
| BR-10 | Produce basic reports (status, timesheets, effort variance, overdue tasks) exportable to CSV. | Client and management reporting | Must |
| BR-11 | Keep an audit trail of changes to ownership, deadlines, estimates, approvals, and status. | Accountability, dispute resolution, AI-readiness | Must |
| BR-12 | Restrict data by role and project membership, enforced on the server. | Confidentiality between clients/projects | Must |
| BR-13 | Hours must not be presented as a performance score. | Fairness; blueprint governance rule | Must |
| BR-14 | Collect clean, structured data so AI agents (Phase 2+) can analyze risks reliably. | Roadmap dependency | Should |
| BR-15 | Support multiple service lines through template types (SAP B1, Software/API integration, Cloud migration, General IT). | Company offerings | Should |

Document management business requirements BR-16 to BR-20 are in [10 §1](10_DOCUMENT_MANAGEMENT.md).

## Constraints
- Tech stack fixed by blueprint: React + TS, Node/Express + TS, MongoDB.
- Phase 1 contains no AI features; UI may show "Phase 2" placeholders only.
- Secrets (future Grok API keys) never reach the browser.

## Stakeholders
| Stakeholder | Interest |
|-------------|----------|
| Jomerson Nazaire (Lead Developer, R&D, product owner) | Approves scope and requirements |
| Project Managers | Primary daily users; planning and control |
| Consultants / Developers / Specialists / QA | Task execution and time logging |
| Management | Portfolio health, utilization, reporting |
| Client contacts (indirect) | Receive follow-ups outside the system |
