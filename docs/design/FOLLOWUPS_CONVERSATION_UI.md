# Follow-ups conversation: UI spec (v0.9.19)

Build spec for Deven. This changes the look of **Task panel › Follow-ups** (`apps/web/src/pages/projects/TaskPanel.tsx`, the `Follow-ups` h3 block). Rich adds a CR-20 changelog pointer to this note. Mockup: `mockup/index-v0.9.19.html#followups`. The CR-20 task panel (`#cr20check`, then open a task) uses the same thread.

## What does NOT change
- API, payloads, and how notes are posted.
- Seen rules (FR-NTF-09..12): opening the list marks all of its follow-ups as seen. Your own notes are seen from the start.
- Email: the `Email {names}` checkbox, `emailedAt`, and the `Notifies …` helper behave as they do today.
- Permissions: the composer shows only when `t.can.edit && !archived`.

## Layout (top to bottom)
1. **Thread** (`.fu-thread`). It scrolls, takes the remaining height, and opens scrolled to the newest message.
2. **Day chip** (`.fu-day`). A centered muted pill reading `Nov 4`, … and `Today`. It shows only where the day changes. There are no borders between messages.
3. **Message** (`.fu-msg`):
   - Avatar: a 32px circle, then the author name (13px, 600, `#384551`), then a bubble (`.fu-b`, 15px, `#22303e`, radius 12px with the corner on the avatar side at 4px), then the time (12px, `#5d6878`) under the bubble.
   - **Others** sit on the left in a light grey bubble (`#f1f3f5`).
   - **Own** messages (author = signed-in user) sit on the right in a soft primary tint (`#e7e7ff`, Sneat `bg-label-primary` background). The name reads **You**.
   - The bubble is at most 88% of the thread width (94% at 480px and below).
4. **Runs:** a run is consecutive messages from the same author on the same day with no New divider between them and with less than 5 minutes between each pair. A gap of 5 minutes or more starts a new run, which shows the avatar and name again (Lean, Nov 5, 2026). Only the first message of a run shows the avatar and name. Later messages keep the avatar's space, so the bubbles line up, and carry a visually hidden author name for screen readers.
5. **Emailed:** a 13px envelope icon after the time, with `title="Emailed"` and a visually hidden "Emailed". Drop the `· Emailed` text.
6. **New divider** (`.fu-new`): a thin 1px `#ffb8ab` line with a centered `New` label (12px, 600, `#b8240a`). It sits above the first unseen message and only when the unseen count is above 0, computed when the panel opens. This replaces the cream `#fff8e6` block and the per-message New pill.
7. **Composer** (`.fu-comp`). It is pinned under the thread with a top border `#e4e6e8`. It holds:
   - a 2-row textarea, Sneat `form-control` style, focus ring `#5355e0`
   - the `Notifies …` helper (13px muted)
   - a row with the `Email {names}` checkbox on the left and **Post follow-up** on the right (`btn btn-primary btn-sm`)

## States
| State | UI |
|---|---|
| Empty | Centered muted 44px grey circle with a 💬 icon (use a bx icon in the app), **No follow-ups yet**, and the line "Post the first note below. The team will see it here." The composer still shows. |
| Seen | Thread with no New divider. |
| Unseen | New divider above the first unseen message. The divider is gone the next time the panel opens. |
| Emailed | Envelope icon with the "Emailed" tooltip. |
| Avatar: Photo | Circular `<img>`, 32px, `object-fit:cover`, `alt=""` (the name is in the text). |
| Avatar: Initials fallback | Same 32px circle. Two letters: the first letter of the first word plus the first letter of the last word, or the first two letters of a single word. Colour comes from the Sneat label palette (primary, success, info, warning, danger, secondary), picked by a hash of the name so a name always gets the same colour. |

## Avatars (CR-21 can point here)
- **Source (locked by Lean):** on Microsoft sign-in the API fetches Graph `/me/photo/$value`, resizes it to 96px, and stores it in blob storage. It is served by a signed-in `GET /users/:id/avatar`. A 404 means show initials.
- **Where it shows:** the top-bar account avatar, the Users list, and the Follow-ups thread. All three use one component: try the photo and fall back to initials on 404 or an image error, at the same size with no layout shift.
- Password sign-in or no photo shows initials. A failed photo fetch must never block sign-in.
- **Needs backend:** the Graph photo fetch, blob storage and the avatar route. Lean decides whether Graph ships with this change or in a follow-on. The Follow-ups restyle can ship with initials only until Graph is wired.
- The mockup uses abstract gradient placeholders for Maria P. and Ken L. Rita R. shows the initials fallback in the same thread, and the top bar shows the signed-in demo user's photo. Seeded accounts aren't Microsoft accounts, so **Jomerson checks real photos on staging**.

## Responsive
- Offcanvas (about 400–480px): the panel body becomes a flex column, the thread scrolls and the composer stays pinned.
- At 390px (phone): the offcanvas is full width with 12–16px padding and bubbles at up to 94% width. The checkbox row wraps if the names are long, and Post follow-up stays right-aligned.

## Contrast (WCAG AA, checked)
| Text / background | Ratio |
|---|---|
| Body `#22303e` on grey bubble `#f1f3f5` | 12.1:1 |
| Body `#22303e` on own bubble `#e7e7ff` | 11.07:1 |
| Name `#384551` on `#fff` | 9.82:1 |
| Time and meta `#5d6878` on `#fff` | 5.65:1 |
| Day chip `#5d6878` on `#ebeef0` | 4.85:1 |
| New label `#b8240a` on `#fff` | 6.37:1 |
| Button `#fff` on `#5355e0` | 5.61:1 |

Initials on label backgrounds:

| Label | Ratio |
|---|---|
| primary | 4.61:1 |
| warning | 4.89:1 |
| info | 4.92:1 |
| success | 4.72:1 |
| danger | 5.14:1 |

All pass 4.5:1.

## Demo data
Seeded or example names only: Maria P. (signed-in demo user), Ken L. and Rita R. on `#followups`. The CR-20 panel keeps its seeded QA accounts with PM2 signed in.
