# Milestone 1.5 Design Review (PR #2, e117ff9) — Oct 9, 2026, UIE
Result: PASS. Matches mockup v0.5.2 and theme tokens.
- Access rules: four role tabs, 14 rows, n/a cells, locked Admin rows, PM Projects "Archive only", fixed scope column, Reset, "How changes apply" with last-saved line. Menu item hidden for non-Admins.
- Clients: list (contacts/projects counts), detail with Details/Contacts/Projects tabs, lock notice, read-only for Viewer (no Add/⋮).
- Viewer: every reachable screen (My tasks, Clients, client detail tabs) loads with no alert and no 4xx from the API; Admin/Teams isn't in a Viewer's menu, so the teams 403 never surfaces.
- DR-05 fixed: Admin tab row scrolls (overflow auto) at 390px. DR-06 fixed: close × inside the invite modal header.
- Deviations accepted from design side: optional contact email (drop the * in the mockup), API-only permission summary, in-app unsaved warning (Low, Should).
- DR-07 (cosmetic, optional): grid row labels render uppercase with pink keys; mockup used sentence-case bold labels with grey keys. Fine to leave.
