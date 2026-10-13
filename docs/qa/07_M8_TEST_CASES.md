# Test cases: Milestone 8 (doc 14 v1.1.1, doc 11 v0.4.8, mockup v0.9.2)
M8 covers Project types, Jomerson's tracker/leave feedback, Reports and Team & workload access rows, audit NFRs, the OpsTrack rename, and targeted retests. All times are Philippine time. "API" cases call the backend directly.

## Project Type (FR-PTY-01 to 07)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T01 | Fresh deploy: Admin › Settings › Project types | Nine seeded types with defaults: Implementation → Configuration, Integration → Integration, Configuration → Configuration, Development → Development, Support → Support, Upgrade → Configuration, Migration → Data migration, Training → Training, Consulting → Client meeting | FR-PTY-01, Q-51 |
| TC-T02 | Admin adds "  Pilot  ", "Pilot", "pilot", blank, and a 51-character name | Trimmed "Pilot" saved once; duplicate (any case) refused (409); blank shows "Add a name."; over-length refused ("Keep the name under 50 characters."). Each successful change is audited | FR-PTY-01 |
| TC-T03 | Admin renames, deactivates an in-use type, deletes an unused type, and tries to delete an in-use type | Rename updates live screens and new reports; saved DARs keep the old name. In-use type can only be deactivated (not deleted). Unused type deletes. Deactivated type stays on its projects with an (inactive) tag and is absent from the new-project picker | FR-PTY-01, -02, -06 |
| TC-T04 | PM, Member and Viewer open Project types or call the manage API | Menu hidden; API 403 | FR-PTY-01, -07 |
| TC-T05 | New project with no type; edit a pre-types project showing "Not set" | Create refused ("Choose a project type."). Existing project shows "Not set" and can't save until a type is picked (required on that edit). No automatic guess | FR-PTY-02, -03, Q-50 |
| TC-T06 | Time in / + Add entry on: Implementation task; Legacy with inactive default; Not-set project; type with blank default; Quick activity | Implementation preselects Configuration with hint "From project type"; user can change it. The other four leave Activity type blank (no dead value). Quick activity never preselects | FR-PTY-04 |
| TC-T07 | Change a project's type (or a type's default), then open an existing entry from before the change | Entry's Activity type unchanged. New Time in uses the new default | FR-PTY-05 |
| TC-T08 | Project list filter, dashboard project table and project-status report | Project type column/filter present; inactive types tagged; Not set shown where empty | FR-PTY-07 |

## Jomerson's M8 feedback (FR-ACT-26 to 28, FR-LV-12/13, NFR-27)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T09 | Time in on task B while task A runs (UI); two concurrent Time in calls (API) | UI asks "Stop '{task}' and start this one?" with Switch and Cancel. Switch stops A at the current time then starts B. Concurrent second start returns 409 `TIMER_RUNNING`; only one running | FR-ACT-26, FR-ACT-03, DEF-009 |
| TC-T10 | Day timesheet and Time logging as member@; GET/PATCH another user's entry by ID; PM timesheet review; Admin reopen | Own entries only. Other users' entries return 404. PM review and Admin reopen of others' time still work | FR-ACT-27, NFR-25 |
| TC-T11 | Save an entry with Module over 100 characters and with a missing required field | Errors show under the field (e.g. "Keep the module under 100 characters."); top banner only for server/network problems. API returns a per-field error list | FR-ACT-28 |
| TC-T12 | Day timesheet on a Vacation full day and on a Half day AM | Grey leave row at the top ("Vacation · Full day" or "Half day AM/PM"). + Add leave sits next to + Add entry and opens the file-leave form for that date | FR-LV-12 |
| TC-T13 | Admin changes entitlement and carry-over (success and forced failure) | No Save button. Each change shows "Saving…" then "Saved ✓". On failure the old value returns with "Couldn't save. Try again." Every change is audited | FR-LV-13 |
| TC-T14 | Short viewport / small screen: scroll the left navigation | Sidebar scrolls on its own; every menu item is reachable | NFR-27 |

