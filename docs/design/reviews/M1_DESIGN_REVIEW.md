# Milestone 1 design review (UIE), Oct 9, 2026
Preview: PR #1 @ 424ea75. Compared against mockup v0.4.2 and THEME_TOKENS.md. Viewports 1440x1000 and 390x844. Screenshots in `m1/`.

## Matches the design
- Theme tokens applied exactly: primary #5355e0 with white text, muted badge #5d6878 on #ebeef0, body #646e78, Public Sans.
- Sign-in: generic "Email or password is incorrect", "You'll land on My tasks", Admin reset note, no "Forgot password?".
- My tasks empty state, Admin invite form with separate Access and Job roles, inline validation on every required field.
- Client contacts lock banner, 404 page, "Soon" badges on future modules.

## Findings
| ID | Severity | Screen | Finding | Suggested fix |
|---|---|---|---|---|
| DR-01 | Medium | Admin > Users (1440) | Table is 880px inside a 696px card. The actions column ("Copy reset link" / "New invite link") and part of Status are cut off, with no visible scroll hint. | Move the invite form into a modal opened by "+ Invite user" in the page header (as in mockup) so the table gets full width, or put row actions in a ⋮ menu like Client contacts. |
| DR-02 | Low | All pages | Top bar is empty and the page title sits in a second card below it, using ~70px of extra height. | Put the page title (and primary action) in the top bar, as in the mockup. |
| DR-03 | Low | Admin > Users (390) | Table scrolls sideways on mobile, hiding Access, Status and actions. | Below 768px, render each user as a stacked card (name, email, badges, actions). |
| DR-04 | Low | Admin > Users | Teams show "Management , Consulting" with a space before the comma. | Join with ", ". |
