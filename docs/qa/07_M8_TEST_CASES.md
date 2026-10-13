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

## M8 polish (doc 14 v1.2.2, doc 11 v0.4.11 — not yet on the box (with Rich); mockup v0.9.4)
Covers FR-PRJ-21 to 26, FR-TSK-26 to 30, FR-NAV-01/02, FR-ACT-29 to 33, FR-ACL-18 to 21, NFR-30 to 32, EC-81 to 93. Each case is marked **[API]** or **[UI]**. "Project PM" = the assigned manager, or an Access-role PM on the project's team list. "On the team" = the team list only (PMs, members, Viewers); client contacts and reviewers not on the list don't count. ⚑ = depends on an open question (Q-53, Q-55, Q-57, Q-58, Q-59, Q-60, Q-62, Q-64, Q-65, Q-66 (EC-90, assumption A-21)); re-check when it's answered. New cases TC-T82 to TC-T88 sit in their topic groups, so IDs are stable but not in strict order.

### Checklist delete and phase edit (FR-PRJ-21 to 23, FR-ACL-19, EC-81 to 83)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T28 | [UI] Project PM, Member, Viewer, PM of another project and Admin open an activity's ⋮ menu on Planning and Active projects | Delete shows for the Project PM and Admin at any status. Hidden for Member, Viewer and other-project PM | FR-PRJ-21, FR-ACL-19 |
| TC-T29 | [API] `DELETE /projects/:id/tasks/:taskId` as Member on the team; PM who can view X but isn't its Project PM; Member not on X | 403 `FORBIDDEN`; 403; 404 (body doesn't reveal the project). No audit entry for any refused call | FR-PRJ-21, NFR-25 |
| TC-T30 | [UI+API] Project PM deletes an activity with nothing attached (Planning and Active); Admin does the same on a Completed project | Confirm dialog opens; on confirm the activity is removed and exactly one audit entry is written | FR-PRJ-21, AC-46.4, AC-46.5 |
| TC-T31 | [UI+API] Delete an activity with logged time, documents and issues attached (seeded in a different order) | 409 `ACTIVITY_IN_USE`, `details.blockedBy: ["time","documents","issues"]` (fixed order). No confirm dialog; nothing changes; no 422; **no audit entry**. One inline red message (#b8240a) under the row, same on web and mobile: "Can't delete: this activity has logged time, documents and issues." | FR-PRJ-21, FR-ACL-19, AC-46.6 |
| TC-T82 | [UI+API] Delete blocked by logged time only | 409, `blockedBy: ["time"]`; "Can't delete: this activity has logged time." | FR-PRJ-21 |
| TC-T83 | [UI+API] Delete blocked by evidence only; by documents only; by issues only | 409 with `["evidence"]` / `["documents"]` / `["issues"]`; "Can't delete: this activity has evidence files." / "…has documents." / "…has issues." | FR-PRJ-21 |
| TC-T84 | [UI+API] Delete blocked by time and evidence | `["time","evidence"]`; "Can't delete: this activity has logged time and evidence files." (no comma before "and") | FR-PRJ-21, AC-46.3 |
| TC-T85 | [UI+API] Delete blocked by all four | `["time","evidence","documents","issues"]`; "Can't delete: this activity has logged time, evidence files, documents and issues." (no Oxford comma, full stop) | FR-PRJ-21 |
| TC-T86 | [UI+API] Admin deletes a blocked activity on Planning and on Completed projects; then the blocker is removed and the delete retried | Admin gets the same 409 `ACTIVITY_IN_USE` and message (the Admin exemption covers only the Planning lock); no audit entry. After clearing, confirm dialog opens, delete succeeds, one audit entry | FR-PRJ-21, Deven |
| TC-T32 | [UI+API] Project PM renames, reorders, redates, adds and deletes a phase on a Planning project | All save; each change audited | FR-PRJ-22, AC-47.1 |
| TC-T33 | [UI+API] Same PM on Active, On Hold, Completed, Cancelled: rename, reorder, redate, add, delete a phase; edit the phase description | Controls hidden; direct API → 422 `PROJECT_NOT_PLANNING` "Phase details can only be changed while the project is in Planning." Description: expected locked too (proposed) | FR-PRJ-23, AC-47.2, Q-53⚑ |
| TC-T34 | [UI+API] PM on an Active project adds an activity and edits one | Both allowed (activities aren't locked by status) | FR-PRJ-23, FR-PRJ-20, Q-64⚑ |
| TC-T35 | [UI+API] Admin renames, redates, adds and deletes phases on Active, On Hold, Completed, Cancelled projects | Saves at any status; audited | FR-ACL-19, AC-47.3 |
| TC-T36 | [UI] Status changes Planning → Active (another session) while the PM has a phase form open; PM saves | 422; form shows the read-only message; nothing saved | EC-82 |
| TC-T37 | [API] PM handover, and PM removed from the team, mid-session: old PM sends delete and phase edit; new PM reloads | Old PM 403 (handover, still on team) or 404 (removed); new PM has the controls after reload | EC-81 |
| TC-T38 | [UI+API] Project with no manager set (QA DB fix) | Team-list PMs and Admins can still delete activities and (in Planning, or any status for Admin) edit phases | EC-83 |
| TC-T87 | [UI+API] Active project moved back to Planning; PM edits a phase | Expected (proposed): editing reopens and saves | Q-55⚑ |

### Planned date on My tasks (FR-TSK-26, FR-TSK-27, NFR-30, EC-84)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T39 | [API] `GET /my-tasks?tab=today`, `due`, `assigned` for tasks with and without `plannedStart` | Each item has `plannedStart` as `YYYY-MM-DD` (Philippine date) or `null`. A start of 13 Oct 00:30 PHT (12 Oct UTC) returns `2026-10-13` | NFR-30 |
| TC-T40 | [UI] Desktop Today, Due, Assigned to me | Planned column after task name, before Due; exactly the same short format as Due on that screen; no time of day. Not on I'm accountable, To review, Completed | FR-TSK-26, FR-TSK-27 |
| TC-T41 | [UI] Task with no planned date on the three tabs: table and phone card | Table cell blank; card omits the field (no label, no "–", no placeholder) | FR-TSK-27 |
| TC-T42 | [UI] Sort Assigned to me by Planned date, ascending and descending | Sorted by date; tasks without one last both ways | FR-TSK-26, FR-TSK-27 |
| TC-T43 | [UI] Planned start after due date | Shown as stored, no error; validation unchanged | EC-84 |
| TC-T44 | [UI] Mobile app task cards on the three tabs | Planned date in the Due format when set; omitted when empty | FR-TSK-27 |

### Team-scoped projects (FR-PRJ-24 to 26, FR-ACL-18, FR-ACL-20, EC-85 to 87)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T45 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [API] `GET /projects` as PM, Member and Viewer each on 2 of 5 team lists; Admin on none | Non-Admins get only their 2 (totals, filter counts, pagination in scope); Admin gets all 5 | FR-PRJ-24, AC-49.3, AC-49.5, Q-57⚑, Q-58⚑ |
| TC-T46 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [API] Task board endpoint for the same users | Same scope as TC-T45 | FR-PRJ-24, Q-57⚑, Q-58⚑ |
| TC-T47 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [UI+API] Project pickers in Log task time and Create task | Team projects only for non-Admins; Admin all. Posting time or a task to a non-team project ID → 404 | FR-PRJ-24, FR-ACT-30, AC-49.5 |
| TC-T48 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [API] Viewer on A's team list; Viewer not on it; client contact of A; reviewer not on the list | Only the Viewer on the list sees A (read-only); the others don't, and direct access → 404 | FR-ACL-18, AC-49.4, Q-58⚑ |
| TC-T49 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [API] Non-team user calls every method on `/projects/:id` and sub-records (checklist, phases, tasks, board, documents, time, issues, conversation) | 404 everywhere; same body as a random ID | FR-PRJ-25, NFR-25 |
| TC-T50 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [UI] Non-team user opens a project URL (web and mobile) | Standard Not found page/screen; no project name anywhere | FR-PRJ-25 |
| TC-T51 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [API] Grant a role wider project View in Access rules | Scope still team-only for non-Admins | FR-ACL-18 |
| TC-T52 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [UI] User removed from the team while viewing that project | Next request 404; app returns to Projects | EC-85 |
| TC-T53 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [UI] Archived filter as non-Admin | Only archived projects on their team lists | EC-86 |
| TC-T54 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [UI] User's own past time on a project they've left | Still listed in their timesheet; project link disabled (not clickable); direct URL → 404 | EC-87, Q-60⚑ |
| TC-T55 | ~~DROPPED Oct 13 (Jomerson: no team-only filter; today's visibility stays)~~ [API] Dashboard, reports, Team & workload, client Projects tab as non-Admin | Record actual behaviour; proposed team scope only, no other project names | FR-PRJ-26, Q-57⚑, Q-58⚑, Q-59⚑ |
| TC-T56 | [UI+API] '+ New project' and '+ Task' for a PM role with Create removed, and a Member role with Create granted; check `/me/permissions` flags | Buttons follow Create on `projects` / `tasks`, not the role; flags match; API 403 without Create | FR-ACL-20, NFR-32 |

### Setup hiding (FR-NAV-01, FR-NAV-02, FR-ACL-20, EC-88, EC-93)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T57 | [UI] Web: for each Setup item, a role with only that key: Templates `templates.view`; Clients `clients.view`; Team & workload `workload.view`; Reports `reports.view`; Admin via `users.view`, then `teams.view`, then `settings.view`; Access rules `accessRules.view`. Then a role with none | Setup shows with only the matching item (Admin appears for any one of its three keys). With none of the keys, the whole Setup group (header too) is hidden and `/me/permissions` lists no Setup children | FR-NAV-01, FR-ACL-20, AC-50.3, Deven |
| TC-T58 | [API] Direct URL/API to each hidden Setup item (e.g. Reports without `reports.view`; Admin with none of `users.view`/`teams.view`/`settings.view`) | 404; hiding isn't the control | FR-NAV-02 |
| TC-T59 | [UI] Admin removes the last of the Setup keys from a role; user reloads (no sign-out) | Setup disappears on next load; granting any one key back shows it in default expanded state even if saved collapsed | EC-93, EC-88 |
| TC-T60 | [UI] Mobile app for a role with none of the Setup keys | No Setup change (web only); Setup APIs still refuse | FR-NAV-01, FR-ACL-20 |

### My tasks tabs (FR-TSK-28 to 30, FR-ACL-20, NFR-32, EC-89)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T61 | [UI+API] Tab order and keys: Today (`tasks.view` **and** `time.view`), Day timesheet (`time.view`), Due, Assigned to me, I'm accountable (`tasks.view`), To review (`approvals.edit`), Completed (`tasks.view`). Roles: `tasks.view`+`time.view`; `tasks.view` only; `time.view`+`approvals.edit`; `time.view` only with Completed selected; `tasks.view` only with Day timesheet selected | Only allowed tabs show. `/me/permissions` `myTasksTabs` (allowed keys, tab order) and `defaultTab`: `[today, day-timesheet, due, assigned, accountable, completed]`/`today`; `[due, assigned, accountable, completed]`/`due`; `[day-timesheet, to-review]`/`day-timesheet`; `[day-timesheet]`/`day-timesheet`. Blocked selections go to the next allowed tab on the right, wrapping: Completed → Day timesheet; Day timesheet → Due | FR-TSK-28, AC-51.2, NFR-32 |
| TC-T62 | [UI+API] Default Viewer (no `time.view`) opens My tasks without a tab; same Viewer given `time.view`; Viewer with `tasks.view` removed | No special Viewer rule: lands on Due (`defaultTab: "due"`, `myTasksTabs` without `today`/`day-timesheet`); with `time.view` lands on Today (`"today"`); without `tasks.view` and `time.view`, see TC-T64 | FR-TSK-28, AC-51.4 |
| TC-T63 | [UI] Deep link `?tab=today` with `tasks.view` but no `time.view`; `?tab=day-timesheet` without `time.view`; `?tab=to-review` without `approvals.edit`; unknown key | Next allowed tab on the right (Due; Due; Completed), wrapping; URL replaced (Back doesn't loop); `myTasksTabs` unchanged by the link; notice "You don't have access to that view." | FR-TSK-30, AC-51.1 |
| TC-T64 | [UI+API] Role with no allowed tab: none of `tasks.view`, `time.view`, `approvals.edit` (web and mobile) | My tasks hidden; its URL shows Not found; sign-in lands on the next page they can open in sidebar order. `/me/permissions` still includes both fields: `defaultTab: null`, `myTasksTabs: []` | FR-TSK-29, AC-51.3, AC-51.5, NFR-32 |
| TC-T65 | [UI] Admin removes `time.view` while the user (with `tasks.view`) is on Today, then on Day timesheet | Next request 403; Today and Day timesheet both disappear; page moves to the next allowed tab on the right (Due); next `/me/permissions` drops `today` and `day-timesheet` from `myTasksTabs` and returns `defaultTab: "due"` | EC-89 |
| TC-T66 | [API] `GET /api/v1/me/permissions` for Admin, PM, Member, Viewer (with and without `time.view`), a custom role and a no-tab role | Role, per-record actions (incl. Reports Export), Setup children per TC-T57, New project and + Task flags. `defaultTab` and `myTasksTabs` always present: `myTasksTabs` = allowed tab keys in tab order, `defaultTab` = its first item, or `null` and `[]` when none. Change a rule → next call reflects it | NFR-32, FR-ACL-21 |

### Log task time and Add quick activity (FR-ACT-29 to 33, NFR-31, EC-90 to 92)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-T67 | [UI] Time logging and My tasks › Day timesheet headers; Today tracker | 'Log task time' (primary) and 'Add quick activity' (secondary) replace '+ Add entry'; 'Add quick activity' replaces the tracker's '+ Quick activity' | FR-ACT-29, Q-62⚑ |
| TC-T68 | [UI] Log task time on a Configuration-default project's task | Manual entry form with project picker (today's visibility); Activity type Configuration | FR-ACT-30, AC-52.2 |
| TC-T69 | [UI] Add quick activity on today and on an unlocked past day; change type to Training and save | No project; Activity type preselected "Quick Activity"; saves as a quick activity with Training | FR-ACT-31, AC-52.1 |
| TC-T70 | [UI+API] Billable on a new quick activity | Defaults to No | FR-ACT-32, Q-65⚑ |
| TC-T71 | [API] `GET /settings/activity-types` | Quick Activity has `key: "quick_activity"`, `system: true`; Admin-made types `key: null` | NFR-31, FR-ACT-32 |
| TC-T72 | [UI+API] Admin on Setup › Activity types; API rename, deactivate, delete; set as Project type default | Row shows "System type" badge and no actions (no Edit/Deactivate/Delete). API → 422 `SYSTEM_ACTIVITY_TYPE`; not offered as a project type default | FR-ACT-32, AC-52.5 |
| TC-T73 | [API] Seed on a DB with an Admin type already named "Quick Activity" (with entries); re-run seeding | A separate system type (`key: "quick_activity"`, `system: true`) is created; the existing type is renamed "Quick Activity (custom)" and keeps its ID, entries and settings (nothing merged or moved). Re-run creates no duplicates and no second rename. The rename is in the audit log as a System action (no user actor). Clean DB: one system type only, no rename logged | FR-ACT-32, EC-90, A-21, Q-66⚑ |
| TC-T74 | [UI+API] Existing quick activities after release | Unchanged (no backfill) | FR-ACT-32 |
| TC-T75 | [API] Older mobile client posts a quick activity with no Activity type | 400, no silent default | EC-91 |
| TC-T76 | [UI+API] Tomorrow's date via both buttons, Time in, `POST/PATCH /tracker/entries` and `/time` | Picker disables future dates; API 422 `FUTURE_DATE`. Today allowed | FR-ACT-33, AC-52.6 |
| TC-T77 | [UI+API] Timer running: save a manual entry via either button (overlapping and not); then start a second timer | Manual save doesn't start/stop a timer; overlap rule applies. Second start: Switch/Cancel prompt; direct API → 409 `TIMER_RUNNING` | FR-ACT-33, FR-ACT-26, AC-52.4 |
| TC-T78 | [UI+API] Member/PM on a submitted or locked day; Admin on the same day | Both buttons disabled with "Locked. Ask an Admin to reopen this day."; POST → 422 `DAY_LOCKED`. Admin buttons enabled | FR-ACT-33, AC-52.3, FR-ACT-24 |
| TC-T79 | [UI] Admin reopens the locked day; Member reloads | Buttons enabled; entries can be added | FR-ACT-33, FR-ACT-24 |
| TC-T80 | [UI+API] Entry via either button over the 24h cap, or on an On Hold project task | Refused as today | FR-ACT-33 |
| TC-T81 | [UI+API] Timer running at 23:59 | Auto-stops at 23:59; no entry rolls into tomorrow | EC-92, FR-ACT-04 |
| TC-T88 | [UI] Mobile app: both buttons, same preselects, disabled future dates, and messages for 409 `TIMER_RUNNING`, 422 `DAY_LOCKED`, 422 `FUTURE_DATE`, 422 `PROJECT_NOT_PLANNING`, 409 `ACTIVITY_IN_USE` | Matches web | FR-ACT-29 to 33, FR-PRJ-21 |
