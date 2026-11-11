# CR-23 — Checklist Excel import and deliverable checklists

**Status:** v0.1.1 draft (2026-11-11 ~9:05 AM SGT) · v0.1 draft (2026-11-11 ~9:00 AM SGT) · **Author:** Business Analyst (Rich) · **For:** Jomerson (approval), Lean, Deven, Queen, UIE
**Requested by:** Jomerson (Lead Dev / owner) in the PM room, 2026-11-11 ~8:54 AM SGT, verbatim:

> 1.add this feature on the Project > Checklist> Add Function where only the PM can 1.1Download the Checklist Template> and Uploaded/Updated Via Excel File.
> 1.2Add Phase and Project
> 1.3All Project Member will automaticcally added.
> 1.4Also Make the Deliverable> allow user to Create new List of Record also in Checkbox. when completed it will be Check and Strikethrough.

**Rules locked by:** Lean (PM room, 2026-11-11 ~8:55 AM SGT, and follow-up calls 2026-11-11 ~9:03 AM SGT). Rules marked **Locked** are Lean's. Anything not locked is an assumption (§8) or an open question (§10). Rich's notes in §10 on questions that are still open are suggestions only and are **not decided**.
**Part of:** doc 17 (change requests). CR-23 is summarised in `17_CHANGE_REQUESTS.md` and specified in full here. It follows CR-22 and uses the next free IDs: **FR-PRJ-42**, **FR-TSK-38**, **FR-CLX-01 to FR-CLX-08** (new prefix: Checklist Excel), **FR-DLV-01 to FR-DLV-09** (new prefix: deliverable checklist items), **US-75 to US-77**, **AC-75.1 to AC-75.10**, **AC-76.1 to AC-76.13**, **EC-206 to EC-218**, **NFR-55 to NFR-58**, **A-55 to A-60**, **Q-150 to Q-165**.
**Checked against:** docs 01 to 17 and CR-22 v0.3.17 on `docs/cr-22-pm-timeline` `c9ef39c`; the build at `origin/feature/cr22-part-b` `04f73b6` (CR-22 Timeline Excel import) and `origin/main` `22958d9`. No IDs clash with CR-22 (CR-22 ends at FR-TL-33, FR-PRJ-41, FR-TSK-37, US-74, AC-74.14, EC-205, NFR-54, A-54, Q-149). Research notes: `pm-docs/research/cr23-checklist-findings.md` (outside the repo).
**Not built. Draft, not locked for build.** Five questions were closed in v0.1.1 (Q-152, Q-153, Q-154, Q-161, Q-163). Eleven remain open (Q-150, Q-151, Q-155, Q-156, Q-157, Q-158 narrowed, Q-159, Q-160 narrowed, Q-162, Q-164, Q-165). UIE has no mockup yet. The Excel half reuses the CR-22 Timeline import, which is on `feature/cr22-part-b` and is not on `main`; this CR should be built on top of that import, not against `main` alone.
**UI reference:** none yet (UIE). Until a mockup exists, the Checklist Excel buttons follow the Timeline import pattern (preview table, row errors, "Open this on a larger screen to make changes" at 390) and the deliverable list follows the rules in FR-DLV-03 and FR-DLV-08 (checkbox, strikethrough, a second done cue, 44px targets at 390).
**QA reference:** none yet (Queen). Cases can use the closed permission and template rules (Q-152, Q-153, Q-154, Q-161, Q-163). Behaviour that still forks (especially Q-151, Q-155, Q-158 cell format and replace-vs-append) should wait.

**Doc change log:**
- v0.1.1 (2026-11-11 ~9:05 AM SGT): **Lean's calls** (PM room, 2026-11-11 ~9:03 AM SGT). **Closed:** Q-152 (both imports stay, one shared import engine, two templates); Q-163 (Checklist template = CR-22 columns plus a Deliverables column; the Timeline template keeps the dates); Q-153 and Q-161 (anyone who can already edit the task under FR-TSK-14 — owner, assignees, PM, Admin — can add and tick its deliverable items; everyone else, including Viewers, is read-only); Q-154 closed by the same Viewer rule. **Q-158 narrowed:** items now round-trip via the Checklist file's Deliverables column; cell format, how done state is marked, and replace-vs-append on re-upload stay open, with a format proposal in FR-CLX-04. **Q-164** stays open; a shared engine makes shared rate-limit buckets likely, but Lean did not close it. **Q-150 and Q-151 stay open for Jomerson;** Lean: do not build owner auto-add yet. **Q-160:** Deven's note added — `deliverable` is plain text on both Task and Template; migration converts both; templates used to launch new projects carry the checklist items (unticked); over-cap text stays open. FRs, ACs and ECs updated; "any member may add" removed.
- v0.1 (2026-11-11 ~9:00 AM SGT): first draft from Jomerson's request and Lean's locks. Locked: Checklist Excel reuses the CR-22 Timeline import (download template, upload, preview, row errors, same limits); only the project's PM plus Admins can import; each task's Deliverable becomes a checklist that anyone can add items to; a ticked item shows checked with a line through it. "Anyone" is flagged as ambiguous for Viewers (Q-154, Q-161). Open: Q-150 to Q-165, each with a suggestion from Rich that is not decided.

---

## 0. What the build has today (baseline)

Line numbers are from `origin/feature/cr22-part-b` `04f73b6` unless noted.

