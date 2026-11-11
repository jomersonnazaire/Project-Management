# CR-23: Checklist Excel and deliverable checklists, UI spec (mockup v0.9.21)

Build spec for Deven. It follows **Rich's CR-23 v0.1.6** (`docs/requirements/17_CR-23_CHECKLIST_EXCEL_AND_DELIVERABLE_CHECKLISTS.md`, branch `docs/cr-23-checklist`, `542a387`) and Jomerson's and Lean's calls of Nov 11. **Q-150, Q-151 and Q-166 are closed** (§9). Nothing in this spec is open.

- **Mockup:** `docs/design/mockup/index-v0.9.21.html`
  - `#cr23-checklist`: the Checklist tab with the Excel menu, the read-only view, the empty state and the task panel
  - `#cr23-import`: the import modal
  - `#cr23-deliverables`: the task panel Deliverables list in every state
  - `#timeline`: the Timeline toolbar without Excel controls. `#timeline-import` is kept for reference only and is marked "Replaced".
  - Every other v0.9.20 section is unchanged.
- **Screenshots:** `docs/design/review/cr23-mock-*.png` (1440 and 390 wide; see §10).
- **Example data only.** "Acme Test Co Rollout", Test PM, Test BA, Test Admin, Dev One, Dev Two and QA One are fake. Every email is a placeholder (`pm@`, `ba@`, `admin@`, `dev1@`, `dev2@`, `dev3@`, `qa@`, `viewer@`, `contractor@`, `dev9@` `xceler8.example`). The mockup's "today" is **Wed, Nov 11, 2026**.
- **Theme:** Sneat tokens from `THEME_TOKENS.md` (AA-darkened). New mockup CSS is scoped under `.ck23`. Class names are for the mockup only, so use the app's components. The import modal reuses the CR-22 `ti-*` styles unchanged.
- **v1 is web only** (Q-165).

## 1. What changes
1. **One Excel import, on the Checklist tab** (Q-152 and Q-163, Jomerson). It replaces the CR-22 Timeline import. Upload and download use one file with the CR-22 timeline columns plus a **Deliverables** column.
2. **The Timeline has no Excel controls.** The Excel menu and the empty-state import buttons are gone. The toolbar says: "The timeline shows what the Checklist sets. To change many tasks at once, use Excel on the Checklist." The link goes to the Checklist tab. Read-only users see the same sentence after their view-only line.
3. **A task's Deliverable becomes a checklist** (FR-DLV-01) on the task panel and the task form.

## 2. User flow
**PM or Admin (Excel):**
1. Open Project › **Checklist** and click **Excel ▾**.
2. Choose one of:
   - **Download template**, to start from scratch
   - **Download checklist (.xlsx)**, to edit the current plan
   - **Import from Excel…**
3. In the import modal, go through Choose file › Check rows (preview) › **Import N rows** › Done › **Back to checklist**.

**Task owner, PM or Admin (deliverables):**
1. Click an activity on the Checklist (or open the task anywhere) to open the task panel.
2. In **Deliverables**, type an item and press Enter. Tick items as they're done, and use Edit or Remove as needed.

**Everyone else** (assignees, Members, Viewers) sees the same list read-only.

## 3. Checklist tab (`#cr23-checklist`)
### 3.1 Toolbar
- **Left:** "Started from {template}" (unchanged).
- **Right (PM and Admin only):**
  - The phase-lock hint (unchanged). An Admin sees "Admins can edit phases at any status."
  - An outline **Excel ▾** button (`bx-spreadsheet`) that opens a menu. It's the same component as the CR-22 Timeline menu (`aria-haspopup="menu"`, Esc closes and returns focus, and a click outside closes it).
- **Menu items, in this order:**
  1. **Import from Excel…**, with the sub-line "Add or update tasks, dates, links, owners and deliverables"
  2. **Download checklist (.xlsx)**, with the sub-line "This project's plan in the same file, ready to edit and import"
  3. A divider
  4. **Download template**, with the sub-line "Blank file with instructions; every row imports as new"
- **Download toasts:**
  - "Downloaded acme-test-co-rollout-checklist-2026-11-11.xlsx (8 tasks, cancelled included)."
  - "Template downloaded: OpsTrack-checklist-template.xlsx"
