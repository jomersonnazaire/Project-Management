# 15 · Client portal API contract

**Status:** v0.2 draft (2026-10-13, SGT), contract only, not built. **Sources:** doc 11 v0.4.27 (FR-ACL-24, 27–36; AC-57.2–57.7, AC-58.1–58.16, AC-59.1–59.4; EC-114–127; NFR-33, NFR-35; Q-74–86), doc 13 (severity enum, §3–4), doc 14 v1.2.22 (FR-SSO-05, FR-AUTH-07), `design/CLIENT_PORTAL_UI.md` and mockup `index-v0.9.14.html`. Checked against `pm-app` `packages/shared/src/{issues,projects}.ts` and `apps/api/src/services/scope.ts`. **Fits:** `apps/api` at `8fdb005` (opaque server sessions in `sessions`, `{ error: { code, message, details? } }`, `audit()` → `activityLogs`, `Migration` runner, zod schemas in `@xc8/shared`).

All paths are under `/api/v1`. "404" means `NOT_FOUND`, returned for anything out of scope (never 403, per DEF-015).

## 1. Collections

### 1.1 `clientPortalAccounts` (new, FR-ACL-34)
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `contactId` | ObjectId → `clientContacts` | **unique** (one account per contact) |
| `clientId` | ObjectId → `clients` | copied from the contact; re-checked on every request |
| `email` | string, lowercase, trimmed, ≤254 | **unique across portal accounts** (422 `PORTAL_EMAIL_EXISTS`); may equal a staff email, never linked to it |
| `passwordHash` | string \| null, `select: false` | argon2/bcrypt via `services/passwords.ts`; null until the invite is used |
| `status` | `invited` \| `active` \| `disabled` | |
| `inviteTokenHash` | string \| null, `select: false` | SHA-256 of the invite token (the raw token is only in the email) |
| `inviteSentAt`, `inviteExpiresAt` | Date \| null | expiry = sent + **7 days** |
| `sessionVersion` | number, default 0 | bumped on every revoke (§3) |
| `lastLoginAt` | Date \| null | |
| `failedLoginCount` | number, default 0 | |
| `lockedUntil` | Date \| null | **15 min after 5 consecutive failures** |
| `createdBy`, `updatedBy` | ObjectId → `users` | staff actor |
| `createdAt`, `updatedAt` | Date | `timestamps: true`, `strict: 'throw'` |

Never read by Users, Team & workload, pickers, assignees, seat counts or Access rules (FR-ACL-35).

### 1.2 `portalSessions` (new, kept apart from staff `sessions`)
`{ tokenHash (unique), accountId → clientPortalAccounts (index), sessionVersion, lastSeenAt, expiresAt (TTL index), absoluteExpiresAt, ip, userAgent }`. Idle timeout and absolute cap reuse `SESSION_IDLE_MINUTES` and the staff web absolute cap (new env vars only if Jomerson wants different values, see §8).

### 1.3 New fields on existing collections (all default **false**)
| Collection | Field | Meaning |
|---|---|---|
| `documents` | `sharedWithClient: boolean` | "Share with client" (FR-ACL-32, Q-74) |
| `documents` | `sharedAt: Date \| null` (default null) | set to now when `sharedWithClient` goes false → true; cleared to null when unshared. Shown in the portal as "Shared {date}" (v0.2) |
| `issues` | `clientFacing: boolean` | "Client-facing" (FR-ACL-32, Q-75) |

`clientContacts` is **not** changed: portal state lives only in `clientPortalAccounts` (its `strict: 'throw'` comment still holds).

## 2. Tokens and how they are told apart
- **Format:** `ptl_` + 32 random bytes in base64url (≈47 characters). Staff tokens stay unprefixed (`newToken()`). Only `sha256(token)` is stored.
- **Transport:** an HttpOnly cookie **`__Host-xc8_psid`** (`xc8_psid` when `COOKIE_SECURE=false`), SameSite as staff, path `/`. No bearer and no mobile variant for the portal in this build. The same CSRF origin check as staff applies to portal POSTs.
- **Audience:** a portal session row is the audience `portal`. A staff session row is the audience `staff`.
- **Separation (FR-ACL-36, AC-58.4, EC-123):**
  - Staff `authenticate()` rejects any token starting `ptl_` and never reads the portal cookie, so a portal token gets **401** `SESSION_EXPIRED`. Lookup is only in `sessions` anyway.
  - New `authenticatePortal()` (mounted on `/portal/*` only) reads only the portal cookie, requires the `ptl_` prefix and looks up only `portalSessions`. A staff cookie or token gets **401** `PORTAL_SESSION_EXPIRED`.
  - The two cookies can coexist in one browser; each side ignores the other's.
