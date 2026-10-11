# Doc 14 message wording check (UIE)

**Checked:** Rich's messages in `docs/requirements/14_WORKFORCE_FEATURES.md` §11, updated by §12.3 (doc v0.8.5)
**Against:** clickable mockup v0.8.2 (`docs/design/mockup/index-v0.8.2.html`), which uses Rich's §12.3 text where there is one and §11 text everywhere else
**Date:** 2026-10-09 · **Status:** revised for Jomerson's decisions. Q-46 = no leave approval, so the approval items are removed (the "Leave rejected" notification, the reject-comment validation and the approved notice).

✅ = fine as written. ⚠ = small issue, rewrite optional. ✖ = rewrite recommended. "Space" = the box the message appears in at 1440 px.

## Summary
| # | Case | Source | Verdict | Remaining issue |
|---|------|--------|---------|-----------------|
| 1 | Microsoft account not set up | §11 | ✅ | — |
| 2 | Wrong tenant | §11 | ⚠ | "your Xceler8 account" doesn't point password users to email and password, now one of the two official options |
| 3 | Deactivated user | §11 | ✅ | — |
| 4 | Microsoft sign-in failed or cancelled | §11 | ✅ | Optional fallback if it keeps failing |
| 5 | 24-hour daily cap | §12.3 | ⚠ | `{HHh MMm}` ("25h 10m") vs the §12.2 rule that time always shows as HH:MM ("25:10") |
| 6 | Overlapping entry | §11 | ⚠ | Task name without quotes |
| 7 | Submit with timer running | §11 | ⚠ | Long for the inline hint |
| 8 | Day locked | §12.3 | ⚠ | Wrong after the weekly lock, when only an Admin can reopen |
| 9 | Day reopened (notification) | §12.3 | ✅ | — |
| 10 | Report sent | §11 | ⚠ | "2 CC" |
| 11 | Report send failed | §11 | ⚠ | `{reason}` must be plain language |
| 12 | No Outlook mailbox | §12.3 | ⚠ | "Has been notified" before the user has exported |
| 13 | Leave over balance | §12.3 | ✅ | — |
| 14 | Leave overlaps | §11 | ⚠ | Doesn't say what to do |
| ~~15~~ | ~~Leave rejected (notification)~~ | — | Dropped | No approval (Q-46) |

## Message by message

### 1. Microsoft account not set up ✅
- **Text:** "Your Microsoft account isn't set up in this app. Ask an Admin for an invite."
- **Where:** `#mslogin`, 2nd sign-in card.
- **Check:** Clear, short, gives a next step. Matches Q-37 (no auto-create).

### 2. Wrong tenant ⚠
- **Text:** "This Microsoft account belongs to a different organization. Sign in with your Xceler8 account."
- **Where:** `#mslogin`, 3rd sign-in card.
- **Issue:** Q-36 makes email and password one of the two official options, but the message doesn't mention it. "Xceler8 account" is also ambiguous: it could mean the Microsoft account or the app account.
- **Suggested:** "This Microsoft account belongs to a different organization. Sign in with your Xceler8 Microsoft account, or use your email and password."

### 3. Deactivated user ✅
- **Text:** "Your account has been deactivated. Contact an Admin if you think this is a mistake."
- **Where:** `#mslogin`, "Deactivated user" card. Applies to both sign-in options.

### 4. Microsoft sign-in failed or cancelled ✅
- **Text:** "Microsoft sign-in didn't finish. Please try again."
- **Where:** `#mslogin`, "Sign-in didn't finish" card.
- **Optional (after repeated failures):** "Microsoft sign-in didn't finish. Try again, or use your email and password."

### 5. 24-hour daily cap ⚠ (§12.3 text adopted)
- **Text:** "This would bring your total for {date} to {HHh MMm}. A day can't exceed 24 hours. Shorten or remove an entry."
- **Where:** `#tracker`, "24-hour cap" card (example "25h 10m"). The same check applies to Add entry, Quick activity and Log time.
- **Issue:** §12.2 says rendered time "always shows as HH:MM (… total "25:10")", but this message uses "25h 10m". "25h 10m" reads better inside a sentence than "25:10", which can look like a clock time. Rich should either allow "h m" inside sentences as an exception or switch to HH:MM.
- **Recommendation:** keep "25h 10m" and add one line to §12.2: "In sentences, write durations as 25h 10m."

### 6. Overlapping entry ⚠
- **Text:** "This overlaps {other entry} ({start}–{end}). Adjust the times so they don't overlap."
- **Where:** `#tracker` › Quick activity; `#daysheet` › "Overlap refused" card and Add entry.
- **Suggested:** put the name in quotes: 'This overlaps "{other entry}" ({start}–{end}). Adjust the times so they don't overlap.'

### 7. Submit with timer running ⚠
- **Text:** "Stop the running timer before submitting this day."
- **Where:** `#daysheet`, inline hint next to the disabled Submit day button.
- **Suggested:** inline "Stop the timer to submit." Keep the full sentence for the tooltip and the server error.

