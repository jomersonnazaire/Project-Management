# CR-22 Part B: Project timeline (Gantt) and Excel import, UI spec (mockup v0.9.20)

Build spec for Deven. Jomerson reviews it before slice 1. It follows **CR-22 v0.3.5** (Rich, `docs/cr-22-pm-timeline` `6ba6563`; scheduling locks from v0.3.3 `fde3e47`). Every rule is locked except **Q-144** (paid Gantt licence). Until Jomerson decides, this spec assumes a **free library and no dragging** ("pending Q-144").

- **Mockup:** `docs/design/mockup/index-v0.9.20.html`
  - `#timeline`: the Timeline tab
  - `#timeline-import`: the import modal
  - `#pm-handover`: Part A frames
  - The existing project Timeline tabs now link to `#timeline`. Every v0.9.19 section is unchanged.
- **Screenshots:** `docs/design/cr22-*.png` (1440 and 390 wide).
- **Sample files:** `docs/design/cr22-timeline-template-sample.xlsx` (filled) and `cr22-timeline-template-blank.xlsx` (the Download template output).
- **Example data only.** "Acme Test Co Rollout", Test PM, Test BA, Dev One and the other names are fake. Every owner is a placeholder email (`pm@`, `ba@`, `member@`, `dev1@`, `dev2@`, `qa@` `xceler8.example`). The mockup's "today" is **Wed, Nov 11, 2026**.
- Theme: Sneat tokens from `THEME_TOKENS.md` (AA-darkened). All new CSS in the mockup is scoped under `.tlx`. Class names are for the mockup only. Use the app's components.

## 1. User flow
1. Project › **Timeline** tab. It opens on the Gantt (desktop) or the List (phone), scrolled so today sits near the left edge.
2. Read the summary cards: Target delivery, Forecast end with variance, Delayed tasks, Baseline.
3. Use the toolbar: zoom (Days / Weeks / Months), **Today**, the **Critical path** and **Baseline** switches, and the filters (All / Delayed / Critical path / Milestones).
4. Click a bar or a task name to open the task popover, then **Open task** for the task form.
5. Planner actions (Admin or a PM on the project) sit on the right of the toolbar:
   - **Phases**: the phase manager
   - **Save baseline**
   - **Excel** ▾: Import from Excel…, Download timeline (.xlsx), Download template
6. Import: Choose file → Check rows (preview) → Done. Nothing is saved before the PM clicks **Import**.

## 2. Timeline screen (`#timeline`)
### 2.1 Summary cards (4 across; 2 × 2 at 390)
| Card | Value | Sub-line |
|---|---|---|
| Target delivery | `Mon, Dec 14, 2026` (project `plannedEndDate`, Q-129) | "Project planned end date" |
| Forecast end | `Wed, Dec 16, 2026` (latest forecast finish, FR-TL-29) | Variance badge (forecast end vs target, working days, FR-TL-13/30); copy in §2.1.1. If nothing is scheduled the value is `—` with "No forecast without scheduled tasks". |
| Delayed tasks | count in danger red | "Open, and past due or forecast after baseline". With no baseline: "Open and past their planned finish". |
| Baseline | `Saved Oct 12, 2026` | "by Test PM · Baseline history (2)". The link opens the history. With no baseline: "No baseline yet" and "Save one to compare plan with actual." |

#### 2.1.1 Variance copy (exact, Lean)
Always pluralise by count. Late takes a plus sign and early takes a minus sign (U+2212 "−", not a hyphen).
| Forecast end vs target | Badge | Colour |
|---|---|---|
| 1 working day after | `+1 working day late` | danger (`bg-label-danger`) |
| N working days after (N ≥ 2) | `+N working days late`, e.g. `+2 working days late` | danger |
| Same day | `On track` | success (`bg-label-success`) |
| 1 working day before | `−1 working day early` | success |
| N working days before (N ≥ 2) | `−N working days early`, e.g. `−3 working days early` | success |

Examples: target Mon Dec 14, forecast Tue Dec 15 → `+1 working day late`. Forecast Wed Dec 16 (the mockup) → `+2 working days late`. Forecast Fri Dec 11 → `−1 working day early`, since the weekend doesn't count. Forecast Dec 14 → `On track`.

