# 03 · Functional Requirements (Phase 1)

Priority uses MoSCoW. "Server" means the rule must be enforced by the backend API, not only the UI.

## AUTH · Authentication & session
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-AUTH-01 | Internal users sign in with email + password. | BR-12 | Must |
| FR-AUTH-02 | Passwords are hashed (bcrypt/argon2); minimum **8 characters, including at least one number and one symbol** (Jomerson, 2026-10-09). | BR-12 | Must |
| FR-AUTH-03 | Sessions expire after **30 minutes** of inactivity (Admin-configurable), and after **12 hours** no matter what (absolute cap), even if the user stays active. Sign-out invalidates the session. | BR-12 | Must |
| FR-AUTH-04 | Admin invites users. The system creates a **single-use invite link** that the Admin copies and shares by hand, because email is deferred. The invite expires after 72 hours. The user sets their own password through the link. The token is never sent in a GET path; the page submits it in a **POST body** (Lean, 2026-10-09). | BR-12 | Must |
| FR-AUTH-05 | Password reset: an Admin uses **"Copy reset link"** on the Users list to generate a single-use link that expires after 24 hours, and shares it by hand. Creating a new link cancels any earlier unused one. The sign-in page shows "Forgot your password? Ask an Admin for a reset link." Emailed reset links are **deferred**. As with invites, the token is submitted in a **POST body**, never in a GET path. | BR-12 | Must |
| FR-AUTH-06 | Deactivated users cannot sign in; their history (tasks, time) is preserved. | BR-11 | Must |
| FR-AUTH-07 | Lock the **account** for 15 min after 5 consecutive failed sign-ins on that account (counter resets on success). The lock is **silent**: the response is the same generic 401 as a wrong password, so it never reveals that an account exists (Lean, 2026-10-09). Separately, rate-limit sign-in attempts **per IP address** (see NFR-05). | BR-12 | Must |
| FR-AUTH-08 | No authentication endpoint accepts a client contact identity (server). | BR-05 | Must |

## USR · Users, roles, teams
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-USR-01 | User record: name, email (unique), job role, system role, teams, weekly capacity hours (default 40), active flag. | BR-04 | Must |
| FR-USR-02 | System roles: Admin, Project Manager, Member, Viewer. Permission matrix in 07 §4. | BR-12 | Must |
| FR-USR-03 | Job roles (descriptive): Consultant, Developer, Researcher/BA, Support, QA/Tester, Technical/Data Specialist, Project Manager. | BR-04 | Must |
| FR-USR-04 | Teams (Consulting, Development, Support, QA, Technical…) are admin-managed; a user can be in several teams. | BR-04 | Must |
| FR-USR-05 | Only Admin can change system roles; a user can't change their own role (server). | BR-12 | Must |

## CLI · Clients & client contacts
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-CLI-01 | Client company record: name (unique), industry, address, notes, active flag. | BR-05 | Must |
| FR-CLI-02 | Client contact record (separate collection from users): name, company, department, position, email, phone, notes, active flag, associated projects. | BR-05 | Must |
| FR-CLI-03 | Client contacts have no password, no role, no session, and cannot be converted into a user. | BR-05 | Must |
| FR-CLI-04 | A client contact can be tagged as the responsible client party on a task of a project for the same client only (server). | BR-05 | Must |
| FR-CLI-05 | Contacts list shows pending items count and overdue count per contact. | BR-08 | Must |
| FR-CLI-06 | Internal users can add dated follow-up notes on a task about a client contact. | BR-05 | Must |
| FR-CLI-07 | UI shows a "no login / tracked only" notice wherever contacts are created or tagged. | BR-05 | Must |
| FR-CLI-08 | A contact with open tasks can't be deleted; it can be deactivated, and open tasks are listed for reassignment. | BR-11 | Must |

## TPL · Implementation templates
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-TPL-01 | Template: name, type (SAP B1 / Software-API / Cloud / General IT / Other), description, status (Draft, Published, Archived), version number. | BR-02 | Must |
| FR-TPL-02 | Template contains ordered phases; each phase contains activities. | BR-02 | Must |
| FR-TPL-03 | Template activity fields: name, phase, task type, default priority, mandatory flag, responsible party (Internal/Client), default team/job role, default estimated hours, offset days from project start and duration days, deliverable/evidence description, requires-approval flag, dependencies (other activities in same template). | BR-02 | Must |
| FR-TPL-04 | Editing a Published template creates a new version (v+1) on publish; earlier versions remain readable. | BR-03 | Must |
| FR-TPL-05 | Only Published templates can be used to create projects. | BR-02 | Must |
| FR-TPL-06 | Template list shows activity count, phase count, version, and number of projects using it. | BR-02 | Should |
| FR-TPL-07 | Dependency cycles are rejected on save (server). | BR-02 | Must |
| FR-TPL-08 | Duplicate an existing template as a new Draft. | BR-15 | Should |
| FR-TPL-09 | Seed the "SAP Business One Implementation" template with the 10 blueprint activities (06 §4). | BR-15 | Must |
| FR-TPL-10 | Archived templates can't be used for new projects but remain linked to existing projects. | BR-03 | Must |

