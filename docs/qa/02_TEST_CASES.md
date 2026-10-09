# 02 · Phase 1 Test Cases

Type: **UI** = through the app; **API** = call the backend directly; **Both**. Priority: **P1** = core regression, **P2** = full regression, **P3** = full pass only.
Roles used: Admin, PM (owner of project P), PM2 (other project), Member (on P), Outsider (Member not on P), Viewer, Deactivated user, Contact (client contact of P's client), Contact-X (contact of another client).

## A. Authentication and sessions (US-01)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-A01 | AC-01.1 | UI | P1 | Sign in as an active Member | Lands on My tasks until Milestone 4, then the Dashboard |
| TC-A02 | AC-01.2 | Both | P1 | Sign in with (a) a wrong password, (b) an unknown email | Same "Email or password is incorrect"; same status code and similar response time |
| TC-A03 | AC-01.3, G-5 | Both | P1 | Fail 5 times in a row, then try the correct password; wait 15 min and retry | Locked with a message; correct password refused while locked; works after 15 min; lockout is per account, and a separate per-IP rate limit applies |
| TC-A04 | AC-01.4 | Both | P1 | Deactivated user signs in with correct credentials | Denied |
| TC-A05 | AC-01.5, G-4 | Both | P1 | Idle 30 min, then click; also call an API with the old session | Redirected to sign-in; API returns 401 with no data |
| TC-A06 | AC-01.6, EC-21 | API | P1 | Call sign-in, forgot-password, and set-password endpoints with Contact's email (incl. one that matches an internal user's email) | Identical to unknown-user failure; the internal user with the same email still signs in normally |
| TC-A07 | AC-02.2 | UI | P1 | New user signs in first time | Forced to set a password before anything else |
| TC-A13 | FR-AUTH-02 | Both | P1 | On first sign-in, reset, and change password (UI and API): `Abc12!x` (7), `abcdefg1` (no symbol), `abcdefg!` (no number), `Abcdef1!` (8, valid) | Only the last is accepted; others show "Use at least 8 characters, including a number and a symbol."; API enforces the same rule |
| TC-A15 | AC-01.5b | API | P2 | Keep a session active (a request every 10 min) for 12 h | Session ends at the 12 h absolute cap with 401 even though it was never idle |
| TC-A14 | FR-AUTH-04/05 (email deferred) | Both | P1 | Admin copies an invite link and a reset link ("Copy reset link" in the users list) and opens each; reuse a used link; open an invite at 72 h + 1 min and a reset at 24 h + 1 min; generate a new link, then open the earlier unused one | Each link works once; used, expired, and replaced links are refused; no email is sent; the sign-in page has no "Forgot password?" and tells people to ask an Admin |
| TC-A08 | NFR-02 | API | P1 | Inspect cookies/storage after sign-in | httpOnly, Secure, SameSite=Lax; no tokens in localStorage |
| TC-A09 | NFR-05 | API | P2 | Fire 50 sign-in requests in a minute | Rate-limited (429) |
| TC-A10 | NFR-03 | API | P2 | Send a state-changing request without CSRF token / from another origin | Rejected |
| TC-A11 | EC-35 | UI | P2 | Let session expire mid-form, re-auth | Form data preserved; can resubmit |
| TC-A12 | EC-36 | API | P1 | Admin demotes a signed-in PM; PM makes next request | New permissions apply immediately (403 on PM-only action) |

## B. Users, roles, teams (US-02, US-03)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-B01 | AC-02.1 | UI | P1 | Admin creates a user; then another with the same email (different case) | First saved; second "Email already in use" |
| TC-B02 | AC-02.3 | API | P1 | PM, Member, Viewer call user-create and role-change | 403 each |
| TC-B03 | AC-02.4 | API | P1 | PM changes own role to Admin | 403 |
| TC-B04 | AC-02.5 | UI | P2 | Deactivate a user with tasks and time | Tasks and entries remain, labelled "(inactive)" |
| TC-B05 | EC-26 | API | P1 | Last active Admin demotes / deactivates self | Rejected |
| TC-B06 | EC-25 | UI | P2 | Deactivate an accountable owner of open tasks | Tasks flagged "owner inactive" on dashboard and project |
| TC-B07 | AC-03.1 | UI | P2 | Create, rename, archive a team; add a user to 2 teams | All succeed |
| TC-B08 | AC-03.2 | UI | P2 | Archive a team with open tasks | Warning lists those tasks |
| TC-B09 | G-7, FR-USR-02/03 | UI | P2 | Invite form | Separate Access role (Admin/PM/Member/Viewer) and Job role fields |

