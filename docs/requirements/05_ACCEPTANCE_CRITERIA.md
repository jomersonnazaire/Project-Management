# 05 · Acceptance Criteria (Phase 1)

Given/When/Then. Each `AC-xx.y` maps to `US-xx`. "API" criteria must be verified by calling the backend directly, not only through the UI.

## US-01 Sign in
- **AC-01.1** Given an active user, when they enter correct credentials, then they land on **My tasks** (until the Dashboard ships in Milestone 4, then the Dashboard).
- **AC-01.2** Given wrong credentials, then a generic "Email or password is incorrect" message shows (no hint which one).
- **AC-01.3** Given 5 consecutive failures on one account (from any IP), then that account is locked for 15 minutes **silently**: further attempts, even with the correct password, return the same HTTP 401 "Email or password is incorrect" (never 423 or any "locked" wording), and a correct sign-in succeeds once the 15 minutes pass. **(API)** Excess attempts from one IP across many accounts are rate-limited (HTTP 429).
- **AC-01.4** Given a deactivated user, when they sign in with correct credentials, then access is denied.
- **AC-01.5b** Given an active session older than 12 hours, the next request returns 401 and the user must sign in again.
- **AC-01.5** Given a session idle for more than 30 minutes, when the user acts, then they're redirected to sign-in and no data is returned by the API (401).
- **AC-01.6 (API)** Given any client contact's email, when used on any auth endpoint, then the response is the same failure as an unknown user.

## US-02 Manage users
- **AC-02.1** Admin can create a user; duplicate email is rejected with "Email already in use".
- **AC-02.2** An invited user sets a password (at least 8 characters, with a number and a symbol) through the invite link. A 7-character password, or one missing a number or a symbol, is rejected by both the UI and the API.
- **AC-02.6** Invite and reset links work only once. Used links, links older than their expiry (72 hours for invites, 24 hours for resets), and links replaced by a newer one are refused with "This link has expired. Ask an Admin for a new one."
- **AC-02.3 (API)** A non-Admin calling user-create or role-change endpoints receives 403.
- **AC-02.4 (API)** A user changing their own system role receives 403.
- **AC-02.5** Deactivating a user keeps their tasks and time entries visible, labelled "(inactive)".

## US-03 Teams
- **AC-03.1** Admin can create, rename, and archive teams; a user can belong to multiple teams.
- **AC-03.2** Archiving a team with open tasks shows a warning listing those tasks.

## US-04 Clients & contacts
- **AC-04.1** A client contact can be created with name, company, department, email, phone; name and company are required; email format validated.
- **AC-04.2** Client contacts never appear in user lists, assignee pickers, or owner pickers.
- **AC-04.3** The contacts screen shows the "can't sign in / tagging never grants access" notice.

## US-05 Tag a contact on a task
- **AC-05.1** When responsible party = Client, a client contact is required before save.
- **AC-05.2** The contact picker lists only active contacts of the project's client.
- **AC-05.3 (API)** Tagging a contact from a different client returns 400.
- **AC-05.4 (API)** After tagging, no user account, password, or session exists for that contact, and no endpoint returns data to them.
- **AC-05.5** The task panel shows the 🔒 "tracked only, no login" notice.

## US-06 Contact follow-up
- **AC-06.1** The contacts list shows pending items = open client-party tasks tagged to the contact, and overdue count.
- **AC-06.2** Adding a follow-up note records author and timestamp and appears in the task history.
- **AC-06.3** The Dashboard "Waiting on client" list shows open client-party tasks sorted by due date, with "Nd overdue" / "Due tomorrow" / date labels.

## US-07 Build a template
- **AC-07.1** A template can be saved as Draft with phases and activities including all FR-TPL-03 fields.
- **AC-07.2** Creating a dependency cycle (A→B→A, or longer) is rejected with a message naming the activities.
- **AC-07.3** The seeded "SAP Business One Implementation" template contains the 10 blueprint activities in order with their responsible parties and deliverables.
- **AC-07.4** Publishing requires at least one activity.

## US-08 Template versioning
- **AC-08.1** Given a Published v3 used by projects, when it's edited and published, then it becomes v4 and v3 stays readable.
- **AC-08.2** Given project P created from v3, when v4 is published, then P's tasks, dependencies, estimates, and deliverables are unchanged and P still shows "template snapshot v3".
- **AC-08.3** Archived and Draft templates don't appear in the New project template picker.

## US-09 Create project from template
- **AC-09.1** Required fields are enforced: name, client, PM, baseline start, baseline end, template.
- **AC-09.2** Baseline end ≤ start shows "End date must be after the start date." and blocks submit.
- **AC-09.3** Selecting a template shows "Generates N activities, D dependencies and V deliverables" and a preview of the first activities.
- **AC-09.4** After Generate plan, the project has exactly N tasks with dependencies matching the template and dates computed from baseline start + offsets.
- **AC-09.5** The project is in Planning status and records the template id and version.
- **AC-09.6** Generation is atomic: if any step fails, no partial project or tasks remain.

