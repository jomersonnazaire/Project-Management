# 17 — Change requests: Microsoft 365, DAR Send, action emails, mobile (PRs #21 to #41)

**Status:** v0.3.1 draft (2026-10-22, 8:38 PM SGT) · v0.3 draft (2026-10-22, 8:29 PM SGT; v0.2 3:50 PM SGT) · **Author:** Business Analyst · **For:** Jomerson (approval), Lean, Deven, Queen, UIE
**Scope:** what other accounts built on `main` from `cb3b48b` to `1f6492e`, plus PR #27 and PR #29 (merged just before `cb3b48b`) and open PR #41 (`feature/mobile-email-dar`, not merged). All the work came from Jonathan's bot (`JonathanBot/...` branches). The commits show as "Jonathan Esmalla" or "Jomerson Nazaire", and every one was made through the `jomersonnazaire` GitHub account.
**Checked against:** docs 01 to 16 in this pack (doc 14 here is v1.2.25), `docs/FEATURES_AND_ROADMAP.md` (roadmap) and the copies of doc 14 (v1.2.28) and doc 09 on `main`, which these PRs changed.
**Scope of this review:** whether each change meets the requirements. Deven is checking security, correctness and tests.

**Doc change log:**
- v0.3.1 (2026-10-22, 8:38 PM SGT): two more decisions by Jomerson. **Q-91 decided:** auto-created Viewers start with no job role, and an Admin sets it from Users (CR-02; exception added to doc 03 FR-USR-01; doc 09 and doc 14 FR-SSO-04 notes). **CR-03 decided:** mobile Microsoft sign-in already works (9 sign-ins confirmed), and PR #41 uses it as it is. This decides the mobile sign-in part of Q-92 (doc 14 §G note). IDs unchanged.
- v0.3 (2026-10-22, 8:29 PM SGT): recorded Jomerson's decisions of 2026-10-22, 8:29 PM SGT (new §0a). **Decided:** Q-90 (keep auto-creating uninvited Microsoft accounts from the allowed tenant as Viewer, CR-02), Q-101 (action-email box ticked by default, CR-09), DAR Send kept and **Q-49 revised** to view, export and send (CR-04), Q-92 for mobile DAR Send and email notifications, with #41 coming off hold now that #42 is merged and then rebased (CR-11, CR-13), Q-106 (any valid email address allowed as DAR CC, CR-17). PRs #26 then #42 approved for merge (§4, record only). **Moot/closed:** Q-87 (sign-in hold; sign-in is live, PR #27/#32/#28). **Still open:** CR-14 (bot doc edits), plus Q-88, Q-89, Q-91, Q-93 to Q-100 and Q-102 to Q-105. Matching updates in docs 01, 09, 12, 14 and 16, the README and the local roadmap §4 (see §0a). IDs unchanged.
- v0.2 (2026-10-22, 3:50 PM SGT): added CR-15 (silent Microsoft relink), CR-16 (duplicate sends after a Graph timeout) and CR-17 (external DAR CC addresses), with Q-104 to Q-106. CR-01 now notes the sign-in audit gap (FR-SSO-09). Real account emails in the samples are replaced with generic placeholders (Jomerson's rule).
- v0.1 (2026-10-22, 3:40 PM SGT): CR-01 to CR-14, Q-87 to Q-103.

> **Every CR below is built. Before v0.3 none was approved.** No record in this pack showed that Jomerson approved any of it. Since v0.3, §0a records the parts Jomerson decided on 2026-10-22, 8:29 PM SGT. Every other CR or question not marked Decided still needs his approval. The `main` copies of doc 14, doc 09 and the roadmap say **"approved by Jonathan"**, but Jonathan is not an approver anywhere in docs 01 to 16. Each CR needs Jomerson to approve it or send it back.

## 0. Baseline decisions these changes touch
| Decision | Where | What it says |
|---|---|---|
| Microsoft sign-in on hold | doc 14 §13 (line 201); roadmap §4 | "Microsoft sign-in (§1) is on hold and moved to External integrations." (Jomerson, 2026-10-09, 8:41 PM). *Q-87 moot/closed: Microsoft sign-in is live (PR #27, nonce fix #32, mobile #28), so the hold no longer applies.* |
| M5 sign-in rules | doc 14 FR-SSO-01 to 09 (lines 21–29), §12 Q-36/Q-37 (line 153) | Microsoft sign-in works alongside passwords, accepts the Xceler8 tenant only and **never auto-creates users** ("Refuse; Admins invite first"). *Q-37 superseded by Q-90 (2026-10-22, §0a): auto-create as Viewer* |
| DAR email (M7 as first numbered, now M6) | doc 14 Q-41 (line 112), §12 (line 154), FR-DAR-07 (line 162) | An **HTML email** laid out like the sample, with a To/CC preview, sent "through Microsoft Graph from the user's mailbox". The doc never says app or delegated permission. "from the user's own mailbox; recipients see it from the person" fits **delegated** `Mail.Send` |
| DAR sender | doc 14 §13 (lines 203–207), §14 (lines 210–211), §15 FR-DAR-18 (line 223) | Q-49: view and export only for now. "Once Entra ID is set up, reports send from each person's own account (roadmap)". *Revised 2026-10-22 (§0a): view, export and send* |
| Email notifications deferred | doc 12 FR-NTF-02 (line 79), Q-28 (line 130); doc 09 Q-02 (line 11); roadmap §4 | In-app only. Email moves to the External integrations stage and "needs an email sending service and Jomerson's sign-off on the sender address". Q-02: email is used only for internal password reset |
| Mobile | doc 01 out of scope (line 39); doc 14 m8 notes (lines 306, 405, 438); doc 16 header; roadmap §4 "Native mobile apps: On hold" | Mobile native apps are outside Phase 1 and on hold. Doc 16 is only a catch-up handoff "when it resumes". *2026-10-22 (§0a): mobile DAR Send and email notifications (#41) are in scope* |
| Access roles | doc 11 line 5, line 102; FR-SSO-05 | Four fixed Access roles. Viewer means internal read-only staff with no time, tracker, leave or DAR access |

## 0a. Jomerson's decisions (2026-10-22, 8:29 PM SGT)
Jomerson (lead developer) gave these decisions in the room. Each row maps a decision to the CR and question it settles. The original questions stay under their IDs below and are marked **Decided**.

| # | Pending decision | CR / Q | Decision | Docs updated |
|---|---|---|---|---|
| 1 | Auto-create or refuse uninvited Microsoft accounts | CR-02, **Q-90** | **Keep auto-create.** A Microsoft account from the allowed tenant and domain that matches no user is still **created as a Viewer** and is not refused. Viewer means internal read-only staff with no time, tracker, DAR or leave access (Q-70 B, Q-72 No, doc 14 FR-ACT-35). The Viewer's read-only access to projects (doc 11 §6, FR-PMV-04) is accepted with it. Access stays limited by Entra app assignment. | doc 14 FR-SSO-04, Q-37 (§8, §12), §11 message, EC-73; doc 09 log |
| 2 | Action-email box default | CR-09, **Q-101** | **Ticked by default** ("Email {name}", "Email the team", "Email new members"), as built. The user can untick it before saving. | doc 12 FR-NTF-02 note; doc 09 log |
| 3 | DAR Send vs Q-49 | CR-04, Q-49 (doc 14 §13) | **Keep DAR Send.** **Q-49 revised:** DAR reports can be **viewed, exported and sent**, because the features were updated (PR #29). Send goes from the user's own Microsoft 365 mailbox. Password-only users keep Export. | doc 14 §0, §3 note, §13 Q-49, §14, FR-DAR-18; doc 09 log |
| 4 | Mobile scope and #41 | CR-11, CR-13, **Q-92** (part) | **Mobile scope is DAR Send and email notifications on mobile** (the PR #41 work, with its #36/#37 return path). **Sequencing decided:** #41 comes off hold now that PR #42 is merged (merged 2026-10-22), then it is rebased onto the merged branch. (This was the lead's earlier advice, "hold #41 until #42 is live", now confirmed.) The mobile Send flow must handle the server's **409 "Already sent"** response. Today the app shows the server message as it is, and that message points to the web. A full mobile confirm-and-resend step is part of #41. | doc 01 §scope; doc 16 header; doc 14 §G mobile note; doc 09 log |
| 5 | DAR CC to addresses outside our domain | CR-17, **Q-106** | **Don't block them.** Any email address is allowed as a DAR CC. **Assumptions (security and non-functional):** the address format is still checked (UI and API); up to 5 addresses, duplicates removed; the CC list comes only from the profile, is set only by Admins and every change is audited (FR-DAR-17); the server never takes recipients from the browser; Send stays a user action, rate-limited and logged. | doc 14 FR-DAR-01 note; doc 09 Q-02 note; doc 01 out of scope |
| 6 | Merge approvals | §4 | **PRs #26, then #42, approved for merge** by Jomerson. Recorded here only. Nobody has merged anything from this doc. | §4 |

**Not decided in this round:** CR-14 (requirement docs edited inside feature PRs: "approved by Jonathan", US-57/AC-57.x clash, roadmap) stays **open**. Q-87 (lift the Microsoft sign-in hold) is **moot/closed**: sign-in is live (PR #27, nonce fix #32, mobile #28). Decisions 1, 3 and 4 only work if Microsoft sign-in is in use, and it is live, so they stand (see §3).

## 1. Change requests

### CR-01 — Microsoft 365 sign-in on web (PR #27, nonce hotfix PR #32)
- **What changed:** a "Sign in with Microsoft" button under the password form (`LoginPage.tsx` around line 112 at PR head), using OIDC code flow with PKCE. It is off unless all the MS_* settings are set. It refuses guests (`acct` must be 0) and checks the tenant and the email domain. PR #32 passes the nonce to MSAL and changes no requirement.
- **Requirement it amends:** it lifts the doc 14 §13 hold on §1 and Q-17 (doc 09 line 26). On `main`, doc 09 Q-17 now says "Superseded … approved by Jonathan".
- **Conformance:**
  - FR-SSO-01 (except the button placement), FR-SSO-03 (works alongside passwords), FR-SSO-05, FR-SSO-06 and FR-SSO-08 (Key Vault) are met.
  - FR-SSO-01 placement differs: the button sits *below* the form, and FR-SSO-01 says *above*.
  - FR-SSO-02 is met in practice, but `MS_ALLOWED_TENANT_IDS` takes a comma-separated list (`config.ts:90`). That would allow more than one tenant, which contradicts "single tenant only".
  - FR-SSO-07 is partly met. The redirect is the fixed production web address, proxied to the API, and not the API address. After sign-in the API always returns to `WEB_APP_URL`, so "back to the site they started from" is not built.
  - **Sign-in audit gap (FR-SSO-09, Should):** Microsoft sign-ins, refused Microsoft sign-ins and successful password sign-ins are not written to the audit log, so the sign-in method isn't recorded anywhere. The only sign-in audit entries are `sso_linked` and `sso_user_created`. FR-SSO-09 should cover successes and refusals, with the method and the refusal reason.
  - The §11 messages ("isn't set up", "Wrong tenant", "Deactivated") are replaced by one generic message (`LoginPage.tsx:64`).
- **Open questions:** Q-87 Does Jomerson lift the hold on Microsoft sign-in? (**moot/closed**: sign-in is live, PR #27/#32/#28, so decisions 1, 3 and 4 in §0a stand) Q-88 Must the tenant setting be limited to one ID? Q-89 Do the §11 messages stand, or does UIE accept the generic one?
- **Status:** built, pending approval.

### CR-02 — Auto-create unknown Microsoft accounts as Viewer; job role optional (PR #27)
- **What changed:** a tenant member with an allowed domain who matches no user is **created** as `VIEWER` with `jobRole: null`, active and with no password (`microsoftSignIn.ts:80–94`). `User.jobRole` is no longer required (`User.ts:21`). The Users "Active" filter now also counts Microsoft-linked users.
- **Requirement it amends:**
  - **Conflicts** with FR-SSO-04 and Q-37, which Jomerson decided on 2026-10-09 (§12, line 153: "only for users already in the app"). It also conflicts with EC-73 and FR-USR-01 (doc 03 line 20, where a user record has a job role).
  - The `main` copy of doc 14 rewrites FR-SSO-04 and Q-37 as "approved by Jonathan" and adds AC-57.8.
- **Access impact:** a Viewer can read every project (doc 11 §6 matrix; FR-PMV-04). Any tenant member assigned to the Entra app therefore gets read access to all projects without an Admin invite. Q-37 exists to keep access deliberate, and this removes that. The only control left is Entra "Assignment required", which sits in the setup guide (`docs/setup/MS365_LOGIN_SETUP.md` §5) and not in the requirements.
- **Data note:** each first sign-in adds a user record. The 2026-10-19 UAT cleanup kept the 7 seed users plus one password-only staff account, and any Microsoft sign-in since then may have added more. Deven should check the Users list for `authProvider: 'microsoft'` records.
- **Open questions:** ~~Q-90 Refuse unknown accounts (as Jomerson decided), or auto-create? If auto-create, as Viewer with read access to all projects, or with no project access until an Admin acts?~~ **Q-90 Decided (Jomerson, 2026-10-22, 8:29 PM SGT):** keep auto-creating them as **Viewer** (internal read-only staff, no time, tracker, DAR or leave access per Q-70 B and Q-72 No). They are not refused. Q-37 is superseded. Q-91 Is a user with no job role allowed (FR-USR-01)? (**still open**; auto-created Viewers get `jobRole: null`, so FR-USR-01 doesn't match the build until Q-91 is answered.) **Q-91 Decided (Jomerson, 2026-10-22, 8:38 PM SGT):** auto-created Viewers start with **no job role** (`jobRole: null`, shown "Not set"), and an Admin sets it from Users. FR-USR-01 (doc 03) has a matching exception.
- **Status:** built. **Decided (Jomerson, 2026-10-22, 8:29 PM SGT)** for auto-create as Viewer. Q-91 open. **Q-91 decided (Jomerson, 2026-10-22, 8:38 PM SGT):** no job role until an Admin sets it.

### CR-03 — Microsoft 365 sign-in on mobile (PR #28)
- **What changed:** `GET /auth/mobile/microsoft/login` opens the system browser. The callback returns to `opstrack://auth/microsoft?code=…`, a 60-second single-use code bound to PKCE, which the app exchanges at `POST /auth/mobile/microsoft/exchange` for a bearer token. The PR adds Flutter sign-in, deep-link registration in the Android manifest and iOS plist, and mobile error messages.
- **Requirement it amends:** none covers this. Mobile is out of scope or on hold (section 0), and FR-SSO-01 and FR-SSO-07 are web only. It needs a new **FR-SSO-10 (mobile sign-in)**. The mobile messages are new and have no counterpart in §11.
- **Open questions:** Q-92 Is mobile back in scope, and for which features? **Partly decided (2026-10-22, 8:29 PM SGT):** mobile scope is DAR Send and email notifications (CR-11, CR-13). Mobile Microsoft sign-in is not named in the decision. #41's mobile send needs a Microsoft-linked session, so confirm whether CR-03 is in scope along with it (**open**). **CR-03 Decided (Jomerson, 2026-10-22, 8:38 PM SGT):** mobile Microsoft sign-in (PR #28) already works; Jomerson confirmed 9 successful sign-ins. PR #41 uses it as it is, with no change. The mobile sign-in part of Q-92 is decided: it is in scope.
- **Status:** built, pending approval. **Unspecified, needs a decision.** **Decided (Jomerson, 2026-10-22, 8:38 PM SGT):** in scope and used as it is by PR #41.

### CR-04 — DAR Send from the user's own mailbox with delegated Mail.Send (PR #29)
- **What changed:** Send on **saved** reports only. It starts with a POST protected against cross-site requests (CSRF). `Mail.Send` consent is asked for on the first Send, the token is not stored, and each send is one Graph `/me/sendMail` call. Send is limited to 30 per user per 15 minutes. The audit records `report_sent` and `report_send_failed`. A confirm dialog shows To and CC (`DarPage.tsx`). The `main` copy of doc 14 adds §N (FR-DAR-20 to 27, US-57, AC-57.1 to 57.8) and rewrites FR-DAR-04, FR-DAR-04b, FR-DAR-18, §13, §14 and Q-49.
- **Requirement it amends:** FR-DAR-04, FR-DAR-04b and FR-DAR-18. It reinstates them, which reverses §13's "dropped". It also changes Q-49 and the §14 deferral.
- **M7 conflict, as asked:**
  - **The sending method fits Q-41.** "From the user's mailbox; recipients see it from the person" means delegated permission. Q-41 never says app-level (application) Mail.Send.
  - ~~**It conflicts with §13/Q-49.** Jomerson's latest word was view and export only until the Microsoft sign-in item is taken off hold, and that hold was never lifted on record.~~ **Resolved (2026-10-22, 8:29 PM SGT):** Jomerson keeps DAR Send and **revised Q-49**: reports can be viewed, exported **and sent**, because the features were updated (doc 14 §13). The sign-in hold itself (Q-87) is moot/closed: sign-in is live (PR #27/#32/#28).
  - **Delegated sending ties Send to a Microsoft-linked account.** Password-only users (for example a staff user who signs in as `user@example.com`) can never send. Q-38 says to keep passwords for those users.
- **Doc defect:** §N uses **US-57 and AC-57.1 to 57.8**, but doc 11 already uses those IDs for the client portal (doc 11 lines 258–269, cited in doc 15). The §N items need renumbering to the next free IDs (**US-60, AC-60.x**).
- **Open questions:** Q-93 Does Jomerson confirm the delegated own-mailbox sender over a company or noreply sender? (**open**; decision 3 keeps Send as built, which sends from the user's own mailbox and matches revised Q-49, but the sender type wasn't confirmed on its own.) Q-94 Is the roadmap claim "admin consent granted Oct 21" confirmed by the tenant admin (A-19)? (**open**)
- **Status:** built. **Decided (Jomerson, 2026-10-22, 8:29 PM SGT): keep DAR Send; Q-49 revised.** Q-93 and Q-94 open.

### CR-05 — DAR email body: summary plus PDF attachment; HTML report body deferred (PR #29)
- **What changed:** the body is a short summary (range, total activities, total rendered hours, footer) with the PDF attached and a 2.5 MB limit (`darSend.ts:65`, `graphMail.ts:72–75`). The `main` copy of doc 14 adds FR-DAR-22 and FR-DAR-27 ("HTML body deferred, not dropped").
- **Requirement it amends:** **conflicts** with Jomerson's Q-41 decision (§12 line 154) and FR-DAR-07 (Must): the email should be an HTML report laid out like the sample. It matches the original FR-DAR-04 wording (PDF attachment plus a short summary).
- **Open questions:** Q-95 Does a summary plus PDF meet Q-41 for this release, or is the HTML body required before go-live?
- **Status:** built, pending approval. **Conflict (partial).**

### CR-06 — Recipients resolved at send time, not from the saved copy (PR #29)
- **What changed:** To is the current supervisor and CC is the current `reportCc`, with duplicates removed, the sender left out and a maximum of 5. The supervisor and CC stored with the saved copy are ignored.
- **Requirement it amends:** FR-DAR-12 (line 218), which says the saved copy keeps the "supervisor and CC on file at that moment". It matches FR-DAR-17's server-built recipients.
- **Open questions:** Q-96 Should the saved copy show that its stored recipients are not the ones that will be used?
- **Status:** built, pending approval.

### CR-07 — "Notify supervisor" button for password-only users (PR #29)
- **What changed:** password-only users get Export plus a manual **Notify supervisor** button that sends a `DAR_READY` in-app notice with no link, limited to one per report per hour. The §11 messages are reworded.
- **Requirement it amends:** FR-DAR-04b and the §11/§12.3 message ("Your supervisor **has been notified**"), which describe an automatic notice. The build makes it a manual button, so the message wording now differs. It is related to FR-DAR-05 (Should).
- **Open questions:** Q-97 Manual or automatic supervisor notice?
- **Status:** built, pending approval.

### CR-08 — Sent / Not sent status on saved reports (PR #35)
- **What changed:**
  - Saved reports gain `sentAt`, `sentBy` and `sentRecipientCount` (`Tracker.ts:87`). The three fields are overwritten on each successful send.
  - The page gets a Status column and filter, with the time shown in PH time and labelled "(PH)", and a hover note "Accepted by Microsoft for delivery".
  - Older reports are filled in from the `report_sent` audit.
  - The `main` copy of doc 14 FR-DAR-15 adds "Send status (Lean, 2026-10-21)".
- **Requirement it amends:**
  - FR-DAR-15 and FR-DAR-12 (saved records are read-only). These three fields now change after saving.
  - It partly brings back the §12.6 Sent reports record that doc 14 §14 deferred. It shows only the last send, not each send as FR-DAR-06 asks.
- **Open questions:** Q-98 Is last-send-only enough, or is a per-send history (FR-DAR-06, §12.6) needed?
- **Status:** built, pending approval. Lean decided this; Jomerson still needs to approve it.

### CR-09 — Action emails from the user's own Outlook (PR #34; roadmap §4 edit; closed PR #33 is superseded)
- **What changed:**
  - After a follow-up, a task assignment by a PM, or adding people to a project, an **"Email {name}" box, ticked by default** (`EmailCheckbox.tsx:31`), emails the people concerned from the actor's Outlook using delegated Mail.Send.
  - The server picks the recipients (`actionEmail.ts:69`). It is behind `EMAIL_NOTIFICATIONS_ENABLED`, off by default (`config.ts:101`), plus Microsoft sign-in.
  - A new endpoint `GET /auth/me/email-status` is added.
  - Follow-ups record `emailedAt`.
  - The roadmap row changes to "In progress", with a planned noreply@ sender.
- **Requirement it amends:** **conflicts** with:
  - FR-NTF-02 (doc 12 line 79): in-app only, email deferred.
  - Q-28 (doc 12 line 130), Jomerson.
  - Q-02 (doc 09 line 11): email only for internal password reset.
  - Roadmap §4, where email notifications come after the internal process and need Jomerson's sign-off on the sender.
  - The recipients follow FR-NTF-01 and FR-NTF-05, and the in-app notices are unchanged. That part conforms.
- **Open questions:**
  - Q-99 Does Jomerson bring email notifications forward from External integrations?
  - Q-100 Which sender: the actor's own Outlook (as built) or a system noreply@?
  - ~~Q-101 Should the box be ticked or unticked by default?~~ **Q-101 Decided (Jomerson, 2026-10-22, 8:29 PM SGT):** the box is **ticked by default**, as built (`EmailCheckbox.tsx:31`).
  - Q-102 What is the production value of the flag, and who may turn it on?
- **Status:** built (flag off). Q-101 decided. Q-99, Q-100 and Q-102 are **open**. Decision 4 puts email notifications in mobile scope, but bringing email forward on web (Q-99), the sender (Q-100) and the production flag (Q-102) still need answers. Until then the FR-NTF-02 conflict stays (doc 12). **Conflict (partly decided).**

### CR-10 — New in-app notification "added you to {project}" (PR #34)
- **What changed:** a new `ADDED_TO_PROJECT` notice type (`m3.ts:701`) goes to everyone a save adds to a project: New project, Edit project, and people added through the task form. It is **always on**, whatever the flag.
- **Requirement it amends:** none. FR-NTF-01 and FR-NTF-05 don't list this event. It would be a new **FR-NTF-07**, and it changes behaviour even with email off.
- **Open questions:** Q-103 Do we keep this in-app notice? What exact wording, and should UIE check it?
- **Status:** built, pending approval. **Unspecified, needs a decision.**

### CR-11 — Mobile return path for DAR Send and action emails (PRs #36 and #37)
- **What changed:**
  - Bearer-only `POST /dar/saved/:id/send/mobile` and `POST /action-emails/mobile`. Web sessions get `403 MOBILE_ONLY`.
  - A pending state is kept for 10 minutes, single use, under a hashed key, in the new `mobileMailStates` collection. A new `MobileAuthCode` model is added.
  - The app returns at `opstrack://auth/mail?code=`, a 60-second single-use code bound to PKCE, confirmed at `POST /auth/mobile/mail/confirm`.
  - Task and project saves accept `emailReturn: 'web' | 'mobile'`.
- **Requirement it amends:** none. This is mobile and email work beyond anything specified. It inherits CR-03, CR-04 and CR-09.
- **Open questions:** Q-92 **Decided (Jomerson, 2026-10-22, 8:29 PM SGT)** for this work: mobile DAR Send and email notifications are in scope, so this return path is in scope too. Q-93 and Q-99 are still open.
- **Status:** built. **In scope (decision 4).** Mobile requirements still need writing (§3).

### CR-12 — Mobile catch-up with the M8 delta (PR #21)
- **What changed:** the Flutter app now follows doc 16:
  - My tasks tabs and the denied-tab notice (FR-TSK-29, FR-TSK-30).
  - Viewer gating (Q-70 B, Q-72).
  - Day location required, with per-entry location removed.
  - Locked-day buttons (Q-09, FR-ACT-36).
  - `FUTURE_DATE` handling (FR-ACT-33).
  - Optional template, phases, and apply template.
- **Requirement it amends:**
  - The content matches doc 16 §4 and the doc 14 mobile notes.
  - The timing conflicts with "mobile on hold" (doc 14 lines 306 and 405, doc 16 header, roadmap §4).
  - Doc 14 FR-ACT-17 (line 179) still says a single entry's location can be changed. Doc 16 (lines 39 and 107) and the web build dropped that. FR-ACT-17 needs rewording.
- **Open questions:** Q-92 (mobile in scope?).
- **Status:** built, pending approval.

### CR-13 — Mobile DAR Send and action emails UI (open PR #41, `feature/mobile-email-dar`, not merged)
- **What changed (proposed):**
  - An "Email this report" card with To/CC preview, Send, Notify supervisor and a Sent / Not sent badge.
  - "Email the team", "Email {name}" and "Email new members" boxes on follow-ups, tasks and projects.
  - Result banners.
- **Requirement it amends:** none for mobile. It follows CR-04, CR-07, CR-08, CR-09 and CR-11. The text "export this report on the web" fits mobile having no export, but nothing in the requirements says so.
- **Open questions:** ~~Q-92, and whether #41 should wait until CR-03 and CR-09 are decided.~~ **Decided (Jomerson, 2026-10-22, 8:29 PM SGT):**
  - **Scope:** mobile covers DAR Send and email notifications. That is this PR (#41).
  - **Sequencing (decided):** #41 comes off hold now that PR #42 is merged (merged 2026-10-22), then it is rebased onto the merged branch. This confirms the lead's earlier advice to hold #41 until #42 is live.
  - **409 "Already sent":** the mobile Send flow must handle the server's 409 "Already sent" response. Today the app shows the server message as it is, and that message points the user to the web. A full mobile confirm-and-resend step ("Already sent on {date, time} (PH). Send again?") is part of #41 (see CR-16 (c)).
- **Status:** built on a branch, not merged. **Scope and sequencing Decided (Jomerson, 2026-10-22, 8:29 PM SGT).** Waits for #42 to merge, then rebase.

### CR-14 — Requirement docs edited inside feature PRs (PRs #29, #34, #35; closed #33)
- **What changed:**
  - The `main` copies of doc 14 (now v1.2.28), doc 09 Q-17 and the roadmap §4 were edited by the bot PRs.
  - Those edits record decisions as "approved by Jonathan" and mark items "Done, live".
  - They supersede Jomerson's Q-17, Q-37, Q-49 and the §13 hold.
- **Problems:**
  - (a) The approver named isn't one recognised in this pack.
  - (b) US-57 and AC-57.x clash with doc 11 (see CR-04).
  - (c) The roadmap contradicts itself. It says "Microsoft sign-in … live on … mobile (PR #28)" while "Native mobile apps: On hold" is unchanged.
  - (d) The README change log has no entry for doc 14 v1.2.26 to v1.2.28.
  - (e) This local pack is behind `main` and needs syncing once Jomerson decides.
- **v0.3 note:** decisions 1 and 3 (§0a) settle the content of Q-37 and Q-49 on their own merits. They don't approve the bot's doc edits or the "approved by Jonathan" wording. Whether those `main` edits are accepted, corrected or replaced is still **open**.
- **Status:** pending approval (**open**). Docs need correcting.

### CR-15 — Silent relinking of a Microsoft account (PR #27)
- **What changed:** when a Microsoft account signs in and no user matches its Entra IDs (`oid` and `tid`), the user with the same email is linked to it (`microsoftSignIn.ts:53–61` at PR #27 head). That user's stored `msOid` and `msTid` are overwritten without checking whether a *different* Microsoft account was already linked. A different Microsoft account with the same email (for example after a mailbox is deleted and recreated, or a reused address) silently takes over the existing user and their access. The only trace is a routine `sso_linked` audit entry.
- **Requirement it amends:** FR-SSO-04 says later sign-ins match on `oid` "so an email change in Entra doesn't break the link". It doesn't say what happens when a user who is already linked meets a different `oid` with the same email. EC-73 covers only the first link of a password user. **Proposed (new FR-SSO-11):** if the user already has a different `oid`/`tid` linked, refuse the Microsoft sign-in, leave the link unchanged, and write an audit entry (for example `sso_relink_refused` with the old and new IDs). An Admin clears or resets the link by hand, and that is audited too.
- **Open questions:** Q-104 Should a different Microsoft account with the same email be refused and audited, so only an Admin can move the link? Or may it relink automatically?
- **Status:** built, pending approval. **Unspecified, needs a decision.**

### CR-16 — Duplicate DAR and action-email sends after a Graph timeout (PRs #29, #34; mobile #41)
- **What changed:**
  - The Graph `sendMail` call gives up after **20 seconds** (`graphMail.ts:92` at PR #29 head, `AbortSignal.timeout(20_000)`).
  - If Microsoft had already accepted the mail, the send is still recorded as failed (`report_send_failed`, and the report stays "Not sent" under #35). Retrying sends the email **twice**.
  - The confirm step has no "Already sent on {date}. Send again?" warning for a report that already went out.
  - On mobile (#41), two quick taps can both start a send.
  - Action emails (#34) use the same Graph path and have the same timeout risk.
- **Requirement it amends:** FR-DAR-06 (re-send allowed, each send logged), FR-DAR-15 and the `main` §N FR-DAR-20 and FR-DAR-23 (send record). None of them covers an unknown outcome, duplicate protection or a re-send warning. **Proposed (new FR-DAR-28, and the same rule for action emails under FR-NTF-08):**
  - (a) Each Send is idempotent: one user action sends at most one email, and repeated taps or a retried request with the same send ID don't send again.
  - (b) A timeout or other unknown result is recorded and shown as **"Outcome unknown – check your Sent Items before sending again"**, not "Failed".
  - (c) Sending a report that already shows Sent asks "Already sent on {date, time} (PH). Send again?" first.
  - (d) The Send control is disabled while a send is in progress, on web and mobile.
- **v0.3 note:** the server now answers a repeat Send with **409 "Already sent"**. Decision 4 needs the mobile Send flow (#41) to handle it, with a full confirm-and-resend step on mobile. Rules (a), (b) and (d) are still undecided.
- **Open questions:** Q-105 (**open**) Do we adopt idempotent Send, an "outcome unknown" status and an already-sent warning for DAR and action emails? Should an unknown outcome block a re-send until the user confirms?
- **Status:** built, pending approval. **Gap, needs a decision.**

### CR-17 — DAR CC addresses outside the company email domain (PR #29)
- **What changed:** an Admin can set a user's Report CC list (`reportCc`, up to 5) to any valid email address, including addresses outside the company domain. Since #29, DAR Send emails those addresses from the user's own mailbox. The send copies at most 5 of them, drops duplicates, and leaves out the supervisor and the sender.
- **Requirement it amends:** FR-DAR-01 ("up to 5 valid addresses") and FR-DAR-17 (CC only from the profile, changed only by Admins and audited). Neither limits the domain. Doc 09 Q-02 says no email to client contacts, and doc 01 lists "any email to client contacts" as out of scope. A CC to a client address would break that, and nothing stops it.
- **Open questions:** ~~Q-106 Should DAR CC addresses be limited to the company email domain(s), or are external addresses allowed? If allowed, which ones, and should client-contact addresses be refused?~~ **Q-106 Decided (Jomerson, 2026-10-22, 8:29 PM SGT):** don't block them. **Any email address is allowed** as a DAR CC, including outside our domain and client contacts.
- **Security and non-functional assumptions:** the address format is still checked (UI and API, 400 `VALIDATION_ERROR` on a bad address); up to 5 addresses, duplicates removed, supervisor and sender left out at send time; CC comes only from the profile, is set only by Admins and every change is audited (FR-DAR-17); the server never takes recipient addresses from the browser; Send stays a user action, with the per-user rate limit and the audit (`report_sent` / `report_send_failed`). A DAR CC is an explicit exception to "no email to client contacts" (doc 01, doc 09 Q-02).
- **Status:** built. **Decided (Jomerson, 2026-10-22, 8:29 PM SGT)** (no domain limit).

## 2. New questions for Jomerson (Q-87 to Q-106)
**Update v0.3.1 (Jomerson, 2026-10-22, 8:38 PM SGT):** Q-91 and CR-03 (the mobile sign-in part of Q-92) are **decided**. So Q-91 is no longer open, and Q-92 now has only the M8 catch-up (CR-12) left.
**Status after v0.3:** **Decided** (2026-10-22, 8:29 PM SGT): Q-90 (auto-create as Viewer), Q-101 (ticked), Q-106 (any address), Q-92 for mobile DAR Send and email notifications (mobile sign-in CR-03 and the M8 catch-up CR-12 not covered). Also decided: Q-49 revised (doc 14). **Moot/closed:** Q-87 (sign-in is live, PR #27/#32/#28). **Open:** Q-88, Q-89, Q-91, Q-92 (rest), Q-93, Q-94, Q-95, Q-96, Q-97, Q-98, Q-99, Q-100, Q-102, Q-103, Q-104, Q-105, and CR-14.

Q-87 Lift the Microsoft sign-in hold? (moot/closed: sign-in is live) · Q-88 One tenant ID only? · Q-89 §11 sign-in messages · Q-90 Auto-create or refuse unknown accounts? · Q-91 Users without a job role (decided v0.3.1: none until an Admin sets it) · Q-92 Is mobile in scope (sign-in, DAR, emails, M8 catch-up)? · Q-93 Delegated own-mailbox sender confirmed? · Q-94 Mail.Send admin consent confirmed? · Q-95 HTML DAR body before go-live? · Q-96 Saved copy showing stale recipients · Q-97 Manual or automatic supervisor notice · Q-98 Last send only, or send history? · Q-99 Bring email notifications forward? · Q-100 Action email sender · Q-101 Email box ticked by default? · Q-102 Who controls the email flag in production · Q-103 Keep the "added you to" notice? · Q-104 Refuse and audit a different Microsoft account with the same email? · Q-105 Idempotent Send, "outcome unknown" status and an already-sent warning? · Q-106 Company-domain-only DAR CC, or external addresses allowed?

## 3. Requirements to write once decided
- **FR-SSO-04 (rewrite)** with the auto-create decision (*v0.3: decided and reworded in doc 14; FR-USR-01 waits for Q-91*), (*v0.3.1: Q-91 decided; FR-USR-01 exception added in doc 03*) plus **FR-SSO-10** for mobile Microsoft sign-in (deep link, one-time code, its messages). (*v0.3.1: CR-03 decided; mobile sign-in works as built, and FR-SSO-10 should describe the as-built PR #28 flow*)
- **FR-DAR-20 to 27** (from `main` §N) once approved, with the user story and acceptance criteria renumbered to **US-60 / AC-60.1 to 60.8**. Rewrite **FR-DAR-12** (recipients at send time) and **FR-DAR-15** (send-status fields). Settle **FR-DAR-07** (HTML body) and FR-DAR-04b/§11 (manual Notify supervisor).
- **FR-NTF-07** "added to project" in-app notice. **FR-NTF-08** action emails (events, recipients, sender, opt-in default, flag). **FR-NTF-02** amended, or kept and the build parked.
- **Mobile scope** in doc 01 and the roadmap (*v0.3: noted in doc 01, doc 16 and the local `docs/FEATURES_AND_ROADMAP.md` §4. Mobile requirements for #41 still need writing*), plus mobile requirements (doc 16 or a new doc) for DAR Send and action emails.
- **FR-SSO-11** refuse and audit a relink to a different Microsoft account (CR-15). **FR-SSO-09** widened to all sign-ins and refusals (CR-01). **FR-DAR-28** idempotent Send, unknown outcome and already-sent warning, also applied to action emails (CR-16). **FR-DAR-01 / FR-DAR-17** CC domain rule (CR-17) (*v0.3: decided, no domain limit; note added to doc 14 FR-DAR-01*).
- **FR-ACT-17** reworded: location is set per day only.
- **FR-USR-01** amended if a job role can be empty.
- Edge cases to add: EC-128 (user removed in Entra keeps an open session up to 12 h), EC-129 (Microsoft user with no mailbox), EC-130 (a follow-up already emailed is not emailed again).
- **Conflict resolved:** decisions 1, 3 and 4 depend on Microsoft sign-in, which is live (PR #27/#32/#28), so Q-87 is moot/closed.

## 4. PR merge approvals (record only)
| PR | Approval | Order | Note |
|---|---|---|---|
| #26 | Approved for merge by Jomerson (2026-10-22, 8:29 PM SGT) | 1st | Recorded only. This doc doesn't merge anything. |
| #42 | Approved for merge by Jomerson (2026-10-22, 8:29 PM SGT) | 2nd, after #26 | Once #42 is merged, #41 comes off hold and is rebased onto the merged branch (CR-13). |
