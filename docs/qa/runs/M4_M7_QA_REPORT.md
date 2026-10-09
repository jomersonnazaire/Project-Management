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