## PRJ · Projects
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-PRJ-01 | Create project: name*, client*, project manager*, project type, baseline start*, baseline end* (> start), description/scope, template*. | BR-01 | Must |
| FR-PRJ-02 | On "Generate plan", the system copies the selected template version into the project as a snapshot (template id + version + full activity copy) and creates tasks, dependencies, deliverables, and placeholder assignments. | BR-02, BR-03 | Must |
| FR-PRJ-03 | Generated task dates = baseline start + template offsets (working days, see Q-07); estimates copied from template. | BR-02 | Must |
| FR-PRJ-04 | Before generating, show a preview: number of activities, dependencies, deliverables, and the first activities. | BR-02 | Must |
| FR-PRJ-05 | Project status: Planning, Active, On Hold, Completed, Cancelled. Plan review happens in Planning; PM sets Active. | BR-01 | Must |
| FR-PRJ-06 | Project members: PM plus added internal users; membership controls visibility for Members (server). | BR-12 | Must |
| FR-PRJ-07 | Project detail tabs: Checklist, Timeline (placeholder in P1), Team, Client contacts, Time, Activity log. | BR-01 | Must |
| FR-PRJ-08 | Progress % = completed tasks ÷ (total tasks − cancelled) × 100, rounded to whole %. (Weighted-by-hours option: Q-08.) | BR-08 | Must |
| FR-PRJ-09 | Forecast end = latest of (each incomplete task's due date, or today + remaining duration if overdue). Schedule variance = forecast end − baseline end (days). | BR-09 | Must |
| FR-PRJ-10 | Health is evaluated in order, first match wins: **Delayed** if variance > 5 days or an overdue mandatory task is Blocked; otherwise **At risk** if variance is 1–5 days or **any** task (mandatory or optional) is overdue; otherwise **On track** (variance ≤ 0 and no overdue tasks). Example: variance 0 with one overdue optional task = At risk. Thresholds configurable by Admin. On Hold projects show "On hold" instead of a health value. | BR-08 | Must |
| FR-PRJ-11 | PM can add, edit, or remove tasks in a project after generation without affecting the template. | BR-03 | Must |
| FR-PRJ-12 | Baseline dates can be re-baselined only by PM, with a mandatory reason; previous baseline stored in audit log. | BR-09, BR-11 | Should |
| FR-PRJ-13 | Projects list with filters All / Delayed / At risk / Completed, search, and columns: project, client, manager, baseline end, forecast end, schedule variance, health. | BR-08 | Must |

## TSK · Tasks
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-TSK-01 | Task fields: name*, phase, task type, priority (Low/Medium/High/Critical), mandatory flag, responsible party (Internal/Client), assigned team, accountable owner (one internal user)*, additional assignees (0..n internal users), client contact (required when party = Client), planned start, due date, estimated hours (≥0), actual hours (computed), status, dependencies, deliverable/evidence, blocker reason, approval state, follow-up notes. | BR-04 | Must |
| FR-TSK-02 | Statuses: To Do, In Progress, Blocked, For Review, Completed, (Cancelled). | BR-08 | Must |
| FR-TSK-03 | Moving to **Blocked** requires a blocker reason; leaving Blocked clears it into history. | BR-08 | Must |
| FR-TSK-04 | A task can't move to In Progress or Completed while any predecessor is not Completed, unless PM overrides with a reason (logged). | BR-04 | Must |
| FR-TSK-05 | If requires-approval is set, the task goes to **For Review** instead of Completed; only PM (or a designated reviewer) can approve → Completed or reject → In Progress with a comment. | BR-11 | Must |
| FR-TSK-06 | Mandatory tasks can't be Cancelled by Members; PM can cancel with a reason. | BR-02 | Must |
| FR-TSK-07 | Evidence: attach files or links. Files follow the document rules in FR-DOC-13 (≤ 25 MiB = 26,214,400 bytes; PDF, DOCX, XLSX, PNG, JPG) and are stored as documents in the phase folder (FR-DOC-17). | BR-01 | Must |
| FR-TSK-08 | Client-party tasks: accountable owner is the internal user who follows up; the client contact is tagged as responsible. | BR-05 | Must |
| FR-TSK-09 | Overdue = due date < today and status ∉ {Completed, Cancelled}. Days late shown on cards. | BR-08 | Must |
| FR-TSK-10 | Task board (Kanban) per project with the 5 status columns, drag-and-drop subject to FR-TSK-03/04/05, filter by assignee. | BR-08 | Must |
| FR-TSK-11 | Checklist view: ordered table showing #, activity, owner (and client tag), due, est/act hours, status; shows template snapshot version. | BR-02 | Must |
| FR-TSK-12 | Task detail side panel with all fields, blocker, evidence, follow-up notes, time entries, history. | BR-01 | Must |
| FR-TSK-13 | "My tasks" list across projects for the signed-in user. | BR-04 | Should |
| FR-TSK-14 | Members can update status, evidence, notes, and time on tasks where they're owner/assignee; editing dates, estimates, owner, or dependencies is PM-only (server). | BR-12 | Must |

## TIME · Time logging
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-TIME-01 | Time entry: user (self), project*, task*, work date*, hours* (0.25–24, step 0.25), type (Execution, Waiting on client/external, Rework), notes. | BR-06, BR-07 | Must |
| FR-TIME-02 | Users can only log time to tasks in projects they're a member of (server). | BR-12 | Must |
| FR-TIME-03 | Total hours per user per day can't exceed 24 (server). | BR-06 | Must |
| FR-TIME-04 | Work date can't be in the future; entries older than the lock period (default: previous week after Monday 12:00, see Q-09) are read-only except by PM/Admin. | BR-06 | Must |
| FR-TIME-05 | Weekly view (week selector) of my entries with totals and utilization vs capacity. | BR-06 | Must |
| FR-TIME-06 | Users edit/delete their own unlocked entries; all edits audited. | BR-11 | Must |
| FR-TIME-07 | Task actual hours = sum of all time entries on the task (all types); reports also show by type. | BR-06, BR-07 | Must |
| FR-TIME-08 | Time can't be logged on Cancelled tasks or on projects that are On Hold, Completed, or Cancelled (server). | BR-06 | Must |

## DASH · Dashboard, workload & reports
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-DASH-01 | KPI cards: Active projects, Delayed projects, Overdue tasks (with count waiting on client), Hours this week (with team utilization %). | BR-08 | Must |
| FR-DASH-02 | Active projects table: project, client, template, progress, health, go-live (baseline end / milestone). | BR-08 | Must |
| FR-DASH-03 | "Waiting on client" list: open client-party tasks sorted by due date, showing contact, company, and days overdue/due. | BR-05, BR-08 | Must |
| FR-DASH-04 | Upcoming milestones (next 30 days): milestone-type tasks or tasks flagged as milestone. | BR-08 | Should |
| FR-DASH-05 | AI insights panel is a visible "Phase 2" placeholder only. | BR-14 | Could |
| FR-DASH-06 | Dashboard data respects visibility: PM/Admin/Viewer see all; Members see their projects. | BR-12 | Must |
| FR-WL-01 | Team & workload table for a selected week: person, job role, team, assigned hours (remaining estimates of tasks due that week), recorded hours, utilization. | BR-08 | Must |
| FR-WL-02 | Utilization = recorded working hours ÷ available hours (capacity) × 100. Assigned load % shown separately and flagged > 100%. | BR-08, BR-13 | Must |
| FR-WL-03 | Workload view shows waiting time separately and carries the note that hours aren't a performance score. | BR-13 | Must |
| FR-RPT-01 | Effort variance report per task/project: estimated, actual, variance (act − est), overrun % ((act − est) ÷ est × 100; "No estimate" when est = 0). | BR-06 | Must |
| FR-RPT-02 | Overdue tasks report with filters (project, client, owner, party, date range). | BR-08 | Must |
| FR-RPT-03 | Timesheet report by user/project/date range, with totals by entry type. | BR-06, BR-07 | Must |
| FR-RPT-04 | Project status report: progress, health, baseline vs forecast, overdue, blocked, pending client items. | BR-10 | Must |
| FR-RPT-05 | Every report exports to CSV with the current filters. | BR-10 | Must |
| FR-RPT-06 | Empty states explain how to widen filters. | BR-10 | Should |

## AUD · Audit trail
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-AUD-01 | Log who, when, entity, field, old value, new value for: task owner/assignees, dates, estimates, status, approvals, dependencies, project status/baseline, role changes, time-entry edits/deletes, overrides. | BR-11 | Must |
| FR-AUD-02 | Project "Activity log" tab shows the project's audit entries, newest first, filterable. | BR-11 | Must |
| FR-AUD-03 | Audit entries are append-only; no UI or API can edit or delete them. | BR-11 | Must |

## GEN · General
| ID | Requirement | BR | Pri |
|----|-------------|----|-----|
| FR-GEN-01 | Global search across projects and tasks the user can see. | BR-01 | Should |
| FR-GEN-02 | All dates display in the user's timezone (default Asia/Manila; Q-07). | BR-01 | Must |
| FR-GEN-03 | All forms show inline validation errors as in the mockup (e.g. "End date must be after the start date."). | BR-01 | Must |

## DOC · Project document management
FR-DOC-01 to FR-DOC-43 are in [10 §2](10_DOCUMENT_MANAGEMENT.md). The project detail tabs (FR-PRJ-07) gain a **Documents** tab, and the template editor gains default folders (FR-DOC-02).
