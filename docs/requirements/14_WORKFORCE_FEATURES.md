# 14 — Microsoft Sign-in, Activity Tracker, Daily Activity Report, Leave, PM View

**Status:** v0.9.7 (Module free text, timesheet Time out button) · v0.9.5 — approved for build (Jomerson, 2026-10-09) — Q-36, Q-37, Q-41, Q-46 decided by Jomerson draft for Jomerson's approval · **Author:** Rich · **Date:** 2026-10-09
**Source:** Jomerson via Lean (room, 8:19 PM); Deven's and UIE's technical and design points.
Nothing here is built until Jomerson approves. Items marked **⚑** change an existing design decision.

## 0. Proposed milestones
| Milestone | Content | Depends on |
|-----------|---------|-----------|
| M4 (in build) | Dashboard, workload, reports **+ PM view (§6, folded in)** | — |
| M5 | Microsoft (Entra ID) sign-in | Client secret, redirect URIs, admin consent |
| M6 | Activity Tracker: time in/out, quick activities | M5 for Outlook calendar (optional part B) |
| M7 | Daily Activity Report | M6; email decision Q-41 |
| M8 | Leave management | Supervisor field (M7) |

## 1. Microsoft sign-in (M5)
**⚑ Design change:** Q-17 deferred SSO; FR-AUTH-01/02 assume password-only.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-SSO-01 | "Sign in with Microsoft" on the sign-in page, above the email/password form, using the Entra app (ClientId `612e7b78-…-1f62d2e97143`, TenantId `43d491ee-…-937cba92c1ce`), OpenID Connect authorization code flow with PKCE. | Must |
| FR-SSO-02 | **Single tenant only:** tokens from any other tenant are refused (check `tid` and issuer). | Must |
| FR-SSO-03 | **Proposed:** sits **alongside** password sign-in (Q-36). An Admin setting can later make Microsoft the only method. | Must |
| FR-SSO-04 | **Proposed: no auto-create** (Q-37). A Microsoft account signs in only if an active user with the same email exists (case-insensitive). On first success the user record stores the Entra object ID (`oid`); later sign-ins match on `oid`, so an email change in Entra doesn't break the link. Unknown accounts see "Your Microsoft account isn't set up in this app. Ask an Admin for an invite." | Must |
| FR-SSO-05 | Users stay in MongoDB with the same Access role, Job role, teams and permissions; Entra only proves identity. Deactivated users are refused even with a valid Microsoft sign-in. | Must |
| FR-SSO-06 | Session rules unchanged (30-min idle, 12-hour cap, sign-out). MFA and lockout for Microsoft sign-in are handled by Entra; our password lockout doesn't apply to it. | Must |
| FR-SSO-07 | The redirect URI is a **fixed API address** (e.g. `https://<api>/api/v1/auth/microsoft/callback`), not each Vercel preview link, because Entra doesn't accept wildcard redirect URIs and preview links change per build. After sign-in the API returns the user to the site they started from, but only to an allow-listed origin. | Must |
| FR-SSO-08 | The client secret is stored only in the API's app settings (or Key Vault), never in the code, the web app or chat. Secret expiry is tracked (Entra secrets expire, max 24 months). | Must |
| FR-SSO-09 | Audit: sign-in method (password / Microsoft) is recorded on each sign-in. | Should |

**Note:** existing users with personal emails (e.g. `jom@gmail.com`, `aude@gmail.com`) can't use Microsoft sign-in unless they're members or guests in the Xceler8 tenant; they keep password sign-in (Q-38).

