# Test cases: Microsoft 365 sign-in and send flows (PRs #27, #28, #29, #32, #34, #35, #36, #37; open PR #41)
Covers Microsoft 365 sign-in on web and mobile, DAR Send through Microsoft Graph, action emails (follow-up, task assigned, added to project), the mobile one-time code with PKCE, and the mobile app work in open PR #41 (`feature/mobile-email-dar` @ `996d0a5`). Written against main `1f6492e` (doc 14 v1.2.28). All times are Philippine time (Asia/Manila). "API" cases call the backend directly. Microsoft and Graph can be mocked for API cases, as the repo's own tests do.

**Status column:** **needs Jomerson's tenant** = needs a real Microsoft 365 account or mailbox in the allowed tenant (consent, a real `/me/sendMail`, Sent Items). **needs phone** = needs a real Android or iOS device with a build of PR #41. **API (mock)** = can run offline with mocked MSAL and Graph. **Expected FAIL** = the code at `1f6492e` doesn't match the expected result (see the defect list in `review_oct22_jonathanbot.md`).

IDs continue the per-milestone letter scheme in `docs/qa` (A–N, P–T and CP are taken; O is skipped). This set uses **TC-U01 to TC-U66**.

## Microsoft 365 sign-in: web (FR-SSO-01 to 05, PR #27, #32)

