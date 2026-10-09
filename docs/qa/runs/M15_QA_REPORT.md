# QA Report: Milestone 1.5 (access rules, client tabs)

**Build:** PR #2 at `e117ff9`, preview https://xc8-projectmgmt-web-git-milestone-15-access-rules-jomerson-team.vercel.app · **Date:** 2026-10-09 · **Spec:** doc 11 v0.4.2 · **Cases:** 04_M15_ACCESS_RULES_TEST_CASES.md
**Result: PASS (API).** UI cases M15–M18 depend on UIE's design review. No defects found.

| Case | Result |
|---|---|
| M01 defaults match §6 (all 56 cells × 4 roles) | Pass |
| M02 non-Admins get 403 on GET and PUT | Pass |
| M03 PM loses Delete on clients on the next request, then gets it back | Pass |
| M04 Edit without View, or untick View, returns 422 | Pass |
| M05 Admin users and accessRules cells return 422 LOCKED_PERMISSION | Pass |
| M06 projects.delete returns 422 for PM, Member and Viewer | Pass |
| M07 n/a, unknown, non-boolean or extra-field payloads return 422; unknown role returns 404 | Pass |
| M08 stale version returns 409 VERSION_CONFLICT | Pass |
| M09 one audit entry per changed cell | Pass |
| M10 reset restores §6 | Pass |
| M11 Viewer can create a client right after the grant, and gets 403 after reset | Pass |
| M12 PM with full users rights still can't touch Admins or access rules | Pass |
| M13 undeclared routes return 404 | Pass |
| M14 | Waits for M2. Today a Member gets 404 on a client outside their scope, and a Viewer's Projects tab returns an empty list |
| M15–M17 | Checked in code: /contacts redirect, "No projects yet", the "no longer permitted" copy. The unsaved warning only fires on tab close (deviation 6) |

**Notes**
- Viewers now get 403 on GET /teams, as §6 says (in M1 every role could read teams). UIE should check that no Viewer screen shows an error because of it.
- After the test run, all access rules are back at the §6 defaults. Test clients "QA M15 viewer client" were added.