The forecast is shown **on the timeline only** (Q-136). The lists keep FR-PRJ-09.

### 2.2 Toolbar
- Zoom segmented control, **Weeks** by default:
  - Days: 28 px per day
  - Weeks: 10 px per day
  - Months: 4 px per day
- **Today** scrolls today into view.
- Switches:
  - **Critical path** (on): highlights critical bars and the links between them.
  - **Baseline** (on): shows the baseline bars.
- Filter pills with counts: `All 19`, `Delayed 2`, `Critical path 6`, `Milestones 4`. At 390 these become a select.
- Planner buttons: `Phases` (outline secondary), `Save baseline` (outline primary), `Excel ▾` (menu).
- Read-only users (Viewer, Member, any non-planner; Q-142) get no planner buttons. They see a lock note instead: "View only. The project PM or an Admin changes dates, phases and the baseline."

### 2.3 Broken-dependency banner (warning; only when there is at least one)
> **1 broken dependency.** #11 Load test data is planned to start Nov 9, but #9 Data migration scripts finishes Nov 9. Dates weren't moved. The forecast assumes #11 starts after #9 finishes (Nov 12 – Nov 16). **Show task**

With several, the copy is "N broken dependencies." and lists the first one. Show task opens that task's popover. Saving is never blocked and dates are never moved (Q-132).

### 2.4 Gantt grid
- **Left column** (sticky, 580 px; 168 px at 390, number and name only). Columns:
  - `#`
  - `Task`: a milestone diamond icon, then the name (link), then badges
  - `Owner`: name, or *No owner* in italics
  - `Dates`: `Oct 5 – Oct 9`; a milestone shows one date
  - `Var.`: finish vs baseline finish in working days, late positive (FR-TL-30). Late is danger, 0 is muted, completed late is neutral. The header tooltip reads "Finish compared with baseline finish, in working days".
- **Row height** 34 px. A critical task gets a 3 px dark bar at its left edge.
- **Header** (76 px):
  - Line 1: months.
  - Line 2: week ticks (Mon), days at Days zoom, or months at Months zoom.
  - Line 3: flag lane. `Today Nov 11` is a primary pill, centred. `Target Dec 14` is a dark pill, right-aligned to the line. `Forecast Dec 16` is a danger pill, left-aligned, shown only when the forecast is later than the target.
- **Background:** weekends `#f1f3f5`; holidays use the same tint with diagonal hatching and the holiday name as a tooltip. Both come from `loadCalendar()` (Q-131, Q-148).
- **Vertical lines:** today (2 px primary), target (2 px `#22303e`), forecast (2 px dashed danger). The target line always shows, even with no forecast.
- **Phase rows** (grey `#f8f9fa`):
  - Left cells: collapse chevron, name and "· N tasks", then `Target Oct 30` with a second line `Completed Nov 3` or `Forecast Dec 11`, then a variance of `On time` (success), `+1d` (danger) or `−1d` (success).
  - Chart: a dark summary bar from the earliest start to the latest finish, plus a flag at the PM's target date. The flag is red when the phase is late.
  - A phase whose tasks are **all cancelled** shows "· 1 task, cancelled", "Completion —" and no summary bar (A-53).
- **Unscheduled group** (FR-TL-02): always last. It shows "Unscheduled · N task(s), no dates" and its rows show "No dates" with no bar. The chart cell says "No dates, so it is left out of the critical path and forecast." If a scheduled task depends on it, the cell starts with the warning icon and "#17 depends on it; that link is ignored."
- **Cancelled tasks:** struck-through name, a `Cancelled` badge, a hatched outline bar, variance `—`. They are left out of the phase, forecast and critical path.

