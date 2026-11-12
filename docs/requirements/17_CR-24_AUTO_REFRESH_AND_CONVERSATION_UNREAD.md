# CR-24 — Auto-refresh on project screens, Conversation unread badge, and @mention notifications

**Status:** v0.1.1 draft (2026-11-12 ~11:59 AM SGT) · v0.1 draft (2026-11-12 ~11:56 AM SGT) · **Author:** Business Analyst (Rich) · **For:** Jomerson (approval), Lean, Deven, Queen, UIE
**Requested by:** Jomerson (Lead Dev / owner) in the PM room, 2026-11-12, verbatim:

> 1.Project converstation and Followup can this be Auto Refresh?
> 2.Project Conversation need to send notification? or Notification Badge on the Converstaion
> 3.Checklist is not updating  I needed to Refresh.
> Can Project be auto Refresh?
> Let Discuss 1st before Adding it to staging

**Rules locked by:** Jomerson (PM room, 2026-11-12 ~11:52 AM SGT) and Lean (scope, 2026-11-12 ~11:53 AM SGT; **all of Rich's suggestions for Q-170 to Q-183, plus A-65, accepted 2026-11-12 ~11:58 AM SGT**, verbatim: "I accept all of your suggestions for Q-170 to Q-183, plus A-65."). Jomerson, verbatim: "1.automatic checks OK for now 2.yes 3.Disregard this is based on auto refresh requirements like 1". Rules marked **Locked** are theirs as cited. Assumptions in §10 stand, with A-65 accepted by Lean. All questions in §12 are closed.
**Part of:** doc 17 (change requests). CR-24 is summarised in `17_CHANGE_REQUESTS.md` and specified in full here. It follows CR-23 and uses the next free IDs: **FR-ARF-01 to FR-ARF-08** (new prefix: auto-refresh), **FR-CNV-09 to FR-CNV-15**, **FR-NTF-14**, **FR-NTF-15**, **US-78 to US-80**, **AC-79.1 to AC-79.8**, **AC-80.1 to AC-80.11**, **AC-81.1 to AC-81.6** (AC-78.1 is already used by CR-23, so this CR's acceptance criteria start at AC-79), **EC-227 to EC-241**, **NFR-59 to NFR-62**, **A-61 to A-71**, **Q-170 to Q-183** (Q-174 and Q-175 unused; all questions closed).
**Checked against:** docs 01 to 17 with CR-23 v0.1.8 on `docs/cr-23-checklist` `defe502` (doc 17 v0.6.39); the build at `origin/main` `30a0cb9` (PR #49 and PR #50 merged; live API and web on that SHA). CR-23 (PR #51) is still on staging and is not required to start this CR, but any in-progress Checklist editor on #51 must follow FR-ARF-06. No IDs clash with CR-23 (CR-23 ends at FR-PRJ-42, FR-TSK-38, FR-CLX-13, FR-DLV-12, FR-TL-34, FR-CNV-08, FR-NTF-13, US-77, AC-76.19, AC-78.1, EC-226, NFR-58, A-60, Q-169).
**Ready for build.** Lean has approved building on `feature/cr24-auto-refresh`. Staging and live still go through the normal path. UI detail (badge look, mention picker, wording) is for UIE.

**Doc change log:**
- v0.1.1 (2026-11-12 ~11:59 AM SGT): **Q-170 to Q-173 and Q-176 to Q-183 closed** (Lean, PM room, 2026-11-12 ~11:58 AM SGT), verbatim: "I accept all of your suggestions for Q-170 to Q-183, plus A-65." Suggested answers stand as written. Q-174 and Q-175 stay unused. A-65 accepted. Three new locked rules: FR-CNV-14 (own messages never count as unread for you; stands with FR-CNV-11), FR-CNV-15 (the server works out each unread count from last-read; the browser never counts on its own), FR-ARF-08 (each timed check for project-list badges fetches only the unread count, not the whole thread). New ACs: AC-80.9 to AC-80.11. Status: **Ready for build** on `feature/cr24-auto-refresh`; staging and live still go through the normal path.
- v0.1 (2026-11-12 ~11:56 AM SGT): first draft from Jomerson's request, his 11:52 AM SGT answers, and Lean's 11:53 AM SGT scope.

---

## 1. Summary

Staff staying on a project today only see other people's changes after a manual refresh. The web app caches project, task, conversation and follow-up data in TanStack Query with a 30-second `staleTime` and `refetchOnWindowFocus: false` (`apps/web/src/main.tsx`). A user's own writes invalidate their own cache. There is no poll, SSE, WebSocket or other push for those screens. The in-app bell is the exception: it already polls the unread count every 60 seconds and on focus (FR-NTF-06, `NOTIFICATION_POLL_MS`, `useUnreadCount`).

This CR adds polling and focus refetch for the screens Jomerson named, a per-user Conversation unread badge, and a bell notification only when a project member is @mentioned. The Checklist not updating is the same cache behaviour. It is covered here and is not a separate defect.

## 2. Scope

**In (Locked, Jomerson 11:52 AM SGT, Lean 11:53 AM SGT):**
- Auto-refresh by **automatic checks** (polling). No server push and no new Azure service in this CR. Push (SSE, WebSockets, Azure Web PubSub or SignalR) is a future option only.
- **Conversation** and **Follow-ups** poll every **10 seconds** while that view is open and the browser tab is visible.
- **Project pages** (project header, Checklist, project task list including Board, Timeline) poll every **30 seconds** while the browser tab is visible.
- In-scope screens **refetch when the browser tab gains focus**.
- **No polling** while the browser tab is hidden, the view is unmounted, or the browser is offline.
- A refresh **never overwrites** a form or an item the user is editing.
- A **per-user unread badge** on the project's **Conversation tab** and on that **project's row** in the Projects list, counted since the user last opened that project's Conversation. Last-read time is stored on the **server**, so it works across devices.
- The **bell notifies only when a member is @mentioned** in Conversation. Mentions are picked from the **existing project member list**. New notification type **`CONVERSATION_MENTION`**.
- Implementation: the existing React Query `refetchInterval` plus `refetchOnWindowFocus`, on these screens only.

**Out:**
- Server push and any new Azure realtime service.
- Email or Microsoft Teams notifications for Conversation (FR-NTF-02 / Q-28 stand; Q-99, Q-100 and Q-102 stay their own questions). Follow-up email stays the existing optional action email (`FOLLOW_UP`), unchanged.
- Changing the bell's 60-second unread poll (FR-NTF-06) or its `9+` cap (`badgeCount` in `apps/web/src/lib/m3ui.ts`), except that a new `CONVERSATION_MENTION` item appears in the same list.
- Client portal Conversation, badges or mentions. Portal responses already omit conversations (FR-ACL-30, doc 15).
- Edit or delete of Conversation messages. Those remain disallowed (FR-CNV-03, Q-31). Admin hide stays.
- My tasks, Dashboard, Reports, Documents, Time, Activity, Issues and Setup, unless Q-172 changes that.
- Native mobile UI in v1 (Q-176). The API still stores last-read and mention rules so a later client can use them.

## 3. Auto-refresh (Locked, Jomerson 11:52 AM SGT, Lean 11:53 AM SGT)

- **FR-ARF-01 (Must, Locked)** While the project's **Conversation** tab is open and the browser tab is visible, the message list refreshes every **10 seconds**.
- **FR-ARF-02 (Must, Locked)** While a task panel is open (the Follow-ups thread is on that panel) and the browser tab is visible, that task's follow-ups refresh every **10 seconds**. The Checklist / My tasks follow-up badge counts (FR-NTF-09 to 13) update from the same refresh when that data is already on the page, and otherwise from the 30-second project task poll (FR-ARF-03).
- **FR-ARF-03 (Must, Locked)** While a project is open and the browser tab is visible, the **project header**, **Checklist**, **Board** (the project task list) and **Timeline** refresh every **30 seconds**. As built, `ProjectDetailPage` already keeps `useProject` and `useProjectTasks` mounted across project tabs, and Timeline is `['tasks', 'timeline', projectId]` (`apps/web/src/api/timelineHooks.ts`). Those hooks gain the interval. Documents, Time, Activity and Issues on the same project are not polled in this CR (Q-172).
- **FR-ARF-04 (Must, Locked)** In-scope queries refetch when the browser tab gains focus (`refetchOnWindowFocus: true` on those hooks). This is **for these screens only**. Do **not** change the app-wide default in `apps/web/src/main.tsx` (`refetchOnWindowFocus: false`, `staleTime: 30_000`).
- **FR-ARF-05 (Must, Locked)** There is **no polling** while the browser tab is hidden, the query is unmounted, or the browser is offline. TanStack Query v5 already defaults `refetchIntervalInBackground` to false; the hooks must also skip the interval when `navigator.onLine` is false. When the browser comes back online or the tab becomes visible, a refetch may run (focus or the resumed interval).
- **FR-ARF-06 (Must, Locked)** A refresh **never overwrites** a form or an item the user is editing. Local draft state stays (Conversation composer, Follow-up composer, Edit task, inline deliverable item, phase-name editor, import preview, and any other open editor on these screens). The list around the editor may update. If the same record changed on the server, the next save follows the existing conflict rules (task saves already use 409 `VERSION_CONFLICT` and refetch). The poll must not remount the editor or reset its fields from the newly fetched object.
- **FR-ARF-07 (Must)** After a poll or focus-refetch error, **back off** (double the interval up to a cap of 60 seconds, then return to the normal 10- or 30-second interval after a success). A failing API is not called every 10 seconds without pause.
- **FR-ARF-08 (Must, Locked, Lean, 2026-11-12 ~11:58 AM SGT)** Each **timed check** that keeps Conversation unread badges up to date on the **Projects list** (the 30-second interval and the focus refetch from Q-173, now closed) fetches **only the unread count**, not the whole Conversation thread, so those 30-second checks stay light. A single batch request for the visible projects is preferred (not one request per row). The initial project-list and project-detail payloads may still include `conversationUnread` (NFR-60). Opening the Conversation tab still loads and polls the thread every 10 seconds (FR-ARF-01). The 30-second polls of the project header, Checklist, Board and Timeline (FR-ARF-03) are unchanged.

Suggested shared constants, next to `NOTIFICATION_POLL_MS` in `packages/shared/src/m3.ts`: `CONVERSATION_POLL_MS = 10_000` and `PROJECT_POLL_MS = 30_000`.

## 4. Conversation unread badge (Locked, Jomerson 11:52 AM SGT, Lean 11:53 AM SGT)

- **FR-CNV-09 (Must, Locked)** Anyone who can **view** the project's Conversation (FR-CNV-04) sees a per-user **unread badge** on the **Conversation tab** and on that **project's row** in the Projects list. The badge shows the unread count. It is hidden at 0. The cap is **99+** (Q-171 closed). Visual design is UIE's.
- **FR-CNV-10 (Must, Locked)** Unread means messages **by other people**, posted **after** this user's last-read time for that project, that are **not hidden**. Last-read is stored **on the server**, one record per user per project, so it is the same on every device. Opening the project's Conversation tab sets last-read to the newest visible message time, or to now if there are no messages. The write uses `$max` so a stale request cannot move last-read backwards (same idea as `markFollowUpsSeen` in `apps/api/src/services/followUpSeen.ts`). A suggested shape, not a locked collection name, is `conversationRead` with `{ userId, projectId, lastReadAt }` and a unique index on `userId + projectId`. A suggested write is `POST /projects/:id/messages/seen` (or equivalent). **First open / no last-read row (Q-170 closed, Lean):** on first API start of this release, write **one app-wide cutoff** once (a new `appMarkers` id, not `followUpSeenCutoff`). Messages at or before the cutoff count as already seen. No last-read rows are pre-created. After the cutoff, other people's messages count as unread until the user opens that project's Conversation.
- **FR-CNV-11 (Must, Locked)** A user's **own messages never count as unread** for them. Posting a message also advances that user's last-read so the new message is seen for them on every device.
- **FR-CNV-12 (Must)** **Hidden** messages (Admin hide, FR-CNV-03, Q-31) do not count as unread. Conversation messages still cannot be edited or deleted, so those cases do not arise in this CR.
- **FR-CNV-14 (Must, Locked, Lean, 2026-11-12 ~11:58 AM SGT)** Your **own messages never count as unread for you**. This restates FR-CNV-11 as a standalone rule. The server must exclude the author's messages from that author's unread count in every case, including a self-mention (Q-178 closed) and if last-read has not yet caught up with the new post.
- **FR-CNV-15 (Must, Locked, Lean, 2026-11-12 ~11:58 AM SGT)** The **server** works out each unread count from the user's last-read time (and the own-author rule, the app-wide cutoff, and hidden messages). The **browser never counts on its own**: it only displays the `conversationUnread` value (or the counts-only poll result) the API returned. It must not increment or decrement the badge by inspecting the cached thread.

The unread count is returned with the existing project list and project detail payloads (`conversationUnread`), so the first load of the Projects list does not make one extra request per row (NFR-60, same idea as NFR-46). Later 30-second and focus checks on that list follow FR-ARF-08 (counts only, Q-173 closed).

## 5. @mentions and `CONVERSATION_MENTION` (Locked, Jomerson 11:52 AM SGT, Lean 11:53 AM SGT)

- **FR-CNV-13 (Must, Locked)** In the Conversation composer, the author can **@mention** people chosen from the **existing project member list**: active staff who are the project's **PM** (`managerId`) or in **`memberIds`**, including the PM even if they are not also in `memberIds` (Q-177 closed). Viewers who are not on the team, deactivated users, and portal contacts are excluded. Admins are included only when they are PM or a member. Mentions are stored as **user ids** on the message, not as display name only, so a later name change does not break them. Client contacts stay a separate optional tag (FR-CNV-02) and are not @mentions. Portal contacts cannot be mentioned.
- **FR-NTF-14 (Must, Locked)** New in-app notification type **`CONVERSATION_MENTION`**, added to `NOTIFICATION_TYPES` in `packages/shared/src/m3.ts`. The bell notifies **only** a mentioned person who is on the project member list, is active, and is **not** the author. Other readers of the Conversation are not notified. Clicking the notification marks it read (FR-NTF-03) and opens that project's **Conversation tab**, which then sets last-read (FR-CNV-10). Suggested verb, for UIE to confirm: "mentioned you in" with the project name. Access at read time follows FR-NTF-04. Notifications older than 90 days still drop off (FR-NTF-06).
- **FR-NTF-15 (Must)** Mention notifications in this CR are **in-app only**. No email and no Microsoft Teams message are sent for a Conversation mention. That does not decide Q-99.

A mention of someone who is not a current member, and a self-mention, are Q-179 and Q-178.

## 6. User stories

- **US-78** As a project member, I want Conversation and Follow-ups to update while I have them open, so I see other people's posts without refreshing the page.
- **US-79** As someone who can read a project's Conversation, I want an unread badge on the Conversation tab and on the project row, so I can see that there are new messages since I last opened that Conversation.
- **US-80** As a project member, I want a bell notification when someone @mentions me in a project's Conversation, so I can open that Conversation directly.

## 7. Acceptance criteria

- **AC-79.1 (UI)** Two browsers are signed in as different members on the same project. A is on the Conversation tab and the browser tab is visible. B posts a message. A's list shows B's message within 10 seconds, without a manual refresh, and A's composer draft is unchanged. (FR-ARF-01, FR-ARF-06)
- **AC-79.2 (UI)** A has a task panel open, with the Follow-ups thread visible. B adds a follow-up on that task. A's thread and the follow-up badge update within 10 seconds, without a manual refresh. A's unsent follow-up note is unchanged. (FR-ARF-02, FR-ARF-06)
- **AC-79.3 (UI)** A is on the project Checklist (or Board or Timeline, or is looking at the project header) with the browser tab visible. B changes a task. A's view updates within 30 seconds, without a manual refresh. If A has Edit task open, the form fields A has typed are unchanged. (FR-ARF-03, FR-ARF-06)
- **AC-79.4 (UI)** A has the project open in a hidden browser tab. No Conversation, Follow-up or project poll runs while it is hidden. When A focuses the tab, the in-scope queries refetch. (FR-ARF-04, FR-ARF-05)
- **AC-79.5 (UI)** The browser is offline. In-scope intervals do not fire. When the browser is online again and the tab is focused, a refetch may run. (FR-ARF-05)
- **AC-79.6 (API/UI)** After repeated poll failures, the client backs off to a longer interval, at most 60 seconds, and returns to the normal interval after a success. (FR-ARF-07)
- **AC-79.7 (UI)** App-wide React Query defaults in `apps/web/src/main.tsx` stay `refetchOnWindowFocus: false` and `staleTime: 30_000`. Clients, Reports and other out-of-scope screens do not start polling because of this CR. (FR-ARF-04, Q-172)
- **AC-79.8 (UI)** The Checklist updates under FR-ARF-03 / FR-ARF-04. There is no separate Checklist-refresh defect. (Jomerson, 11:52 AM SGT, item 3)

- **AC-80.1 (UI)** A has no last-read row. Messages at or before the app-wide cutoff (Q-170) do not count as unread. After the cutoff, other people's messages count as unread until A opens Conversation. The Conversation tab and the project row show the same unread count for A, or no badge if the count is 0. (FR-CNV-09, FR-CNV-10)
- **AC-80.2 (API)** Last-read is stored on the server per user per project. A sets last-read on device 1 by opening Conversation. Device 2, after its next focus or poll, shows 0 unread for that project. (FR-CNV-10)
- **AC-80.3 (API/UI)** A posts a message. A's unread count does not include that message, on any device. B, who has not opened Conversation, sees their unread count go up by 1 after the next poll or focus. (FR-CNV-11)
- **AC-80.4 (UI)** Opening the Conversation tab clears the badge for that user (last-read advances). Looking at the Checklist, or clicking a follow-up notification, does not set Conversation last-read. (FR-CNV-10)
- **AC-80.5 (API/UI)** An Admin hides a message that was unread for A. A's unread count no longer includes it, after the next poll or focus. (FR-CNV-12)
- **AC-80.6 (UI)** The badge is hidden at 0. A count above 99 shows **`99+`**. This cap is for the Conversation tab and the project-row badge only. The bell stays `9+`. (FR-CNV-09, Q-171)
- **AC-80.7 (API)** `GET /projects` and `GET /projects/:id` include `conversationUnread` for the signed-in user. The Projects list does not call one extra unread endpoint per row. (NFR-60)
- **AC-80.8 (API)** A Viewer who can read the project (FR-CNV-04) receives `conversationUnread` and sees the badges. A caller without View gets no Conversation data (existing 404/403). A portal session still has no Conversation fields (FR-ACL-30). (FR-CNV-09)
- **AC-80.9 (API)** A posts a Conversation message, including a self-mention. The unread count the server returns for A does not include that message, even before last-read is advanced, and does not go up on any device. (FR-CNV-14, FR-CNV-11, Q-178)
- **AC-80.10 (API/UI)** The badge value shown is exactly the `conversationUnread` (or counts-only poll) figure the API last returned. The web app does not add 1 when a new message appears in a cached thread, and does not recompute the count from the thread. (FR-CNV-15)
- **AC-80.11 (API/UI)** While the Projects list is visible, the 30-second and focus checks that refresh the row badges request **only unread counts** (one batch for the listed projects), not `GET /projects/:id/messages` or any other full thread, and not one request per row. (FR-ARF-08, Q-173)

- **AC-81.1 (UI)** The Conversation composer lets the author pick a mention from the project member list. A person who is not on that list cannot be picked. (FR-CNV-13)
- **AC-81.2 (API)** B, a current project member, is mentioned in A's message. B receives exactly one `CONVERSATION_MENTION` in-app notification. A does not. Other members who were not mentioned do not. (FR-NTF-14)
- **AC-81.3 (UI)** B clicks the notification. It is marked read, and B is taken to that project's Conversation tab, which sets B's last-read. (FR-NTF-14, FR-NTF-03, FR-CNV-10)
- **AC-81.4 (API)** A mention user id that is not a current member is ignored: the message is saved, and no notification is sent. (Q-179)
- **AC-81.5 (API)** A self-mention does not create a `CONVERSATION_MENTION` for the author. (Q-178)
- **AC-81.6 (API)** No email and no Microsoft Teams message is sent for a Conversation mention in this CR. (FR-NTF-15)

## 8. Non-functional

- **NFR-59 (Must)** Auto-refresh uses **HTTP polling** through the existing Vercel `/api` rewrite to the Azure App Service API (`docs/requirements/07_TECHNICAL_REQUIREMENTS.md` hosting; `apps/web/vercel.json`; README). There is **no** SSE, WebSocket, Azure Web PubSub, SignalR or other long-lived connection in this CR. Those stay a future option. Only in-scope, mounted, visible queries poll, at 10 seconds (Conversation, open Follow-ups) or 30 seconds (project header, Checklist, Board, Timeline). The Projects-list unread badge also refreshes every 30 seconds while the list is visible, and on focus (Q-173 closed), using the counts-only check in FR-ARF-08.
- **NFR-60 (Must)** Polling must still meet **NFR-10** (list pages p95 < 2 s at the stated volume) and **NFR-11** (API p95 < 500 ms for single-entity reads). The API stays pinned to one App Service instance until TD-01 (NFR-05). Project list and project detail responses include `conversationUnread` so the list does not make one extra request per row.
- **NFR-61 (Must)** No polling while the browser tab is hidden or offline (FR-ARF-05). Failed polls back off (FR-ARF-07).
- **NFR-62 (Should)** The Conversation tab badge, the project-row badge and the mention picker are usable at 1440 and at 390.

There is **no** existing NFR that sets a general poll budget. FR-NTF-06 (60 seconds or focus, for the bell only) stays as it is. Import rate limits (NFR-41, NFR-52, NFR-55) do not apply to these GETs.

## 9. Edge cases

- **EC-227** The author's own message is never unread for them, on any device, including when they @mention themselves (FR-CNV-11, Q-178).
- **EC-228** An Admin-hidden message drops out of unread counts. A `CONVERSATION_MENTION` for a hidden message is not shown at read time, the same way FR-NTF-04 drops notifications the user can no longer access.
- **EC-229** Messages cannot be edited or deleted (FR-CNV-03). If that ever changes, unread and mentions must be defined in a later CR.
- **EC-230** A member is removed and no longer has View on the project: Conversation routes stay 404, the project-row badge is not shown, and their mention notifications for that project disappear (FR-NTF-04). If they still have View (for example they are a Viewer), they keep read access and unread badges.
- **EC-231** Viewers, and PMs who do not manage the project, can already read Conversation and cannot post (FR-CNV-04). They get unread badges. They appear in the mention picker only if they are on the project member list (Q-177).
- **EC-232** Portal contacts have no Conversation access (FR-ACL-30). No portal badge, no portal poll, no mentioning a portal contact.
- **EC-233** A mention of someone who is not a current member (typed as plain text, or an id sent to the API) does not notify, and does not have to be stored as a mention id. The message itself is still saved. (Q-179)
- **EC-234** A self-mention does not create a `CONVERSATION_MENTION`. (Q-178)
- **EC-235** Unread 0 hides the badge. A count above 99 shows `99+` (Q-171 closed).
- **EC-236** First open when the user has no last-read row follows the app-wide cutoff (Q-170 closed).
- **EC-237** A deactivated user gets no new mention notifications (EC-62). Their past messages still show, with the existing "(deactivated)" treatment.
- **EC-238** Two devices share last-read on the server. `$max` wins if both write. Each device updates on its own poll or focus.
- **EC-239** A poll or focus refetch while the user is editing must not reset the open form or inline editor (FR-ARF-06).
- **EC-240** While offline, intervals do not fire. On coming back online, a focus refetch or the resumed interval may run (FR-ARF-05).
- **EC-241** Mentioning a deactivated account, or a person who has just been removed from the project, is treated as "not a current member" at post time (no notification).

## 10. Assumptions

- **A-61** The client portal stays out of Conversation (FR-ACL-30, doc 15). This CR does not add portal access.
- **A-62** Conversation messages stay permanent, with Admin hide only (FR-CNV-03, Q-31).
- **A-63** Implementation is React Query `refetchInterval` and `refetchOnWindowFocus` on the in-scope hooks only. The defaults in `apps/web/src/main.tsx` do not change. There is no new Azure service in this CR.
- **A-64** Last-read storage follows the `followUpSeen` pattern (own collection, unique user + project, `$max`, a POST when the list is opened) but **does not reuse** `followUpSeen` or the follow-up cutoff marker `followUpSeenCutoff`.
- **A-65 (accepted, Lean, 2026-11-12 ~11:58 AM SGT)** The bell's unread poll stays 60 seconds plus focus (FR-NTF-06, `useUnreadCount`). A new mention can therefore take up to 60 seconds to appear on the bell if the window stays focused and the list is closed, or it appears on the next window focus. This CR does not speed up the bell.
- **A-66** No email and no Microsoft Teams notification for Conversation in this CR. Follow-up action emails stay as they are.
- **A-67** Web only in v1, with the rules enforced in the API (Q-176 closed).
- **A-68** "Project member list" means the project's current team: the PM (`managerId`) and the people in `memberIds`, active staff only, including the PM even if they are not also in `memberIds` (Q-177 closed). Viewers who are not on the team are excluded.
- **A-69** My tasks, Dashboard, Reports, Documents, Time, Activity, Issues and Setup are outside the 10- and 30-second polls (Q-172 closed).
- **A-70** Jomerson's item 3 ("Checklist is not updating") is this CR, not a separate bug.
- **A-71** Jomerson's "automatic checks OK for now" means polling at the intervals Lean set, not server push.

## 11. Conflicts with the current build (`origin/main` `30a0cb9`)

These are gaps this CR is meant to close, or defaults the build must not change by accident:

1. `apps/web/src/main.tsx` sets `staleTime: 30_000` and `refetchOnWindowFocus: false` for every query. In-scope hooks must override that. The file itself must keep those defaults (FR-ARF-04, AC-79.7).
2. `useMessages`, `useProject`, `useProjectTasks`, `useTask`, `useTimeline` and `useProjects` have no `refetchInterval` and do not refetch on focus. They only invalidate after the **same browser's** mutations. That is why Conversation, Follow-ups and the Checklist stay stale until a manual refresh. `ProjectDetailPage` keeps `useProject` and `useProjectTasks` mounted when switching project tabs, so leaving Checklist and coming back also does not refetch.
3. The only existing list polls are the bell (`NOTIFICATION_POLL_MS = 60_000`, `refetchOnWindowFocus: true` in `useUnreadCount`) and the running timer (`useRunning`, 60 seconds). Copy that pattern; do not replace them.
4. There is no Conversation last-read collection, no `conversationUnread` field, and no badge on the Conversation tab or the project row (`ProjectsPage` has status/health badges only).
5. There is no @mention picker and no `CONVERSATION_MENTION` type. `apps/api/src/routes/conversations.ts` does not call `notify()`. The composer can already tag a task and a client contact (FR-CNV-02); that stays, and is not a staff mention.
6. `badgeCount` in `apps/web/src/lib/m3ui.ts` caps the **bell** at `9+`. Do not reuse that cap for Conversation unread unless Q-171 chooses `9+`.
7. `TaskFormModal` and the Conversation composer keep local `useState` initialised on mount, so a parent refetch does not by itself reset them. The build must keep it that way, and apply the same rule to any inline editor (including CR-23 deliverable item edits on PR #51).
8. No SSE, WebSocket, PubSub or SignalR client or API exists in `apps/` or `packages/`. Do not add one in this CR. Polling is compatible with the Vercel `/api` rewrite and the Azure App Service API; a long-lived stream through that rewrite is not in scope and is not documented as supported.
9. FR-NTF-01 to 13, the follow-up badge cutoff (`followUpSeenCutoff` in `appMarkers`) and optional `FOLLOW_UP` action emails are unchanged.

## 12. Questions (all closed)

**Closed by Lean** (PM room, 2026-11-12 ~11:58 AM SGT), verbatim: "I accept all of your suggestions for Q-170 to Q-183, plus A-65." The decisions below are those suggested answers, as written. Q-174 and Q-175 were not used. A-65 is accepted.

| ID | Question | Decision (Lean, 2026-11-12 ~11:58 AM SGT) | Decider |
|----|----------|-------------------------------------------|---------|
| **Q-170** | When a user has **no last-read row** yet, what is unread? | **Closed.** Same idea as FR-NTF-11b. On first API start of this release, write **one app-wide cutoff** once (a new `appMarkers` id, not `followUpSeenCutoff`). Messages at or before the cutoff count as already seen. No last-read rows are pre-created. After the cutoff, other people's messages count as unread until the user opens that project's Conversation. | Lean |
| **Q-171** | Badge cap for the Conversation tab and the project row: **9+** (today's bell) or **99+**? | **Closed.** **99+** for these two badges only. A busy project can pass 9 quickly. Leave the bell at **9+**. | Lean |
| **Q-172** | Does "every page refetches on tab focus" mean the **whole app**, or **in-scope screens only**? | **Closed.** **In-scope only**, matching Lean's "for these screens only." Do not flip `refetchOnWindowFocus` in `main.tsx`. My tasks, Dashboard, Reports, Documents, Time, Activity, Issues and Setup stay as they are. Board is in, as part of the project task list (FR-ARF-03). | Lean |
| **Q-173** | Does the **Projects list** poll `conversationUnread` while it is visible, or only on focus? | **Closed.** Poll every **30 seconds** while the list is visible, and also on focus, so a badge can appear without opening the project or refreshing. Those checks fetch only the unread count (FR-ARF-08). | Lean |
| **Q-176** | Web only in v1, or also mobile? | **Closed.** **Web only in v1**, with last-read, unread counts and mention rules enforced in the API so a later mobile client inherits them (same as Q-165 / Q-143). | Lean |
| **Q-177** | Who is on the **project member list** for @mentions? | **Closed.** Active staff who are the project's **PM** (`managerId`) or in **`memberIds`**. Include the PM even if they are not also in `memberIds`. Exclude Viewers who are not on the team, deactivated users, and portal contacts. Admins are included only when they are PM or a member. | Lean |
| **Q-178** | What happens on a **self-mention**? | **Closed.** The picker may include the author. A self-mention **does not** create a `CONVERSATION_MENTION` and **does not** affect unread (the message is the author's). | Lean |
| **Q-179** | What if the API is sent a mention id that is **not a current member**? | **Closed.** Save the message. **Ignore** that mention id. **Do not** notify. The picker never offers that person. | Lean |
| **Q-180** | Does clicking the mention notification set last-read? | **Closed.** **Yes, because it opens the Conversation tab**, and opening the tab sets last-read (FR-CNV-10). The notification is marked read separately (FR-NTF-03). This is different from the follow-up badge, where a bell click alone does not mark follow-ups seen (AC-66.7), because that click does not open the Conversation tab. | Lean |
| **Q-181** | If a poll finds that someone else changed the task (or item) the user is editing, should we toast, or only keep the draft and rely on 409 at save? | **Closed.** **Keep the draft** and rely on the existing 409 `VERSION_CONFLICT` (or equivalent) at save. No toast is required in this CR; UIE may add one later. | Lean |
| **Q-182** | Should a poll run while a mutation from this browser is in flight? | **Closed.** **Skip** the interval while that screen's mutation is pending, so a refetch cannot race the save. Focus refetch may wait until the mutation settles. | Lean |
| **Q-183** | Email or Microsoft Teams for Conversation mentions, or for Conversation unread? | **Closed.** **No, not in this CR.** In-app only (FR-NTF-15, Q-28). Q-99 stays a separate question. | Lean |

## 13. Status

- **v0.1.1, Ready for build.** Scope is locked by Jomerson (11:52 AM SGT) and Lean (11:53 AM SGT). Q-170 to Q-173 and Q-176 to Q-183 are **closed** (Lean, 11:58 AM SGT), using Rich's suggested answers as written. A-65 is accepted. Lean has approved building on `feature/cr24-auto-refresh`. Staging and live still go through the normal path.
- Once approved into the core docs: FR-ARF-01 to 08 go into a new Auto-refresh note in doc 07 (and a short pointer in doc 03); FR-CNV-09 to 15 and FR-NTF-14 / 15 into doc 12; US-78 to 80 into doc 04; AC-79.x to 81.x (including AC-80.9 to 80.11) into doc 05; EC-227 to 241 into doc 08; NFR-59 to 62 into doc 07; A-61 to 71 and Q-170 to Q-183 into doc 09.