## US-10 Review & adjust plan
- **AC-10.1** PM can change owner, assignees, estimates, dates, client contact, and add/remove tasks in Planning and Active states.
- **AC-10.2** Changing these fields doesn't modify the template.
- **AC-10.3** PM can set status Planning → Active; activation is blocked if any task lacks an accountable owner (message lists them).
- **AC-10.4 (API)** A Member editing due date, estimate, owner, or dependencies receives 403.

## US-11 Project health
- **AC-11.1** Progress % = completed ÷ (total − cancelled), whole number. A project with 0 tasks shows 0%.
- **AC-11.2** Schedule variance shows "+N days", "0 days", or "−N days" from forecast end − baseline end.
- **AC-11.3** Health badge follows FR-PRJ-10 in order (Delayed, then At risk, then On track); QA verifies one example of each, plus variance 0 with an overdue optional task = At risk, and an On Hold project shows "On hold".
- **AC-11.4** Projects list filters (All, Delayed, At risk, Completed) show correct counts.

## US-12 Task board
- **AC-12.1** The board shows 5 columns with counts; each card shows name, phase or client tag, owner or contact, due/late label, and est/actual with variance when started.
- **AC-12.2** Dragging a card to a valid column updates status and writes an audit entry.
- **AC-12.3** Invalid moves (see AC-13, 14, 16) are refused with an explanatory message and the card returns.
- **AC-12.4** Filter by assignee shows only tasks where the person is owner or assignee.

## US-13 Blocked
- **AC-13.1** Moving to Blocked opens a required "Blocker reason" field; it can't be empty.
- **AC-13.2** "Mark unblocked" returns the task to its previous status and keeps the reason in history.

## US-14 Evidence & submit for review
- **AC-14.1** Files over 25 MB or of disallowed types (FR-DOC-13) are rejected with a message.
- **AC-14.2** For a requires-approval task, moving to Completed instead sets For Review with "Approval pending".
- **AC-14.3** A requires-approval task can't be submitted without at least one evidence item (file or link).

## US-15 Approve / reject
- **AC-15.1** PM (or designated reviewer) sees Approve and Reject on For Review tasks; Members don't.
- **AC-15.2** Approve sets Completed and records approver and time; Reject requires a comment and sets In Progress.
- **AC-15.3 (API)** A Member calling the approve endpoint receives 403.

## US-16 Dependencies
- **AC-16.1** A task with an incomplete predecessor can't move to In Progress or Completed; the message names the predecessor.
- **AC-16.2** PM override requires a reason and is logged.
- **AC-16.3** Adding a dependency that creates a cycle is rejected.

## US-17 My tasks
- **AC-17.1** Lists all open tasks where the user is owner or assignee, across projects, sorted by due date, overdue first.

## US-18 Log time
- **AC-18.1** Hours outside 0.25–24 or not a multiple of 0.25 show "Enter between 0.25 and 24."
- **AC-18.2** A future work date is rejected.
- **AC-18.3 (API)** Entries that push a user's daily total above 24 h are rejected.
- **AC-18.4 (API)** Logging to a task in a project the user isn't a member of returns 403.
- **AC-18.5** After saving, the task's actual hours and variance update everywhere it's shown.
- **AC-18.6** Time can't be logged to Cancelled tasks or to On Hold, Completed, or Cancelled projects (API refuses too).

## US-19 Weekly timesheet
- **AC-19.1** The week selector shows entries for Mon–Sun with total hours and "of Xh available (Y% utilization)".
- **AC-19.2** Locked entries are read-only for Members; PM/Admin edits are audited.

## US-20 Dashboard
- **AC-20.1** KPI values match the underlying data for the user's visible projects (QA verifies with a seeded dataset).
- **AC-20.2** Overdue tasks card shows the subset "N waiting on client".
- **AC-20.3** The AI insights panel is labelled Phase 2 and makes no API calls to any AI service.
- **AC-20.4** A Member only sees projects they belong to.

## US-21 Workload
- **AC-21.1** For the selected week, assigned, recorded, and utilization values match the formulas in FR-WL-01/02.
- **AC-21.2** People over 100% assigned are visually flagged.
- **AC-21.3** The "hours aren't a performance score" note is shown, and waiting time is shown separately.

## US-22 Reports
- **AC-22.1** Effort variance: est 8 / act 12 → +4, +50%; est 16 / act 14 → −2, −12.5%; est 10 / act 18 → +8, +80%; est 0 / act 2 → +2, "No estimate".
- **AC-22.2** Every report's CSV export contains exactly the filtered rows and the visible columns, UTF-8 with header row.
- **AC-22.3** An empty result shows the empty-state message, and CSV export contains only the header.

## US-23 Activity log
- **AC-23.1** Every change listed in FR-AUD-01 creates an entry with user, timestamp, field, old and new values.
- **AC-23.2 (API)** No endpoint allows updating or deleting audit entries.

## US-24 to US-32 Project documents
See [10 §4](10_DOCUMENT_MANAGEMENT.md).