### 2.5 Bars and markers (legend; the same order appears under the chart)
| Item | Look | Rule |
|---|---|---|
| Planned / in progress | `#e7e7ff` bar, 1 px `#5355e0` border; fill to % done in `#5355e0` | planned dates (in progress: actual start to planned finish) |
| Completed | green `#2e7d17` | actual start to actual finish |
| Delayed | `#ffe0db` bar, `#b8240a` border, row badge `Delayed` (danger) | not Completed or Cancelled AND (planned finish before today OR forecast finish after baseline finish) (Q-135, FR-TL-11); with no baseline, planned finish only |
| Finished late | neutral `Finished late` badge (secondary) | Completed, and finished after the baseline finish. Never red. |
| Cancelled | hatched outline | left out of the phase, forecast and critical path |
| Baseline | 4 px `#8592a3` bar under the task bar | Baseline switch on, and a baseline exists |
| Forecast | dashed danger outline after the bar | only when the forecast finish is later than planned |
| Critical path | 2 px `#22303e` outline and dark links | open tasks with zero slack on the forecast schedule (FR-TL-12). **Completed tasks are never critical.** |
| Milestone | 14 px teal diamond `#00718a` with the date label | `isMilestone` |
| Phase / Phase target | dark summary bar / flag | §2.4 |
| Today / Target delivery / Forecast end | lines in §2.4 | |
| Broken dependency | red dashed link, ⚠ icon by the name | successor starts on or before its predecessor's finish |
| Linked task has no dates | warning icon `bx-error` `#9a5b00`, tooltip and aria-label "Linked task has no dates" | a link to an unscheduled task (FR-TL-28) |
| Weekend / Holiday | grey / hatched | |

Links are elbow connectors from the predecessor's finish to the successor's start, with an arrowhead. They are finish-to-start only, with no lag.

### 2.6 Task popover (click a bar or name; Esc closes; focus moves into it)
- Title `#11 Load test data`, then a meta line: phase · owner · status (in progress also shows %).
- A definition list: Planned, Actual ("Not started" / `Nov 4 – not finished`), Baseline, Variance (`+2d (working days)`), Forecast and Float (`9 working days`, or **0 · Critical**; open tasks only), Depends on (`#9 Data migration scripts (Nov 9)`).
- An unscheduled predecessor is listed as: ⚠ `#19 Security review (no dates, link ignored for the forecast and critical path)`.
- Broken link box (the same copy goes in the task form as a warning; it never blocks): **Starts before a task it depends on finishes.** #9 Data migration scripts finishes Nov 9. You can still save. Dates aren't moved.
- Delayed line: **Delayed:** not completed, and its forecast finish (Nov 16) is after its baseline finish (Nov 12). The other reason reads "its planned finish (Nov 9) has passed".
- Finished late line: **Finished late:** done Nov 3, after its baseline finish (Oct 29).
- Buttons: `Open task` (primary), `Close`.

### 2.7 Dialogs (planners only)
- **Save baseline?** "This copies the planned start and finish of all 20 tasks into their baseline. From now on the timeline compares each task with these dates."
  - If a baseline exists, add: "The current baseline (saved Oct 12, 2026 by Test PM) is replaced. It stays in Baseline history."
  - If any task is unscheduled, add: "1 task has no dates, so its baseline stays empty."
  - Field: `Reason (optional)`.
  - Buttons: Cancel / **Save baseline**.
  - Toast: "Baseline saved for 20 tasks. It's now the current entry in Baseline history."
  - Admin or a PM on the project can save (Q-133).
- **Baseline history:** a table with Saved (date and time, "Current" badge on the newest), By, Tasks and Reason (`—` if none). Footer: "Times in Philippine time. The timeline compares with the current baseline only."
- **Phases** (Q-130, FR-TL-23; phase-editing rule from Lean, Nov 11, 2026):
  - Rows: order ↑/↓, name input, target completion date, task count, **Remove**. Below the table: `+ Add phase` on the left and the history note on the right. Then Cancel / **Save phases**.
  - Intro: "Tasks pick their phase from this list, and the timeline shows phases in this order. A phase is complete when all its tasks are done; cancelled tasks are left out, and a phase whose tasks are all cancelled has no completion date."
  - **Who can change what:**
    | Change | PM, project Planning | PM, project Active or On hold | Admin |
    |---|---|---|---|
    | Target completion date | yes | **yes** | any time |
    | Add, rename, remove, reorder | yes | no (disabled) | any time |
  - **Active or On hold (PM):**
    - Target date inputs stay editable.
    - Name inputs, the ↑/↓ buttons, Remove and `+ Add phase` are disabled: grey `#f1f3f5` background, muted text, `cursor: not-allowed`.
    - Each disabled control sits in a wrapper with the tooltip "Phases can be added, renamed or removed only while the project is in Planning". Disabled controls don't fire hover events, so the wrapper carries the `title`. Each control also has `aria-describedby` pointing at the alert.
    - Info alert at the top: "This project is **Active**. You can change target completion dates. Phases can be added, renamed or removed only while the project is in Planning." Use **On hold** in the copy when that's the status.
    - **Save phases** stays enabled.
  - **History note** (all states, 13 px muted, history icon): "Changes are recorded in the project history. A saved baseline keeps its original dates, so variance still compares with them."
  - **Audit:** every change is written to the audit log. That includes each target-date change, with old and new values, who and when.
  - **Baseline:** changing a target date never changes a saved baseline. Variance keeps comparing with the baseline's original dates.
  - Remove is also disabled while a phase has tasks, with the tooltip "Move its tasks to another phase first".
  - Save validation: "Enter a phase name." and "There's already a phase with this name." (names compared ignoring case and spaces).
  - Toast: "Phase target dates saved. The change is recorded in the project history." (Active or On hold), or "Phases saved. The change is recorded in the project history." (Planning).
  - Reorder is treated like add, rename and remove (Planning-only for PMs) because it changes the phase list.
  - Mockup demo link: "Demo: show as PM while Active" / "Demo: show as PM in Planning (same as Admin)". The modal opens in the Active state, which is the mock project's status.