## 2. Activity Tracker (M6)
**⚑ Design change:** extends time logging (FR-TIME) from hours-only, project-only entries to timed entries and non-project activities. Follows Deven's proposal: **one time-entry model, no second timesheet.**

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ACT-01 | The tracker lives in **My tasks › Today** (UIE): each row gets **Time in / Time out**, and the page gets **"+ Quick activity"**. No separate page. | Must |
| FR-ACT-02 | **Time in** starts a running entry for that task; **Time out** stops it. The result is a normal time entry with `start`, `end` and computed hours, so the 24-hour daily cap, weekly lock (Q-09), On Hold block and reports all apply. | Must |
| FR-ACT-03 | **Only one running activity per user.** Starting another stops the current one at the same moment. The running item shows a live timer in the top bar on every page. | Must |
| FR-ACT-04 | A timer left running is **auto-stopped at 23:59 Philippine time** and flagged "Auto-stopped – please check", editable until the weekly lock. Entries can't span midnight. | Must |
| FR-ACT-05 | Timed entries of one user can't overlap; manual edits that create an overlap are refused (422). Hours-only manual entries (existing FR-TIME) stay allowed. | Must |
| FR-ACT-06 | **Quick activity / custom task:** a time entry not tied to a project, with title, category and notes. Categories (Admin-editable list): Internal meeting, Client meeting, Pre-sales, Training, Admin work, Support, Other. Can be started as a timer or entered with start/end. | Must |
| FR-ACT-07 | Users see and edit only their own quick activities; supervisors (§3 profile) and Admins can view their team's. New access-rules row `activities` (own scope, not project-scoped). | Must |
| FR-ACT-08 | **Part B (optional, Q-39):** show today's Outlook calendar meetings in the Today tab, read-only, via Microsoft Graph `Calendars.Read` (needs Entra admin consent). One click turns a meeting into a timed quick activity (or a task entry if linked). | Could |
| FR-ACT-10 | **Daily timesheet (Jomerson):** a day view lists all the user's timed entries for that date (project tasks and quick activities) with time in, time out, duration, project/task or category, and notes. **Hours rendered** = sum of the time in/out pairs, shown per day. Entries can also be added by hand with time in and time out. | Must |
| FR-ACT-11 | Pairs on the same day can't overlap; the server refuses an overlapping entry (Deven). | Must |
| FR-ACT-12 | **Submit day** locks that day's entries for the user (a running timer must be stopped first). The supervisor or an Admin can reopen a submitted day with a reason; reopening is audited and shown on the day ("Reopened by …"). | Must |
| FR-ACT-13 | At the weekly lock (Q-09), unsubmitted days are locked as they stand and flagged **"Not submitted"** for the supervisor. | Must |
| FR-ACT-14 | The DAR (§3) marks each day as Submitted or Not submitted. | Should |
| FR-ACT-09 | Time in/out is recorded in Philippine time; the server sets the timestamps (clients can't send their own start/end for live timers). | Must |

## 3. Daily Activity Report (M7)
**⚑ Design change:** emailing brings back email, which Jomerson moved to the External integrations stage (Q-28).

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-DAR-01 | **Profile fields:** Direct supervisor (an internal user) and Report CC emails (up to 5 valid addresses). Editable by Admins; users can view their own (Q-42 for self-edit). | Must |
| FR-DAR-02 | A user picks a date range (default today; max 31 days) and sees a **preview**: for each day, every time entry (project tasks and quick activities) with time in/out, duration, project/task or category, type (execution/waiting/rework or activity category), status, and notes; daily and range totals; days on leave shown as "On leave". | Must |
| FR-DAR-03 | **Export** to PDF and Excel. | Must |
| FR-DAR-04b | **Fallback for users without an Xceler8 mailbox** (e.g. Gmail sign-in): Send is replaced by Export, and the supervisor gets an in-app notice that a report is ready. | Must (if Q-41 = email) |
| FR-DAR-04 | **Send** emails the report to the supervisor with the CC list, from the user's action only (no auto-sending unless Q-43 says so). The email has the report as a PDF attachment and a short summary in the body; the sender, time and recipients are logged. | Must (if Q-41 = email now) |
| FR-DAR-05 | Supervisors get an in-app notification and can open their reports' DARs in the app even without email. | Should |
| FR-DAR-06 | A report can be re-sent; each send is a separate log entry. Changes to time after sending don't alter what was sent (the PDF is kept). | Should |

## 4. Leave management (M8)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-LV-01 | Admin-defined **leave types** with name, paid/unpaid, unit (day / half-day), and whether it needs a document. Suggested starting list (Q-44, confirm with HR): Vacation, Sick, Emergency, Service Incentive Leave, Maternity, Paternity, Solo Parent, Bereavement, Unpaid. | Must |
| FR-LV-02 | **Yearly entitlement** per user per type (calendar year Jan–Dec unless Q-45 says otherwise), set by Admin, with optional carry-over from last year. | Must |
| FR-LV-03 | **Balance** = entitlement + carry-over − approved/taken − pending. Users see their own balances; supervisors see their team's; Admins see all. | Must |
| FR-LV-04 | **Proposed:** users file leave (date range, type, half-day option, reason); the **direct supervisor approves or rejects** (Q-46). Leave days count only working days (FR-CAL-02: Working days and holidays). | Must |
| FR-LV-05 | Filing more than the balance is refused unless the type is unpaid. Overlapping requests are refused. | Must |
| FR-LV-06 | Approved leave shows on My tasks, the workload view and the DAR as "On leave"; timers can't start on leave days (warning, overridable for half-days). | Should |
| FR-LV-07 | **Privacy:** no medical details are stored; the reason is free text visible only to the user, supervisor and Admins; attachments (e.g. medical certificate) follow M3 file rules and the same visibility. | Must |
| FR-LV-08 | Every entitlement change, filing, approval and cancellation is audited. Approved leave in the past can be cancelled only by an Admin. | Must |
| FR-LV-09 | Leave balances report per user and type, exportable. | Should |

## 5. Shared: supervisor relationship
- One **direct supervisor** per user (FR-DAR-01) drives DAR recipients, leave approval and "my team" views. A user can't supervise themselves; cycles (A→B→A) are refused.
- Supervisor is separate from Access role: a Member can supervise others without extra permissions beyond "my team" views.

## 6. PM view (fold into M4)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-PMV-01 | Dashboard **"My projects"** (UIE): one row per project the PM manages (Admins: all) with health, status, % complete (Q-08), forecast vs baseline end ("N days late" in red), overdue tasks, blocked tasks, open Critical/High issues, waiting-on-client items. | Must |
| FR-PMV-02 | **Who needs a follow-up:** per project, internal people with overdue or aging tasks (FR-TSK-23/24) and client contacts with overdue requested documents or tasks, each with counts and a link to the item. | Must |
| FR-PMV-03 | Sort and filter by health, client, days late; clicking a project opens it. | Must |
| FR-PMV-04 | Access: PMs see only projects they manage; Viewers see all read-only; Members don't get this view. | Must |

## 7. Edge cases
- **EC-73** A Microsoft user whose email matches an existing password user: linked on first sign-in (FR-SSO-04); the password keeps working unless Microsoft-only is turned on.
- **EC-74** A user is deleted in Entra: Microsoft sign-in fails; an Admin must deactivate them in our app too (no automatic sync in M5, Q-40).
- **EC-75** Browser closed with a timer running: it keeps running on the server and auto-stops at 23:59.
- **EC-76** Time in on a task whose project goes On Hold mid-timer: the timer stops at that moment.
- **EC-77** Supervisor deactivated: their reports show "Supervisor needed"; pending leave goes to Admins.
- **EC-78** Leave filed across a holiday or non-working day: those days aren't deducted.
- **EC-79** Entitlement reduced below what's already taken: allowed with a warning; balance goes negative and is flagged.
- **EC-80** DAR for a range including a future date: future days are left out.

## 8. Open questions for Jomerson (via Lean)
| ID | Question | Proposed default |
|----|----------|------------------|
| Q-36 | Does Microsoft sign-in replace passwords or sit alongside them? | Alongside, with an Admin switch for Microsoft-only later |
| Q-37 | A Microsoft account not in our users list: refuse, or auto-create as Member? | Refuse; Admins invite first (keeps access deliberate) |
| Q-38 | Users with personal emails (gmail): keep passwords, or must everyone have an Xceler8 Microsoft account? | Keep passwords for them |
| Q-39 | Pull Outlook calendar meetings into the tracker (needs `Calendars.Read` admin consent)? | Yes, as M6 part B after the core tracker |
| Q-40 | Sync users from Entra automatically (create/deactivate)? | No in M5; manual |
| Q-41 | Email the DAR now (brings email forward from External integrations), or export-only first? If email: send through Microsoft Graph `Mail.Send` from the user's own mailbox, or a service mailbox via Azure Communication Services? | Email now via Graph from the user's own mailbox (recipients see it from the person; needs admin consent) |
| Q-42 | Can users edit their own supervisor and CC emails? | No, Admin-managed; users view only |
| Q-43 | Should the DAR send automatically each day, or only when the user clicks Send? | Manual Send only |
| Q-44 | Which leave types and yearly days per type? (HR to confirm against company policy and Philippine law) | Starting list in FR-LV-01, days set by Admin |
| Q-45 | Leave year: calendar year or hire-date anniversary? Carry-over limit? | Calendar year; carry-over set per type by Admin |
| Q-46 | Is leave approved by the direct supervisor, or only tracked (no approval)? | Supervisor approves |
| Q-47 | Is the Activity Tracker for all users, or only Members/consultants? | All users |

## 9. Assumptions
- **A-17** All tracker times are Philippine time; users outside PH aren't in scope.
- **A-18** Payroll and leave pay calculations are out of scope; the app tracks balances only.
- **A-19** The Entra app registration is owned by Xceler8's tenant admin, who can grant consent for Graph permissions.

## 10. Decisions on mockup v0.8 gaps (Lean, 2026-10-09)
- **Late submission:** a past day can be submitted until the weekly lock. Reopening a day sends the user an in-app notification.
- **DAR status column:** each day shows Submitted, Not submitted or Reopened. Users can send with unsubmitted days; those stay marked Not submitted.
- **Leave cancelling:** users can cancel their own pending leave, or approved leave that's still in the future. Cancelling restores the balance and notifies the supervisor. Half-days are AM or PM.
- **Leave decisions:** rejecting requires a comment. The employee is notified of every decision (approved, rejected, cancelled by Admin).
- **Activity categories:** edited under Admin › Settings › Activity categories. A category in use can be deactivated, not deleted.
- **Running timer:** shown in the top bar on every page.

## 11. Message wording (draft by Rich, for UIE to check)
| Case | Message |
|------|---------|
| Microsoft account not set up | "Your Microsoft account isn't set up in this app. Ask an Admin for an invite." |
| Wrong tenant | "This Microsoft account belongs to a different organization. Sign in with your Xceler8 account." |
| Deactivated user | "Your account has been deactivated. Contact an Admin if you think this is a mistake." |
| Microsoft sign-in failed or cancelled | "Microsoft sign-in didn't finish. Please try again." |
| 24-hour daily cap | "This would bring your total for {date} to {hours}h. A day can't exceed 24 hours." |
| Overlapping entry | "This overlaps {other entry} ({start}–{end}). Adjust the times so they don't overlap." |
| Submit with timer running | "Stop the running timer before submitting this day." |
| Day locked | "This day is locked. Ask your supervisor to reopen it." |
| Day reopened (notification) | "{Name} reopened your timesheet for {date}: {reason}" |
| Report sent | "Report sent to {supervisor} and {n} CC." |
| Report send failed | "We couldn't send your report: {reason}. Try again, or export it and send it yourself." |
| No Outlook mailbox | "Your account can't send email from this app. Export the report instead. Your supervisor has been notified it's ready." |
| Leave over balance | "You have {n} days of {type} left. This request needs {m}." |
| Leave overlaps | "You already have leave filed for {dates}." |
| Leave rejected (notification) | "{Supervisor} rejected your {type} leave for {dates}: {comment}" |

## 12. Jomerson's decisions (2026-10-09, 8:30 PM)
- **Q-36 / Q-37:** two sign-in options: email and password, or Microsoft. Microsoft accepts only accounts in the Xceler8 tenant, and only for users already in the app (FR-SSO-02, FR-SSO-04 stand).
- **Q-41:** the user picks a date range and the app generates an **HTML email** laid out like Jomerson's sample. Before sending, a preview shows the To (supervisor) and CC recipients. Send goes through Microsoft Graph from the user's mailbox, and FR-DAR-04b covers users without one. PDF and Excel export stay.
- **Q-46:** **no leave approval for now.** Employees record leave as **Full day, Half day AM or Half day PM**, and the system shows them as on leave. FR-LV-04 approval, the approval queue and EC-77's pending-leave rule are dropped. FR-LV-05 balance checks and FR-LV-07 privacy stay. Supervisors get an in-app notice when leave is recorded.

### 12.1 New time-entry fields (from the sample report)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ACT-15 | Every time entry (project task or quick activity) gets **Location** (from an Admin list, e.g. "Office", "Client site", "Offsite - WFH"), **Billable** (Yes/No; defaults to Yes for client-project tasks and No for quick activities, editable) and **Module** (*superseded by FR-ACT-20: now optional free text*). Location and Billable lists are edited under Admin › Settings, and in-use values are deactivated rather than deleted. | Must |
| FR-ACT-16 | Remarks stay free text and separate from Module (Queen's note on the sample). | Must |
| FR-DAR-07 | The HTML report follows the sample: header block, "Total Activities" count, one row per entry with the sample's columns (including Location, Billable, Module, time in, time out, rendered hours and remarks), a **total rendered hours** row (Queen), and the footer line. UIE's mockup v0.8.2 is the column reference. | Must |

### 12.2 Rendered time (Queen's and UIE's question)
- **Proposed:** timed entries keep **exact minutes** from time in to time out, with no rounding. 8:00 to 8:07 is 7 minutes. The 0.25-hour step stays only for hours-only manual entries (existing FR-TIME).
- Rendered time always shows as **HH:MM** ("04:00", "00:07", total "25:10"), in the app and the report. Reports that sum hours use the exact minutes.
- **Confirmed by Lean (2026-10-09).**

### 12.3 Wording updates (UIE's check)
- 24-hour cap: "This would bring your total for {date} to {HHh MMm}. A day can't exceed 24 hours. Shorten or remove an entry."
- Day locked: "This day is locked. Ask your supervisor or an Admin to reopen it." **Confirmed (Lean):** after the weekly lock, only an Admin can reopen a day.
- Day reopened: "{Name} reopened your timesheet for {date}: {reason}. Make your changes and submit it again before the weekly lock."
- No Outlook mailbox: "You signed in with a personal email, so this app can't email your report. Export it instead. Your supervisor has been notified it's ready."
- Over balance: "You have {n} {day|days} of {type} left, and this needs {m} {day|days}. Choose fewer days or another leave type."

### 12.4 Location per day and report layout (Jomerson, Deven, Queen, Lean)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ACT-17 | **Location is set once per day:** the first Time in (or first entry) of the day asks "Where are you working today?" Every entry that day inherits it; a single entry can be changed (e.g. WFH morning, Onsite afternoon). Starting list: **Onsite, WFH, Office** (Admin-editable labels, e.g. rename to "Offsite - WFH"). | Must |
| FR-DAR-08 | **Report layout (from the sample):** title "Daily Accomplishment Report"; "Generated range: {start} to {end}"; "Total Activities: {n}"; columns in order **Date, Time In, Time Out, Rendered Hrs, Client Name, Project Name, Activity Type, Location, Billable, Module, Activity Remarks**; a total rendered hours row; footer "This is an automated email. Generated by Project Activity Tracker Application." Times in 12-hour format ("08:00 AM"); rendered hours as HH:MM. | Must |
| FR-DAR-09 | **Column mapping (UIE, from the sample):** **Activity Type** = the activity category on **every** entry, project work and quick activities alike, from one Admin list (e.g. Integration, Configuration, Training, Internal meeting). Each time entry therefore gets a required Activity Type. Client Name and Project Name are blank for quick activities. The specific work goes in Module and Activity Remarks. | Must |

### 12.5 Time type and missing supervisor
- **FR-ACT-18 Time type stays** (Execution / Waiting / Rework, existing FR-TIME) on **project entries only**, defaulting to Execution, because the M4 variance and rework reports depend on it. Quick activities don't have it. It's separate from Activity Type, and it doesn't appear in the Daily Accomplishment Report.
- **FR-DAR-10 No supervisor set:** Send is disabled with "Ask an Admin to set your supervisor", and Export still works. Reports can't go to CC only, so they can't skip the supervisor (UIE).
- **FR-LV-10 No supervisor set:** leave notices go to all Admins. Admin › Users flags users with no supervisor.

### 12.6 Sent reports record (Jomerson, UIE, Queen)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-DAR-11 | A **Sent reports** page lists every Daily Accomplishment Report the user has sent: date and time sent, range, To, CC and send status (Sent / Failed), newest first, filterable by date. | Must |
| FR-DAR-12 | Each send stores a **saved, read-only copy** of the exact HTML, subject, recipients and send result at the moment of sending. Opening a row shows that copy, never one rebuilt from current data (Queen). A note reads "Saved copy as sent on {date, time}. Later changes to your entries don't change it." | Must |
| FR-DAR-13 | If any day in the range was edited after sending, the record shows "{date} was changed after this was sent" with a link to make a new report; the saved copy is never altered. | Should |
| FR-DAR-14 | **Who sees it (proposed):** the user sees their own; the supervisor sees reports sent to them (as To); Admins see all. Being on CC doesn't give in-app access. | Must |
| FR-DAR-15 | Failed sends are recorded too, with the error, and can be retried (a retry is a new record). | Must |
| FR-DAR-16 | **Retention (proposed, Q-48):** records are kept for 5 years and can't be edited or deleted by users; only an Admin purge of records older than the retention period is allowed, and it's audited. | Should |

- **Q-48** How long are sent reports kept? Proposed: 5 years, in line with keeping employment and work records for several years. HR or legal to confirm.

## 13. Change of plan (Jomerson, 2026-10-09, 8:41 PM)
- **Microsoft sign-in (§1) is on hold** and moved to External integrations in `docs/FEATURES_AND_ROADMAP.md`. Everyone signs in with email and password. FR-ACT-08 (Outlook calendar) waits with it.
- **Milestones renumbered:** M5 Activity Tracker (§2), M6 Daily Accomplishment Report (§3), M7 Leave (§4), M8 Regression. The PM view stays in M4.
- **Report sender:** reports go from **one company sender**, not each person's Outlook. The sender address is Jomerson's choice (Q-49): a shared Microsoft 365 mailbox (e.g. reports@), an SMTP account, or export only for now. Until it's set up, Send is disabled with "Sending isn't set up yet" and Export works.
  - From shows "Xceler8 Reports on behalf of {employee}", and Reply-To is the employee's own address.
  - FR-DAR-04 (send from own mailbox) and FR-DAR-04b (Gmail fallback) are dropped.
- **FR-DAR-17 Recipients are built by the server (Queen):** To is always the user's supervisor and CC comes only from the user's profile list. The server never accepts recipient addresses from the browser, so the company sender can't be used to email arbitrary addresses. CC lists are changed only by Admins, and every change is audited. To and CC show read-only in the preview with "Set by Admin".
- **Q-49 (resolved, Jomerson 2026-10-09):** **view and export only for now.** No company sender. Once Entra ID is set up, reports send from each person's own account (roadmap).

## 14. Report scope for M6 (after Q-49)
- M6 ships the report as **view and export only** (preview, PDF, Excel). The preview has no Send button and shows "Coming with Microsoft sign-in".
- Deferred to the Microsoft sign-in roadmap item: FR-DAR-04 (send from own mailbox), FR-DAR-17 recipient rules for sending, and the **Sent reports record (FR-DAR-11 to 16, Q-48)**, which only applies once reports are emailed. Supervisor and CC fields stay on the profile so they're ready.
- Whether "auto sending" means a scheduled daily send or sending on click is revisited with Q-43 when that item starts.

## 15. Saved reports (Jomerson, Lean, 2026-10-09) — replaces §14's deferral of FR-DAR-11 to 16
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-DAR-11 | **Save report:** after previewing a date range, the user clicks Save report. A **Saved reports** page lists every report they've saved: saved date and time, range, total activities, total rendered hours, and a Latest / Earlier version tag; newest first, filterable by date. | Must |
| FR-DAR-12 | Saving stores a **read-only copy** of exactly what the report showed (the rendered report, all rows and totals, supervisor and CC on file at that moment). Opening a saved report shows that copy, never one rebuilt from current data. Note: "Saved copy from {date, time}. Later changes to your entries don't change it." Saved copies export to PDF and Excel. | Must |
| FR-DAR-13 | If any day in the range was edited after saving, the record shows "{date} was changed after this was saved" with a link to save a new version; the saved copy is never altered. | Should |
| FR-DAR-14 | **Saved reports are private to the person who saved them** (Jomerson): only they can list, open or export them. Supervisors and Admins have no access (API returns 404 to anyone else, per NFR-25). Supervisor visibility may come with sending later. Saving is final; the preview is the draft. | Must |
| FR-DAR-15 | **No deletes**, including by the owner. The **same date range** can be saved again: the newest save of that exact range is tagged "Latest" and older ones "Earlier version". Overlapping but different ranges are separate reports. | Must |
| FR-DAR-16 | No Admin purge for now; saved reports are kept. Q-48 (retention) is deferred until sending and supervisor access arrive. | — |
| FR-DAR-18 | When Microsoft sign-in arrives (roadmap), a saved report gains **Send**; sending reuses FR-DAR-17's server-built recipients. | — |

## 16. Half-day leave on the same day (Lean, 2026-10-09)
- **FR-LV-11** A user can record Half day AM and Half day PM on the same date. Same leave type: shown and counted as **one full day** (1.0 against that type). Different types: each half counts **0.5 against its own type**, and both show on that day.
- A second AM, or a second PM, on a date that already has one is refused: "You already have leave recorded for this morning." / "…for this afternoon." A Full day can't be added on a date with any half day (and vice versa).
- A full day of leave, or both halves, marks the day "On leave" in the timesheet and report (FR-LV-06). One half marks it "Half day leave (AM)" or "(PM)".

## 17. M4–M7 build notes (PR #10–#13, 2026-10-09)
- **FR-DAR-19 Remarks fallback (Lean):** when an entry has no remarks, Activity Remarks shows the task name (or the quick activity title), exactly like normal remarks, with no prefix.
- **Accepted:** day status (Submitted / Not submitted / Reopened) shows on screen but not in the exported report, which follows Jomerson's sample columns (FR-ACT-14 stays a screen feature).
- **Accepted:** Latest / Earlier version tags appear only when the exact same range was saved more than once.
- **FR-ACT-19 Deleting quick activities (DR-35):** users can delete their own quick activities and timed entries on days that aren't submitted or locked, with an in-app confirmation (not the browser's). Deletes are audited.
- **Deferred:** leave document uploads (FR-LV-07 attachments), the "On leave" marker in workload (FR-LV-06), and the leave balances export (FR-LV-09). All three are tracked for after M8.
- **24-hour cap with a running timer:** a running timer's elapsed time counts toward the day's 24-hour cap (Deven, fix round c81519c).
- **Hours display:** HH:MM everywhere on screen and in CSV exports, replacing DR-08's "4h" style.
- **My tasks tab order (Jomerson):** Today, Day timesheet, Due, Assigned to me, I'm accountable, To review, Completed (FR-TSK-22). Time in/out on a task fills the Day timesheet automatically, with no typing (FR-ACT-02, FR-ACT-10).

## Day timesheet polish (v0.9.7, Jomerson; Lean's call, 2026-10-09)

| ID | Requirement | Priority |
|---|---|---|
| FR-ACT-20 | **Module is an optional free-text box** in every time-entry form (Add entry, edit entry, quick activity, Time in), replacing the dropdown. Leading and trailing spaces are trimmed; a blank or spaces-only value saves as blank and shows "–" on screen, in the report, PDF and Excel. Max **100 characters** after trimming, enforced by UI and API (API returns 400 `VALIDATION_ERROR`); a counter appears from 80 characters and the inline error reads "Keep the module under 100 characters." Typed HTML is stored and shown as plain text, never rendered. | Must |
| FR-ACT-21 | **Migration:** a one-time, idempotent update copies each existing entry's module name into the new text field, so every entry and saved report keeps its module name. | Must |
| FR-ACT-22 | The **Admin › Settings › Modules** screen is removed from the app. The stored Modules list stays in the database untouched (possible future suggestions; permanent removal is on Lean's handoff list). | Must |
| FR-ACT-23 | The **running row** on the Day timesheet has its own **Time out** button. It behaves exactly like the top-bar Time out: stops the timer at the current server time, fills end time and HH:MM rendered hours. Stopping is idempotent: if both buttons are clicked, or one is clicked twice, the entry is stopped once and the second request returns the already-stopped entry with no change. | Must |

- **AC-ACT-20.1** Given a 101-character Module, save is refused by UI and API; 100 characters saves.
- **AC-ACT-20.2** Given Module "   ", the entry saves with blank Module and the report shows "–".
- **AC-ACT-20.3** Given Module `<b>x</b>`, the timesheet, report, PDF and Excel show the literal text.
- **AC-ACT-21.1** After migration, every pre-existing entry shows the same module name as before, including in report exports.
- **AC-ACT-23.1** Given a running timer, clicking the row's Time out then the top-bar Time out gives one stopped entry with the same end time and HH:MM as a top-bar-only stop.
| FR-ACT-24 | **One lock rule on every route (v0.9.8, Queen's Q1):** in a locked day or week, non-Admins (PMs included) can't create, edit or delete their entries through any endpoint (`/time` or `/tracker/entries`); all return 422 `DAY_LOCKED`. Only Admins change locked entries, after reopening. Enforce it in one shared check. In the UI, non-Admins see no Edit or Delete on locked rows (Time logging and Day timesheet); a lock icon shows instead, with the tooltip "Locked. Ask an Admin to reopen this day." (UIE) | Must |
| FR-ACT-25 | **Reopen requests don't reveal users (v0.9.8, Queen's Q2):** a reopen or other per-user request naming a user outside the caller's scope returns 404, whether that user exists or not, in line with NFR-25. 403 stays only for a caller who can see the target but lacks the action (for example, a Member reopening their own day). | Must |
