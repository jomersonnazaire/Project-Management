# Milestone 3 Design Review (PR #5) — Oct 9, 2026, UIE
Result: PASS with 4 Low findings. Admin and member: no page errors, no failed API calls; phone at 390px fits.
Matches mockup v0.7.4: Today tab (overdue first in red, Philippine time label, Log time), task panel evidence drop zone with file rules, follow-ups, Conversation (types, task/contact tags, permanence note, empty state), notifications dropdown with unread dots and Mark all as read, Documents folders, Holidays tab with Working days (Save disabled until changed), grip drag handle.
- DR-13 (Low): Timeline placeholder says "This tab is planned for Milestone 3." while this is Milestone 3. Say "coming in a later milestone".
- DR-14 (Low): Conversation composer "Tag a client contact (optional)" is clipped to "(optior". Widen or shorten to "Tag a contact".
- DR-15 (Low): notifications dropdown footer reads "Showing your latest notifications"; agreed copy is "Showing the last 90 days".
- DR-16 (Low): sidebar "Documents" still shows "Soon" though documents now work inside each project. Either hide the global item until it exists or add a hint "Open a project's Documents tab".

## Follow-up PR #6 — Oct 9, 2026, 7:20 PM SGT
PASS. DR-14, DR-15, DR-16 fixed. Request document button, Requested/Submitted/Signed tabs, "Who can see" folder button, Dashboard Waiting on client cards, Holidays list with official PH data all match. No page errors or failed calls.
- DR-13 partly fixed: title now "The timeline is coming in a later milestone", but the line below still says "This tab is planned for Milestone 3." Remove or change that line.
- DR-17 (cosmetic): Holidays toolbar wraps to two rows at 1440 (Copy from 2025 / + Add holiday drop below). Optional: move "+ Add holiday" to the page header.
