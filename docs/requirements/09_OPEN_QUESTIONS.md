# 09 · Open Questions & Assumptions

## Open questions for Jomerson
Questions marked ★ blocked development or design decisions. **All ★ questions are resolved as of v0.3** (Jomerson accepted the proposed defaults on 2026-10-09). The rest can be answered during the build, and their proposed defaults apply until then.

**Decisions in effect:** single company (Xceler8) in Phase 1 · client contacts are tracked only, with no emails to them (*exception, 2026-10-22: a DAR Report CC may be any address, client contacts included; doc 17 Q-106*) · SAP B1 is the only seeded template · basic workload and effort variance reports stay in Phase 1 · documents are signed outside the app and the signed copy is uploaded.

| ID | Question | Why it matters | Proposed default |
|----|----------|----------------|------------------|
| Q-01 ★ | Who are the first users: Xceler8's own implementation team only, or will other companies use it (multi-tenant SaaS)? | Multi-tenancy changes the data model, auth, and billing | Single company (Xceler8) in Phase 1 **✅ RESOLVED 2026-10-09 (Jomerson): default accepted.** |
| Q-02 ★ | Client interaction in Phase 1: contacts tracked only, or also email notifications/reminders to contacts? (blueprint §10) | Email needs a sending service and templates; affects password reset too | Tracked only; email used only for internal password reset **✅ RESOLVED 2026-10-09 (Jomerson): default accepted.** *Amended (Jomerson, 2026-10-22, 8:29 PM SGT):* DAR Send (Q-49 revised, doc 14 §13) emails the supervisor and Report CC list from the user's own mailbox, and any address may be a Report CC, client contacts included (doc 17 Q-106). The app still sends nothing to client contacts by itself. |
| Q-03 | AI authority for Phase 2: recommendations only, automatic routine reminders, or broader automation with approval gates? (blueprint §10) | Shapes Phase 2 design; no impact on Phase 1 build | Recommendations only. **On hold (2026-10-13, 9:15 PM SGT):** Phase 2 waits until the whole app is built and working. |
| Q-04 ★ | Which templates to seed at launch: SAP B1 only, or also Software/API, Cloud migration, General IT? | Someone must supply activities, estimates, durations | SAP B1 only, others created in-app later **✅ RESOLVED 2026-10-09 (Jomerson): default accepted.** |
| Q-05 ★ | Keep the workload view and effort variance report in Phase 1 (mockup) or move them to Phase 2 (blueprint)? | Scope and timeline | Keep basic versions in Phase 1 **✅ RESOLVED 2026-10-09 (Jomerson): default accepted.** |
| Q-06 | For the SAP B1 template, please confirm the dependencies (06 §4) and supply default estimates and durations per activity. | Plan generation needs them | Use proposed dependencies; estimates blank until supplied |
| Q-07 | Working days and holidays: Mon–Fri? Philippine public holidays? Default timezone Asia/Manila? | Date offsets, overdue, utilization | Mon–Fri, PH holidays configurable, Asia/Manila |
| Q-08 | Progress %: count of completed tasks, or weighted by estimated hours? | Dashboard accuracy | **Resolved (Lean, 2026-10-09):** share of tasks completed |
| Q-09 | Timesheet lock: should past weeks lock? When? Does anyone approve timesheets? | Data integrity vs flexibility | ~~Built as an Admin setting defaulting to Monday 12:00 PM PHT, no approval step; policy pending Jomerson~~ **✅ RESOLVED 2026-10-13, 9:15 PM SGT (Jomerson):** a day stays editable until the end of the second day after its work date and locks at 00:00 Philippine time on the third day (Oct 13 locks Oct 16, 00:00 PHT); no approval step. Example: Oct 13 is editable on Oct 14 and 15, locked from Oct 16, 00:00 PHT. Deven checks whether the build already does this; if not, it changes after 00:41. See FR-TIME-04, AC-18.7, doc 14 FR-ACT-36, AC-52.7 |
| Q-10 | Success targets and availability expectations (01 §6, NFR-21): are those reasonable? | Defines "done" for the business | As proposed |
| Q-11 | Can PMs create and publish templates, or Admin only? | Governance of the standard method | **Resolved (Jomerson, 2026-10-09):** PMs can create and publish; publishing follows Edit on Templates |
| Q-12 | Can a PM edit projects managed by another PM? | Permissions | **Resolved (Jomerson, 2026-10-09):** view all, edit and archive own only |
| Q-13 | Any data privacy requirements (PH Data Privacy Act, client NDAs) for storing client contact details and evidence files? | Hosting region, retention, access logs | Store minimal contact data; host in Singapore/APAC region. *(The separate xAI data privacy call, phase2 Q-AI-01, is on hold, see Decisions of 2026-10-13, 9:15 PM SGT.)* |
| Q-14 | May a PM approve a task they own (self-approval)? | Audit/compliance | Allowed and flagged in audit |
| Q-15 | How should On Hold projects behave in health counts and time logging? | Dashboard accuracy | **✅ RESOLVED 2026-10-09 (Lean):** excluded from health counts; time logging blocked. |
| Q-16 | Hosting preference for production and preview builds (Vercel/Netlify + Atlas, Azure, on-prem)? | Deployment and cost | Front end on Vercel/Netlify previews, API + MongoDB Atlas (APAC) |
| Q-17 | Sign-in method: email/password only, or Google / Microsoft 365 single sign-on? | Auth implementation | ~~Email/password in Phase 1, SSO later~~ **Superseded (2026-10-20, approved by Jonathan):** Microsoft 365 sign-in alongside email/password, per PR #27 (doc 14 §1). New Microsoft users from the allowed tenant and domain are auto-created as **Viewer** with `jobRole: null` and get 403 on the DAR (`/dar/*`) until an Admin assigns a role (doc 14 FR-SSO-04). |
| Q-18 | Do you need multiple currencies/billing rates or cost tracking on time entries? | Not in blueprint; affects time data model | No; hours only |
| Q-19 | Should evidence files have a retention period or size quota? | Storage cost | No retention limit; 25 MB per file |