- **No Microsoft sign-in** for portal accounts. `/auth/entra/*` never creates a portal session (AC-58.2).

## 3. Session checks and revocation
On every `/portal/*` request, `authenticatePortal()` loads the session, then the account, then the contact. It returns **401** `PORTAL_SESSION_EXPIRED` (message "Your session has ended. Sign in again to continue.", no reason given, AC-58.10) and clears the cookie when any of these hold:
- the session is missing, idle-expired or past its absolute cap;
- `account.status !== 'active'`;
- `session.sessionVersion !== account.sessionVersion`;
- the contact is missing, `active: false`, or `contact.clientId !== account.clientId` (EC-120).

**Revoke** = `status: 'disabled'`, `$inc sessionVersion`, `deleteMany portalSessions {accountId}`. It is triggered by:
- Portal access off (§5.1);
- contact deactivate (`POST /contacts/:id/deactivate`), contact delete, or the contact moving client (EC-114, 120);
- a re-invite of an `active` account (§5.1, Q-85): sessions are revoked, the client is signed out and the old password stops working until a new one is set from the invite. Unlike the other triggers this sets `status: 'invited'` (not `disabled`) and nulls `passwordHash`.

Because the contact and account are re-read on every request, revocation applies on the very next request even if the bulk delete fails.

## 4. Portal endpoints (`/portal/*`)
**Who:** a valid portal session (§3), except the three auth endpoints marked "public". **Scope:** project P is in scope when `P.clientId === account.clientId` **and** `account.contactId ∈ P.activeContactIds`. Anything else (including children of an out-of-scope project, unshared documents and non-client-facing issues) returns **404**. There are no write endpoints for portal data. Any POST, PATCH, PUT or DELETE on a data path returns **404** `NOT_FOUND`, because the route doesn't exist (AC-57.3). All responses are built by dedicated portal DTO mappers (allow-list), never by stripping staff DTOs.

Common types:
- `PortalRef = { id, name }`
- `XCELER8 = { id: null, name: 'Xceler8' }`
- Dates are ISO strings; date-only fields are `YYYY-MM-DD`.

### 4.1 Auth
| Method · path | Who | Request (zod in `@xc8/shared/portal`) | 200 response | Errors |
|---|---|---|---|---|
| `POST /portal/auth/login` | public | `{ email, password }` | sets the cookie; `{ account: PortalMeDto }` | 400 `VALIDATION_ERROR`; 401 `INVALID_CREDENTIALS` "That email and password don't match. Try again." (also for unknown, `invited` or `disabled` accounts); 423 `ACCOUNT_LOCKED` "Too many attempts. Your account is locked for 15 minutes. Try again later."; 429 `TOO_MANY_ATTEMPTS` "Too many sign-in attempts from this network. Try again in a few minutes." (NFR-35) |
| `POST /portal/auth/logout` | portal session (or none) | — | 204, cookie cleared, session row deleted | — |
| `GET /portal/auth/invite/:token` | public | — | `{ email, contactName, clientName }` for the set-password welcome screen ("Welcome, {contactName}" · company `clientName` · read-only `email`); nothing else | 410 `INVITE_EXPIRED` (expired, replaced or unknown token; one code so nothing leaks) |
| `POST /portal/auth/invite/:token` | public | `{ password, confirmPassword }` (`password.min(12, 'At least 12 characters.')`, must match) | sets `passwordHash`, `status: active`, clears the invite fields, signs in (cookie); `{ account: PortalMeDto }` | 400 `VALIDATION_ERROR`; 410 `INVITE_EXPIRED` |
| `GET /portal/me` | portal | — | `PortalMeDto = { contact: { id, name }, client: { id, name }, email, lastLoginAt }` | 401 |

Lockout (AC-58.7, EC-127): each wrong password does `$inc failedLoginCount`. At 5, it sets `lockedUntil = now + 15 min` and resets the count. While locked, even the correct password gets 423. A re-invite does **not** clear `lockedUntil`. A successful sign-in resets the count and sets `lastLoginAt`. Thresholds reuse `LOCKOUT_THRESHOLD` and `LOCKOUT_MINUTES`. Sign-in success, failure and lock are audited (§6). There is **no** reset or forgot-password endpoint (Q-78, AC-58.11).

