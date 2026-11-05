# CR-20 — Task order numbers without gaps, # column in My tasks, follow-up badge, lunch break on the Day timesheet

**Status:** v0.2.4 draft (2026-11-05, SGT; v0.2.3, v0.2.2, v0.2.1, v0.2 and v0.1 earlier same day) · **Author:** Business Analyst (Rich) · **For:** Jomerson (approval), Lean, Deven, Queen, UIE
**Requested by:** Jomerson (lead dev / product owner), 2026-11-05. **Rules locked by:** Lean (tech lead), 2026-11-05 PM room. Rules marked **Locked** are Lean's. Anything not locked is listed as an assumption (§11) or an open question (§12). Nothing here adds a product decision beyond what Lean locked.
**Part of:** doc 17 (change requests). CR-20 is summarised in `17_CHANGE_REQUESTS.md` and specified in full here. It follows CR-19 and uses the next free IDs: **FR-TSK-31 to FR-TSK-36**, **FR-NTF-09 to FR-NTF-13** (FR-NTF-07 and 08 are reserved in doc 17 §3), **FR-ACT-37 to FR-ACT-42**, **US-64 to US-67**, **AC-64.x to AC-67.x**, **EC-162 to EC-175**, **NFR-43 to NFR-46**, **Q-120 to Q-125**, **A-36 to A-41**.
**Checked against:** docs 01 to 17 (with CR-19), and the build at `main` `dfa1f38` (merge of PR #46).
**Not built.** This is a new request, not a PR review.
**UI reference:** Locked UI / UIE design notes in §4 (# column) and §5 (badge); UIE confirmed keep `Lunch 1h 00m not counted` (FR-ACT-37a). Mockup: `docs/design/mockup/index-v0.9.18.html` (`#cr20tasks`, `#cr20check`, `#cr20sheet`); spec note: `docs/design/CR20_TASK_INDEX_FOLLOWUP_UI.md`. No UI beyond what Lean / UIE locked.

**Doc change log:**
- v0.2.4 (2026-11-05, SGT): **Pre-release follow-up seen cutoff (Lean + Deven) and Day-timesheet-only 8–5.** Follow-ups posted before the release count as already seen: one app-wide cutoff time, written once when the release first starts; no seen rows created per user (FR-NTF-11b). Unseen = posted after both the cutoff and the user's `seenAt`, and not written by the reader; no `seenAt` row = unset (FR-NTF-10a). Seen state in its own `followUpSeen` collection `{ userId, taskId, seenAt }`, unique on `userId + taskId`, marked via `POST /tasks/:id/follow-ups/seen`; opening the follow-ups list, arriving from `?task=`, or opening the task panel / badge moves `seenAt` to now (FR-NTF-11, FR-NTF-11a). My tasks # on Today and Due counts 1…n across both sections of the tab (FR-TSK-35a). 8:00 AM–5:00 PM default applies **only** to new Day timesheet entries; **Add quick activity keeps its current times** (FR-ACT-37b). Add entry form live helper `Counts as 8h 00m. Lunch 1h 00m not counted.` replaces any fixed lunch line (FR-ACT-37c); timer pill shows muted `Lunch, not counting` while running inside lunch (FR-ACT-39b). `lunchMinutes` still returned, not stored. Adds AC-65.7, AC-66.8 to 66.12, AC-67.20 to 67.23, EC-174a/174b, A-38a. **Q-120 stays open.** No IDs renumbered.
- v0.2.3 (2026-11-05, SGT): **Deven wording + UIE UI notes.** `lunchMinutes` is **not stored** on the entry; the API **computes and returns** it when returning the entry (time between in/out minus the stored minutes). Older entries return 0 with **no migration** (FR-ACT-42a, AC-67.11, AC-67.17). **Q-120 stays open.** Locked UI / UIE design notes: # column (~48px, header `#`, right-aligned, `text-body-secondary` tabular, not sortable; on 390 muted `#12` before the title); badge right after the task title (`badge rounded-pill` + `bx-message-rounded-dots` + count; unseen `bg-label-warning` + dot / seen `bg-label-secondary`; hidden at 0; click opens that task's follow-ups). UIE confirmed keep `Lunch 1h 00m not counted`. No IDs renumbered.
- v0.2.2 (2026-11-05, SGT): **Matches Deven's build** (local `346d52d`, branch `fix/nov5-tasks-timesheet`, items 1 and 4). Entirely-inside-lunch refusal returns code `LUNCH_BREAK` (FR-ACT-38a). Each entry stores `lunchMinutes` derived from its times; older entries show 0, so nothing changes for them unless Q-120 is answered yes (FR-ACT-42a; Q-120 stays open). Day timesheet shows `Lunch 1h 00m not counted` under the hours (FR-ACT-37a). Lunch also taken out of the running timer's live count (FR-ACT-39a); 24 h cap on reduced minutes (FR-ACT-41, already). Confirmed already covered: renumber all 1…n in one transaction, [12:00, 13:00) Manila every day, defaults 8–5, hours-only as typed. Adds AC-67.16 to 67.19. No IDs renumbered; no new product decisions.
- v0.2.1 (2026-11-05, SGT): **Lean's audit call.** Day-to-day delete renumber: the existing delete audit covers it, no extra audit (confirmed by Lean). One-time renumber on live (FR-TSK-33): one audit entry per project it changes, listing old and new numbers, so it can be traced or undone. FR-TSK-34 and Q-124 updated; AC-64.8 added. No IDs renumbered.
- v0.2 (2026-11-05, SGT): **Lean's technical locks (PM room).** Renumber is per project: every delete renumbers all remaining tasks 1…n in one transaction (also cleans old gaps/duplicates). My tasks # is a plain row count, no paging. Badge shows the total, highlighted (amber with a dot, UIE) while any are unseen; seen = opening the task's follow-ups list; own posts seen; notifications alone don't count. Lunch every day incl. weekends/holidays, half-open [12:00, 13:00) Manila; entries entirely inside lunch refused; row shows the deduction; daily cap on reduced minutes; hours-only entries not deducted. **Q-121 to Q-125 closed.** Only Q-120 (Jomerson) open. AC-65.4 and EC-173 marked N/A (no paging); AC/EC added for refusal and boundaries.
- v0.1 (2026-11-05, SGT): first draft. Four items from Jomerson, rules locked by Lean. Q-120 (recalculate old time with lunch taken out?) waits on Jomerson. Q-121 to Q-125 are gaps found while writing, waiting on Lean, Deven or UIE.

## 0. What the build has today (baseline)
| Topic | As built | Evidence |
|---|---|---|
| Checklist # | The project checklist shows a **#** column, filled from the task's stored `order` field (FR-TSK-11). The same `#{order}` label appears in the task pickers (documents, conversations, task form). | `apps/web/src/pages/projects/ProjectTabs.tsx:295`, `:326`, `:962`; `DocumentRequestModals.tsx:167`; `ConversationTab.tsx:225`; `TaskFormModal.tsx:386` |
| Task `order` | A number on each task, default 0, indexed with `projectId`. Lists sort by it. | `apps/api/src/models/Task.ts:9`, `:89`; `apps/api/src/routes/tasks.ts:124`, `:623` |
| Task delete | **Hard delete** (`deleteOne`) in a transaction, only by the Project PM or an Admin (FR-PRJ-21), refused with 409 if anything is attached (`ACTIVITY_IN_USE`, `TASK_HAS_RECORDS`). **The other tasks' `order` isn't touched**, so a gap is left (the bug behind this CR). | `apps/api/src/routes/tasks.ts:1445-1470` |
| My tasks | Tabs per FR-TSK-22 / FR-TSK-28. Columns per FR-TSK-26 (Task, Project, Role, Planned, Due, Est / Act, Status). **No # column.** `GET /tasks/mine` has **no paging** (Q-122 closed). | `apps/web/src/pages/MyTasksPage.tsx`; `apps/api/src/routes/tasks.ts:899` |
| Follow-up notifications | In-app notification to owner, assignees, reviewer and PM, except the writer (FR-NTF-01 to 06, US-40, AC-40.1, BR-25). Clicking the notification marks **the notification** read (FR-NTF-03). **No follow-up count on task rows and no per-user "seen" state for follow-ups.** | doc 12 §FR-NTF; `apps/api/src/routes/notifications.ts` |
| Day timesheet defaults | Manual entries take time in and time out (FR-ACT-10). **No default 8:00 AM / 5:00 PM** found in the code. | doc 14 FR-ACT-10; no default in `apps/web/src` |
| Lunch | **No lunch deduction.** Hours = time out minus time in (`minutes / 60`), for the timer and manual entries. | `apps/api/src/routes/tracker.ts:436`, `:523`; doc 14 FR-ACT-02, FR-ACT-10 |
| Time zone | Time in/out is in Philippine time (FR-ACT-09); "today" in Asia/Manila (FR-TSK-21). | doc 14 FR-ACT-09; doc 12 FR-TSK-21 |

*Code evidence is from a read of `main`, not a run. Deven to confirm the notification model before building.*

## 1. Summary
Four fixes Jomerson asked for, as Lean defined them:
1. **No gaps in task numbers.** Deleting a task renumbers **all** the project's remaining tasks 1 to n in their current order, in the same transaction, which also cleans any old gaps or duplicates in that project. A separate one-time renumber of every project runs on live only with Jomerson's OK.
2. **# in My tasks.** First column, every tab: a plain row count 1 to n in the current sort and filter. No paging today.
3. **Follow-up badge.** Notifications unchanged. Task rows in the checklist and My tasks show the **total** follow-up count, highlighted (amber with a dot) while any are unseen by you. Opening the task's follow-ups list marks them all seen; your own follow-ups are seen from the start.
4. **Lunch break.** Every day, weekends and holidays included. The half-open window [12:00, 13:00) Manila time isn't counted, so 8:00 AM to 5:00 PM is 8 hours. Entries entirely inside lunch are refused. Hours-only entries are not deducted.

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
- No configurable working hours or lunch setting (not asked for).

## 3. Task order numbers without gaps (Locked, Lean, 2026-11-05)
- **FR-TSK-31 (Must)** Numbering is **per project** (the project-wide `order`). When a task is deleted, **all** of that project's remaining tasks are renumbered **1 to n in their current order** (sorted by existing `order`), **inside the same transaction** as the delete. This also cleans any existing gaps or duplicate numbers in that project the next time anyone deletes one of its tasks. Amends FR-TSK-11 (the # shown stays the stored order).
- **FR-TSK-32 (Must)** If the delete is refused (403, 404, 409 `ACTIVITY_IN_USE`, 409 `TASK_HAS_RECORDS`), **no number changes**.
- **FR-TSK-33 (Must)** A **one-time renumber** closes gaps in projects that already have them, keeping the current order. It runs on **live only with Jomerson's OK**. It's run once, can be run again safely (a project with no gaps is left as is), and reports how many projects and tasks it changed.
- **FR-TSK-34 (Must)** The renumber (both FR-TSK-31 and FR-TSK-33) changes only the order number. It doesn't change the task, its version for other fields, its links or its history. Audit (Locked, Lean 2026-11-05): for the day-to-day delete renumber (FR-TSK-31), no extra audit; the delete's existing audit entry covers it. For the one-time renumber (FR-TSK-33), write **one audit entry per project it changes**, listing each task's **old and new number**, so the change can be traced or undone. Projects it leaves unchanged get no entry.
- **Effect to note:** the same `#{order}` label is used in the task pickers (§0), so numbers there shift too. Anyone who wrote "task #5" in a note or DAR will find a different task at #5 after a delete. That is the expected result of the rule, not a defect.

## 4. # column in My tasks (Locked, Lean, 2026-11-05)
- **FR-TSK-35 (Must)** My tasks gets a **#** column, the **first column, left of the task name, in every My tasks tab** (Locked, Q-121). It is a plain row count **1 to n in the current sort and filter**. It is a **row position**, not the task's project order number (FR-TSK-11), and it is recalculated when the sort, filter or tab changes. Amends FR-TSK-26 (column list) and FR-TSK-13.
- **FR-TSK-35a (Must, Locked Lean 2026-11-05)** On the **Today** and **Due** tabs, which each have two sections, the # keeps counting **across both sections of the tab** (1…n per tab), not restarting per section.
- **FR-TSK-36 (Must)** My tasks has **no paging**: the # runs 1 to n over each tab's whole filtered list (Q-122 closed). *Note for later:* if paging is ever added, numbering across pages becomes a new requirement then; it is not one now.
- **Locked UI / UIE design notes (# column):** first column, about **48px**, header **`#`**, **right-aligned**, `text-body-secondary` with **tabular numbers**, **not sortable**. On **390** it shows as a muted **`#12`** before the title.

## 5. Follow-up count badge (Locked, Lean, 2026-11-05)
- **Unchanged:** FR-NTF-01 to 06, US-40 and AC-40.1. People on a task still get an in-app notification when a follow-up is added.
- **FR-NTF-09 (Must)** Each task row in the **project checklist** and in **My tasks** shows a badge with the **total number of follow-ups** on the task. No follow-ups: no badge.
- **FR-NTF-10 (Must)** The badge is **highlighted** while **any** follow-up on the task is **unseen by the signed-in user**. UI (UIE): **amber with a dot** while unseen; plain otherwise (count still shown). See Locked UI / UIE design notes below.
- **FR-NTF-10a (Must, Locked Lean + Deven 2026-11-05)** A follow-up is **unseen** by a user only if it was posted **after both** the app-wide cutoff (FR-NTF-11b) **and** that user's `seenAt` for the task, **and** the user didn't write it (FR-NTF-12). If the user has **no `seenAt` row** for the task yet, `seenAt` is treated as unset (before any post), so follow-ups posted after the cutoff count as unseen until the user opens them.
- **FR-NTF-11 (Must)** "Seen" is **per user per task**. It is set (`seenAt` moved up to now) when the user **opens that task's follow-ups list**, **arrives from a `?task=` link**, or **opens the task panel / clicks the badge**, which marks **every** follow-up there as seen. A **notification alone doesn't count** (clicking the bell marks only the notification read, FR-NTF-03). One user's seen state never changes anyone else's.
- **FR-NTF-11a (Must, Deven)** Seen state is stored in its own collection **`followUpSeen`**: one record per user per task `{ userId, taskId, seenAt }`, **unique index on `userId + taskId`**. The web app marks seen via **`POST /tasks/:id/follow-ups/seen`** (or equivalent), which upserts the record with `seenAt` = now.
- **FR-NTF-11b (Must, Locked Lean + Deven 2026-11-05)** **Follow-ups posted before the release count as already seen.** The app stores **one cutoff time for the whole app**, written **once** when the release first starts (not changed by later restarts). **No seen rows are created for users at release.**
- **FR-NTF-12 (Must)** A user's **own follow-ups are seen by them from the start**. Notification recipients unchanged (FR-NTF-01).
- **FR-NTF-13 (Must)** The badge follows access at read time, the same as FR-NTF-04: a user only sees counts for tasks they can see.
- **Locked UI / UIE design notes (badge):** right after the task title, `badge rounded-pill` with `bx-message-rounded-dots` and the count. **Unseen:** `bg-label-warning` plus a small dot, aria-label like `"3 follow-ups, 1 new"`. **Seen:** `bg-label-secondary`, aria-label `"3 follow-ups"`. **Hidden at 0.** Clicking opens that task's follow-ups.

## 6. Day timesheet defaults and lunch break (Locked, Lean, 2026-11-05)
- **FR-ACT-37 (Must)** The standard day is **8:00 AM to 5:00 PM**. On the Day timesheet, a new manual entry defaults to **time in 8:00 AM** and **time out 5:00 PM**. The user can change both before saving. The saved entry row **shows the lunch time taken off**. Amends FR-ACT-10.
- **FR-ACT-37b (Must, Locked Lean; confirmed Deven)** The 8:00 AM–5:00 PM default applies **only to new Day timesheet entries**. **Add quick activity does not get it**; it keeps its current empty / current times.
- **FR-ACT-37c (Must, Locked UI / UIE)** The Add entry form shows a **live helper** under the times, e.g. `Counts as 8h 00m. Lunch 1h 00m not counted.`, updated as the times change. It replaces any fixed `12:00–1:00 PM is lunch…` line.
- **FR-ACT-37a (Must, as built `346d52d`)** The Day timesheet shows a line under the hours: **`Lunch 1h 00m not counted`**. The minutes follow the entries' actual lunch overlap (e.g. `Lunch 0h 30m not counted` for 11:30 AM to 12:30 PM); no line when the overlap is 0. **UIE confirmed** keep this wording.
- **FR-ACT-38 (Must)** **Lunch window is half-open [12:00, 13:00) Manila time**, applied **every day, weekends and holidays included**. For any entry with a time in and time out, hours = (time out − time in) minus its overlap with [12:00, 13:00). An entry ending at 12:00 or starting at 1:00 PM loses nothing. A full 8:00 AM to 5:00 PM entry is **8 hours**. Computed **on save / timer stop**.
- **FR-ACT-38a (Must)** An entry **entirely inside** [12:00, 13:00) is **refused**, nothing saved, with error code **`LUNCH_BREAK`** and the message: `This time is inside the 12:00–1:00 PM lunch break.` (Q-125 closed; code as built `346d52d`.)
- **FR-ACT-38b (Must)** **Hours-only entries** (FR-TIME-01, no time in/out): **nothing deducted**; the hours typed are taken as already excluding lunch. (Q-124 closed.)
- **FR-ACT-39 (Must)** The rule applies to **manual entries and the timer** (FR-ACT-02) the same way, including auto-stopped timers (FR-ACT-04).
- **FR-ACT-39a (Must, as built `346d52d`)** While the timer is **running**, its live count also leaves out the lunch overlap so far, so the live count matches what will be saved on stop.
- **FR-ACT-39b (Must, Locked UI / UIE)** While a running timer is inside [12:00, 13:00), the timer pill shows a muted **`Lunch, not counting`** next to the time.
- **FR-ACT-40 (Must)** **Reports use the same hours**: Hours rendered (FR-ACT-10), task actual hours (FR-TIME-07), weekly totals (FR-ACT-34), Team & workload Recorded (FR-WL-01) and the DAR (FR-DAR-08). There is one stored hours value and every screen reads it.
- **FR-ACT-41 (Must)** The daily cap (FR-TIME-03) and other hour checks run on the **reduced** minutes (after lunch is taken out), never raw duration.
- **FR-ACT-42 (Must)** Time logged **before** this change: **not decided** (Q-120). Until Jomerson answers, the build must not recalculate existing entries.
- **FR-ACT-42a (Must, as built `346d52d`)** **`lunchMinutes` is not stored** on the entry. The API **computes and returns** it **on each entry** when returning the entry: time between in/out minus the stored minutes (0 for hours-only). **Older entries return 0 with no migration** and keep their hours. This is how the build behaves **until Q-120 is decided** (Lean's suggested default); if Jomerson answers yes, old entries get recalculated then. **Q-120 stays open.**

## 7. User stories
- **US-64** As a PM, I want task numbers to close up after I delete a task, so the checklist reads 1 to n without gaps.
- **US-65** As a team member, I want a # on each My tasks row, so I can refer to a row by number in the order I'm looking at.
- **US-66** As someone on a task, I want to see how many follow-ups it has and whether any are new to me, without opening every task.
- **US-67** As a team member, I want the Day timesheet to start at 8:00 AM to 5:00 PM and leave lunch out, so a normal day comes to 8 hours without me working it out.

## 8. Acceptance criteria
**US-64 — renumber**
- **AC-64.1 (API)** Project with tasks #1 to #5. The PM deletes #3. In the same response cycle the checklist shows the old #4 as #3 and the old #5 as #4; there is no #5. (FR-TSK-31)
- **AC-64.1a (API)** Project already stored as 1, 2, 2, 5, 9. Deleting any one task leaves the rest numbered 1 to n in their prior order, no gap, no duplicate. (FR-TSK-31)
- **AC-64.2 (API)** Deleting the last task (#5) leaves #1 to #4 unchanged. (EC-162)
- **AC-64.3 (API)** Deleting #1 moves every other task up by one.
- **AC-64.4 (API)** A delete refused with 409 `ACTIVITY_IN_USE` leaves every number unchanged. (FR-TSK-32)
- **AC-64.5 (API)** Two deletes in the same project at the same time: afterwards numbers are still 1 to n with no gap and no duplicate. (EC-163, NFR-43)
- **AC-64.6 (script)** On a copy of live data, the one-time renumber turns a project numbered 1, 2, 4, 7 into 1, 2, 3, 4 in the same order; a project with no gaps is unchanged; running it a second time changes nothing. (FR-TSK-33)
- **AC-64.8 (script)** The one-time renumber on a copy of live data writes exactly one audit entry for each project it changed, listing every changed task's old and new number (e.g. 4→3, 7→4); an unchanged project, or a second run, writes none. A delete's renumber writes no audit entry beyond the delete's own. (FR-TSK-33, FR-TSK-34)
- **AC-64.7 (UI)** After a delete, the task pickers (documents, conversations, task form) show the new numbers.

**US-65 — My tasks #**
- **AC-65.1 (UI)** A tab with 7 rows shows # 1 to 7 top to bottom.
- **AC-65.2 (UI)** Changing the sort renumbers rows 1 to n in the new order; the # follows the row position, not the task.
- **AC-65.3 (UI)** A filter that leaves 3 rows shows # 1 to 3.
- **AC-65.4** N/A: no paging (FR-TSK-36). Queen dropped across-pages cases.
- **AC-65.6 (UI)** In every My tasks tab, # is the first column, left of the task name; about 48px, header `#`, right-aligned, `text-body-secondary` tabular numbers, not sortable; on 390 a muted `#12` before the title. (FR-TSK-35; Locked UI / UIE)
- **AC-65.7 (UI)** Today tab with 3 rows in its first section and 2 in its second: # shows 1 to 5, not 1–3 then 1–2. Same on Due. (FR-TSK-35a)
- **AC-65.5 (UI)** The My tasks # is not the project order: a task that is #4 in its project may show as #1 in My tasks.

**US-66 — follow-up badge**
- **AC-66.1 (UI)** A task with 2 follow-ups the user has seen shows a plain badge "2" (total count).
- **AC-66.2 (UI)** Another person adds a follow-up: the badge shows 3 and is highlighted, on both the checklist row and the My tasks row; the bell notification also arrives (AC-40.1 unchanged).
- **AC-66.2a (UI)** Badge sits right after the task title (`badge rounded-pill` + `bx-message-rounded-dots` + count). Unseen: `bg-label-warning` plus a small dot, aria-label like "3 follow-ups, 1 new". Seen: `bg-label-secondary`, aria-label "3 follow-ups". Hidden at 0. Click opens that task's follow-ups. (FR-NTF-09, FR-NTF-10; Locked UI / UIE)
- **AC-66.3 (UI)** The user opens the task's follow-ups list (all marked seen): the badge stays 3 and is no longer highlighted, on both screens, after refresh or page focus.
- **AC-66.4 (API)** User A opening the follow-up doesn't change user B's highlight. (FR-NTF-11)
- **AC-66.5 (UI)** The writer of a follow-up doesn't see their own new follow-up as highlighted. (FR-NTF-12)
- **AC-66.6 (UI)** A task with no follow-ups shows no badge.
- **AC-66.7 (UI)** Clicking the bell notification alone doesn't clear the highlight. (FR-NTF-11)
- **AC-66.8 (API)** A task whose follow-ups were all posted before the cutoff shows a plain (seen) badge for every user, with no `followUpSeen` rows existing. (FR-NTF-11b)
- **AC-66.9 (API)** User with no `followUpSeen` row for a task: a follow-up by someone else posted after the cutoff makes the badge highlighted. (FR-NTF-10a)
- **AC-66.10 (API)** `POST /tasks/:id/follow-ups/seen` twice leaves one record for that user and task, `seenAt` = latest call. (FR-NTF-11a)
- **AC-66.11 (UI)** Arriving from a `?task=` link or opening the task panel / badge clears the highlight, same as opening the follow-ups list. (FR-NTF-11)
- **AC-66.12 (API)** Restarting the app after release doesn't change the cutoff time. (FR-NTF-11b)

**US-67 — defaults and lunch** (all times Philippine time)
- **AC-67.1 (UI)** New manual entry on the Day timesheet opens with time in 8:00 AM and time out 5:00 PM.
- **AC-67.2 (API)** 8:00 AM to 5:00 PM = **8.00 h**.
- **AC-67.3 (API)** 8:00 AM to 12:00 PM = 4.00 h (ends at 12:00, nothing taken out).
- **AC-67.4 (API)** 1:00 PM to 5:00 PM = 4.00 h (starts at 1:00 PM, nothing taken out).
- **AC-67.5 (API)** 11:30 AM to 12:30 PM = **0.50 h** (crosses into lunch).
- **AC-67.6 (API)** 12:30 PM to 2:00 PM = **1.00 h** (starts inside lunch).
- **AC-67.7 (API)** 12:15 PM to 12:45 PM (or 12:00 to 1:00 PM exactly), entirely inside lunch: **refused**, nothing saved, message `This time is inside the 12:00–1:00 PM lunch break.` (FR-ACT-38a, EC-166)
- **AC-67.8 (API)** Timer started 11:00 AM, stopped 2:00 PM = 2.00 h. (FR-ACT-39)
- **AC-67.9 (API)** Timer started 8:00 AM and auto-stopped at 23:59 (FR-ACT-04): 15 h 59 min of clock time minus 1 h lunch = **14 h 59 min** counted. (EC-168)
- **AC-67.10 (API)** Hours rendered, task actual hours, weekly totals, Team & workload and the DAR all show the same hours for an entry. (FR-ACT-40)
- **AC-67.12 (API)** A Saturday or holiday entry 8:00 AM to 5:00 PM = 8.00 h (lunch applies every day).
- **AC-67.13 (UI)** An 8:00 AM to 5:00 PM row shows the 1 h lunch deduction.
- **AC-67.14 (API)** Daily cap checks use reduced minutes: entries totalling 25 h clock time with 1 h lunch overlap (24 h counted) pass the 24 h cap.
- **AC-67.15 (API)** Hours-only entry of 8 h saves as 8.00 h, nothing deducted. (FR-ACT-38b)
- **AC-67.11 (API)** An entry saved before the change keeps its hours; when the API returns it, `lunchMinutes` is **0** (computed on return; **no migration**; until Q-120 is answered). (FR-ACT-42, FR-ACT-42a)
- **AC-67.16 (API)** The refusal in AC-67.7 returns error code `LUNCH_BREAK` with the exact message. (FR-ACT-38a)
- **AC-67.17 (API)** When the API returns the entry, an 8:00 AM to 5:00 PM entry has `lunchMinutes` = 60; 11:30 AM to 12:30 PM returns 30; 1:00 PM to 5:00 PM and hours-only return 0. `lunchMinutes` is **not stored**. (FR-ACT-42a)
- **AC-67.18 (UI)** Day with an 8:00 AM to 5:00 PM entry shows `Lunch 1h 00m not counted` under the hours; a day with no lunch overlap shows no line. (FR-ACT-37a)
- **AC-67.20 (UI)** Add quick activity opens with its current times, **not** 8:00 AM / 5:00 PM. (FR-ACT-37b)
- **AC-67.21 (UI)** Add entry form with 8:00 AM to 5:00 PM shows `Counts as 8h 00m. Lunch 1h 00m not counted.`; changing time out to 12:00 PM updates it to `Counts as 4h 00m.` with no lunch part. No fixed lunch line. (FR-ACT-37c)
- **AC-67.22 (UI)** Timer running at 12:20 PM: pill shows muted `Lunch, not counting` next to the time; at 1:00 PM it goes away. (FR-ACT-39b)
- **AC-67.23 (API)** `lunchMinutes` is still returned and not stored (unchanged from v0.2.3). (FR-ACT-42a)
- **AC-67.19 (UI)** Timer started 11:00 AM, still running at 1:30 PM: the live count shows 1h 30m, not 2h 30m. (FR-ACT-39a)

## 9. Non-functional
- **NFR-43 (Must)** The delete and the renumber of all the project's remaining tasks run in **one transaction**. Concurrent deletes in one project never leave a gap or a duplicate number.
- **NFR-44 (Must)** The one-time renumber (FR-TSK-33) is a script or migration that is safe to re-run, has a dry-run mode that lists the changes, and runs on live only after Jomerson's OK.
- **NFR-45 (Must)** The lunch window **[12:00, 13:00)** is in **Philippine time (Asia/Manila, UTC+8)**, the same as FR-ACT-09 and FR-TSK-21 (A-36). The server computes the hours; the web app may show a preview but doesn't set them.
- **NFR-46 (Should)** Follow-up counts and seen state come back with the task lists (checklist and `GET /tasks/mine`) without one extra request per row.

## 10. Edge cases
- **EC-162** Delete the last task: nothing else moves.
- **EC-163** Two deletes in the same project at the same time: result is 1 to n (NFR-43).
- **EC-164** A task is created or moved (Move up / Move down) while another is being deleted: numbers still end 1 to n, no duplicates.
- **EC-165** Delete is a **hard delete** today (§0). If soft delete is ever added, the soft-deleted task must leave the numbering too. Not in scope now.
- **EC-166** Entry entirely inside [12:00, 13:00) is refused with the lunch message; nothing saved.
- **EC-167** Timer running across lunch: the lunch part isn't counted, whether it's stopped by hand or by Switch (FR-ACT-26); the live count while running also leaves it out (FR-ACT-39a).
- **EC-168** Auto-stopped timer (23:59) that spans lunch: lunch taken out.
- **EC-169** Hours-only entries (FR-TIME-01, no time in / out; FR-ACT-05): nothing deducted; hours taken as already excluding lunch.
- **EC-170** Editing an old entry after the change (time in or out changed): whether it gets the lunch rule depends on Q-120 (Lean's suggestion: yes).
- **EC-171** Entry on a locked day (FR-TIME-04): can't be edited, so no recalculation by the user.
- **EC-172** My tasks with 0 rows: no # shown (empty state as today).
- **EC-173** N/A: no paging (FR-TSK-36).
- **EC-174** A follow-up is deleted or edited (if allowed today): the count follows what exists; an edit doesn't re-highlight (A-40).
- **EC-174a** A follow-up posted exactly at the cutoff time counts as seen (unseen needs *after* the cutoff).
- **EC-174b** A user's `seenAt` is earlier than the cutoff (e.g. clock skew): the cutoff still applies; only posts after both count.
- **EC-175** User loses access to a project: its badges disappear with the task rows (FR-NTF-13).

## 11. Assumptions
- **A-36** The lunch window is Philippine time (Asia/Manila), as all tracker times are (FR-ACT-09). Lean didn't say otherwise.
- **A-37** Confirmed by Lean (Locked): renumbering is per project on the project-wide `order` (FR-TSK-11), not within a phase.
- **A-38** Confirmed by Lean (Locked): own follow-ups are seen from the start (FR-NTF-12).
- **A-38a** Confirmed by Lean + Deven (Locked): the cutoff is one app-wide value set once at first release start; no per-user rows are backfilled (FR-NTF-11b).
- **A-39** Confirmed by Lean (Locked): the daily cap runs on reduced minutes (FR-ACT-41).
- **A-40** Editing a follow-up doesn't make it unseen again; only a new follow-up does.
- **A-41** Mobile is out of scope. If the mobile app shows the same lists, it reads the same server hours (lunch included) but gets no badge or # until a later change.

## 12. Decisions and open questions
| ID | Question | Status / proposed default | Who |
|---|---|---|---|
| **Q-120** | Should time logged **before** this change be recalculated with lunch taken out, or keep its current hours? | **Open.** Lean's suggestion (proposed default): **only new and edited entries** get the lunch rule, so totals already sent in DARs don't shift. **Build (`346d52d`) behaves this way until decided:** older entries **return** `lunchMinutes` = 0 with **no migration** (FR-ACT-42a). | **Jomerson** |
| Q-121 | My tasks #: tabs and placement. | **Closed (Lean, 2026-11-05):** first column, left of the task name, in every My tasks tab. | Lean |
| Q-122 | My tasks paging? | **Closed (Lean):** no paging; # runs 1…n over each tab's filtered list. Across-pages dropped. | Lean |
| Q-123 | What counts as "seen"? | **Closed (Lean):** opening the task's follow-ups list marks every follow-up there seen; a notification alone doesn't count; own follow-ups seen from the start. Badge shows total count. | Lean |
| Q-124 | Lunch for hours-only entries; renumber audit. | **Closed (Lean):** hours-only entries have nothing deducted (hours typed already exclude lunch). Renumber: no extra audit for the delete renumber (delete's audit covers it); v0.2.1: the one-time renumber writes one audit entry per changed project with old and new numbers (FR-TSK-34). | Lean |
| Q-125 | Entry entirely inside lunch; show deduction? | **Closed (Lean):** refused, nothing saved, message `This time is inside the 12:00–1:00 PM lunch break.` Row shows the lunch deduction. | Lean |

## 13. Status
- **Draft v0.2.4**: pre-release follow-up seen cutoff and `followUpSeen` storage locked (Lean + Deven); 8–5 default Day timesheet only (not quick activity); live helper and timer pill noted. v0.2.3 base: matched to Deven's build `346d52d`; `lunchMinutes` returned not stored; UIE # and badge notes recorded. Awaiting **Jomerson** on **Q-120** and his overall OK. Q-121 to Q-125 closed by Lean (2026-11-05).
- **Build:** Deven builds on **one branch off `main`**; no push until Jomerson OKs.
- **One-time renumber** (FR-TSK-33) runs on live only with Jomerson's OK.
- **Design (Locked UI / UIE):** # first column (~48px, right-aligned tabular `#`); badge after title (`rounded-pill` + icon + count; warning+dot unseen / secondary seen); keep `Lunch 1h 00m not counted`; Add entry live helper; timer pill `Lunch, not counting`. Mockup `docs/design/mockup/index-v0.9.18.html`.
- **Test:** Queen's cases are AC-64.x to AC-67.x (delete then renumber, badge seen state, entries that cross or sit inside [12:00, 13:00), refusal message; across-pages cases dropped).
- Once approved: FR-TSK-31 to 36 go into doc 12 / doc 14, FR-NTF-09 to 13 into doc 12, FR-ACT-37 to 42 into doc 14, US/AC into docs 04/05, EC into doc 08, NFR into doc 07, Q-120 to Q-125 into doc 09.

### Conflicts with existing requirements
- **FR-TSK-11:** # stays the stored order; FR-TSK-31 adds the close-up on delete. No conflict, an amendment.
- **FR-ACT-02 / FR-ACT-10:** "computed hours" and "Hours rendered = sum of the time in/out pairs" become duration **minus lunch**. Reworded once approved.
- **FR-TIME-07, FR-ACT-34, FR-WL-01, FR-DAR-08:** totals change for new entries. With Q-120's default, a week can mix old (with lunch) and new (without lunch) entries.
- **FR-NTF-03:** clicking a notification marks the *notification* read; the badge's seen state is separate (Q-123 closed: a notification alone doesn't count).
- **FR-TSK-26:** column order (Task, Project, Role, Planned, Due, Est / Act, Status) gains # as the first column (Q-121 closed).
