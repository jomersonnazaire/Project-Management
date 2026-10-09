# QA Report: Milestones 4 to 7, M7 preview (PR #10 to #13 at 1229aa8). Result: PASS (API), no new defects
| Area | Result |
|---|---|
| Supervisor rules | Set by Admin. Self and cyclic supervisor refused (400). Member can't edit their own (403) | Pass |
| TC-P01 My projects | PM: own 3. pm2: 0. Admin and Viewer: all. Member 403 | Pass |
| TC-P06 lock | Default Monday 12:00 PHT, boundary 2026-10-05. PM can't change it (403). Entry in a locked week returns 422 DAY_LOCKED | Pass |
| Leave types | 9 defaults seeded | Pass |
| TC-Q01 | Manual 08:00–08:07 stored as 7 min, "00:07". Client-supplied startedAt refused (400) | Pass |
| TC-Q02 | Second timer stops the first; only one running | Pass |
| TC-Q04 | Overlap 422 with the spec message; touching edges allowed | Pass |
| TC-Q06 | Quick activity: Billable No, no Time type, no project; Activity type required | Pass |
| TC-Q07 | pm2, Outsider and Viewer get 404 on another user's entry and day. Supervisor and Admin can view, edit gets 403 VIEW_ONLY | Pass |
| TC-Q08 | Location asked once a day (LOCATION_NEEDED), inherited, per-entry override works | Pass |
| TC-Q09 | In-use Module can't be deleted (409, spec message); PM can't add (403) | Pass |
| TC-Q10/Q11 | Submit with timer running 422. Submitted day: edit, delete and add 422. Member or pm2 reopen 403; no reason 400; supervisor reopen 200, member notified, editable again | Pass |
| TC-R01/R02 | Preview and PDF: title, range, total, 11 columns in order, 12-hour times, HH:MM, total row, footer. Client and Project blank for quick activity | Pass (band is DR-26) |
| TC-R03 | 32-day range and from>to refused; future days left out | Pass |
| TC-R05 | PDF and XLSX exports match the preview; no formula cells in XLSX | Pass |
| TC-R07 | Re-save of the same range tags Latest and Earlier, and the Earlier copy is unchanged after an edit, with changedDates. An overlapping range has no tag | Pass |
| TC-R08/R09 | PM (supervisor), Admin, pm2 and Outsider get 404 on another user's saved report and its export, and it isn't in their lists. Delete and patch 404 | Pass |
| TC-R10 | `<script>` stays text in the PDF and XLSX | Pass |
| TC-S01 | Full day deducts 1; supervisor notified once | Pass |
| TC-S02 | Fri 27 Nov to Tue 1 Dec with Bonifacio Day deducts 2 | Pass |
| TC-S03 | Over balance 422 with the plural-correct message; Unpaid allowed | Pass |
| TC-S04 | Same-type AM+PM = 1.0; Vacation AM + Sick PM = 0.5 each; second AM, full on a half day and half on a full day refused; half day over several dates 400 | Pass |
| TC-S05 | Own cancel 200, repeat 422. Supervisor can't cancel (403), pm2 404. Past leave: Member 422, Admin 200 | Pass |
| TC-S06 | Reason visible to the user, supervisor and Admin; pm2, Viewer and Outsider 404; team lists don't show reasons | Pass |
| TC-S07 | Entitlement below what's taken: allowed, balance negative | Pass |
| TC-S10 | 30 Dec 2026 to 4 Jan 2027 deducts 1 working day, split by year | Pass |
| Weekend-only leave | 422 NO_WORKING_DAYS | Pass |

Not run: TC-Q03 (23:59 auto-stop), TC-Q05 (24h cap with mixed entries), TC-Q13, TC-Q14, TC-P02 to P05 counts, TC-S08 (no supervisor).
Info: in the report, Remarks falls back to the task name when an entry has no notes. Rich should confirm that's intended.

