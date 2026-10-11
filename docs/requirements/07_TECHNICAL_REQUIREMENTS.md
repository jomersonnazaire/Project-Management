# 07 · Technical & Non-Functional Requirements

These are requirements and recommendations for Deven; final architecture decisions belong to the Dev Lead.

## 1. Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript, Vite, React Router, a data-fetching cache (e.g. TanStack Query), form validation (e.g. React Hook Form + Zod) |
| Backend | Node.js **22 LTS** + Express + TypeScript (changed from 20 on 2026-10-09 because Azure App Service no longer offers Node 20), REST JSON API under `/api/v1` |
| Database | MongoDB 7 on **MongoDB Atlas**, Mongoose or native driver with schema validation |
| Files | **Azure Blob Storage**: storage account `xc8pmdocstc3w`, private container `project-documents`. The DB stores metadata only |
| AI (Phase 2) | Grok API called **only** from the backend |

**Hosting (Phase 1):** the front end is on **Vercel**, with a preview deploy per PR. The API is on **Azure App Service** `xc8-projectmgmt-api-tc3w`. The database is MongoDB Atlas, and files are in Azure Blob (above). Secrets are kept in Vercel, Azure, and Atlas settings, never in the repo.

**UI theme:** Sneat Bootstrap admin template (free v3.0.0, MIT license), chosen by Jomerson. Implement it as React + TypeScript components with React-Bootstrap that reuse Sneat's SCSS styles. Don't use Sneat's HTML or jQuery pages directly. Color overrides that meet WCAG AA contrast are in `docs/design/THEME_TOKENS.md`, and the reference screens are mockup v0.4 in `docs/design/mockup`.

Shared validation schemas between frontend and backend are recommended (e.g. Zod in a shared package).

## 2. Data model (Phase 1 collections)
| Collection | Key fields | Indexes |
|-----------|-----------|---------|
| users | name, email (unique, lowercase), passwordHash, systemRole, jobRole, teamIds[], weeklyCapacityHours, active, mustChangePassword, failedLogins, lockedUntil | email (unique), teamIds |
| teams | name (unique), archived | name |
| clients | name (unique), industry, address, notes, active | name |
| clientContacts | clientId, name, department, position, email, phone, notes, active | clientId, email |
| implementationTemplates | templateKey (stable across versions), name, type, version, status, phases[{id, name, order}], activities[{id, phaseId, name, taskType, priority, mandatory, party, defaultJobRole, defaultTeamId, estHours, offsetDays, durationDays, deliverable, requiresApproval, isMilestone, dependsOn[]}], publishedAt, createdBy | (templateKey, version) unique; status |
| projects | name, clientId, managerId, memberIds[], type, status, baselineStart, baselineEnd, baselineHistory[], description, templateSnapshot{templateId, templateKey, version, copy}, computed{progressPct, forecastEnd, scheduleVarianceDays, health, updatedAt} | clientId, managerId, memberIds, status, computed.health |
| tasks | projectId, templateActivityId?, order, name, phase, taskType, priority, mandatory, party, teamId, ownerId, assigneeIds[], clientContactId?, plannedStart, dueDate, estHours, actualHours (denormalized), status, previousStatus, dependsOn[taskId], deliverable, evidence[{type, url/fileKey, name, size, uploadedBy, at}], blockerReason, approval{required, state, reviewerId, decidedBy, decidedAt, comment}, followUps[{authorId, contactId, note, at}], isMilestone | (projectId, status), ownerId, assigneeIds, clientContactId, dueDate |
| timeEntries | userId, projectId, taskId, workDate (date only), hours (decimal 0.25 steps), type, notes, locked | (userId, workDate), (projectId, workDate), taskId |
| activityLogs | actorId, projectId?, entityType, entityId, action, changes[{field, old, new}], reason?, at | (projectId, at), (entityType, entityId) |
| settings | healthThresholds, sessionTimeout, timesheetLockRule, workingDays, holidays | – |

Document management adds `projectFolders` and `documents` (see [10 §7](10_DOCUMENT_MANAGEMENT.md)); `implementationTemplates` gains `defaultFolders[]`. Database is **MongoDB** (confirmed by Lean, 2026-10-09).

Deferred to Phase 2: tickets, projectMilestones (Phase 1 uses `isMilestone` on tasks), aiInsights.

Notes:
- Store hours as integers in quarter-hours (or Decimal128) to avoid floating-point sums.
- Store dates as UTC; `workDate`, `dueDate`, `baseline*` are calendar dates (no time) and must not shift with timezones.
- `actualHours` on tasks is denormalized and updated in the same transaction as time entry writes; a nightly job may verify consistency.
- Plan generation and time-entry writes use MongoDB transactions (replica set required).

## 3. API (indicative)
`/auth/login`, `/auth/logout`, `/auth/me`, `/auth/change-password` · `/users`, `/teams` · `/clients`, `/clients/:id/contacts` · `/templates`, `/templates/:id/versions`, `/templates/:id/publish` · `/projects`, `/projects/:id/generate-plan`, `/projects/:id/activate`, `/projects/:id/rebaseline` · `/projects/:id/tasks`, `/tasks/:id`, `/tasks/:id/status`, `/tasks/:id/approve`, `/tasks/:id/reject`, `/tasks/:id/evidence`, `/tasks/:id/follow-ups` · `/time-entries` · `/dashboard/summary`, `/workload?week=` · `/reports/{effort-variance|overdue|timesheets|project-status}?format=json|csv` · `/projects/:id/activity`.

