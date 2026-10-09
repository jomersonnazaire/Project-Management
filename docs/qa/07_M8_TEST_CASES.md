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
