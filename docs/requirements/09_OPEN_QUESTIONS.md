# 09 · Open Questions & Assumptions

## Open questions for Jomerson
Questions marked ★ blocked development or design decisions. **All ★ questions are resolved as of v0.3** (Jomerson accepted the proposed defaults on 2026-10-09). The rest can be answered during the build, and their proposed defaults apply until then.

**Decisions in effect:** single company (Xceler8) in Phase 1 · client contacts are tracked only, with no emails to them · SAP B1 is the only seeded template · basic workload and effort variance reports stay in Phase 1 · documents are signed outside the app and the signed copy is uploaded.

| ID | Question | Why it matters | Proposed default |
|----|----------|----------------|------------------|
| Q-01 ★ | Who are the first users: Xceler8's own implementation team only, or will other companies use it (multi-tenant SaaS)? | Multi-tenancy changes the data model, auth, and billing | Single company (Xceler8) in Phase 1 **✅ RESOLVED 2026-10-09 (Jomerson): default accepted.** |
| Q-02 ★ | Client interaction in Phase 1: contacts tracked only, or also email notifications/reminders to contacts? (blueprint §10) | Email needs a sending service and templates; affects password reset too | Tracked only; email used only for internal password reset **✅ RESOLVED 2026-10-09 (Jomerson): default accepted.** |
| Q-03 | AI authority for Phase 2: recommendations only, automatic routine reminders, or broader automation with approval gates? (blueprint §10) | Shapes Phase 2 design; no impact on Phase 1 build | Recommendations only |
| Q-04 ★ | Which templates to seed at launch: SAP B1 only, or also Software/API, Cloud migration, General IT? | Someone must supply activities, estimates, durations | SAP B1 only, others created in-app later **✅ RESOLVED 2026-10-09 (Jomerson): default accepted.** |
| Q-05 ★ | Keep the workload view and effort variance report in Phase 1 (mockup) or move them to Phase 2 (blueprint)? | Scope and timeline | Keep basic versions in Phase 1 **✅ RESOLVED 2026-10-09 (Jomerson): default accepted.** |
| Q-06 | For the SAP B1 template, please confirm the dependencies (06 §4) and supply default estimates and durations per activity. | Plan generation needs them | Use proposed dependencies; estimates blank until supplied |
| Q-07 | Working days and holidays: Mon–Fri? Philippine public holidays? Default timezone Asia/Manila? | Date offsets, overdue, utilization | Mon–Fri, PH holidays configurable, Asia/Manila |
| Q-08 | Progress %: count of completed tasks, or weighted by estimated hours? | Dashboard accuracy | Task count in Phase 1 |
| Q-09 | Timesheet lock: should past weeks lock? When? Does anyone approve timesheets? | Data integrity vs flexibility | Lock previous week on Monday 12:00; no approval step |
| Q-10 | Success targets and availability expectations (01 §6, NFR-21): are those reasonable? | Defines "done" for the business | As proposed |
| Q-11 | Can PMs create and publish templates, or Admin only? | Governance of the standard method | PMs can create; Admin publishes |
| Q-12 | Can a PM edit projects managed by another PM? | Permissions | View all, edit own only |
| Q-13 | Any data privacy requirements (PH Data Privacy Act, client NDAs) for storing client contact details and evidence files? | Hosting region, retention, access logs | Store minimal contact data; host in Singapore/APAC region |
| Q-14 | May a PM approve a task they own (self-approval)? | Audit/compliance | Allowed and flagged in audit |
| Q-15 | How should On Hold projects behave in health counts and time logging? | Dashboard accuracy | **✅ RESOLVED 2026-10-09 (Lean):** excluded from health counts; time logging blocked. |
| Q-16 | Hosting preference for production and preview builds (Vercel/Netlify + Atlas, Azure, on-prem)? | Deployment and cost | Front end on Vercel/Netlify previews, API + MongoDB Atlas (APAC) |
| Q-17 | Sign-in method: email/password only, or Google / Microsoft 365 single sign-on? | Auth implementation | Email/password in Phase 1, SSO later |
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