### 8. Day locked ⚠ (§12.3 text adopted)
- **Text:** "This day is locked. Ask your supervisor or an Admin to reopen it."
- **Where:** `#daysheet`, "Submitted day (before weekly lock)" card.
- **Issue:** Lean confirmed that after the weekly lock **only an Admin** can reopen. On a weekly-locked day, this message sends the user to a supervisor who can't help. The mockup shows the supervisor view without a Reopen button and the hint "Only an Admin can reopen a day after the weekly lock."
- **Suggested second variant (after the weekly lock):** "This day is locked. Ask an Admin to reopen it."

### 9. Day reopened (notification) ✅ (§12.3 text adopted)
- **Text:** "{Name} reopened your timesheet for {date}: {reason}. Make your changes and submit it again before the weekly lock."
- **Where:** `#notif` › Workforce notifications; preview in `#daysheet` › Reopen modal.
- **Note:** Only a supervisor can reopen before the weekly lock, and only an Admin after it. When an Admin reopens after the lock, "before the weekly lock" no longer makes sense. Use the first sentence only in that case, or add "by {deadline}".

### 10. Report sent ⚠
- **Text:** "Report sent to {supervisor} and {n} CC."
- **Where:** `#dar`, "Sent" card.
- **Suggested:** "Report sent to {supervisor} and {n} other people." Use "1 other person" for 1, and drop the "and …" part when there are no CCs.

### 11. Report send failed ⚠
- **Text:** "We couldn't send your report: {reason}. Try again, or export it and send it yourself."
- **Where:** `#dar`, "Send failed" card and the Send confirm modal.
- **Issue:** `{reason}` must come from a short list of plain-language reasons, never a raw Graph error. Suggested list: "Microsoft didn't respond", "your mailbox needs permission. Ask an Admin", "a CC address was refused ({address})".

### 12. No Outlook mailbox ⚠ (§12.3 text adopted)
- **Text:** "You signed in with a personal email, so this app can't email your report. Export it instead. Your supervisor has been notified it's ready."
- **Where:** `#dar`, "Personal email (no mailbox)" card, where the Send button would be.
- **Issue:** This is a standing banner, so the last sentence shows before anything is exported. If the notice goes out on export (FR-DAR-04b), the sentence isn't true yet.
- **Suggested:** "…Export it instead. Your supervisor gets a notice in the app when you do." Or show Rich's sentence only as a toast after export.

### 13. Leave over balance ✅ (§12.3 text adopted)
- **Text:** "You have {n} {day|days} of {type} left, and this needs {m} {day|days}. Choose fewer days or another leave type."
- **Where:** `#leave` › Record leave modal.
- **Check:** Gives a next step, handles plurals and fits the space (2 lines). With half days, write "0.5 day" (singular), as the modal already does.

### 14. Leave overlaps ⚠
- **Text:** "You already have leave filed for {dates}."
- **Where:** `#leave` › Record leave modal.
- **Issues:**
  - Says what's wrong but not what to do.
  - "Filed" belongs to the approval flow. The UI now says "Record leave".
- **Suggested:** "You already have leave recorded for {dates}. Pick other dates, or cancel that leave first."

## Proposed texts for cases §11/§12 don't cover (used in mockup v0.8.2)
| Case | Proposed text | Where |
|------|---------------|-------|
| Leave recorded (to supervisor) | "{Name} recorded {type} leave for {dates} ({n} working days)." | `#notif` (supervisor section) |
| Leave cancelled by user (to supervisor) | "{Name} cancelled their {type} leave for {dates}. {n} days are back in their balance." | `#notif` |
| Leave cancelled by Admin (to employee) | "An Admin cancelled your {type} leave for {dates}. {n} day(s) are back in your balance." | `#notif` |
| Report ready, no mailbox (to supervisor) | "{Name}'s Daily Accomplishment Report for {range} is ready." | `#notif` |
| Cancel own future leave (confirm) | "Your balance is restored ({type} {before} → {after}) and {Supervisor} is told you cancelled." | `#leave` › Cancel |
| Record leave (form note) | "No approval needed. It shows as On leave right away, and {Supervisor} (your supervisor) gets an in-app notice." | `#leave` › Record leave |
| Location picker | Title "Where are you working today?" with the hint "Applies to all of today's entries. You can change a single entry later." | `#tracker` / `#daysheet` |
| After weekly lock (supervisor hint) | "Only an Admin can reopen a day after the weekly lock." | `#daysheet` |
| Project code taken | "This code is already used by another project. Codes must be unique." | `#newproj` |
| Project code locked | "Can't change once the project has issues, so issue IDs stay the same." | `#newproj` |
| Deactivate list value in use (confirm) | "It's used by {n} entries, so it can't be deleted. Those entries keep it. It won't be offered for new entries. You can reactivate it later." | `#actcat`, `#setloc`, `#setmod` |
| Duplicate list value | ""{name}" already exists." | same |

## Terms to keep consistent
- **Report name:** "Daily Accomplishment Report" everywhere. The mockup no longer uses "Daily Activity Report".
- **Leave:** "Record leave" and "Recorded / Cancelled", not "file", "pending", "approved" or "rejected".
- **Mailbox case:** "personal email" (user-facing), not "Outlook mailbox" or "Xceler8 mailbox".
- **Durations:** HH:MM in tables and the report; "25h 10m" inside sentences (see #5).
- **Lists:** "Activity type" (renamed from "Activity category"), "Location", "Module".
