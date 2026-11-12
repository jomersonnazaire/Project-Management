# CR-24 UI: auto refresh, Conversation unread and @mentions

**Mockup:** `docs/design/mockup/index-v0.9.22.html`, sidebar section "CR-24 · v0.9.22" (`#cr24-projects`, `#cr24-convo`, `#cr24-bell`, `#cr24-states`).
**Aligned to:** CR-24 v0.1, `docs/requirements/17_CR-24_AUTO_REFRESH_AND_CONVERSATION_UNREAD.md` (`docs/cr-24-auto-refresh` `07a3bb0`). Rulings applied: Q-170, Q-171, Q-172, Q-173, Q-176 to Q-183 and A-65.
**Built against:** `origin/main` `30a0cb9` (`ProjectDetailPage.tsx` tabs, `ConversationTab.tsx`, `ProjectsPage.tsx` with `.table-stack-md`, `NotificationBell.tsx`, `main.scss`).
**Data:** example data only. Every person in the mockup and the screenshots is a placeholder (Test PM, Alt PM, Dev One, Dev Two, QA One, Docs Writer, Data Lead, Ops Test, Viewer One, `name@xceler8.example`). The signed-in user is Dev One (`dev1@xceler8.example`).

## 1. What changes on screen

| Where | Change |
|---|---|
| Project tabs | The Conversation tab gets an unread pill. |
| Projects list | The project name cell gets the same pill, on the desktop table and on the phone card. |
| Conversation | A "New messages" divider at your last-read point, @mention picking in the composer, highlighted mentions in posted messages, and a "1 new message" jump button. |
| Bell | A new `CONVERSATION_MENTION` row. |
| Auto refresh | No visible change. Data updates in place (§6). |

## 2. Unread pill (`.unread-count`)

One component, used on the tab and on the project row.

- **Look:** a solid primary pill (`#5355e0` background, white 12px/600 text, 5.61:1 contrast). It's deliberately different from the Issues tab's `bg-label-danger` count, because unread means "new", not "problem". It uses tabular numerals and has a minimum width of 1.375rem, so 1 and 12 look like the same object.
- **Count:** messages from other people since your last-read time that aren't hidden (FR-CNV-10 to 12). Your own messages never count (FR-CNV-11), and posting advances your own last-read. The server computes the count and returns it as `conversationUnread` (AC-80.7).
- **Cap:** **99+** above 99 (Q-171). The bell keeps its own **9+** (`badgeCount`), unchanged.
- **Zero:** at 0 the pill isn't rendered at all. There's no empty pill and no "0".
- **@ marker (proposed, see Q1 in §10):** when at least one unread message mentions you, the pill starts with `bx-at` (for example "@3"). With no mention, the project row shows `bx-message-rounded-dots` and the tab shows the number only.
- **Release:** at release, everything earlier counts as read (Q-170), so nobody opens the app to a wall of 99+ badges.

### 2.1 Conversation tab
- Markup: `{label}<span class="unread-count" aria-hidden="true">3</span><span class="visually-hidden">, 3 unread</span>` inside the existing `NavLink`. The accessible name is "Conversation, 3 unread", or "Conversation, 3 unread, one mentions you". It doesn't rely on `aria-label` on a `span` (the Issues tab pattern), which screen readers ignore.
- Opening the tab clears it: last-read is set on the server, the pill is removed straight away (an optimistic cache update for `conversationUnread` on the project detail query and on the list query), and it stays cleared on other devices after their next check (AC-80.2, AC-80.4). Viewing the Checklist or any other tab doesn't clear it.
- **Phone (390):** the tab strip scrolls (`nav-scrollable`), and Conversation is the fifth tab, so it starts off screen. When the Conversation pill is out of view, a cue sits on the right edge of the strip: the same pill plus a chevron, over a fade into `#f5f5f9`. Tapping it scrolls the strip to Conversation and focuses that tab. The cue has the visually hidden text "More tabs. Conversation has 3 unread." It hides itself once the tab is in view. Screenshots: `cr24-mock-tab-badge-390.png` (cue) and `cr24-mock-tab-badge-scrolled-390.png`.

