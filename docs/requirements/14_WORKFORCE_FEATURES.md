# 14 — Microsoft Sign-in, Activity Tracker, Daily Activity Report, Leave, PM View

**Status:** v1.2.6 — Q-67 to Q-69 resolved (Jomerson 2026-10-13); template history label, apply toast, leave-Planning dialog · v1.2.5 — optional template, blank projects, Planning-stage editing, Planned column order; approved by Jomerson 2026-10-13 · v1.2.4 — m8-polish approved for build (Jomerson, 2026-10-13); Q-53, 55, 62, 64, 65, 66 resolved; ships with DR-48 fix · v1.2.3 (team-only project filter dropped by Jomerson: FR-PRJ-24 to 26 struck, Q-57 to Q-60 withdrawn; mobile on hold) · v1.2.2 (per-tab permission keys, defaultTab = first allowed, ACTIVITY_IN_USE applies to Admins, EC-90 custom-type rename, Q-66) · v1.2.1 (Lead's m8-polish decisions: Q-52/54/56/61/63 resolved; Q-64, Q-65 added) · v1.2.0 (m8-polish) · v1.1.1 · v1.0.0 (to v0.9.7: Module free text, Time out button; v0.9.8–v1.0.0: lock rule, reopen 404, M8 feedback, audit NFRs) · v0.9.5 — approved for build (Jomerson, 2026-10-09) — Q-36, Q-37, Q-41, Q-46 decided by Jomerson draft for Jomerson's approval · **Author:** Rich · **Date:** 2026-10-09
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
| FR-DAR-08 | **Report layout (from the sample):** title "Daily Accomplishment Report"; "Generated range: {start} to {end}"; "Total Activities: {n}"; columns in order **Date, Time In, Time Out, Rendered Hrs, Client Name, Project Name, Activity Type, Location, Billable, Module, Activity Remarks**; a total rendered hours row; footer "Generated by OpsTrack." (renamed 2026-10-10; reports saved before the rename keep "Generated by Project Activity Tracker Application") Times in 12-hour format ("08:00 AM"); rendered hours as HH:MM. | Must |
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
| FR-ACT-20 | **Module is an optional free-text box** in every time-entry form (Add entry, edit entry, quick activity, Time in), replacing the dropdown. Leading and trailing spaces are trimmed; a blank or spaces-only value saves as blank and shows "–" on screen, in the report, PDF and Excel. Max **100 characters** after trimming (counted as user-visible characters, so an emoji counts as one), enforced by UI and API (API returns 400 `VALIDATION_ERROR`); a counter appears from 80 characters and the inline error reads "Keep the module under 100 characters." Typed HTML is stored and shown as plain text, never rendered. | Must |
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

## Jomerson's M8 test feedback (v0.9.9, 2026-10-10; calls by Lean, design by UIE)

| ID | Requirement | Priority |
|---|---|---|
| FR-ACT-26 | **One running timer per person, server-enforced** (FR-ACT-03, DEF-009): two simultaneous starts can never both succeed (atomic check; second gets 409 `TIMER_RUNNING`). In the UI, Time in while a timer runs asks "Stop '{task}' and start this one?" with **Switch** (stops the first at the current time, then starts the new one) and **Cancel**. | Must |
| FR-ACT-27 | **Own entries only:** the Day timesheet and Time logging list only the signed-in user's entries, enforced by the API (other users' entries return 404, NFR-25). PM timesheet review and Admin reopen keep their existing access to others' time. | Must |
| FR-ACT-28 | **Field-level errors:** validation errors show under the field (e.g. "Keep the module under 100 characters."); the top banner is only for server or network problems. The API returns a per-field error list. | Must |
| FR-LV-12 | **Leave on the Day timesheet:** a leave day shows a grey row at the top ("Vacation · Full day" or "Half day AM/PM"). A **+ Add leave** button sits next to + Add entry and opens the existing file-leave form for that date. | Must |
| FR-LV-13 | **Auto-save for Entitlements and carry-over:** no Save button; each change saves on its own, shows "Saving…" then "Saved ✓", and on failure restores the old value with "Couldn't save. Try again." Every change is audited. | Must |
| NFR-27 | The left navigation scrolls on its own on short or small screens so every menu item is reachable. | Must |