Document management questions Q-20 to Q-25 are in [10 §9](10_DOCUMENT_MANAGEMENT.md). Q-20 is resolved: documents are signed outside the app in Phase 1.

## Assumptions (valid unless corrected)
| ID | Assumption |
|----|-----------|
| A-01 | Phase 1 has no AI calls; the AI insights panel is a placeholder. |
| A-02 | Gantt/timeline view is Phase 2; the Timeline tab is a placeholder. |
| A-03 | Tickets and formal QA workflows are Phase 2; Phase 1 approval uses the task For Review state. |
| A-04 | A read-only "Viewer" system role is needed for executives (not in blueprint). |
| A-05 | One accountable owner per task is mandatory before a project becomes Active. |
| A-06 | Milestones in Phase 1 are tasks flagged `isMilestone`; a separate milestones collection comes in Phase 2. |
| A-07 | The UI is English only. |
| A-08 | The mockup's numbers and names are example data and not requirements. |
| A-09 | Health thresholds (5 days) are a starting point that Admin can change. |
| A-11 | Documents are signed outside the app in Phase 1, and the signed copy is uploaded (matches mockup v0.2). |
| A-10 | Competitor notes in 01 §5 are a desk-research summary from public product information and should be validated before being used in marketing material. |

## Feedback on mockup v0.1 for UIE (from requirements). ✅ Addressed in mockup v0.3
- Add screens/states not in the mockup: Login, first-time password set, Admin (users/teams/clients/settings), template editor (phases, activities, dependencies), task create/edit form, approve/reject dialog, blocked-reason dialog, dependency-blocked message, My tasks, empty states for each list, 403/404 pages.
- Task board needs a keyboard/non-drag alternative for status changes (NFR-15).
- Health badges need a text label and not color alone (already true in v0.1; keep it).
- Show "template snapshot vN" on project detail (already present) and the plan-exceeds-baseline warning (EC-13).

