# OpsTrack — Flutter mobile app

*OpsTrack · by Jomerson & Grok.* Phone client for the OpsTrack API (`apps/api`, Express + MongoDB, REST `/api/v1`).
Built from the `pm-mobile-design` handoff: Material 3, indigo seed `#3F51B5` (primary pinned to #3F51B5 in light mode), a `StatusColors` ThemeExtension, and a 390×844 baseline. Includes dark mode.

## Setup
- Flutter stable with **Dart ≥ 3.13.5** (`environment: sdk: ^3.13.5`). Built and tested with Flutter 3.47.7 / Dart 3.13.5; the lock has `meta 1.19.0`, `vector_math 2.4.3`.
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
- Any email plus a password of **4+ characters** signs you in as "Jomerson Nazaire" (PM). `admin@…`, `member@…`, `viewer@…` sign in with that role.
- A **Demo mode** banner is always shown at the top so it can't be mistaken for the real Portal.
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
  - **Android/iOS:** the session cookie is persisted in `flutter_secure_storage` (Keychain / Android Keystore) with a last-active time, so a restart stays signed in.
- Every request sends `X-Client: mobile`. With the API change on this branch (commit 67b6d03) that header gives the session a **sliding idle window of `MOBILE_SESSION_IDLE_HOURS` (default 72 h)** and an **absolute cap of `MOBILE_SESSION_ABSOLUTE_DAYS` (default 90 days)**, as in `apps/api/src/config.ts`. Web sessions keep FR-AUTH-03 (30 min idle, 12 h max).
  - **Policy pending:** Jonathan is still deciding on this server change. It conflicts with FR-AUTH-03, and the `X-Client` header can be spoofed. Without it, mobile sessions follow FR-AUTH-03. The app only uses its own 3-day check to drop a stored cookie early. Opening/resuming the app calls `GET /auth/me`, which slides the window. After 3 days without activity the app (and server) ask you to sign in again.
- Every non-GET request sends `X-Requested-With: xc8-web`, which the API's CSRF guard requires.
- Riverpod's automatic retry is off for API errors (`noAutoRetry`): one request, then the error state.
- Errors: **401** → session cleared, back to sign-in. **403** → "You don't have access…" view (and routes gated by `/auth/me/permissions`). **422/400** → `error.details[]` mapped to form fields. **5xx, timeout (20 s), offline/DNS** → "Disconnected from the server. Please contact your System Admin." banner/screen with **Retry**; this never signs you out. Lists support pull-to-refresh.
- **Server time only:** the client keeps `serverOffset` from the `Date` header of every response and from `now` on `/tracker/running`. Time in/out, the running timer, switch, "today" and date limits use `ApiClient.serverNow()` (via `nowProvider` / `clockProvider`), never the device clock.

### Live integration tests (local m8-polish API)
```bash
# 1. API + in-memory MongoDB (apps/api)
cd apps/api && npm ci
npx tsx scripts/dev-db.ts &              # mongodb://127.0.0.1:27027/?replicaSet=rs0
# .env: MONGODB_URI=…, SEED_ADMIN_PASSWORD / SEED_USER_PASSWORD (avoid '#', dotenv treats it as a comment)
npm run seed && npx tsx --env-file=.env src/server.ts &
# 2. App API layer against it (credentials via env only, never committed)
cd mobile
IT_API_BASE_URL=http://localhost:4000/api/v1 \
IT_ACCOUNTS='admin@xceler8.example|<pw>;pm@xceler8.example|<pw>;member@xceler8.example|<pw>;viewer@xceler8.example|<pw>' \
flutter test test/integration/api_integration_test.dart
```
Without those variables the integration tests are skipped. They log in per role, check `/auth/me` and permissions, parse every read endpoint the screens use (403 accepted where the role is not allowed), 422 field mapping and logout → 401.

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
| `/tasks/:id/edit`, `/tasks/:id/history` | Edit task (PATCH); task detail opened on its History tab |
| `/projects/:id?tab=checklist\|board\|issues\|time\|activity\|more` | Project detail, scrollable M3 TabBar |
| `/projects/:id/time`, `/projects/:id/activity` | Stand-alone Time / Activity (deep links) |
| `/projects/:id/documents`, `/projects/:id/conversation` | Documents, Conversation (from the project's More tab) |
| `/issues/:id`, `/issues/new`, `/projects/:id/issues/new?task=` | Issue detail, Raise issue |
| `/insights?tab=projects\|workload\|reports`, `/reports/:name` | My projects, Team & workload, Reports (view only) |
| `/profile`, `/change-password`, `/clients`, `/clients/:id` | Profile (read-only), Change password, Clients |
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
| Demo mode | No `API_BASE_URL`: mock repositories, always-visible "Demo mode" banner, demo PM "Jomerson Nazaire". |
| Appearance (System/Light/Dark) | In memory, not persisted. |
| Admin tools | Open the web app (`WEB_APP_URL`). |
| Export (PDF/Excel/share) | Not on mobile (design decision). |
| DAR person filter, blocked-reason chips | Not on mobile (design decisions). |
| Push notifications | Not implemented (in-app notifications only). |
| Checklist reorder (long-press) | Not implemented (the API has `/projects/:id/tasks/reorder`). |
| Kanban move | Long-press a card to open a "Move to" sheet (not drag). Moving to Blocked asks for a reason. |
| Mobile session length | Depends on the pending API decision above. |

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
- Demo: t7 is For review (approve/reject), t4 has evidence + a follow-up and can't be deleted, t8 can be deleted. Leave demo data is separate from the Day timesheet's leave rows.


## v2 — P2 QA fixes and P3: everything else

- P2 QA: removed the "Team members are managed on the web app" note; project edit route is keyed by id (re-inits when the id changes); demo p3/p4 have code, manager, start date; task detail has **Details / History / Linked issues** tabs (History = follow-up note + one timeline of follow-ups and audit events); project detail uses a scrollable M3 `TabBar` (Checklist, Board, Issues, Time, Activity, More; More holds Documents, Conversation and the P2 details); evidence **Remove** with the web rule (`can.edit`, files stay while For review / Completed, server `EVIDENCE_LOCKED`) and the web confirm "Remove {name} from this task?" / Remove.
- **Issues (45–46)**: detail with chips, owner / reported by / due (from severity) / category, linked tasks, Comments & history, Add a comment, primary transition + "Other status changes" (labels from `transitionLabel`; resolution/reason asked when the shared rules need it), "Link a task" (PATCH `taskIds`), Change due date asks "Why is the due date changing?". Raise issue with the spec errors. Linked issues tab uses `GET /issues?taskId=`.
- **Documents (47)**: folders with "Restricted folder", Requested/Submitted/Signed filters, Overdue, upload (`POST /projects/:id/documents/uploads` → PUT → `/uploads/:id/complete`), fulfil a request (`fulfilsDocumentId`), download via `/download` URL. Folder access settings stay on web.
- **Conversation (48)**: `GET/POST /projects/:id/messages`, type (Note/Call/Meeting/Decision), tag a task or contact, "Who sees this" (web copy), "Write a message first.".
- **Notifications (49)**: personal notices use the API `message`; `link` is mapped (`/my-tasks?tab=day&date=` → Day timesheet on that date, `/leave…`, `/my-tasks`), issue notices open the issue.
- **Home (50, I7)**: portfolio from `GET /dashboard` (KPIs, active projects with health, upcoming milestones, waiting on client tasks + document requests, open by severity, avg. days to resolve) with All clients / All health filters, and "Documents requested from you" (`/document-requests/mine`).
- **Insights (51–53)**: My projects (`GET /dashboard/my-projects`, "Most days late", "N days late", Follow up), Team & workload (`GET /workload`, Over capacity, No capacity set), Reports viewer for the five m8-polish reports, footer "View only. Exports and advanced filters are on the web app."
- **Account (54–57, 00d)**: More menu per design 54; Profile (supervisor and Report CC "Set by Admin"); Change password (policy "8+ characters, a number and a symbol"); Clients list/detail (Details, Contacts, Projects) + Add contact; set-password calls `/auth/invite/verify` first and shows "Link not valid".
- Deviations (m8-polish wins): conversation is `/projects/:id/messages` (no `/conversations/:id`); My projects is `/dashboard/my-projects` (not `/reports/my-projects`); "Pending client items" is a Project status column, not its own report; `/dashboard` takes no filters, so the Home filters work on the client.

## P3 QA fixes: permission gating

- `GET /auth/me/permissions` is parsed strictly (only JSON `true` grants; `lib/data/access.dart`). `can()`/`canW()` mirror the web `useCan` (`hasPermission`) and return **false while permissions load**.
- Project-scoped actions use the server `project.can` flags (`edit`, `planTasks`, `activity`) like the web ProjectDetailPage; demo data falls back to the role rule plus "Admin or the project's PM".
- Demo roles follow m8-polish `DEFAULT_SPEC`: sign in as `admin@…`, `member@…` or `viewer@…` (anything else is Project Manager).
- Deep links to create/edit screens a role cannot use show a "no access" page (`PermissionGate`).
- Demo invite tokens: `demo`, `demo-invite`, `demo-reset`; any other token shows "Link not valid".
- Tests: `test/roles_test.dart` (gating matrix per Admin/PM/Member/Viewer, strict parse, loading state, S4 fixes).

### Conversation posting and task dependencies
- Conversation composer shows only when FR-CNV-04 `canPost` holds in the app: `conversations.create` and (edit rights on the project, or project membership/PM). Otherwise the web's note "You can read this conversation but not post." A server 403 also switches to that note and shows the server message.
- Create/Edit task: "Depends on" chips + searchable multi-select sheet of tasks in the same project. Validation mirrors `routes/tasks.ts` + shared `findCycle` (no self, project tasks only, "Circular dependency: A → B → A."); sent as `dependsOn` on `POST /projects/:id/tasks` and `PATCH /tasks/:id`.