- **Members and Viewers:** no Excel button. In its place they see a view-only line: "View only. The project PM or an Admin changes the plan and imports from Excel. If you own a task, you can tick its deliverables in the task panel."
- **Completed, Cancelled or archived projects:** the downloads still work. **Import from Excel…** is disabled, with a tooltip using the status copy in §5.1 (FR-CLX-03). This isn't drawn in the mockup.

### 3.2 Rows
- These are unchanged, except for one addition: when a task has deliverable items, a **chip** follows the activity name (`bg-label-secondary`, `bx-list-check`, for example "2/5"). The chip turns `bg-label-success` when every item is done.
- The chip is a button that opens the task panel. Its aria-label reads "Deliverables: 2 of 5 done". Tasks with no items show no chip.

### 3.3 States
- **Loading:** two skeleton phase cards.
- **Empty** (PM, project in Planning):
  - Heading: "No phases or activities yet"
  - Text: "Add a phase, apply a template, or import a checklist from Excel. Every row in the file becomes a task with its phase, dates, owner and deliverables."
  - Buttons: **+ Add phase** (primary), then **Apply template** and **Import from Excel**.
  - A link: "Download the template".
  - A Member or Viewer sees "No activities yet. The project PM sets up the checklist." with no buttons.
- **Phone (390):** the Excel menu stays. **Import from Excel…** shows a toast instead of the modal: "Open this on a larger screen to make changes." The two downloads still work on a phone (FR-CLX-08: UIE confirms that downloads stay).

## 4. Import modal (`#cr23-import`, `modal-xl`, max width 1180 px)
This is the CR-22 import (`CR22_PROJECT_TIMELINE_UI.md` §5), moved to the Checklist. Anything not listed here is unchanged from CR-22, including:
- the "changed since export" flags and **Confirm overwrite**
- "Preview out of date" (PREVIEW_STALE)
- rate limits (one engine, one set of limits)
- the hidden Task ID and `_meta`

The modal title is **Import checklist from Excel**, and Cancel and Done return to the Checklist.

### 4.1 Choose file
- **Info alert:** "**Import adds and updates tasks. It never deletes tasks.** Rows downloaded from OpsTrack update their own task (matched by a hidden Task ID). Rows you add become new tasks at the end of the list. A blank cell clears that field. **The Deliverables cell replaces the task's list:** lines that aren't in the cell are removed, and only lines starting with [x] stay ticked."
- **Drop zone:** "Drop your checklist file here or", then **Choose file**, then ".xlsx only · up to 5 MB · 2,000 rows".
- **Footer note:** "To edit this project's plan, use Excel › Download checklist (.xlsx) on the Checklist, change the file, then import it here. To start from scratch, download the template; every row in it imports as a new task. Dates as a date cell or YYYY-MM-DD. Deliverables: one item per line in the cell (Alt+Enter for a new line); put [x] in front of a done item."
- Import is allowed only in Planning, Active and On Hold (FR-CLX-03).

### 4.2 File errors
Each one is a danger alert above the drop zone, and nothing is imported. The copy follows CR-22 and Q24, with "Checklist" wording:
- **Wrong type:** "This file isn't an .xlsx workbook. Save it as Excel Workbook (.xlsx) and try again. Nothing was imported."
- **Older Timeline files (Lean, Nov 11):** a workbook whose sheet is named **Timeline** (downloaded before CR-23) still imports. It has no Deliverables column, so deliverable items are left unchanged (a missing column is not a blank cell). The preview shows the grey note "This is an older timeline file, so deliverables won't change."
- **No sheet:** "This file has no Checklist sheet. Use the OpsTrack template or a downloaded checklist, and keep the sheet name Checklist (an older Timeline sheet also works). Nothing was imported."
- **Columns:** "Some columns are missing or out of order: Phase, Deliverables. Keep row 1 of the template as it is, then try again. Nothing was imported."
- **Other project:** "This file was exported from a different project. Export the checklist from Acme Test Co Rollout, or start from the blank template. Nothing was imported." The file only ever changes the project it's uploaded into; it never creates a project (Q-150, closed).
- **Over 2,000 rows:** "This file has {n} rows. You can import up to 2,000 at a time. Split it into smaller files and import them one by one. Nothing was imported."
- **Empty, unreadable and over 5 MB:** the CR-22 Q24 copy, with "Checklist sheet" in place of "Timeline sheet".

