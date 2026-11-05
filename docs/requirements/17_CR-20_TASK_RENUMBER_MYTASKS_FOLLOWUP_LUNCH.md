# CR-20 — Task order numbers without gaps, # column in My tasks, follow-up badge, lunch break on the Day timesheet

**Status:** v0.1 draft (2026-11-05, SGT) · **Author:** Business Analyst (Rich) · **For:** Jomerson (approval), Lean, Deven, Queen, UIE
**Requested by:** Jomerson (lead dev / product owner), 2026-11-05. **Rules locked by:** Lean (tech lead), 2026-11-05 PM room. Rules marked **Locked** are Lean's. Anything not locked is listed as an assumption (§11) or an open question (§12). Nothing here adds a product decision beyond what Lean locked.
**Part of:** doc 17 (change requests). CR-20 is summarised in `17_CHANGE_REQUESTS.md` and specified in full here. It follows CR-19 and uses the next free IDs: **FR-TSK-31 to FR-TSK-36**, **FR-NTF-09 to FR-NTF-13** (FR-NTF-07 and 08 are reserved in doc 17 §3), **FR-ACT-37 to FR-ACT-42**, **US-64 to US-67**, **AC-64.x to AC-67.x**, **EC-162 to EC-175**, **NFR-43 to NFR-46**, **Q-120 to Q-125**, **A-36 to A-41**.
**Checked against:** docs 01 to 17 (with CR-19), and the build at `main` `dfa1f38` (merge of PR #46).
**Not built.** This is a new request, not a PR review.
**UI reference:** none yet. UIE designs the My tasks # column and the follow-up badge (§13).

**Doc change log:**
- v0.1 (2026-11-05, SGT): first draft. Four items from Jomerson, rules locked by Lean. Q-120 (recalculate old time with lunch taken out?) waits on Jomerson. Q-121 to Q-125 are gaps found while writing, waiting on Lean, Deven or UIE.

## 0. What the build has today (baseline)
| Topic | As built | Evidence |
|---|---|---|
| Checklist # | The project checklist shows a **#** column, filled from the task's stored `order` field (FR-TSK-11). The same `#{order}` label appears in the task pickers (documents, conversations, task form). | `apps/web/src/pages/projects/ProjectTabs.tsx:295`, `:326`, `:962`; `DocumentRequestModals.tsx:167`; `ConversationTab.tsx:225`; `TaskFormModal.tsx:386` |
| Task `order` | A number on each task, default 0, indexed with `projectId`. Lists sort by it. | `apps/api/src/models/Task.ts:9`, `:89`; `apps/api/src/routes/tasks.ts:124`, `:623` |
| Task delete | **Hard delete** (`deleteOne`) in a transaction, only by the Project PM or an Admin (FR-PRJ-21), refused with 409 if anything is attached (`ACTIVITY_IN_USE`, `TASK_HAS_RECORDS`). **The other tasks' `order` isn't touched**, so a gap is left (the bug behind this CR). | `apps/api/src/routes/tasks.ts:1445-1470` |
| My tasks | Tabs per FR-TSK-22 / FR-TSK-28. Columns per FR-TSK-26 (Task, Project, Role, Planned, Due, Est / Act, Status). **No # column.** `GET /tasks/mine` shows **no paging** in the code read so far (see Q-122). | `apps/web/src/pages/MyTasksPage.tsx`; `apps/api/src/routes/tasks.ts:899` |
| Follow-up notifications | In-app notification to owner, assignees, reviewer and PM, except the writer (FR-NTF-01 to 06, US-40, AC-40.1, BR-25). Clicking the notification marks **the notification** read (FR-NTF-03). **No follow-up count on task rows and no per-user "seen" state for follow-ups.** | doc 12 §FR-NTF; `apps/api/src/routes/notifications.ts` |
| Day timesheet defaults | Manual entries take time in and time out (FR-ACT-10). **No default 8:00 AM / 5:00 PM** found in the code. | doc 14 FR-ACT-10; no default in `apps/web/src` |
| Lunch | **No lunch deduction.** Hours = time out minus time in (`minutes / 60`), for the timer and manual entries. | `apps/api/src/routes/tracker.ts:436`, `:523`; doc 14 FR-ACT-02, FR-ACT-10 |
| Time zone | Time in/out is in Philippine time (FR-ACT-09); "today" in Asia/Manila (FR-TSK-21). | doc 14 FR-ACT-09; doc 12 FR-TSK-21 |

*Code evidence is from a read of `main`, not a run. Deven to confirm the My tasks paging and the notification model before building.*

## 1. Summary
Four fixes Jomerson asked for, as Lean defined them:
1. **No gaps in task numbers.** Deleting a task moves the tasks after it up by one in the same save, so a project's checklist reads 1, 2, 3 with no gap. Projects that already have gaps get a one-time renumber, run on live only with Jomerson's OK.
2. **# in My tasks.** A # column numbered 1 to n in the current sort and filter, continuing across pages.
3. **Follow-up badge.** Follow-up notifications stay as they are. Task rows in the project checklist and in My tasks also get a follow-up count badge, highlighted until the user opens a follow-up they haven't seen.
4. **Lunch break.** The Day timesheet defaults to 8:00 AM time in and 5:00 PM time out. Any part of an entry between 12:00 and 1:00 PM isn't counted, so a full day is 8 hours. Applies to manual entries and the timer; reports use the same hours.

## 2. Scope
**In scope**
- Renumber on delete and a one-time renumber of existing gaps (§3).
- My tasks # column (§4).
- Follow-up count badge with unseen highlight on the checklist and My tasks (§5).
- Day timesheet default times and the lunch window, for manual entries, the timer and reports (§6).

**Out of scope**
- **No change to FR-NTF-01 recipients**, the notification text or the bell. No email channel change (FR-NTF-02 stays in-app).
- No mobile (Lean didn't include it). See A-41.
- No drag-and-drop reorder or other reorder change. Move up / Move down stays as built.
- No change to who can delete a task (FR-PRJ-21) or to the 409 blocks.
- No change to the day lock (FR-TIME-04 / FR-ACT-36), the 24-hour cap (FR-TIME-03) or overlap rules (FR-ACT-05, FR-ACT-11).
- No change to time already logged until Jomerson answers **Q-120**.
- No configurable working hours or lunch setting (not asked for; see Q-125).

## 3. Task order numbers without gaps (Locked, Lean, 2026-11-05)
- **FR-TSK-31 (Must)** When a task is deleted, every task after it **in the same project** has its order number lowered by one **in the same save** (same transaction as the delete). The checklist then reads 1, 2, 3, … n with no gap. Amends FR-TSK-11 (the # shown stays the stored order).
- **FR-TSK-32 (Must)** If the delete is refused (403, 404, 409 `ACTIVITY_IN_USE`, 409 `TASK_HAS_RECORDS`), **no number changes**.
- **FR-TSK-33 (Must)** A **one-time renumber** closes gaps in projects that already have them, keeping the current order. It runs on **live only with Jomerson's OK**. It's run once, can be run again safely (a project with no gaps is left as is), and reports how many projects and tasks it changed.
- **FR-TSK-34 (Must)** The renumber (both FR-TSK-31 and FR-TSK-33) changes only the order number. It doesn't change the task, its version for other fields, its links or its history. Audit: see Q-124.
- **Effect to note:** the same `#{order}` label is used in the task pickers (§0), so numbers there shift too. Anyone who wrote "task #5" in a note or DAR will find a different task at #5 after a delete. That is the expected result of the rule, not a defect.

## 4. # column in My tasks (Locked, Lean, 2026-11-05)
- **FR-TSK-35 (Must)** My tasks gets a **#** column numbered **1 to n in the current sort and filter**. It is a **row position**, not the task's project order number (FR-TSK-11), and it is recalculated when the sort, filter or tab changes. Amends FR-TSK-26 (column list) and FR-TSK-13.
- **FR-TSK-36 (Must)** **Numbering continues across pages:** row 1 on page 2 is (page size × 1) + 1, not 1. Today no paging was found (Q-122); the rule applies wherever paging exists or is added.
- Which tabs show it, where the column sits and how it looks on phone cards: UIE to design (Q-121).

## 5. Follow-up count badge (Locked, Lean, 2026-11-05)
- **Unchanged:** FR-NTF-01 to 06, US-40 and AC-40.1. People on a task still get an in-app notification when a follow-up is added.
- **FR-NTF-09 (Must)** Each task row in the **project checklist** and in **My tasks** shows a **follow-up count badge** when the task has one or more follow-ups. No follow-ups: no badge.
- **FR-NTF-10 (Must)** The badge is **highlighted** while the task has at least one follow-up **the signed-in user hasn't seen**. Once the user opens the follow-up(s) they haven't seen, the badge goes back to plain (still showing the count).
- **FR-NTF-11 (Must)** "Seen" is **per user**. One person opening a follow-up doesn't clear the highlight for anyone else.
- **FR-NTF-12 (Must)** A user's own follow-up counts as seen by them (they wrote it). *(Follows FR-NTF-01, which doesn't notify the writer; see A-38.)*
- **FR-NTF-13 (Must)** The badge follows access at read time, the same as FR-NTF-04: a user only sees counts for tasks they can see.
- Open points: what "open a follow-up" means in the UI, which follow-ups are counted, and whether reading the bell notification also counts as seen (Q-123).

## 6. Day timesheet defaults and lunch break (Locked, Lean, 2026-11-05)
- **FR-ACT-37 (Must)** The standard day is **8:00 AM to 5:00 PM**. On the Day timesheet, a new manual entry defaults to **time in 8:00 AM** and **time out 5:00 PM**. The user can change both before saving. Amends FR-ACT-10.
- **FR-ACT-38 (Must)** **Lunch window 12:00 to 1:00 PM is not counted.** For any entry with a time in and time out, hours = (time out − time in) minus the part of the entry that falls between 12:00 and 1:00 PM. A full 8:00 AM to 5:00 PM entry is **8 hours**.
- **FR-ACT-39 (Must)** The rule applies to **manual entries and the timer** (FR-ACT-02) the same way, including auto-stopped timers (FR-ACT-04).
- **FR-ACT-40 (Must)** **Reports use the same hours**: Hours rendered (FR-ACT-10), task actual hours (FR-TIME-07), weekly totals (FR-ACT-34), Team & workload Recorded (FR-WL-01) and the DAR (FR-DAR-08). There is one stored hours value and every screen reads it.
- **FR-ACT-41 (Must)** The 24-hour daily cap (FR-TIME-03) and other hour checks use the counted hours after lunch is taken out (A-39; Deven to confirm no check reads raw duration).
- **FR-ACT-42 (Must)** Time logged **before** this change: **not decided** (Q-120). Until Jomerson answers, the build must not recalculate existing entries.

## 7. User stories
- **US-64** As a PM, I want task numbers to close up after I delete a task, so the checklist reads 1 to n without gaps.
- **US-65** As a team member, I want a # on each My tasks row, so I can refer to a row by number in the order I'm looking at.
- **US-66** As someone on a task, I want to see how many follow-ups it has and whether any are new to me, without opening every task.
- **US-67** As a team member, I want the Day timesheet to start at 8:00 AM to 5:00 PM and leave lunch out, so a normal day comes to 8 hours without me working it out.

## 8. Acceptance criteria
**US-64 — renumber**
- **AC-64.1 (API)** Project with tasks #1 to #5. The PM deletes #3. In the same response cycle the checklist shows the old #4 as #3 and the old #5 as #4; there is no #5. (FR-TSK-31)
- **AC-64.2 (API)** Deleting the last task (#5) leaves #1 to #4 unchanged. (EC-162)
- **AC-64.3 (API)** Deleting #1 moves every other task up by one.
- **AC-64.4 (API)** A delete refused with 409 `ACTIVITY_IN_USE` leaves every number unchanged. (FR-TSK-32)
- **AC-64.5 (API)** Two deletes in the same project at the same time: afterwards numbers are still 1 to n with no gap and no duplicate. (EC-163, NFR-43)
- **AC-64.6 (script)** On a copy of live data, the one-time renumber turns a project numbered 1, 2, 4, 7 into 1, 2, 3, 4 in the same order; a project with no gaps is unchanged; running it a second time changes nothing. (FR-TSK-33)
- **AC-64.7 (UI)** After a delete, the task pickers (documents, conversations, task form) show the new numbers.

**US-65 — My tasks #**
- **AC-65.1 (UI)** A tab with 7 rows shows # 1 to 7 top to bottom.
- **AC-65.2 (UI)** Changing the sort renumbers rows 1 to n in the new order; the # follows the row position, not the task.
- **AC-65.3 (UI)** A filter that leaves 3 rows shows # 1 to 3.
- **AC-65.4 (UI)** Across pages, if paging exists: with page size 25, the first row on page 2 is #26. (FR-TSK-36, Q-122)
- **AC-65.5 (UI)** The My tasks # is not the project order: a task that is #4 in its project may show as #1 in My tasks.

**US-66 — follow-up badge**
- **AC-66.1 (UI)** A task with 2 follow-ups the user has seen shows a plain badge "2".
- **AC-66.2 (UI)** Another person adds a follow-up: the badge shows 3 and is highlighted, on both the checklist row and the My tasks row; the bell notification also arrives (AC-40.1 unchanged).
- **AC-66.3 (UI)** The user opens the new follow-up: the badge stays 3 and is no longer highlighted, on both screens, after refresh or page focus.
- **AC-66.4 (API)** User A opening the follow-up doesn't change user B's highlight. (FR-NTF-11)
- **AC-66.5 (UI)** The writer of a follow-up doesn't see their own new follow-up as highlighted. (FR-NTF-12)
- **AC-66.6 (UI)** A task with no follow-ups shows no badge.

**US-67 — defaults and lunch** (all times Philippine time)
- **AC-67.1 (UI)** New manual entry on the Day timesheet opens with time in 8:00 AM and time out 5:00 PM.
- **AC-67.2 (API)** 8:00 AM to 5:00 PM = **8.00 h**.
- **AC-67.3 (API)** 8:00 AM to 12:00 PM = 4.00 h (ends at the start of lunch, nothing taken out).
- **AC-67.4 (API)** 1:00 PM to 5:00 PM = 4.00 h.
- **AC-67.5 (API)** 11:30 AM to 12:30 PM = **0.50 h** (crosses into lunch).
- **AC-67.6 (API)** 12:30 PM to 2:00 PM = **1.00 h** (starts inside lunch).
- **AC-67.7 (API)** 12:15 PM to 12:45 PM, entirely inside lunch = **0 h** (what the screen does with it: Q-125). (EC-166)
- **AC-67.8 (API)** Timer started 11:00 AM, stopped 2:00 PM = 2.00 h. (FR-ACT-39)
- **AC-67.9 (API)** Timer started 8:00 AM and auto-stopped at 23:59 (FR-ACT-04): 15 h 59 min of clock time minus 1 h lunch = **14 h 59 min** counted. (EC-168)
- **AC-67.10 (API)** Hours rendered, task actual hours, weekly totals, Team & workload and the DAR all show the same hours for an entry. (FR-ACT-40)
- **AC-67.11 (API)** An entry saved before the change keeps its hours (until Q-120 is answered). (FR-ACT-42)

## 9. Non-functional
- **NFR-43 (Must)** The delete and the renumber of the following tasks run in **one transaction**. Concurrent deletes in one project never leave a gap or a duplicate number.
- **NFR-44 (Must)** The one-time renumber (FR-TSK-33) is a script or migration that is safe to re-run, has a dry-run mode that lists the changes, and runs on live only after Jomerson's OK.
- **NFR-45 (Must)** The lunch window **12:00 to 1:00 PM** is in **Philippine time (Asia/Manila, UTC+8)**, the same as FR-ACT-09 and FR-TSK-21 (A-36). The server computes the hours; the web app may show a preview but doesn't set them.
- **NFR-46 (Should)** Follow-up counts and seen state come back with the task lists (checklist and `GET /tasks/mine`) without one extra request per row.

## 10. Edge cases
- **EC-162** Delete the last task: nothing else moves.
- **EC-163** Two deletes in the same project at the same time: result is 1 to n (NFR-43).
- **EC-164** A task is created or moved (Move up / Move down) while another is being deleted: numbers still end 1 to n, no duplicates.
- **EC-165** Delete is a **hard delete** today (§0). If soft delete is ever added, the soft-deleted task must leave the numbering too. Not in scope now.
- **EC-166** Entry entirely inside 12:00 to 1:00 PM counts 0 h (Q-125 on whether it's allowed).
- **EC-167** Timer running across lunch: the lunch part isn't counted, whether it's stopped by hand or by Switch (FR-ACT-26).
- **EC-168** Auto-stopped timer (23:59) that spans lunch: lunch taken out.
- **EC-169** Hours-only entries (FR-TIME-01, no time in / out; FR-ACT-05): there is no clock time to compare with lunch (Q-124).
- **EC-170** Editing an old entry after the change (time in or out changed): whether it gets the lunch rule depends on Q-120 (Lean's suggestion: yes).
- **EC-171** Entry on a locked day (FR-TIME-04): can't be edited, so no recalculation by the user.
- **EC-172** My tasks with 0 rows: no # shown (empty state as today).
- **EC-173** Page size change: # restarts from the new page's first position, still continuous (FR-TSK-36).
- **EC-174** A follow-up is deleted or edited (if allowed today): the count follows what exists; an edit doesn't re-highlight (A-40).
- **EC-175** User loses access to a project: its badges disappear with the task rows (FR-NTF-13).

## 11. Assumptions
- **A-36** The lunch window is Philippine time (Asia/Manila), as all tracker times are (FR-ACT-09). Lean didn't say otherwise.
- **A-37** "Tasks after it in the project" means the project-wide `order`, as the checklist # shows today (FR-TSK-11), not numbering within a phase.
- **A-38** A user's own follow-up is seen by them (FR-NTF-12), in line with FR-NTF-01 not notifying the writer.
- **A-39** The 24-hour cap and weekly totals use counted hours (after lunch), because there is one hours value (FR-ACT-40).
- **A-40** Editing a follow-up doesn't make it unseen again; only a new follow-up does.
- **A-41** Mobile is out of scope. If the mobile app shows the same lists, it reads the same server hours (lunch included) but gets no badge or # until a later change.

## 12. Decisions and open questions
| ID | Question | Status / proposed default | Who |
|---|---|---|---|
| **Q-120** | Should time logged **before** this change be recalculated with lunch taken out, or keep its current hours? | **Open.** Lean's suggestion (proposed default): **only new and edited entries** get the lunch rule, so totals already sent in DARs don't shift. | **Jomerson** |
| Q-121 | My tasks #: which tabs show it (all list tabs, or also Day timesheet?), where the column sits, and how it shows on phone cards? | Open. UIE to design; no default proposed. | UIE, Lean |
| Q-122 | My tasks paging: no paging was found in `GET /tasks/mine`. Is there paging (or a "show more") today, and what's the page size? FR-TSK-36 only matters if there is. | Open. Deven to confirm. | Deven |
| Q-123 | Follow-up "seen": does opening the task (drawer) count, or only opening the follow-up thread? Does clicking the bell notification (FR-NTF-03) also count as seen? Which follow-ups are counted (all, or only open ones if follow-ups can be closed)? | Open. No default proposed. | Lean |
| Q-124 | Lunch for **hours-only** entries (FR-TIME-01, no time in/out): they have no clock time, so the rule can't apply. Leave them as typed? And should the renumber (FR-TSK-31/33) be audited, and how? | Open. No default proposed. | Lean |
| Q-125 | An entry entirely inside 12:00 to 1:00 PM counts 0 h. Allow it to save (0 h), or refuse it with a message? Should the screen show the lunch deduction on the row? | Open. No default proposed. | Lean, UIE |

## 13. Status
- **Draft v0.1.** Awaiting **Jomerson** on **Q-120** and his overall OK. Q-121 to Q-125 wait on Lean, Deven or UIE as listed.
- **Build:** Deven builds on **one branch off `main`**; no push until Jomerson OKs.
- **One-time renumber** (FR-TSK-33) runs on live only with Jomerson's OK.
- **Design:** UIE designs the My tasks # column and the follow-up badge (normal and highlighted).
- **Test:** Queen's cases are AC-64.x to AC-67.x (delete then renumber, numbering across pages, badge seen state, entries that cross 12:00 to 1:00).
- Once approved: FR-TSK-31 to 36 go into doc 12 / doc 14, FR-NTF-09 to 13 into doc 12, FR-ACT-37 to 42 into doc 14, US/AC into docs 04/05, EC into doc 08, NFR into doc 07, Q-120 to Q-125 into doc 09.

### Conflicts with existing requirements
- **FR-TSK-11:** # stays the stored order; FR-TSK-31 adds the close-up on delete. No conflict, an amendment.
- **FR-ACT-02 / FR-ACT-10:** "computed hours" and "Hours rendered = sum of the time in/out pairs" become duration **minus lunch**. Reworded once approved.
- **FR-TIME-07, FR-ACT-34, FR-WL-01, FR-DAR-08:** totals change for new entries. With Q-120's default, a week can mix old (with lunch) and new (without lunch) entries.
- **FR-NTF-03:** clicking a notification marks the *notification* read; the badge's seen state is separate unless Q-123 links them.
- **FR-TSK-26:** column order (Task, Project, Role, Planned, Due, Est / Act, Status) gains # (placement per Q-121).
