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