## Fix round: PR #13 at c81519c (doc 14 v0.9.5). Result: PASS (API), no new defects
Run 9 Oct 2026 23:28 PHT to 10 Oct 2026 00:03 PHT against the milestone-7 web preview (API through `/api/v1`, Azure App Service xc8-projectmgmt-api-tc3w). Scripts and logs are `fr_*.py` and `fr_*.log` in `/workspace/qa-run`. Seeded project: **QA FR P02 9721** (code QAFR-9721, manager pm@, member pm2@). The running "QA auto-stop check" timer on member@ was not touched (no member@ tracker calls). TC-Q03 is checked separately at 00:37.

| Case | Evidence | Result |
|---|---|---|
| TC-Q05 mixed entries (past day) | pm@ on 2026-10-08: hours-only 10h + timed task 08:00–16:00 + quick 16:00–22:00 = 24h 00m, all accepted (day total 1440 min). Adding 1 more minute gives 422 DAILY_LIMIT "…to 24h 01m. A day can't exceed 24 hours. Shorten or remove an entry." Hours-only +0.25 gives "24h 15m". Moving a quick entry's end to 22:30 gives "24h 30m" | Pass |
| TC-Q05 running timer counts | pm2@ on 2026-10-09: hours-only 23.75h, then a timer started at 23:29:35. At +2 min, hours-only +0.25 (exactly 24h without the timer) was refused: "24h 02m". A 1-minute manual entry still within the cap was accepted. Once the timer passed the room left (14 min), a 1-minute entry was refused ("24h 03m"). Time out at 23:45 stored the timer as 14 min (ending 23:43:35, flagged autoStopped), so the day total is 1440. A new timer on the full day was refused ("24h 01m") | Pass |
| TC-Q13 On Hold mid-timer | pm@ timer on Day0 started 23:29:48. Admin set the project to ON_HOLD (request 23:30:53.87–23:30:54.72); the entry ended at 23:30:54.443 and stopped running. pm@ got a TIMER_STOPPED notice ("QA FR P02 9721 was put on hold, so your timer on "Day0" stopped at 11:30 PM."). Audit has `timer_stopped_project_closed` with endAt. A new Time in on that project gives 422 PROJECT_CLOSED. Project then set back to ACTIVE | Pass |
| TC-Q14 midnight | Manual 2026-10-09 00:00–00:30 is stored with startAt 2026-10-08T16:00Z, date 2026-10-09; the DAR shows 12:00 AM–12:30 AM on 2026-10-09. At 00:01 PHT on 10 Oct (UTC still 9 Oct 16:01), Time in got date 2026-10-10, and the default day and DAR range are 2026-10-10. Manual 2026-10-10 00:00–00:01 landed on 2026-10-10. A Time out in the future was refused (400), and so was a future date (400) | Pass |
| TC-P02 counts | Seeded row: overdueTasks 1, blockedTasks 1, openIssues 1, openCriticalHighIssues 1, waitingOnClient 1 (requested document), baselineEnd 2026-10-02, daysLate 18 then 35 after a later task moved the forecast (forecast minus baseline), health DELAYED. Progress 33% (1 of 3 completed), then 25% (1 of 4) | Pass |
| TC-P03 follow-ups | pm2@ is listed with 1 overdue item (Day0, link to the task). After midnight the document request due 2026-10-09 lists contact L. Cruz with overdueDocuments 1 and a link to Documents. pm@, who owns only a future task, isn't listed | Pass |
| TC-P04 sort and filter | The API returns health, client and daysLate on every row. Sorting and filtering run in the browser (MyProjectsView: late, name, health; health, client and late-only filters). UI not exercised in this API run | Pass (API data only) |
| TC-P05 project codes | "qafr-9721" vs existing QAFR-9721: 409 PROJECT_CODE_TAKEN. Same for "ACME-SAP" and "acme-sap". New "qa-p05-x" is stored as QA-P05-X. Code change without issues: 200. Change to a code already in use (other case): 409. Change on a project with issues (Admin and PM): 422 PROJECT_CODE_LOCKED with the spec message. All 11 open issues have unique keys prefixed with their project's code (e.g. ACME-SAP-2-ISS-003, ACME-SAP-4-ISS-001, QAFR-9721-ISS-001) | Pass |
| TC-S08 no supervisor | outsider@ (no supervisor, active) recorded leave: admin@ got LEAVE_RECORDED (+1) and pm@ got nothing. The cancel also notified admin@ (+1). The Admin › Users "Supervisor needed" badge comes from supervisorId null on an active user (outsider@ qualifies; badge not checked in the browser). Self supervisor gives 400 "A user can't be their own supervisor." A cycle (pm→member while member→pm) gives 400. jom@ (second Admin) inbox not checked (no test login) | Pass |
| FR-DAR-19 remarks fallback | pm@ 2026-10-07: a task entry and an hours-only entry with no notes show "Day0". A quick activity with no notes shows its title ("QA DAR quick Señor", ñ correct). Notes of only spaces also fall back to the title. Real notes are shown as entered. No prefix. Preview, PDF and XLSX all match | Pass |
| FR-ACT-19 delete | Own quick activity (outsider@, Member role), own timed task entry and own hours-only entry (pm@) on an open day: 204. A repeat delete: 404. Submitted day: delete and patch give 422 DAY_LOCKED. Locked week (2026-10-02): tracker delete gives 422 DAY_LOCKED, and a Member can't create there (422). Someone else's entry: pm2@, Viewer, a non-supervisor PM and outsider@ get 404 on delete and patch. Admin gets 403 VIEW_ONLY, as TC-Q07 specifies. Every delete is in the audit log (`time_deleted`, with actor, minutes or hours and date) | Pass |
| NFR-25 outsider sweep | outsider@ on records from QA FR P02, pm@'s entries, pm@'s saved DAR and member@'s leave: 35 requests (read, change and delete across project, activity, tasks, task history and status, issues and comments, folders, documents, document-request cancel, conversation, project time, /time patch and delete, another user's tracker day, tracker entries, saved DAR and its export, leave view and cancel). 34 returned 404. Reopening pm@'s day returned 403 NOT_SUPERVISOR (TC-Q11 design for Members, see note 2). Nothing changed | Pass |
| TC-Q03 23:59 auto-stop | member@ entry "QA auto-stop check" on 2026-10-09: startAt `2026-10-09T14:58:01.189Z`, endAt `2026-10-09T15:58:25.009Z`, minutes `60`, running `false`, autoStopped `false`. Running timer now: null. Expected endAt 15:59Z (23:59 PHT) and autoStopped true | Fail |