## C. Clients and contacts (US-04 to US-06) — Critical isolation area
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-C01 | AC-04.1 | UI | P2 | Create contact without name/company; with bad email | Blocked with field errors |
| TC-C02 | AC-04.2 | Both | P1 | Open user list, assignee picker, owner picker; call user-list API | No contacts anywhere |
| TC-C03 | AC-04.3, AC-05.5 | UI | P2 | Open contacts screen and a tagged task | No-login notices shown |
| TC-C04 | AC-05.1 | UI | P1 | Set responsible party = Client, save without contact | Blocked |
| TC-C05 | AC-05.2 | UI | P2 | Open contact picker on P | Only active contacts of P's client |
| TC-C06 | AC-05.3 | API | P1 | Tag Contact-X on a task in P | 400 |
| TC-C07 | AC-05.4 | API | P1 | Tag Contact; query DB/users API for an account; try every auth endpoint as Contact | No account, password, or session; no data returned |
| TC-C08 | EC-22 | API | P1 | Set password/role on a contact; put contact id in assigneeIds/ownerId | 400/403 |
| TC-C09 | AC-06.1 | UI | P2 | Contact with 3 open client tasks, 1 overdue | Pending 3, overdue 1 |
| TC-C10 | AC-06.2 | UI | P2 | Add follow-up note | Author + time recorded, shown in task history |
| TC-C11 | AC-06.3 | UI | P1 | Dashboard "Waiting on client" | Sorted by due date; "Nd overdue" / "Due tomorrow" / date labels correct |
| TC-C12 | EC-23 | UI | P2 | Deactivate a tagged contact | Tag shows "(inactive)"; PM prompted to reassign |
| TC-C13 | EC-24 | Both | P2 | Change P's client while old-client contacts are tagged | Blocked until cleared |
| TC-C14 | NFR-09 | API | P2 | Viewer / Outsider requests contact email/phone | Only authorized internal users get it |

## D. Templates and versioning (US-07, US-08)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-D01 | AC-07.1 | UI | P2 | Save draft with phases and activities using all FR-TPL-03 fields | Saved as Draft |
| TC-D02 | AC-07.2, AC-16.3 | Both | P1 | Create A→B→A, then A→B→C→A | Rejected; message names the activities |
| TC-D03 | AC-07.3 | UI | P1 | Open seeded SAP B1 template | 10 activities in blueprint order with parties and deliverables |
| TC-D04 | AC-07.4 | Both | P2 | Publish with 0 activities | Rejected |
| TC-D05 | AC-08.1 | UI | P1 | Edit and publish v3 | Becomes v4; v3 readable |
| TC-D06 | AC-08.2, EC-48 | Both | P1 | Project from v3; publish v4 with changed tasks, estimates, phase names | Project unchanged; shows "template snapshot v3"; folder names unchanged |
| TC-D07 | AC-08.3, EC-14 | UI | P2 | Draft / Archived templates in New project picker | Not listed; archived template's projects unaffected |
| TC-D08 | EC-11 | UI | P2 | PM previews v3; another user publishes v4; PM clicks Generate | Warned and asked to re-preview |
| TC-D09 | EC-12 | UI | P3 | Delete an activity another depends on in draft | Dependency removed with warning |
| TC-D10 | AC-24.3 | Both | P2 | Edit default folders in template | New template version; existing projects' folders unchanged |