- **Excel menu:** Import from Excel…, Download timeline (.xlsx), a divider, Download template.

### 2.8 States
| State | UI |
|---|---|
| Loading | Card skeleton with a spinner and "Loading timeline…" |
| No scheduled tasks (empty project, all cancelled, or tasks but none with both dates; EC-188) | The cards still show: Target, Forecast `—`, Delayed `0`, Baseline. The body shows a calendar icon, **No scheduled tasks**, "A task needs both a start and a finish to show on the timeline. Add dates in the Checklist, or import a timeline from Excel." and "N tasks have no dates yet." (only when N > 0). A month strip shows the **Today** and **Target** lines with no forecast. Planners get Import from Excel / Download template / Open Checklist. There is no fallback to the baseline end. |
| No baseline yet | No baseline bars, variance `—`, Delayed by planned finish only, and the Baseline card copy from §2.1 |
| Read-only (Viewer, Member) | Everything is visible except the planner buttons; the lock note shows. The popover has no edit actions apart from Open task, which opens the task in read-only mode. |
| Broken dependency | §2.3 banner, red dashed link, ⚠ by the name, warning box in the popover and task form |

## 3. Scheduling rules the UI shows (CR-22 v0.3.3)
- **Working days:** Mon–Fri minus stored holidays (`loadCalendar()`, `isWorkingDay`, `addWorkingDays`). Durations, float and variance are all in working days.
- **Scheduled:** a task needs both a start and a finish (a milestone has Finish = Start). Other tasks go under Unscheduled and are left out of the critical path and forecast (FR-TL-02).
- **Successor start:** the next working day after its predecessor's finish, or after the latest finish if there are several (FR-TL-27). A link to an unscheduled task is ignored and shows the warning icon (FR-TL-28).
- **Forecast** (FR-TL-29): a forward pass from today over scheduled, non-cancelled tasks.
  - Completed tasks use their actual finish (fallback: the date marked Done, else the planned finish; FR-TL-31).
  - In-progress tasks finish on their planned finish or today, whichever is later.
  - Not-started tasks start on the latest of: planned start, the next working day after their predecessors finish, and today. They keep their planned working-day duration.
  - Project forecast end = the latest forecast finish.
- **Critical path** (FR-TL-12): CPM on the forecast schedule, with a backward pass from the forecast end. Critical = open tasks with zero slack. Completed tasks are never critical.
- **Actuals:** actual start is set on the first move to In Progress, and actual finish on Completed. The PM can edit both. Reopening clears the actual finish and keeps the actual start (Q-147).
- **Delayed / Finished late:** §2.5 (Q-135).
- **Worked example** (the mockup data):
  - #9 is overdue, and #11's forecast is after its baseline, so both are Delayed. #4–#7 are Finished late.
  - Forecast is Dec 16 vs target Dec 14, so **+2 working days late**.
  - Critical path is #8, 10, 13, 14, 17, 18. The completed tasks #1–#7 are not critical even though they were on the longest chain.
  - #17 depends on unscheduled #19 Security review, so it shows the warning icon.