Notes: Time in creates a Day timesheet row (FR-ACT-02/10) and the row Time out button (FR-ACT-23) are already specced; the "Some fields are invalid" error came from the preview running the old API.
| NFR-28 | **System actions are audited:** the 11:59 PM auto-stop (and any other system-made change) writes an audit record with actor "System", the entry ID, the stop time and `autoStopped: true`. (Deven, from TC-Q03, v1.0.0) | Must |
| NFR-29 | **Audit records store the client IP and user agent** for user actions (IP from the trusted source in NFR-05). Only Admins see them, in the audit log. (Deven, v1.0.0) | Should |
- **Timer rounding (DR-45, 2026-10-10):** timer start and end are saved rounded down to the whole minute, so shown times and HH:MM duration always agree; auto-stop still ends at exactly 23:59.

## Project Type (v1.1.0 draft, Jomerson via Deven, 2026-10-10)

| ID | Requirement | Priority |
|---|---|---|
| FR-PTY-01 | **Admin › Settings › Project types:** master list with Name and **Default activity type** (optional, picked from active Activity types). Seeded (Q-51, Jomerson): Implementation, Integration, Configuration, Development, Support, Upgrade, Migration, Training, Consulting; each defaults to the Activity type of the same name if one exists, otherwise blank. Admins add, rename and deactivate; in-use types are deactivated, never deleted. Names are trimmed, max 50 characters, unique regardless of case (409 on duplicate). Blank name error: "Add a name." (same as Activity types). Unused types can be deleted; in-use types only deactivated. Audited. | Must |
| FR-PTY-02 | **Project information** gets a **Project type** field. Required on create and on edit of a project created after this release; the picker offers active types only. A project whose type was later deactivated keeps showing it with an "Inactive" tag, and the value stays valid on save. | Must |
| FR-PTY-03 | **Existing projects** get no type (shown "Not set"); they stay editable, and PMs or Admins fill it in on next edit (required at that point, proposed). No automatic guess. | Must |
| FR-PTY-04 | **Time in preselect:** opening Time in on a project task preselects Activity type from the project type's Default activity type, with the hint "From project type"; the user can change it. Nothing is preselected when: the project has no type, the type has no default, the default Activity type is inactive, or it is a quick activity (no project). Leave it blank rather than pick a dead value. The same preselect applies to + Add entry on a project task. | Must |
| FR-PTY-05 | **Entries never change afterwards:** changing a project's type, a type's default, or deactivating either never edits Activity type on existing time entries. | Must |
| FR-PTY-06 | **Renames:** live screens and new reports show the current name (stored by ID). Saved Daily Accomplishment Reports are frozen copies and keep the name as saved (FR-DAR-15). | Must |
| FR-PTY-07 | Project type shows on the project list (filterable), the dashboard project table and the project-status report, and is added to `settings` access rules like other Admin lists. | Should |