## E. Projects and plan generation (US-09 to US-11)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-E01 | AC-09.1 | Both | P1 | Submit with each required field missing | Blocked (UI) / 400 (API) |
| TC-E02 | AC-09.2 | UI | P1 | End = start; end < start | "End date must be after the start date." |
| TC-E03 | AC-09.3 | UI | P2 | Select SAP B1 | "Generates 10 activities, D dependencies and V deliverables" + preview |
| TC-E04 | AC-09.4, EC-37 | Both | P1 | Generate plan | Exactly N tasks; dependencies match; dates = baseline start + offsets (working days per settings) |
| TC-E05 | AC-09.5 | API | P1 | Inspect created project | Status Planning; template id + version stored |
| TC-E06 | AC-09.6 | API | P1 | Force a failure mid-generation (e.g. DB fault injection / invalid activity) | No partial project, tasks, or folders remain |
| TC-E07 | EC-13 | UI | P2 | Template chain exceeds baseline end | Generated; "Plan exceeds baseline end by N days"; health reflects it |
| TC-E08 | EC-27, EC-29 | UI | P3 | Past baseline end; duplicate name for same client | Allowed with warnings |
| TC-E09 | AC-10.1, AC-10.2 | Both | P1 | PM edits owner, assignees, estimates, dates, contact; adds/removes task | Saved; template unchanged |
| TC-E10 | AC-10.3 | UI | P1 | Activate with a task lacking an owner | Blocked; message lists tasks |
| TC-E11 | AC-10.4 | API | P1 | Member edits due date, estimate, owner, dependencies | 403 each |
| TC-E12 | AC-11.1, EC-03 | Both | P1 | 10 tasks, 2 cancelled, 4 completed; project with 0 tasks; all cancelled | 50%; 0%; 0%, health On track |
| TC-E13 | AC-11.2 | UI | P2 | Forecast end vs baseline end: +3, 0, −2 | "+3 days", "0 days", "−2 days" |
| TC-E14 | AC-11.3, G-1 | UI | P1 | Seeded projects per state, incl. overdue optional task with variance 0, and an On Hold project | Evaluated Delayed, then At risk, then On track; variance 0 + overdue optional = At risk; On Hold shows "On hold" |
| TC-E15 | AC-11.4 | UI | P2 | Projects filters | Counts match data |
| TC-E16 | EC-28, G-2 | Both | P2 | Put project On Hold | Excluded from Delayed/At risk counts; time logging refused by server |

## F. Task board, state machine, dependencies, approvals (US-12 to US-17)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-F01 | AC-12.1 | UI | P2 | Open board | 5 columns with counts; card fields per AC |
| TC-F02 | AC-12.2 | Both | P1 | Drag a valid move; use "Move to…" picker | Status updated; audit entry written |
| TC-F03 | AC-12.3 | UI | P1 | Invalid moves (dependency, approval, blocked) | Refused with message; card returns |
| TC-F04 | Workflow §2 | API | P1 | Call status endpoint for every transition not in the state machine (e.g. ToDo→Completed, Cancelled→anything, Member cancels mandatory) | 400/403 each |
| TC-F05 | AC-12.4 | UI | P2 | Filter by assignee | Only tasks where person is owner or assignee |
| TC-F06 | AC-13.1, AC-13.2 | Both | P1 | Block with empty reason; with reason; unblock | Empty refused; unblock returns to previous status; reason in history |
| TC-F07 | EC-19 | UI | P2 | Blocked task past due | Counts as overdue and blocked |
| TC-F08 | AC-14.1 | Both | P1 | Evidence 25.1 MB; disallowed type | Rejected with FR-DOC-13 messages |
| TC-F09 | AC-14.2, AC-14.3 | Both | P1 | Requires-approval task → Completed without evidence; with evidence | Without: refused. With: For Review, "Approval pending" |
| TC-F10 | AC-15.1 | UI | P2 | PM vs Member on For Review task | Only PM sees Approve/Reject |
| TC-F11 | AC-15.2 | Both | P1 | Approve; reject without comment; reject with comment | Completed + approver/time; refused; In Progress |
| TC-F12 | AC-15.3 | API | P1 | Member calls approve | 403 |
| TC-F13 | EC-20 | Both | P2 | PM approves own task | Allowed; audited as self-approval |
| TC-F14 | AC-16.1 | Both | P1 | Start / complete a task with incomplete predecessor | Refused; message names predecessor |
| TC-F15 | AC-16.2 | Both | P2 | PM override without / with reason | Requires reason; logged |
| TC-F16 | EC-15 | API | P1 | In a running project add A→B then B→A | Rejected server-side |
| TC-F17 | EC-16, EC-17 | UI | P3 | Cancel predecessor; reopen completed predecessor | Satisfied with note; dependents stay with warning |
| TC-F18 | EC-18 | API | P1 | Two sessions update same task with same version | Second gets "This task changed, refresh" (409) |
| TC-F19 | AC-17.1 | UI | P2 | My tasks across 2 projects | All open owned/assigned, by due date, overdue first; overdue doc requests included (FR-DOC-26) |
| TC-F20 | EC-09 | API | P2 | Hard-delete task with time entries | Blocked; must cancel |
| TC-F21 | EC-31 | Both | P3 | Member removes evidence from Completed approved task | Only PM/Admin; audited |
| TC-F22 | NFR-15 | UI | P2 | Change status by keyboard only | Possible without drag |

