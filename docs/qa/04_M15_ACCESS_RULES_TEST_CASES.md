# Milestone 1.5 test cases: access rules and client tabs (v0.1, from doc 11 v0.4.2)

| ID | Trace | Type | Pri | Steps | Expected |
|---|---|---|---|---|---|
| TC-M01 | FR-ACL-02, §6 | API | P1 | As Admin, GET access rules on a fresh deploy | All 4 roles × 14 record types match §6 |
| TC-M02 | FR-ACL-03, Q-27 | Both | P1 | PM, Member and Viewer open the screen, GET rules, and PUT rules | Menu item hidden; 403 on GET and PUT |
| TC-M03 | AC-33.1, FR-ACL-06 | API | P1 | Untick PM Delete on clients; PM deactivates a client on the next request; restore | 403 with no sign-out needed; works again after restore |
| TC-M04 | AC-33.2, FR-ACL-04 | Both | P1 | UI: tick Edit, then try to untick View. API: send Edit without View, and untick View while Edit is on | UI auto-ticks View and blocks the untick; API returns 422 for both |
| TC-M05 | AC-34.1, FR-ACL-05 | Both | P1 | Try to turn off each Admin cell on users and accessRules | Cells disabled with an explanation; API returns 422 LOCKED_PERMISSION |
| TC-M06 | Q-26 | API | P1 | Grant Delete on projects to PM, Member and Viewer | 422 for each |
| TC-M07 | §3, EC-57 | API | P2 | Send n/a actions (reports.create, audit.delete, accessRules.create), an unknown record type or action, a non-boolean value, an unknown role, or an extra field | 422 (404 for an unknown role); nothing saved |
| TC-M08 | AC-33.5, FR-ACL-12 | Both | P2 | Two Admins save from the same version | Second save gets 409 VERSION_CONFLICT and a reload prompt |
| TC-M09 | AC-33.4, FR-ACL-10 | API | P1 | Save changes to 3 cells, then reset | One audit entry per changed cell, with role, record type, action, and old and new values |
| TC-M10 | AC-33.6 | Both | P2 | Change a role's cells, then Reset to defaults and confirm | §6 restored for that role only |
| TC-M11 | FR-ACL-06 | API | P1 | Grant Viewer Create on clients; Viewer creates a client on the next request; reset | 201 without signing in again; 403 after reset |
| TC-M12 | Deviation 3 | API | P1 | Grant PM full users rights; PM creates an Admin, promotes a Member to Admin, issues a reset link for an Admin, renames or deactivates an Admin, or opens access rules | 403 for every one |
| TC-M13 | FR-ACL-08, §8 | API | P2 | Call an undeclared route, and DELETE on a route that only allows POST | 404 |
| TC-M14 | AC-33.3, AC-35.2, FR-CLI-12 | API | P1 | (M2) Member granted Edit on projects edits a project they aren't on; Member opens a client's Projects tab | 403 or 404; only their own projects are listed and counted |
| TC-M15 | AC-35.1, AC-35.3 | UI | P2 | Open the old /contacts URL; add a contact from the Contacts tab; open the Projects tab | Redirected to Clients; the contact attaches to that client; "No projects yet" |
| TC-M16 | EC-53 | UI | P2 | Remove a permission while that user has a form open, then they save | "You no longer have permission to do this." |
| TC-M17 | FR-ACL-11 | UI | P3 | Leave the page with unsaved grid changes (closing the tab, and moving to another page in the app) | Warning shown in both cases |
| TC-M18 | EC-54 | UI | P2 | Remove Viewer's View on teams or projects, then the Viewer browses | Nothing breaks; the sections are just empty or hidden |
