# 16 — M8 changes for the mobile team

**Status:** v0.2 (2026-10-14, SGT; v0.1 handoff 2026-10-13) · **For:** OpsTrack mobile team (mobile work on hold, **except DAR Send and email notifications (PR #41), which are in scope** (Jomerson, 2026-10-22, 8:29 PM SGT, doc 17 Q-92, CR-13). #41 comes off hold once PR #42 is merged and is then rebased onto the merged branch. The mobile Send flow must handle the server's 409 "Already sent": today the app shows the server message as it is, and it points to the web; a full mobile confirm-and-resend step is part of #41) · **Sources:** pm-app `m8-polish` git history and diffs; docs 03, 09, 11, 14, 15; `design/reviews/M8_DESIGN_REVIEW.md`.

All paths are under `/api/v1`. Errors use the usual shape `{ error: { code, message, details? } }`.

## Status labels

| Label | Meaning |
|---|---|
| **LIVE** | On `origin/main` (merged by PR #20, 2026-10-12 12:46 PM SGT). |
| **LIVE API (not yet on main)** | Deployed to the live API App Service from `m8-polish` but not merged to `main`. Any m8-polish API change deployed this week runs on the API App Service even though `main` doesn't have it yet. |
| **PREVIEW** | On `origin/m8-polish` (head `fdbeecb`) and the preview, not merged to `main` (36 commits ahead of `origin/main`). |
| **PLANNED** | Decided or specified, not built. |
| **Pending deploy** | Committed on `m8-polish` but not yet on the live API. |

## 1. API endpoints added or changed

### Tracker and time

| Endpoint | Status | Request | Response | Errors / notes |
|---|---|---|---|---|
| `PUT /tracker/days/:date/location` | LIVE (since M5); web now uses it from the entry modal (PREVIEW, `109912c`) | `{ locationId }` (strict, required) | `{ day }` (day DTO) | Needs `activities.edit`. Writes audit `day_location_set` (`changes: [{ field: 'locationId', old, new }]`). 422 `DAY_LOCKED` on a locked day; 422 `FUTURE_DATE` for a future date; 400 `VALIDATION_ERROR` on `locationId` for an unknown, inactive or empty location. The future-date check runs before the lock check, so a future date returns `FUTURE_DATE`, not `DAY_LOCKED`. |
| `POST /tracker/start`, `POST /tracker/entries` | LIVE | Start: exactly one of `taskId` or `title`, plus `activityTypeId`, `module`, `notes` (and the other entry fields: `locationId`, `billable`, `type`; the strict schema rejects `timeType`); optional `dayLocationId`, `confirmLeave`, `switchFrom`. | unchanged | Start without `switchFrom` while a timer runs: 409 `TIMER_RUNNING`. `dayLocationId` sets the day location only when the day has none yet. To *change* it, call `PUT …/location` first (that is what writes the audit). |
| `POST /tracker/stop` | LIVE | `{ entryId }` (idempotent) | unchanged | The server sets the end time and works out the minutes. |
| `PATCH /tracker/entries/:id`, `DELETE /tracker/entries/:id` | LIVE | unchanged | unchanged | 422 `DAY_LOCKED` on a locked day. DEF-014 (`0a26965`, LIVE API (not yet on main)): 404 when the caller can't view the owner; 403 `VIEW_ONLY` when they can view it but don't own it. The web edit modal no longer sends `locationId` (PREVIEW). |
| `POST /tracker/days/:date/submit` | LIVE | `{ locationId? }` | `{ day }` | 422 `DAY_LOCKED` past the lock; 422 `TIMER_RUNNING` with a running timer. |
| `POST /tracker/days/:date/reopen` | LIVE | `{ userId, reason }` | `{ day }` | 403 `ADMIN_ONLY` past the lock for non-Admins (Q-09 day lock, see §3); 403 `NOT_SUPERVISOR`; 404 when outside scope; 422 `NOT_LOCKED`. |
| Tracker and time writes with a future date | LIVE API (not yet on main) (`4126af4`) | — | — | Was 400 `VALIDATION_ERROR`, now **422 `FUTURE_DATE`** (`details[].path` = `date` or `workDate`). **Exception:** a future `timeOut` on `POST`/`PATCH /tracker/entries` still returns 400 `VALIDATION_ERROR` on `timeOut`. |
| `GET /time` | LIVE API (not yet on main) (`8130425`) | unchanged | adds `loggedTotal` (task time + quick activities, hours to 2 dp) | Additive. `total` and `items` unchanged. Leave not included. |
| `GET /lookups` options | LIVE API (not yet on main) | — | each option adds `key` (`string \| null`) and `system` (bool) | Additive. System type `quick_activity` ("Quick Activity") is seeded. |
| Lookup rename, deactivate or delete of a system type | LIVE API (not yet on main) | — | — | 422 `SYSTEM_ACTIVITY_TYPE`. |

### Day location vs entry location (what the DAR shows)

- `TimesheetDay.locationId` is the day location ("Where are you working today?").
- `TimeEntry.locationId` is an optional per-entry override.
- The effective location is `entry.locationId ?? day.locationId ?? null` (`services/tracker.ts`). The DAR view, saved copies and export all read the effective location.
- The web modal now edits only the day location. Overrides already stored on entries are kept (not cleared). **Known gap:** older entries with their own location can show a different location in the DAR than the day field shows. No data migration was done (Lean's call).

### Settings

| Endpoint | Status | Request | Response | Notes |
|---|---|---|---|---|
| `GET /settings/time-lock`, `PUT /settings/time-lock` | Pending deploy (`c96c8da`; live API not updated yet) | PUT body `{ enabled, version }`; extra old fields (`weekday`, `hour`) are ignored | `policy: { enabled: true }` when the setting was never saved or is null | The old `weekday` and `hour` fields are removed from the response, the PUT body and storage. A never-saved setting means the lock is ON (doc 14 FR-ACT-36, v1.2.25). |

### Permissions and access

| Endpoint / change | Status | Detail |
|---|---|---|
| `GET /auth/me/permissions` | LIVE API (not yet on main) (`cd27dc7`) | Was `{ role, permissions }`. Now also returns `setupItems`, `canCreateProject`, `canCreateTask`, `myTasksTabs` (`[]` when none) and `defaultTab` (first allowed tab, or `null`). Additive. |
| Q-70 B: Viewer has no `time` or `activities` access | LIVE API (not yet on main) (`6f0ee10`) | Viewers get 403 `FORBIDDEN` on these routes: all 11 tracker routes `GET /people`, `GET /day`, `GET /running`, `POST /start`, `POST /stop`, `POST /entries`, `PATCH`/`DELETE /entries/:id`, `PUT /days/:date/location`, `POST /days/:date/submit`, `POST /days/:date/reopen`; DAR `GET /dar`, `GET /dar/export/:format`, `GET`/`POST /dar/saved`, `GET /dar/saved/:id`, `GET /dar/saved/:id/export/:format`. `/lookups/*` routes are gated separately (not by `activities`). Paths that don't exist return 404 to everyone; `/time` was already 403. Someone else's entry still returns 404 first. One-time startup migration, cell by cell. |
| Q-72: Viewer has no `leave` access | LIVE API (not yet on main) (`8fdb005`, migration included) | Viewer default `leave: ''` (was `VCED`) in `packages/shared/src/accessRules.ts`. Every `/leave` call (`types`, `balances`, list, `team`, `:id`, `POST`, `:id/cancel`) returns 403 `FORBIDDEN` for Viewers. Migration `2026-10-13-viewer-no-leave` is value-only: it turns off any Viewer leave cell still `true` and leaves other cells alone. It runs once and deletes no leave. Admins and the Viewer's direct supervisor still see existing Viewer leave (EC-113; `canViewPerson`); anyone else gets 404. Viewer reset keeps leave off. |

### Projects, phases and templates (web features; listed here for completeness)

| Endpoint | Status | Request | Errors |
|---|---|---|---|
| `POST /projects/:id/apply-template` | LIVE API (not yet on main) | `{ templateId, templateVersion? }` | Response includes `phasesAdded`, `phasesMerged`, `tasksAdded`, `alreadyApplied`. 422 `PROJECT_NOT_PLANNING`, 422 `TEMPLATE_NOT_PUBLISHED`, 409 `TEMPLATE_CHANGED`; 404 for PMs not on the project; 403 otherwise. |
| `POST /projects/:id/phases` | LIVE API (not yet on main) | `{ name }` | 409 `DUPLICATE_NAME`, 422 `PROJECT_NOT_PLANNING`. |
| `PATCH /projects/:id/phases` | LIVE API (not yet on main) | `{ name, newName }` | 409 `DUPLICATE_NAME` (`details` path `newName`); names match trimmed and case-insensitive. |
| `DELETE /projects/:id/phases` | LIVE API (not yet on main) | unchanged | New: 409 `PHASE_NOT_EMPTY` with `details: { activityCount, taskCount }` (replaces `PHASE_HAS_TASKS`), and the permission changed from `tasks.delete` to `projects.edit` (Admin or the project's PM). Unchanged (already on main): 409 `PHASE_HAS_DOCUMENTS`. 204 on success. Note: `activityCount` equals `taskCount` by design (doc 14 §J). |
| Activity delete in the Project PM view | LIVE API (not yet on main) | — | 409 `ACTIVITY_IN_USE` (applies to Admins too). |
| Project create | LIVE API (not yet on main) | template now optional | Only 422 is `INVALID_CLIENT`. (`INVALID_ACTIVITY_TYPE` belongs to Project Type create/update and is already on main.) |

## 2. Behaviour rules

| Rule | Status |
|---|---|
| "Where are you working today? *" is **required** on Log task time and Add quick activity. It is prefilled with the day location; choosing another value changes the location for the whole day (through `PUT …/location`). On an empty past day the label reads "Where were you working on <day>? *". The per-entry Location field is hidden in that modal. | PREVIEW (`ee8d435`, `109912c`) |
| If the location change fails (for example `DAY_LOCKED`), the entry is not saved. | PREVIEW |
| On a locked day (submitted, or past the lock), the buttons stay **visible and disabled** with the tooltip "This day is locked". They are never hidden, at any width (AC-52.8). | PREVIEW (`fdbeecb`) |
| Day timesheet and Time logging buttons follow the **viewed** day. My tasks quick actions (including the compact "+") always log for **today**, so they follow today's lock state. | PREVIEW (`fdbeecb`) |
| "Logged this week" is hidden without `time` access. Viewers don't see Time logging, DAR or Leave, and the Time in/out buttons are hidden for them. | PREVIEW |
| The Log time card is removed from the Time logging page, which is now full width. | PREVIEW (`ee8d435`) |
| Checklist card redesign (DR-49), touch ↑↓ move buttons in the same style as the row Edit and Delete buttons. | PREVIEW (`335d289`, `15a08ca`, `fdbeecb`); web only |
| Module in Add entry is an optional free-text box ("Module (optional)"), up to 100 characters (`MODULE_MAX = 100`), not a dropdown (FR-ACT-20). | LIVE |
| The running row in the Day timesheet has a "■ Time out" button (own entries only). It calls `POST /tracker/stop`, and the server sets the end time and works out the minutes. Other people see a "Running" badge. | LIVE |
| A running timer auto-stops at 23:59 PHT and is flagged "Auto-stopped – please check". | LIVE (QA passed Oct 13 night run: TC-Q03, TC-T19) |
| 2-day time lock (Q-09): a day can be edited until the end of the second day after it and locks at 00:00 PHT on the third day; changes after that need an Admin reopen. Locked writes return 422 `DAY_LOCKED`. | LIVE (live API since Oct 14 08:30 SGT, `98a6354`) |
| My tasks tab order: Day timesheet comes right after Today (FR-TSK-22). | LIVE |
| Disabled locked-day buttons show the tooltip "This day is locked" (`LockableButton`, which also sets `aria-disabled`). | PREVIEW (`fdbeecb`) |
| Q-71 weekly totals: "Logged this week" (`GET /time` `loggedTotal`) and Team & workload Recorded (`recordedHours`) include quick activities and exclude leave. | API: LIVE API (not yet on main) (`8130425`); screens: PREVIEW (`3010d57`) |

## 3. Day lock and planned items

### Q-09 day lock (decided 2026-10-13 by Jomerson) — LIVE
- **LIVE** on the live API since 2026-10-14 08:30 SGT (`98a6354`).
- Rule: a day's entries can be edited until the end of the second day after it, and it locks at 00:00 PHT on the third day. For example, Oct 11 locks at 00:00 PHT on Oct 14.
- After that, changes need an **Admin reopen**. Locked writes return 422 `DAY_LOCKED`; the `ADMIN_ONLY` reopen rule follows the same boundary.
- This replaces the Admin-set weekly lock (default Monday 12:00 PM PHT). The Admin setting is now a single on/off switch (see §1 Settings, pending deploy).
- No approval step.
- Page text (UIE's approved wording, replaces the Monday 12:00 PM text): "You can edit a day's entries until the end of the second day after it. For example, Oct 13 locks at 12:00 AM PHT on Oct 16."

### Client portal (doc 15, v0.2)
- Separate tokens: `ptl_` + 32 random bytes (base64url), with a separate portal cookie and a separate `portalSessions` store. Staff auth rejects `ptl_` tokens (401 `SESSION_EXPIRED`); portal auth rejects staff tokens (401 `PORTAL_SESSION_EXPIRED`).
- **Web only. There is no mobile variant.** The mobile app should not accept or handle `ptl_` tokens.
- **Invites are on hold (Q-84):** the invite endpoints, `inviteUrl` / `inviteExpiresAt`, and the "Turn on" / "Resend invite" UI stay out of the build until Jomerson's security sign-off.
- Q-82: severity is shown under the label "Priority" (no new field).
- Q-83: Closed issues show a Resolved date only if the issue was resolved first.
- Q-85: re-inviting an active account signs it out and forces a new password.
- Q-86: portal controls go to Admins, the PM and co-PMs.
- NFR-35: 20 failed sign-ins per IP in 15 minutes, then 429 `TOO_MANY_ATTEMPTS` (confirmed by Lean).

## 4. Mobile catch-up checklist
- Handle 422 `FUTURE_DATE` (was 400; a future `timeOut` is still 400 `VALIDATION_ERROR`) and 422 `DAY_LOCKED`.
- Require the day location on the first entry. Change it with `PUT /tracker/days/:date/location`, not per entry.
- Show locked-day actions as disabled, not hidden. Quick actions follow today.
- Read `myTasksTabs` / `defaultTab`. Hide time, activities and leave for Viewers (expect 403).
- Tolerate the new additive fields (`loggedTotal`, lookup `key`/`system`).
- Use the Q-09 day lock boundary (LIVE). Expect `GET /settings/time-lock` to return only `policy.enabled` once `c96c8da` is deployed.

## Change log
| Version | Date (SGT) | Change |
|---|---|---|
| v0.2 | 2026-10-14 | Auto-stop marked LIVE (QA passed Oct 13 night run: TC-Q03, TC-T19); `PHASE_NOT_EMPTY` note: `activityCount` equals `taskCount` by design (doc 14 §J); 2-day time lock moved from PLANNED to LIVE (`98a6354`, live since 08:30 SGT); new `GET`/`PUT /settings/time-lock` change (`policy: { enabled: true }` default, `weekday`/`hour` removed; `c96c8da`, pending deploy). |
| v0.1 | 2026-10-13 | Handoff. |