## G. Time logging and timesheets (US-18, US-19)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-G01 | AC-18.1, EC-06 | Both | P1 | Hours 0, 0.1, 0.25, 24, 24.25, 1.3 | 0.25 and 24 accepted; others "Enter between 0.25 and 24." |
| TC-G02 | AC-18.2 | Both | P1 | Future work date | Rejected (UI and API) |
| TC-G03 | AC-18.3, EC-06 | API | P1 | Day total 23.75 + 0.25; then + 0.25 more | First OK (24); second rejected |
| TC-G04 | AC-18.4 | API | P1 | Outsider logs to P's task | 403 |
| TC-G05 | AC-18.5 | UI | P1 | Log 2 h | Actual hours and variance update on board, project, reports, workload |
| TC-G06 | AC-18.6 | Both | P2 | Log to Cancelled task / Completed project | Rejected |
| TC-G07 | AC-19.1 | UI | P2 | Week selector | Mon–Sun, total, "of Xh available (Y% utilization)" |
| TC-G08 | AC-19.2, EC-10 | Both | P1 | Member edits locked-week entry; PM edits it | Member blocked; PM allowed and audited |
| TC-G09 | EC-05 | API | P2 | 97 entries of 0.25 h | Total exactly 24.25 (no float drift) |
| TC-G10 | EC-07 | API | P1 | UTC+8 user logs at 23:30 local for "today" | Stored work date = picked date |
| TC-G11 | EC-08 | Both | P2 | Remove user from project after logging | Entries stay in reports; new entries 403 |

## H. Dashboard, workload, reports (US-20 to US-22)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-H01 | AC-20.1 | UI | P1 | Compare KPIs to seeded dataset | Exact match |
| TC-H02 | AC-20.2 | UI | P2 | Overdue card | Shows "N waiting on client" subset |
| TC-H03 | AC-20.3 | UI | P1 | Open dashboard with network inspector | AI panel labelled Phase 2; zero AI service calls |
| TC-H04 | AC-20.4, EC-38 | Both | P1 | Member dashboard and search; API list/search | Only member projects; no foreign tasks ever |
| TC-H05 | AC-21.1 | UI | P2 | Workload week vs formulas FR-WL-01/02 | Values match hand calculation |
| TC-H06 | AC-21.2, AC-21.3 | UI | P2 | Person > 100% assigned | Flagged; "not a performance score" note; waiting time separate |
| TC-H07 | EC-04 | UI | P2 | Capacity 0 | "–", excluded from team average |
| TC-H08 | AC-22.1, EC-01, EC-02 | Both | P1 | Report rows 8/12, 16/14, 10/18, 0/2, 0/0 | +4 +50%; −2 −12.5%; +8 +80%; +2 "No estimate"; 0 "No estimate"; never NaN/∞ |
| TC-H09 | AC-22.2 | UI | P1 | Filter report, export CSV | Exactly filtered rows + visible columns; UTF-8 header |
| TC-H10 | AC-22.3 | UI | P2 | Empty filter, export | Empty state; header-only CSV |
| TC-H11 | EC-32 | UI | P2 | Values with commas, quotes, line breaks, ñ, é | Escaped; UTF-8 with BOM opens correctly in Excel |
| TC-H12 | EC-33 | UI | P1 | Task named `=HYPERLINK(...)`, `+1`, `-2`, `@SUM` | Exported prefixed with `'` |
| TC-H13 | EC-34, NFR-12 | UI | P3 | Export 50,000 rows | Paginated on screen; export < 10 s |

