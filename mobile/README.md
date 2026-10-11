# OpsTrack — Flutter mobile app

*OpsTrack · by Jomerson & Grok.* Phone client for the OpsTrack API (`apps/api`, Express + MongoDB, REST `/api/v1`).
Built from the `pm-mobile-design` handoff: Material 3, indigo seed `#3F51B5` (primary pinned to #3F51B5 in light mode), a `StatusColors` ThemeExtension, and a 390×844 baseline. Includes dark mode.

## Setup
- Flutter stable 3.27+ (built and tested with 3.47.7 / Dart 3.13).
- `cd mobile && flutter pub get`

## Run
```bash
# Demo mode: no backend, in-memory sample data that matches the mockups
flutter run -d chrome

# Against the API
flutter run -d chrome \
  --dart-define=API_BASE_URL=http://localhost:4000/api/v1 \
  --dart-define=WEB_APP_URL=http://localhost:5173

# Release web build
flutter build web --dart-define=API_BASE_URL=https://<api-host>/api/v1
```

### Demo login (demo mode only)
- Any email plus a password of **4+ characters** signs you in as "Jonathan Esmalla".
- A password shorter than 4 characters shows "Email or password is incorrect."
- The password `locked` simulates the sign-in rate limit (429 → SnackBar).
- In demo mode "today" is fixed to Sun 11 Oct 2026, 14:00, so screenshots and tests stay deterministic.

## API configuration
| define | meaning |
|---|---|
| `API_BASE_URL` | Base URL including `/api/v1`. Empty means demo mode (mock repositories). |
| `WEB_APP_URL` | Web app origin. Admin tools, Clients, Change password and task Edit open it via `url_launcher`. |

How the app talks to the API (see `lib/data/api_client.dart`):
- **Auth is a session cookie** set by `POST /auth/login`. The splash screen restores the session with `GET /auth/me`.
  - **Web:** the browser keeps the HttpOnly cookie (`BrowserClient.withCredentials`). The API's CORS allow-list must include the Flutter web origin. Cross-site cookies need `SameSite=None; Secure`, or serve the app from the same site as the API.
  - **Android/iOS:** the client keeps the `Set-Cookie` value in memory and sends it back. It is **not persisted** across app restarts yet (TODO: secure storage).
- Every non-GET request sends `X-Requested-With: xc8-web`, which the API's CSRF guard requires.
- API errors (`{ error: { code, message } }`) become `ApiException` and are shown in SnackBars or inline.

Endpoints used:
- **Auth:** `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/setup-password`
- **Projects:** `/projects`, `/projects/:id`, `/projects/:id/tasks` (GET/POST), `/projects/:id/issues`
- **Tasks:** `/tasks/mine`, `/tasks/:id`, `/tasks/:id/status` (with `reason` for Blocked), `/tasks/:id/unblock`
- **Time:** `/time?week=`, `/time/options`, `POST /time`
- **Notifications and issues:** `/notifications`, `/notifications/read-all`, `/issues`

Status moves follow the API's `TASK_TRANSITIONS` (`allowedTargets` in `lib/data/models.dart`):
- To do → In progress or Blocked
- In progress → Blocked or Done
- Done → In progress
- Blocked → back to its previous status (unblock)
- For review is reached by marking an approval-required task Done. Approvals are decided on the web.

Log time rules: entries go in 0.25h steps, at most 24h per entry and **24h per day**, and **no future dates**. Weeks start on Monday, matching `weekStartOf` in the API.

## Routes (go_router; on web they are hash URLs, e.g. `#/tasks/t4`)
| Route | Screen |
|---|---|
| `/splash`, `/login`, `/setup-password?token=` | Session check, sign-in, invite password setup |
| `/home`, `/projects`, `/tasks?tab=<key>`, `/day`, `/more` | The 5 NavigationBar tabs: Home · Projects · My tasks · Day timesheet · More (StatefulShellRoute). The running timer bar sits above the bar on every tab. |
| `/tasks?tab=today\|day\|due\|assigned\|accountable\|review\|completed` | My tasks (7 tabs). `day` embeds the same Day timesheet widget/state as `/day` |
| `/dar`, `/dar/saved`, `/dar/saved/:id` | Daily Accomplishment Report: generate/preview/save, saved list, saved detail (read-only, no export) |
| `/leave?tab=mine\|team` | Leave: balances + my leave (cancel, half-day merge), team on leave, Record leave sheet |
| `/tasks/:id/edit`, `/tasks/:id/history` | Edit task (PATCH), task history |
| `/projects/:id/time`, `/projects/:id/activity` | Project time and activity (from the project's More tab) |
| `/timesheet-review` | Review a direct report's day (read-only + Reopen) |
| `/projects/new`, `/projects/:id/edit` | New / edit project with Project type |
| `/projects/:id?tab=checklist\|board\|issues\|more` | Project detail; `tab` is honoured even if the project is already open |
| `/projects/:id/tasks/new` | Create task |
| `/tasks/:id` | Task detail (fixed Log time / Change status bar) |
| `/log?task=<id>&project=<id>` | Hours-only form (Day timesheet › Hours list › Log time), task preselected |
| `/notifications`, `/issues` | Pushed screens |

Every pushed screen shows a back arrow. When opened cold by a deep link (nothing to pop), it goes up instead: task → its project, create task → project, notifications → Home, issues → More.

## v2 (m8-polish) — P1: My tasks, Day timesheet, entry sheet, DAR, project type

Endpoints, verified against `apps/api/src/routes/{tracker,dar,projectTypes,projects,time}.ts` on `m8-polish`:

| Feature | Endpoints |
|---|---|
| My tasks | `GET /tasks/mine?view=today\|due\|assigned\|accountable\|review\|completed&q=` |
| Running bar | `GET /tracker/running` (every 30 s + on resume, local 1 s tick), `POST /tracker/stop {entryId}` |
| Day timesheet | `GET /tracker/day?date&userId` → `{day}`; `GET /lookups` → `{activityTypes, locations}`; `GET /tracker/people` |
| Time in / Quick activity | `POST /tracker/start` (409 `TIMER_RUNNING` → Switch prompt → retry with `switchFrom`; 409 `HALF_DAY_LEAVE` → confirm → `confirmLeave: true`; 400 `LOCATION_NEEDED` → `dayLocationId`) |
| Add / edit / delete entry | `POST /tracker/entries {date,timeIn,timeOut,…}`, `PATCH /tracker/entries/:id`, `DELETE /tracker/entries/:id` |
| Activity preselect | `GET /project-types/preselect?taskId=` → "From project type: {type}. You can change it." |
| Location / submit / reopen | `PUT /tracker/days/:date/location`, `POST /tracker/days/:date/submit`, `POST /tracker/days/:date/reopen {userId, reason}` |
| Hours list | `GET /time?week=` (the API takes a week, not from/to), `DELETE /time/:id`; add via the existing `/log` form (`POST /time`) |
| DAR | `GET /dar?from&to` → `{report}`, `GET /dar/saved?from&to`, `POST /dar/saved {from,to}`, `GET /dar/saved/:id` |
| Project type | `GET /project-types`, `GET /projects?projectTypeId=<id>\|none`, `POST /projects`, `PATCH /projects/:id` (`reason` when the baseline changes) |
| Permissions | `GET /auth/me/permissions` (`permissionsProvider`; demo mode allows everything) |

Field errors from `error.details[] {path, message}` are shown under their fields (`ApiException.fields`); other errors show in the sheet or a SnackBar. 404 shows "Not found".
Times are Philippine time (UTC+8); durations are HH:MM (`formatHHMM`), times are 12-hour.

Decisions applied: no export/share anywhere (PDF/Excel stay on the web), no DAR person filter, no blocked-reason quick-pick chips, theme stays indigo #3F51B5 (logo purple #5355E0 only on the splash gradient).

Branding: `assets/brand/` (from `docs/design/logo/opstrack/final/`), `flutter_svg` for logo/icon, `flutter_launcher_icons` (icon-512.png, adaptive white background) and `flutter_native_splash` (#5355E0 + white logo). App label OpsTrack on Android, iOS, web and `MaterialApp.title`.
Regenerate with `dart run flutter_launcher_icons` and `dart run flutter_native_splash:create`.

New keys (handoff): `myTasksTab_<key>`, `quickActivityButton`, `timeIn_<taskId>`, `runningChip_<taskId>`, `taskSearch`, `dayTimesheet`, `daySegment`, `hoursListSegment`, `prevDay`, `nextDay`, `pickDate`, `changeLocation`, `dayStatusBadge`, `addEntry`, `addLeave`, `submitDay`, `reopenDay`, `entry_<id>`, `rowTimeOut_<id>`, `editEntry_<id>`, `lockedIcon_<id>`, `leaveRow_<id>`, `hoursRendered`, `runningTimerBar`, `runningTimerStop`, `entrySheet`, `entryTarget`, `entryTitle`, `entryWhen`, `entryTimeIn`, `entryTimeOut`, `entryDayLocation`, `entryActivityType`, `activityHint`, `entryLocation`, `entryBillable`, `entryModule`, `entrySave`, `entryDelete`, `switchPrompt`, `switchTimer`, `locationSave`, `confirmSubmit`, `reopenReason`, `confirmReopen`, `reviewPerson`, `darPreview`, `darSave`, `projectTypeFilter`, `projectTypeField`.

Demo data (Sun Oct 11, 2026 14:00 PH): today not submitted; Oct 10 empty; Oct 9 submitted; Oct 8 reopened (with an auto-stopped entry); Oct 7 half-day leave; Oct 6 full-day leave; Oct 2 past the weekly lock, not submitted. Queen Reyes and Mark Kim report to you (Timesheet review).

Not in this run (P2/P3): Leave (the "+ Add leave" button shows a "coming next" message), task approval/evidence/follow-ups/history, project detail tabs and type chip on the detail header, team members picker on the project form, and the rest of P3.

## Architecture
- Riverpod 3 (`lib/state/providers.dart`) and go_router (`lib/router.dart`).
- Repository interfaces live in `lib/data/repositories.dart`, with two implementations: `api_repositories.dart` (HTTP) and `mock_repositories.dart` (demo and tests).
- Theme: `lib/theme/app_theme.dart`, the designer's `flutter_theme.dart` adapted to the app's enums.

## Stubs / proposals (not in the repo API)
| Item | Status in app |
|---|---|
| Home KPIs (open, blocked, due this week, hours) | The dashboard endpoints are in unmerged PRs #10–#15, so the app computes these from `/tasks/mine` + `/time`. |
| Blocker quick-pick chips | UI only; they fill in the required reason text. |
| Appearance (System/Light/Dark) | In memory, not persisted. |
| Admin, Clients, Change password, task Edit (pencil) | Open the web app (`WEB_APP_URL`). |
| New project from template | The FAB shows a hint to use the web. |
| Push notifications, native splash | Not implemented (in-app splash route only). |
| Checklist reorder (long-press) | Not implemented (the API has `/projects/:id/tasks/reorder`). |
| Create task | Covers name, phase, priority, party, dates, estimate, approval and mandatory. Owner, assignees, reviewer and dependencies are set on the web. |
| Kanban move | Long-press a card to open a "Move to" sheet (not drag). Moving to Blocked asks for a reason. |

## Tests
```bash
flutter analyze
flutter test                     # widget + golden tests
flutter test --update-goldens    # regenerate test/goldens/*.png
```

`test/app_test.dart`:
- Login: validation, error, rate limit, success
- Navigation across the 5 tabs
- Block with a required reason
- Kanban long-press move, including Blocked → reason sheet → cancel
- Log time
- Admin link and dark mode

`test/qa_fixes_test.dart`:
- Deep-link create task: Save and X don't throw
- Back/up on deep-linked task, notifications and issues screens
- Task Edit and overflow menu
- `?tab=` and `/log?task=` changes on already-open pages
- No future week; 24h day cap
- Accessibility labels and the More issue count
- 2× text scale on 9 screens with no overflow

`test/golden_test.dart` (390×844): login, home (light and dark), board, task detail, log time. The goldens use the test font, so they catch layout changes, not typography.

### Stable keys for QA
- **Login:** `loginEmail`, `loginPassword`, `loginSubmit`, `loginError`
- **Navigation:** `bottomNav`, `nav_home|projects|tasks|log|more`, `backButton`
- **Screens:** `homeScreen`, `projectsScreen`, `tasksScreen`, `logTimeScreen`, `moreScreen`, `projectDetailScreen`, `taskDetailScreen`, `notificationsScreen`, `issuesScreen`, `createTaskScreen`
- **Lists, project and board:** `projectCard_<id>`, `taskTile_<id>`, `projectTabs`, `checklist`, `kanbanPageView`, `kanbanColumn_<status>`, `boardCard_<id>`
- **Status and blocking:** `statusPicker`, `statusOption_<status>`, `blockSheet`, `blockReasonField`, `confirmBlockButton`, `blockedBanner`
- **Task detail:** `taskChangeStatus`, `taskLogTime`, `taskStatusChip`, `taskEdit`, `taskOverflow`
- **Log time:** `prevWeek`, `nextWeek`, `pickDate`, `day_0..6`, `projectDropdown_<projectId>`, `taskDropdown_<projectId>_<taskId>`, `hoursField`, `noteField`, `saveEntry`, `weekTotal`
- **Create task:** `newTaskFab`, `taskNameField`, `saveTask`
- **Other:** `notificationsButton`, `markAllRead`, `moreIssues`, `moreIssuesCount`, `appearanceToggle`, `adminTools`, `signOut`

Sample IDs: projects `p1`–`p4`; tasks `t1`–`t8` (`t3` In progress, `t4` Blocked, `t6` In progress, `t7` For review).


## v2 — P2: Leave, task actions, project create/edit/detail

- **Leave (41–44)**: More › Leave (`/leave`). Record leave sheet (Key `recordLeaveSubmit`; also from Day timesheet "+ Add leave" with the day prefilled), half days disabled for full-day types, To = From on half days, client checks plus server messages (over balance, overlap, no working days). Balances with year ‹ ›, "Calendar year Jan–Dec", "Negative"/"Unpaid" chips; my leave with "Full day (AM + PM)" merging; cancel (whole or "Cancel morning (AM)" / "Cancel afternoon (PM)"); past leave hint; "Supervisor needed" banner (from `GET /leave/balances` `supervisor: null`); Team on leave (`GET /leave/team`).
- **Task actions (36–40)**: approval card with Approve / Request changes (`POST /tasks/:id/approve|reject`, comment required for reject, shown as "Changes requested:"); evidence (files only, PDF/Word/Excel ≤ 25 MB, "Checking the file…", legacy links labelled); follow-ups; Edit task screen (pencil); History and Delete in the overflow (delete only when the API says `deletable`, otherwise its `deleteBlockedReason`).
- **Project (31–35)**: header 2nd line = "Type · Go-live · PM" (maxLines 2); More tab with project type, handover, team members, active contacts add/remove, Time and Activity screens; New/Edit project gained Team members and (edit) Status.
- Endpoint deviations from the handoff (m8-polish wins): evidence upload is `POST /tasks/:id/evidence/uploads` → PUT bytes to `uploadUrl` → `POST /uploads/:id/complete` (no `/projects/:id/evidence/uploads`; `POST /tasks/:id/evidence` now always refuses); there is no `/projects/:id/handover` — handover is `PATCH /projects/:id {managerId}` (audited as `project_handover`); team members are `memberIds` on the same PATCH; leave cancel takes no body; the no-supervisor banner comes from `/leave/balances`.
- Not on mobile (P3 / web): Documents and Conversation project tabs (link text "Available on the web app"); evidence delete; follow-up contact tagging; task dependencies/subtasks.
- Demo: t7 is For review (approve/reject), t4 has evidence + a follow-up and can't be deleted, t8 can be deleted. Leave demo data is separate from the Day timesheet's leave rows.
