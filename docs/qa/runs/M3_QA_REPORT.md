# QA Report: Milestone 3 — API pass

**Build:** PR #5 at `888647e` · preview https://xc8-projectmgmt-web-git-milestone-3-jomerson-team.vercel.app · **Cases:** 05_M3_TEST_CASES.md
**Result: PASS (API)**, with 2 Low defects. TC-N16 (00:30 Philippine time) runs at that time. Screen cases depend on UIE's review.

| Case | Result |
|---|---|
| N03 types | .pdf, .docx, .xlsx accepted; .png, .docm, .xlsm and a link refused | Pass |
| N04 real type | .exe renamed .pdf, .zip renamed .docx, and a macro file renamed .docx are refused with INVALID_FILE_TYPE | Pass |
| N05 size | 26,214,400 bytes accepted; 26,214,401 refused with 413 (also when the declared size was a lie); 0 bytes refused | Pass (see DEF-004) |
| N07 file access | Outsider 404; evidence ID used under another task or project returns 404; blob without its time-limited link returns 409; link valid 5 min | Pass |
| N08 malware | EICAR file alone, and embedded in a PDF, blocked with MALWARE_DETECTED | Pass |
| N09 notifications | Member's follow-up notifies the PM and assignee once each, not the author | Pass |
| N10 removal | Removed member gets no new notifications, old ones disappear, the task returns 404 | Pass |
| N11 | Another user's notification returns 404; read and read-all work | Pass |
| N12 conversation | Viewer and PM2 read but get 403 on post; Outsider 404 | Pass |
| N13 | PATCH and DELETE on a message return 404 | Pass |
| N15 hide | Member 403; Admin hides | Pass |
| N17 | Saturday special working day: Friday + 1 lands on Saturday | Pass |
| N18 | No days ticked returns 422 NO_WORKING_DAYS; PM 403; duplicate day 400; Saturday ticked lands on Saturday | Pass |
| N19 | Regular holiday Monday: Friday + 1 lands on Tuesday; impact lists 3 existing tasks, left unchanged | Pass |
| N20 | Duplicate holiday 409; only Sunday ticked computes in 1.4 s | Pass |
| N21 | conversations and notifications rows present in access rules | Pass |
| Time (G) | Own and project tasks OK; Outsider 404, Viewer 403; hours 0, -1, 0.3, 24.5 and future date refused; 0.25 OK | Pass (see DEF-005) |
| Today tab | Overdue first, then today; tomorrow excluded | Pass at 18:xx; boundary pending (N16) |
| On Hold blocks time | Not run (the test project couldn't go Active because template tasks have no owners) | Not run |

## Defects
| ID | Severity | Title |
|---|---|---|
| DEF-004 | Low | The over-size message reads "over.pdf is 25 MB. The limit is 25 MB." for a file 1 byte over. It should show the real size, e.g. "25.0 MB (26,214,401 bytes)", or simply "is larger than 25 MB". |
| DEF-005 | Low | Outsider DELETE `/time/:id` on another project's entry returns 403, while PATCH returns 404. FR-ACL-09 wants 404 outside scope so existence isn't revealed. |

Info: tagging a contact from another client answers `CONTACT_NOT_ACTIVE`; a clearer code would be `CONTACT_NOT_IN_CLIENT`.

## Follow-up: PR #6 at `9313d47`. Result: PASS (API)
| Check | Result |
|---|---|
| DEF-004 | Message now reads "over.pdf is larger than 25 MB, the limit per file." Closed |
| DEF-005 | Outsider DELETE and PATCH on another user's time entry both return 404. Closed |
| On Hold blocks time | Seeded project Active: log 201. On Hold: 422 PROJECT_CLOSED | Pass |
| Folder restrictions (FR-DOC-43) | With a folder restricted to PM and Admins, Member, Viewer and pm2 can't see the folder, its subfolder or its documents in the list, search, folder filter, detail or download (all 404), and can't upload into it. An allowed member sees all of it. A Member can't change restrictions (403). Phase folders refuse (422). Only project members can be allowed (400) | Pass |
| Request a document | Signature defaults on in Contracts. A past due date, another client's contact or a non-member is refused. Viewer 403, Outsider 404. Signing for a client contact records onBehalfOf. An unsigned upload moves it to Submitted. A fulfilled request can't be fulfilled again or cancelled (409). Cancel needs a reason; a Member who isn't the requester gets 403; a cancelled request can't be fulfilled | Pass |
| Waiting on client | Lists open client requests for users who can see them; Outsider gets an empty list. The overdue count can't be checked yet because no request can be given a past due date | Partial |
| Official PH holidays | Admin only (PM 403). 2026 adds 21, and loading again skips all 21. 2027 adds 19. 2028 is refused with NO_OFFICIAL_LIST | Pass |

Observation for Rich and Lean: FR-TIME-06 says users can delete their own unlocked time entries, but the default access grid gives Member time View/Create/Edit without Delete, so a Member deleting their own entry gets 403. One of the two needs to change.
