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