List endpoints support pagination (`page`, `pageSize` ≤ 100), sorting, and filters. Errors use a consistent shape `{ error: { code, message, details? } }`.

## 4. Authorization (enforced server-side on every request)
| Action | Admin | PM | Member | Viewer |
|--------|:----:|:--:|:------:|:------:|
| Manage users, roles, teams, settings | ✓ | – | – | – |
| Manage clients & contacts | ✓ | ✓ | view (own projects) | view |
| Create/edit/publish templates | ✓ | ✓ (Q-11 resolved: PMs publish) | view | view |
| Create project | ✓ | ✓ | – | – |
| Edit project, plan, dates, estimates, owners, dependencies | ✓ | ✓ (own projects) | – | – |
| Approve/reject tasks | ✓ | ✓ (own projects) | designated reviewer only | – |
| Update status/evidence/notes on own tasks | ✓ | ✓ | ✓ (owner/assignee) | – |
| Log time | ✓ | ✓ | ✓ (member projects) | – |
| View projects | all | all (edit own) | member projects only | all |
| Reports & dashboard | all | all | member projects | all |

"Own projects" = projects where the user is the PM. Whether PMs can edit other PMs' projects is Q-12. Client contacts have no row because they have no access.

## 5. Security
- NFR-01 Passwords hashed with argon2id or bcrypt (cost ≥ 12).
- NFR-02 Session via httpOnly, Secure, SameSite=Lax cookie (or short-lived JWT + refresh in httpOnly cookie). No tokens in localStorage.
- NFR-03 CSRF protection for cookie-based auth; CORS limited to the app origin.
- NFR-04 Input validation on every endpoint; reject unknown fields; protect against NoSQL operator injection (`$` keys).
- NFR-26 **Environments (on hold by Jomerson, 2026-10-09, until more features are added):** staging is a complete copy: its own API app (second app on the existing B1 plan), `pm-staging` database and Blob container; PR branches deploy to staging, `main` to production. Previews show a "Staging" badge in the top bar. QA test accounts exist only in staging; production holds real data and real accounts only (Lean, Queen, UIE, 2026-10-09).
- NFR-25 **Out-of-scope records look non-existent on every method:** for any record outside the user's project scope, GET, PATCH, PUT, POST actions and DELETE all return 404, never 403. 403 is only for records the user can see but lacks the action for. Enforce it in the shared scope check, not per route, with one test that runs every record route as an outsider (DEF-005, DEF-006).
- NFR-05 Rate-limit sign-in and password-reset endpoints per IP (suggested: 20 attempts per 15 minutes, returning 429), in addition to the per-account lockout in FR-AUTH-07. The client IP comes only from a trusted source (the entry Azure appends, or the Vercel middleware header verified by a shared secret); client-supplied forwarding headers are ignored. Keys group by /24 for IPv4 and /56 for IPv6. **Phase 1:** the limiter is in memory, so the App Service is pinned to one instance. **Tech debt (TD-01):** move the limiter and lockout counters to a shared store (for example MongoDB or Redis) before scaling out to more than one instance.
- NFR-06 Evidence files: type and size checks, randomized storage keys, downloads only via authorized signed URLs.
- NFR-07 Secrets in environment variables / secret manager; nothing secret in the React bundle.
- NFR-08 HTTPS only; security headers (Helmet).
- NFR-09 Personal data of client contacts (email, phone) visible only to authorized internal users; consider Philippine Data Privacy Act 2012 obligations (Q-13).

## 6. Performance & scalability
- NFR-10 Dashboard and list pages load in < 2 s (p95) with 200 projects, 20,000 tasks, 200,000 time entries.
- NFR-11 API p95 < 500 ms for single-entity reads/writes.
- NFR-12 CSV export of up to 50,000 rows completes in < 10 s (stream it).
- NFR-13 Project computed fields (progress, forecast, health) recalculate on task/time change; dashboard reads stored values.

## 7. Usability & accessibility
- NFR-14 Responsive: full functionality on desktop ≥ 1280 px; task board, my tasks, and time logging usable on tablet and phone widths (≥ 360 px).
- NFR-15 WCAG 2.1 AA (including 4.5:1 text contrast using the Sneat overrides in THEME_TOKENS.md): keyboard operable (including a keyboard alternative to drag-and-drop on the board), visible focus, contrast, labelled form fields, status not conveyed by color alone.
- NFR-16 English UI; dates formatted per user locale.

## 8. Reliability & operations
- NFR-17 Daily automated DB backups, 30-day retention; restore tested.
- NFR-18 Structured logging with request IDs; no passwords or tokens in logs.
- NFR-19 Health-check endpoint; error monitoring (e.g. Sentry).
- NFR-20 Environments: local, preview per PR (for QA), production. Seed script with example data and the SAP B1 template.
- NFR-21 Target availability 99.5% during business hours (Q-10).

## 9. Quality
- NFR-22 Unit tests for all calculations (progress, variance, overrun, forecast, health, utilization) and permission rules.
- NFR-23 API integration tests for every "(API)" acceptance criterion in 05.
- NFR-24 Lint + type-check + tests run in CI on every PR.

## 10. Phase 2 readiness
- Document permissions are in [10 §5](10_DOCUMENT_MANAGEMENT.md).
- Keep calculations in a backend service module that AI agents can reuse.
- Audit log and time-entry types give Phase 2 agents the facts needed to cite sources for recommendations.
- Design an internal "tools" layer so future AI agents only call authorized, scoped operations.