**Per-IP limit (NFR-35, AC-58.16, v0.2):** at most **20 failed sign-ins per IP in a rolling 15 minutes** on `POST /portal/auth/login`. A failure is any 401 `INVALID_CREDENTIALS` or 423 `ACCOUNT_LOCKED` response (400 validation errors don't count; successes don't reset the IP count). Once an IP has 20 failures in the window, every further login attempt from it (correct password or not, any email) gets **429** `TOO_MANY_ATTEMPTS` with `Retry-After` (seconds) until the oldest failures age out; 429 attempts are not counted again. Counters are keyed on the client IP (`req.ip` behind the trusted proxy), kept in a shared store (Mongo `portalLoginAttempts` with TTL, or the existing rate-limit store), and separate from the staff login limiter. Audit: one `portal_ip_limited` row per IP per window, `actorId` null, `meta.ip`.
**Interaction with the per-account lockout:** the two limits are independent and both apply. The IP check runs **first**, before the account is looked up, so a limited IP gets 429 and the attempt does **not** touch any account's `failedLoginCount` or `lockedUntil` (an attacker can't use a blocked IP to lock accounts further, and the response leaks nothing about the account). If the IP is allowed, the per-account rules run as above (5 failures → 423 for 15 minutes); those failures also count toward the IP's 20. So one IP trying one account gets locked by the account rule (423) after 5; one IP spraying many accounts gets 429 after 20. An account lockout never blocks an IP and an IP block never locks an account. `/portal/auth/invite/:token` (GET and POST) shares the same IP counter for 410 responses so invite tokens can't be guessed.

### 4.2 Data (read only)
| Method · path | Response |
|---|---|
| `GET /portal/projects` | `{ items: PortalProjectSummaryDto[] }`: in-scope projects only, sorted by name |
| `GET /portal/projects/:id` | `PortalProjectDto` |
| `GET /portal/projects/:id/tasks` | `{ items: PortalTaskDto[] }`: in phase order, then task order |
| `GET /portal/projects/:id/documents` | `{ items: PortalDocumentDto[] }`: `sharedWithClient: true`, not archived, not cancelled, latest version clean (scan passed) |
| `GET /portal/projects/:id/documents/:docId/download` | `{ url, expiresAt }`: short-lived signed URL (reuses `downloadLink`); 404 if unshared or scan-flagged |
| `GET /portal/projects/:id/issues` | `{ items: PortalIssueDto[] }`: `clientFacing: true` only |
| `GET /portal/projects/:id/issues/:issueId` | `PortalIssueDto` |

DTOs (allow-lists; no other field may appear, enforced by NFR-33 tests):
- `PortalProjectSummaryDto = { id, name, code, status, progressPct, currentPhase: { index, count, name } | null, goLiveDate, sharedDocumentCount, clientFacingIssueCount }`
- `PortalProjectDto = PortalProjectSummaryDto & { client: PortalRef, plannedStart, plannedEnd, phases: { name, order, plannedEnd, taskCount, doneCount, progressPct }[] }`. `phases[].plannedEnd` (v0.2) is the phase's planned end date (`YYYY-MM-DD`, the latest planned end of its tasks, or the phase's own end date if stored) or `null` when none is planned; shown as the phase "Target" in the mockup.
- `PortalTaskDto = { id, order, name, phase, status, plannedStart, dueDate, completedAt, owner: XCELER8 }`. The owner is always "Xceler8" (Q-79, AC-57.6).
- `PortalDocumentDto = { id, name, kind, version, size, mimeType, sharedAt, uploadedBy: XCELER8 }`. `sharedAt` is the ISO date the document was last shared (§1.3); the Documents list shows "Shared {date}" from it.
- `PortalIssueDto = { id, key, title, status, priority, raisedAt, dueDate, resolvedAt }` (Q-80, FR-ACL-31, AC-57.7, doc 11 v0.4.26). `raisedAt` = `createdAt`. **`priority` (Q-82, v0.2):** the issue's existing `severity` value, returned under the name `priority`; there is no new field on `issues`. Values are the doc 13 severity enum `CRITICAL | HIGH | MEDIUM | LOW`, labelled with `PORTAL_PRIORITY_LABELS` (§7.5). **`resolvedAt` (Q-83, v0.2):** the stored `resolvedAt` when `status === 'RESOLVED'`; also when `status === 'CLOSED'` **and** a stored `resolvedAt` exists (resolved, then closed). `null` for any other status (including after a reopen to In progress, even if a stale value is stored) and for an issue closed straight from Open (no resolve date). The list shows the columns Issue, Priority, Status, Raised and Due; the detail page adds Resolved when it is set. **No** description, severity (under that name), stage, category, owner, reporter, attachments, links or comments.