TC-Q03 re-check 2026-10-10 01:01 PHT, member@: `/tracker/running` entry null; entry 6ac900f9d92bc40873fb51cc unchanged (endAt `2026-10-09T15:58:25.009Z` = 23:58 PHT, minutes 60, autoStopped false). Still **Fail**; it stopped after about 60 minutes rather than at 23:59, with no auto-stop flag. Rerun is scheduled (timer start 10 Oct 22:43 PHT, verify 11 Oct 00:41 PHT).

Extra setup (requested): outsider@xceler8.example now has a 2026 **Vacation** balance of **-3.5**. Leave recorded: 9–12 Nov full days (4) plus 13 Nov AM (0.5). The entitlement was then lowered from 5 to 1; the API returns `balance: -3.5, negative: true`, with the warning "…Setting 1 makes the balance -3.5."

Notes (not defects):
1. As a PM, an hours-only entry in a locked week can be created and deleted through `/time` (the FR-TIME-04 PM/Admin exception). Deleting the same entry through `/tracker/entries` gives 422 DAY_LOCKED. Rich to confirm which rule applies to tracker entries.
2. `POST /tracker/days/{date}/reopen` from an unrelated user returns 403 for a real user ID and 404 for one that doesn't exist. This reveals whether a user ID exists, not record content.
3. While a timer runs past the cap, the live day total shows more than 24h (1442 min). Time out trims it to 1440.
4. The cap message shows the date as "2026-10-08". The spec's `{date}` format isn't defined.

Test data left behind: project QA FR P02 9721 and QA FR P05 new (code SBO1-X). Also entries for pm@ (10-07 to 10-10) and pm2@ (10-09, a full 24h day), a saved DAR for pm@, and the outsider@ leave above.

- TC-Q03 status correction (01:05 PHT Oct 10): VOID, not a defect. Per Deven, the audit log shows a manual `timer_stopped` by member@ (borrowed by Jomerson) at 23:58:25 PHT. Rerun on a QA-only account is scheduled for Oct 10 at 23:59 PHT.