**Mapping choice:** one Default activity type per Project type, set by Admins (UIE's column), rather than a fixed one-to-one name match, because Activity types are a separate, longer list and names may not line up.

**Open (non-blocking, Jomerson):** Q-50 should existing projects be forced to pick a type on their next edit (proposed yes)? Q-51 resolved: nine starting types (see FR-PTY-01). Q-50 resolved: yes.

**Starting Project types and default activity types (v1.1.1, proposed by Rich; Admins can change any of them):**

| Project type | Default activity type |
|---|---|
| Implementation | Configuration |
| Integration | Integration |
| Configuration | Configuration |
| Development | Development |
| Support | Support |
| Upgrade | Configuration |
| Migration | Data migration (exists in the live list, Queen) |
| Training | Training |
| Consulting | Client meeting |
- **Project Type build notes (PR #15, Deven, 2026-10-10):** Project types are governed by the existing `settings` access row (FR-PTY-07). Time in no longer copies the last entry's Activity type; it preselects only from the project type default (FR-PTY-04). The project page's old "Type" field is renamed **"Template type"** so it isn't confused with Project type.

## m8-polish changes (v1.2.1; v1.2.0 Lead/Jomerson, Deven on Quick Activity, 2026-10-13; v1.2.1 Lead's decisions, 2026-10-13)

Six changes for the m8-polish build. Access parts (§A, §D, §E; §C dropped) are mirrored in doc 11 v0.4.12 (FR-ACL-19 to 22; FR-ACL-18 dropped). **Mobile (Flutter) is on hold;** mobile notes below apply when it resumes. Items marked **⚑** change an existing rule. **Approved for build (Jomerson, 2026-10-13):** all m8-polish questions are resolved (§H). The six changes ship as **one combined m8-polish update together with the DR-48 fix**.

**Definitions (Lead, v1.2.1):**
- **Project PM** = the project's assigned manager, **or** any user with Access role PM who is on that project's team list.
- **Team list** = the project's team list (FR-PRJ-06), used here only for the Project PM definition. Client contacts never count.
- **Permission-driven UI:** Setup items and the **New project** and **+ Task** buttons show according to Access rules permissions (doc 11), never hard-coded role checks.

### A. Project › Checklist: activity delete and Phase editing ⚑

| ID | Requirement | Priority |
|---|---|---|
| FR-PRJ-21 | **Only the Project PM (see Definitions) and Admins delete checklist activities** (tasks). Delete in the ⋮ menu shows only to them. Others are refused by the API: 404 if the project is outside their scope (NFR-25), or 403 `FORBIDDEN` if they can see the project. **Activity in use (Deven):** if anything is attached, the delete is refused and nothing is changed: **409 `ACTIVITY_IN_USE`** with `details.blockedBy` = an array of one or more of `time`, `evidence`, `documents`, `issues`, **always returned in that fixed order** by the API; clients build the message directly from it without sorting. The UI shows **no confirm dialog** when the activity is blocked; instead one inline message appears under the row as red text (#b8240a, per mockup), worded the same on web and mobile: "Can't delete: this activity has " + the blocked items in fixed order **logged time, evidence files, documents, issues** (only those in `blockedBy`), separated by commas with "and" before the last (no Oxford comma), ending with a full stop. Examples: "Can't delete: this activity has logged time." / "…has logged time and evidence files." / "…has logged time, documents and issues." There is no separate 422 for this case. **`ACTIVITY_IN_USE` applies to Admins too**; the Admin exemption covers only the Planning lock (FR-PRJ-23). Successful deletes are audited; refused deletes are not. **Project PMs and Admins can delete an unattached activity at any project status** (Lean's original rule: only PMs delete activities, no status limit). The Planning lock (FR-PRJ-23) covers phase details only. *(Q-52 resolved.)* | Must |
| FR-PRJ-22 | **Phase information:** the Project PM can change it only while project status is **Planning** (FR-PRJ-05). **Admins can change it at any status.** Edits are audited. | Must |
| FR-PRJ-23 | **Phase lock for PMs outside Planning** (Active, On Hold, Completed, Cancelled) covers **phase name, order, dates, and adding or deleting phases**. The controls are hidden for PMs, and the API returns 422 `PROJECT_NOT_PLANNING` with "Phase details can only be changed while the project is in Planning." Admins are exempt *(Q-54 resolved)*. **Adding and editing activities is not locked by status** (FR-PRJ-20 unchanged; Q-64 resolved). **All other phase fields (for example, description) are locked the same way** (Q-53 resolved). **If a project returns to Planning, PM phase editing reopens** (Q-55 resolved). | Must |

- **US-46** As a Project PM, I want only PMs and Admins to delete checklist activities, so the plan isn't changed by accident.
- **US-47** As a Project PM, I want to edit phases during Planning, so the plan is right before work starts.
- **AC-46.1** Given a Member on the project, when they open an activity's ⋮ menu, then Delete isn't shown, and a direct `DELETE /projects/:id/tasks/:taskId` returns 403. **(API)**
- **AC-46.2** Given a global PM who can view project X but isn't its manager or on its team, when they send DELETE on X's task, then 403. Given a PM on X's team list, then the delete is allowed. **(API)**
- **AC-46.3** Given a task with logged time and evidence, when the Project PM or an Admin chooses Delete, then the API returns 409 `ACTIVITY_IN_USE` with `blockedBy: ["time","evidence"]`, no confirm dialog opens, the row shows "Can't delete: this activity has logged time and evidence files.", and nothing changes. **(API)**
- **AC-46.6** Given an activity with issues, time and documents attached, then the API returns `blockedBy: ["time","documents","issues"]` in that order, and web and mobile both show exactly "Can't delete: this activity has logged time, documents and issues." in #b8240a under the row.
- **AC-46.5** Given a task with nothing attached, when the Project PM confirms Delete, then it is removed and audited.
- **AC-47.1** Given a Planning project, when its PM renames, reorders, redates, adds or deletes a phase, then the change saves and is audited.
- **AC-47.2** Given an Active project, when its PM tries any of those phase changes, then the controls are hidden and a direct API call returns 422 `PROJECT_NOT_PLANNING`. Adding or editing an activity still works. **(API)**
- **AC-47.3** Given an Active or Completed project, when an Admin edits a phase, then the edit saves.
- **EC-81** PM handover or removal from the team mid-session: the old PM's next delete or phase edit returns 403 or 404. The new PM gets the controls on next load.
- **EC-82** Status changes from Planning to Active while a PM has a phase form open: save returns 422 and the form shows the read-only message.
- **EC-83** Project with no manager set: team-list PMs and Admins can still delete activities.

### B. My tasks: Planned date

| ID | Requirement | Priority |
|---|---|---|
| FR-TSK-26 | The **Today, Due and Assigned to me** tabs show **Planned date**, taken from the task's `plannedStart` (FR-TSK-23): as a column on desktop and as a field on the phone card. **Column order (UIE, decided):** Task, Project, Role, **Planned**, Due, Est / Act, Status. Column heading **"Planned"**. On phone cards, Planned sits directly above Due. | Must |
| FR-TSK-27 | **Format:** the same short date format as the Due date on that screen, in Philippine time, with no time of day. **Empty:** the field is **omitted** on cards (no label or placeholder); in table layout the cell is left blank. Tasks without a planned date sort last. On phone cards an empty Planned is omitted entirely. *(Q-56 resolved; A-20 decided.)* | Must |

- **US-48** As a team member, I want to see each task's planned date in my lists, so I know what to start when.
- **AC-48.1** Given a task with planned start 2026-10-15, when I open Today, Due or Assigned to me, then its Planned date shows in the Due date format.
- **AC-48.2** Given a task without a planned start, then no Planned date label or value shows on its card, and its table cell is blank.
- **AC-48.3** Given the Assigned to me tab on desktop, then columns read Task, Project, Role, Planned, Due, Est / Act, Status. Given a phone card with a planned date, then Planned shows directly above Due.
- **EC-84** Planned start after the due date (bad data): shown as stored, with no error.

### C. Project scope — Dropped 2026-10-13 by Jomerson

- ~~FR-PRJ-24~~, ~~FR-PRJ-25~~, ~~FR-PRJ-26~~, ~~US-49~~, ~~AC-49.1 to 49.4~~, ~~EC-85 to 87~~: **Dropped 2026-10-13 by Jomerson.** IDs are kept, not reused. Projects, the Task board and the project pickers in Log time and Create task keep today's visibility (doc 11 role rules and FR-ACL-07; Q-12 stands: PMs view all projects and edit their own). The existing NFR-25 404 rule for out-of-scope records is unchanged.

### D. Sidebar: hide empty Setup (web only)

| ID | Requirement | Priority |
|---|---|---|
| FR-NAV-01 | **Web only:** the sidebar **Setup** group is hidden when the user can view none of its child items. Each child item, and the **New project** and **+ Task** buttons, show by Access rules permissions (doc 11 FR-ACL-20), never hard-coded roles. The mobile app has no Setup menu, so this doesn't apply there. | Must |
| FR-NAV-02 | Visibility comes from `GET /me/permissions` (NFR-32) and updates on the next load after a rule change (FR-ACL-06). Hiding is never the control: direct URLs to denied items return 404 (doc 11 §11). | Must |

- **US-50** As a Member, I don't want to see an empty Setup menu, so the sidebar shows only what I can use.
- **AC-50.1** Given a role with no View on any Setup child, then the web sidebar shows no Setup header.
- **AC-50.2** Given an Admin grants that role View on one child, then on the user's next load Setup shows with only that item.
- **AC-50.4** Given a role without Create on `projects`, then New project is hidden, and `POST /projects` returns 403.
- **EC-88** A collapsed Setup group whose children are all removed stays hidden. Restoring access shows it in its default state.

### E. My tasks: next allowed tab

| ID | Requirement | Priority |
|---|---|---|
| FR-TSK-28 | **Tabs in order, with required permission (Deven, doc 11 FR-ACL-20):** Today (`tasks.view` **and** `time.view`; Today is the timer and time-logging tab), Day timesheet (`time.view`), Due (`tasks.view`), Assigned to me (`tasks.view`), I'm accountable (`tasks.view`), To review (`approvals.edit`), Completed (`tasks.view`). **Default tab** = the first allowed tab in this order (no role-specific default; e.g. a Viewer without `time.view` lands on Due through this rule). Tabs that aren't allowed are hidden. If the selected or default tab isn't allowed, the **next allowed tab to the right** is selected, wrapping around to the start (display order per FR-TSK-22). | Must |
| FR-TSK-29 | **None allowed:** **My tasks is hidden** from navigation on web and mobile, and its URL returns the Not found page. Sign-in landing (currently My tasks) goes to the next page the user can open, in sidebar order. *(Q-61 resolved.)* | Must |
| FR-TSK-30 | **Deep links** (for example `?tab=day-timesheet`, or notification links): an allowed tab opens directly. A tab that isn't allowed, or an unknown key, opens the next allowed tab to the right (wrapping). The URL is replaced so Back doesn't loop, and a notice shows: "You don't have access to that view." The API for a denied tab still returns 403 or 404. | Must |

- **US-51** As a user, I want My tasks to open on a tab I can use, so I never land on an error.
- **AC-51.1** Given a user not allowed Day timesheet, when a deep link to it opens, then Due opens (the next allowed tab to the right), the URL updates, and the notice shows.
- **AC-51.4** Given a Viewer with `tasks.view` but not `time.view`, when they open My tasks without a tab, then Today and Day timesheet are hidden and Due is selected (`defaultTab` = `due`). Given a user with both, Today is selected.
- **AC-51.2** Given a user allowed only Today, when the selected tab is Completed, then the selection wraps to Today.
- **AC-51.3** Given no allowed tabs, then My tasks isn't in the menu, its URL shows Not found, and sign-in lands on the next page they can open, in sidebar order.
- **EC-89** Permission removed while the user is on a tab: the next request returns 403, and the page re-selects per FR-TSK-28.

### F. Log task time and Add quick activity ⚑

| ID | Requirement | Priority |
|---|---|---|
| FR-ACT-29 | **Time logging** and **My tasks › Day timesheet** get two header buttons: **Log task time** (primary) and **Add quick activity** (secondary). They **replace** "+ Add entry", and the Today tracker's "+ Quick activity" is replaced by **Add quick activity** (Q-62 resolved). | Must |
| FR-ACT-30 | **Log task time** opens the manual entry form for a project task. The project picker keeps today's visibility. Activity type preselect follows FR-PTY-04 unchanged. | Must |
| FR-ACT-31 | **Add quick activity** opens the quick-activity form (FR-ACT-06) with **Activity Type preselected as "Quick Activity"**. The user can change it to another type, and the entry stays a quick activity (no project). This is a system preselect, separate from FR-PTY-04: the project-type default still never applies to quick activities. *(Q-63 resolved, Deven.)* | Must |
| FR-ACT-32 | **New system Activity type "Quick Activity" (Deven):** fixed key `quick_activity`, seeded once (insert if missing). It **can't be deactivated, renamed or deleted** (API 422 `SYSTEM_ACTIVITY_TYPE`). It can't be a Project type default. In **Setup › Activity types** its row shows a **"System type"** badge and has **no Edit or Deactivate** controls. The **Add quick activity** form shows it preselected. **No backfill or migration** of existing entries *(Q-63 resolved)*. Quick Activity entries default to **Billable = No** (editable; Q-65 resolved, consistent with FR-ACT-15). | Must |
| FR-ACT-33 | **No time logging on future dates:** both buttons, Time in and all entry routes refuse a date after today (Philippine time). The API returns 422 `FUTURE_DATE`, and the date picker disables future dates. The existing guards still apply: 409 `TIMER_RUNNING` (FR-ACT-26, Switch/Cancel prompt), and 422 `DAY_LOCKED` on submitted or locked days for non-Admins, where the buttons are disabled with the FR-ACT-24 tooltip. The overlap, 24-hour cap and On Hold rules are unchanged. | Must |

- **US-52** As a team member, I want one-click buttons to log task time or a quick activity, so logging is fast.
- **AC-52.1** Given an unlocked past day or today, when I click Add quick activity, then the form opens with no project and Activity Type = "Quick Activity". When I change it to Training and save, it saves as a quick activity with Training.
- **AC-52.2** Given a project whose type defaults to Configuration, when I use Log task time on its task, then Activity Type = Configuration.
- **AC-52.3** Given a submitted day, then both buttons are disabled for a Member, and a direct POST returns 422 `DAY_LOCKED`. **(API)**
- **AC-52.4** Given a running timer, when a second start is sent, then 409 `TIMER_RUNNING`. **(API)**
- **AC-52.5** Given an Admin on Setup › Activity types, then the Quick Activity row shows "System type" with no Edit or Deactivate, and a direct API rename, deactivate or delete returns 422 `SYSTEM_ACTIVITY_TYPE`. **(API)**
- **AC-52.6** Given tomorrow's date, when any entry is posted, then 422 `FUTURE_DATE`, and the picker doesn't offer the date. **(API)**
- **EC-90** An Admin-made type already named "Quick Activity" (decided, A-21; Q-66 resolved): the system type `quick_activity` is created separately; the existing custom type is kept and automatically renamed **"Quick Activity (custom)"**; its entries are unchanged and not merged (no migration, Deven). Admins can rename or deactivate it as normal. The rename is audited as a System action (NFR-28).
- **EC-91** An older mobile client sends a quick activity without an Activity Type: the current validation applies (400), with no silent default.
- **EC-92** A timer running at 23:59 can't roll into tomorrow (FR-ACT-04 unchanged, consistent with FUTURE_DATE).

### G. API impact and mobile notes

Every rule here is enforced server-side. The Flutter app uses the same API; **mobile is on hold**, so mobile notes apply when it resumes.

| ID | Requirement | Priority |
|---|---|---|
| NFR-30 | My tasks responses for Today, Due and Assigned to me include `plannedStart` (ISO `YYYY-MM-DD`, Philippine date) or `null`. Clients omit the field when it's null. | Must |
| NFR-31 | Quick Activity is a stable system value: activity types carry `key` (`quick_activity`) and `system: true`. Clients preselect by key. It can't be deactivated, renamed or deleted (422). | Must |
| NFR-32 | `GET /api/v1/me/permissions` returns the user's effective access (doc 11 FR-ACL-21): per-record actions, Setup children (web), the New project and + Task flags, `myTasksTabs` (array of allowed tab keys only, in FR-TSK-28 tab order; `[]` when none), and `defaultTab` (the first entry of `myTasksTabs`, or `null` when none, in which case My tasks is hidden). Both fields are always present. | Must |

**Endpoints affected:**
- `GET /projects`, the Task board and project pickers: **no change** (team filter dropped)
- `DELETE /projects/:id/tasks/:taskId`: Project PM or Admin; 409 `ACTIVITY_IN_USE` with `details.blockedBy` (`time`, `evidence`, `documents`, `issues`)
- Phase create, update, reorder and delete: 422 `PROJECT_NOT_PLANNING` for PMs outside Planning
- My tasks lists: `plannedStart`
- `/tracker/entries` and `/time`: Quick Activity type; 422 `FUTURE_DATE`; unchanged `TIMER_RUNNING` and `DAY_LOCKED`
- `/settings/activity-types`: `key`, `system`, 422 `SYSTEM_ACTIVITY_TYPE`
- New: `GET /me/permissions`

**Mobile (on hold):** shows Planned date on cards (omitted when empty), applies the tab fallback and hides My tasks per `/me/permissions`, and offers both logging buttons with the same error codes. The Setup hiding rule is web only.

- **A-21** (Decided, Jomerson 2026-10-13) On seeding, an existing custom type named "Quick Activity" is renamed "Quick Activity (custom)" and kept separate from the system type, with no merge (EC-90; Q-66 resolved).
- **A-20** (Decided, Jomerson/UIE 2026-10-13) Planned date uses the same format as the Due date column on that screen.

### I. Optional template and blank projects (v1.2.5, Jomerson 2026-10-13) ⚑

**Overrides:** doc 03 FR-PRJ-01 (template\*) and doc 05 AC-09.1 (template required) — the template is now optional. FR-TPL-05 (Published only) and FR-TPL-10 (Archived not usable for new projects) still apply to the picker. Doc 06 workflow step "Select published template" becomes optional. Doc 10 FR-DOC-01: phase folders are created only for phases that come from a template (see EC-97). Doc 03 FR-PRJ-02 snapshot and FR-TSK-11 "template snapshot version": the project keeps the template **name and version as plain history only** (Q-68), shown as the Checklist label (FR-PRJ-28). **FR-TPL-06** "projects using it" count and the **dashboard Template column** (FR-DASH-02) use this history. **FR-TPL-10** "remain linked to existing projects" no longer applies (there is no link).

| ID | Requirement | Priority |
|---|---|---|
| FR-PRJ-27 | **New project: template is optional.** Field label **"Template (optional)"**, default option **"None – start blank"**, helper text **"Pre-fills a standard set of phases and activities. You can change them later."** Picker lists Published, non-archived templates only (FR-TPL-05/10). **Project type stays required** (FR-PTY-02). | Must |
| FR-PRJ-28 | **A template is only a shortcut.** Choosing one pre-fills its phases and activities as **fully editable copies**; there's no live link back, so later template changes never affect the project and project edits never affect the template (FR-PRJ-17). The project stores the template **name and version as plain history** (Q-68 resolved). The Checklist shows **"Started from {template} v{version}"** or **"Started blank"**. If templates are applied later (FR-PRJ-30), the label keeps the starting template or "Started blank"; each application is in the audit log. | Must |
| FR-PRJ-29 | **Blank project Checklist empty state:** title **"No phases yet"**, hint **"Add your first phase, or apply a template."**, primary button **"+ Add phase"**, secondary **"Apply template"**. Both buttons show only to the Project PM and Admins, and **"Apply template" shows only while the project is in Planning** (API 422 `PROJECT_NOT_PLANNING` otherwise). | Must |
| FR-PRJ-30 | **Apply template to a project that already has phases (decided, A-22; Q-67 resolved):** the template's phases and activities are **appended** after the existing ones; nothing is overwritten or deleted, and there is no replace option. A confirmation reads "This adds {n} phases and {m} activities after your existing ones. Nothing is replaced." Each application is audited. On success a toast reads **"Added {N} phases from {template name}."** | Must |
| FR-PRJ-31 | **Planning-stage editing:** while the project is in **Planning**, the Project PM (assigned manager or a PM on the team list) and Admins can **add, edit and delete phases and activities**, whether they came from a template or were added by hand. Activity deletes still follow 409 `ACTIVITY_IN_USE` (FR-PRJ-21). **Outside Planning:** phase details are locked for PMs and reopen if the project returns to Planning (FR-PRJ-23, Q-55); **adding and editing activities is never locked by status** (Q-64), and PMs can still delete unattached activities at any status (FR-PRJ-21). | Must |

- **US-53** As a Project PM, I want to start a project blank or from a template and shape its phases and activities freely during Planning, so the plan fits the client without being tied to a template.
- **AC-53.1** Given New project, when I leave Template as "None – start blank" and fill the required fields including Project type, then the project is created with no phases and the Checklist shows "No phases yet" with "+ Add phase" and "Apply template".
- **AC-53.2** Given New project without a Project type, when I save, then it's refused with the Project type field error, template or not.
- **AC-53.3** Given a project created from template T, when T is edited and republished, then the project's phases and activities are unchanged; when I rename one of its activities, T is unchanged.
- **AC-53.4** Given a Planning project with 2 phases, when the PM applies template "SAP B1 Implementation" with 3 phases, then the project has 5 phases (existing 2 first), nothing is removed, an audit entry is written, and the toast reads "Added 3 phases from SAP B1 Implementation."
- **AC-53.8** Given a project created from "SAP B1 Implementation" v3, then the Checklist shows "Started from SAP B1 Implementation v3", and the template's "projects using it" count and the dashboard Template column include it from this history. Given a blank project, then the label reads "Started blank".
- **AC-53.9** Given a Planning project with no phases, when the PM sets status to Active, then the "Leave Planning with no phases?" dialog shows; "Stay in Planning" keeps the status, and "Move on anyway" changes it.
- **AC-53.5** Given a Planning project, when the PM deletes a template-created phase and an unattached activity, then both are removed; deleting an activity with logged time returns 409 `ACTIVITY_IN_USE`. **(API)**
- **AC-53.6** Given an Active project, then "Apply template" isn't shown, a direct apply returns 422 `PROJECT_NOT_PLANNING`, phase edits are refused for the PM, and adding an activity still succeeds. **(API)**
- **AC-53.7** Given a Member or Viewer on a Planning project, then the empty-state buttons aren't shown, and direct add-phase, apply-template or delete requests return 403 (or 404 outside their scope, NFR-25). **(API)**
- **EC-94** Template deactivated, archived or unpublished while chosen on the New project form (or in the Apply template dialog): save returns 422 "This template is no longer available. Choose another or start blank."; the form keeps other values and refreshes the picker.
- **EC-95** Applying the same template twice: appended twice (duplicate phase names allowed, A-22); the confirmation warns "This template was already applied to this project."
- **EC-96** Blank project moved out of Planning with no phases (Q-69 resolved: allowed with a confirmation). Dialog title **"Leave Planning with no phases?"**, body **"This project has no phases or activities yet. Phase details will lock for PMs once it leaves Planning."**, buttons **"Stay in Planning"** (secondary) and **"Move on anyway"** (primary). After moving on, the PM can't add phases or apply a template; an Admin can add phases, or the project can return to Planning. Activities need a phase, so none can be added until then.
- **EC-97** Blank project and Documents: the Contracts folder is still created; phase folders are created when phases are added (or applied from a template), following FR-DOC-01 naming.
- **EC-98** Non-PM attempts (Member, Viewer, a PM not on the team list and not the manager): no controls; API 403 for visible projects, 404 outside scope.
- **EC-99** Template contains dependencies on phases already in the project: dependencies are copied only within the applied set; no links to existing activities are created.

- **A-22** (Decided, Jomerson 2026-10-13) Applying a template to a project with phases appends; it never replaces (Q-67).

### H. Open questions (m8-polish)

**Resolved (Lead, Deven, 2026-10-13):** Q-52 (Admins too, at any status), Q-54 (Admins exempt from the phase lock), Q-56 (empty display omitted, per Lead; format matches the Due date column by default, A-20), Q-61 (hide My tasks), Q-63 (type changeable; no backfill or migration; can't be deactivated).

**Resolved (Jomerson, "proceed" with proposed defaults, 2026-10-13):**

| ID | Question | Decision |
|---|---|---|
| Q-53 | Are other phase fields (for example, description) locked for PMs outside Planning? | Yes, all phase fields |
| Q-55 | If a project returns to Planning, does PM phase editing reopen? | Yes |
| Q-62 | Do the new buttons replace "+ Add entry" and the Today tracker's "+ Quick activity"? | Replace |
| Q-64 | Should adding or editing activities be locked by project status? | No |
| Q-65 | Is Quick Activity billable by default? | Not billable |
| Q-66 | Rename an existing custom "Quick Activity" type to "Quick Activity (custom)" and keep it separate (no merge)? | Yes (A-21) |

**Withdrawn:** Q-57 to Q-60 (team filter dropped).

**Resolved (Jomerson, "yes proceed", 2026-10-13):** Q-67 append only (A-22); Q-68 template name and version kept as plain history, no live link; Q-69 allowed with a confirmation dialog (EC-96).

**Open m8-polish questions: none.**
