# CR-22 — PM project scope, status without owners, Depends On fix, and project timeline

**Status:** v0.3.1 **locked for build** except Q-144 (2026-11-11 ~12:31 AM SGT) · v0.3 draft (2026-11-11 ~12:28 AM SGT) · v0.2 draft (2026-11-11 ~12:24 AM SGT) · v0.1 draft (2026-11-11, SGT) · **Author:** Business Analyst (Rich) · **For:** Jomerson (approval), Lean, Deven, Queen, UIE
**Requested by:** Jomerson (Lead Dev / owner) in the PM room, 2026-11-11. **Rules locked by:** Lean (PM room, 2026-11-11 ~12:15 to 12:17 AM SGT). Rules marked **Locked** are Lean's. Anything not locked is an assumption (§8) or an open question (§10).
**Part of:** doc 17 (change requests). CR-22 is summarised in `17_CHANGE_REQUESTS.md` and specified in full here. It follows CR-21 and uses the next free IDs: **FR-PRJ-35 to FR-PRJ-39a**, **FR-TSK-37**, **FR-TL-01 to FR-TL-26** (new prefix: project timeline), **US-69 to US-74**, **AC-69.1 to AC-74.12**, **EC-183 to EC-202**, **NFR-50 to NFR-54**, **A-47 to A-54**, **Q-127 to Q-149**.
**Checked against:** docs 01 to 17 and CR-21 v0.1.2 on `main` `22958d9` (PR #48 merged), and the build at `main` `22958d9`. No IDs clash with CR-21 (CR-21 ends at FR-USR-12, US-68, AC-68.8, EC-182, NFR-49, A-46, Q-126). Research notes: `pm-docs/research/pm-timeline-gantt-findings.md` (outside the repo).
**Not built. Locked for build (Lean, 2026-11-11 ~12:31 AM SGT)** except **Q-144** (paid Gantt licence, Jomerson). **Part A builds now** (Deven, own branch). **Part B slice 1 starts once Jomerson has answered Q-144 and seen UIE's mockup.**
**UI reference:** UIE's upcoming **timeline (Gantt) and import-preview mockup — TBD** (link to be added when UIE posts it). Part A's unowned-task note and the Depends On control follow UIE's notes on Deven's branch.
**QA reference:** Queen's Part A cases `qa-run/opstrack_cr22a_cases.md` (DRAFT v1.1, TC-22A-001 to TC-22A-04x; outside the repo, re-baseline against this CR).

**Doc change log:**
- v0.3.1 (2026-11-11 ~12:31 AM SGT): **Locked for build (Lean).** Lean accepted all 12 proposed defaults; **closed:** Q-127, Q-128, Q-133, Q-134, Q-136, Q-140, Q-141, Q-142, Q-143, Q-145, Q-146, Q-148. **Q-145 addition:** because a blank cell clears a field, the import preview lists, row by row, every field that will be cleared before the PM confirms (FR-TL-17, new AC-74.12, EC-202). Only **Q-144** (paid Gantt licence) stays open for Jomerson. Part A builds now; Part B slice 1 starts once Jomerson has answered Q-144 and seen UIE's mockup.
- v0.3 (2026-11-11 ~12:28 AM SGT): **Lean's calls.** **Closed:** Q-135 (Delayed = not done and due before today or forecast after baseline finish; "Finished late" neutral), Q-137 (baseline columns export-only, ignored on import, preview notice), Q-147 (reopen clears actual finish, keeps actual start), Q-149 (Task number unique in file, `Depends on` references it, final numbers on save, new tasks at end). **A-53** (cancelled tasks left out of a phase) and **A-54** (blank template = all new rows) confirmed. **Proposed defaults (Rich), Lean to review:** Q-127, Q-128, Q-133 (rest), Q-134 (rest), Q-136, Q-140, Q-141 (adjusted to the existing phase-edit rule), Q-142, Q-143, Q-145, Q-146, Q-148. Q-144 open for Jomerson. Adds AC-73.6, 73.7, AC-74.10, 74.11, EC-201. No IDs renumbered.
- v0.2 (2026-11-11 ~12:24 AM SGT): **Lean's Part B calls.** **Closed:** Q-129 (target date = existing `plannedEndDate`), Q-130 (per-project phase list with order and PM-set target completion; actual completion = latest task finish once all done; one-time migration), Q-131 (Mon–Fri minus stored holidays), Q-132 (warn, never block or auto-shift; FS, no lag; red link), Q-138 and Q-139 (hidden Task ID + hidden metadata sheet; blank Task ID = new task; Task number display only; changed-after-export rows flagged until confirmed). **Partly closed:** Q-133 and Q-134 (auto actual dates, PM-editable; Save baseline copies every task's planned dates + `baselineHistory` entry). Q-144 kept open for Jomerson with Deven/Lean's free-library recommendation. Added FR-TL-23 to 26, AC-72.6 to 72.8, AC-74.7 to 74.9, EC-198 to 200, A-53, A-54, Q-147 to Q-149 (open). Rebased on `main` `22958d9` (CR-21 merged).
- v0.1 (2026-11-11, SGT): first draft from Lean's locks. Part A: PM sees only projects they manage or belong to (all project-based surfaces; Viewer, Admin and the Clients list unchanged); the Planning → Active owner block is removed and replaced by a non-blocking note; Depends On select/remove recorded as a bug fix. Part B: Gantt with phases, milestones, phase completion dates, target delivery line, finish-to-start dependencies, baseline vs actual, delayed in red, critical path and forecast vs target, Excel import (preview first, add or update by task number, never delete) and export in the same template. 20 open questions (Q-127 to Q-146).