## 4. Responsive (Q-143: web only, no drag)
- **≥ 768 px:** the layout above. The chart scrolls sideways inside its card, the left column stays sticky, and the page itself never scrolls sideways.
- **390 px (phone): view only.** On a phone you can view the timeline and open task details. **Save baseline**, the **phase manager** (Phases) and **import** (Excel › Import from Excel…, and the empty-state Import button) show the message **"Open this on a larger screen to make changes."** as a status toast. No dialog opens.
  - The toolbar note reads "On a phone you can view the timeline and open task details."
  - Excel › Download timeline and Download template still work.
  - A **List / Gantt** toggle defaults to **List**.
  - **List:** collapsible phase cards with Target / Completed or Forecast and a variance badge. Each task shows `#n Name`, badges, `dates · owner · status · Critical · Var.`, and a 6 px mini-bar on a shared Oct–Dec track with today and target ticks. Unscheduled tasks come last. There is no legend in List view.
  - **Gantt:** the same grid with a 168 px left column, scrolled to today. The zoom control stays.
  - If the import page is opened directly on a phone, it shows a card titled **Import timeline from Excel** with "Open this on a larger screen to make changes." in place of the modal.
- Tap targets are at least 44 px (pills, toggles, popover buttons).

## 5. Import from Excel (`#timeline-import`, `modal-xl`, max width 1180 px)
### 5.1 Steps
Stepper: `1 Choose file — 2 Check rows — 3 Done`. Completed steps show a green ✓.

**Choose file**
- Info alert: "**Import adds and updates tasks. It never deletes tasks.** Rows exported from OpsTrack update their own task (matched by a hidden Task ID). Rows you add become new tasks at the end of the list. Tasks that aren't in the file stay as they are. A blank cell clears that field."
- Dashed drop zone: "Drop your timeline file here or", then **Choose file**, then ".xlsx only · up to 5 MB · 2,000 rows".
- Footer note: "To edit this project's tasks, use Excel › Download timeline (.xlsx) on the Timeline, change the file, then import it here. To start a plan from scratch, download the template; every row in it imports as a new task. Dates as a date cell or YYYY-MM-DD."

Import is allowed in Planning, Active and On hold (Q-141).

**Reading file:** a spinner, "Reading file…" and "Checking every row. Nothing is saved yet."

**File errors** (danger alert above the drop zone; nothing imported):
- Wrong type: "This file isn't an .xlsx workbook. Save it as Excel Workbook (.xlsx) and try again. Nothing was imported."
- Columns: "Some columns are missing or out of order: Phase, Finish. Keep row 1 of the template as it is, then try again. Nothing was imported."
- Other project (FR-TL-26): "This file was exported from a different project. Export the timeline from Acme Test Co Rollout, or start from the blank template. Nothing was imported."
- Size and row limits and formula safety follow CR-19 (`CLIENTS_EXCEL_IMPORT_UI.md`).

**Check rows (preview)**
- **File chip:** "acme-test-co-rollout-timeline-2026-11-09.xlsx", "Exported from this project Nov 9, 2026, 9:42 AM · 26 rows", and **Choose another file**.
- **Filter chips with counts:** All, Errors, Changed since export, Clears fields, New, Update.
- **"Show N unchanged rows"** checkbox, off by default.
- **Alerts, in this order:**
  1. **Errors** (danger; whenever there is at least one row error, Q-146): "**Fix 10 errors in the file and upload again.** Any row with an error stops the whole import, because rows depend on each other. Nothing has been saved. **Show rows with errors**". N counts error messages. There is no skip option.
  2. **Changed since export** (warning, FR-TL-25): "**2 tasks were changed in OpsTrack after this file was exported.** Nothing is saved for them unless you confirm. Confirming replaces the OpsTrack values with the file values." The alert has a **Confirm all (2)** button, and each flagged row has a **Confirm overwrite** button. A confirmed row turns into Update.
  3. **Baseline ignored** (secondary, lock icon; shown when any baseline cell holds a value, Q-137): "**Baseline columns are ignored on import.** Click **Save baseline** after importing to update the baseline."
  4. **New numbering** (plain line, Q-149): "New tasks go to the end of the list. When you import, OpsTrack gives them the final numbers (file 30 → #21, file 31 → #22). Depends on uses the Task numbers in this file, so new rows can depend on each other."
  5. **New phase** notice (info, if any): "New phase {name} will be added at the end of the phase list."
