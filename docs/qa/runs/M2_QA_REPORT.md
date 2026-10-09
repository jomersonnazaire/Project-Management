# QA Report: Milestone 2 (templates, projects, task board, My tasks, contacts) — API pass

**Build:** PR #3 at `0b1cd61` · preview https://xc8-projectmgmt-jx1h02qk0-jomerson-team.vercel.app · **Date:** 2026-10-09
**Result: PASS (API).** No defects. Screen cases depend on UIE's design review.

| Area | Checks | Result |
|---|---|---|
| Scope (TC-M14, AC-35.2, K01) | Member lists only the project they're on; client Projects tab lists and counts 1 for the Member, 2 for Viewer and PM2; Outsider sees none, and gets 404 on the project, its tasks, a task and a status change; Member gets 404 on the Admin-only project | Pass |
| Q-12 (TC-D12) | PM can't edit, archive or take over an Admin's or another PM's project, but can view it; PM edits own; after handing a project to PM2, PM loses edit | Pass |
| Only Admins delete (Q-26) | PM DELETE own project returns 403; Admin DELETE returns 204 | Pass |
| AC-33.3 | Member granted Edit on projects still gets 404 on a project they're not on | Pass |
| Baseline (FR-PRJ-12) | Changing end date without a reason returns 422 REASON_REQUIRED; with a reason, 200 | Pass |
| Templates (TC-D11, D04, D06, EC-11, AC-08.3) | PM publishes by default; 403 once PM's Edit is removed; Member and Viewer 403; empty template 422; dependency cycle 422; a v1 project keeps its v1 tasks, phase names and estimates after v2 is published; creating from a stale version returns 409; Draft can't be used for a project (422) | Pass |
| EC-58 (TC-H14) | Project from SAP B1 template: 10/10 tasks unestimated, `estHours` null (never 0), health On track | Pass |
| Tasks | Member moves own task; 403 on someone else's task and on plan fields; Viewer 403; stale task version 409; My tasks shows the assigned task | Pass |
| Active contacts (AC-36.1) | Other client's contact returns 422 CONTACT_NOT_IN_CLIENT; picker lists only the project client's contacts | Pass |
| Input checks (K02, K03) | Operator in query returns 400; unknown field returns 400; Member and Viewer can't create projects | Pass |

**Notes for review (not defects)**
- A PM can create a project with another PM as manager, after which only that PM can edit it. This fits the spec, but Lean may want to confirm it.
- Members can see Draft templates in the Templates list (they have View). They're excluded from the project picker as AC-08.3 requires.
- QA projects created during the run were deleted by Admin. QA templates ("QA tpl …", "QA draft …", "QA empty …") remain.