### 4.3 Check rows (preview)
- **File chip:** "acme-test-co-rollout-checklist-2026-11-10.xlsx", then "Downloaded from this project (Acme Test Co Rollout) Nov 10, 2026, 4:05 PM · 15 rows", then **Choose another file**.
- **Filter chips:** All, Errors (shown only when there are errors), **Removes or clears** (new), New and Update, followed by "{n} unchanged".
- **Alerts, in this order:**
  1. **Errors** (danger), as in CR-22: "Fix {n} errors in the file and upload again. Any row with an error stops the whole import, because rows depend on each other. Nothing has been saved. Show rows with errors"
  2. **Changed since export** (warning), as in CR-22, including Deliverables changes (Lean).
  3. **Deliverables lost** (warning, new; shown when any row removes, unticks or clears items): "**{n} tasks will lose deliverable items or ticks.** The Deliverables cell replaces each task's list, and a blank cell clears it. Check the crossed-out items before you import. Show these rows". Count deliverable losses only; an owner that's cleared counts in the **Removes or clears** chip but not here.
  4. **Team additions** (info, `bx-user-plus`, new, Q-151): "**2 people will be added to the project team:** contractor@xceler8.example, dev3@xceler8.example. They join as project members and keep their app role. Cancel adds no one." Emails in file order, lower case, each once. Don't say "as Members": the app role doesn't change (FR-PRJ-19).
  5. **New phase** (purple info): "New phase {name} will be added at the end of the phase list." The FR-TL-20 phase lock applies (Q-159). The file never creates a project (Q-150).
  6. **Baseline ignored** (secondary): "**Baseline columns are ignored on import**, so they aren't shown here. Click **Save baseline** on the Timeline after importing to update the baseline."
  7. **New numbering** (plain line), as in CR-22: "New tasks go to the end of the list… (file 30 → #9, file 31 → #10)…"
- **Table:**
  - **Columns:** Row, Result, Task number, Task name, Phase, Milestone, Start, Finish, Depends on, Owner, **Deliverables**.
  - The baseline columns are left out to keep the table inside 1130 px. Measured scroll width is 1078 / 1078 with no sideways scroll; keep it that way.
  - Headers may wrap onto two lines, and owner emails break after "@".
  - The sticky header, sticky Row column, scroll box and error and changed-cell styles are the same as CR-22.
- **Deliverables cell in the preview** (one line per item, in file order):