| Area | Today | Where |
|---|---|---|
| Stack | MongoDB via Mongoose (not Prisma) | `apps/api/src/models/` |
| Checklist tab | The project's **task list**, grouped by phase. There is no separate Checklist collection. Index route of `/projects/:id/*`. Columns: #, Activity, Owner, Due, Est/Act, Status (a badge, not a tick). | `apps/web/src/App.tsx:101-107`; `ProjectDetailPage.tsx:99`, `:292`; `ProjectTabs.tsx` `ChecklistTab` (`:91`) |
| Add on the Checklist | **+ Add task** (header), **+ Add phase** (toolbar; Project PM in Planning, or Admin), **Apply template** (Planning only), **+ Add activity to Phase N** (phase fixed; not locked by status, Q-64) | `ProjectDetailPage.tsx:128-132`; `ProjectTabs.tsx:486-511`, `:191`, `:249`; `TaskFormModal.tsx:49` |
| Task model | `name`, `phaseId` / `phase`, `ownerId`, `assigneeIds[]`, `dueDate`, `plannedStart`, `status`, `dependsOn[]`, **`deliverable` (String, default null)** — plain text, plus CR-22 date/baseline fields | `apps/api/src/models/Task.ts:8-51` |
| Template activity | **`deliverable` (String, default null)** — the same kind of plain text | `apps/api/src/models/Template.ts:29` |
| Deliverable | One optional text field, Zod max 500, on **both** Task and Template activities. One input on the task form; plain text on the task panel. No sub-list, checkbox or strikethrough. | `packages/shared/src/projects.ts:203`, `:28`; `TaskFormModal.tsx:89`, `:446-449`; `TaskPanel.tsx:291` |
| Who may edit a task (FR-TSK-14) | Doc 03 FR-TSK-14: Members can update status, evidence, notes and time on tasks where they are **owner or assignee**; editing dates, estimates, owner or dependencies is **PM-only** (server). In the build, `taskCan` (`tasks.ts:102-141`) grants `edit` / `status` when the project is open (not archived, not Completed), the user has Edit on `tasks`, and they are a **planner** (`isPlanner`: Admin, or a PM who is the manager or on the team list — `scope.ts:106-112`) **or** `isMine` (owner or assignee). Viewers: `tasks` View only (`accessRules.ts:247`). | FR-TSK-14; `tasks.ts` `taskCan`; `scope.ts` |
| Completed / archived | Archived: 409 `PROJECT_ARCHIVED`. Completed: plan read-only, 422 `PROJECT_COMPLETED` (`assertPlanOpen`). `taskCan.open` is false when archived or Completed. Cancelled is **not** blocked by `assertPlanOpen`. | `apps/api/src/routes/projects.ts:97-119`; `tasks.ts:108` |
| Add-and-assign | On the task form only: a planner may add a person to the project and assign them in the same save (`addMemberIds`), audited as `project_member_added`. Not used by Excel. | FR-PRJ-19; `tasks.ts` `prepareMemberAdds` `:808-850`; `TaskFormModal.tsx:184` |
| Timeline Excel (CR-22) | `GET /projects/:id/timeline/template`, `.../export`, `POST .../import/preview`, `POST .../import/commit`. Planners only. Planning, Active, On Hold. Hidden Task ID + `_meta`. Preview then commit. 5 MB / 2,000 rows. 20 previews and 5 commits per user per 15 minutes. New phase only where `phaseEditableNow`. Owner not on the team = row error (FR-TL-21, Q-140). | `apps/api/src/routes/timelineImport.ts:78-84`, `:449-521`; `services/timelineImport/plan.ts:169-189`; `packages/shared/src/timelineImport.ts:137`; `packages/shared/src/clientImport.ts:31-33` |
| Phase lock | PMs add, rename, reorder or remove phases in Planning only; Admins any time (not archived). FR-PRJ-22/23, FR-TL-23. | `tasks.ts` `phaseEditableNow` `:226-233` |
| Not present | Checklist-tab Excel buttons; a deliverable item list; auto-adding owners from a file | — |

---

# Part A — Checklist Excel (Locked reuse, Lean, 2026-11-11 ~8:55 AM SGT; templates, Lean, ~9:03 AM SGT)

## A1. Scope

**In scope (Locked):** on the project **Checklist** tab, the project's PM and Admins can **download a checklist template**, **download the current checklist** as the same workbook, and **upload / update via Excel**, with a **preview**, **row errors**, and the **same limits** as the CR-22 Timeline import (5 MB, 2,000 rows, preview-then-commit, hidden Task ID, hidden `_meta` sheet). The file is imported **into the open project**. Phase matching and new-phase rules reuse FR-TL-20 unless Q-159 changes them. Owner-not-on-team reuses FR-TL-21 unless Q-151 changes it; **Lean (2026-11-11 ~9:03 AM SGT): do not build owner auto-add yet.** **Both imports stay** (Checklist tab and Timeline tab), with **one shared import engine** and **two templates** (Q-152 closed). The **Checklist template** is the CR-22 columns **plus a Deliverables column**; the **Timeline template keeps the dates** (Q-163 closed). Deliverable items **round-trip** through the Checklist file's Deliverables column (Q-158, format details still open).

**Out of locked scope until questions close:** creating a **new project** from the file (Q-150); auto-adding owners named in the file to the team (Q-151 — do not build yet).

**Not in this part:** the deliverable checklist UI (Part B), except that the Checklist file carries items in the Deliverables column.

## A2. Functional requirements

- **FR-PRJ-42 (Must, Locked)** The Checklist toolbar (FR-PRJ-29) gains **Download template**, **Download checklist (.xlsx)** and **Import from Excel** for users who may import (FR-CLX-01). These sit with "+ Add phase" and "Apply template". They do not replace those buttons, "+ Add task", or "+ Add activity". The Timeline tab **keeps** its own Excel buttons (Q-152 closed).

- **FR-CLX-01 (Must, Locked)** Only the **project's PM** (the assigned manager, or an Access-role PM on the team list) **and Admins** may download the template, download the current checklist, preview or commit an import. This is the existing planner rule (`isPlanner` + Edit on tasks), the same people as FR-TL-14. Members and Viewers do not see the buttons. The API returns **403 `FORBIDDEN`** if they call the endpoints, and **404** if a PM is outside the project (FR-PRJ-37).

- **FR-CLX-02 (Must, Locked)** File checks, preview-then-commit flow, hidden **Task ID** column, hidden **`_meta`** sheet (project id, export time), signed preview token, 409 `PREVIEW_STALE`, 429 `RATE_LIMITED` / `IMPORT_BUSY`, and row-error rules **reuse the CR-22 Timeline Excel import** (FR-TL-15 to 22, 25, 26; NFR-52; CR-19 NFR-36 and NFR-41) as **one shared import engine**. A row without a Task ID is a **new task**; a row with a Task ID **updates** that task; import **never deletes**. Any row error **blocks the whole commit**. A blank cell **clears** that field, and the preview lists, row by row, every field that will be cleared (FR-TL-17, Q-145). **Q-152 closed (Lean, 2026-11-11 ~9:03 AM SGT):** **both imports stay**, with **one shared import engine** and **two templates** (Checklist and Timeline). Suggested API (Deven chooses the exact paths): the existing `/projects/:id/timeline/template|export|import/preview|import/commit` stay for the Timeline tab; the Checklist tab uses aliases such as `/projects/:id/checklist/template|export|import/preview|import/commit` that call the **same service**, selecting the Checklist template (FR-CLX-04). **Q-164** (shared vs separate rate-limit buckets) stays **open**. A shared engine makes **shared buckets** likely (the same 20 previews and 5 commits per user per 15 minutes); Lean did not close Q-164, so do not treat shared buckets as decided.