Never returned (FR-ACL-30): billable flags, rates, time entries, est., actual or assigned hours, Time in and Time out, effort summaries, internal or any comments, conversations, staff names, emails or ids, audit actors, `can` blocks, versions/ETags, deletion info, approval and reviewer data, requested-from parties.

## 5. Staff-side additions (staff session, `/api/v1`)
**Portal-manager check (FR-ACL-33, Q-81, Q-86 v0.2, EC-124, AC-58.15)**, evaluated per request: the caller is Admin, **or** the caller can edit at least one **non-archived** project of that client with status `PLANNING` or `ACTIVE`. "Can edit the project" reuses the pm-app's project-edit rule rather than a new one: `isPlanner(user, project)` in `apps/api/src/services/scope.ts`, i.e. Admin, or a PM who passes `canEditProjectScope` (the assigned PM, `managerId`, under `PM_PROJECT_EDIT_SCOPE`) **or** `isProjectPm` (a co-PM: any user with role PM on the project's team list, `memberIds`), together with `projects.edit` in the access rules. Members and Viewers never qualify, even though `canEditProjectScope` alone lets a Member edit projects they belong to (see §8). Otherwise the call gets **403** `FORBIDDEN` (the UI hides the controls). The same check, applied to the one project, gates the share toggles in §5.2.

### 5.1 Portal access on Client › Contacts
| Method · path | Who | Request | Response | Errors / effects |
|---|---|---|---|---|
| `GET /clients/:id/contacts` (extended) | unchanged (`contacts.view`) | — | each contact gains `portal: { status: 'off' \| 'invited' \| 'invite_expired' \| 'active' \| 'disabled', email, inviteSentAt, inviteExpiresAt, lastLoginAt } \| null` plus `canManagePortal: boolean` on the list | `off` = no account; `disabled` is returned as is and labelled "Off" (§7.5); `invite_expired` is derived from `inviteExpiresAt < now` |
| `PUT /contacts/:id/portal-access` | portal-manager | `{ enabled: true, email }` or `{ enabled: false }` | `{ contact: ClientContactDto }` (with `portal`) | **On:** creates the account (`invited`) or reuses a `disabled` one (`disabled → invited`, new invite, `$inc sessionVersion`, `passwordHash` nulled), then delivers the invite (email when a service exists; see Q-84 below). 422 `PORTAL_EMAIL_EXISTS` "This email already has portal access through another contact. Use a different email address."; 422 `CONTACT_INACTIVE`; 502 `INVITE_SEND_FAILED` (account kept, status `invited`). **Off:** revoke (§3). Idempotent: no change means no audit. |
| `POST /contacts/:id/portal-invite` | portal-manager | — | `{ contact }` | Only when `invited` (pending or expired) or `active`: new token, old one invalid, `inviteExpiresAt` = +7 days. If `active` (Q-85, AC-58.14): `$inc sessionVersion`, delete its `portalSessions` (the client is signed out on the next request, 401), null `passwordHash` and set `status: 'invited'`, so the old password no longer signs in and a new password must be set from the invite. Audited with `meta.resend: true, meta.forcedPasswordReset: true`. 409 `PORTAL_ACCESS_OFF` when off or disabled. Does not lift `lockedUntil`. |

**Q-84, invite link while there's no email (PENDING Jomerson's security sign-off; not part of the build).** Proposed only: `PUT …/portal-access` (on) and `POST …/portal-invite` would add optional `inviteUrl` (the one-time set-password link, shown once to the staff caller, never stored in plain text, never returned again by any GET) and `inviteExpiresAt` (sent + 7 days) to their response; the token works once (AC-58.13). Until Q-84 is decided, these fields are **not** implemented, and the invite endpoints and the "Turn on" / "Resend invite" UI are **kept out of the build** (feature flag off). Everything else in this contract can be built.

Hooks on existing routes: `POST /contacts/:id/deactivate`, contact delete, and any client change of a contact revoke and disable the account (EC-114, 120). Reactivating the contact does **not** re-enable portal access (a staff member turns it back on, which sends a new invite).

