# 08 · Edge Cases

| ID | Area | Scenario | Expected behavior |
|----|------|----------|-------------------|
| EC-01 | Calculations | Task with estimate 0 and actual > 0 | Variance = actual; overrun shows "No estimate", never ∞/NaN/divide error |
| EC-02 | Calculations | Estimate 0 and actual 0 | Variance 0; overrun "No estimate" |
| EC-03 | Calculations | Project with 0 tasks, or all cancelled | Progress 0%; forecast = baseline end; health On track |
| EC-04 | Calculations | Utilization when capacity = 0 (e.g. part-time set to 0, or on leave) | Show "–" not ∞; exclude from team average |
| EC-05 | Calculations | Sum of many quarter-hour entries | Exact totals (no 13.999999); stored as integer quarter-hours |
| EC-06 | Time | Entry exactly 24 h, or daily total exactly 24 h | Allowed; 24.25 rejected |
| EC-07 | Time | User in UTC+8 logs late night; server in UTC | Work date stays the date the user picked |
| EC-08 | Time | User removed from project after logging time | Existing entries remain and count in reports; no new entries allowed |
| EC-09 | Time | Task deleted that has time entries | Hard delete blocked; task must be Cancelled instead |
| EC-10 | Time | Editing an entry in a locked week | Members blocked; PM/Admin allowed with audit |
| EC-11 | Templates | Template edited while a PM is in the middle of creating a project from it | Project uses the version shown at preview; if it changed, warn and re-preview |
| EC-12 | Templates | Dependency on an activity that's later deleted from the draft | Dependency removed with a warning before save |
| EC-13 | Templates | Template with a long chain causing generated dates past baseline end | Generate anyway; show warning "Plan exceeds baseline end by N days"; health reflects it |
| EC-14 | Templates | Archiving a template used by active projects | Allowed; projects keep snapshot; template hidden from picker |
| EC-15 | Dependencies | Cycle created via edits in a running project (A→B, then B→A) | Rejected server-side |
| EC-16 | Dependencies | Predecessor cancelled | Treated as satisfied (cancelled ≠ blocking), with a visible note |
| EC-17 | Dependencies | Completed predecessor reopened | Dependent tasks already In Progress stay; show warning on them |
| EC-18 | Status | Two users move the same task at the same time | Optimistic concurrency (version field); second gets "This task changed, refresh" |
| EC-19 | Status | Blocked task passes its due date | Counted as overdue and as blocked |
| EC-20 | Status | Requires-approval task where the owner is also the PM | PM may approve own task (Q-14) and it's audited as self-approval |
| EC-21 | Client contacts | Contact email equals an internal user's email | Allowed (separate collections); login still only matches users |
| EC-22 | Client contacts | Attempt via API to set a password/role on a contact, or add contact id to assigneeIds/ownerId | Rejected (400/403) |
| EC-23 | Client contacts | Contact deactivated while tagged on open tasks | Tasks keep the tag shown as "(inactive)"; PM prompted to reassign |
| EC-24 | Client contacts | Project's client changed after contacts were tagged | Blocked if tasks have contacts from the old client; PM must clear them first |
| EC-25 | Users | Accountable owner deactivated | Open tasks flagged "owner inactive" on dashboard and project; PM reassigns |
| EC-26 | Users | Last Admin tries to demote or deactivate themselves | Rejected; at least one active Admin required |
| EC-27 | Projects | Baseline end in the past at creation (backfilling an old project) | Allowed with warning |
| EC-28 | Projects | Project put On Hold | Excluded from Delayed/At risk counts; health shows "On hold"; time logging blocked (Lean decision, 2026-10-09) |
| EC-29 | Projects | Duplicate project name for same client | Allowed with warning |
| EC-30 | Evidence | Upload interrupted / file over limit / disallowed type | Clear error; no orphan metadata |
| EC-31 | Evidence | Evidence removed from a Completed approved task | Only PM/Admin; audited |
| EC-32 | Reports | CSV values with commas, quotes, line breaks, non-ASCII names (ñ, é) | Proper escaping, UTF-8 with BOM for Excel |
| EC-33 | Reports | CSV injection (value starting with =, +, -, @) | Prefix with `'` on export |
| EC-34 | Reports | Very large date range | Paginated on screen; streamed export |
| EC-35 | Auth | Session expires while filling a form | Form data preserved locally; user re-auths and can resubmit |
| EC-36 | Auth | User role changed while signed in | Next request uses new permissions |
| EC-37 | Dates | Due dates on weekends/holidays when offsets use working days | Skip non-working days per settings (Q-07) |
| EC-38 | Search | Search returns tasks from projects the user can't access | Must never happen (server-side filter) |

Document management edge cases EC-39 to EC-51 are in [10 §8](10_DOCUMENT_MANAGEMENT.md).