### 2.2 Project row
- The pill sits in `td.cell-primary`, right after the project name, in a flex wrapper (`.c24-name`, `gap .5rem`, wraps). It's a link straight to `/projects/:id/conversation`. Its `aria-label` is "{Project} Conversation, 3 unread[, one mentions you]", and its `title` gives the same text for mouse users.
- A row with unread messages shows the project name at weight 600. That's a second cue, so the state isn't carried by colour alone.
- **1440:** the pill wraps under the name when the column is narrow. It never pushes other columns.
- **390 (`.table-stack-md` card):** the name and pill share the first line (`justify-content: space-between`, `flex-wrap: nowrap`). A long name wraps with `overflow-wrap: anywhere`, and the pill stays on the right.
- **How it clears:** clicking the pill or opening the project's Conversation tab clears it. The pill fades out (.25s scale and fade, and simply hidden when `prefers-reduced-motion` is set), and the row is plain when you come back. The list checks every 30 s while visible and on focus (Q-173), so a cleared pill can't come back unless someone posts again.

## 3. "New messages" divider

- This reuses the Follow-ups `.fu-new` pattern (FOLLOWUPS_CONVERSATION_UI.md): a red label (`#b8240a`, 12px/600) between two `#ffb8ab` rules, with `role="separator"` and the label "New messages since you last opened this Conversation".
- It sits before the first message from someone else that's newer than the last-read time **as it was when you opened the tab**. That value is kept in component state for the visit, so the divider doesn't jump when last-read is written or when a check brings more messages. It's gone on the next visit.
- On open, the page scrolls the divider into view, 140px below the top bar. With no unread messages there's no divider, and the page doesn't scroll.
- A message that mentions you gets a soft `#f6f6ff` row tint. "@Dev One" (you) is a solid primary chip, and other mentions are `#e7e7ff` chips (§4.3).

## 4. @mentions in the composer

### 4.1 Who can be picked (Q-177)
Active staff who are the project's PM (`managerId`) or in `memberIds`. Deactivated users, Viewers who aren't on the team, client or portal contacts, and anyone removed from the project are never offered. The role column shows the Team tab's wording: **Project manager** or **Member**. The mockup leaves the author out of the list. Q-178 allows either, and a self-mention never notifies anyway.

### 4.2 Picker
- **Trigger:** typing `@` at the start of the text or after a space opens the list straight away. Each further letter filters it by the start of any word in the name, case-insensitive ("@d" finds Data Lead, Dev Two and Docs Writer; "@two" finds Dev Two). A query can include one space ("@dev t").
- **Position:** anchored to the textarea, opening **above** it (the composer is at the bottom of the card), 8px from the left edge. It's 20rem wide on desktop and full composer width at 390. The list scrolls past about 6 rows (max-height 14.5rem).
- **Row:** a 28px initials avatar (`bg-label-primary`, like the live Conversation avatars), the name with the typed part in bold, and the role right-aligned in muted 12px. The selected row has a `#e7e7ff` background.
- **Header:** "PROJECT MEMBERS". **Footer:** key hints (↑↓ move · Enter or Tab pick · Esc close), hidden in the empty state.
- **Keyboard:** Up and Down move and wrap. **Enter** or **Tab** inserts the selected person. **Esc** closes the list and keeps the typed text, and the list stays closed for that `@` until you type a new one. While the list is closed, Enter makes a new line as it does today. A mouse `mousedown` on a row picks it without blurring the textarea.
- **Empty state:** "No project member matches **@zz**. Only people on this project's team can be mentioned." If the query has a space and nothing matches, the list just closes, because the user is typing plain text.
- **ARIA:** the textarea has `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded` and `aria-controls` pointing at the `role="listbox"`, and `aria-activedescendant` set to the selected `role="option"`. A polite status region announces "3 project members match. Data Lead, Member." and "Dev Two mentioned."

