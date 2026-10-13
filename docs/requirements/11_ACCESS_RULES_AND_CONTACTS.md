# 11 — Access Rules Module and Client Contacts Changes (Milestone 1.5)

**Status:** v0.4.19 — permissions path corrected to as-built `GET /auth/me/permissions` (room, 2026-10-13, build `2262fed`; was `/api/v1/me/permissions` / `/me/permissions`) · v0.4.18 — §6 `activities`, `leave`, `issues` defaults confirmed (Deven, `packages/shared/src/accessRules.ts`, relayed by Lean, 2026-10-13); Viewer `activities` VCED is live, a known gap under Q-70 default B · v0.4.17 — Q-70 open (Viewer access to `time`; default B, no time access, until Jomerson decides); Viewer own-records working rule (Lean, 2026-10-13); §6 `activities`, `leave`, `issues` values pending Deven · v0.4.16 — §6 Reports Export and Team & workload defaults confirmed (Deven, 2026-10-13) · v0.4.15 — doc 14 Q-67 to Q-69 resolved; no open questions · v0.4.14 — Planning-stage phase/activity editing and Apply template rights (doc 14 §I) · v0.4.13 — m8-polish access changes approved for build (Jomerson, 2026-10-13) · v0.4.12 (FR-ACL-18 team filter dropped by Jomerson; Q-12 stands) · v0.4.11 (Setup child and My tasks tab permission keys, defaultTab = first allowed, ACTIVITY_IN_USE for Admins too) · v0.4.10 (Lead's m8-polish decisions: Admin exemptions, ACTIVITY_IN_USE, team definition, tab wrap, permission-driven buttons) · v0.4.9 (m8-polish) · v0.4.8 (Reports and Team & workload rows) · v0.4.3 — built and passed (PR #2); model approved by Jomerson (four fixed roles; Q-26, Q-27 resolved) · **Author:** Rich · **Date:** 2026-10-09
**Source:** Jomerson (room, 2026-10-09 2:29 PM); Lean (Milestone 1.5 scope); Queen (safety rules); UIE (mockup v0.5 plan).
**Decision:** permissions are set **per Access role** (Admin, PM, Member, Viewer), not per Job role (Jomerson, 2026-10-09).

## 1. Scope
1. **Access rules module (Milestone 1.5):** Admins set View, Create, Edit and Delete per record type for each Access role. Replaces the fixed matrix in doc 07 §4, which becomes the seeded defaults.
2. **Clients screen, Contacts tab (Milestone 1.5):** contacts move into the client's detail page; the separate Client contacts page is removed.
3. **Project, Active contacts (Milestone 2):** each project picks its active contacts from its client's contacts.

Out of scope: per-Job-role or per-user permissions, field-level permissions, custom roles (adding roles beyond the four; Jomerson chose the four fixed roles, 2026-10-09), and the client account owner (parked by Jomerson).

## 2. Business requirements
| ID | Requirement |
|----|-------------|
| BR-21 | Admins can change what each Access role may view, create, edit and delete without a code change. |
| BR-22 | Configurable permissions must never lock all Admins out or widen access beyond a user's projects for Members. |
| BR-23 | Client contacts are managed from their client, and each project shows which of its client's contacts are active on it. |

## 3. Record types (rows in the grid)
| Key | Record type | Notes |
|-----|-------------|-------|
| `users` | Users & invites | Includes invite and reset links |
| `teams` | Teams | |
| `settings` | Settings | |
| `accessRules` | Access rules | This module |
| `clients` | Clients | |
| `contacts` | Client contacts | |
| `templates` | Templates | Publish counts as Edit |
| `projects` | Projects | Includes plan, dates, owners, dependencies, active contacts |
| `tasks` | Tasks | Includes status, evidence, notes |
| `approvals` | Task approvals | Only Edit applies (approve/reject) |
| `time` | Time entries | |
| `documents` | Documents & folders | Signed versions stay locked regardless (FR-DOC) |
| `reports` | Reports & dashboard | Only View applies |
| `workload` | Team & workload | Only View applies (added v0.4.8) |
| `audit` | Audit log | Only View applies; never editable or deletable by anyone |

Actions that don't apply to a record type are shown disabled in the grid and rejected by the API.

## 4. Functional requirements
| ID | Requirement | BR | Priority |
|----|-------------|----|----------|
| FR-ACL-01 | Permissions are stored per Access role × record type × action (View, Create, Edit, Delete). | BR-21 | Must |
| FR-ACL-02 | On first deploy, permissions are seeded from today's fixed matrix (§6). "Reset to defaults" restores them per role, with a confirmation. | BR-21 | Must |
| FR-ACL-03 | Only users whose role has Edit on `accessRules` can change permissions. | BR-21 | Must |
| FR-ACL-04 | Create, Edit or Delete implies View. Granting any of them grants View; View can't be removed while any is granted (UI and API). | BR-21 | Must |
| FR-ACL-05 | **Safety rule 1 (Queen):** Admin's View, Create, Edit and Delete on `users` and `accessRules` are locked on and can't be changed by UI or API (API returns 422). | BR-22 | Must |
| FR-ACL-06 | **Safety rule 2 (Queen):** a saved change applies on each affected user's very next request, with no sign-out needed and no stale cache. | BR-22 | Must |
| FR-ACL-07 | **Scope limits stay fixed and are not configurable:** Members only ever act within projects they belong to (and on their own tasks/time where the record type says so); PMs edit only projects they manage unless Q-12 decides otherwise. A permission grant can never widen these scopes. | BR-22 | Must |
| FR-ACL-08 | Every check is enforced in the API on every request. The UI hides or disables actions the user lacks, but hiding is never the control. | BR-22 | Must |
| FR-ACL-09 | Denied requests return 403 with code `FORBIDDEN` and don't reveal whether the record exists in another scope (404 for records outside the user's scope). | BR-22 | Must |
| FR-ACL-10 | Each saved change writes an audit entry: who, when, role, record type, action, old value, new value. | BR-21 | Must |
| FR-ACL-11 | Saving shows a confirmation that the change takes effect immediately for all users with that role. Unsaved changes show a Save bar and warn on leaving the page. | BR-21 | Should |
| FR-ACL-12 | Concurrent edits: saving with an out-of-date version returns 409 and the screen asks to reload (optimistic versioning). | BR-21 | Should |
| FR-ACL-13 | The current user can see a read-only summary of their own role's permissions (e.g. on My profile). | BR-21 | Could |
| FR-CLI-09 | Client detail page has **Details** and **Contacts** tabs. The contact list, "+ Add contact", edit, deactivate and the "no login / tracked only" notice live in the Contacts tab. The standalone Client contacts page is removed, and its old URL redirects to Clients. | BR-23 | Must |
| FR-CLI-11 | Client detail page has a **Projects** tab (next to Details and Contacts) listing the client's projects with manager, start date, planned end, progress and status badge, filterable by status; archived projects are hidden unless the Archived filter is chosen. Each name opens the project. In Milestone 1.5 the tab shows "No projects yet"; it fills in Milestone 2. | BR-23 | Must |
| FR-CLI-12 | **Scope rule (Queen):** the Projects tab and its count follow the user's project scope (FR-ACL-07). A Member sees and counts only projects they belong to, enforced in the API, so other project names and statuses never leak. | BR-22 | Must |
| FR-CLI-10 | A contact always belongs to exactly one client (unchanged from FR-CLI-02); creating it from the Contacts tab sets the client automatically. | BR-23 | Must |
| FR-PRJ-11 | (Milestone 2) A project has an **Active contacts** list chosen only from its own client's active contacts (API-enforced). Shows name, position, email, phone, with remove. | BR-23 | Must |
| FR-PRJ-12 | (Milestone 2) If the client has no contacts, the panel says so and links to the client's Contacts tab (if the user can create contacts). | BR-23 | Should |
| FR-PRJ-13 | (Milestone 2) Deactivating a contact keeps it on past projects marked "Inactive" but removes it from the picker. Changing a project's client clears its active contacts after a confirmation. | BR-23 | Must |