- **FR-CLX-03 (Must, Locked)** Import is allowed when the project status is **Planning, Active or On Hold**, and is refused for **Completed**, **Cancelled** and **archived**, same as FR-TL-20 / Q-141, unless **Q-155** changes the Checklist entry point. Completed already returns 422 `PROJECT_COMPLETED`; archived already returns 409 `PROJECT_ARCHIVED`.

- **FR-CLX-04 (Must, Locked, Lean, 2026-11-11 ~9:03 AM SGT)** **Two templates, one engine (Q-152, Q-163).**
  - The **Checklist template** is the **CR-22 columns plus a Deliverables column**. The CR-22 visible columns (CR-22 §B4) are: Task number, Task name, Phase, Milestone, Start, Finish, Depends on, Owner, Baseline start, Baseline finish, then the hidden Task ID; plus the Instructions sheet and hidden `_meta`. This draft **does not drop** Start, Finish, Baseline start or Baseline finish from the Checklist template — Q-163 said "CR-22 columns plus a Deliverables column," and no one has said the date columns come off. The **Timeline template keeps the dates** (its Start, Finish, Baseline start and Baseline finish columns stay as they are in CR-22).
  - Deliverable items **round-trip** through the **Checklist file's Deliverables column** (Q-158). This draft does **not** add a Deliverables column to the Timeline template, because Lean named that column on the Checklist file; whether Timeline export should also include it is a narrow leftover under Q-158.
  - The **exact visible position** of the Deliverables column (for example after Baseline finish and before the hidden Task ID) and the exact header wording are not specified; they are a narrower leftover under Q-158. Rich suggests the header **Deliverables**, placed after Baseline finish and before hidden Task ID; that is not decided.
  - **Proposed cell format (not decided, Q-158):** items in one cell, **separated by line breaks**; a **done** item is marked with a leading `[x] ` (example: `[x] Signed-off test script`); an **open** item is a plain line or `[ ] ` (example: `Workshop notes` or `[ ] Workshop notes`). Export would write this from `deliverableItems` in `order`; import would parse it back into items. How done state is marked, whether `doneBy` / `doneAt` are left blank on import, and whether a re-upload **replaces** the task's items or **appends**, remain **open** under Q-158. Until replace-vs-append is answered, do not build a silent wipe.
  - Baseline columns stay export-only and ignored on import (Q-137 / FR-TL-15). File errors and row errors reuse the CR-22 §B5 / UIE Q24 copy where the rule is the same.

- **FR-CLX-05 (Must)** A **Phase** value is matched to the project's phase list ignoring case and spaces (doc 14 §J, FR-TL-20). A **new name** is created at the end of the phase list with a preview warning **only where `phaseEditableNow` allows** (Admin any time, PM only in Planning); otherwise that row is an error: "You can't add phase {name} while the project is {status}." (FR-TL-20, Q-141). **Q-159** asks whether Checklist import should let a PM add phases in Active or On Hold; until it is answered, keep this rule (Rich's suggestion, and it is the reused Timeline rule). The file is imported into the **open project only**. A `_meta` project id that is missing or blank is treated as a blank template (every row is new, A-54 / FR-TL-26). A made-up or other project's id is refused. **Creating a new project from the file is not in the locked scope**; that is **Q-150**.