### 4.3 In the draft and in the posted message
- Picking inserts `@Full Name ` and records the user id. In the draft, mentions show as chips through a highlight layer behind a transparent textarea. It has the same font, padding and wrapping, so it lines up character for character, and the native textarea (undo, IME, spellcheck, paste) is kept. If you delete any character of a mention, it becomes plain text and its id is dropped.
- Under the box, the hint changes from "Type @ to mention a project member. Only people you mention get a bell notification." to "🔔 Notifies **Test PM** and **Dev Two** in the bell." This matches the Follow-ups "Notifies …" hint.
- After posting: the toast "Posted. Test PM and Dev Two get a bell notification." The message shows each mention as an `@Name` chip (`.mention`: `#e7e7ff` background, `#3c3eb8` text, 500 weight, `nowrap`). A mention of the person reading is a solid `#5355e0` chip with white text, plus visually hidden "(you)".
- Text stays plain text (FR-CNV-04). Only stored mention ids render as chips. An `@Name` typed without picking, a non-member, or a removed or deactivated user stays plain text and doesn't notify, and the message still saves (Q-179, EC-233, EC-241).
- **Viewer and other read-only readers:** no composer (the existing "You can read this conversation but not post."). They still see mention chips and get unread badges (AC-80.8, EC-231).

### 4.4 "1 new message" jump
When a check adds messages from other people and the newest one is below the visible area, a primary pill appears: "↓ 1 new message" (or "N new messages"). It's sticky at the bottom of the thread on desktop and fixed 16px above the bottom of the screen at 390. Clicking it scrolls to the message. It hides itself once the message is on screen. The page never scrolls by itself because of a check, and the composer keeps its text and caret.

## 5. Bell: `CONVERSATION_MENTION` row

- The row uses the existing `NotificationBell` layout (dot, `notif-unread` tint, 360px menu, full width minus 24px at 390).
- **Sentence:** "**Test P.** mentioned you in **Acme Test Co Rollout**". The verb is "mentioned you in" (FR-NTF-14), and the project is the object, so the usual " · {project}" suffix isn't repeated.
- **Quote (proposed, see Q2 in §10):** up to 2 lines of the message as plain text, with mentions shown as `@Name`, behind a 2px `#c9caff` left rule.
- **Meta line:** a `bx-message-rounded-dots` "Conversation" type cue, then `relativeTime` ("42 min ago").
- **Click:** marks it read and opens `/projects/:id/conversation?message=:messageId`. That sets last-read (Q-180), so the tab and row pills clear. The page scrolls to the message and highlights it with the CR-20 `#fff8e6` target tint until the next click. Screenshot: `cr24-mock-convo-from-bell-*.png`.
- **Timing:** the bell keeps its 60 s check, so a mention can take up to 60 s to show if the window stays in front (A-65). Notices are web only, with no email or Teams (FR-NTF-15, Q-183). An Admin-hidden message's notice drops at read time (EC-228).
- **Empty-state copy update:** "Follow-ups, mentions and issues for you will show here." (today it reads "Follow-ups on your tasks and issues will show here.").

## 6. Auto refresh states (`#cr24-states`)

| State | What the user sees |
|---|---|
| First load | The existing `LoadingRows` skeleton, once per mount. |
| Background check (10 s on Conversation and Follow-ups, 30 s on the header, Checklist, Board, Timeline and the Projects list) | Nothing that announces it: no spinner, no "Updating", no focus or scroll change. Rows and messages update in place. Use `isPending` (not `isFetching`) for skeletons and button states. The Conversation thread keeps its polite live region, and other screens stay quiet. |
| Edit in progress | Drafts and open editors keep what's typed (composer, Follow-up composer, Edit task, inline deliverable item, phase name, import preview). The list around them may update. A clash on save uses today's 409 `VERSION_CONFLICT`, with no new toast (FR-ARF-06, Q-181). No check runs while a save from this browser is in flight (Q-182). |
| Hidden tab or offline | No requests. When you come back, one check runs straight away (FR-ARF-04, FR-ARF-05). |
| Check fails | Nothing on screen. Old data stays, and the client backs off (doubling up to 60 s, then back to normal after a success, FR-ARF-07). Only a failed first load shows the existing `ErrorAlert`. |