- **Table:**
  - Columns: Row, Result, then the 10 visible template columns. The hidden Task ID isn't shown. Baseline start and finish carry a 🔒 icon and muted, read-only cells.
  - The table scrolls inside a box (max height max(60vh, 420px)) with a sticky header and a sticky Row column.
  - **Result badges:** `New` (info), `Update` (primary), `Unchanged` (secondary), `Changed since export` (warning), `Error` (danger). Error rows have a 3 px danger left border, changed rows a warning one.
  - **Changes:** a line under Update and Changed badges, e.g. "Changes: Finish". Changed cells are tinted `#f1f1ff` and show the old OpsTrack value struck through underneath.
  - **Clears:** a danger bold line, e.g. "Clears: Owner, Depends on" (Q-145, FR-TL-17, AC-74.12, EC-202). The cell shows **(blank)** in danger with the old value struck through. If a whole column is emptied, every affected row lists it.
  - **Changed since export:** "Changed in OpsTrack after export: Owner set to dev2@xceler8.example by Test PM, Nov 10, 3:12 PM." plus **Confirm overwrite**.
  - **Error cells:** tinted `#ffe0db` with a 1 px danger border. Messages appear under the badge (danger, 12 px), one per line.
  - Footnote: "Crossed-out values are what OpsTrack has now. (blank) means the cell is empty, so that field will be cleared."
- **Footer:** a help line, then Cancel and **Import N rows**. N counts rows that will save (new, update and confirmed). While there are errors, the button is disabled and the help line reads "Fix N errors in the file and upload again." (danger). Otherwise any unconfirmed changed rows are left out and the help line says "N changed rows not confirmed will be left as they are."
- **Out of date** (PREVIEW_STALE): a danger alert at the top: "This preview is out of date. The project changed after you checked the file. Nothing was saved. **Check again**".

**Importing:** a spinner, "Importing…" and "Don't close this window."

**Done:**
- Success circle and **Timeline imported**.
- "2 tasks added at the end (#21 and #22) and 5 updated. 8 rows were unchanged." If any changed rows were left unconfirmed: "N changed rows were not confirmed and left as they were."
- "Nothing was deleted. Baselines didn't change: click Save baseline if you want the new dates as the baseline."
- "The timeline, critical path and forecast are up to date."
- Button: **Back to timeline**.

### 5.2 Row error copy (exact, CR-22 §B5)
| Case | Message |
|---|---|
| Missing name | Task name is required. |
| Bad number | Task number must be a whole number of 1 or more. |
| Duplicate number (Q-149) | Task number {n} appears more than once in the file. |
| Bad date | {Column} isn't a valid date. Use a date cell or YYYY-MM-DD. |
| Finish before start | Finish can't be before Start. |
| Milestone | Milestone must be Y or N. |
| Missing dependency | Depends on: {n} isn't a task in this project or this file. |
| Self dependency | Depends on: a task can't depend on itself. |
| Cycle | Depends on: circular dependency {a} → {b} → {a}. |
| Dependency format | Depends on: use task numbers only, e.g. 3, 5. |
| Too many | More than 50 dependencies. |
| Unknown owner | Owner {email} isn't an active internal user. |
| Not a member (Q-140) | {email} isn't a member of this project. Add them to the project first. |
| Phase not allowed (Q-141) | You can't add phase {name} while the project is {status}. |
| Bad Task ID | Task ID {id} isn't a task in this project. / Task ID {id} appears more than once in the file. |
| Changed since export (flag, not an error) | This task was changed in OpsTrack after the file was exported. Confirm to overwrite it. |

The mockup preview has 26 rows: Error 9, Unchanged 8, Update 5, Changed since export 2, New 2. It covers a duplicate number (rows 24 and 25), a missing name, Finish before Start, a bad date (2026-11-31), a missing dependency (42), a cycle, an unknown owner (dev9@), a non-member (viewer@), a phase not allowed while Active, a clear (Owner and Depends on), a rename, and new rows 30 and 31 (31 depends on 30).