### 5.2 Share toggles (FR-ACL-32)
| Method · path | Who | Request | Response | Errors |
|---|---|---|---|---|
| `PUT /projects/:id/documents/:docId/share` | Admin, or anyone who can edit that project (§5 check, Q-86: `isPlanner`, co-PMs included) | `{ sharedWithClient: boolean }` | `{ document: DocumentDto }` (gains `sharedWithClient`, `sharedAt`) | 403 for Members, Viewers and PMs who can't edit it; 404 out of staff scope; **422 `DOCUMENT_ARCHIVED`** "Archived documents can't be shared." when setting `true` on an archived document (unsharing an archived document is allowed). Archiving a shared document hides it from the portal (§4.2) |
| `PUT /issues/:id/client-facing` | Admin, or anyone who can edit the issue's project (same check, Q-86) | `{ clientFacing: boolean }` | `{ issue: IssueDto }` (gains `clientFacing`) | 403; 404 |

Staff DTOs gain `sharedWithClient` / `clientFacing` (read by everyone who can see the record) and `can.share` / `can.setClientFacing`. Unchanged values write no audit row.

## 6. Audit (`activityLogs`, via `audit()`)
| action | entityType | actorId | changes / meta |
|---|---|---|---|
| `portal_access_enabled` / `portal_access_disabled` | `clientPortalAccount` | staff | `status` old → new, `email`; `meta.contactId`, `meta.clientId` |
| `portal_invite_sent` | `clientPortalAccount` | staff | `inviteExpiresAt` old → new; `meta.resend: boolean` |
| `portal_account_disabled_by_contact` | `clientPortalAccount` | staff | `status` → `disabled`; `meta.reason: 'contact_deactivated' \| 'contact_deleted' \| 'contact_moved'` |
| `portal_login`, `portal_login_failed`, `portal_locked`, `portal_password_set`, `portal_ip_limited` | `clientPortalAccount` | **null** | `meta.portalAccountId`; ip and user agent from the request context |
| `document_shared_with_client` | `document` | staff | `sharedWithClient` old → new; `projectId` |
| `issue_client_facing_changed` | `issue` | staff | `clientFacing` old → new; `projectId` |

Portal actions never surface staff names to the portal. The staff audit screen shows portal actors as "Portal: {contact name}".