## I. Audit log (US-23)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-I01 | AC-23.1 | Both | P1 | Perform each FR-AUD-01 change type | One entry each with user, time, field, old, new |
| TC-I02 | AC-23.2 | API | P1 | PUT/PATCH/DELETE on audit entries as Admin | Not allowed (404/405/403) |

## J. Project documents (US-24 to US-32)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-J01 | AC-24.1 | UI | P1 | Generate project from 4-phase template with extra default folder | Contracts + 4 phase folders + extra folder |
| TC-J02 | AC-24.2 | Both | P1 | PM renames default folder; tries to delete it via UI and API | Rename OK; no delete option; API 400 |
| TC-J03 | AC-25.1 | Both | P2 | Create "Minutes" then "minutes" in same parent | Second rejected |
| TC-J04 | AC-25.2 | Both | P2 | Create a 4th nesting level | Rejected |
| TC-J05 | AC-25.3 | UI | P2 | Delete non-empty custom folder | "Move or archive its documents first." |
| TC-J06 | AC-26.1 | Both | P1 | Request with each required field missing; past due date | Rejected |
| TC-J07 | AC-26.2 | Both | P2 | requested-from picker; API with Contact-X or Outsider | Only members + active client contacts; API 400 |
| TC-J08 | AC-26.3 | UI | P2 | Save a request | Requested; "Waiting on {name} · due {date}"; event "Requested by {user}" |
| TC-J09 | AC-26.4 | UI | P1 | Client request passes due date | In "Waiting on client" and contact's overdue count |
| TC-J10 | AC-26.5 | Both | P2 | Cancel without / with reason | Reason required; read-only; Cancelled; visible under All |
| TC-J11 | AC-27.1, EC-41, G-3 | Both | P1 | Upload exactly 26,214,400 B, 26,214,401 B, 0 B | Accepted; "Files must be 25 MB or smaller."; "The file is empty." |
| TC-J12 | AC-27.2, EC-42 | API | P1 | Upload `.exe`→`.pdf`, HTML→`.pdf`, zip of exes→`.docx` | All rejected by content type |
| TC-J13 | AC-27.3, FR-DOC-12 | UI | P1 | Upload existing name: default; then "Keep both" | v(n+1), v(n) unchanged; "Keep both" saves " (2)" |
| TC-J14 | AC-27.4 | UI | P1 | Upload fulfilling a request as Submitted; another as Signed | Moves to Submitted / Signed |
| TC-J15 | AC-27.5 | API | P1 | Move Submitted→Requested, Signed→Submitted, Signed→Requested | 400 each |
| TC-J16 | FR-DOC-22 | Both | P2 | Doc without requires-signature uploaded Submitted | Shown as complete |
| TC-J17 | AC-28.1, FR-DOC-25 | UI | P1 | Member uploads Signed on behalf of Contact | "by {contact} (client, recorded by {user})" in user's timezone |
| TC-J18 | AC-28.2, FR-DOC-24 | Both | P2 | Request, upload, sign, new version | Each event in lifecycle and project Activity log |
| TC-J19 | AC-29.1, FR-DOC-30 | API | P1 | As Admin: replace file, edit metadata, delete Signed version, edit its events | 403/400 each; file unchanged in storage |
| TC-J20 | AC-29.2, FR-DOC-31 | UI | P1 | Upload change to signed doc | New Submitted version; earlier stays "Signed copy", downloadable; "Signed (v3) · v4 Submitted" |
| TC-J21 | AC-29.3 | Both | P2 | Download version, compute SHA-256 | Matches shown checksum |
| TC-J22 | AC-30.1, AC-30.2 | UI | P2 | Status filter counts; partial-name search | Counts match; search limited to project |
| TC-J23 | AC-31.1 | API | P1 | Outsider calls list, metadata, upload, download-url | 403 each |
| TC-J24 | AC-31.2, EC-47 | API | P1 | Use download URL at 4 min, at 5+ min; use without sign-in after expiry; guess another storage key | Works at 4 min only; expired fails; guessed key fails; container not public |
| TC-J25 | AC-31.3 | API | P1 | Any auth/download-url call using Contact identity | Never issued |
| TC-J26 | AC-32.1, FR-DOC-17 | UI | P2 | Upload evidence on a task | In matching phase folder, linked both ways |
| TC-J27 | §5 perms | API | P1 | Run the §5 matrix for Admin, PM, PM2, Member, Viewer (rename default folder, cancel others' request, archive, restore, upload as Viewer) | Exactly matches table |
| TC-J28 | EC-39 | API | P1 | Two simultaneous uploads with same name | v4 and v5, never two v4s |
| TC-J29 | EC-40, EC-30 | API | P1 | Abort upload mid-stream; EICAR test file | No version / marked failed, not downloadable; no orphan metadata |
| TC-J30 | EC-43 | Both | P2 | Names >200 chars, emoji, `/`, `\`, `..`, ñ | Safe storage key; display name kept, trimmed to 200; no path traversal |
| TC-J31 | EC-44, EC-45 | UI | P3 | Deactivate requested contact; remove uploader from project | "(inactive)" + PM prompt; docs stay, user loses access |
| TC-J32 | EC-46 | Both | P2 | Cancel request, then other user fulfils it | "This request was cancelled" |
| TC-J33 | EC-49, EC-50, EC-51 | Both | P3 | Cancel a task with linked evidence; sign doc without requires-signature; complete project | Evidence stays linked to cancelled task; Signed + locked; read-only except PM/Admin archive |
| TC-J34 | FR-DOC-32 | Both | P2 | Hard-delete unsigned doc via API; PM archives and restores | Delete refused; archive/restore audited; archived hidden by default |
| TC-J35 | FR-DOC-18 | API | P3 | Move doc to another folder; to another project | First OK and audited; second rejected |

## K. Security (cross-cutting)
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-K01 | 07 §4 | API | P1 | For every endpoint, call as Outsider / Viewer / PM2 with P's ids (IDOR sweep) | 403/404, no data leaked |
| TC-K02 | NFR-04 | API | P1 | Send `{"email":{"$ne":null}}`, `$where`, `$gt` in bodies and query strings | 400; no auth bypass |
| TC-K03 | NFR-04 | API | P2 | Send unknown fields (e.g. `role`, `isAdmin`) on update endpoints | Rejected |
| TC-K04 | NFR-07 | UI | P1 | Search React bundle for keys/secrets (Grok, storage, DB) | None |
| TC-K05 | NFR-08 | API | P2 | Check HTTPS redirect and security headers | HTTPS only; Helmet headers present |
| TC-K06 | NFR-18 | API | P2 | Sign in, then inspect logs | No passwords or tokens logged |
| TC-K07 | XSS | UI | P1 | Put `<script>`/`<img onerror>` in task, folder, document, contact names | Rendered as text |

## L. Performance, accessibility, responsive
| TC | Ref | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-L01 | NFR-10 | UI | P2 | Large dataset dashboard and lists | p95 < 2 s |
| TC-L02 | NFR-11 | API | P2 | Load-test single-entity reads/writes | p95 < 500 ms |
| TC-L03 | §7 NFR | Both | P3 | 25 MB upload on 20 Mbps; doc list with 1,000 docs | < 10 s; < 1 s |
| TC-L04 | NFR-15 | UI | P2 | Keyboard-only run of core flows; axe scan; check every Sneat text/badge color against `THEME_TOKENS.md` on white and badge backgrounds | WCAG 2.1 AA, ≥ 4.5:1 for normal text; no stock Sneat colors that fail; every badge has a text label |
| TC-L05 | NFR-14 | UI | P2 | 1280 px, tablet, 360 px | Full desktop; board, My tasks, time logging usable on small widths |
