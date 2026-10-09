# 14 — Microsoft Sign-in, Activity Tracker, Daily Activity Report, Leave, PM View

**Status:** v0.8.1 draft for Jomerson's approval · **Author:** Rich · **Date:** 2026-10-09
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