## 7. Migrations (`Migration` runner, idempotent)
1. `2026-10-portal-01-collections`: create `clientPortalAccounts` (unique `contactId`, unique `email`, index `clientId`) and `portalSessions` (unique `tokenHash`, index `accountId`, TTL `expiresAt`).
2. `2026-10-portal-02-flags`: `documents.updateMany({ sharedWithClient: { $exists: false } }, { $set: { sharedWithClient: false } })` and the same for `issues.clientFacing`. Mongoose defaults are `false` too.
3. No changes to `users`, `accessRules` or `clientContacts`. `GET /access-rules` still returns four roles (AC-57.5).
4. Shared package: new `@xc8/shared` module `portal.ts` (zod request schemas, DTO types, `PORTAL_TOKEN_PREFIX = 'ptl_'`, error codes `PORTAL_EMAIL_EXISTS`, `PORTAL_SESSION_EXPIRED`, `INVITE_EXPIRED`, `ACCOUNT_LOCKED`, `TOO_MANY_ATTEMPTS`, `PORTAL_ACCESS_OFF`, `INVITE_SEND_FAILED`, `CONTACT_INACTIVE`, `DOCUMENT_ARCHIVED`), plus the label maps below. The issue and document DTOs gain the two flags (and documents `sharedAt`). Migration 2 also sets `documents.sharedAt: null` where missing.
5. **Label maps in `@xc8/shared/portal` (v0.2, Q-82).** Values are the API enums; labels are what the portal and the Contacts column show (mockup v0.9.14):
   - `PORTAL_ACCOUNT_STATUS_LABELS`: `invited` → "Invite pending", `invite_expired` → "Invite expired", `active` → "Active", `disabled` → "Off", `off` → "Off".
   - `PORTAL_PROJECT_STATUS_LABELS`: `PLANNING` → "Planning", `ACTIVE` → "Active", `ON_HOLD` → "On hold", `COMPLETED` → "Completed", `CANCELLED` → "Cancelled" (same as `PROJECT_STATUS_LABELS`; re-export, don't copy).
   - `PORTAL_ISSUE_STATUS_LABELS`: `OPEN` → "Open", `IN_PROGRESS` → "In progress", `WAITING_ON_CLIENT` → "Waiting on client", `RESOLVED` → "Resolved", `CLOSED` → "Closed" (re-export `ISSUE_STATUS_LABELS`).
   - `PORTAL_PRIORITY_LABELS`: `CRITICAL` → "Critical", `HIGH` → "High", `MEDIUM` → "Medium", `LOW` → "Low", keyed on the doc 13 severity enum `ISSUE_SEVERITIES` (re-export `ISSUE_SEVERITY_LABELS`, typed `Record<IssueSeverity, string>`). **Not** the project `PRIORITIES` / `PRIORITY_LABELS` in `projects.ts`, which is a different enum (see §8).

## 8. Open points
Resolved or applied in v0.2 (doc 11 v0.4.27; Q-82, Q-83, Q-85, Q-86 are Rich's proposed defaults, pending Lean or Jomerson; NFR-35 confirmed by Lean): issue priority = severity (§4.2, §7.5); `resolvedAt` on Closed issues (§4.2); re-invite of an active account (§5.1); who counts as a portal manager (§5); per-IP rate limit (§4.1).

1. **Q-84, invite delivery (pending Jomerson, security sign-off):** optional one-time `inviteUrl` and `inviteExpiresAt` in the invite responses (§5.1). Invites stay out of the build until decided.
2. Task owner when the owner is the client contact: this contract always returns "Xceler8" (UI doc gap 3).
3. Portal session idle and absolute limits: reuse the staff web values, or add `PORTAL_SESSION_IDLE_MINUTES` and `PORTAL_SESSION_MAX_HOURS`?
4. Shared documents that are issue attachments or task evidence (`source: ISSUE | EVIDENCE`): are they shareable, or project Documents only? This contract allows only `source: 'DOCUMENT'`.
5. **pm-app mismatches to note (no code change here):**
   - Severity enum matches doc 13 exactly (`ISSUE_SEVERITIES = ['CRITICAL','HIGH','MEDIUM','LOW']`, labels Critical/High/Medium/Low in `packages/shared/src/issues.ts`). But `packages/shared/src/projects.ts` also exports `PRIORITIES` / `PRIORITY_LABELS` (same four values, ordered LOW → CRITICAL) for **projects**; the portal must not use it for issues, and the name `PORTAL_PRIORITY_LABELS` should stay keyed on `IssueSeverity`.
   - "Can edit the project" isn't one function in the code: `canEditProjectScope` covers Admin, the assigned PM (`managerId`, or all projects when `PM_PROJECT_EDIT_SCOPE = 'ALL'`) and **Members** on their own projects, but **not** co-PMs; co-PMs (`isProjectPm`, PM on the team list) only come in through `isPlanner`. This contract uses `isPlanner` + `projects.edit` so co-PMs count and Members don't. Confirm with Deven.
   - Doc 11 FR-ACL-32 still says "PMs (on their projects) and Admins"; FR-ACL-32/33 Q-86 text says "co-PMs if the model has them" (it does: `isProjectPm`).
   - Mockup v0.9.14 and the UI doc show an "Invite expired" state that the requested status list doesn't name; it stays as a derived status (§5.1, §7.5).
6. Q-77 to Q-86 are build defaults pending Jomerson (Q-82, 83, 85, 86 may be confirmed by Lean).

## 9. Change log
- **v0.2** (2026-10-13, SGT): aligned to doc 11 v0.4.27, mockup v0.9.14 and the pm-app enums. Priority = severity under the label "Priority", no new field (Q-82); label maps for portal account status, project status, issue status and priority added to `@xc8/shared/portal`; `resolvedAt` returned for Resolved, and for Closed when a resolve date exists (Q-83); `phases[].plannedEnd` on project detail; per-IP sign-in limit of 20 failures per 15 minutes with 429 `TOO_MANY_ATTEMPTS` and its interaction with the account lockout (NFR-35); portal-manager check and share toggles use the pm-app project-edit rule (`isPlanner`), co-PMs included (Q-86); re-invite of an active account signs out and forces a new password (Q-85); archived documents can't be shared (422 `DOCUMENT_ARCHIVED`); documents carry `sharedAt`; invite check returns contact name, company and email for the welcome screen; Q-84 `inviteUrl`/`inviteExpiresAt` described as pending only, invites kept out of the build. Open points renumbered.
- **v0.1** (2026-10-13, SGT): first draft.