Editing a project's active contacts requires Edit on `projects`.

## 5. User stories
- **US-33** As an Admin, I want to set what each role can view, create, edit and delete, so access matches how we work.
- **US-34** As an Admin, I want the system to stop me from removing Admin access to users and access rules, so we can't lock ourselves out.
- **US-35** As an Admin or PM, I want to manage a client's contacts inside that client, so everything about the client is in one place.
- **US-36** (M2) As a PM, I want to choose which client contacts are active on my project, so the team knows who to follow up with.

## 6. Seeded defaults (from today's matrix, doc 07 §4)
V = View, C = Create, E = Edit, D = Delete. Scope limits (FR-ACL-07) apply on top.

| Record type | Admin | PM | Member | Viewer |
|-------------|-------|----|--------|--------|
| users 🔒 | VCED | – | – | – |
| teams | VCED | – | – | – |
| settings | VE | – | – | – |
| accessRules 🔒 | VE | – | – | – |
| clients | VCED | VCED | V | V |
| contacts | VCED | VCED | V | V |
| templates | VCED | VCED (publish = Edit, Q-11) | V | V |
| projects | VCED | VCE + archive (own for E/archive) | V | V |
| tasks | VCED | VCED | VE (own tasks) | V |
| approvals | E | E (own projects) | E (designated reviewer only) | – |
| time | VCED | VCED | VCED (own entries; Lean, 2026-10-09) | – |
| documents | VCED | VCED | VC | V |
| reports | V + Export 🔒 | V + Export | V + Export | V + Export |
| workload | V 🔒 | V | V | V |
| audit | V | – | – | – |
| activities | VCED | VCED | VCED | VCED |
| leave | VCED | VCED | VCED | VCED |
| issues | VCED | VCE | VCE | V |

