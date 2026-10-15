# Client portal UI (mockup v0.9.14)

**Source:** doc 11 v0.4.27 (Q-82 to Q-86 proposed defaults) and contract doc 15 v0.1. Earlier: doc 11 v0.4.25 (Q-77 to Q-81 build defaults; comments decided by Lean) and doc 14 v1.2.21 (AC-52.8). Earlier: doc 11 v0.4.23 (FR-ACL-23 to 36, AC-57.2 to 57.5, AC-58.2 to 58.6, AC-59.1 to 59.3, EC-114 to 123, NFR-33/34, Q-73 to 76) and doc 14 v1.2.20 (FR-SSO-05, FR-ACT-35, Q-72). v0.4.22 (Client as a fifth role) is withdrawn and not used.
**Mockup:** `docs/design/mockup/index.html` = `index-v0.9.14.html`. Sneat theme, AA colors, brand #5355e0. Responsive at 390px.

Client access is **portal access per contact**, not a staff role. Staff keep four roles (Admin, PM, Member, Viewer); the role switcher and Access rules have no Client option or column.

## Screens

| # | Screen (hash) | Who | States |
|---|---|---|---|
| 1 | Portal sign-in (`#psignin`) | Contact with portal access | Default, field validation, error, locked, session expired, invite expired, set password (from invite), loading |
| 2 | Portal · Projects (`#pprojects`) | Portal user | List, loading, empty, error |
| 3 | Portal · Project view (`#pproject`): Overview, Tasks, Documents, Issues tabs | Portal user | Each tab has data and empty states; all view only |
| 3a | Portal · Issue detail (`#pissue`) | Portal user | View only: title, status, priority, raised, due; Resolved only when set (Closed example, Q-83). Priority labels Critical, High, Medium, Low (Q-82). No comments |
| 4 | Portal · 404 (`#p404`) | Portal user | Out of scope, unshared, not client-facing, other client |
| 5 | Client › Contacts, Portal access column (`#client`) | Admin, or PM of a client project in Planning or Active (Q-81); others, including a PM whose client projects are all On Hold, Completed or Cancelled, see the label only | Off, Invite pending, Invite expired, Active; invite modal with validation, email in use, server error, sending, success; turn-off confirm; loading, empty |
| 6 | Documents, "Share with client" toggle (`#docs`) | PM (own projects), Admin; Members/Viewers see a read-only label | Off by default; confirm on/off; audited |
| 7 | Issue detail, "Client-facing" toggle (`#issue`) | PM, Admin; Members/Viewers see "Off. Only PMs and Admins can change this." | Off by default; confirm on/off; audited |
| 9 | Time logging and Day timesheet, locked day (AC-52.8) | Staff with time access | "Log task time" and "Add quick activity" stay visible but disabled, tooltip "This day is locked", at every width. Checklist ↑↓ use the ghost style |
| 8 | Viewer `/leave` (`#leave` as Viewer) → "You don't have access to this page" (`#noaccess`) | Viewer | Leave hidden in Viewer menu (Q-72) |

Portal shell: own top bar (logo, "Client portal" tag, **Projects** only, "R. Santos · Acme Trading Corp.", Sign out). No staff sidebar, role switcher, banner or running timer. A "← Back to the staff mockup" demo link sits above it (not part of the product).

Portal data rules shown: no Billable, rates, time entries, hours, Time in/Time out or comments of any kind; task owners and staff show as **Xceler8** (Q-79).

## Copy

**Portal sign-in**
- Title: Sign in to the client portal
- Intro: For Xceler8 clients. Use the email your project manager invited.
- Fields: Email · Password · Sign in · Signing in…
- No reset (Q-78): Forgotten your password? Ask your Xceler8 project manager to send you a new invite.
- Footer: Xceler8 staff? Sign in to OpsTrack instead. Microsoft sign-in isn't available on the portal.
- Validation: Enter your email address. · Enter a valid email address. · Enter your password.
- Error: That email and password don't match. Try again.
- Locked: Too many attempts. Your account is locked for 15 minutes. Try again later.
- Locked details (annotation): 5 consecutive failed sign-ins lock the account for 15 minutes, the same threshold as staff sign-in (FR-AUTH-07, AC-58.7). The correct password is refused while locked. A resent invite doesn't lift the lock (EC-127).
- Session expired: Your session has ended. Sign in again to continue. (also shown after a 401 when access is turned off, without a reason)
- Invite expired: This invite link has expired. Ask your Xceler8 project manager to send a new one.
- Set password: Welcome, {contactName} · {clientName} · Email (read-only) · New password · At least 12 characters. · Confirm password · Set password and sign in
- Per-network limit (429 `TOO_MANY_ATTEMPTS`, 20 failed sign-ins per IP in 15 minutes, proposed): Too many sign-in attempts from this network. Try again in a few minutes.