## 6. Excel template (`cr22-timeline-template-*.xlsx`)
- **Sheets:** `Instructions`, `Timeline` (active), and hidden `_meta`. `_meta` holds template `opstrack-timeline`, templateVersion 1, projectId, projectName, exportedAt (UTC), exportedBy and rows.
- **Timeline row 1 headers:** Task number, Task name, Phase, Milestone, Start, Finish, Depends on, Owner, Baseline start, Baseline finish, and the **hidden** Task ID (column K).
- **Formatting:**
  - The header is styled `#5355E0` with white bold text, panes are frozen at C2, and there's an autofilter.
  - Dates are real date cells formatted `yyyy-mm-dd`.
  - Data validation: Milestone Y/N, Phase from the list, date cells.
  - Header cells carry comments. Milestone rows are tinted. A finish later than the baseline is red bold.
- **Sample content:** 20 rows, with 4 phases plus one all-cancelled phase. It includes milestones, dependencies, two delayed tasks, one unscheduled task (#19) and one cancelled task (#20), which is still exported (Q-145).
- **Blank template:** headers, Instructions and an empty projectId. Every row imports as new (A-54).

## 7. Part A frames (`#pm-handover`, not a timeline screen)
- **Edit project**, when the manager changes away from you:
  - Checkbox **Stay on the project team**, ticked by default, with the help line "You stay a project member after the handover."
  - Unticked note (warning): "You'll lose access to this project after the handover."
  - After Save, the handover dialog says "You'll stay on the project team, so you can still view it and plan its tasks." or "You'll be taken off the project team and lose access to it."
  - API: `keepPreviousManagerOnTeam`.
- **Admin** changing another PM's project: the label is "Keep {name} on the project team", and **there is no note when unticked** (Admins keep access).
- **New project**, for a PM who picks another manager:
  - The same checkbox, ticked by default.
  - Unticked note: "You won't have access to this project after you create it."
  - Never shown to Admins, or when the PM picks themselves.
  - API: `keepCreatorOnTeam` on `POST /projects`; omitted means ticked.
- **Depends on chips** (task form, Part A fix):
  - Each chip has a × remove button with an aria-label like "Remove #5 Chart of accounts mapping".
  - The button is 24 px visible (32 px at 390), with a **44 × 44 px tap area** from an invisible `::before`.
  - At 390 the chip gap is 12–14 px, so tap areas don't overlap.

## 8. Accessibility
- Bars are `<button>`s with aria-labels such as "#11 Load test data, Nov 9 to Nov 11, delayed" (", critical" is added when it applies; milestones start with "Milestone").
- The chart has a text twin: the left column and the List view hold the same facts.
- Colour is never the only signal. Delayed, Finished late and Cancelled have text badges, critical rows have the left marker, and broken links have the icon.
- The popover and dialogs trap focus, close on Esc and return focus to the trigger.
- Contrast: AA tokens from `THEME_TOKENS.md`. Pill text on `#5355e0`, `#22303e` and `#b8240a` is white at 11 px semibold or larger.

## 9. Screenshots
- Timeline at 1440:
  - `cr22-timeline-1440.png`
  - `-unscheduled-link-1440` (popover on #17)
  - `-popover-1440` (#11 broken link)
  - `-delayed-1440`
  - `-days-1440`
  - `-months-1440`
  - `-nobaseline-1440`
  - `-empty-1440` (No scheduled tasks)
  - `-loading-1440`
  - `-member-1440` (read-only)
  - `-savebaseline-1440`
  - `-history-1440`
  - `cr22-timeline-phases.png` (Planning, or Admin)
  - `cr22-timeline-phases-active.png` (PM while Active)
  - `-menu-1440`
- Import at 1440:
  - `cr22-import-upload-1440.png`
  - `-preview-1440` (errors)
  - `-clean-confirmed-1440`
  - `-badfile-1440` (missing columns)
  - `-done-1440`
- Part A:
  - `cr22-handover-1440.png`
  - `-unticked-1440`
  - `-admin-1440`
  - `cr22-partA-390.png`
- Phone:
  - `cr22-timeline-list-390.png`
  - `cr22-timeline-gantt-390.png`

## 10. Open (for Lean or Jomerson)
- **Q-144:** free library vs paid licence. The mockup assumes free and no drag. If a paid library with drag is chosen, the popover and task form stay the editing path, and drag needs its own spec.