> **2026-10-22 15:50 SGT:** Jomerson checked web Microsoft sign-in on his own tenant and it works. Cases still marked "needs Jomerson's tenant" in this section are covered at that smoke level only. Expected-FAIL cases (TC-U05 auto-created Viewer, TC-U12 silent relink) are spec questions and remain open (CR-02, CR-15).
| ID | Case | Expected | Traces | Status |
|---|---|---|---|---|
| TC-U01 | `GET /auth/providers` with all `MS_*` set, allowlists filled and `EDGE_PROXY_SECRET` at 32+ characters; repeat with an empty tenant allowlist, an empty domain allowlist, and a 31-character secret | `{microsoft:true}` only in the fully configured case. Otherwise `false` and the login page shows no Microsoft button. With a 31-character secret the API refuses to start | FR-SSO-01, PR #27 | API (mock) |
| TC-U02 | Login page → "Sign in with Microsoft" as an active staff user already linked to Microsoft (allowed tenant) | Goes to Microsoft with `state`, `nonce`, S256 PKCE and `prompt=select_account`; comes back signed in to the web app; `lastLoginAt` updated; failed-login count cleared | FR-SSO-02, FR-SSO-04 | needs Jomerson's tenant |
| TC-U03 | Account from a tenant that isn't on the allowlist (e.g. a personal Microsoft account or another company's tenant) | Back to `/login?error=ms_signin_failed`; no user created or linked; no session | FR-SSO-02 | needs Jomerson's tenant (other tenant) / API (mock) |
| TC-U04 | Guest (B2B) account in the allowed tenant (`acct`=1), a token with no `acct` claim, and a token whose `idp` is from a different issuer | All refused (`ms_signin_failed`); nothing created or linked | FR-SSO-02 | API (mock) |
| TC-U05 | **Doesn't auto-create users:** an allowed-tenant, allowed-domain Microsoft account whose email matches no OpsTrack user | **Expected per this request:** refused with "ask an Admin to invite you"; no user created. **As built (doc 14 FR-SSO-04 v1.2.26, approved by Jonathan):** a Viewer with no job role is created and signed in (audit `sso_user_created`). Jomerson needs to confirm which rule applies | FR-SSO-04, Q-37 | **Expected FAIL** (D2, needs a decision) |
| TC-U06 | Existing password user (same email, allowed domain) signs in with Microsoft for the first time | Linked: `msOid`/`msTid` stored, audit `sso_linked`; signed in with the same role, projects and data; password sign-in still works afterwards | FR-SSO-04 | needs Jomerson's tenant |
| TC-U07 | Existing user whose email domain isn't on `MS_ALLOWED_DOMAINS` | Not linked (`link_denied` in the log); `ms_signin_failed`; account unchanged | FR-SSO-04 | API (mock) |
| TC-U08 | Deactivated user tries Microsoft sign-in, both linked (match by `msOid`) and not yet linked (match by email) | Refused (`ms_signin_failed`); no session; account stays deactivated | FR-SSO-05, EC-36 | API (mock) + needs Jomerson's tenant |
| TC-U09 | User deactivated by an Admin while signed in through Microsoft | Next API call returns 401 `SESSION_EXPIRED`; all their sessions removed | EC-36, TC-A12 | API (mock) |
| TC-U10 | Client contact email (portal) tries Microsoft sign-in | Never linked or created (`client_contact`); portal access stays password/invite only | FR-SSO-05, doc 11 FR-ACL-29 | API (mock) |
| TC-U11 | Already-linked user whose Entra email changed | Still signs in to the same OpsTrack user (matched by `oid`+`tid`), no new user | FR-SSO-04 | API (mock) |
| TC-U12 | Entra account A is linked to user X. A different Entra account B in the same tenant whose `email` claim equals X's email signs in | Refused and audited; X stays linked to A (no silent relink) | FR-SSO-04 | **Expected FAIL** (D3: relinks to B) |
| TC-U13 | Microsoft-only user (no password) tries email + password sign-in and forgot-password | `INVALID_CREDENTIALS` ("Email or password is incorrect."); no hint the account exists | FR-AUTH-01 | API (mock) |
| TC-U14 | Password sign-in regression: active password user, wrong password ×N (lockout), invited user, Admin | Same as before #27: success, lockout after the limit, invited user can't sign in until they set a password | FR-AUTH-01..05, TC-A01..A05 | API |
| TC-U15 | Callback with a missing or tampered `xc8_ms_oauth` cookie, a state that doesn't match, or a replayed `code` | `/login?error=ms_signin_failed`; no session; cookie cleared | FR-SSO-03 | API (mock) |
| TC-U16 | ID token with a different nonce than the auth URL (#32) | Refused; a token with the right nonce passes (no `nonce_mismatch` regression) | PR #32 | API (mock) |
| TC-U17 | Token with no `email` claim (only `preferred_username`) | `/login?error=ms_no_email` with its own message; `preferred_username` never used | FR-SSO-04 | API (mock) |
| TC-U18 | More than `AUTH_RATE_LIMIT_MAX` Microsoft login/callback hits in the window from one IP | 429 from the sign-in limiter; the DAR Send and action-email callback legs don't use this bucket | NFR rate limit, D5 | API |
| TC-U19 | Users list as Admin: a Microsoft-created or linked user with no password | Status **Active** (not Invited); job role "Not set" until an Admin sets it; filter Active/Invited correct | FR-USR, PR #27 | API + UI |

## Microsoft 365 sign-in: mobile (PR #28)

> **2026-10-22 15:50 SGT:** Jomerson checked mobile Microsoft sign-in on his own tenant and it works (smoke level).
| ID | Case | Expected | Traces | Status |
|---|---|---|---|---|
| TC-U20 | App → "Sign in with Microsoft" → browser → Microsoft → back to the app | `opstrack://auth/microsoft?code=…`; the app exchanges the code with its verifier at `POST /auth/mobile/microsoft/exchange` and gets a bearer session; lands on home | PR #28 | needs phone + Jomerson's tenant |
| TC-U21 | `GET /auth/mobile/microsoft/login` with a missing or short `code_challenge`, or `code_challenge_method=plain` | Redirect to `opstrack://auth/microsoft?error=ms_signin_failed`; nothing stored | PR #28 | API (mock) |
| TC-U22 | Exchange the same one-time code twice | First 200; second 400 `INVALID_CODE` ("Sign-in expired. Try again."); one mobile session only | PR #28 | API (mock) |
| TC-U23 | Exchange at +59 s and at +61 s after the callback; callback more than 10 minutes after login | 59 s works; 61 s gives 400 `INVALID_CODE`; a callback after 10 minutes gives `ms_signin_failed` | PR #28 | API (mock); real-time on phone: needs phone |
| TC-U24 | Exchange with a wrong verifier, then with the right verifier | Both 400; the wrong attempt spends the code | PR #28 | API (mock) |
| TC-U25 | Exchange called from a browser (Origin / browser user agent) | 403 `MOBILE_ONLY` | PR #28 | API |
| TC-U26 | User cancels on the Microsoft page | App shows "cancelled"; pending record removed; can try again | PR #28 | needs phone |
| TC-U27 | Mobile refusals: wrong tenant, guest, no email, deactivated, client contact | Error link back to the app with a clear message; no code issued; no session | PR #28 | API (mock) |
| TC-U28 | A stored `ptl_` (client portal) token on the phone at app start | Not restored; user sees the sign-in screen | D6 (PR #21), PR #41 D3 | needs phone / flutter test (CI doesn't run Flutter) |

## DAR Send via Microsoft Graph (FR-DAR-20 to 27, PR #29, #35)
| ID | Case | Expected | Traces | Status |
|---|---|---|---|---|
| TC-U29 | Linked Member with a supervisor and 2 CC emails opens a saved DAR → Send | Confirm dialog shows To: supervisor name, CC list "(Set by Admin)" and the PDF note; Cancel sends nothing; Send → Microsoft (first time: Mail.Send consent) → back to `/dar/saved?sent=…`; the email is in the user's Sent Items with the PDF; subject "DAR – {name} – {range}" | FR-DAR-20, FR-DAR-21 | needs Jomerson's tenant |
| TC-U30 | Recipients come from the server: change the supervisor or CC in Admin after saving the report, then Send | Goes to the current supervisor and CC (not the saved copy); CC drops duplicates of To and the sender; at most 5 | AC-57.6, FR-DAR-12 | API (mock) |
| TC-U31 | Client tries to choose recipients: `POST /dar/saved/:id/send` with a body such as `{"to":"x@outside.com"}` | 400 (body must be empty); nothing started | FR-DAR-20 | API |
| TC-U32 | Send is not a GET; the POST needs the CSRF header and an allowed Origin | GET → 404/405; POST without CSRF or from another Origin → 403 | D1 | API |
| TC-U33 | **Viewer** opens `/dar`, calls `GET /dar/send-status`, `POST /dar/saved/:id/send`, `/send/mobile`, `/notify-supervisor` | Menu item hidden; page shows "You don't have access to this page"; every API call 403 `FORBIDDEN` | FR-ACT-35, AC-56.1, Q-70 B | API + UI |
| TC-U34 | Another user (Member, PM, **Admin**) tries Send or Notify on someone else's saved report id, and on a made-up id | 404 for all (never 403, never sent) | NFR-25, FR-ACL-17, AC-57.2 | API |
| TC-U35 | Password-only user (not linked) | No Send button; "Notify supervisor" shown; `POST …/send` returns 409 `SEND_UNAVAILABLE` (`not_linked`) and is audited `report_send_failed` | AC-57.4, FR-DAR-24 | API + UI |
| TC-U36 | Linked user with no supervisor, or an inactive supervisor | Send disabled with "Ask an Admin to set your supervisor."; API 409 (`no_supervisor`), audited | FR-DAR-20, D6 | API |
| TC-U37 | Microsoft sign-in switched off (`msEnabled` false) | No Send button; API 409 (`not_enabled`), audited | FR-DAR-20 | API |
| TC-U38 | Double-click Send; open two tabs and Send from both; press Back and Send again | One email per completed Microsoft round trip. The earlier tab's state is replaced, so its callback sends nothing. A replayed callback (same state) sends nothing and is audited `state_reused` | FR-DAR-20, FE-11 | API (mock) for replay; two-tab real send: needs Jomerson's tenant |
| TC-U39 | Report already marked **Sent** → Send again | Confirm dialog should say it was already sent (date/time PH) and ask to send again; on confirm, sends and updates Sent time | FR-DAR-20, PR #35 | **Expected FAIL** (D5: no "already sent" warning) |
| TC-U40 | Graph slow: response takes more than 20 s (timeout) after Graph accepted the mail | User told the result is unknown and to check Sent Items/Sent status before retrying; must not be shown as "failed – try again" | FR-DAR-23 | **Expected FAIL** (D4) – API (mock) |
| TC-U41 | Error mapping: consent declined, admin consent needed (AADSTS65001/90094), wrong Microsoft account (other oid/tid, guest), token without Mail.Send, no mailbox (`MailboxNotEnabledForRESTAPI`), Graph 401/403/429/5xx, PDF over 2.5 MB | `send_error` = `consent_declined`, `admin_consent_required`, `wrong_account`, `consent_declined`, `no_mailbox`, `ms_auth_failed`/`send_forbidden`/`graph_unavailable`, `too_large`; each shows its doc 14 §11 message; each audited `report_send_failed` without the token or code; nothing sent | FR-DAR-22, FR-DAR-23, AC-57.3, AC-57.7 | API (mock); consent/admin-consent screens: needs Jomerson's tenant |
| TC-U42 | 31 Sends in 15 minutes by one user | 31st gets 429 `DAR_SEND_RATE_LIMITED` with the doc 14 §11 text; the user's sign-in isn't blocked | FR-DAR-20, D5 | API |
| TC-U43 | Notify supervisor twice within an hour; double-click Notify | One in-app DAR_READY notice; second gets 409 `NOTIFY_RECENT`; linked user gets 409 `USE_SEND` | FR-DAR-24, D7 | API |
| TC-U44 | **Sent status and PH time**: send at 23:50 PHT on Oct 22 (15:50 UTC) and at 00:10 PHT on Oct 23 (16:10 UTC Oct 22) | Saved list and report show "Sent" with the PH date and 12-hour time "(PH)" (Oct 22 11:50 PM; Oct 23 12:10 AM) and "· N people"; a failed send leaves an earlier Sent status unchanged; filter Sent / Not sent correct | PR #35, NFR PH time | API (mock clock) + UI |
| TC-U45 | Report sent before PR #35 (only a `report_sent` audit entry exists) | Shows Sent with the audit time and recipient count | PR #35 | API |

## Action emails (roadmap §4, PR #34)
| ID | Case | Expected | Traces | Status |
|---|---|---|---|---|
| TC-U46 | Flag `EMAIL_NOTIFICATIONS_ENABLED` off (default) | No "Email …" box anywhere; `GET /auth/me/email-status` `enabled:false`; `POST /action-emails` 409 `EMAIL_DISABLED`; saves and in-app notices unchanged | Roadmap §4 | API + UI |
| TC-U47 | Flag on, user not linked to Microsoft | Box shown but disabled with "Link your Microsoft account to send emails."; API 409 `MICROSOFT_NOT_LINKED`; the save still goes through | Roadmap §4 | API + UI |
| TC-U48 | **Follow-up:** author posts a follow-up with "Email the team" ticked | One email per in-app recipient (task owner, assignees, reviewer, project PM), never the author; from the author's Outlook (in Sent Items); note escaped; link to `WEB_APP_URL/projects/{id}?task={id}` | FR-NTF-01, AC-40.1 | needs Jomerson's tenant |
| TC-U49 | Follow-up email by someone who isn't the author; with an extra field such as `to` in the body | 403 "Only the author can email a follow-up."; 400 for extra fields | FE-13 | API |
| TC-U50 | Follow-up emailed, then the author tries again (button, double-click, second tab, replayed callback) | Sent once; later attempts 409 `ALREADY_EMAILED` or callback `already_emailed`; Graph failure for everyone resets it so it can be retried | FE-11 | API (mock) |
| TC-U51 | **Task assigned:** PM creates a task with owner + 2 assignees and "Email new assignees" ticked | Emails the owner and assignees except the PM; unticked → in-app only, no email | FR-NTF-05 | API (mock) + needs Jomerson's tenant |
| TC-U52 | **No duplicate on re-save:** edit the same task again without changing people (ticked); then add one more assignee (ticked) | First re-save: `NO_RECIPIENTS`, no email. Second: only the newly added assignee is emailed | E1 (QA-P2) | API (mock) |
| TC-U53 | **Added to project:** create a project with a team; edit to add 2 members and change the manager (ticked) | Create: everyone except the creator. Edit: exactly the 2 new members plus the new manager. Existing members never emailed | FA-03, FA-08 | API (mock) |
| TC-U54 | Client tries to name recipients: `kind: PROJECT_ADDED`, `userIds`, or `recipientIds` in the body | 400; recipients are worked out only from the server's before/after diff | FE-13 | API |
| TC-U55 | **No email to clients/outsiders:** a client contact on the project, an inactive user, and a user removed from the project between start and callback | None of them get an email; only active internal users currently on the project; a user removed meanwhile is dropped at send time | AC-40.1, NFR-25 | API (mock) |
| TC-U56 | Outsider (not on the project) or Viewer calls `POST /action-emails` with a real task and follow-up id | 404 for an outsider (project not visible); Viewer refused (can't be a follow-up author); nothing sent | NFR-25 | API |
| TC-U57 | Partial send: Graph refuses one of three recipients | `email=partial`; banner "Some emails couldn't be sent"; each failure audited without the token; `action_email_sent` records 2 | AC4 | API (mock) |
| TC-U58 | Archived project between start and callback | Nothing sent; `email_error=project_archived` | Roadmap §4 | API (mock) |
| TC-U59 | Web: start two action emails in two tabs before finishing the first | First tab's callback should return to its project with a clear "email expired, try again" message | Roadmap §4 | **Expected FAIL** (D7: lands on `/login?error=ms_signin_failed`) |

## Mobile return path: one-time code + PKCE (PR #36, #37)
| ID | Case | Expected | Traces | Status |
|---|---|---|---|---|
| TC-U60 | Mobile DAR Send / follow-up / task / project save with `emailReturn:'mobile'` | Start needs a bearer token and an S256 `code_challenge` (no return URL accepted; web cookie → 403 `MOBILE_ONLY`); after Microsoft the browser goes to `opstrack://auth/mail?code=…` (no Microsoft token, code or state in the link); `POST /auth/mobile/mail/confirm` with the verifier returns `flow` (`dar`, `action_email`, `task_assigned`, `project_added`), ids and `recipients` | PR #36, #37 | API (mock); full round trip: needs phone + Jomerson's tenant |
| TC-U61 | Confirm at +59 s and +61 s | 59 s → 200; 61 s → 400 `INVALID_CODE` ("This send result has expired or was already read.") | PR #36 | API (mock clock); real device timing: needs phone |
| TC-U62 | Confirm twice; confirm with a wrong verifier then the right one; confirm as another user; confirm with a web cookie | Second confirm 400; wrong verifier 400 and the code is spent; another user 400 and the code still works for the owner; cookie → 403 `MOBILE_ONLY` | PR #36 | API |
| TC-U63 | Bad, missing, expired or replayed state on the callback | Never redirects to `opstrack://`; goes to `/login?error=ms_signin_failed`; nothing sent | PR #36 | API (mock) |
| TC-U64 | Result can't be stored after the mail went out | Exactly `opstrack://auth/mail?error=result_unavailable`; the app says "We couldn't confirm whether the report was sent. Check its Sent status before sending again." and refreshes the report | PR #36, PR #41 | API (mock) + needs phone |
| TC-U65 | **App doesn't open from the link** (browser blocks `opstrack://`, app killed, user returns by hand) | Coming back to the app with no link: after about 3 s it rereads the report; shows Sent if `sentAt` moved since the start, otherwise "no result"; a cold start from a late link still shows the result; device clock set 5 min wrong still gives the right answer | PR #41 | needs phone (clock-skew part: possible issue D10) |
| TC-U66 | Forged links: `opstrack://auth/mail` with no code, a random code, or a code for another flow/report | App never shows "sent" from a link alone; mismatched flow/ids ignored; the real result can still be confirmed | PR #41 E2, G3, G4 | needs phone / flutter test |

## Open PR #41 (mobile UI for DAR Send and action emails)
PR #41 is open, not merged, GitHub says mergeable (clean), CI "Lint, typecheck, test, build" passed on `996d0a5`. CI doesn't run Flutter; the 278 Flutter tests in the PR text weren't checked here because Flutter isn't installed on this box. On a phone with a PR #41 build, run TC-U20, U26, U28, U29 (mobile card: To/CC preview, password-only text, no-supervisor text), U44 (Sent / Not sent badge on its own line), U48 and U51 to U53 (boxes "Email the team", "Email {name}", "Email new assignees", "Email new members"), and U60 to U66.
