# Xceler8 PM — Flutter mobile app

Phone client for the Xceler8 Implementation Tracker API (`apps/api`, Express + MongoDB, REST `/api/v1`).
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
| `/home`, `/projects`, `/tasks`, `/log`, `/more` | The 5 NavigationBar tabs (StatefulShellRoute) |
| `/projects/:id?tab=checklist\|board\|issues\|more` | Project detail; `tab` is honoured even if the project is already open |
| `/projects/:id/tasks/new` | Create task |
| `/tasks/:id` | Task detail (fixed Log time / Change status bar) |
| `/log?task=<id>&project=<id>` | Log time with the task preselected |
| `/notifications`, `/issues` | Pushed screens |

Every pushed screen shows a back arrow. When opened cold by a deep link (nothing to pop), it goes up instead: task → its project, create task → project, notifications → Home, issues → More.

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