Scope is in-scope screens only. The `main.tsx` defaults don't change (Q-172), and the native app is out of v1 (Q-176).

## 7. Responsive rules

| | 1440 | 390 |
|---|---|---|
| Tab pill | Inline after the label, `gap .5rem` | Same. The edge cue shows when the Conversation tab is scrolled out of view. |
| Project row pill | After the name, wraps under it if the column is narrow | First line of the card, right-aligned, and the name wraps |
| Conversation layout | `col-lg-8` thread and `col-lg-4` side cards, top-aligned | One column, filters wrap 2 per line, composer selects full width |
| Picker | 20rem, above the textarea | Full composer width, above the textarea |
| Jump pill | Sticky at the bottom of the thread | Fixed 16px above the bottom of the screen |
| Bell menu | 360px, right-aligned | `100vw - 24px` |

I checked each screenshot for horizontal overflow (`scrollWidth` equals the viewport at both widths), clipping and alignment. Fixes made along the way: an absolutely positioned visually-hidden span inside the scrolling tab strip was widening the page at 390 (the tab link now has `position: relative`); the side cards were vertically centred by a global `.row` rule (now `align-items: flex-start`); and the unread-pill modifier was renamed so it no longer picks up the `.mention` chip padding.

## 8. Accessibility

- Every count has a text equivalent, either visually hidden text or `aria-label` on a link. Colour is never the only cue: the pill has a number, a row has bold text, and a mention has `@` plus "(you)".
- Contrast: white on `#5355e0` is 5.61:1. `#3c3eb8` on `#e7e7ff` is 6.71:1. `#b8240a` on white is 6.37:1. Muted text `#5d6878` is 5.65:1.
- The picker follows the ARIA 1.2 combobox-with-listbox pattern (§4.2). Focus never leaves the textarea.
- Motion: the fade on clearing respects `prefers-reduced-motion`, and the mockup's scrolls are instant.
- Touch: the project-row pill is 18px tall, so the project name next to it stays the main tap target. The build should pad the pill link to a 24px hit area. The edge cue spans the full height of the tab strip.

## 9. Screenshots (`docs/design/review/`)

`cr24-mock-{name}-{1440|390}.png` for: `tab-badge`, `tab-badge-scrolled`, `tab-badge-cap`, `project-row-badge`, `project-row-cleared`, `convo-new-divider`, `composer-mention-picker`, `composer-mention-nomatch`, `composer-mention-chips`, `posted-mention`, `convo-new-arrived`, `convo-from-bell`, `bell-mention-row`, `states`.

## 10. Open questions (for Rich and Lean)

Questions already closed by Q-170 to Q-183 and A-65 aren't repeated here.

1. **The @ marker in the pill.** Do we want it? It needs one more server field, for example `conversationMentionUnread` (a count, or a boolean) next to `conversationUnread` on `GET /projects` and `GET /projects/:id`. If not, the pill shows the number only.
2. **Quote in the bell row.** Can the notification carry a plain-text excerpt of the message, for example the first 140 characters with mentions as `@Name`? If not, the row is just the sentence and the time.
3. **Last-read while you're watching.** While the Conversation tab is open and visible, should each check that brings new messages also advance last-read? My suggestion is yes, so the pill doesn't reappear for messages you saw arrive. The divider still stays where it was for the visit.
4. **Mention format in storage and display.** Ids are stored on the message (FR-CNV-13). Do we render the person's current name, or the name at post time? My suggestion is the current name. Also, which text format should Deven use: an inline token such as `@[name](user:id)`, or `mentionIds` plus character ranges?
5. **Phone edge cue.** Is the right-edge cue on the scrolling tab strip enough at 390? The alternative is putting Conversation earlier in the tab order on phones.
6. **Follow-ups.** CR-24 refreshes Follow-ups (FR-ARF-02), but I've added no new Follow-ups pill, because the CR-20 follow-up badge and the "New" divider already cover it. Please confirm that nothing extra is wanted.
7. **Mention limit.** Should there be a cap on mentions per message (for example 10), or none? There's no `@all` or `@team` in this CR.
