# 04 · User Stories (Phase 1)

Format: **As a** role, **I want** goal, **so that** benefit. Acceptance criteria for each story are in 05 with the same number.

## Epic E1 · Access & administration
| ID | Story | FRs | Mockup screen | Pri |
|----|-------|-----|---------------|-----|
| US-01 | As an internal user, I want to sign in with my email and password so that only authorized staff see project data. | AUTH-01..03, 07 | (Login, not in mockup) | Must |
| US-02 | As an Admin, I want to create, edit, and deactivate users with a system role, job role, teams, and capacity so that access and workload are correct. | AUTH-04, 06; USR-01..05 | (Admin, not in mockup) | Must |
| US-03 | As an Admin, I want to manage teams so that work can be assigned and reported by team. | USR-04 | (Admin) | Must |

## Epic E2 · Clients & contacts
| ID | Story | FRs | Mockup screen | Pri |
|----|-------|-----|---------------|-----|
| US-04 | As a PM, I want to record client companies and their contacts so that I know who is responsible for client-side deliverables. | CLI-01, 02 | Client contacts | Must |
| US-05 | As a PM, I want to tag a client contact as responsible on a client task without giving them a login so that I can track client dependencies safely. | CLI-03, 04, 07; TSK-08 | Project detail (task panel) | Must |
| US-06 | As a PM, I want to see each contact's pending and overdue items so that I can follow up with the right person. | CLI-05, 06; DASH-03 | Client contacts, Dashboard | Must |

## Epic E3 · Templates
| ID | Story | FRs | Mockup screen | Pri |
|----|-------|-----|---------------|-----|
| US-07 | As an Admin/PM, I want to build an implementation template with phases, activities, dependencies, estimates, and deliverables so that every project follows our standard method. | TPL-01..03, 07, 09 | Templates | Must |
| US-08 | As an Admin/PM, I want editing a published template to create a new version so that running projects aren't changed. | TPL-04, 05, 10 | Templates | Must |

## Epic E4 · Projects & planning
| ID | Story | FRs | Mockup screen | Pri |
|----|-------|-----|---------------|-----|
| US-09 | As a PM, I want to create a project and generate its plan from a template so that I don't build the checklist by hand. | PRJ-01..04 | New project | Must |
| US-10 | As a PM, I want to review and adjust the generated plan (owners, estimates, dates, contacts) before activating the project so that the plan is realistic. | PRJ-05, 06, 11; TSK-14 | Project detail | Must |
| US-11 | As a PM, I want to see each project's progress, forecast end, schedule variance, and health so that I know which projects need attention. | PRJ-08..10, 13 | Projects, Dashboard | Must |

## Epic E5 · Task execution
| ID | Story | FRs | Mockup screen | Pri |
|----|-------|-----|---------------|-----|
| US-12 | As a team member, I want to see my project's tasks on a board by status and move them as I work so that everyone knows the current state. | TSK-02, 09, 10 | Task board | Must |
| US-13 | As a team member, I want to mark a task Blocked with a reason so that the PM sees what's stopping it. | TSK-03 | Task board, Project detail | Must |
| US-14 | As a team member, I want to attach evidence and submit a task for review so that deliverables are verified. | TSK-05, 07 | Task board, Project detail | Must |
| US-15 | As a PM, I want to approve or reject tasks in For Review so that only verified work counts as complete. | TSK-05 | Task board | Must |
| US-16 | As a PM, I want task dependencies enforced so that work doesn't start before its prerequisites are done. | TSK-04 | Project detail | Must |
| US-17 | As a team member, I want a "My tasks" list across projects so that I know what to do next. | TSK-13 | (not in mockup) | Should |

## Epic E6 · Time
| ID | Story | FRs | Mockup screen | Pri |
|----|-------|-----|---------------|-----|
| US-18 | As a team member, I want to log hours against a task with a type (execution, waiting, rework) so that effort is measured accurately. | TIME-01..03, 07 | Time logging | Must |
| US-19 | As a team member, I want a weekly view of my entries and utilization so that I can check my timesheet before it locks. | TIME-04..06 | Time logging | Must |

## Epic E7 · Visibility & reporting
| ID | Story | FRs | Mockup screen | Pri |
|----|-------|-----|---------------|-----|
| US-20 | As a PM/manager, I want a portfolio dashboard showing delayed projects, overdue tasks, client-pending items, hours, and milestones so that I can act quickly. | DASH-01..06 | Dashboard | Must |
| US-21 | As a PM, I want a team workload view so that I can spot overloaded people before deadlines slip. | WL-01..03 | Team & workload | Must |
| US-22 | As a PM, I want effort variance, overdue, timesheet, and status reports exportable to CSV so that I can report to management and clients. | RPT-01..06 | Reports | Must |
| US-23 | As a PM, I want an activity log of changes on my project so that I can see who changed what and when. | AUD-01..03 | Project detail (Activity log) | Must |

## Epic E8 · Project documents
US-24 to US-32 are in [10 §3](10_DOCUMENT_MANAGEMENT.md).