- **FR-CLX-06 (Must)** Owner is an email. It must match an active internal user; a blank Owner clears the owner. **Q-151 stays open for Jomerson.** Until it is answered, an owner who **isn't a project member is a row error**, never auto-added (FR-TL-21, Q-140). **Lean (2026-11-11 ~9:03 AM SGT): do not build owner auto-add yet.** Message (reuse): "`{email} isn't a member of this project. Add them to the project first.`" Example email in fixtures and copy: `owner@xceler8.example`.

- **FR-CLX-07 (Must)** Each created or updated task is audited with the import as the source, plus one summary entry (rows added, updated, unchanged), same shape as FR-TL-19. Assignment notifications follow FR-TL-32 (one notice per import per new or changed owner, listing their tasks).

- **FR-CLX-08 (Must)** At **390**, Checklist import follows the Timeline phone rule (Q-143): the app shows **"Open this on a larger screen to make changes"** instead of the import preview table. Rich suggests the template and current-checklist downloads still work on a phone; UIE confirms. **Q-165** (mobile app scope) is open; this FR is for web responsive layout only.

## A3. User stories

- **US-75** As a project's PM (or an Admin), I want to download a checklist template, download the current checklist, and import an Excel file with a preview of errors, so I can add or update activities in a spreadsheet without breaking the project.
- **US-76** As a project's PM, I want a new phase name in the file to be added to this project when I'm allowed to add phases, so I don't have to create every phase by hand first. *(What "Add Phase and Project" means beyond this is Q-150.)*

## A4. Acceptance criteria

- **AC-75.1 (API/UI)** A planner on the project sees Download template, Download checklist and Import on the Checklist tab, and can complete a preview-then-commit of a valid file. A Member or Viewer does not see the buttons; `GET` template/export and `POST` preview/commit each return 403. A PM who is not on the project gets 404. The Timeline tab still has its own Excel buttons. (FR-PRJ-42, FR-CLX-01, Q-152)
- **AC-75.2 (API)** The blank **Checklist** template has the CR-22 columns **plus a Deliverables column**, an Instructions sheet, a hidden Task ID column (empty) and a `_meta` sheet without a project id; every row of a filled-in copy imports as a new task on the open project. The blank **Timeline** template is unchanged and **keeps the dates** (Start, Finish, Baseline start, Baseline finish). (FR-CLX-02, FR-CLX-04, A-54, Q-163)
- **AC-75.3 (API)** Exporting the current checklist and re-importing the file unchanged shows every row as Unchanged and saves nothing (once the Q-158 cell format is stable). After a task is deleted in the app (numbers shift, CR-20), re-importing an earlier export updates the right tasks by Task ID and never deletes a task that is missing from the file. (FR-CLX-02)
- **AC-75.4 (API/UI)** Each file error and row error uses the CR-22 §B5 copy where the rule is the same; nothing is saved before confirm; any row error blocks the whole commit; the preview lists fields that a blank cell will clear. (FR-CLX-02)
- **AC-75.5 (API)** A file larger than 5 MB, or with more than 2,000 data rows, is refused with the CR-22 / UIE Q24 messages and nothing is saved. Rate limits follow NFR-55 (and Q-164). (FR-CLX-02, NFR-55)
- **AC-75.6 (API)** Import on a Completed project returns 422 `PROJECT_COMPLETED`; on an archived project, 409 `PROJECT_ARCHIVED`; on a Cancelled project, refused as not importable (FR-CLX-03 / Q-141), unless Q-155 changes this. (FR-CLX-03)
- **AC-75.7 (API/UI)** On a Planning project, a new phase name "Go-live" in the file is added at the end of the phase list with a preview warning, and tasks in that row link to it by `phaseId`. On an Active project, the same file is a row error for the project's PM and succeeds for an Admin. (FR-CLX-05, Q-159)
- **AC-75.8 (API/UI)** A row whose Owner is `owner@xceler8.example` when that user is active but not on the project is a row error with the FR-TL-21 message, and the user is not added to `memberIds`. Owner auto-add is not built (Q-151 open; Lean: do not build it yet). (FR-CLX-06)
- **AC-75.9 (UI)** At 390, opening Import shows "Open this on a larger screen to make changes" and does not show the preview table. (FR-CLX-08)
- **AC-75.10 (API)** Exporting a task that has two deliverable items writes both into the Checklist file's Deliverables column. Re-importing that file (once Q-158's cell format and replace-vs-append are closed) restores those items on the same task. A Timeline export does not have to include this column. (FR-CLX-04, Q-158)

## A5. Edge cases

- **EC-206** Two planners preview overlapping files for the same project: commit handling follows CR-19 / CR-22 (409 `PREVIEW_STALE` or 429 `IMPORT_BUSY`); nothing is half-saved. (FR-CLX-02, NFR-55)
- **EC-207** A file whose `_meta` project id is another project, or a made-up id, is refused (FR-TL-26); a Task ID from another project is a row error. Nothing in the open project changes, and no new project is created (Q-150).
- **EC-208** Both entry points stay and share one engine, with two templates (Q-152, Q-163). What happens if a Timeline file (no Deliverables column) is uploaded on the Checklist tab, or a Checklist file (extra Deliverables column) is uploaded on the Timeline tab, is not specified; it is a leftover under Q-158. Do not invent a rule yet.
- **EC-209** Sharing or splitting rate-limit buckets (Q-164) must not let a user bypass the 5-commit / 20-preview window by switching tabs. A shared engine makes shared buckets likely; Q-164 stays open.
- **EC-216** Until Q-158 closes replace-vs-append and the cell format, a Checklist import must not silently wipe a task's deliverable items. (FR-CLX-04)
- **EC-217** A blank Deliverables cell: whether that clears all items (same as other blank cells, FR-TL-17) or leaves them unchanged is part of Q-158 (replace-vs-append / clear). The preview must list the effect once the rule is set.


---

# Part B — Deliverable checklists (Locked direction, Lean, 2026-11-11 ~8:55 AM SGT; who may add and tick, Lean, ~9:03 AM SGT)

## B1. Scope

**In scope (Locked):** each task's **Deliverable** becomes a **checklist**: users can **create a list of records** as checkboxes; when an item is completed it is **checked** and shown with a **line through** the text. **Who may add and tick (Locked, Lean, 2026-11-11 ~9:03 AM SGT):** anyone who can already **edit the task** under **FR-TSK-14** (the task's **owner** and **assignees**, the project's **PM**, and **Admin**, as those rules stand today — see §0 and FR-DLV-02) can **add and tick** its deliverable items. **Everyone else**, including **Viewers**, sees the list **read-only** (Q-153, Q-161, Q-154 closed). Existing `deliverable` **plain text on both Task and Template** is migrated to checklist items; templates used to launch new projects carry those items **unticked** (FR-DLV-04, Deven's note on Q-160).

**Out of locked scope until questions close:** item limits (Q-156); audit grain (Q-157); Deliverables-column cell format, done-state marking, and replace-vs-append (Q-158 narrowed); whether ticking every item changes task status (Q-162); over-cap migrated text (Q-160 narrowed).

## B2. Data model (suggested)

Suggested storage (Deven may adjust names, not the fields): a `deliverableItems` array of subdocuments on **`Task`** (`apps/api/src/models/Task.ts`) **and** on each **template activity** (`apps/api/src/models/Template.ts`), not a separate collection, so a task or activity and its items stay in one write. The existing task `version` can guard concurrency on tasks (EC-18).

| Field | Type | Rule |
|---|---|---|
| `_id` | ObjectId | Stable item id, used in the API and in the Checklist file's Deliverables column if Q-158's format needs it |
| `text` | String, required, trimmed | Suggested max **200** characters (Q-156). Reject blank text on new items. |
| `done` | Boolean, default `false` | Ticked = `true`. Template items, and items copied onto a new project, are **unticked**. |
| `doneBy` | ObjectId ref User, or null | Set when ticked; cleared when unticked. Null on template items and on migration. |
| `doneAt` | Date, or null | Set when ticked (server clock); cleared when unticked. Null on template items and on migration. |
| `order` | Number | Display order, 1…n in the list; reordering changes only this, like FR-PRJ-16 |
| `createdBy` | ObjectId ref User, or null | Null is allowed for migrated items (no original author) |
| `createdAt` | Date | Set on create or at migration |

Suggested index: none beyond the parent task or template. Suggested caps (Q-156, Rich, not decided): **50 items** per task or activity; text **200** characters on new items. Zod in `@xc8/shared`, alongside `createTaskSchema`.

Today `Task.deliverable` and template activity `deliverable` are both **plain text** (max 500). Both are **superseded** by `deliverableItems` after the one-time migration (FR-TSK-38, FR-DLV-04). After migration those string fields are no longer accepted on create or update.

## B3. Functional requirements

- **FR-DLV-01 (Must, Locked)** A task's Deliverable is a **list of checklist items** (FR-DLV data model above), not a single text field. The task form and the task panel show this list in place of the Deliverable text box. A template activity holds the same kind of list, all items unticked.

- **FR-TSK-38 (Must)** Amends FR-TSK-01, FR-TPL-03, FR-PRJ-02 and the task form / panel. The single `deliverable` string is removed from write APIs after migration. GET may omit it or keep it read-only as a join of item texts for old clients during one release; new work must use `deliverableItems`. When a plan is generated or a template is applied, the template activity's **checklist items** are copied onto the new task **unticked** (`done: false`, `doneBy` / `doneAt` null), in the same order (FR-DLV-04, Deven's note on Q-160).

- **FR-DLV-02 (Must, Locked, Lean, 2026-11-11 ~9:03 AM SGT)** A user who may **edit the task** may **add** an item by entering text. A new item starts with `done: false` and no `doneBy` / `doneAt`. **Who that is** follows the existing **FR-TSK-14** rules, as the build already enforces them: the task's **owner** and **assignees** (Members may update status, evidence, notes and time on tasks where they are owner or assignee — FR-TSK-14; `taskCan` / `isMine` in `tasks.ts:102-141`), the project's **PM**, and **Admin** (`isPlanner` in `scope.ts:106-112`, which also covers plan-level edits). **Everyone else**, including **Viewers** (default grid: `tasks` View only) and Members who are not the owner or an assignee, sees the list **read-only** and cannot add. Client portal users are out of v1. This closes Q-153, Q-161 and Q-154. There is no "any project member may add" rule.

- **FR-DLV-03 (Must, Locked, Lean, 2026-11-11 ~9:03 AM SGT)** When an item is **ticked**, the API sets `done: true`, `doneBy` to the current user and `doneAt` to now, and the UI shows the item **checked** with a **line through the text**. Strikethrough is **not** the only done cue (NFR-57): the checkbox is in the checked state, and a non-colour, non-strikethrough cue is required (for example a visible "Done" label and `aria-checked="true"`). **Who may tick** is the same set as who may add (FR-DLV-02 / FR-TSK-14). Everyone else is read-only. Unticking, if Q-156 allows it, is also limited to those people, and clears `done`, `doneBy` and `doneAt`. Edit text, delete and reorder, if Q-156 allows them, follow the same who-may-edit-the-task rule.

- **FR-DLV-04 (Must)** **Migration of existing text (Task and Template).** Today `deliverable` is **plain text** on both **Task** and **Template** activities (Deven, recorded on Q-160). The one-time migration **converts both**:
  - Every **task** whose `deliverable` string is non-empty and which has no `deliverableItems` yet gains **one first item**: `text` = the trimmed string, `done` = false, `order` = 1, `createdBy` = null, `createdAt` = the migration time, `doneBy` / `doneAt` = null.
  - Every **template activity** is converted the same way into `deliverableItems` on that activity, all **unticked**.
  - Empty or null strings leave the list empty. The migration is one-time, safe to re-run (a task or activity that already has items is left as is), has a dry-run that lists the changes, reports how many tasks and template activities it changed, and runs on live only after Jomerson's OK (same pattern as FR-TSK-33). After a record has been migrated, create and update **reject** the old `deliverable` field (422).
  - **Templates used to launch new projects** (generate plan or apply template) **carry the checklist items, unticked**, onto the new tasks (FR-TSK-38).
  - **Q-160** remains open only for values **longer than a new per-item cap**. Rich's suggestion (not decided): do **not** silently truncate a migrated string; keep the full original text on that one item even if it is longer than the new cap, and apply the cap only to items created after the release.

- **FR-DLV-05 (Must)** Suggested API (Deven may rename paths; behaviour stays). All of these need the FR-DLV-02 permission (the caller can already edit the task under FR-TSK-14), and are refused on Completed and archived projects (FR-DLV-06):
  - Task DTOs include `deliverableItems: [{ id, text, done, doneBy: { id, name } \| null, doneAt, order, createdBy: { id, name } \| null, createdAt }]`. Template DTOs include the same list (all `done: false`).
  - `POST /tasks/:id/deliverable-items` body `{ text }` → 201 and the new item (add).
  - `PATCH /tasks/:id/deliverable-items/:itemId` body `{ text? }` (edit text, if permitted) and/or `{ done: true \| false }` (tick / untick).
  - `POST /tasks/:id/deliverable-items/reorder` body `{ itemIds }` (display order only).
  - `DELETE /tasks/:id/deliverable-items/:itemId`.
  Concurrent edits follow the task `version` (EC-18): a stale write is 409. A missing item is 404. A caller who cannot edit the task gets 403.

- **FR-DLV-06 (Must)** **Completed and archived projects are read-only** for deliverable items. Add, edit text, tick, untick, reorder and delete are refused: Completed → 422 `PROJECT_COMPLETED` ("This project is completed, so its plan is read-only. Reopen the project to change tasks."); archived → 409 `PROJECT_ARCHIVED` ("This project is archived. Restore it before making changes."). The list remains visible to anyone who can view the task. **Cancelled** is **Q-155** (Rich suggests treating Cancelled as read-only too, same as Timeline import, not decided).

- **FR-DLV-07 (Should, pending Q-157)** Each add, text edit, tick, untick, reorder and delete is written to the audit log on the task (FR-AUD-01), with suggested actions `deliverable_item_added`, `deliverable_item_updated`, `deliverable_item_ticked`, `deliverable_item_unticked`, `deliverable_items_reordered`, `deliverable_item_deleted`, and the item id plus old/new `text` or `done`. **Q-157** is whether this audit is required. Rich suggests yes. This row is not Locked.

- **FR-DLV-08 (Must)** **UI and accessibility.** The list is on the task panel and on the task form, in the Deliverable place. Add is a text field plus an Add control, shown only to users who may add (FR-DLV-02). Each row is a checkbox and the item text; a done row is checked and struck through, plus the second cue in FR-DLV-03. Checkboxes are disabled for read-only viewers of the list. At **390**, the checkbox, Add, and any row action (edit, delete) have a **44px** tap target. Empty state: "No deliverable items yet", with Add shown only to users who may add. A short summary on the Checklist row (for example "2/5") is left to UIE and is not required to ship the list. Colour is not the only done cue (NFR-57).

- **FR-DLV-09 (Must, pending Q-162)** Ticking items does **not**, by itself, change the task's **status**. Completing the task still follows FR-TSK-04 and FR-TSK-05 (predecessors, For review / approval). **Q-162** asks whether ticking every item should move the task (for example to For review or Completed). Rich suggests no, keep them independent. This is not decided; do not build an automatic status change until Q-162 is closed.

## B4. User stories

- **US-77** As someone who can already edit a task (its owner or assignee, the project's PM, or an Admin, per FR-TSK-14), I want to add deliverable items under that task and tick them off when they are done, so that the remaining work is visible as a checklist (checked, with a line through a completed item).

## B5. Acceptance criteria

- **AC-76.1 (API/UI)** Opening a task that has no items shows "No deliverable items yet" and no Deliverable text box. The owner (or an assignee, the PM, or an Admin) adds "Signed-off test script" and sees one unchecked item; the API stores `text`, `done: false`, `order: 1`, `createdBy` and `createdAt`. (FR-DLV-01, FR-DLV-02, FR-DLV-08)
- **AC-76.2 (UI)** Ticking that item (by a user who may edit the task) shows the checkbox checked, a line through the text, and a second done cue (for example "Done" and `aria-checked="true"`). The API has `done: true`, `doneBy` = the current user, `doneAt` set. (FR-DLV-03, NFR-57)
- **AC-76.3 (migration)** A task whose `deliverable` is "Completed items template" and which has no items yet, after the migration, has one unchecked item with that exact text and `createdBy` null; a task with a null or blank string has no items; a second run changes nothing. A template activity whose `deliverable` is the same string is converted the same way, unticked. (FR-DLV-04)
- **AC-76.4 (API)** After migration, `POST /projects/:id/tasks` or `PATCH /tasks/:id` (and the equivalent template write) with a `deliverable` string returns 422 and does not change items. (FR-TSK-38, FR-DLV-04)
- **AC-76.5 (API)** On a Completed project, POST/PATCH/DELETE of items returns 422 `PROJECT_COMPLETED` and nothing changes; on an archived project, 409 `PROJECT_ARCHIVED`. The GET still returns the list. (FR-DLV-06)
- **AC-76.6 (API/UI)** A **Viewer** can see the items and cannot add or tick them. The add control is hidden and checkboxes are disabled; POST or PATCH `done` returns 403. (FR-DLV-02, FR-DLV-03, Q-154)
- **AC-76.7 (API/UI)** A **Member who is not** the task's owner or an assignee, and is not a planner, can see the items and cannot add or tick them (403). The task's owner (and an assignee) can add and tick. A planner (PM or Admin) can add and tick even if they are not the owner. (FR-DLV-02, FR-DLV-03, FR-TSK-14, Q-153, Q-161)
- **AC-76.8 (UI)** At 390, the checkbox, Add and row actions each have a tap target of at least 44px. (FR-DLV-08, NFR-57)
- **AC-76.9 (API)** Reorder changes only `order`; text and `done` are unchanged. Delete removes one item and closes the gap in `order`. Both are refused with 403 if the caller cannot edit the task. (FR-DLV-05)
- **AC-76.10 (API)** Hitting the suggested cap (50 items, or a text over 200 characters on a new item) returns 422 and saves nothing, if Q-156 adopts those caps. (NFR-56)
- **AC-76.11 (API)** Ticking the last open item leaves the task status as it was (Q-162). (FR-DLV-09)
- **AC-76.12 (audit)** If Q-157 is yes, adding and ticking an item each write an audit entry on the task with the item id. (FR-DLV-07)
- **AC-76.13 (API)** After migration, applying (or generating a plan from) a template whose activity now has two unticked items creates the new task with those two items, both `done: false`. (FR-TSK-38, FR-DLV-04, Q-160)

## B6. Edge cases

- **EC-210** Two users tick or edit the same item at once: the stale write returns 409 (task `version`); the other write is kept; the UI asks the user to retry. (FR-DLV-05, EC-18)
- **EC-211** A migrated item whose text is longer than the new cap remains in full; a newly typed item over the cap is refused (Q-160, FR-DLV-04).
- **EC-212** The last item on a task is deleted: the list is empty and the empty state returns; the task remains. (FR-DLV-05)
- **EC-213** A user who added an item loses access (removed from the project, or no longer owner/assignee/planner): existing items stay; they can no longer add or tick. (FR-DLV-02)
- **EC-214** Cancelled task vs Cancelled project: a Cancelled **task** may still show its items; whether they can be edited follows the project-status rule (FR-DLV-06, Q-155), not the task status, unless Lean says otherwise later.
- **EC-215** Template apply or generate-plan after this CR: the new task receives the template activity's checklist items, all unticked, not a leftover plain-text `deliverable` string. (FR-TSK-38, FR-DLV-04)
- **EC-218** A Member who can view the project but is not owner, assignee or planner on this task sees the list and has no Add control; a crafted POST returns 403. (FR-DLV-02)


---

## 7. Non-functional

- **NFR-55 (Must)** Checklist Excel and Timeline Excel share **one import engine**, reusing `exceljs` and the CR-19 / CR-22 preview-then-commit shape, with **two templates** (Q-152, Q-163). File size and row limits are **5 MB** and **2,000 rows**, matching NFR-52 / NFR-36. Rate limits follow CR-19 NFR-41 (20 previews and 5 commits per user per 15 minutes, 429 `RATE_LIMITED`, one commit at a time or 429 `IMPORT_BUSY`) unless **Q-164** gives Checklist its own buckets. A shared engine makes shared buckets likely; Q-164 stays open.
- **NFR-56 (Should)** Suggested caps, pending **Q-156**: 50 deliverable items per task or template activity; 200 characters of text per new item. A refused write is 422 and saves nothing.
- **NFR-57 (Must)** Deliverable checklist UI is usable at 1440 and at 390. Tap targets for checkbox, Add and row actions are at least **44px** at 390. A done item is not conveyed by strikethrough or colour alone (checked state plus a text or `aria` cue). Contrast of text, struck-through text and controls meets the existing web contrast rules (the baseline-bar colour ban in `m8b.test.tsx` stays; do not reuse a failing grey for text).
- **NFR-58 (Should)** Item add, tick and list payloads come back with the task DTO (checklist, board, task panel, My tasks) without one extra request per task. **Q-165:** web only in v1 unless Lean brings mobile in; the API still enforces the rules so a later mobile client inherits them.

---

## 8. Assumptions

- **A-55** Placeholder accounts in examples and test data use `@xceler8.example` only (for example `pm@xceler8.example`, `owner@xceler8.example`, `member@xceler8.example`).
- **A-56 (Locked by this CR's status rules)** Completed and archived projects are read-only for Checklist import and for deliverable item writes (FR-CLX-03, FR-DLV-06).
- **A-57** Part A is built on top of the CR-22 Timeline import service on `feature/cr22-part-b` (or the branch it merges to), as **one shared engine** with two templates, not as a second parser. (Q-152)
- **A-58** Deliverable items are stored as subdocuments on the task and on the template activity (B2). A separate collection is not required in v1.
- **A-59** "Add Phase and Project" in the request is recorded in Q-150; the locked Excel feature imports into the **open project** and may add phases there under FR-CLX-05.
- **A-60** Testing of this CR follows CR-22 A-47: staging only; live seeded test accounts stay deactivated; after a live deploy, health check plus Jomerson's quick look; no live QA. The deliverable-text migration (tasks and templates) runs on live only after Jomerson's OK (FR-DLV-04).

---

## 9. Amends

Doc 03 **FR-TSK-01** (deliverable/evidence becomes a checklist of items plus the existing evidence list). Doc 03 **FR-TSK-11** / **FR-PRJ-07** (Checklist tab gains Excel actions for planners; Timeline tab keeps its own). Doc 03 **FR-TPL-03** and **FR-PRJ-02** (template `deliverable` plain text is migrated to items; generate-plan and apply-template copy those items onto new tasks, unticked). Doc 03 **FR-TSK-14** is the permission source for who may add and tick deliverable items; it is not otherwise reworded. Doc 12 **FR-PRJ-19** and CR-22 **FR-TL-21 / Q-140** are unchanged unless Q-151 is closed as auto-add (**do not build auto-add yet**). CR-22 **FR-TL-14 to 26** stay the Timeline import; the Timeline **UI** keeps those buttons (Q-152); the Timeline template keeps the dates (Q-163).

---

## 10. Questions (closed calls are decided; open rows are not)

Rich's notes on **open** rows are **suggestions only**. They are not defaults, not Locked, and must not be built as if they were decided. Closed rows are Lean's (2026-11-11 ~9:03 AM SGT) unless noted.

| ID | Question | Status | Who | Note / Rich's suggestion on open rows (not decided) |
|---|---|---|---|---|
| **Q-150** | For 1.2, can the Checklist file **add new phases only** on the open project, or may it also **create a new project**? | **Open.** Lean asked Jomerson. "Add Phase and Project" is ambiguous. Today's Timeline import never creates a project (FR-TL-26). Locked scope of this draft is the open project only (FR-CLX-05). | Jomerson (via Lean) | **Phases on the open project only.** Creating a project needs a client, a manager and a name, which this template does not have. If a multi-project file is wanted later, that is a new column set and a new CR. |
| **Q-151** | Should an **owner in the file who is not on the project be auto-added** to the team? | **Open.** Lean asked Jomerson. Today Timeline import: row error (FR-TL-21, Q-140). The task form can add-and-assign only as a deliberate audited step (FR-PRJ-19). **Lean (2026-11-11 ~9:03 AM SGT): do not build owner auto-add yet.** Keep the row error in the build until Jomerson answers. | Jomerson (via Lean) | **Keep the row error** (FR-TL-21), and do not start the auto-add work. If Jomerson later wants auto-add, do it only for owners named in the file, audit each one as `project_member_added`, and show it in the preview before confirm. |
| **Q-152** | Does the Checklist upload **replace** the Timeline import, or do **both stay**? | **Closed (Lean, 2026-11-11 ~9:03 AM SGT):** **both imports stay**, with **one shared import engine** and **two templates**. (FR-CLX-02, FR-CLX-04) | Lean | — |
| **Q-153** | Who may **tick** (complete) a deliverable item? | **Closed (Lean, 2026-11-11 ~9:03 AM SGT):** anyone who can already **edit the task** under **FR-TSK-14** (owner, assignees, PM, Admin, as those rules stand today) can **add and tick**; everyone else is read-only. (FR-DLV-02, FR-DLV-03) | Lean | — |
| **Q-154** | What may a **Viewer** do? | **Closed (Lean, 2026-11-11 ~9:03 AM SGT)** by the same FR-TSK-14 rule as Q-153 / Q-161: **Viewers are read-only**. They may see the list and may not add or tick. | Lean | — |
| **Q-155** | On **Completed**, **Cancelled**, or **archived** projects, may items be added or ticked, and may a Checklist Excel import run? | **Open** for Cancelled (and for any loosening of Completed / archived). This draft already makes **Completed and archived** read-only (FR-CLX-03, FR-DLV-06, A-56). Timeline import already refuses Cancelled (Q-141). `assertPlanOpen` today does not block Cancelled. | Lean | **Refuse writes and import on Cancelled too**, same as Timeline import, so a cancelled project cannot be quietly edited through the new list or the file. |
| **Q-156** | **Limits:** max items per task, max text length per new item (the single field is 500 characters today), and whether a completed item may be edited, unticked or deleted? | **Open.** No sub-list exists today, so no cap exists. Who may do those actions, if they are allowed, is the FR-TSK-14 editor set (Q-153 / Q-161). | Lean | **50 items**, **200 characters** on new items; allow **untick**, **edit text** and **delete** for the people who may edit the task, including on a done item, so a mistaken tick can be undone. Do not truncate migrated text (see Q-160). |
| **Q-157** | Is each add / tick / untick / delete of a deliverable item **audited**? | **Open.** Task field edits and Timeline imports are audited (FR-AUD-01, FR-TL-19). | Lean | **Yes**, on the task, with the actions in FR-DLV-07. Ticking is a completion record (`doneBy`, `doneAt`) and should be traceable. |
| **Q-158** | How do deliverable items **round-trip** in the Checklist file's Deliverables column? | **Narrowed (Lean, 2026-11-11 ~9:03 AM SGT).** Items **do** round-trip via the **Checklist** file's **Deliverables** column (Q-163). **Still open:** the exact **cell format**; **how done state is marked**; whether a re-upload **replaces** or **appends** (and whether a blank cell clears items); whether `doneBy` / `doneAt` are left blank on import; the visible **position** and header wording of the column; whether a Timeline file missing the column (or a Checklist file sent to the Timeline tab) is accepted; whether the Timeline template also gains the column. | Lean / UIE | **Proposal (not decided):** one item per line in the cell; done items marked with a leading `[x] `; open items a plain line or `[ ] ` (FR-CLX-04). Rich also suggests: Deliverables only on the Checklist template, header "Deliverables", after Baseline finish; re-upload **replaces** the item list but only after the preview lists the resulting items; a blank cell is listed as "Deliverables will be cleared"; `doneBy` / `doneAt` are left blank on imported ticks. None of that is decided. Do not build a silent wipe (EC-216). |
| **Q-159** | When a Checklist file names an unknown phase, does it reuse **FR-TL-20 / FR-PRJ-22/23** (PM may auto-add phases **only in Planning**; Admin any time; otherwise a row error), or may PMs add phases from this file in Active / On Hold too? | **Open.** Same `Project.phases` / `phaseId` model. A looser Checklist rule would fork the phase lock. This draft reuses FR-TL-20 until answered (FR-CLX-05). | Lean | **Reuse FR-TL-20.** Do not give Checklist import a second phase-lock. |
| **Q-160** | Migration of existing `deliverable` text, including **over-cap** values? | **Narrowed.** **Deven's note (recorded 2026-11-11 ~9:03 AM SGT):** `deliverable` is **plain text on both Task and Template**; **migration converts both**; **templates used to launch new projects carry the checklist items (unticked)**. That behaviour is in FR-DLV-04 and FR-TSK-38. **Still open:** values **longer than a new per-item cap**. | Lean / Deven | **Do not truncate** migrated (or template-copied) text; apply the new cap only to items typed after the release. |
| **Q-161** | Who may **add / edit / delete** deliverable items, as distinct from ticking? | **Closed (Lean, 2026-11-11 ~9:03 AM SGT)** with Q-153: anyone who can already **edit the task** under FR-TSK-14 can **add and tick**; everyone else is read-only. Edit text, delete and reorder, if Q-156 allows them, use the same who-may-edit-the-task set. There is no "any member may add" rule. | Lean | — |
| **Q-162** | Does ticking **every** item on a task change the task **status** (for example to For review or Completed), or are the list and the status independent? | **Open.** Automatic completion would interact with predecessors and approval (FR-TSK-04, FR-TSK-05). This draft keeps them independent until answered (FR-DLV-09). | Jomerson / Lean | **Keep them independent.** The checklist is evidence of leftover work, not a substitute for the status workflow. |
| **Q-163** | What **columns** does the Checklist template have? | **Closed (Lean, 2026-11-11 ~9:03 AM SGT):** the **Checklist template** is the **CR-22 columns plus a Deliverables column**; the **Timeline template keeps the dates**. This draft does **not** drop Start, Finish or Baseline columns from the Checklist template (that was not stated). Narrow leftovers on column position, header wording, and whether Timeline also gets Deliverables sit under Q-158. (FR-CLX-04) | Lean | — |
| **Q-164** | Do Checklist preview/commit calls **share** the CR-19 / CR-22 rate-limit buckets, or get their own? | **Open.** Lean did not close this. A **shared engine** (Q-152) makes **shared buckets** likely (a Timeline import would use up Checklist attempts, and the other way around), but that is not decided. | Lean | **Share the existing buckets**, since there is one engine. Split them only if the two templates prove to have different costs. |
| **Q-165** | **Web only** in v1 (as Timeline, Q-143), or in mobile scope? | **Open.** Mobile is on hold (doc 11). | Lean | **Web only in v1**, with the rules enforced in the API so mobile inherits them later (same as Q-128 / Q-143). At 390 the web import stays "open on a larger screen" (FR-CLX-08). |

---

## 11. Status and next steps

- **v0.1.1 draft** (2026-11-11 ~9:05 AM SGT). **Not locked for build.** Locked scope is Lean's, including the 9:03 AM SGT calls: both imports stay, one shared engine, two templates; Checklist template = CR-22 columns plus Deliverables; Timeline template keeps the dates; add and tick follow FR-TSK-14 (owner, assignees, PM, Admin); Viewers and everyone else are read-only; do not build owner auto-add yet; migration converts Task and Template plain text, and launched projects carry unticked items. **Open:** Q-150, Q-151, Q-155, Q-156, Q-157, Q-158 (narrowed), Q-159, Q-160 (narrowed), Q-162, Q-164, Q-165.
- **For Jomerson:** Q-150 and Q-151 (via Lean). Q-162 if he wants to set whether ticking every item changes task status.
- **For Lean:** the remaining open questions (Q-155 to Q-160, Q-162, Q-164, Q-165), especially the Q-158 cell format and replace-vs-append, and any call on Rich's suggestions.
- **For UIE:** mockup of the Checklist toolbar Excel actions, the import preview at 1440 (including the Deliverables column) and the 390 "larger screen" state, and the deliverable list (task panel and form) including the second done cue and 44px targets. The two templates need to be visually distinct. No UI reference in this version.
- **For Deven:** one shared import engine, two templates; do not start a second parser. **Do not build owner auto-add** (Q-151 still open). Permissions for add and tick follow FR-TSK-14 as in FR-DLV-02 (no "any member may add"). Migration converts both Task and Template `deliverable` text; generate-plan / apply-template copy items unticked. Wait for Q-158 before coding Deliverables-column parse/replace. Build on `feature/cr22-part-b` (or its merge target), after the Timeline import.
- **For Queen:** cases can cover the closed permission and template rules now; wait for Q-151, Q-155 and Q-158 where behaviour still forks, and for UIE's mockup for the UI pass.
- Once approved: FR-PRJ-42, FR-TSK-38, FR-CLX-01 to 08 and FR-DLV-01 to 09 go into doc 03 (new Checklist Excel and Deliverable items notes); US-75 to 77 into doc 04; AC-75.x and AC-76.x into doc 05; EC-206 to 218 into doc 08; NFR-55 to 58 into doc 07; A-55 to 60 and Q-150 to Q-165 into doc 09.
