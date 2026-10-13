# M8 Design Check (polish preview, server 0c23ce6) — Oct 10, 2026, 1:10 AM SGT, UIE
Preview: https://xc8-projectmgmt-web-git-m8-polish-jomerson-team.vercel.app · this follows M4_M7_DESIGN_REVIEW.md (DR-38 to DR-42). Admin and member at 1440, 600 (phone layout now starts below 768px) and 390.
Result: PASS, with 1 Low and 2 Cosmetic findings. There are no page errors. One /api/v1 problem: members get two 403s on Reports (DR-43); the 422s were expected validation errors. scrollWidth equals the viewport at 600 and 390 on every page (Dashboard, My tasks, Workload, Reports, DAR, Saved reports, Leave, Time logging, Admin Settings, Admin Leave), with and without a running timer.

Per item:
- DR-38 Fixed. In Admin › Leave › Entitlements, Oscar Outsider's Vacation shows "−3.5" with a real minus sign (U+2212) in red, semibold (5.71:1 on white), plus a "Negative" badge (4.61:1). Team on leave balances use the same style. The red is #c22d0e rather than the token, so see DR-44. (`m8/dr38-entitlements-negative.png`)
- DR-39 Fixed. Time logging is 600/390 wide with a timer running. "Time logging ‹ Oct 5–11 ›" moved into the page body. (`m8/admin-time-390-timer.png`)
- DR-40 Fixed. On phones the top bar keeps only the menu, pill, bell and avatar. The page title is a full heading in the body ("Daily Accomplishment Report" isn't truncated at 390 or 600). (`m8/admin-dar-600-timer.png`, `m8/admin-my-tasks-390-timer.png`)
- DR-41 Fixed. Add entry on an empty past day says "Where were you working on Wed, Oct 7? *". Today's first Time in still says "Where are you working today?". (`m8/dr41-pastday-prompt.png`)
- DR-42 Fixed. On an empty range, Export PDF and Export Excel are disabled with "Nothing to export: no entries in this range." Save report stays enabled; I didn't test it, because saved reports can't be deleted. (`m8/dr42-dar-empty-1440.png`)
- My tasks tab order Pass: Today, Day timesheet, Due, Assigned to me, I'm accountable, To review, Completed.
- Module free text Pass:
  - The field is "Module (optional)", a text input with placeholder "e.g. ADFS Remote".
  - A counter appears from 80 characters ("80/100"; nothing shows at 79). At 105 or 110 characters it shows "110/100", and submitting gives the inline error "Keep the module under 100 characters." The limit comes from validation, not a `maxlength` attribute.
  - HTML is shown as text: the module `<b>QA</b> <script>x</script>mod` showed literally, and the DOM held `&lt;b&gt;`.
  - The Admin Modules screen is gone. Settings tabs are General / Activity types / Locations, and /admin/modules returns 404.
- Day timesheet running row Pass. Time in created the timesheet row automatically ("01:02 AM | ■ Time out | 00:00"). The row's Time out is red (btn-danger). Clicking it ended the entry at "01:05 AM", showed rendered time as HH:MM, and cleared the top-bar pill (the same stop as the pill). See DR-45 for the minutes. (`m8/daysheet-running-1440.png`, `m8/daysheet-after-rowtimeout-1440.png`)
- Locked-day rows Pass for Admin; Member wording not verified.
  - Admin: on a submitted day, rows show a lock icon (`bx-lock-alt`, role=img, focusable) with title/aria-label "Locked. Reopen this day to change it." There's no ✎ and only "Reopen day…" is offered. After reopening, ✎ comes back. (`m8/locked-day-admin-1440.png`)
  - Member: I couldn't check the wording "Locked. Ask an Admin to reopen this day." The member has no submitted or locked day with entries: Oct 3 and 4 are locked but empty, and Oct 8 and 9 are reopened. I was asked not to change member data.

New findings:
- DR-43 (Low): a member opening Reports gets GET /api/v1/clients?pageSize=100 → 403 and GET /api/v1/projects?pageSize=100 → 403 on every visit, at all widths. The Project and Client filters then show only "All projects" / "All clients". This is new since the M7 re-check, where member Reports had no failed calls. Fill the filter options from what the member can see (e.g. the projects and clients in the report rows, or a member-scoped list endpoint), and don't call the Admin list endpoints for members.
- DR-44 (Cosmetic): the new `.text-negative` / `.badge-negative` use #c22d0e, not the danger token #b8240a. The badge is 4.61:1 on #ffe0db, which is only just above AA; the token gives 5.14:1 and matches every other danger badge. Use the token colour.
- DR-45 (Cosmetic): a timed entry from 01:02 AM to 01:05 AM shows Rendered "00:02" because the seconds (2 min 28 s) are cut off, so the row looks wrong to a user who subtracts the times. When saving, cut the start and end times down to the whole minute so the shown times and the duration agree (doc 14 §12.2: 8:00 to 8:07 is 7 minutes).

Test data:
- Admin, Oct 10: one entry ("QA M8 timer", module `<b>QA</b>…`, 01:02–01:05 AM) was created and deleted with Delete entry. The day was submitted and then reopened ("QA M8 check: undo test submit"), so Oct 10 shows Reopened, has no entries and has location WFH.
- A rejected Time in with a long module saved nothing.
- Member: nothing changed and no timers touched.
Screenshots: /workspace/review/m8/.

## 5a56782 design pass (Oct 13)
Oct 13, 2026, about 5:00–5:20 PM SGT. Preview m8-polish, server 5a56782. Tested Admin and Member at 1440, 768 and 390, plus 1280×600 and 390×700 for the sidebar. Project Type and DEF-011..014 were skipped.
**About 5:05 PM SGT the preview database was wiped.** Projects, time, timesheets and leave are gone, and some QA accounts were removed. Checks that need data are marked BLOCKED, not FAIL.
Result: **no FAIL among the items I could test. 2 new findings (Low, Cosmetic). 8 items BLOCKED.** No page errors. No /api/v1 4xx for Admin or Member.

- OpsTrack name and logo: PASS. The Ops Pulse lockup (`/brand/logo.svg`, alt "OpsTrack by Jomerson & Grok") is on the sidebar, login and /setup-password ("Link not valid" state). Tab titles read "OpsTrack – …". favicon.svg is the OpsTrack mark; .ico and apple-touch also exist. Footer "OpsTrack · by Jomerson & Grok". The old name doesn't appear on any page I checked. Report footer "Generated by OpsTrack.": BLOCKED (no data to export).
- Switch timer dialog: PASS. "Stop 'QA m8p timer A' and start this one?" with **Switch** (primary) and **Cancel** (outline), as doc 14 says. (`m8p/switch-timer-dialog-1440.png`)
- Field-level errors: PASS. Empty Quick activity shows "Add a title." / "Choose where you're working today." / "Choose an activity type." under each field. There's no generic "Some fields are invalid". (`m8p/switch-timer-dialog-1440.png` shows the location error)
- Time out on the running row, and Time in creating a timesheet row: BLOCKED. The wipe happened while this was running.
- Leave entitlement and carry-over auto-save: Partial or BLOCKED. There's no Save button, and the hint says "Changes save on their own when you leave the field. Every change is audited." Saving/Saved feedback wasn't tested because the values were wiped.
- Grey leave row on Day timesheet: BLOCKED. "+ Add leave" is shown: PASS.
- Lock icon and tooltip on locked days: BLOCKED (no timesheets).
- Sidebar scrolls at short heights: PASS. At 1280×600 the menu scrolls (765/551). At 390×700 the drawer scrolls (765/651). (`m8p/sidebar-1280x600.png`, `m8p/sidebar-390x700.png`)
- Member sees only their own timesheet: BLOCKED (no entries). The member's Day timesheet and Time logging show only "My entries".
- Access rules grid: PASS. The Reports row has View with an "Export" checkbox under it in the same cell, and n/a for Create, Edit and Delete. The Team & workload row has View and n/a, aligned with the other rows. (`m8p/access-rules-1440.png`)
- DR-43: PASS. Member Reports makes no 403 calls.
- DR-44 (#b8240a negative balance): BLOCKED (no balances).
- DR-45 (whole-minute times): BLOCKED.
- Inactive rows #646e78 on Activity types and Locations: BLOCKED. No inactive rows exist after the wipe.
- My tasks tab order: PASS for Admin and Member (Today, Day timesheet, Due, Assigned to me, I'm accountable, To review, Completed).
- No overflow at 768 and 390: PASS on 10 pages at 768. FAIL on one page at 390 (DR-46).

New findings:
- DR-46 (Low): at 390 px, Admin › Leave has scrollWidth 471, so the whole page scrolls sideways. The Leave types and Entitlements tables overflow their cards. Put each table in `.table-responsive` (overflow-x:auto) so only the table scrolls, as Settings already does. (`m8p/admin-leave-390.png`)
- DR-47 (Cosmetic): at 390 px, the Entitlements "Carry-over from 2025" input is squeezed to about 12 px and its value is cut off ("("). Give the inputs `min-width: 4.5rem`, or stack them on phones.

Test data: one Quick activity timer "QA m8p timer A" (Admin, Oct 13) was started just before the wipe. It isn't there after the wipe: no pill and no entries. "Timer B" was cancelled and never saved. No member data was changed and no reports were saved.
Screenshots: /workspace/review/m8p/.

## 87a8519 recheck (Oct 13)
Oct 13, 2026, about 5:35 PM SGT. Signed in as Admin (password updated). Checked at 1440, 768 and 390 against mockup v0.9.2. Other accounts weren't used.
**Result: FAIL.** DR-46 isn't fixed. Everything else I could test passes. Checks that need projects or Time in are BLOCKED.

- DR-46: **FAIL.** At 390, Admin › Leave still has scrollWidth 498, so the whole page scrolls sideways. The Leave types `table.table-sm` reaches 516 px; it isn't inside an overflow-x wrapper. The Admin sub-tabs nav also goes past the edge (right edge at 399). The header does wrap: "Leave types" sits next to the "+ Leave type" button and nothing is clipped. Widths are fine at 768 and 1440. (`m8r/admin-leave-390.png`)
- DR-47: **PASS.** At 390 the Carry-over inputs are 72–86 px wide and show "0" in full. (`m8r/admin-leave-390.png`)
- Project types location: **PASS.** It's a tab under Admin › Settings, between Activity types and Locations, as in the mockup.
- Starting types: **PASS.** There are 9: Configuration, Consulting, Development, Implementation, Integration, Migration, Support, Training, Upgrade. Each has an inline Default activity type select, some set (e.g. Migration → Data migration), plus Projects using it, Status and Actions columns, and the mockup help text. (`m8r/project-types-1440.png`)
- Add modal: **PASS.** "Add project type" has Name * with a counter (n/50) and "Default activity type (optional)" defaulting to "No default", with the hint "Preselected at Time in on this type's projects. People can change it." and Cancel / Add buttons.
- Blank name: **PASS.** Shows "Add a name.".
- Over 50 characters: **PASS.** The counter shows "54/50" and the error is "Keep the name under 50 characters." The limit comes from validation (there's no maxlength).
- Duplicate name: **PASS.** "CONFIGURATION" with trailing spaces gives "A project type with this name already exists.". So the check ignores case and extra spaces. (`m8r/ptype-duplicate-1440.png`)
- Deactivate vs delete: **PASS.** Types in use (Development, Implementation: "1 project") offer Rename and Deactivate only. Unused types also offer Delete. The confirm dialogs say "Deactivate Configuration? New projects can't pick it. You can reactivate it later." and "Delete Configuration? No project uses it. This can't be undone." Both were cancelled.
- Inactive rows #646e78: BLOCKED. There are no inactive types, and I didn't deactivate one. Active rows also use #646e78 body text.
- No overflow on Project types at 768 and 390: **PASS** (scrollWidth equals the viewport, and the modal fits at 390).
- New project form: **PASS.** "Project type *" select with "Choose a project type" and the 9 active types, plus the hint "Sets the default activity type when people time in on this project's tasks. Only active types are listed." I opened it only and didn't submit. (`m8r/new-project-1440.png`)
- "Template type" rename: BLOCKED. Template options read "· v1 (SAP Business One)", and the "Template type" label wasn't seen on the pages I opened. The string is in the bundle.
- "Not set" on existing projects, project header, Time in hint "From project type": BLOCKED (project-dependent; Queen is seeding).

New findings:
- DR-48 (Low): this is DR-46 not being fixed, and it adds the Admin tab nav. Wrap the Leave types (and Entitlements) tables in `.table-responsive`. Let the Admin sub-tab nav scroll on its own (`overflow-x:auto; flex-wrap:nowrap`) so the page width stays at 390.

DR-48 re-check on web 03a3379 (Oct 13, about 5:45 PM SGT): **FAIL (Low; one-line fix).** The new build is live; the CSS has the new `.table-responsive{…width:100%…}` rule.
- The table fix works. At 390, both Admin › Leave tables now scroll inside their wrappers (`.table-responsive`, 310 px visible of 476 and 470 px, overflow-x:auto). The Admin tab bar no longer overflows.
- The page still measures **498 px** wide at 390. The only cause is the screen-reader-only "Save status" column header in the Entitlements table (`SPAN.visually-hidden`, position:absolute, 1 px, left 497). Its positioning parent is outside the scroll wrapper, so it's placed at the table's full width and widens the page. I confirmed this by hiding elements one at a time: hiding that span alone brings the page width down to 390.
- Fix: add `position: relative` to `.table-responsive` (or to the `th`) so the hidden label stays inside the scroll area.
- Every other Admin page is at or under the viewport width at 390, 768 and 1440: Users, Teams, Holidays, and the Settings tabs General, Activity types, Project types and Locations. Leave is also fine at 768 and 1440. (`m8r/dr48-390.png`)

Test data: none left. Add-type modals were cancelled (still 9 types), and the Deactivate and Delete confirms were cancelled. The New project form was opened and not submitted.

## 2262fed design check (Oct 13)
Oct 13, 2026, about 6:30–7:15 PM SGT. Preview m8-polish, API 2262fed, mockup v0.9.9. Headless Chrome at 1440 and 390. I signed in once each as Admin and as PM (Paolo PM). Screenshots: /workspace/review/m10/.
**Result: no FAIL. 1 Cosmetic note. 11 items BLOCKED because they need time, leave or attachment data, or an inactive type.**

A. New features
- New project form: **PASS.** "Template (optional)" defaults to "None – start blank", with the helper "Pre-fills a standard set of phases and activities. You can change them later." "Project type *" is required (`required`, "Choose a project type"). (`m10/new-project-1440.png`)
- Blank Checklist empty state: **PASS.** Shows "Started blank", "No phases yet" and "Add your first phase, or apply a template." "+ Add phase" is btn-primary (#5355e0) and "Apply template" is outline-secondary, both shown in Planning. At 390 the page is 390 wide. (`m10/blank-checklist-1440.png`, `-390.png`)
- "Started from <template> v<n>": **PASS.** Project A shows "Started from Implementation Crystal Report Creation v1". (`m10/projA-checklist-pm-1440.png`)
- PM in Planning sees phase and activity Edit/Delete: **PASS.** It shows "+ Add activity", "✎ Edit phase" and "Delete phase" (outline-danger). (`m10/phase-added-planning-1440.png`)
- PM outside Planning: **PASS.** On Project A (At risk), phase details show a lock with the title "Phases can be edited only in Planning", and "+ Add activity to Phase N" stays enabled.
- Delete phase confirm: **PASS.** Title "Delete phase UIE Phase 1?" with Cancel (outline) and Delete phase (btn-danger, rgb(184,36,10)). (`m10/delete-phase-confirm-1440.png`)
- Phase with activities: **PASS.** Inline red text (#b8240a) "Can't delete: this phase still has 1 activity. Delete it first." with no dialog (Admin on Project A). The plural form was checked in the bundle only. (`m10/phase-delete-blocked-admin-1440.png`)
- Apply-template confirm: **PASS.** "This adds 6 new phases and adds 22 activities. Nothing is replaced." It's shown only when the project already has phases. The toast variants match the spec in the bundle (f6), but I didn't apply a template, so I haven't seen them on screen. (`m10/apply-template-confirm-1440.png`)
- Leave Planning with no phases: **PASS.** The title, body, "Stay in Planning" (outline) and "Move on anyway" (primary) match. I clicked Stay in Planning, and the project is still Planning. (`m10/leave-planning-dlg-1440.png`) Note: the dialog uses taskCount===0, so it also appears when the project has an empty phase. The body then says "no phases", which isn't quite right.
- Planned column: **PASS.** The Today/Aging table has TASK, PLANNED, DUE… and Assigned to me has TASK, PROJECT, MY ROLE, PLANNED, DUE, EST. / ACTUAL, STATUS. At 390 the cards show Planned above Due. Empty cells use `td.cell-omit-empty:empty{display:none}`; there were no empty rows to see this on screen. The Due tab was empty. Cosmetic: the heading is "My role" but the mockup says "Role". (`m10/mytasks-*-1440/390.png`)
- Activity delete with attachments: **BLOCKED.** No activity has evidence, issues or follow-ups. The string "Can't delete: this activity has …" is in the bundle.

B. Earlier blocked checks
- Project types grey inactive rows: BLOCKED (none inactive, even with Show inactive on).
- "Template type" label: **PASS.** The project header shows "Template type: SAP Business One".
- "Not set" on existing projects: BLOCKED. Every project has a type. The "Not set" filter option is there.
- Project header type: **PASS.** "QA REGR Client 1013181259 · Project type: Development".
- Time in hint: **PASS.** "From project type: Configuration. You can change it." (`m10/timein-hint-1440.png`; cancelled, no timer started)
- Report footer, Time out/Time in row, Saving/Saved, grey leave row, lock tooltip, member-only timesheet, DR-45: BLOCKED. There are no time, timesheet or leave entries, and I wasn't allowed to create any.
- DR-44: **PASS (CSS).** `.text-negative` and `.badge-negative` both use #b8240a. There's no negative balance to see on screen.

C. DR-48
- Admin › Leave at 390: **PASS.** scrollWidth is 390. (`m10/admin-leave-390.png`)
- Checklist at 390: **PASS.** scrollWidth is 390 on Project A and on the blank project. The phase card headers wrap (flex-wrap: wrap, 358 px wide, 60–101 px tall). (`m10/checklist-projA-390.png`)

Test data: as PM I created "UIE DC blank 1013" (UIEDC1013, Consulting, Planning). I added and deleted the empty phase "UIE Phase 1". The project is still there because I wasn't allowed to delete it. The Leave Planning dialog and the Apply template dialog were cancelled, and the Time in dialog was cancelled.

## 2262fed blocked-items recheck (Oct 13)

Preview `xc8-projectmgmt-web-git-m8-polish-jomerson-team.vercel.app`, API 2262fed. Headless Chrome at 1440 and 390. Signed in as pm2 and Admin. Read-only: nothing was saved, every dialog was cancelled, and no POST/PATCH/DELETE requests were sent. Data is Queen's "QA DESIGN" seed on QA REGR Project A 10131812. Screenshots are in `review/m10b/`.

Result: **no FAIL. 5 PASS, 1 PASS (partial), 4 BLOCKED, 1 UNTESTABLE.**

- Activity delete with attachments: **BLOCKED.** Project A is At risk. On QA REGR Task 0 (02:15 logged, QA DESIGN evidence.pdf attached), the Actions menu shows only "Move up / Move down" for pm2 and for Admin. The Edit task dialog and the task drawer have no Delete either. I couldn't reach the "Can't delete…" message. This needs an activity with time and evidence on a Planning project. (`activity-menu-1440.png`, `activity-edit-1440.png`)
- Project types inactive row: **PASS.** With Show inactive on, the row reads "QA Inactive Type / Deactivated Oct 13 by Ada Admin". Text is #646e78, the "Inactive" badge is #646e78 on #ebeef0, and the only actions are Rename and Reactivate. The New project "Project type" picker lists only the 9 active types, and "QA Inactive Type" isn't in it. Note: active rows also use #646e78 for the name. Only the badge and the subline mark a row as inactive. The /projects filter lists "QA Inactive Type (inactive)", which is fine for filtering. (`ptype-inactive-row-1440.png`, `ptype-inactive-table-1440.png`, `ptype-inactive-390.png`, `new-project-ptype-1440.png`)
- Report footer: **PASS.** The DAR preview for Oct 13 lists 5 activities with total 07:15. It ends with "This is an automated email. Generated by OpsTrack." (12px, #595959). No horizontal scroll at 390. (`dar-1440.png`, `dar-footer-1440.png`, `dar-footer-390.png`)
- Time out / Time in row: **PASS (partial).** Timed rows show "09:00 AM | 10:15 AM | 01:15" and "10:30 AM | 12:00 PM | 01:30". Hours-only rows show "Hours only | –". There's no running entry, so the red Time out button wasn't seen. Starting one would create data. (`daysheet-oct13-1440.png`, `daysheet-oct13-390.png`)
- Saving/Saved feedback: **BLOCKED.** Day timesheet edits use an "Edit entry" modal with a Save button, not auto-save. I'd have to submit to see any feedback, so I cancelled. (`daysheet-edit-1440.png`)
- Grey leave row: **PASS.** On Oct 21 and Oct 22 the row reads "Vacation · Full day" with class `table-secondary leave-row`: text rgb(93,104,120) on rgba(93,104,120,.2). The header badge reads "On leave". The status text is **"Recorded"** on Leave > My leave ("Oct 21 – Oct 22 · Vacation · Full day · 2 · Oct 13 · Recorded"). No "Pending" or approval label appears on the leave list, Day timesheet or Team on leave. The only related text is the "No approval: …" help copy. (`daysheet-10-21-1440.png`, `daysheet-10-21-390.png`, `daysheet-10-22-1440.png`, `leave-1440.png`, `leave-390.png`, `leave-team-1440.png`)
- Lock tooltip, Oct 6–9: **BLOCKED for the row tooltip.** Each day shows the banner "🔒 Oct N wasn't submitted. It was locked as it stood at the weekly lock." Log, quick activity and Submit actions are hidden, and the page reads "No entries on Oct N". With no rows, there's no row lock icon or tooltip to check. (`daysheet-10-06…10-09-1440.png`)
- Member-only timesheet: **BLOCKED.** I didn't sign in as a Member, to avoid 429 rate limits (I was limited to pm2 and Admin). pm2's Time logging shows only "My entries this week" (4 rows, 06:00).
- DR-45 (whole-minute times): **PASS on screen.** 09:00–10:15 renders 01:15 and 10:30–12:00 renders 01:30, and the day total is 07:15. The seed times are whole minutes, so seconds truncation wasn't exercised.
- DR-44 on screen: **BLOCKED.** Admin > Leave has no negative balances, and no `.text-negative` or `.badge-negative` elements are on the page. pm2's Vacation balance is 8. The CSS PASS from the last check still stands.
- "Not set" project type: **UNTESTABLE on fresh data.** Every project has a type. Deven's API/web test covers this.

## 46541f2 design check (Oct 13)
Oct 13, 2026, about 6:55–7:10 PM SGT. Preview m8-polish, build 46541f2 (the m10c/m10d checks ran on 92698b3 just before). Headless Chrome at 1440 and 390. Read-only: no data changed and every dialog was cancelled. I signed in once per account (pm2, qa.member@, Admin) and didn't use qa.autostop@.
**Result: no FAIL.**

- Task 0 red ACTIVITY_IN_USE line: **PASS.** In the drawer for QA REGR Task 0 (02:15 logged, QA DESIGN evidence.pdf), a red #b8240a line under the action buttons reads "Can't delete: this activity has logged time and evidence files." (`review/m10c/drawer-1440.png`, `drawer-390.png`)
- Running-row Time out: **PASS.** pm2's "QA DESIGN running timer" row on Day timesheet / Today shows a red btn-danger (#b8240a) "Time out" button in the row and an elapsed indicator. There's no overflow at 390. (`review/m10c/running-1440.png`, `running-390.png`)
- Member timesheet scoping: **PASS.**
  - qa.member@ sees only their own three Oct 13 entries: 08:30–09:45, 10:00–11:30 and 01:00–02:15 PM ("QA DESIGN member entry"), with HOURS RENDERED 04:00. No other users' entries or admin/PM controls are shown.
  - /workload shows only the member's own row, and /reports shows no team data ("Nothing to report").
  - scrollWidth is 390 at 390. (`review/m10d/qam-daysheet-1440.png`, `-390.png`, `qam-workload-1440.png`, `qam-reports-1440.png`)
- Weekly totals: **PASS.** My tasks reads "Logged this week 04:00 of 40:00 available" (label unchanged). /workload shows Recorded 04:00 and Utilization 10%. No overflow at 390. (`review/m11/member-mytasks-1440.png`, `-390.png`, `member-workload-1440.png`, `-390.png`)
- Project types colours: **PASS.**
  - All 9 active names are rgb(56,69,81) (#384551), with an Active badge in rgb(46,125,23) on rgb(232,250,223).
  - "QA Inactive Type" is muted rgb(100,110,120) (#646e78), with an "Inactive" badge in #646e78 on #ebeef0.
  - No overflow at 390. (`review/m11/admin-ptypes-1440.png`, `-390.png`)
- Blank Checklist ("UIE DC blank 1013", Planning): **PASS.** It shows "Started blank", "+ Add phase" and "Apply template", then "No phases yet" and "Add your first phase, or apply a template." No overflow at 390. (`review/m11/admin-checklist-1440.png`, `-390.png`)

# Final M8 design summary (Oct 13, 7:10 PM SGT)
**Verdict: design sign-off for M8 on build 46541f2.** No open FAIL. DR-38–DR-48 are all fixed or passed. Mockup version: **v0.9.10**.

Passed across the checks in this file:
- Branding and name:
  - OpsTrack name, logo, favicon and footer.
  - Report footer "Generated by OpsTrack."
- Layout:
  - Sidebar scrolls at short heights.
  - Tab bars, headers and tables fit with no page overflow at 768/600/390 (DR-39, DR-40, DR-46/48 fixed, DR-47).
  - My tasks tab order.
  - Planned column.
- Errors and dialogs:
  - Field-level errors.
  - Switch timer dialog.
  - DR-41 past-day prompt.
  - DR-42 disabled empty exports.
  - DR-43: no member 403s.
- Time:
  - Module free text (counter, 100-character limit, HTML escaped).
  - Time in hint "From project type".
  - Running-row Time out in red, which also auto-creates the row.
  - Timed rows render HH:MM (DR-45 on screen).
  - Grey leave row with "Recorded" status.
  - Locked-day rows for Admin and the weekly-lock banner.
- Members:
  - Member sees only their own timesheet, workload and reports.
  - Weekly totals 04:00 / 10%.
- Project types:
  - Tab location, the 9 starting types, Add/validation/duplicate rules, Deactivate vs Delete.
  - Active #384551 vs inactive #646e78 + badge.
  - New project picker lists active types only.
  - "Template type" label, project header type.
- Checklist and phases:
  - New project template option, blank Checklist empty state, "Started from … v1".
  - PM Planning edit rules, lock outside Planning.
  - Delete phase confirm and inline "Can't delete" for phases.
  - Apply-template confirm, Leave Planning dialog.
  - Activity "Can't delete" line in red.
- Access rules grid.
- DR-38 and DR-44 CSS (#b8240a).

Still unverified (data was lacking; not failures):
- Saving/Saved auto-save feedback. Entitlement auto-save was never exercised, and Day timesheet edits use a Save modal.
- Locked-row lock icon and tooltip, for the Member wording and on the weekly-locked days. Locked days had no rows.
- DR-44 negative balance on screen. There's no negative balance in the data; the CSS passes.
- "Not set" project type: every project has a type. Deven's API/web test covers this.

Open decisions for Jomerson:
- **Q-70:** Viewer access (what a Viewer can see and do).
- **Q-71:** should weekly totals include quick activities? They do on 46541f2. If not, use the fallback labels: card "Task time this week" with the hint "Quick activities and leave not included.", and the Workload column "Task time recorded".