**Portal projects and project view**
- Your projects · Phase 2 of 4 · Configuration · Go-live Nov 30 · 46% complete · 3 shared documents · 1 issue
- Empty: No projects to show yet. Projects show here once Xceler8 adds you as a project contact.
- Error: We couldn't load your projects. Refresh the page to try again.
- Tabs: Overview · Tasks · Documents · Issues · View only
- Overview: Progress · Phases · Questions? Contact your Xceler8 project team. This portal is view only.
- Tasks empty: No tasks yet. Tasks show here once the project plan is set.
- Documents columns: Document · Version · Shared ("Shared Sep 2", from `sharedAt`) · Download. No document status column. Empty: No shared documents yet. Documents Xceler8 shares with you show here.
- Tasks note: View only. Task owners show as Xceler8 (Q-79). Hours, time, Billable and internal comments aren't shown.
- Issues list columns: Issue · Priority · Status · Raised · Due. Note: Only client-facing issues. Open one to see its details. View only, and comments aren't shown in the portal.
- Issue detail: Status · Priority · Raised · Due · Resolved · View only. Comments aren't shown in the portal. Questions about this issue? Contact your Xceler8 project team.
- Issues empty: No issues to show. Issues Xceler8 shares with you show here.

**Portal 404**
- 404 · We can't find this page · The link may be wrong, or the page isn't available to you. · Go to your projects

**Client › Contacts (Portal access)**
- Notice: Contacts don't get a staff login. You can give a contact portal access: they sign in to the separate client portal with a password and see only projects where they're an active contact, shared documents and client-facing issues (view only).
- Column: Portal access · Statuses: Off · Invite pending (sent Oct 13 · expires Oct 20) · Invite expired (sent Oct 1) · Active (last signed in Oct 12, or "not signed in yet") · Button: Resend invite on pending, expired and active rows.
- Resend confirm, pending or expired: Send a new invite? · We'll send {Name} a new invite. The old link stops working. · Send new invite
- Resend confirm, active (Q-85): Send a new invite? · {Name} will be signed out of the portal at once and must set a new password from the new invite. Their current password stops working. · Sign out and send invite · This change is recorded in the audit log.
- (Email wording stays until Q-84 is decided; no copy-link step yet.) Off → on reuses the account and sends a new invite; the old password stops working (Q-77, EC-125)
- Who: Admins, and PMs who can edit one of this client's Planning or Active projects, including co-PMs (Q-81, Q-86). Demo switch (PM only): Demo: this PM can't edit any Planning or Active Acme project
- Turn on modal: Turn on portal access? · We'll email a password invite. They'll see only Acme Trading Corp. projects where they're an active contact, shared documents and client-facing issues. View only. · Contact · Email * · Sign-in: Password, on the client portal · Microsoft sign-in isn't available on the portal. · This change is recorded in the audit log. · Cancel · Send invite · Sending…
- Validation: Enter an email address. · Enter a valid email address.
- Email in use (422 PORTAL_EMAIL_EXISTS): This email already has portal access through another contact. Use a different email address.
- Server error: We couldn't send the invite. Check your connection and try again.
- Success: Portal invite sent to {email}. The link expires in 7 days.
- Resend: New invite sent to {email}. The old link no longer works. Recorded in the audit log.
- Turn off confirm: Turn off portal access? · {Name} will be signed out of the client portal at once and can't sign in again until access is turned back on. · This change is recorded in the audit log. You can turn it back on later; they'll get a new invite. · Cancel · Turn off and sign out
- Turn off toast: Portal access turned off for {Name}. They've been signed out. Recorded in the audit log.
- Audit note: Portal access changes and invites are recorded in the audit log with who made the change, when, and the old and new status.
- Empty: No contacts yet. Add a contact first, then you can give them portal access.