## Access rules: Reports and Team & workload (FR-ACL-14 to 17)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T15 | Access rules grid as Admin | Two new rows: Reports (`reports`) with View plus Export under View; Team & workload (`workload`) with View only. Create, Edit and Delete show "n/a". Unticking Reports View clears Export; Export can't be on without View | FR-ACL-14 |
| TC-T16 | Fresh migration: Admin, PM, Member, Viewer | Starting Reports View/Export and Team & workload View match each role's access today exactly (nobody gains or loses until an Admin changes them) | FR-ACL-15 |
| TC-T17 | Role without Reports View / Export / workload View calls `/reports/*`, `?format=csv` and `/workload`; same role browses the menu | API 403. Menu hides what's not allowed. Changing a cell is audited | FR-ACL-16 |
| TC-T18 | Admin (or any role) opens another user's saved DAR and its export | 404. Reports permission never opens someone else's saved Daily Accomplishment Report | FR-ACL-17, FR-DAR-14 |

## Audit (NFR-28, NFR-29)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T19 | Timer left running past 23:59 PHT (auto-stop) | Audit record with actor "System", the entry ID, the stop time and `autoStopped: true` | NFR-28, FR-ACT-04, TC-Q03 |
| TC-T20 | User action (e.g. Time in) then open the audit log as Admin and as Member | Record stores client IP (trusted source, NFR-05) and user agent. Only Admins see IP and browser details | NFR-29 |

## OpsTrack rename
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T21 | Screens, browser tab title, PDF/Excel exports, invite page and set-password page | No leftover "Project Activity Tracker" / old product name. Branding, titles and copy say OpsTrack | FR-DAR-08, mockup v0.9.2 |
| TC-T22 | Open a DAR saved before the rename (e.g. before 2026-10-10); generate a new preview/export | Old saved copy keeps footer "Generated by Project Activity Tracker Application". New reports say "Generated by OpsTrack." | FR-DAR-08, FR-DAR-15 |

## Retests
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T23 | Clear Module on a pre-migration entry (spaces or blank), then restart the API (or re-run the module migration) | Module stays blank / "–". Old name must not come back (DEF-010) | DEF-010, FR-ACT-20, FR-ACT-21 |
| TC-T24 | Module of 100 emoji; Module of 101 emoji | 100 emoji save (emoji counts as one). 101 refused with "Keep the module under 100 characters." (UI and API) | FR-ACT-20 |
| TC-T25 | Start a timer at xx:xx:45, stop at yy:yy:20; day already near 24h | Start and end saved rounded down to the whole minute; shown times and HH:MM duration agree. Day total still refuses above 24h. Auto-stop still ends at exactly 23:59 | DR-45, FR-TIME-03, FR-ACT-04 |
| TC-T26 | Leave a timer running overnight on a QA-only account (no manual stop) | Auto-stops at exactly 23:59 PHT, flagged "Auto-stopped – please check", `autoStopped: true`. No entry spans midnight | TC-Q03, FR-ACT-04, EC-75 |
| TC-T27 | Member (or PM) opens a locked/submitted day with entries | No Edit or Delete; lock icon with tooltip "Locked. Ask an Admin to reopen this day." API create/edit/delete returns 422 `DAY_LOCKED` | FR-ACT-24 |

## M8 polish (doc 14 v1.2.1, doc 11 v0.4.10, mockup v0.9.3)
Covers FR-PRJ-21 to 26, FR-TSK-26 to 30, FR-NAV-01/02, FR-ACT-29 to 33, FR-ACL-18 to 21, NFR-30 to 32, EC-81 to 93. Each case is marked **[API]** or **[UI]**. "PM" = the project's assigned manager or a global PM on the project team. "On the team" = the project team list only (PM, members, Viewers); client contacts don't count. ⚑ = depends on an open question (Q-57, Q-58, Q-59, Q-62, Quick Activity billable default); re-check when it is answered. The Lead's and Rich's decisions here override the spec text where the two differ.

