# QA Report: Milestone 3.5, PR #7 (API pass)
**Preview:** https://xc8-projectmgmt-web-git-milestone-3-5-jomerson-team.vercel.app · **Result: PASS (API)**, 1 Low defect

| Area | Result |
|---|---|
| Startup access-rules update | Ran 2026-10-09 19:56 PHT, migration `2026-10-09-member-time-delete`. Member time Delete switched on; Issues and Notifications rows added. Audit entries per cell, plus a summary. No other cell differs from the M1.5 defaults. There were no Admin-changed cells in production, so the skip path is covered only by Deven's unit tests | Pass |
| Member deletes own time | Own entry 204. Another user's entry 404 (Member, pm2, and PM on a Member's entry) | Pass |
| AC-42.1 | Empty create returns 400 on title, description, severity and stage; IDs run ACME-SAP-ISS-001, -002 | Pass |
| AC-42.2 / severity due dates (created Fri 9 Oct) | Critical Mon 12, High Wed 14, Medium Tue 20, Low Fri 30, all working days | Pass |
| AC-42.3 / workflow | Open to Resolved 422; Start without an owner 422; Resolved without text 422; owner who isn't the reporter can't close (403); Member can't reopen a closed issue (403); reopen without a reason 422; stale version 409; manual due date without a reason 400 | Pass |
| AC-43.1 / AC-45.2 access | Member: own projects only. Viewer and pm2: read, every write 403. Outsider: 404 on everything except DELETE (see DEF-006). Admin delete 204; PM delete 403 (grid default) | Pass |
| Links and people | Task from another project, contact from another client, and owner outside the project all refused (422) | Pass |
| AC-44.2 Archived | Archiving with open issues is refused (409 OPEN_ISSUES, FR-ISS-13). Once archived, create, update, reopen and comment return 409 PROJECT_ARCHIVED | Pass |
| AC-44.1 Completed | Not run: needs a fully completed project | Not run |
| AC-45.1 | Assignee notified once, the assigner not at all | Pass |
| AC-45.3 attachments | PDF OK; fake PDF, EICAR, over 25 MiB and PNG refused | Pass |
| Task and phase delete | Task with records 409, listing what's on it; Member 403; clean task 204. Phase with tasks 409; phase whose folder has a document 409; empty phase 204, and its folder is removed | Pass |
| TC-N23 / AC-TODAY-2 | Monday start, Not started, viewed Friday: Aging, 4 working days. In progress and not due: Planned for today. A task never appears in both sections | Pass |
| TC-N24 / AC-TODAY-3 | Past due and in progress: Aging, and overdue on Due | Pass |
| TC-N25 / AC-TODAY-4 | A Wednesday holiday lowers every age by 1 | Pass |
| TC-N27 / AC-TODAY-5 | Blocked task shows on Today; On Hold project tasks hidden from both tabs. Blocked on Due was not checked because that task wasn't due | Pass (partial) |
| TC-N29 | Starts today: Planned for today, age 0. Starts in the future: in neither section | Pass |
| TC-N30 | Saturday start viewed Friday: 5 working days | Pass |
| TC-N26 badges, TC-N22 tab order | Screen checks, covered by UIE | n/a |

## Defects
| ID | Severity | Title |
|---|---|---|
| DEF-006 | Low | An outsider calling DELETE `/issues/:id` gets 403 instead of 404, which confirms the issue exists. This is the same pattern as DEF-005: run the scope check before the Delete permission check. |