**Share toggles (unchanged from first pass)**
- Documents column: Share with client · Shared / Not shared · archived documents: toggle disabled, "Archived documents can't be shared." · Who: anyone who can edit the project (Q-86)
- Confirm on: Share with client? · Acme Trading Corp. client users on this project will be able to see and download "{doc}". · Share
- Confirm off: Stop sharing with client? · Acme Trading Corp. client users will no longer see "{doc}". Links they already have will stop working. · Stop sharing
- Issue card: Client-facing · Off by default. When on, Acme's client portal users can see this issue's title, status, priority and dates. Comments are never shown in the portal.
- Confirm on: Make this issue client-facing? · Acme Trading Corp. client users on this project will see {issue} (title, status, priority and dates). Comments are never shown in the portal. · Make client-facing; off: Make this issue internal? · Make internal
- All confirms: This change is recorded in the audit log with the old and new value.
- Toasts: Shared with client. / No longer shared with client. / Issue is now client-facing. / Issue is now internal. + "Recorded in the audit log."

**Viewer no access**
- 403 · You don't have access to this page · Ask an Admin if you think you should. · Go to Projects

**Locked day (staff, AC-52.8)**
- Log task time / Add quick activity (disabled) · tooltip and toast: This day is locked · Demo switch: Demo: day locked

## How Q-77 to Q-81 are applied (v0.9.13)
- **Q-77:** lockout after 5 failed attempts (confirmed by Lean) for 15 minutes; copy says both. 7-day invites, 12-character passwords, off → on sends a new invite, session-expired message with no reason.
- **Q-78:** "Forgot password?" and all reset wording removed; sign-in says to ask the Xceler8 PM for a new invite.
- **Q-79:** every task owner in the portal shows "Xceler8".
- **Q-80:** Issues list (priority, status, raised, due) plus a view-only detail page (title, status, priority, dates). Severity and stage removed.
- **Q-81:** toggle and Invite for Admins and PMs of the client's Planning or Active projects; a demo switch shows the non-qualifying PM (label only).

## Decided
- **Comments (Lean, 2026-10-13):** portal users see no comments at all, on issues or anywhere else. A per-comment client-facing flag comes in a later round. This replaces "client-facing comments" in doc 11 Q-80 wording.
- **Lockout:** 5 failed attempts, 15 minutes (Lean; doc 11 v0.4.25).

## Proposed defaults Q-82 to Q-86 (Rich, doc 11 v0.4.27; pending Lean or Jomerson)
- **Q-82:** Priority shows the issue's severity. The labels match doc 13 exactly: Critical, High, Medium, Low. Applied in v0.9.14.
- **Q-83:** a Closed issue shows Resolved only if it was resolved before closing. The row is hidden when there's no date. Applied.
- **Q-84 — ON HOLD (Jomerson, Oct 13): client invites stay off until an email service exists.** Mockup v0.9.15 hides Invite, Resend invite and the pending/expired states; turning access on shows an on-hold message. Testing uses a preview-only portal account. Original proposal: the invite is a one-time link shown once (7 days, single use) until email exists. **Not applied yet.** The "Copy invite link" step and pending-row wording wait for the decision.
- **Q-85:** re-inviting an active account ends its sessions and forces a new password. Applied as the Resend confirm.
- **Q-86:** controls go to the people who can edit the project, including co-PMs. This covers Portal access, Share with client and Client-facing. Applied in the copy.
- Per-IP limit of 20 failed sign-ins in 15 minutes (429 `TOO_MANY_ATTEMPTS`). Rich proposed it; it isn't numbered. Applied as a sign-in state.

Dates show as "Oct 7" everywhere (no leading zero).

## Open questions / spec gaps
1. Q-77 to Q-81 are still build defaults pending Jomerson.
2. Phase Target needs `phases[].plannedEnd` in the contract (asked of Deven).
3. Q-79 says owners show as "Xceler8". If a task is owned by the client contact, should it show their name? The mockup shows "Xceler8" for every task.
4. Whether a PM qualifies under Q-81 is checked at request time (EC-124). The mockup shows it with a demo switch only.
5. Self-service reset waits for email notifications (Q-78). Reset screens aren't designed.
6. Some Contacts help text still says "client users". It should be reworded to "portal users" in a later pass.