### Checklist delete and phase edit (FR-PRJ-21 to 23, FR-ACL-19, EC-81 to 83)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T28 | [UI] Project PM, Member, Viewer, PM of another project and Admin open an activity's ⋮ menu (Planning project, then Active) | Delete shows for the project PM (Planning only) and Admin (any status). Hidden for Member, Viewer and other-project PM | FR-PRJ-21, FR-ACL-19 |
| TC-T29 | [API] `DELETE /projects/:id/tasks/:taskId` as Member on the team; PM who can view but doesn't manage X; Member not on X | 403 `FORBIDDEN`; 403; 404 (no project name in body) | FR-PRJ-21, AC-46.1, AC-46.2, NFR-25 |
| TC-T30 | [UI+API] Project PM deletes an activity with nothing recorded (Planning project); Admin deletes one on an Active project | Removed, audit entry written for each. PM delete on an Active project → 422 `PROJECT_NOT_PLANNING` | FR-PRJ-21, AC-46.3 |
| TC-T31 | [UI+API] PM or Admin tries to delete an activity that has logged time (also try evidence, document, issue) | Blocked with an inline message on the row/dialog (no generic toast); API 422; activity and time stay | FR-PRJ-21, AC-46.3 |
| TC-T32 | [UI+API] Project PM edits phase name, order, planned dates, description, and adds and removes a phase on a Planning project | All save; each change audited | FR-PRJ-22, AC-47.1 |
| TC-T33 | [UI+API] Same PM on Active, On Hold, Completed, Cancelled projects: edit name/order/dates, add a phase, remove a phase | No phase Edit/Add/Remove controls; read-only message. `PATCH /projects/:id/phases/:phaseId` (and add/remove) → 422 `PROJECT_NOT_PLANNING` "Phase details can only be changed while the project is in Planning." | FR-PRJ-23, FR-ACL-19 |
| TC-T34 | [UI+API] PM on an Active project adds a new activity (task) to a phase, and edits a task | Allowed (adding activities and task-level edits aren't locked by phase rules) | FR-PRJ-23, FR-PRJ-20 |
| TC-T35 | [UI+API] Admin edits phase details, adds and removes phases on Active, On Hold, Completed, Cancelled projects | Saves at any status; audited | FR-PRJ-22, FR-PRJ-23 |
| TC-T36 | [UI] Status changes Planning → Active (another session) while the PM has a phase form open; PM saves | Save returns 422; form switches to the read-only message; nothing saved | EC-82 |
| TC-T37 | [API] PM handover mid-session: old PM sends Delete and phase edit; new PM reloads | Old PM 403 (or 404 if no longer on the team); new PM sees the controls after reload | EC-81 |
| TC-T38 | [UI+API] Project with no PM set (data fix in QA DB) | Only Admin can delete activities and edit phases; project shows the "no PM" flag | EC-83 |

### Planned date on My tasks (FR-TSK-26, FR-TSK-27, NFR-30, EC-84)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T39 | [API] `GET /my-tasks?tab=today`, `due`, `assigned` for tasks with and without `plannedStart` | Each item has `plannedStart` as `YYYY-MM-DD` (Philippine date) or `null`. A start of 13 Oct 00:30 PHT (12 Oct UTC) returns `2026-10-13` | NFR-30 |
| TC-T40 | [UI] Desktop Today, Due, Assigned to me | Planned column after task name, before Due; same short format as Due; no time of day. Not on I'm accountable, To review, Completed | FR-TSK-26, FR-TSK-27 |
| TC-T41 | [UI] Task with no planned date on each of the three tabs, desktop and phone card | Planned date is omitted (blank cell / no field on the card), not "–" and no "No planned date" text | FR-TSK-27 (Rich: omit) |
| TC-T42 | [UI] Sort Assigned to me by Planned date ascending and descending | Sorts by date; tasks without a planned date sort last both ways | FR-TSK-26, FR-TSK-27 |
| TC-T43 | [UI] Task whose planned start is after its due date | Shown as stored, no error; task form validation unchanged | EC-84 |
| TC-T44 | [UI] Mobile app task cards on the three tabs | Planned date shown when set, omitted when empty, same format | FR-TSK-27 |

### Team-scoped projects (FR-PRJ-24 to 26, FR-ACL-18, EC-85 to 87)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T45 | [API] `GET /projects` as PM, Member and Viewer each on 2 of 5 projects; as Admin | Non-Admins get only their 2 (totals, filter counts, pagination only count them); Admin gets all 5 | FR-PRJ-24, FR-ACL-18, Q-57⚑, Q-58⚑ |
| TC-T46 | [API] Task board endpoint (`GET /tasks/board` or equivalent) for the same users | Same scope as TC-T45 | FR-PRJ-24, Q-57⚑, Q-58⚑ |
| TC-T47 | [UI+API] Project pickers in Log time (Log task time) and Create task | Only team projects listed for non-Admins; Admin sees all. Posting a time entry or task on a non-team project by ID → 404 | FR-PRJ-24 (Lead) |
| TC-T48 | [API] Viewer on a project team vs Viewer not on it; client contact for the project | Viewer on team sees it read-only; Viewer not on team gets 404; client contact status doesn't add the project | FR-ACL-18, Q-58⚑ |
| TC-T49 | [API] Non-team user calls every method on `/projects/:id` and sub-records (checklist, phases, tasks, board, documents, time, issues, conversation) | 404 everywhere; body doesn't reveal name or existence (same as a random ID) | FR-PRJ-25, NFR-25 |
| TC-T50 | [UI] Non-team user opens a project URL (web and mobile) | Standard Not found page/screen; no project name in title or breadcrumb | FR-PRJ-25 |
| TC-T51 | [API] Grant a role wider project View in Access rules | Non-Admin scope still team-only (grant can't widen it) | FR-ACL-18 |
| TC-T52 | [UI] User removed from a team while viewing that project | Next request 404; app returns to Projects list | EC-85 |
| TC-T53 | [UI] Archived filter as non-Admin | Only archived projects they were on the team of | EC-86 |
| TC-T54 | [UI] User's own time entries on a project they've left | Still listed in Day timesheet/Time logging; project link opens Not found | EC-87, Q-60⚑ |
| TC-T55 | [API] Dashboard, reports, Team & workload, client Projects tab as non-Admin | Record actual behaviour; expected (proposed) team scope only, no names of other projects | FR-PRJ-26, Q-57⚑, Q-58⚑, Q-59⚑ |
| TC-T56 | [UI+API] '+ New project' and '+ Task' for a PM role with Create removed, and a Member role with Create granted | Buttons follow the Create permission, not the role; API 403 without Create | FR-ACL-18 (Rich) |

### Setup hiding (FR-NAV-01, FR-NAV-02, FR-ACL-20, EC-88, EC-93)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T57 | [UI] Web: role with View on only one Setup child (from its Access rules); role with none | First: Setup shows with only that child. Second: whole Setup group (header too) hidden | FR-NAV-01, FR-ACL-20 |
| TC-T58 | [API] Direct URL/API to a hidden Setup child | 404 (not 403); hiding isn't the control | FR-NAV-02 |
| TC-T59 | [UI] Admin removes the last Setup child permission from a role; affected user reloads (no sign-out) | Setup disappears on next load; restoring shows it with default expanded state even if it was saved collapsed | EC-93, EC-88, FR-ACL-06 |
| TC-T60 | [UI] Mobile app for a role with no Setup children | No change required (hiding Setup is web-only); any Setup screens still return 404/403 from the API | FR-NAV-01 (Lead) |

### My tasks tabs (FR-TSK-28 to 30, FR-ACL-20, EC-89)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T61 | [UI] Role without `time` View opens My tasks (Today denied too via custom role) | Denied tabs hidden; selection moves to the next allowed tab to the right, wrapping round (Lead rule; replaces "first allowed") | FR-TSK-28, FR-ACL-20 |
| TC-T62 | [UI] Default Viewer opens My tasks | No time features (no Day timesheet, no logging buttons); lands on Due | FR-TSK-28 (Rich) |
| TC-T63 | [UI] Deep link `?tab=day-timesheet` without `time`; `?tab=to-review` without approvals Edit with only Today allowed (wrap); unknown key | Opens next allowed tab to the right (wrapping), URL replaced (Back doesn't loop), dismissible "You don't have access to that view." | FR-TSK-30 |
| TC-T64 | [UI] Role with no My tasks tab allowed | My tasks hidden from sidebar (Lead; replaces FR-TSK-29 empty state); sign-in lands elsewhere without error | FR-TSK-29 (Lead), Q-61 |
| TC-T65 | [UI] Admin removes the user's permission while they're on that tab | Next request 403; page re-selects per TC-T61 | EC-89 |
| TC-T66 | [API] `GET /api/v1/me/permissions` for Admin, PM, Member, Viewer and a custom role | Returns role, per-record actions (incl. Reports Export), `navigation.setup` children, `myTasksTabs` in display order with `allowed`. Change a rule → next call reflects it | NFR-32, FR-ACL-21 |

### Log task time and Add quick activity (FR-ACT-29 to 33, NFR-31, EC-90 to 92)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T67 | [UI] Time logging and My tasks › Day timesheet headers; tracker | 'Log task time' (primary) and 'Add quick activity' (secondary). They replace '+ Add entry', and 'Add quick activity' replaces the tracker's '+ Quick activity' | FR-ACT-29, Q-62⚑ |
| TC-T68 | [UI] Log task time on a Configuration-default project task | Manual entry form, project → task picker; Activity type Configuration, hint "From project type" | FR-ACT-30, AC-52.2 |
| TC-T69 | [UI] Add quick activity on an unlocked day | Form, no project; Activity type preselected "Quick Activity" (by key); user can change it and save | FR-ACT-31, AC-52.1, EC-91 |
| TC-T70 | [UI+API] Billable default on a new quick activity | Record value; proposed No (not billable) | FR-ACT-31, Quick Activity billable⚑ |
| TC-T71 | [API] `GET /settings/activity-types` | Quick Activity has `key: "quick_activity"`, `system: true`; Admin-made types `key: null` | NFR-31, FR-ACT-32 |
| TC-T72 | [UI+API] Admin tries to deactivate or delete Quick Activity; tries to set it as a Project type default | Refused, 422 `SYSTEM_ACTIVITY_TYPE`; "System" tag shown. Note: mockup v0.9.3 still shows Deactivate on this row (report as UI defect) | FR-ACT-32 |
| TC-T73 | [API] Re-run seed migration; DB with an Admin type "quick activity" | One system type only; existing type is linked to the key (no duplicate) | FR-ACT-32, EC-90, Q-63 |
| TC-T74 | [UI+API] Existing quick activities after release; change a quick entry's type away from Quick Activity | Old entries unchanged (no backfill); changed entry stays a quick activity with no project | Q-63 (Lead), EC-91 |
| TC-T75 | [API] Old mobile client posts a quick activity with no Activity type | 400 (required), no silent default | EC-92 |
| TC-T76 | [UI+API] Both buttons with a date in the future | Future dates can't be picked; API refuses future-dated entries | FR-ACT-33 (Lead) |
| TC-T77 | [UI+API] Timer running, user saves a manual entry via either button overlapping the timer; then picks "start timer" where offered | Manual save doesn't start/stop a timer; overlap rule applies. Start timer shows Switch/Cancel prompt; direct second start → 409 `TIMER_RUNNING` | FR-ACT-33, FR-ACT-26, AC-52.4 |
| TC-T78 | [UI+API] Member/PM on a submitted or locked day | Both buttons disabled with tooltip "Locked. Ask an Admin to reopen this day."; `POST /tracker/entries` → 422 `DAY_LOCKED`. Admin buttons enabled | FR-ACT-33, AC-52.3, FR-ACT-24 |
| TC-T79 | [UI] Admin reopens the locked day; Member reloads | Buttons enabled again; entries can be added | FR-ACT-33, FR-ACT-24 |
| TC-T80 | [UI+API] Entry via either button that pushes the day over 24h, or on an On Hold project task | Refused as today (24h cap, On Hold rule) | FR-ACT-33 |
| TC-T81 | [UI] Mobile app: both buttons, same preselects and error messages for 409 `TIMER_RUNNING`, 422 `DAY_LOCKED`, 422 `PROJECT_NOT_PLANNING` | Matches web | FR-ACT-29 to 33 |