🔒 = Admin row locked (for `reports` and `workload`, the Admin cell is locked: an Admin always has these and can't remove them). `reports` Export and `workload` View confirmed by Deven, 2026-10-13, from `packages/shared/src/accessRules.ts`. `accessRules` and `settings` only have View and Edit. Documents defaults follow doc 10's permissions; doc 10 wins if they differ.

**Working rule (Lean, 2026-10-13, v0.4.17):** Viewers may view, create, edit and delete **only their own leave and their own tracker entries** (tracker entries subject to Q-70), and get **View only on issues**. Any Viewer access beyond their own records is a defect.

**Own records (v0.4.18):** for every role, `activities` and `leave` are limited to the person's own records, with View on their direct reports' records. The `activities`, `leave` and `issues` values were confirmed by Deven from `packages/shared/src/accessRules.ts` (relayed by Lean, 2026-10-13). Viewer `activities` VCED is what's live now; under Q-70 default B it should be off, so it is a known gap until Jomerson decides (§10).

## 7. Acceptance criteria
- **AC-33.1** Given an Admin unticks PM's Delete on `clients` and saves, when a PM sends DELETE on a client on their next request, then the API returns 403 and the button is hidden. **(API)**
- **AC-33.2** Ticking Edit auto-ticks View; unticking View while Edit is on is blocked in the UI, and a direct API payload with Edit without View returns 422. **(API)**
- **AC-33.3** Granting Member Edit on `projects` still doesn't let a Member edit a project they aren't on (403/404). **(API)**
- **AC-33.4** Each save creates one audit entry per changed cell with old and new values.
- **AC-33.5** Two Admins edit at once; the second save gets 409 and a reload prompt.
- **AC-33.6** "Reset to defaults" restores §6 for that role after confirmation, including Reports View and Export and Team & workload View (v0.4.16).
- **AC-34.1** The Admin cells on `users` and `accessRules` are disabled with an explanation, and a direct API attempt to remove them returns 422. **(API)**
- **AC-35.1** Clients › a client › Contacts tab lists only that client's contacts; adding one there attaches it to that client; the old contacts URL redirects to Clients.
- **AC-35.2** (M2) A Member opening a client sees only projects they belong to, and the tab count matches; the API list endpoint returns only those projects. **(API)**
- **AC-35.3** In Milestone 1.5 the Projects tab shows "No projects yet".
- **AC-36.1** (M2) The project contact picker lists only the project client's active contacts; an API attempt to attach another client's contact returns 422. **(API)**

## 8. Technical notes
- Collection `accessRules`: one document per role `{ role, permissions: { <recordType>: { view, create, edit, delete } }, version, updatedBy, updatedAt }`.
- A single middleware `can(recordType, action)` runs after authentication and before the scope check; routes declare their record type and action. Unknown routes default to deny.
- To meet FR-ACL-06, read rules per request (four small documents) or cache with invalidation on save. Note TD-01: an in-memory cache is only safe while the App Service stays on one instance.
- The mockup and API share the record type keys in §3 from the `shared` package so they stay in step.

## 9. Edge cases
- **EC-52** The last Admin is demoted or deactivated: still blocked (existing rule), independent of the access grid.
- **EC-53** A user's permission is removed while they have a form open: the save returns 403 and the form shows "You no longer have permission to do this."
- **EC-54** View on `projects` removed from Viewer: the dashboard and reports show nothing project-related rather than erroring.
- **EC-55** A Member loses Edit on `tasks` while assigned open tasks: the tasks stay assigned but read-only to them; the PM is unaffected.
- **EC-56** A deleted client with contacts on projects: deletion is blocked (FR-CLI-08 pattern); deactivate instead.
- **EC-57** Payload with an unknown record type or action: 422, nothing saved.

## 10. Assumptions and open questions
- **A-12** Scopes (own projects, own tasks) are fixed in code for 1.5; making them configurable is a later change.
- **A-13** Job roles stay as labels for reporting and workload and don't affect permissions.
- **Q-26 (resolved, Jomerson 2026-10-09):** only Admins can delete projects; PMs archive their own projects instead. Archive counts as Edit on `projects`.
- **Q-27 (resolved, Jomerson 2026-10-09):** PMs don't see the access rules screen; only Admin has View on `accessRules` by default.
- **Q-70 (open, v0.4.17; on Lean's handoff list for Jomerson):** Viewer access to `time` (tracker entries). **Option A:** Viewer gets `time` View, Create, Edit and Delete limited to their own entries, so Today and Day timesheet come back and Viewers log their own day. **Option B:** Viewer keeps no `time` access (as seeded in §6 and live), can't log activities, but can still file their own leave. **Proposed default: B until Jomerson decides.** Option B also needs Viewer `activities` set to **off**; otherwise Viewers can still log their own tracker entries (Deven, 2026-10-13). The live build `2262fed` currently gives Viewer full `activities` access, so under the default (B) this is a **known gap until it's changed, not a defect**.
- **Q-11 resolved:** PMs can publish templates; publishing follows Edit on `templates`. **Q-12 resolved:** PMs view all projects but edit and archive only their own.

## 11. Accepted build deviations (Lean, 2026-10-09, PR #2)
- Undeclared routes return 404, not 403 (refines FR-ACL-08/09).
- Delete on `projects` is locked for every non-Admin role, not only PM (extends Q-26).
- Non-Admins with `users` rights can't create, change, reset, rename, deactivate or promote Admins (extends FR-ACL-05).
- Contact email stays optional (FR-CLI-02); mockup updated to match.
- FR-ACL-13 permission summary is API-only for now.
- FR-ACL-11 unsaved-changes warning fires only on tab close/reload; in-app navigation warning moves to Milestone 2 (Low).
- Per-contact Projects column and project-name links on the client Projects tab arrive with Milestone 2.
- Viewer default has no View on `teams` (per §6), so Teams is hidden from Viewer menus.

## 12. Milestone 2 build notes (PR #3, 2026-10-09)
- Accepted: Timeline, Documents and Time tabs are placeholders and evidence is links only until M3; launch template offsets/durations are placeholders (Q-06); template name "SAP B1 Implementation".
- Accepted for M2: due dates count Mon–Fri. **Still required (Q-07):** configurable Philippine public holidays, Asia/Manila; scheduled for M3 (Lean).
- **Decided (Lean, 2026-10-09):** PMs can read the project Activity log (FR-AUD-02) on projects they can view, without the global Audit log. Members and Viewers stay hidden.
- **Decided (Lean, 2026-10-09):** Draft templates are visible only to roles with Edit on `templates`.
- **Decided (Lean, 2026-10-09):** a PM may set another PM as manager (handover); the change is audited and the confirmation reads "Hand over this project to <name>?" / "After this, only <name> and Admins can edit or archive it. You'll still be able to view it." (UIE).

- **Default changes after go-live (Queen, 2026-10-09):** a change to the §6 defaults ships as a one-time data migration that updates only cells still at their old default value. Cells an Admin has changed are left alone, and the migration is audited. First case: Member Delete on `time`.

## Reports and Team & workload modules (v0.4.8, Jomerson; Deven, UIE, Queen, Lean, 2026-10-10)

| ID | Requirement | Priority |
|---|---|---|
| FR-ACL-14 | The Access rules grid gets two configurable rows: **Reports** (`reports`) with **View** plus an **Export** checkbox shown under View, and **Team & workload** (`workload`) with **View** only. Create, Edit and Delete show "n/a" on both rows. Turning off Reports View also turns off Export, and Export can't be on without View. (UIE) | Must |
| FR-ACL-15 | **Starting permissions match each role's access today exactly**, so nobody gains or loses anything until an Admin changes them. They ship as a migration, replacing the fixed role checks in the code. Deven confirms the exact per-role values from the current checks, and this table records them. **Confirmed (Deven, 2026-10-13, `packages/shared/src/accessRules.ts`):** every role starts with Reports View and Export and Team & workload View; Admins always have them and can't remove them (§6). | Must |
| FR-ACL-16 | The API enforces both rows (403 on `/reports/*`, `?format=csv` exports and `/workload` without the permission), and the menu hides what's not allowed. Changes are audited like every other rule (FR-ACL audit). | Must |
| FR-ACL-17 | **Saved reports stay private:** the Reports permission covers the shared M4 reports only. It never gives access to another person's saved Daily Accomplishment Reports, Admins included; those stay owner-only (doc 14 FR-DAR-14, 404 to anyone else). (Jomerson, Lean) | Must |

| Role | Reports View | Reports Export | Team & workload View |
|---|---|---|---|
| Admin | ✓ (locked) | ✓ (locked) | ✓ (locked) |
| PM | ✓ | ✓ | ✓ |
| Member | ✓ | ✓ | ✓ |
| Viewer | ✓ | ✓ | ✓ |

*(From the code, Deven 2026-10-10.)* Fixed scope still applies on top: Admin, PM and Viewer see all active projects; Members see only their own projects, their own time and their own workload row; Viewers can't open the Timesheets tab. Export is its own audited route.

## m8-polish access changes (v0.4.10; v0.4.9 Lead/Jomerson, v0.4.10 Lead's decisions, 2026-10-13)

Mirrors doc 14 v1.2.3 §A, §D and §E (see the Definitions there). Project visibility is **unchanged**: FR-ACL-07, Q-12 and the v0.4.8 scope note stand (doc 14 §C dropped 2026-10-13 by Jomerson). Mobile is on hold.

| ID | Requirement | Priority |
|---|---|---|
| ~~FR-ACL-18~~ | **Dropped 2026-10-13 by Jomerson** (team-only project filter). Today's visibility stays. | — |
| FR-ACL-19 | **Checklist and phase rules:** **Project PM** = the assigned manager, or an Access-role PM on the team list. Deleting an activity needs Delete on `tasks` and being the Project PM, or being an Admin. An activity with anything attached is refused for everyone, Admins included, with 409 `ACTIVITY_IN_USE` and `details.blockedBy` (`time`, `evidence`, `documents`, `issues`, always in that order); nothing changes, and the refusal isn't audited (successful deletes are). Phase changes (name, order, dates, add or delete) need Edit on `projects`. Project PMs can make them only in Planning (otherwise 422 `PROJECT_NOT_PLANNING`). **Admins can make them at any status.** | Must |
| FR-ACL-20 | **Permission-driven UI, not hard-coded roles:** Setup items, **New project** (Create on `projects`) and **+ Task** (Create on `tasks`) follow Access rules. The web sidebar hides Setup when no child is viewable (web only). Keys are listed below (Deven). A tab that isn't allowed selects the next allowed tab to the right (wrapping). If no tab is allowed, My tasks is hidden. | Must |
| FR-ACL-21 | **Effective permissions endpoint:** `GET /auth/me/permissions` returns the role, per-record actions (including Reports Export), Setup children, the New project and + Task flags, and `myTasksTabs` (array of allowed tab keys only, in FR-ACL-20 tab order, `[]` when none) and `defaultTab` (first entry of `myTasksTabs`, or `null` when none). Both fields are always present. It reflects saved changes on the next request (FR-ACL-06). It replaces FR-ACL-13's API-only summary as a supported contract for web and Flutter. | Must |
| FR-ACL-22 | **Quick Activity** (doc 14 FR-ACT-32) is a system Activity type. Edit on `settings` can't deactivate, rename or delete it (422 `SYSTEM_ACTIVITY_TYPE`). Its Setup row shows a "System type" badge with no Edit or Deactivate. | Must |

**Setup child items and permission keys (Deven; web only, Setup hidden when none visible):**

| Setup item | Shown when the user has |
|---|---|
| Templates | `templates.view` |
| Clients | `clients.view` |
| Team & workload | `workload.view` |
| Reports | `reports.view` |
| Admin | any of `users.view`, `teams.view`, `settings.view` (Admin › Project types uses `settings.view` to see, `settings.edit` to change, as built in PR #15) |
| Access rules | `accessRules.view` |

**My tasks tabs, in order, with required permission (Deven):**

| # | Tab | Requires |
|---|---|---|
| 1 | Today | `tasks.view` **and** `time.view` (Today is the timer and time-logging tab) |
| 2 | Day timesheet | `time.view` |
| 3 | Due | `tasks.view` |
| 4 | Assigned to me | `tasks.view` |
| 5 | I'm accountable | `tasks.view` |
| 6 | To review | `approvals.edit` |
| 7 | Completed | `tasks.view` |

There is no role-specific default tab: `defaultTab` is the first allowed tab in this order. A blocked tab moves to the next allowed tab to the right, wrapping around; if none is allowed, My tasks is hidden.

- ~~AC-49.5~~ Dropped 2026-10-13 by Jomerson.
- **AC-50.3** Given a role with no View on any Setup child, the web sidebar hides Setup, and `/auth/me/permissions` lists no Setup children.
- **AC-51.5** Given a role with View on no My tasks tab, `myTasksTabs` is `[]`, `defaultTab` is `null`, and My tasks is hidden.
- **AC-46.4** Given an Admin on a Completed project, deleting an activity with nothing attached and editing a phase both succeed; deleting one with logged time returns 409 `ACTIVITY_IN_USE`. **(API)**
- **EC-93** An Admin removes the last Setup child permission from a role: Setup disappears for those users on their next load (no sign-out needed).
- **v0.4.14 (doc 14 §I):** in Planning, the Project PM and Admins add, edit and delete phases and activities and can **Apply template** (Edit on `projects`; outside Planning 422 `PROJECT_NOT_PLANNING`). Project PMs and Admins delete unattached activities at any status (`ACTIVITY_IN_USE` still applies); the Planning lock covers phase details only. Others get 403, or 404 outside scope.
- Open questions: **Q-70** (Viewer access to `time`, §10; default B until Jomerson decides, v0.4.17). Doc 14 Q-67 to Q-69 resolved by Jomerson, 2026-10-13.
- Resolved earlier: Q-53, Q-55, Q-62, Q-64, Q-65, Q-66 resolved by Jomerson with the proposed defaults (2026-10-13); Q-57 to Q-60 withdrawn. Phase lock covers all phase fields and reopens if the project returns to Planning; adding or editing activities isn't status-locked.
- **Approved for build (Jomerson, 2026-10-13);** ships as one combined m8-polish update with the DR-48 fix.
