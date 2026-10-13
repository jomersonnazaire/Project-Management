# 11 — Access Rules Module and Client Contacts Changes (Milestone 1.5)

**Status:** v0.4.28 — Q-84 hold behaviour: the toggle shows the on-hold message and saves nothing (Lean, 1:07 AM). Earlier: v0.4.27 — Q-82 to Q-86 added as Rich's proposed defaults, pending Lean or Jomerson: Priority shows existing severity; Closed issues show Resolved only if resolved first; invite as a one-time link shown once while there's no email (7 days, single use; needs Jomerson's security sign-off; UIE's "Copy invite link" step if approved); re-invite of an active account forces a new password and ends sessions; portal controls, sharing and client-facing go to whoever can edit the project (incl. co-PMs); new NFR-35 per-IP sign-in limit, 20 failures per IP in 15 minutes for Lean to confirm (FR-ACL-30, 32, 33, 36; AC-58.13 to 58.16, AC-59.4) · v0.4.26 — portal issue dates defined as Raised (created), Due and Resolved (Resolved only when resolved); list columns Issue, Priority, Status, Raised, Due (Q-80, FR-ACL-31, AC-57.7); UIE's mockup v0.9.13 is the reference and implements Q-77 to Q-81 and doc 14 AC-52.8 · v0.4.25 — Lean (2026-10-13, 9:22 PM SGT, pending Jomerson): portal users see **no issue comments** for now (issues show title, status, priority and dates only; per-comment "client-facing" flag waits for a later round); 5-failed-attempt portal lockout is Lean's call; UIE follow-up handled in mockup v0.9.13 (FR-ACL-30, 31, 36; AC-57.7; Q-77, Q-80) · v0.4.24 — Q-73 to Q-76 set aside by Jomerson (2026-10-13, 9:15 PM SGT): build on the current defaults, no decision needed; new portal build defaults from Lean, pending Jomerson (Q-77 to Q-81): 15-minute lockout, 7-day invites, 12-character passwords, re-enable sends a new invite, session-expired message with no reason; no self-service password reset (Admin or PM resends an invite); task owners shown as "Xceler8"; Issues list plus view-only detail page; Portal access controls for Admins and PMs of the client's Planning or Active projects (FR-ACL-30, 31, 33, 36; US-58; AC-58.1; new AC-57.6, 57.7, AC-58.7 to 58.12; EC-124 to 127; NFR-34); references UIE's mockup v0.9.12 and `docs/design/CLIENT_PORTAL_UI.md` · v0.4.23 — Client access is **contact-based portal access, not a fifth role** (Jomerson, 2026-10-13, 8:48 PM SGT): staff back to four fixed roles (Admin, PM, Member, Viewer); Portal access toggle and Invite on Client › Contacts (Admin, or PM of that client's projects; audited); separate `clientPortalAccounts` collection (not Users); fixed portal permission set outside Access rules; separate portal sign-in, `portal`-audience tokens and `/portal/*` endpoints (cross-use 401); FR-ACL-23, 24, 27, 28, 30, 31 reworded; FR-ACL-29 superseded by FR-ACL-33 to 36; AC-57.1 superseded by AC-57.5; new AC-58.3 to 58.6, EC-120 to 123; Q-76 now the portal password invite · v0.4.22 — Client role brought into scope now, not a later phase (Jomerson, 2026-10-13, 8:41 PM SGT): five fixed roles (Admin, PM, Member, Viewer, Client); FR-ACL-23 to 26 Could → Must; Q-73 to Q-76 applied as build defaults, pending Jomerson; new FR-ACL-27 to 32, US-57 to 59, AC-57.1 to 59.3, EC-114 to 119, NFR-33 to 34; interim rule (no Viewer for client users) kept · v0.4.21 — Q-72 No by Jomerson (2026-10-13, 8:38 PM SGT): Viewer `leave` none (seeded + cell-by-cell migration like activities); Viewer = internal read-only staff, not for clients; Client role planned later phase (FR-ACL-23 to 26, Q-73 to Q-76); four fixed roles become five when built; interim: don't assign Viewer to client users · v0.4.20 — Q-70 resolved as option B by Jomerson (2026-10-13, 7:39 PM SGT): Viewer `time` none, `activities` none; leave, issues (V), Reports and workload unchanged; Viewers no longer get tracker entries (working rule); mirrors doc 14 FR-ACT-35 · v0.4.19 — permissions path corrected to as-built `GET /auth/me/permissions` (room, 2026-10-13, build `2262fed`; was `/api/v1/me/permissions` / `/me/permissions`) · v0.4.18 — §6 `activities`, `leave`, `issues` defaults confirmed (Deven, `packages/shared/src/accessRules.ts`, relayed by Lean, 2026-10-13); Viewer `activities` VCED is live, a known gap under Q-70 default B · v0.4.17 — Q-70 open (Viewer access to `time`; default B, no time access, until Jomerson decides); Viewer own-records working rule (Lean, 2026-10-13); §6 `activities`, `leave`, `issues` values pending Deven · v0.4.16 — §6 Reports Export and Team & workload defaults confirmed (Deven, 2026-10-13) · v0.4.15 — doc 14 Q-67 to Q-69 resolved; no open questions · v0.4.14 — Planning-stage phase/activity editing and Apply template rights (doc 14 §I) · v0.4.13 — m8-polish access changes approved for build (Jomerson, 2026-10-13) · v0.4.12 (FR-ACL-18 team filter dropped by Jomerson; Q-12 stands) · v0.4.11 (Setup child and My tasks tab permission keys, defaultTab = first allowed, ACTIVITY_IN_USE for Admins too) · v0.4.10 (Lead's m8-polish decisions: Admin exemptions, ACTIVITY_IN_USE, team definition, tab wrap, permission-driven buttons) · v0.4.9 (m8-polish) · v0.4.8 (Reports and Team & workload rows) · v0.4.3 — built and passed (PR #2); model approved by Jomerson (four fixed roles; Q-26, Q-27 resolved) · **Author:** Rich · **Date:** 2026-10-09
**Source:** Jomerson (room, 2026-10-09 2:29 PM); Lean (Milestone 1.5 scope); Queen (safety rules); UIE (mockup v0.5 plan).
**Decision:** permissions are set **per Access role** (Admin, PM, Member, Viewer), not per Job role (Jomerson, 2026-10-09). Client users are not an Access role; they get contact-based portal access (v0.4.23, section "Client role").

## 1. Scope
1. **Access rules module (Milestone 1.5):** Admins set View, Create, Edit and Delete per record type for each Access role. Replaces the fixed matrix in doc 07 §4, which becomes the seeded defaults.
2. **Clients screen, Contacts tab (Milestone 1.5):** contacts move into the client's detail page; the separate Client contacts page is removed.
3. **Project, Active contacts (Milestone 2):** each project picks its active contacts from its client's contacts.

Out of scope for Milestone 1.5: per-Job-role or per-user permissions, field-level permissions, and the client account owner (parked by Jomerson). **Roles:** Jomerson chose four fixed Access roles (Admin, PM, Member, Viewer) on 2026-10-09. **v0.4.23 (Jomerson, 2026-10-13, 8:48 PM SGT):** still **four fixed roles**; client users get **contact-based portal access** with a fixed permission set, not an Access role (FR-ACL-23 to 36, section "Client role"; the v0.4.22 fifth role is withdrawn). Viewer is **internal read-only staff**, not for client users — don't assign Viewer to clients in the interim.

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

**No Client column:** portal users have a fixed permission set outside Access rules (FR-ACL-27, v0.4.23).

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
| activities | VCED | VCED | VCED | – |
| leave | VCED | VCED | VCED | – |
| issues | VCED | VCE | VCE | V |

🔒 = Admin row locked (for `reports` and `workload`, the Admin cell is locked: an Admin always has these and can't remove them). `reports` Export and `workload` View confirmed by Deven, 2026-10-13, from `packages/shared/src/accessRules.ts`. `accessRules` and `settings` only have View and Edit. Documents defaults follow doc 10's permissions; doc 10 wins if they differ.

**Working rule (v0.4.21, Q-70 option B + Q-72 No, Jomerson 2026-10-13, 8:38 PM SGT):** Viewers get **View only on issues**. Viewers have **no** `time`, `activities` or `leave` access. The Viewer role is **internal read-only staff**, not for client users. Any Viewer access beyond View on issues (or the other seeded Viewer cells in §6) is a defect.

**Own records (v0.4.18; Viewer update v0.4.21):** for Admin, PM and Member, `activities` and `leave` are limited to the person's own records, with View on their direct reports' records. The `activities`, `leave` and `issues` values were confirmed by Deven from `packages/shared/src/accessRules.ts` (relayed by Lean, 2026-10-13), then updated for Viewer: **Q-70 option B** set Viewer `activities` to **none** (and `time` stays none); **Q-72 No** sets Viewer `leave` to **none**. The live Viewer `activities` VCED and Viewer `leave` VCED on build `2262fed` are known gaps to close, not defects. **Migration (same cell-by-cell rule as activities):** a one-time startup migration turns off every Viewer `leave` cell still at the old seeded default (including after `POST /access-rules/VIEWER/reset`); Admin-changed cells are left as is; audited; deletes nothing (doc 14 EC-112 pattern; EC-113 for existing leave records).

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
- To meet FR-ACL-06, read rules per request (four small documents, one per role; portal permissions are fixed in code and not stored here, v0.4.23) or cache with invalidation on save. Note TD-01: an in-memory cache is only safe while the App Service stays on one instance.
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
- **Q-70 (resolved as option B, Jomerson 2026-10-13, 7:39 PM SGT):** Viewer access to `time` (tracker entries). ~~**Option A (not chosen):**~~ Viewer gets `time` View, Create, Edit and Delete limited to their own entries. **Option B (chosen):** Viewer keeps no `time` access (as seeded in §6), and Viewer `activities` is **none**; Viewers can't log time or tracker entries. **Q-72 (resolved as No, Jomerson 2026-10-13, 8:38 PM SGT):** Viewers also have no leave access (seeded Viewer `leave` = none; doc 14 FR-ACT-35, A-25 replaced). The live build `2262fed` currently gives Viewer full `activities` and `leave` access — **known gaps to close, not defects**.
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
- **Q-70 resolved as option B (Jomerson, 2026-10-13, 7:39 PM SGT); Q-72 resolved as No (Jomerson, 2026-10-13, 8:38 PM SGT):** Viewer `time` none, `activities` none, `leave` none (§6, working rule). Doc 14 Q-67 to Q-69 and Q-71 resolved. Viewer = internal read-only staff.
- Resolved earlier: Q-53, Q-55, Q-62, Q-64, Q-65, Q-66 resolved by Jomerson with the proposed defaults (2026-10-13); Q-57 to Q-60 withdrawn. Phase lock covers all phase fields and reopens if the project returns to Planning; adding or editing activities isn't status-locked.
- **Approved for build (Jomerson, 2026-10-13);** ships as one combined m8-polish update with the DR-48 fix.

## Client role (v0.4.21, Jomerson 2026-10-13, 8:38 PM SGT; in scope v0.4.22, 8:41 PM SGT; contact-based portal access v0.4.23, 8:48 PM SGT)

**Must — in scope now.** **v0.4.23 (Jomerson, 2026-10-13, 8:48 PM SGT):** client access is **contact-based portal access**, **not a fifth user role**. Staff keep the **four fixed Access roles** (Admin, PM, Member, Viewer); the v0.4.22 "Client" Access role and its Access rules column are withdrawn. Portal access is switched on per client contact, uses its own accounts, sign-in, sessions and `/portal/*` endpoints, and has a fixed permission set. **Interim rule (kept):** don't give client users the Viewer role; Viewer is **internal read-only staff** only.

| ID | Requirement | Priority |
|---|---|---|
| FR-ACL-23 | **Contact-based portal access, not a role (v0.4.23):** a client contact can be given **portal access**. Portal users are not staff users and have no Access role; the four fixed Access roles are unchanged. (v0.4.22 text "a fifth Access role, Client" superseded.) | Must |
| FR-ACL-24 | **What portal users see (read-only):** only projects of the contact's client where the contact is an **Active contact** (FR-ACL-28) — projects, phases and progress; tasks (read-only); documents marked **"Share with client"**; issues marked **client-facing**. | Must |
| FR-ACL-25 | **What portal users never see:** Team & workload, Reports, billing or Billable, rates, time entries, the DAR or leave; other clients' projects or contacts; internal issues or comments. | Must |
| FR-ACL-26 | **Read-only in v1:** no Create, Edit or Delete on anything a portal user can view, unless a later decision opens comments or similar (Q-73). | Must |
| FR-ACL-27 | **Fixed portal permission set (v0.4.23):** the FR-ACL-24 set is fixed in code, **not editable** and **not shown in Access rules**; `GET /access-rules` has only the four staff roles. (v0.4.22 "locked Client column in Access rules" superseded.) | Must |
| FR-ACL-28 | **Visibility follows Active contacts:** a portal user sees a project only while their contact is on that project's **Active contacts** (FR-PRJ-11). Adding the contact shows it on the next request; removing hides it. Any other project, or a task, document or issue under it, returns **404, not 403** (DEF-015). Lists return only in-scope records. | Must |
| FR-ACL-29 | **Superseded (v0.4.23)** by FR-ACL-33 to 36. Was: Admin invites a Client user (in Users, Client role) from the Contacts tab. | — |
| FR-ACL-30 | **Field stripping on `/portal/*`:** responses omit Billable, rates, time entries, assigned and recorded hours, internal comments, and staff audit actors (staff show as **"Xceler8"**). **Task owners** show as **"Xceler8"**, never staff names (Q-79). Issues return only title, status, priority and dates; **no issue comments** are returned (Q-80, v0.4.25). Removed on the server, not hidden in the UI (NFR-33). **Priority (Q-82, v0.4.27, Rich's proposed default, pending Lean or Jomerson):** the portal "Priority" shows the issue's existing **severity** value; no new field. **Resolved on Closed issues (Q-83):** a Closed issue shows the Resolved date only if it was resolved before closing; closed without resolving shows none. | Must |
| FR-ACL-31 | **Portal UI:** a separate portal app with **Projects** only. A project shows the overview (progress and phases), a read-only task list, Documents (shared only) and Issues (client-facing only). **Issues (Q-80):** a list plus a **view-only detail page** showing only the title, status, priority and dates (no comments, v0.4.25). Dates are **Raised** (created), **Due** and **Resolved**; Resolved shows only when the issue is resolved. List columns: **Issue, Priority, Status, Raised, Due** (UIE's mockup v0.9.13 is the reference, v0.4.26). No staff screens; no Edit, Create or Delete buttons. | Must |
| FR-ACL-32 | **Share toggles:** a document **"Share with client"** toggle (Q-74, off by default) and an issue **"Client-facing"** toggle (Q-75, off by default). Admins, the assigned PM and co-PMs of the project (Members and Viewers never; Q-86) only; each change audited with old and new values. **Who (Q-86, v0.4.27, Rich's proposed default, pending Lean or Jomerson):** the same people who can edit the project (including co-PMs (the app has them, confirmed by Deven 10:16 PM)) and Admins. | Must |
| FR-ACL-33 | **Portal access toggle and Invite (v0.4.23):** Clients › client › **Contacts** gets a **"Portal access"** toggle and an **"Invite"** (resend) button per contact, available to Admins and to PMs of that client's projects **that are in Planning or Active** (Q-81; a PM whose projects for that client are all On Hold, Completed or Cancelled doesn't qualify) (others: hidden, API 403). Turning it on emails a **password invite** (Q-76). Turning it off, or deactivating the contact, **cuts access immediately**: portal sessions are revoked and the next request gets **401**. **Turning access back on** sends a **new invite** (status `disabled` → `invited`, new token; Q-77). Toggle and invite actions are audited. **v0.4.27 (Rich's proposed default, pending Lean or Jomerson):** **Who (Q-86):** the Portal access controls go to the same people who can edit the project, including co-PMs (the app has them, confirmed by Deven 10:16 PM) (refines Q-81). **Invite delivery (Q-84, needs Jomerson's security sign-off):** while there's no email service, the invite is a **one-time link shown once** to the staff member to pass on; it expires in 7 days and can be used once. If approved, UIE redesigns the invite success step as **"Copy invite link"**. **Re-invite an active account (Q-85):** forces a new password and ends its sessions. | Must |
| FR-ACL-34 | **`clientPortalAccounts` collection (v0.4.23):** `{ contactId, clientId, email, passwordHash, status: invited \| active \| disabled, inviteToken, inviteExpiresAt, lastLoginAt, failedLoginCount, lockedUntil }`. **One portal account per contact**; `email` unique across portal accounts. A portal email that is also a staff email is allowed but kept fully separate (no shared password, session or record). | Must |
| FR-ACL-35 | **Not staff users (v0.4.23):** portal accounts are **not in Users** and never appear in Users, Team & workload, pickers, assignees, seat counts or Access rules. | Must |
| FR-ACL-36 | **Separate sign-in and sessions (v0.4.23):** a separate portal sign-in page; portal tokens carry audience **`portal`**; portal endpoints live under **`/portal/*`**. A staff endpoint called with a portal token returns **401**, and a `/portal/*` endpoint called with a staff token returns **401**. **No Microsoft sign-in** for portal accounts (doc 14 FR-SSO-05). **Portal password and session rules (v0.4.24, Q-77, Q-78; build defaults pending Jomerson):** failed sign-ins lock the portal account for **15 minutes** after **5 consecutive failed attempts** (Lean's call, 2026-10-13, 9:22 PM SGT, pending Jomerson); invite links last **7 days**; passwords need **at least 12 characters**; the session-expired message gives **no reason** (also after access is turned off). **No self-service password reset in this build:** an Admin or a qualifying PM sends a new invite instead; self-service reset waits for email notifications. Sign-in is also limited **per IP** (NFR-35, v0.4.27). | Must |

**Portal permission set (FR-ACL-27, fixed, not in Access rules):**

| Record type | Portal |
|---|---|
| projects (incl. phases, progress) | V (Active contact only, FR-ACL-28) |
| tasks | V (read-only list) |
| documents | V (shared with client only) |
| issues | V (client-facing only) |
| time, activities, leave, reports, workload, settings, users, clients, contacts | – |
| teams, accessRules, templates, approvals, audit | – |

**User stories:**
- **US-57** As a client contact with portal access, I want to see progress, phases and tasks on my company's projects I'm an active contact on, so I know where the implementation stands without asking. (FR-ACL-23, 24, 26, 27, 28, 31)
- **US-58** As an Admin, or a PM of the client's Planning or Active projects, I want to switch on portal access for a client contact and send them a password invite, so they can sign in to the portal and see only their projects. (FR-ACL-33 to 36)
- **US-59** As a PM, I want to choose which documents and issues the client can see, so internal material stays internal. (FR-ACL-25, 30, 32)

**Acceptance criteria:**
- **AC-57.1** **Superseded (v0.4.23)** by AC-57.5. Was: `GET /access-rules` returns a locked Client column.
- **AC-57.2** Given a portal user whose contact is an Active contact on project A but not project B (same client), `GET /portal/projects` returns only A, and B, its tasks, documents or issues return 404. **(API)**
- **AC-57.3** Given a portal user, any Create, Edit or Delete request returns 403 (in scope) or 404 (out of scope); `/portal/*` exposes no write endpoints for these records. **(API)**
- **AC-57.4** Given a portal user signs in, the portal shows Projects only; a project shows overview (progress and phases), read-only tasks, Documents and Issues; staff URLs are not reachable.
- **AC-57.5** Given a fresh deploy, `GET /access-rules` returns only Admin, PM, Member and Viewer; no portal column or role exists and the portal permission set can't be changed through any API. **(API)**
- **AC-57.6** (v0.4.24, Q-79) Given a task owned by a staff user, the portal task list and `GET /portal/...` show the owner as **"Xceler8"**; no staff name, email or id appears in the response. **(API)**
- **AC-57.7** (v0.4.24, Q-80) Given a client-facing issue, the portal shows it in the Issues list and on a view-only detail page with only title, status, priority and dates; the API response contains no other fields and **no comments** of any kind (v0.4.25). The list shows the columns Issue, Priority, Status, Raised and Due; the detail page shows Raised and Due, plus Resolved only when the issue is resolved (v0.4.26, mockup v0.9.13). **(API)**
- **AC-58.1** Given an Admin, or a PM of one of the client's projects in Planning or Active (v0.4.24, Q-81), on Clients › client › Contacts, turning on "Portal access" creates one `clientPortalAccounts` record (status `invited`) linked to the contact and client and emails a password invite; others don't see the toggle and the API returns 403. Both actions are audited. **(API)**
- **AC-58.2** Given a portal account, the portal sign-in page offers no Microsoft sign-in, and a Microsoft sign-in with the portal email never yields a portal session. **(API)**
- **AC-58.3** Given an active portal user with an open session, turning off Portal access (or deactivating the contact) sets status `disabled`, revokes sessions, and the next `/portal/*` request returns 401. **(API)**
- **AC-58.4** Given a portal token, any staff endpoint returns 401; given a staff token, any `/portal/*` endpoint returns 401. **(API)**
- **AC-58.5** Given portal accounts exist, they don't appear in Users, Team & workload, pickers, assignees, seat counts or Access rules. **(API)**
- **AC-58.6** Given a second portal account with an email already used by another portal account, the API returns 422; the same email as a staff user is accepted and stays separate. **(API)**
- **AC-58.7** (v0.4.24, Q-77) Given 5 consecutive failed portal sign-ins, the account is locked for 15 minutes (even the correct password is refused) and unlocks after 15 minutes. **(API)**
- **AC-58.8** (v0.4.24, Q-77) Given a new invite, the link works for 7 days and then shows "Invite expired"; setting a password shorter than 12 characters is refused with "At least 12 characters." **(API)**
- **AC-58.9** (v0.4.24, Q-77) Given a `disabled` portal account, turning Portal access back on sets it to `invited` and sends a new invite; old links don't work; audited. **(API)**
- **AC-58.10** (v0.4.24, Q-77) Given an expired or revoked portal session, the portal shows "Your session has ended. Sign in again to continue." with no reason.
- **AC-58.11** (v0.4.24, Q-78) The portal sign-in offers no self-service password reset, and no `/portal/*` reset endpoint exists; an Admin or qualifying PM uses "Resend invite" instead. **(API)**
- **AC-58.12** (v0.4.24, Q-81) Given a PM whose projects for the client are all On Hold, Completed or Cancelled, the Portal access toggle and Invite are hidden and the API returns 403; once one of those projects is Planning or Active, they show. **(API)**
- **AC-58.13** (v0.4.27, Q-84) Given no email service, when staff send a portal invite, the one-time link is shown once (it can't be shown again), works once, and expires after 7 days; a second use or a later use returns "Invite expired". **(API)**
- **AC-58.14** (v0.4.27, Q-85) Given an active portal account with an open session, when staff re-invite it, its sessions end (next `/portal/*` request returns 401) and the old password no longer signs in until a new password is set from the invite. **(API)**
- **AC-58.15** (v0.4.27, Q-86) Given a user who can edit the project (Admin, the project's PM or a co-PM if the model has them), the Portal access controls, "Share with client" and "Client-facing" toggles are available; anyone who can't edit the project doesn't see them and the API returns 403. **(API)**
- **AC-58.16** (v0.4.27, NFR-35) Given 20 failed portal sign-ins from one IP within 15 minutes, further attempts from that IP return 429 until the window passes. **(API)**
- **AC-59.1** Given a document with "Share with client" off, a portal user doesn't see it and `GET /portal/...` returns 404; turning it on shows it on the next request. **(API)**
- **AC-59.2** Given a new issue, "Client-facing" is off; a portal user sees only client-facing issues, without internal comments. **(API)**
- **AC-59.3** Each toggle change by a PM or Admin creates one audit entry with old and new values; a Member or Viewer can't toggle (403, button hidden). **(API)**
- **AC-59.4** (v0.4.27, Q-82, Q-83) Given an issue with severity High, the portal shows Priority "High" (no separate priority field exists). Given a Closed issue resolved before closing, its Resolved date shows; given one closed without being resolved, no Resolved date shows. **(API)**

**Edge cases:**
- **EC-114** The contact is deactivated: the portal account is disabled, sign-in is refused, and existing sessions are revoked (401 on the next request).
- **EC-115** The contact is removed from a project's Active contacts: that project drops from the portal list on the next request and its URLs return 404.
- **EC-116** A document is unshared: it disappears from the portal on the next request; direct links and downloads return 404.
- **EC-117** An issue's Client-facing flag is turned off: it disappears from the portal on the next request; direct links return 404.
- **EC-118** A portal user opens a direct URL to another client's project (or its task, document or issue): 404, not 403 (DEF-015); nothing is revealed.
- **EC-119** A person is a contact on several clients: each contact can have its own portal account, but portal emails are unique, so the same email for a second contact is blocked (422 `PORTAL_EMAIL_EXISTS`); a separate email is needed.
- **EC-120** A contact is removed from the client (deleted or moved): the portal account is disabled, sessions revoked (401), and no project of that client is visible.
- **EC-121** A contact is an Active contact on several projects of the same client: one portal account sees all of them; removing the contact from one project hides only that project.
- **EC-122** An invite expires (`inviteExpiresAt` passed): the link shows "Invite expired" and sets no password; an Admin or the client's PM uses "Invite" to resend, which issues a new token, invalidates the old one and is audited.
- **EC-123** A staff token is used on `/portal/*` (or a portal token on a staff endpoint): 401, even if the staff user and portal account share an email.
- **EC-124** (Q-81) A PM's only Planning or Active project for the client moves to On Hold or Completed: the PM loses the Portal access toggle and Invite on the next request (API 403); existing portal accounts are unaffected.
- **EC-125** (Q-77) Portal access turned off, then on again: the same account is reused (`disabled` → `invited`) with a new invite; the old password no longer signs in until the new invite is used.
- **EC-126** (Q-78) A portal user forgets their password: there's no self-service reset; they ask their Xceler8 PM, who resends the invite (new token, old one invalidated, audited).
- **EC-127** (Q-77) A locked portal account receives an invite resend: the lock lasts its 15 minutes regardless (follows FR-AUTH-07).

**Non-functional:**
- **NFR-33** No internal data on `/portal/*` (FR-ACL-30): automated API tests cover every portal endpoint and fail if a stripped field or out-of-scope record appears.
- **NFR-34** Portal sessions are audited: sign-in, sign-out, failed sign-in, lockout, password set from an invite and each project, document or issue view are logged with the portal account, contact, client and time.
- **NFR-35** (v0.4.27, confirmed by Lean 2026-10-13, 10:14 PM SGT) Portal sign-in is rate-limited **per IP**: **20 failed attempts per IP in 15 minutes**, alongside the per-account lockout (FR-ACL-36).

**Questions (applied as build defaults, pending Jomerson — v0.4.22; Q-76 reworded v0.4.23). v0.4.24: Q-73 to Q-76 set aside by Jomerson (2026-10-13, 9:15 PM SGT); build on the current defaults, no decision needed.**

| ID | Question | Build default (applied, pending Jomerson) |
|---|---|---|
| Q-73 | Can portal users comment on client-facing issues? | **Applied as build default, pending Jomerson:** **No** comments in v1 (read-only). |
| Q-74 | How are documents marked shared with clients? | **Applied as build default, pending Jomerson:** a per-document **"Share with client"** flag (FR-ACL-32). |
| Q-75 | How are issues marked client-facing? | **Applied as build default, pending Jomerson:** a per-issue **client-facing** flag, **off by default** (FR-ACL-32). |
| Q-76 | Sign-in method for clients? | **Applied as build default, pending Jomerson:** **password invite on the portal** (`clientPortalAccounts`, separate portal sign-in; no Microsoft sign-in; FR-ACL-33, 36). |

**New portal decisions from Lean (v0.4.24, 2026-10-13, 9:15 PM SGT), logged as build defaults pending Jomerson.** Design reference: UIE's mockup v0.9.12 (`docs/design/mockup/index-v0.9.12.html`) and `docs/design/CLIENT_PORTAL_UI.md` (answers its spec gaps 1 to 8).

| ID | Question | Build default (Lean, applied, pending Jomerson) |
|---|---|---|
| Q-77 | Portal lockout, invite expiry, password rule, re-enabling access, session-expired message? | Lockout **15 minutes after 5 consecutive failed attempts** (attempt count: Lean's call, v0.4.25); invite links last **7 days**; passwords **at least 12 characters**; turning access back on **sends a new invite**; the session-expired message gives **no reason** (FR-ACL-33, 36; AC-58.7 to 58.10; EC-125, 127). |
| Q-78 | Self-service password reset on the portal? | **Not in this build.** An Admin or PM sends a new invite instead; self-service reset waits for email notifications (FR-ACL-36; AC-58.11; EC-126). |
| Q-79 | Can portal users see task owners? | Owners show as **"Xceler8"**, never staff names (FR-ACL-30; AC-57.6). |
| Q-80 | What do portal users see of issues? | A **list plus a view-only detail page**: title, status, priority and dates only; **no issue comments for now** (Lean, 2026-10-13, 9:22 PM SGT, pending Jomerson). A per-comment "client-facing" flag waits for a later round. Dates are **Raised** (created), **Due** and **Resolved**; Resolved shows only when the issue is resolved. List columns: **Issue, Priority, Status, Raised, Due** (UIE's mockup v0.9.13 is the reference, v0.4.26). (FR-ACL-30, 31; AC-57.7). |
| Q-81 | Which PMs get the Portal access controls? | **Admins plus PMs of the client's projects that are in Planning or Active** (FR-ACL-33; US-58; AC-58.1, 58.12; EC-124). |

**Rich's proposed defaults (v0.4.27, 2026-10-13, 9:29 PM SGT), pending Lean or Jomerson.** Deven's draft `15_CLIENT_PORTAL_API_CONTRACT.md` v0.1 should be aligned to these once decided (not edited here).

| ID | Question | Proposed default (Rich, pending Lean or Jomerson) |
|---|---|---|
| Q-82 | What does the portal "Priority" show? | The issue's existing **severity** value; no new field (FR-ACL-30; AC-59.4). |
| Q-83 | Does a Closed issue show a Resolved date? | Yes if it was resolved before closing; none if it was closed without being resolved (FR-ACL-30; AC-59.4). |
| Q-84 | **ON HOLD (Jomerson, 2026-10-13, 10:48 PM SGT): client invites are held until an email service exists. Invites stay switched off and hidden; the rest of the portal is built, with a preview-only test account for QA. While on hold, turning the Portal access toggle on shows "Client invites are on hold until email is set up." and saves nothing; no real contact can become Active; only the seeded preview test account is Active (Lean, 2026-10-14, 1:07 AM SGT; mockup v0.9.15). The invite flow and the toggle ship together once email exists.** Original: How is the invite delivered while there's no email service? **Needs Jomerson's security sign-off.** | A **one-time link shown once** to the staff member to pass on; expires in 7 days; single use. If approved, UIE redesigns the invite success step as "Copy invite link" (FR-ACL-33; AC-58.13). |
| Q-85 | What happens when an active account is re-invited? | It must set a new password and its sessions end (FR-ACL-33; AC-58.14). |
| Q-86 | Who gets the portal controls? | The same people who can edit the project, including co-PMs (the app has them, confirmed by Deven 10:16 PM); also applies to "Share with client" and "Client-facing" (refines Q-81; FR-ACL-32, 33; AC-58.15). |
| — | Per-IP sign-in limit | 20 failed attempts per IP in 15 minutes, confirmed by Lean (NFR-35; AC-58.16). |

**Mockup follow-ups for UIE (v0.9.12) — ✅ handled in mockup v0.9.13 (v0.4.25):** no Forgot password, priority and dates, 5 attempts, no comments. **v0.4.26:** mockup v0.9.13 implements Q-77 to Q-81 and doc 14 AC-52.8. Original note: the sign-in error and locked copy say "reset your password" and a "Forgot password?" link is shown, which Q-78 removes; the issue card says "Comments stay internal" and lists severity and stage, while Q-80 shows priority, dates and client-facing comments; the portal Issues tab needs the view-only detail page.