## Clarifications from QA test planning (v0.3.1, decided by Lean 2026-10-09)
| Item | Decision | Updated in |
|------|----------|-----------|
| Health with variance 0 and an overdue optional task | At risk | FR-PRJ-10, AC-11.3 |
| On Hold projects | Excluded from health counts, and time logging blocked | FR-TIME-08, AC-18.6, EC-28, Q-15 |
| File size limit | 25 MiB = 26,214,400 bytes | FR-DOC-13, FR-TSK-07, AC-27.1, EC-41 |
| Session idle timeout | 30 minutes | FR-AUTH-03, AC-01.5 |
| Sign-in lockout | 5 failures per account, then a 15-minute lock, plus a per-IP rate limit | FR-AUTH-07, AC-01.3, NFR-05 |

## Decisions from Milestone 1 (v0.3.3, Jomerson 2026-10-09)
| Item | Decision | Updated in |
|------|----------|-----------|
| Password minimum | 8 characters | FR-AUTH-02, AC-02.2 |
| Landing page after sign-in | My tasks until the Dashboard ships in Milestone 4 | AC-01.1 |
| Invite and reset delivery | Single-use links copied by an Admin and shared by hand. Email is deferred | FR-AUTH-04, FR-AUTH-05, AC-02.6 |
| Link expiry | 72 hours for invites, 24 hours for resets. **Proposed by Rich; change it if you prefer other values** | FR-AUTH-04, FR-AUTH-05 |
| Password complexity | At least 8 characters, plus a number and a symbol (Jomerson) | FR-AUTH-02, AC-02.2 |
| Absolute session cap | 12 hours (PR #1, accepted) | FR-AUTH-03, AC-01.5b |
| Lockout response | Lock silently with the generic 401, not 423 (Lean) | FR-AUTH-07, AC-01.3 |
| Invite and reset tokens | Sent in a POST body, not a GET path (Lean) | FR-AUTH-04, FR-AUTH-05 |
| Rate limiter store | In memory with one pinned instance for now; shared store before scale-out is tech debt TD-01 (Lean) | NFR-05 |

## Decisions of 2026-10-13, 9:15 PM SGT
| Item | Decision | Updated in |
|------|----------|-----------|
| Timesheet lock (Q-09) | **Jomerson:** a day stays editable until the end of the second day after its work date and locks at 00:00 Philippine time on the third day (Oct 13 locks Oct 16, 00:00 PHT) (same PHT convention as before; the moment moves from the old Monday 12:00 PM weekly default to midnight, per Jomerson's example). Oct 13 is editable on Oct 14 and 15, locked from Oct 16, 00:00 PHT. **Deven** checks whether the build already does this; if not, it changes after 00:41. | Q-09, FR-TIME-04, AC-18.7, doc 14 FR-ACT-02/04/13/36, AC-52.7 |
| Azure Defender for Storage (Q-29) | **Not required for now. Deferred.** Off the go-live checklist; uploads keep our own file checks. | doc 12 FR-EVD-08, Q-29 |
| Module field | **Stays free text.** The old stored Modules list stays in the database and is **not deleted** (permanent removal is no longer pending). | doc 14 FR-ACT-22 |
| HR leave amounts | **Keep the placeholder numbers for now.** | doc 14 §4 (FR-LV-02) |
| Phase 2 (AI insights, e-signature) and the xAI data privacy call | **On hold** until the whole app is built and working. | Q-03, Q-13, phase2 Q-AI-01, doc 10 Q-20 |
| Test accounts | **No password rotation after M8.** All dummy test accounts use the standard test password, which is **not recorded in the docs**. Queen keeps a list of test accounts (**email and role only**) in the QA report. | QA reports |
| Doc 11 portal questions | Q-73 to Q-76 set aside by Jomerson: build on the current defaults, no decision needed. New portal build defaults from Lean (Q-77 to Q-81), pending Jomerson. | doc 11 §10 |

> **Q-09 confirmed by Jomerson (2026-10-13, 10:13 PM SGT):** example work date Oct 11 can be changed on Oct 12 and 13 and locks at 00:00 PHT on Oct 14; after that only an Admin reopening the day allows changes.

## Decisions of 2026-10-22, 8:29 PM SGT (Jomerson, lead developer; doc 17 v0.3 §0a)
| Item | Decision | Updated in |
|------|----------|-----------|
| Uninvited Microsoft accounts (doc 17 Q-90, CR-02) | **Keep auto-creating** allowed-tenant accounts with no user **as Viewer**; they are not refused. Viewer = internal read-only staff with no time, tracker, DAR or leave access (Q-70 B, Q-72 No). Jomerson confirms what doc 14 v1.2.26 recorded; Q-37 is superseded. | doc 14 FR-SSO-04, Q-37, FR-ACT-35 (v1.2.29) |
| Action-email box (doc 17 Q-101, CR-09) | **Ticked by default** ("Email {name}", "Email the team", "Email new members"), as built. | doc 14 FR-ACT-35 note; roadmap §4 (already says ticked) |
| DAR Send and Q-49 (doc 17 CR-04) | **Keep DAR Send. Q-49 revised:** DAR can be viewed, exported **and sent**, because the features were updated (PR #29). | doc 14 §13 Q-49 (v1.2.29) |
| Mobile scope (doc 17 Q-92 part, CR-11, CR-13) | **Mobile DAR Send and email notifications (PR #41) are in scope.** #41 is off hold now that PR #42 is merged, and is rebased onto the merged branch. The mobile Send flow must handle the server's 409 "Already sent"; a full mobile confirm-and-resend step is part of #41. | doc 14 §G; doc 16 header; roadmap §4 |
| DAR CC outside our domain (doc 17 Q-106, CR-17) | **Not blocked; any email address is allowed.** Format still checked, up to 5 addresses, duplicates removed, Admin-only and audited (FR-DAR-17). | doc 14 FR-DAR-01; Q-02 above; doc 01 |
| PR merges | **#26, then #42, approved for merge** (record only). | doc 17 §4 |
| Microsoft sign-in | **Live** on web (PRs #27, #32) and mobile (PR #28); see Q-17 above. Not changed by this round. | — |
| Auto-created Viewers' job role (doc 17 Q-91, CR-02; Jomerson, 2026-10-22, 8:38 PM SGT) | **Decided:** they start with **no job role**, and an Admin sets it from Users. | doc 03 FR-USR-01 exception; doc 14 FR-SSO-04 |
| Mobile Microsoft sign-in (doc 17 CR-03, Q-92 sign-in part; Jomerson, 2026-10-22, 8:38 PM SGT) | **Decided:** it already works (Jomerson confirmed 9 sign-ins), and PR #41 uses it as it is. | doc 14 §G |
| Still open | Doc 17 CR-14 (the bot's edits to docs on `main`, including "approved by Jonathan"), Q-88, Q-89, Q-91, *(Q-91 decided at 8:38 PM SGT, see above)* the rest of Q-92 (M8 catch-up), Q-93 to Q-100 and Q-102 to Q-105. | doc 17 §2 |

## Client archive (doc 17 CR-18; added 2026-10-23, 12:30 PM SGT; revised 12:40 PM SGT)
Lean approved the scope on 2026-10-23: archive only, no hard delete. **Partly built:** "Deactivate client" / "Reactivate client" already exists on `main` (3bf528e, checked by Deven). It sets the `active` flag, never deletes, is audited, hides the client behind "Show inactive" and from the New project picker, and needs Delete on `clients`. The UI words stay as built (no rename to "Archive"). New work: an open-project check (Q-107), no portal sign-in for an inactive client's contacts (once the portal exists), and an optional audit reason (nice-to-have). The QA test client left over from DEF-017 can be deactivated today with Jomerson's OK.

| ID | Question | Why it matters | Proposed default |
|----|----------|----------------|------------------|
| Q-107 | Can a client with open projects (Planning, Active or On Hold) be deactivated? (A) Block it until they're completed, cancelled or archived; (B) allow it and leave the projects as they are (today's build); (C) allow it and close or archive the projects in the same step. | Today nothing checks, so a client with Active projects can be deactivated and drop out of pickers while people still work on them | **A, block** with "{client} can't be deactivated because it has {n} open project(s). Complete, cancel or archive them first." and a linked list (doc 17 FR-CLI-18). **Open, for Jomerson.** |
| Q-108 | Is "archived" the same as the existing client `active` flag (doc 03 FR-CLI-01, doc 07), or a separate field? | Two hidden states would confuse lists, pickers and reports | **✅ DECIDED 2026-10-23 (Lean): reuse the existing `active` flag.** Archived = inactive (Deactivate client); no separate field. |