| Line | Shown as |
|---|---|
| Done, unchanged | `[x] text` in muted grey (no strikethrough, so it doesn't read as an old value) |
| Open, unchanged | `[ ] text` |
| Added | `+ [ ] text` in green semibold |
| Ticked by the file | `[x] text` in primary semibold, with the old `[ ] text` struck through underneath |
| **Unticked by the file** | `[ ] text` in danger semibold, with the old `[x] text` struck through underneath |
| **Removed** (not in the cell) | the old line struck through, in danger |
| **Blank cell** | **(blank)** in danger, with every old item struck through underneath |
| Error | the line in danger, with a cell error box |

- **Result column lines** (Q-158):
  - Updates: "Changes: Deliverables (1 item added)" or "Changes: Deliverables (1 ticked)".
  - Losses, in danger bold: "**Deliverables: 2 items removed, 1 unticked**".
  - A blank cell: "**Clears: Deliverables (1 item)**".
  - A cell that loses items gets the `#fff6f4` tint.
- **Footnote:** "Crossed-out values are what OpsTrack has now. (blank) means the cell is empty, so that field will be cleared. In Deliverables, + green lines are added and a crossed-out line on its own is removed."
- **Footer:** the help line, then Cancel and **Import N rows**. With no errors, the help line reads "Owners of new or changed tasks get one notification each."

### 4.4 Row errors and owner notes
Errors use the CR-22 §5.2 copy, plus two new ones:

| Case | Message |
|---|---|
| Item too long (new, NFR-56) | Deliverables: line {n} is longer than 200 characters (it has {count}). |
| Too many items (new, NFR-56) | Deliverables: this task would have {n} items. The most is 50. |

**Owners (Q-151, closed by Jomerson; Lean's Viewer rule).** For this import, these replace the FR-TL-21 "isn't a member" and "isn't an active internal user" row errors. None of them blocks the import.

| Owner email in the file | Result | Row note (amber, `bx-info-circle`) | Owner cell |
|---|---|---|---|
| Matches an active internal user who is on the team (any case) | as today | none | the email |
| Matches an active internal user who isn't on the team | owner set; the person is added to the team as a normal project member, keeping their app role (FR-PRJ-19); listed in the Team additions notice | none | the email |
| Same email on several rows | added once, listed once | none | the email |
| No user with that email, a deactivated user, or a client portal contact | row imports **without an owner** | "Email {email} doesn't exist." | the email in muted text, then **No owner** (amber, 12 px, semibold); a replaced owner is struck through under it |
| A Viewer | row imports **without an owner**; not added to the team | "{email} can't own tasks." | same as above |

- Matching ignores upper and lower case ("Dev3@Xceler8.example" matches dev3@).
- On an Update row that had an owner, the result also reads "**Clears: Owner**" (danger) and the row counts in **Removes or clears**.
- **Cancel adds no one.** People are added only when the import is saved, in the same transaction.
- **Audit:** each team addition is audited and sends the existing team-add and assignment notifications.
- Done screen: "{n} people were added to the project team." after the Deliverables line.

The mockup preview has 17 rows: Unchanged 1, Update 6, New 6 and Error 4 (a missing name, a bad Finish date, a missing dependency and an item over 200 characters). The 6 updates are: 1 adds an item, 1 changes Finish and Owner, 1 has a blank Deliverables cell, 1 removes 2 items and unticks 1, 1 names a Viewer as owner, and 1 ticks an item. The new rows include an unknown email (dev9@, no owner), contractor@ twice (added once) and Dev3@ in mixed case. The Done screen shows the totals after the errors are fixed.

### 4.5 Importing and Done
- **Importing:** a spinner, with "Importing…" and "Don't close this window."
- **Done:** a success circle and **Checklist imported**, followed by:
  - "6 tasks added at the end (#9 to #14) and 6 updated. 1 row was unchanged."
  - "Deliverables: 7 items added, 3 removed, 1 ticked and 1 unticked. No tasks were deleted. Baselines didn't change."
  - "2 people were added to the project team."
  - "The checklist, timeline, critical path and forecast are up to date. Owners of new or changed tasks get one notification each."
  - The button **Back to checklist**.
- **Imported ticks:** v0.1.2 leaves `doneBy` and `doneAt` unset. The list then shows "Done · from import, Nov 11" under the item instead of a name. This isn't drawn in the mockup (§9a).

### 4.6 Phone (390)
The modal isn't shown. A card reads **Import checklist from Excel** and "Open this on a larger screen to make changes." (FR-CLX-08).

## 5. Deliverables checklist (task panel and task form, `#cr23-deliverables`)
### 5.1 Who can change it (Q-153, Q-161, Q-166 closed)
- **Editors:** the **task owner**, the project's **PM** and **Admins** can add, tick, untick, edit and remove items (Admins: Q-166, closed by Lean).
- **Read-only:** everyone else, including **assignees**, Members and Viewers. They see the list with ticked items still struck through, disabled checkboxes, no Edit or Remove, no add box, and the line: "View only. The task owner, the project PM and Admins change deliverables."
- **Locked projects:** on Completed, Cancelled and archived projects, the list is read-only for everyone (FR-DLV-06, Q-155), and the view-only line becomes the status message:
  - Completed: "This project is completed, so its plan is read-only. Reopen the project to change tasks."
  - Cancelled: "This project is cancelled, so its plan is read-only."
  - Archived: "This project is archived. Restore it before making changes."

### 5.2 Anatomy
- **Header:** **Deliverables** (h6), the count "2 of 5 done" (`aria-live="polite"`), and a 72 px progress bar on the right (`role="progressbar"`). The bar turns success green when everything is done.
- **List:** a bordered list in added order. Each row has:
  - a checkbox (18 px, with a 36 px hit box)
  - the item text as the checkbox's `<label>`, so clicking the text toggles the box
  - Edit (pencil) and Remove (trash) icon buttons on the right
- **A done item shows three cues** (NFR-57):
  1. the checked box
  2. the text struck through in muted `#5d6878`
  3. a text line: "Done by QA One · Nov 9"
- **Add row:** a `+` icon, an input with the placeholder "Add a deliverable and press Enter", and an outline **Add** button. The input has a hidden label "Add a deliverable".
- **Empty:** a dashed box reading "No deliverable items yet. Add what this task has to hand over, like a signed form or a test report." Read-only users see "No deliverable items yet." with no add row.
- **Long lists:** a list of more than 12 items scrolls inside a 420 px box, so the add row stays in view.

### 5.3 Interactions
- **Add:** Enter or **Add** appends the item, unticked. The input clears and keeps focus, and the new row flashes the primary tint briefly. Enter on a blank or spaces-only input does nothing.
- **Tick or untick:** saves right away (optimistic) and updates the count and the Checklist chip. Ticking sets "Done by {you} · Today". If the save fails, the box goes back and a toast reads "Couldn't save. Check your connection and try again." A 409 (another change) reloads the list with the toast "Someone else changed this list. Check it and try again." (EC-210)
- **Edit:** the pencil swaps the row for an input with **Save** and **Cancel**, plus the hint "Enter saves · Esc cancels". Focus goes into the input with the text selected. Done items can be edited (Q-156).
- **Remove:** removes at once and shows an inline dark bar: "Removed “Defect log”. Undo". It lasts about 6 seconds, until the next action, or until the panel closes. There's no confirm dialog.
- **Order:** items stay in place when ticked; they don't move to the bottom. Reordering is drag (with Alt+↑/↓) on desktop, and the ↑ / ↓ buttons on touch, the same as Checklist rows (FR-DLV-05).
- **Status:** ticking every item **doesn't change the task status** (Q-162). There's no prompt or auto-move.

### 5.4 Limits (NFR-56, Q-156)
- **200 characters per new item:**
  - At 180 characters or more, a counter appears under the input on the right: "197/200".
  - Over 200, the counter turns danger, the input gets `is-invalid`, and Enter shows the inline error "A deliverable can be up to 200 characters (this one has 227)." (`role="alert"`, tied to the input with `aria-describedby`). Nothing is saved.
  - Edits use the same rule.
- **50 items per task:**
  - From 40 items, the header count adds "· 45/50 items". At 50 it turns danger. The mockup draws the 50 state.
  - At 50 the input is disabled, with the placeholder "50 items is the most for one task", and **Add** is disabled.
  - A grey note under the input reads "This task has 50 deliverable items, the most allowed. Remove one to add another."
- **Migrated text isn't cut** (Q-160). An old Deliverable longer than 200 characters becomes one full item. It can still be ticked, and editing it applies the 200-character rule.

### 5.5 Audit (Q-157)
Every add, text edit, tick, untick, reorder and remove in the task panel writes one entry to the task's audit log (FR-DLV-07). **An import writes one entry per task that lists every item change on that task** (Lean's call), not one entry per item. They show in the task's **Activity log** in the existing format, for example:
- "QA One ticked deliverable “UAT script”"
- "Test PM removed deliverable “Defect log”"
- "Test PM imported the checklist: added “Cutover runbook v2”; removed “Rollback plan”, “Contact sheet”; unticked “Cutover runbook”"

Each team addition from an import is audited too (Q-151).

The panel doesn't show a separate history.

### 5.6 Migration and templates
- **Old Deliverable text (Deven, #51 `8e0eeed`; Lean):** the migration keeps the old single-text `deliverable`. Until the task has items, that text shows as a **read-only first item** (`legacy: true`, id `legacy`):
  - an unticked, **disabled** checkbox on a light grey row (`#f5f5f9`), the text in the normal colour, an "Old text" pill (`bx-lock-alt`), and under it a muted caption tied to the checkbox with `aria-describedby`:
    - editors: "From the old Deliverable field. It becomes a normal item when you add the first deliverable."
    - read-only users: "From the old Deliverable field."
  - no Edit, Remove or reorder controls, for everyone. The label uses `cursor: default`.
  - it counts as not done: "0 of 1 done", and the Checklist chip reads 0/1.
  - the add row stays for editors. **The first add turns the old text into a normal item** (unticked, editable), then appends the new one.
  - Templates show the same pill and caption on an activity's old text, with no Remove.
  - Demo: "Old Deliverable text (read-only)" on `#cr23-deliverables`; screenshots `cr23-mock-deliverables-legacy-1440.png` and `-390.png`.
- Templates hold deliverable items too, so the template editor uses the same list, with no ticks. A project made from a template, or a template applied to a project, starts with **every item unticked** (FR-TSK-38).

### 5.7 Keyboard and screen readers
- **Tab order:** checkbox, Edit, Remove, next row, and so on, then the add input and Add.
- The checkboxes are native, so they announce "UAT script, checkbox, checked". Done rows also have the "Done by…" text.
- Icon buttons have names such as "Edit UAT script" and "Remove UAT script".
- The count and the length counter are polite live regions, and errors are `role="alert"`.
- After a remove, focus moves to **Undo**. After Undo, it moves to the restored row's checkbox.
- Edit and Remove show on hover and on `:focus-within` on desktop, and they're always visible on touch (`pointer: coarse`) and at 390.

## 6. Responsive
| | 1440 | 390 |
|---|---|---|
| Checklist | Phase tables as today, with the Excel menu on the right of the toolbar | Stacked row cards (`table-stack-md`). The Excel button wraps to its own line on the right. Import shows the toast; downloads still work |
| Import | `modal-xl`, table fits (no sideways scroll) | "Open this on a larger screen to make changes." card |
| Task panel | 480 px offcanvas | full width. The checkbox, Edit, Remove, Add and the add input are each at least **44 × 44 px**, and rows are at least 44 px tall |
| Timeline | toolbar note instead of the Excel menu | the same note wraps under the toolbar |

## 7. Excel file (one format; Q-152, Q-163, Q-158)
**Sheets:** `Instructions`, `Checklist` (active), and the hidden `_meta`.

**Checklist row 1, in this order:**

| Col | Header | Notes |
|---|---|---|
| A | Task number | as CR-22 |
| B | Task name | required |
| C | Phase | matched ignoring case and spaces; a new name follows FR-TL-20 (Q-159) |
| D | Milestone | Y/N |
| E | Start | date cell or YYYY-MM-DD |
| F | Finish | the same |
| G | Depends on | task numbers in this file, e.g. "3, 5" |
| H | Owner | email, any case. Not on the team: added automatically if active and internal; unknown, deactivated, client contact or Viewer: imported without an owner, with a row note (Q-151, §4.4) |
| I | Baseline start | export only, ignored on import |
| J | Baseline finish | export only, ignored on import |
| K | **Deliverables** | **one item per line** (Alt+Enter); **`[x] `** in front of done items; a re-upload **replaces** the list; a blank cell **clears** it; 200 characters per line; 50 lines at most |
| L | Task ID | hidden |

- The position and header of Deliverables (K, after Baseline finish) follow Rich's suggestion.
- **Formatting:** as CR-22 (`#5355E0` header, panes frozen at C2, autofilter, date validation). Column K is 48 characters wide with wrap text on, and its header comment explains the `[x]` format.
- **Instructions sheet:** adds "Deliverables: one item per line. Put [x] and a space in front of a done item. Leave the cell blank to remove all items."
- **Blank template:** headers and Instructions, with an empty project id. Every row imports as new.

## 8. Accessibility
- The new chips, menu items, icon buttons and inputs follow §5.7.
- Colour is never the only signal: removed lines are struck through as well as red, the Result column spells out "2 items removed, 1 unticked", and done items carry three cues.
- Contrast: muted text is `#5d6878`. Don't use `#8592a3` for text (`m8b.test.tsx`).

## 9. Decisions (Nov 11)
- **Q-150 (Jomerson):** the file adds phases to the project it's uploaded into only, and never creates a project. The FR-TL-20 phase lock stays, and another project's file is still refused.
- **Q-151 (Jomerson; Lean for Viewers):** an owner who isn't on the team is added automatically when their email matches an active internal user (case-insensitive), as a normal project member keeping their app role. Unknown, deactivated and client-contact emails, and Viewers, import without an owner with a row note. See §4.4.
- **Q-166 (Lean):** Admins can add, tick, edit and remove items, like the task owner and the PM.
- **Audit (Lean):** an import writes one audit entry per task listing every item change.

**Closed by Lean (Nov 11):** the **Changed since export** confirm covers Deliverables too (item b). On Completed, Cancelled and archived projects Import is **disabled** (tooltip "This project is {status}, so the checklist can't be imported.") and both downloads still work. UIE's calls stand: imported ticks show "Done · from import, {date}", duplicate lines become separate items, downloads work on phone, reorder works like Checklist rows, and a migrated item over 200 characters can be ticked, with the limit applying only on edit.

**Carried from CR-22 QA (Queen):** preview body cells wrap long unbroken text (`overflow-wrap:anywhere`, so a 201-character name never makes the table scroll sideways), and the Cancelled badge is hidden at 390 in the Gantt left column.

**Earlier items** (kept for history):
- **a. Imported ticks:** `doneBy` and `doneAt` are unset in v0.1.2. The mockup shows "Done · from import, {date}".
- **b. Untick by file:** "[x] removed from a line" unticks the item. That follows from "the `[x]` marks set the ticks", but it means an export taken before someone ticked an item will untick it. The **Changed since export** confirm from CR-22 should also cover Deliverables.
- **c. Duplicate lines in one cell:** the mockup assumes both are kept as separate items. Alternatively, they could be a row error.

## 10. Screenshots (`docs/design/review/`)
| File | Shows |
|---|---|
| cr23-mock-checklist-pm-menu-1440.png | Checklist as PM with the Excel menu open and the 2/5 chips |
| cr23-mock-checklist-member-1440.png | Member view: no Excel menu, plus the view-only line |
| cr23-mock-checklist-empty-1440.png | Empty project (Planning) with Import from Excel |
| cr23-mock-checklist-taskpanel-pm-1440.png | Task panel offcanvas, editable as PM |
| cr23-mock-checklist-taskpanel-readonly-1440.png | Task panel as Dev One on QA One's task, read-only |
| cr23-mock-timeline-no-excel-1440.png / -390.png | Timeline toolbar with the "shows what the Checklist sets" note and no Excel menu |
| cr23-mock-import-upload-1440.png | Step 1, Choose file |
| cr23-mock-import-preview-errors-1440.png | Preview with errors, new rows, updates and Deliverables changes |
| cr23-mock-import-preview-errorrows-1440.png | The Errors filter |
| cr23-mock-import-preview-removed-items-1440.png | The Removes or clears filter: removed, unticked and blank Deliverables |
| cr23-mock-import-preview-clean-1440.png | Preview with no errors, Import 8 rows enabled |
| cr23-mock-import-otherproject-1440.png | Other project's file (refused) |
| cr23-mock-import-autoadd-1440.png | Preview with the Team additions notice (Q-151) |
| cr23-mock-import-owner-rows-1440.png | Owner notes: Viewer row with No owner and Clears: Owner |
| cr23-mock-deliverables-legacy-1440.png / -390.png | Old Deliverable text as a read-only first item |
| cr23-mock-import-done-1440.png | Done |
| cr23-mock-import-phone-390.png | "Open this on a larger screen" |
| cr23-mock-deliverables-owner-1440.png / -390.png | 2 of 5 done, as the task owner |
| cr23-mock-deliverables-edit-1440.png | Editing an item inline |
| cr23-mock-deliverables-near200-1440.png | The 197/200 counter |
| cr23-mock-deliverables-over200-1440.png | Over 200: inline error |
| cr23-mock-deliverables-at50-1440.png | 50 items: add disabled, plus the message |
| cr23-mock-deliverables-undo-1440.png | Removed, with Undo |
| cr23-mock-deliverables-empty-1440.png / -390.png | Empty state |
| cr23-mock-deliverables-readonly-1440.png / -390.png | Assignee, Member or Viewer read-only |
| cr23-mock-deliverables-locked-completed-1440.png / -390.png | Completed project, locked |
| cr23-mock-checklist-pm-390.png, -member-390.png, -taskpanel-390.png | Phone Checklist and task panel |
