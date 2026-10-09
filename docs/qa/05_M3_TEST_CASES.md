# Milestone 3 test cases (v0.1, from doc 12 v0.6.6)
Time logging and documents also run the existing sections G and J of `02_TEST_CASES.md`.

| ID | Trace | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-N01 | AC-37.1, FR-PRJ-18 | UI | P2 | "+ Add activity to Phase 2"; Move up/down at the ends of a phase | Created in Phase 2 with no picker; the end items are greyed out |
| TC-N02 | AC-38.1 | API | P1 | Reorder within a phase; compare tasks before and after; send a stale order | Only order changes; 409 on a stale order; audited |
| TC-N03 | AC-39.1 | API | P1 | Upload .pdf, .docx, .xlsx, then .png, .docm, .xlsm, and a link payload | First three accepted; the rest refused |
| TC-N04 | AC-39.2 | API | P1 | Upload an .exe renamed `report.pdf`, and a .zip renamed `.docx` | `INVALID_FILE_TYPE` |
| TC-N05 | AC-39.3 | API | P1 | Upload 26,214,400, 26,214,401 and 0 bytes | Accepted; 413; refused |
| TC-N06 | AC-39.4 | UI | P2 | Open a task with M2 link evidence | Shown as "Link (legacy)" |
| TC-N07 | Security | API | P1 | Outsider and pm2 download another project's evidence by ID or by a guessed blob URL | 404; blobs are private and links are short-lived |
| TC-N08 | Q-29 | API | P2 | Upload the EICAR test file named `test.pdf` | Refused or quarantined; never downloadable |
| TC-N09 | AC-40.1 | API | P1 | Follow-up written by an assignee | Owner, other assignees, reviewer and PM each get exactly one notification; the author gets none |
| TC-N10 | AC-40.2 | API | P1 | Remove a user from the project, then add a follow-up | They get no new notification, and old ones don't reveal new project data |
| TC-N11 | Notifications | API | P2 | Mark one notification read, then mark all read; read another user's notification by ID | Count updates; 404 for another user's |
| TC-N12 | AC-41.1 | API | P1 | Member not on the project, Viewer, Outsider: read and post on the Conversation | 404; Viewer reads but gets 403 on post; Outsider gets 404 |
| TC-N13 | AC-41.2 | API | P1 | PATCH and DELETE a message | 404/405; message unchanged |
| TC-N14 | AC-41.3 | UI | P1 | Post `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` | Shown as text |
| TC-N15 | Q-31 | API | P2 | Admin hides a message; non-Admin tries to | Hidden marker is logged; non-Admin gets 403 |
| TC-N16 | AC-TODAY-1 | API | P1 | At 00:30 Philippine time: task due today (PH date) and one due yesterday | In Today; overdue listed first |
| TC-N17 | AC-CAL-1 | API | P1 | Saturday special working day; 1-working-day offset from Friday | Lands on Saturday |
| TC-N18 | AC-CAL-3 | Both | P1 | Untick every working day; tick Saturday and offset from Friday | 422 with "Keep at least one working day."; lands on Saturday |
| TC-N19 | AC-CAL-2 | Both | P1 | Add a holiday on a date with tasks due | Count shown; due dates unchanged; new projects skip the date |
| TC-N20 | FR-CAL | API | P2 | Duplicate holiday date; 10 holidays in a row after a weekend; only Sunday ticked | Duplicate refused; dates still compute with no timeout |
| TC-N21 | Access grid | API | P1 | New record types (documents, conversations, notifications) appear in access rules and are enforced | Rows present; unticking takes effect on the next request |

## Today (planned work) and Due tabs (doc 12 v0.6.9, FR-TSK-22 to 25)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-N22 | My tasks tab order | Today, Due, This week, All open, Completed. Due behaves like the old Today tab (TC-N14 to N16 rerun on Due) | FR-TSK-22 |
| TC-N23 | Task planned Monday, Not started, checked Thursday | Aging, "3 working days". Set it to In progress, not yet due: it moves to Planned for today. A task never sits in both sections | AC-TODAY-2, FR-TSK-23 |
| TC-N24 | Planned last week and past due | Aging on Today and overdue on Due | AC-TODAY-3 |
| TC-N25 | Wednesday is a Regular holiday | The TC-N23 task shows "2 working days". A Special working Saturday adds a day; unticking a working day removes it | AC-TODAY-4, FR-TSK-24 |
| TC-N26 | Badge thresholds | 2 days: no colour. 3: amber. 6: amber. 7: red | FR-TSK-24 |
| TC-N27 | Blocked task / On Hold project | Blocked shows in both tabs with its badge; On Hold project tasks show in neither | AC-TODAY-5 |
| TC-N28 | Scope | Only tasks where I'm owner or assignee; Completed and Cancelled hidden; another user's tasks never returned by the API | FR-TSK-23 |
| TC-N29 | Edge: planned start is today, or start is in the future | Today: Planned for today, age 0. Future: in neither section | FR-TSK-23 |
| TC-N30 | Edge: planned start on a weekend or holiday | Age counts working days only; no negative or off-by-one age | FR-TSK-24 |
| TC-N31 | Midnight (00:30 PHT) | Section membership and age follow the Philippine date, not UTC | FR-TSK-21 |
