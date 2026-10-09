# Milestone 3.5 Design Review (PR #7) — Oct 9, 2026, UIE
Result: PASS with 1 Medium and 4 Low. Admin and member: no page errors, no failed calls; phone fits at 390px.
Matches mockup v0.7.6: My tasks tab order Today, Due, Assigned to me, I'm accountable, To review, Completed; Planned for today / Aging with working-day badges (amber 3, red 7); All issues list (red edge on Critical, "Owner needed" in red, script shown as text); project Issues tab counts and empty state; issue page with status steps, attachments, history, side fields, due date "from severity". DR-13 and DR-17 fixed.
- DR-18 (Medium): issue history shows a raw database id, "Owner: – → 6ac872cb6f0f772c90a0a026". Show the person's name.
- DR-19 (Low): after the five status steps there's an outlined "Waiting on client" button that reads like a sixth step. Label it "Move to Waiting on client" and set it apart (or move status changes to the side Status field only).
- DR-20 (Low): history field names in lower case ("attachments: – → ok.pdf"). Use "Attachment added: ok.pdf".
- DR-21 (Low): Aging subtitle still "planned date has passed, not done yet". Use "planned start has passed and not started, or past due".
- DR-22 (Low): project header has two filled primary buttons (+ Raise issue, Edit project). Make "+ Raise issue" outline, or show it only on the Issues tab. All issues filters also wrap to three rows at 1440; put Export CSV in the page header.