## 0. What the build has today (baseline)
| Area | Today | Where |
|---|---|---|
| Stack | MongoDB via Mongoose (not Prisma) | `apps/api/src/models/` |
| Project scope | `projectScopeFilter()` limits **only MEMBER** to `memberIds`; PM, Viewer, Admin see all projects (Q-12: "view all, edit own") | `apps/api/src/services/scope.ts` |
| Direct link | `assertProjectScope()` returns 404 only for a MEMBER who isn't on the project | `scope.ts` |
| "My projects" | `GET /projects?mine=true` = `managerId` is me (excludes projects where I'm only a member) | `apps/api/src/routes/projects.ts` `GET /projects` |
| Clients list scope | `visibleClientIds()` limits only MEMBER; every other role sees all clients | `scope.ts` |
| Owner block | Planning → Active returns **422 `TASKS_WITHOUT_OWNER`** "Give these tasks an accountable owner first: {names}." when any non-cancelled task has `ownerId: null` (AC-10.3) | `projects.ts` `PATCH /projects/:id` |
| Other status rules | 422 `INVALID_TRANSITION` (`PROJECT_TRANSITIONS`); → Completed with open tasks 422 `OPEN_TASKS`; Completed plan read-only 422 `PROJECT_COMPLETED` (`assertPlanOpen`) | `projects.ts` |
| Depends On UI | Native `<Form.Select multiple>`; selection read from `selectedOptions` | `apps/web/src/pages/projects/TaskFormModal.tsx` (Depends on group) |
| Depends On API | `dependsOn: ObjectId[]` (max 50); `validatePlan` refuses self (`DEPENDENCY_CYCLE`), other project (`INVALID_DEPENDENCY`), cycles (`DEPENDENCY_CYCLE`); `[]` is accepted and saved | `apps/api/src/routes/tasks.ts` `validatePlan`, `PATCH /tasks/:id`; `packages/shared/src/projects.ts` `findCycle` |
| Predecessor rule | Task can't go In Progress / Completed while a predecessor is open, unless a planner overrides with a reason (FR-TSK-04); 409 `PREDECESSOR_INCOMPLETE` | `tasks.ts` `POST /tasks/:id/status` |
| Task dates | `plannedStart`, `dueDate` (calendar dates), `isMilestone`, free-text `phase`, `order` (task number, renumbered 1…n on delete by CR-20) | `apps/api/src/models/Task.ts` |
| Project dates | `startDate`, `plannedEndDate` (baseline), `baselineHistory[]` (re-baseline needs a reason, FR-PRJ-12); `computed.forecastEnd`, `scheduleVarianceDays`, `health` | `apps/api/src/models/Project.ts`; `forecastEnd()`, `projectHealth()` in shared |
| Phases | Derived from task `phase` text; add/rename/delete via `/projects/:id/phases` (PMs, Planning only) | `tasks.ts` phases routes |
| Not stored | Per-task baseline dates, actual start/finish, phase dates, float / critical flag | — |
| Working days | `workingDaysSetting()`, official holidays | `apps/api/src/services/calendar.ts`, `officialHolidays.ts` |
| Excel | `exceljs` in api and web; CR-19 client import (template, preview, commit, signed preview token, 409 `PREVIEW_STALE`, rate limits) | `apps/api/src/routes/clientImport.ts`, `services/clientImport/*` |
| Timeline tab | Placeholder `ComingSoonTab` | `apps/web/src/pages/projects/ProjectDetailPage.tsx` |

---

# Part A — Quick fixes (Locked, Lean, 2026-11-11)

## A1. Scope
**In scope:** PM project visibility on every project-based surface; removing the owner block on Planning → Active with a non-blocking note; restoring select and remove on Depends On.
**Out of scope:** Viewer visibility; Admin visibility; Clients list; edit scope (`PM_PROJECT_EDIT_SCOPE` stays `OWN`); Member rules; reminders for unowned tasks; any other status rule.

## A2. Functional requirements
- **FR-PRJ-35 (Must, Locked)** A **PROJECT_MANAGER** sees only projects they **manage** (`managerId`) or are a **member** of (`memberIds`). **ADMIN** still sees all. Amends doc 09 **Q-12** ("view all" becomes "view own or member; edit own") and doc 11 **FR-ACL-07**. Enforced in the API (`projectScopeFilter` and every role check that today special-cases MEMBER), not only in the UI.
- **FR-PRJ-36 (Must, Locked)** PM scope covers **everything project-based**: projects list (rows, `total`, status/health/Archived counts, search, client and project-type filters), dashboards, reports, exports, project pickers (timesheet, quick activity, task create, issue link and similar), template project counts, notifications and Clients › Projects tab and count (FR-CLI-12). The **Clients list is not project-based and stays unchanged** (`visibleClientIds` keeps its MEMBER-only rule).
- **FR-PRJ-37 (Must, Locked)** A PM who isn't the manager or a member gets **404** on direct links to that project and to anything under it (tasks, documents, issues, follow-ups, time, activity), the same as a Member (FR-ACL-09: no existence leak).
- **FR-PRJ-38 (Must, Locked)** **Viewer visibility stays exactly as it is today.** Only PM scope changes.
- **FR-PRJ-39 (Must, Locked)** A project's status may change even when some tasks have no owner. Only the `TASKS_WITHOUT_OWNER` block on Planning → Active is removed; amends doc 05 **AC-10.3**. **Every other status rule still holds**: `INVALID_TRANSITION`, Completed with open tasks (`OPEN_TASKS`), `PROJECT_COMPLETED`, timers stop on On Hold or close (EC-76).
- **FR-PRJ-39a (Must, Locked)** When the project has unowned tasks, the status control shows a **non-blocking note** with the **count of unowned tasks, excluding cancelled ones**, with singular / plural wording (UIE copy). Saving stays enabled. **No reminders** or notifications. **Closed (Lean, Q-127):** the note shows only on **Planning → Active**, the one transition that used to be blocked.
- **FR-TSK-37 (Must, Locked: bug fix)** Depends On works again: on the task form a planner can **select** one or more tasks of the same project as dependencies, **remove** any one of them, and **clear all**, then save; reopening shows exactly what was saved. The control must make add and remove visible and work by mouse, keyboard and touch (no hidden Ctrl/Cmd-click). The options list every other task of the project as `#{number} {name}`. Existing API rules stay (self, other project and cycle refused; max 50; PM-only per FR-TSK-14). This is a **bug fix, not a new rule**; the likely cause is the native multi-select (§A6).

## A3. User stories
- **US-69** As a PM, I want to see only the projects I manage or belong to, so my lists, dashboards and reports aren't crowded with other PMs' work.
- **US-70** As a PM, I want to move a project to Active even if some tasks don't have an owner yet, and see how many are unowned, so the project isn't stuck while I staff it.
- **US-71** As a PM, I want to pick and remove a task's dependencies easily, so the plan shows the real order of work.

## A4. Acceptance criteria
- **AC-69.1 (API)** PM `GET /projects` returns only projects where they are manager or member; `total` and every count match those rows only. (FR-PRJ-35)
- **AC-69.2 (API)** Admin and Viewer `GET /projects` return the same rows as before this CR; Member unchanged. (FR-PRJ-35, FR-PRJ-38)
- **AC-69.3 (API/UI)** PM direct link to a project they aren't on, and to its tasks, documents, issues, follow-ups and time by id, returns **404** and the web shows the not-found page with no project name. (FR-PRJ-37)
- **AC-69.4 (API/UI)** Dashboards, reports, exports, project pickers and template project counts offer and count only the PM's projects; the Clients list shows the same clients as before. (FR-PRJ-36)
- **AC-69.5 (API)** Adding a PM to a project's members makes it visible on next load; removing them (and not the manager) hides it and its direct link returns 404. (FR-PRJ-35, FR-PRJ-37)
- **AC-69.6 (API)** `?mine=true` behaves as before (manager only). (FR-PRJ-35)
- **AC-70.1 (API)** Planning → Active with unowned non-cancelled tasks returns **200**; `TASKS_WITHOUT_OWNER` is no longer returned. (FR-PRJ-39)
- **AC-70.2 (API)** Active → Completed with open tasks still returns 422 `OPEN_TASKS`; an invalid transition still returns 422 `INVALID_TRANSITION`. (FR-PRJ-39)
- **AC-70.3 (UI)** On Planning → Active, with 2 unowned tasks and 1 cancelled unowned task the note says 2 tasks have no owner; with 1, singular wording; with none, no note; Save stays enabled. (FR-PRJ-39a; Q-127 closed)
- **AC-70.4 (API)** The status change is audited as before (old, new, who). (FR-PRJ-39, FR-AUD-01)
- **AC-71.1 (UI/API)** A planner selects one dependency, saves, reopens: it is shown selected and the task's `dependsOn` holds it. (FR-TSK-37)
- **AC-71.2 (UI/API)** Selecting several, removing one, and clearing all each save and reopen correctly; clearing saves `dependsOn: []`. (FR-TSK-37)
- **AC-71.3 (UI)** Add and remove work with mouse, keyboard only, and on a 390px touch viewport. (FR-TSK-37)
- **AC-71.4 (API)** Self, other-project and cyclic dependencies are still refused with the existing codes. (FR-TSK-37)

## A5. Edge cases
- **EC-183** PM is both manager of one project and only a member of another: both visible; edit still only where `PM_PROJECT_EDIT_SCOPE` allows (manager), plan rights as today (`isPlanner` / `isProjectPm`).
- **EC-184** Archived projects: the PM sees archived projects they manage or belong to under Archived; others not, and counts exclude them.
- **EC-185** Client detail of a client whose projects are all outside the PM's scope: the client still shows in the Clients list (unchanged); its Projects tab shows none and a 0 count (FR-CLI-12).
- **EC-186** A PM loses membership while a page is open: next API call for that project returns 404; the UI handles it like a Member removed from a project.
- **EC-187** Depends On with a task that is later deleted: the delete already removes it from other tasks' `dependsOn`; the form must not show a blank or stale option.

## A6. Depends On root cause (for the record)
The API accepts select and clear (`[]` is saved). The web control is a native multi-select: a plain click replaces the selection, adding or removing needs Ctrl/Cmd-click, there's no visible remove affordance, and touch browsers open a native picker. That matches "can't select or delete". Also rule out on staging: the form opens only for planners (FR-TSK-14), and Completed projects are read-only. No web unit test covers the control today; Deven's fix adds one (AC-71.1 to 71.3). Queen's TC-22A-040 records the failure on staging before the fix.

---

# Part B — Project timeline (Locked scope, Lean, 2026-11-11; build order in §B9)

## B1. Scope
**In scope:** a Gantt chart per project in the Timeline tab (replaces the FR-PRJ-07 placeholder; brings doc 09 A-02 and A-06 forward from Phase 2); phases, milestones, phase completion dates, target delivery date line; finish-to-start dependencies; saved baseline vs actual; delayed tasks in red; critical path with forecast end vs target; Excel import (preview first, add or update by task number, never delete) and export in the same template.
**Out of scope:** SS, FF and SF dependency types (FS only, Locked); resource levelling; cost; deleting tasks by import; a portfolio (multi-project) Gantt; mobile unless Q-143 says so.

## B2. Data model (checked against the schema)
Lean noted tasks already store `dependsOn` and `phase`. Checked: **`plannedStart` (start date) and `isMilestone` also already exist** on `Task` and are edited in the task form today, so B doesn't need to add them. Real gaps:
| Gap | Proposed field (Deven's naming) | Notes |
|---|---|---|
| Per-task baseline | `baseline: { start, finish }` on Task; project `baselineHistory[]` gets an entry on each save | **Closed (Q-133 part):** Save baseline copies every task's planned dates into these fields and adds a `baselineHistory` entry (FR-TL-08). Who may save and reason: Q-133 closed (Admin or PM on the project; reason optional) |
| Actual dates | `actualStart`, `actualFinish` on Task | **Closed (Q-134 part):** set automatically on first In Progress / on Completed; PM can edit both (FR-TL-10). Reopen clears actual finish, keeps actual start (Q-147 closed). Backfill: none (Q-134 closed) |
| Phases | New per-project **phase list** (name, order, PM-set **target completion date**); tasks reference a phase from the list; one-time migration from task `phase` text | **Closed (Q-130):** actual completion = latest task finish once every task in the phase is done (FR-TL-03, 23, 24) |
| Target delivery date | existing project `plannedEndDate` | **Closed (Q-129):** no new field (FR-TL-05) |
| Float / critical / forecast per task | computed, not stored (or cached with `computed`) | Working days Mon–Fri minus stored holidays (**Closed, Q-131**; FR-TL-12) |
| Dependency type / lag | none: FS, no lag in v1 | **Closed (Q-132)** (FR-TL-06, 07) |
Dates stay calendar dates at UTC midnight (doc 07).

## B3. Functional requirements
**Step 1: Gantt, dependencies, milestones, target date**
- **FR-TL-01 (Must)** The project **Timeline** tab shows a Gantt chart: a task list (number, name, owner, start, finish) beside a time scale with one bar per task from `plannedStart` to `dueDate`. Zoom by day, week and month (UIE). Today line shown.
- **FR-TL-02 (Must)** Tasks missing a start or finish are listed under **Unscheduled** (no bar) so they aren't lost. A task with only a finish is shown as unscheduled unless it is a milestone (FR-TL-04).
- **FR-TL-03 (Must, Locked)** Tasks are grouped by **phase** in the phase list's order (FR-TL-23), each with a summary bar from its earliest start to its latest finish and its **PM-set target completion date**. **Cancelled tasks are left out of a phase** (A-53 confirmed): the phase is **complete when all its other tasks are done**, and its **actual completion date is the latest finish among them**. If every task in the phase is cancelled, the phase has **no completion date**. Tasks without a phase sit under "No phase".
- **FR-TL-04 (Must)** Tasks with `isMilestone` are drawn as a **milestone marker** (diamond) on their finish date. Milestones show on the chart and in FR-DASH-04.
- **FR-TL-05 (Must, Locked)** The project's **target delivery date** is the existing project **`plannedEndDate`** (no new field; Q-129 closed), drawn as a vertical line labelled with the date. Changing it stays a re-baseline with a reason (FR-PRJ-12).
- **FR-TL-06 (Must, Locked)** Dependencies are **finish-to-start with no lag in v1** (Q-132 closed): a task shouldn't start before the task it depends on finishes. The Gantt draws an arrow from each predecessor's finish to the successor's start. FR-TSK-04's status rule stays.
- **FR-TL-07 (Must, Locked)** When a successor's start is on or before a predecessor's finish, the app **warns and does not block** the save, and **never auto-shifts** dates (Q-132 closed). The violated link shows **red** on the chart. The forecast and critical path assume the task starts no earlier than its predecessor finishes (FR-TL-12).
**Step 2: baseline vs actual, delayed, critical path**
- **FR-TL-08 (Must, Locked)** **Save baseline** copies **every task's** planned dates (`plannedStart`, `dueDate`) into its per-task baseline fields and adds an entry to the project's **`baselineHistory`** (who, when, optional reason). It is the **only** way to set a baseline (import never does, FR-TL-15). **Closed (Lean, Q-133):** only an **Admin or a PM on the project** (the existing planner rule, `isPlanner`) may save; the reason is **optional**; every save is kept in `baselineHistory`.
- **FR-TL-09 (Must, Locked)** After a baseline exists, each bar shows the baseline as a thin bar under the current/actual bar, and the task list can show baseline start, baseline finish and variance (finish − baseline finish).
- **FR-TL-10 (Must, Locked)** **Actual start** is set automatically the **first time** a task goes In Progress, and **actual finish** when it goes Completed. **Reopening a task clears actual finish and keeps actual start** (Q-147 closed). The **PM can edit both** (planner rights, FR-TSK-14; audited). Bars show actual dates where they exist. **Closed (Lean, Q-134):** **no backfill**; actual dates start from the release, and the PM can enter them for older tasks.
- **FR-TL-11 (Must, Locked)** A task is **Delayed** (red) when it is **not Completed or Cancelled** AND either its **planned finish (`dueDate`) is before today** OR its **forecast finish (FR-TL-12) is after its baseline finish** (Q-135 closed). A task that is **Completed but finished after its baseline finish** shows **"Finished late"** in **neutral** styling, not red. A task with no baseline is judged on `dueDate` only; a task with neither is never Delayed.
- **FR-TL-12 (Must, Locked)** The **critical path** is computed with CPM over FS dependencies with no lag (forward pass ES/EF, backward pass LS/LF, total float = LS − ES; critical = float ≤ 0) and **highlighted** on the chart. A task's earliest start is never before its predecessor's finish, even if its planned start is earlier (FR-TL-07). Durations and float are in **working days: Monday to Friday, skipping holidays the app already stores; if none are stored, Monday to Friday only** (Q-131 closed). **Closed (Lean, Q-148):** use the app's existing calendar, `loadCalendar()` (working-days setting FR-CAL-05, Mon–Fri by default, plus stored holidays incl. `SPECIAL_WORKING` days) with shared `isWorkingDay` / `addWorkingDays`, so the timeline matches every other date the app calculates. Completed and Cancelled tasks count with their actual / zero remaining duration (Deven).
- **FR-TL-13 (Must, Locked)** The chart header shows the **forecast end date** (end of the critical path, FR-TL-12) against the **target delivery date** (`plannedEndDate`) with the working-day difference ("N days late" in red / "N days early"). **Closed (Lean, Q-136):** the CPM forecast is shown **on the timeline only**; the stored FR-PRJ-09 forecast (`computed.forecastEnd`), schedule variance and health (FR-PRJ-10) stay as they are for the projects list, dashboards and reports.
- **FR-TL-14 (Must)** Edit rights: only the project's planners (FR-TSK-14: Admin, PM who may edit the project, Project PM) import, save a baseline, change dates or edit actual dates. **Closed (Lean):** **Q-142** anyone who can view the project (access rule `tasks` View plus project scope) sees the Timeline **read-only**, including **Viewer** under the existing rules; **client portal** users don't see it in v1. **Q-143** **web only** in v1, **no dragging** of bars or links; edits go through the task form and import.
**Step 3: Excel import and export**
- **FR-TL-15 (Must, Locked)** **Download timeline (.xlsx)** exports the project's tasks in the template of §B4, with a **hidden Task ID column** and a **hidden metadata sheet** (project id, export time), so a PM can download, edit and re-upload. Baseline columns are **filled on export and ignored on import** (Q-137 closed). **Closed (Lean, Q-145):** **Cancelled tasks are exported** so the file round-trips.
- **FR-TL-16 (Must, Locked)** **Download template** gives the same workbook with headers, the Instructions sheet and no task rows.
- **FR-TL-17 (Must, Locked)** **Import from Excel** first shows a **preview** of every row as New / Update / Unchanged / Changed since export / Error with row-level messages (§B5). **Nothing is saved** until the PM confirms. Whenever the file's baseline columns hold values, the preview shows a **notice** that they are ignored and the PM should click **Save baseline** after the import (Q-137 closed). **Closed (Lean, Q-146):** **any row error blocks the whole commit** (dependencies between rows make skipping unsafe); Changed-since-export rows wait for the PM's confirm (FR-TL-25). **Cleared fields (Q-145, Lean):** because a blank cell clears a field, the preview lists, **row by row, every field that will be cleared** (e.g. "Owner will be cleared", "Depends on will be cleared") **before the PM confirms**.
- **FR-TL-18 (Must, Locked)** Commit **adds or updates** tasks, matched by the hidden **Task ID** (Q-139 closed). A row **without a Task ID becomes a new task** (Q-138 closed). **Task number must be unique in the file** and is used only as the row reference for `Depends on`, so new rows can depend on each other and on existing tasks (Q-149 closed). On save the app **assigns the final task numbers**; **new tasks go to the end** in file order. Import **never deletes** tasks.
- **FR-TL-19 (Must)** Each created or updated task is audited (FR-AUD-01) with the import as the source; one summary entry per import (rows added, updated, unchanged).
- **FR-TL-20 (Must)** Import runs the same plan rules as the task form: dates in order, dependencies in the project, no cycles (`findCycle`), max 50 dependencies, PM-only fields. **Closed (Lean, Q-141):** import is allowed when the project status is **`PLANNING`, `ACTIVE` or `ON_HOLD`** and refused for **`COMPLETED`** (already read-only, `PROJECT_COMPLETED`), **`CANCELLED`** and **archived** projects (`archived` is a flag, not a status). A **new phase name** in the file is created **at the end of the phase list** with a **warning** in the preview, but only where the existing phase rule allows it (`phaseEditableNow`: Admin any time, PM only in Planning, FR-PRJ-22/23); otherwise that row is an error. *(Rich adjusted the suggested default to the code's phase-edit rule; Lean accepted.)*
- **FR-TL-21 (Must)** Owner by email must match an active internal user; a blank Owner is allowed (Part A). **Closed (Lean, Q-140):** an owner who **isn't a project member is a row error**, never auto-added (the task form's add-and-assign, FR-PRJ-19, stays a deliberate step there).
- **FR-TL-22 (Should)** After a successful import the Gantt, critical path, delayed flags and forecast recompute (`recomputeProject`).
- **FR-TL-23 (Must, Locked)** Each project has a **phase list**: name, order and a **PM-set target completion date**. Tasks pick their phase from that list (task form, import). Existing phase add/rename/delete rules (FR-PRJ-22/23, Planning only for PMs) apply to the list unless Lean changes them. (Q-130 closed)
- **FR-TL-24 (Must, Locked)** A **one-time migration** turns the existing text phases on tasks into phase records per project (names matched ignoring case and spaces, doc 14 §J; order from the tasks' current order; target completion date blank) and points each task at its record. Run on staging first; on live with Jomerson's OK (as CR-20's one-time renumber). (Q-130 closed)
- **FR-TL-25 (Must, Locked)** If a matched task **changed after the file's export time** (metadata sheet), the preview **flags that row**, and **nothing is saved for it until the PM confirms** that row. Other rows are unaffected by the flag. (Q-139 closed)
- **FR-TL-26 (Must, Locked)** The metadata sheet's project id must match the project being imported into; otherwise the file is refused (file error). A Task ID that isn't a task of this project is a row error. (Q-139 closed)

## B4. Import / export template (Locked for build v0.3.1; column order Locked by Lean)
**Workbook:** `.xlsx`. **Sheets:** `Instructions` (how to fill each column, allowed values, date format, that rows are never deleted, that the hidden Task ID column must not be edited), `Timeline` (row 1 = headers exactly as below, data from row 2), and a **hidden metadata sheet** `_meta` (Locked, Q-139) holding **project id** and **export time** (UTC timestamp) and the template version. The sample file with fake data is **built by UIE and reviewed by Jomerson** before Deven builds the import; Rich doesn't build it.
**Dates:** a real Excel date cell, or text in **`YYYY-MM-DD`**. Other text formats (e.g. `03/04/2026`) are refused as ambiguous. Calendar dates, no time, no time-zone shift (doc 07). Export writes date cells formatted `yyyy-mm-dd`.
**Headers:** matched ignoring case and surrounding spaces; a missing, renamed or extra visible column is a **file error** (nothing previewed). Visible columns must be in this order (1 to 10); the hidden `Task ID` column comes after them (11).

| # | Header | Type | Required | Allowed values / format | Import behaviour | Export |
|---|---|---|---|---|---|---|
| 1 | `Task number` | Whole number ≥ 1 | Yes | **Unique in the file** (Q-149 closed) | **Row reference only**: `Depends on` points at these numbers, so new rows can depend on each other. Never used to match (Task ID matches). On save the app assigns the final numbers; new tasks go to the end. Duplicate in the file → every copy is an error | Current task number |
| 2 | `Task name` | Text, ≤ 200 | Yes | Trimmed; not blank | Sets the name (renames on update) | Name |
| 3 | `Phase` | Text, ≤ 120 | No | Matched to the phase list ignoring case and spaces (doc 14 §J) | Sets the phase; **blank clears it** ("No phase", Q-145 closed). New name → created at the end of the list with a warning where phase edits are allowed, else row error (Q-141 closed) | Phase |
| 4 | `Milestone` | Y/N | No | `Y`, `N`, `Yes`, `No` (any case); blank = N | Sets `isMilestone` | `Y` or `N` |
| 5 | `Start` | Date | No (needed for a bar) | §B4 date rule | Sets `plannedStart` | Start |
| 6 | `Finish` | Date | No (needed for a bar) | §B4 date rule; ≥ Start; a milestone may have Finish = Start | Sets `dueDate` | Finish |
| 7 | `Depends on` | List of task numbers | No | Whole numbers separated by `,` or `;` (e.g. `3, 5`); finish-to-start, no lag (Q-132 closed); no `FS`, `SS`, `+2d` suffixes | Each number must be a `Task number` **in this file** (Q-149 closed); replaces the task's dependencies; **blank clears them** (Q-145 closed); self or cycle → error | Predecessors' task numbers, comma-separated |
| 8 | `Owner` | Email | No | Active internal user's email; case-insensitive | Sets `ownerId`; **blank clears the owner** (Q-145 closed; allowed by Part A). Not a project member → row error (Q-140 closed) | Owner email, or blank |
| 9 | `Baseline start` | Date | No | §B4 date rule | **Ignored on import** (Q-137 closed); a filled value triggers the preview notice (FR-TL-17) | Task baseline start, or blank |
| 10 | `Baseline finish` | Date | No | §B4 date rule | **Ignored on import** (Q-137 closed); a filled value triggers the preview notice (FR-TL-17) | Task baseline finish, or blank |
| 11 (hidden) | `Task ID` | Text (internal task id) | No | Filled by export; blank for new rows | **Match key** (Q-139 closed). Found in this project → update that task. Blank → **new task** (Q-138 closed). Not a task of this project → row error. Duplicate in the file → every copy is an error | Task id (column hidden) |

Not in the template (by Lean's column list): status, assignees, estimate, priority, party. Import never changes them. **Blank cells (Q-145 closed):** a blank optional cell (Phase, Milestone = N, Start, Finish, Depends on, Owner) **clears** that field on an existing task; `Task name` is required and can't be blank.

## B5. Preview validation and messages (Locked rules; UIE final copy for wording)
File-level (nothing previewed): not `.xlsx` / unreadable; no `Timeline` sheet; headers missing or out of order; metadata project id is another project (FR-TL-26); file over the size or row limit (NFR-52); empty sheet.
Row-level (shown with the Excel row number and column):
- Task name is required.
- Task number must be a whole number of 1 or more.
- Task number {n} appears more than once in the file.
- Task ID {id} isn't a task in this project.
- Task ID {id} appears more than once in the file.
- (Flag, not an error) This task was changed in OpsTrack after the file was exported. Confirm to overwrite it. (FR-TL-25)
- {Column} isn't a valid date. Use a date cell or YYYY-MM-DD.
- Finish can't be before Start. (also Baseline finish before Baseline start)
- Milestone must be Y or N.
- Depends on: {n} isn't a task in this project or this file.
- Depends on: a task can't depend on itself.
- Depends on: circular dependency {a} → {b} → {a}.
- Depends on: use task numbers only, e.g. 3, 5.
- Owner {email} isn't an active internal user.
- More than 50 dependencies.
Each row shows its result (New / Update with the changed fields / Unchanged / Changed since export / Error). Totals at the top. Each Update row lists the fields that will change **and every field that will be cleared** (Q-145). Rows flagged Changed since export aren't saved unless the PM confirms them. Notices (not errors): "Baseline columns are ignored on import. Click Save baseline after importing to update the baseline." and "New phase {name} will be added at the end of the phase list." Additional row errors: "{email} isn't a member of this project. Add them to the project first."; "You can't add phase {name} while the project is {status}." **Confirm is disabled while any row has an error** (Q-146 closed).

## B6. User stories
- **US-72** As a PM, I want a Gantt chart of my project with phases, milestones, dependencies and the target delivery date, so I can see the plan at a glance.
- **US-73** As a PM, I want to save a baseline and see delayed tasks, the critical path and the forecast end against the target, so I know what threatens delivery.
- **US-74** As a PM, I want to download the timeline to Excel, edit it, and import it back with a preview of errors, so I can plan in a spreadsheet without breaking the project.

## B7. Acceptance criteria
- **AC-72.1 (UI)** Tasks with start and finish show as bars grouped by phase in plan order; tasks missing dates show under Unscheduled. (FR-TL-01 to 03)
- **AC-72.2 (UI)** A milestone task shows as a marker on its finish date. (FR-TL-04)
- **AC-72.3 (UI)** The target delivery date line shows at the correct date. (FR-TL-05)
- **AC-72.4 (UI)** Each dependency shows as a finish-to-start arrow; a successor starting on or before its predecessor's finish is flagged as a conflict. (FR-TL-06, 07)
- **AC-72.5 (UI)** Phase summary bars show the phase's target completion date and, once every task in it is done, its actual completion date = the latest task finish. (FR-TL-03)
- **AC-72.6 (API/UI)** Tasks pick a phase from the project's phase list; a PM sets each phase's order and target completion date. (FR-TL-23)
- **AC-72.7 (migration)** After the one-time migration, every distinct text phase in a project is one phase record (case and spaces ignored), every task points at its record, and no task loses its phase. (FR-TL-24)
- **AC-72.8 (UI/API)** Saving a task whose start is on or before its predecessor's finish succeeds with a warning; no date moves; the link shows red. (FR-TL-07)
- **AC-73.1 (API/UI)** Save baseline copies every task's planned start and finish into its baseline fields and adds one `baselineHistory` entry (who, when); the chart then shows baseline bars and variance. (FR-TL-08, 09)
- **AC-73.2 (API)** The first move to In Progress sets actual start (later moves don't change it); Completed sets actual finish; a PM can edit both and the edit is audited. (FR-TL-10)
- **AC-73.3 (UI)** An open task whose `dueDate` is before today, or whose forecast finish is after its baseline finish, is red (Delayed). A Completed task that finished after its baseline finish shows "Finished late" in neutral styling. A Cancelled task is never flagged. (FR-TL-11)
- **AC-73.6 (API)** Reopening a Completed task clears actual finish and keeps actual start; completing it again sets a new actual finish. (FR-TL-10)
- **AC-73.7 (UI)** Phase completion ignores Cancelled tasks; a phase whose tasks are all Cancelled shows no completion date. (FR-TL-03)
- **AC-73.4 (shared unit)** CPM on a fixed sample network returns the expected ES/EF/LS/LF, float and critical set in working days (Mon–Fri, stored holidays skipped), including parallel paths, a task with no dependencies, and a successor planned before its predecessor finishes (ES pushed to the predecessor's finish). (FR-TL-07, 12)
- **AC-73.5 (UI)** Critical tasks and links are highlighted; the header shows forecast end vs target with the day difference. (FR-TL-12, 13)
- **AC-74.1 (API)** Export downloads the §B4 workbook with the project's tasks; re-importing it unchanged shows every row as Unchanged and saves nothing. (FR-TL-15, 17)
- **AC-74.2 (API)** Template download has both sheets and only headers on `Timeline`. (FR-TL-16)
- **AC-74.3 (API/UI)** Each §B5 error is shown on the right row and column; nothing is saved before confirm. (FR-TL-17)
- **AC-74.12 (API/UI)** Re-importing an exported file where a row's Owner, Start and Depends on cells were emptied shows that row as Update with "Owner, Start and Depends on will be cleared" listed before confirm; after confirm those fields are empty on the task and nothing else changed. (FR-TL-17, Q-145)
- **AC-74.10 (API/UI)** A file with values in the baseline columns imports without changing any baseline, and the preview shows the "ignored, click Save baseline" notice. (FR-TL-15, 17)
- **AC-74.11 (API)** Two new rows (blank Task ID, Task numbers 21 and 22) where 22 depends on 21 import as two new tasks at the end of the list with the dependency kept; final numbers are assigned by the app. (FR-TL-18)
- **AC-74.4 (API)** Commit updates tasks matched by Task ID, adds rows without a Task ID as new tasks, ignores Task number for matching, and never deletes a task missing from the file. (FR-TL-18)
- **AC-74.5 (API)** A non-planner gets 403 on template, export, preview and commit; a PM outside the project gets 404 (FR-PRJ-37). (FR-TL-14)
- **AC-74.6 (API)** Each import is audited per task plus one summary entry. (FR-TL-19)
- **AC-74.7 (API/UI)** A matched task edited in the app after the file's export time is flagged in the preview and isn't saved unless the PM confirms that row. (FR-TL-25)
- **AC-74.8 (API)** A file whose metadata project id is another project is refused; a Task ID from another project is a row error. (FR-TL-26)
- **AC-74.9 (API)** Exporting, deleting a task in the app (task numbers shift, CR-20), then re-importing the file updates the right tasks by Task ID. (FR-TL-18)

## B8. Edge cases
- **EC-188** Project with no tasks, or all cancelled: empty chart with the target line; forecast = target or baseline end (EC-03 pattern).
- **EC-189** Several critical paths of equal length: all are highlighted.
- **EC-190** Dependencies on Cancelled tasks: satisfied (EC-16), not drawn as critical.
- **EC-191** Task depends on a task with no dates: link drawn to the unscheduled list; CPM treats it per Deven's rule, documented in the shared function.
- **EC-192** Baseline saved, then new tasks added: new tasks have no baseline and aren't delayed by the baseline rule until re-baselined (due date still applies).
- **EC-193** Import file exported before a task was deleted (numbers shifted, CR-20): matching is by hidden Task ID, so the right tasks update; the deleted task's row is a row error (Task ID not in this project) and is never recreated silently.
- **EC-194** Same file imported twice: second run shows all Unchanged.
- **EC-195** Two planners work on the same project: a task changed by the other planner after the export time is flagged per FR-TL-25. Simultaneous commits follow CR-19's busy/stale handling where it fits (NFR-52).
- **EC-196** Excel cell starting with `=`, `+`, `-` or `@` in export: written as a text cell, never a formula (CR-19 v0.8.2 rule).
- **EC-197** Very long project (many months) or many tasks: the chart stays usable with zoom and scroll (NFR-50).
- **EC-198** User unhides and edits the Task ID column or the metadata sheet: an unknown Task ID is a row error; a project id mismatch refuses the file (FR-TL-26).
- **EC-199** Task's phase deleted from the list while the task still uses it: blocked as today (phase delete blocked while tasks use it).
- **EC-200** Planned start before predecessor finish on many links: each link shows red; the forecast end moves later accordingly; nothing is auto-shifted (FR-TL-07).
- **EC-201** File uses a Task number that clashes with an existing task's current number but on a new row: allowed (numbers are file-local references); the app renumbers on save (FR-TL-18).
- **EC-202** A PM deletes a whole column's values by mistake (e.g. every Owner): every affected row lists the cleared field in the preview, so the mass clear is visible before confirm; nothing is saved without confirm (FR-TL-17).

## B9. Build order (Locked, Lean / Deven)
1. Gantt, dependencies, milestones, target date and the phase list with its one-time migration (FR-TL-01 to 07, 14, 23, 24).
2. Baseline vs actual, delayed and critical path (FR-TL-08 to 13).
3. Excel import and export (FR-TL-15 to 22, 25, 26).
UIE mocks the timeline and import preview before step 1 starts (mockup TBD).

## B10. Non-functional
- **NFR-50 (Must)** Schedule maths (CPM, float, delayed, forecast, phase dates) lives in one pure, unit-tested function in `@xc8/shared` so web and any later mobile agree. Chart render target for project size: Deven to state (not set here).
- **NFR-51 (Must)** All timeline dates are calendar dates and never shift with the viewer's time zone (doc 07).
- **NFR-52 (Must)** Import reuses `exceljs` and the CR-19 preview-then-commit shape; file size, row and rate limits follow CR-19's NFRs unless Lean sets others.
- **NFR-53 (Must)** Gantt library: MIT or similarly permissive. **Recommendation (Deven, Lean, 2026-11-11 ~12:24 AM SGT):** an MIT library plus our own critical-path and baseline calculations (NFR-50) is enough; a paid licence is only needed if **drag-to-reschedule** is wanted right away. Lean recommends building it ourselves on a free library. Decision stays with Jomerson (**Q-144, open**).
- **NFR-54 (Should)** The chart is readable at 1440 and usable at 390 (horizontal scroll, list collapsible), per UIE.

---

## 8. Assumptions
- **A-47 (Locked, Lean)** **All testing happens on staging.** The live seeded test accounts were **deactivated on purpose** by Jomerson and stay deactivated, so there are **no live test-account checks and no live QA**. After a live deploy we check **health** (`/api/v1/health`) plus **Jomerson's quick look**.
- **A-48** "Part of a project" = `managerId` or `memberIds` (doc 14 Project PM definition uses the team list, which is `memberIds`).
- **A-49** Milestones stay tasks with `isMilestone` (doc 09 A-06); no separate milestones collection in this CR.
- **A-50** Dependency type is FS with no lag in v1 (Q-132 closed), so no type or lag field is stored; existing `dependsOn` arrays are reused.
- **A-51** Placeholder accounts in examples and test data use `@xceler8.example` only (for example `pm@xceler8.example`, `member@xceler8.example`).
- **A-52** Web first. **Closed (Lean, Q-128):** PM scope lives in the API, so the mobile app inherits it automatically with **no mobile UI work**. Mobile timeline: none in v1 (Q-143 closed).
- **A-53 (Confirmed, Lean, 2026-11-11 ~12:28 AM SGT)** Cancelled tasks are left out of a phase. The phase is complete when all its other tasks are done, and its completion date is the latest finish among them. If every task in the phase is cancelled, the phase has no completion date (FR-TL-03).
- **A-54 (Confirmed, Lean, 2026-11-11 ~12:28 AM SGT)** The blank template (FR-TL-16) has the hidden Task ID column empty and a metadata sheet without a project id; it imports **every row as a new task**.

## 9. Amends
Doc 09 **Q-12** (PM view scope), doc 11 **FR-ACL-07**, doc 05 **AC-10.3** (owner block removed), doc 03 **FR-PRJ-07** (Timeline tab no longer a placeholder), doc 09 **A-02** (Gantt brought into this release), doc 01 Phase 2 list (Gantt).

## 10. Open questions (Lean answers; nothing here is decided)
| ID | Question | Status | Who |
|---|---|---|---|
| **Q-127** | Does the unowned-task note show on every status change, or only Planning → Active? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** only **Planning → Active**. Reason: it replaces the block that existed only on that transition (AC-10.3); elsewhere it would be noise. | Lean |
| **Q-128** | Does PM scope apply in the mobile app now? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** yes, automatically, with **no mobile UI work**. Reason: scope is enforced in the API (`projectScopeFilter`), which the mobile app already calls. | Lean |
| **Q-129** | Is the **target delivery date** the existing project `plannedEndDate`, or a new field? | **Closed (Lean, 2026-11-11 ~12:24 AM SGT):** the existing `plannedEndDate`; no new field (FR-TL-05). | Lean |
| **Q-130** | Phases: derived from task text, or a phase record? Phase completion date derived or PM-set? | **Closed (Lean, 2026-11-11 ~12:24 AM SGT):** per-project phase list with name, order and a PM-set target completion date; tasks pick from it; actual completion = latest task finish once every task in the phase is done; one-time migration from text phases (FR-TL-03, 23, 24). | Lean |
| **Q-131** | Working days or calendar days? | **Closed (Lean, 2026-11-11 ~12:24 AM SGT):** Monday to Friday, skipping holidays the app already stores; if none, Mon–Fri only (FR-TL-12). | Lean |
| **Q-132** | Successor starts before predecessor finishes: block, warn or auto-shift? Lag? | **Closed (Lean, 2026-11-11 ~12:24 AM SGT):** warn, don't block, never auto-shift; FS with no lag in v1; violated link red; forecast and critical path assume start no earlier than predecessor finish (FR-TL-06, 07, 12). | Lean |
| **Q-133** | Baseline: who may save it, and is a reason required? | **Closed (Lean, 2026-11-11 ~12:24 AM SGT, part):** copies every task + `baselineHistory` entry (FR-TL-08). **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** **Admin or a PM on the project** (existing `isPlanner` rule); reason **optional**; history kept in `baselineHistory`. Reason: same people who change the plan today; FR-PRJ-12's required reason guards the project target date, which Save baseline doesn't change. | Lean |
| **Q-134** | Backfill actual dates for existing tasks? | **Closed (Lean, 2026-11-11 ~12:24 AM SGT, part):** automatic, PM-editable (FR-TL-10). **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** **no backfill**; actual dates start from the release and the PM can enter older ones. Reason: the audit log isn't a reliable source for first In Progress / Completed on old tasks, and a guessed date would be worse than a blank. | Lean |
| **Q-135** | What exactly counts as Delayed? | **Closed (Lean, 2026-11-11 ~12:28 AM SGT):** not Done or Cancelled AND (`dueDate` before today OR forecast finish after baseline finish) → red. Done after baseline finish → "Finished late", neutral (FR-TL-11). | Lean |
| **Q-136** | Does the CPM forecast replace FR-PRJ-09's forecast? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** **timeline only**; `computed.forecastEnd`, variance and health stay as they are. Reason: least disruptive — the stored forecast feeds the projects list, My projects dashboard, reports and health (`projectService.ts`, `reports.ts`, `ProjectsPage`, `MyProjectsView`), so changing it would shift badges app-wide. | Lean |
| **Q-137** | Do the baseline columns set the baseline on import? | **Closed (Lean, 2026-11-11 ~12:28 AM SGT):** filled on export, **ignored on import**; only Save baseline sets a baseline; preview shows a notice when they're filled (FR-TL-15, 17). | Lean |
| **Q-138** | Does a blank row key create a new task? | **Closed (Lean, 2026-11-11 ~12:24 AM SGT) (via Q-139):** a row with a blank **Task ID** creates a new task (FR-TL-18). | Lean |
| **Q-139** | How do we stop an old file updating the wrong tasks when task numbers shift (CR-20)? | **Closed (Lean, 2026-11-11 ~12:24 AM SGT):** hidden Task ID column + hidden metadata sheet (project id, export time); match on Task ID; Task number display only; a task changed after the export time is flagged and not saved until the PM confirms (FR-TL-15, 18, 25, 26). | Lean |
| **Q-140** | Owner who isn't a project member? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** **row error**, never auto-added. Reason: adding members is a deliberate, audited step (FR-PRJ-19) and changes who can see the project. | Lean |
| **Q-141** | Which statuses allow import? New phase names? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** allowed in `PLANNING`, `ACTIVE`, `ON_HOLD`; refused for `COMPLETED`, `CANCELLED` and archived (`archived` flag). New phase → added at the end of the list with a preview warning **only where `phaseEditableNow` allows** (Admin any time, PM in Planning); else row error. Reason: matches the task form and the existing phase rule (FR-PRJ-22/23). *(Adjusted to the code's phase-edit rule; Lean accepted.)* | Lean |
| **Q-142** | Who sees the Timeline? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** anyone who can view the project sees it **read-only**, including **Viewer** (default grid: `projects` V, `tasks` V) under the existing rules; **client portal** users don't in v1. Reason: same data as the checklist they already see; the portal isn't built (doc 15 is a contract only). | Lean |
| **Q-143** | Web or mobile? Drag to edit? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** **web only** in v1, **no dragging**; edits via the task form and import. Reason: mobile is on hold (doc 11), and drag-to-reschedule is the part that would need a paid library (Q-144). | Lean |
| **Q-144** | Is a commercial Gantt licence acceptable? | **Open (Jomerson).** Recommendation (Deven, Lean, 2026-11-11): MIT library + our own critical-path and baseline maths is enough; paid licence only if drag-to-reschedule is wanted right away; Lean recommends building it ourselves on a free library (NFR-53). | Jomerson |
| **Q-145** | Blank cells: clear or keep? Export Cancelled tasks? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** a blank cell **clears** optional fields; `Task name` is required. **Cancelled tasks are exported** so the file round-trips. Reason: export writes every field, so a blank in a re-uploaded file means "no value"; keeping old values would make clearing impossible. | Lean |
| **Q-146** | Do row errors block the whole commit? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** **yes, any row error blocks the commit**; Changed-since-export rows wait for the PM's confirm. Reason: rows reference each other through `Depends on`, so skipping one can break another; stricter than CR-19 on purpose. | Lean |
| **Q-147** | Reopen: clear actual finish? | **Closed (Lean, 2026-11-11 ~12:28 AM SGT):** reopening clears actual finish and keeps actual start (FR-TL-10). | Lean |
| **Q-148** | Does the timeline follow the working-days setting? | **Closed (Lean, 2026-11-11 ~12:31 AM SGT):** **yes**, via `loadCalendar()` (setting FR-CAL-05, default Mon–Fri `DEFAULT_WORKING_DAYS`, plus stored holidays incl. `SPECIAL_WORKING`). Reason: every other calculated date uses that calendar; with the default setting this is exactly Q-131's Mon–Fri rule. | Lean |
| **Q-149** | What does `Depends on` refer to for new rows? | **Closed (Lean, 2026-11-11 ~12:28 AM SGT):** Task number, unique in the file; new rows can depend on each other; existing tasks still match by Task ID; final numbers assigned on save, new tasks at the end (FR-TL-18). | Lean |

## 11. Status
- **v0.3.1 — locked for build (Lean, 2026-11-11 ~12:31 AM SGT)** except **Q-144** (Jomerson). **Closed:** Q-127 to Q-143, Q-145 to Q-149. **Open:** Q-144 only.
- **Part A builds now** (Deven, own branch). **Part B slice 1 starts once Jomerson has answered Q-144 and seen UIE's mockup.**
- **Part A:** Deven building on his own branch; Queen's cases `qa-run/opstrack_cr22a_cases.md`; testing on staging only (A-47).
- **Part B:** UIE mockup (timeline + import preview) and the sample template file (UIE builds with fake data; Jomerson reviews) come before the build. Build order §B9.
- Once approved: FR-PRJ-35 to 39a into doc 03 (and FR-ACL-07 / Q-12 notes in docs 11 and 09), FR-TSK-37 into doc 03, FR-TL-01 to 26 into doc 03 (new Timeline section), US-69 to 74 into doc 04, AC-69.x to 74.x into doc 05 (AC-10.3 amended), EC-183 to 200 into doc 08, NFR-50 to 54 into doc 07, A-47 to 54 and Q-127 to Q-149 into doc 09.
