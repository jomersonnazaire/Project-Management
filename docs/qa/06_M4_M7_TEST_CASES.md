# Test cases: Milestones 4 to 7 (doc 14 v0.9.3, mockup v0.8.7)
Milestone 4's dashboard, workload and reports are already covered in 02_TEST_CASES.md (AC-20 to AC-22), alongside the cases here. All times are Philippine time. "API" cases call the backend directly.

## M4: PM view (FR-PMV) and project codes (DR-23)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-P01 | My projects as pm@, pm2@, admin@, viewer@, member@ | PM: only managed projects. Admin: all. Viewer: all, read-only. Member: no view (API 403) | FR-PMV-04 |
| TC-P02 | Seeded project: 1 overdue, 1 blocked, 1 open Critical issue, 1 client request overdue, baseline end passed | The row shows each count, "N days late" in red, and % complete = completed / all tasks | FR-PMV-01, Q-08 |
| TC-P03 | Follow-ups | Internal people with overdue or aging tasks and client contacts with overdue items are listed with counts and links. Someone with nothing late isn't listed | FR-PMV-02 |
| TC-P04 | Sort and filter by health, client, days late | Correct order and subset | FR-PMV-03 |
| TC-P05 | Project code "ACME-SAP" vs "acme-sap" | Second refused (case-insensitive). Code locked once the project has issues (API 422). Issue IDs unique across projects; old test issues renumbered | DR-23 |
| TC-P06 | Timesheet lock setting (Q-09) | Default is Monday 12:00 PHT for the previous week. Entries in a locked week can't be created, edited or deleted (422). Admin can change the setting, which is audited | Q-09 |

## M5: Activity Tracker (FR-ACT)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-Q01 | Time in, then Time out on a Today row | Time entry with server-set start and end, exact minutes, shown as HH:MM. A start or end sent by the client for a live timer is ignored or refused | FR-ACT-02, -09, 12.2 |
| TC-Q02 | Time in on task B while task A runs | A stops at the same moment B starts. Only one running. Top bar timer on every page | FR-ACT-03 |
| TC-Q03 | Timer left running, browser closed | Keeps running on the server. At 23:59 PHT it auto-stops, flagged "Auto-stopped – please check". No entry spans midnight | FR-ACT-04, EC-75 |
| TC-Q04 | Manual pairs 08:00–12:00 and 11:30–13:00 | Second refused (422) with the overlap message. Touching edges (12:00 to 12:00) are allowed. Hours-only entries are unaffected | FR-ACT-05, -11 |
| TC-Q05 | Day total above 24h | Refused, with "{HHh MMm}" and the next step | FR-TIME-03, 12.3 |
| TC-Q06 | Quick activity (no project) | Requires a title and Activity type. Client and Project blank. No Time type. Billable defaults to No | FR-ACT-06, -15, -18 |
| TC-Q07 | Quick-activity access (API) | Another user's activity returns 404 to Member, PM2 and Outsider. Supervisor and Admin can view, not edit | FR-ACT-07, NFR-25 |
| TC-Q08 | Location | First Time in of the day asks for it, later entries inherit it, and one entry can be changed | FR-ACT-17 |
| TC-Q09 | Activity type, Location and Module lists | Admin-only edits. An in-use value can be deactivated, not deleted. Past entries keep their label | FR-ACT-15, §10 |
| TC-Q10 | Submit day | Refused while a timer runs. Afterwards the day's entries are read-only (422). Late submit allowed until the weekly lock | FR-ACT-12, §10 |
| TC-Q11 | Reopen day | Supervisor or Admin, with a reason, audited, user notified. Member can't reopen (403). After the weekly lock, Admin only | FR-ACT-12, 12.3 |
| TC-Q12 | Weekly lock with unsubmitted days | Locked as they stand, flagged "Not submitted" | FR-ACT-13 |
| TC-Q13 | Project goes On Hold mid-timer | Timer stops at that moment | EC-76 |
| TC-Q14 | Midnight (00:30 PHT) | Entries land on the Philippine date, not UTC | A-17 |

## M6: Daily Accomplishment Report (FR-DAR)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-R01 | Preview for one day matching Jomerson's sample | Title, "Generated range", "Total Activities", 11 columns in order, 12-hour times, HH:MM, total rendered hours row, footer text | FR-DAR-07, -08 |
| TC-R02 | Column mapping | Activity Type is the category on every row; Client and Project blank for quick activities; Remarks separate from Module; no Time type column | FR-DAR-09, FR-ACT-16, -18 |
| TC-R03 | Range limits | Range over 31 days refused; future days left out; leave days show "On leave" | FR-DAR-02, EC-80 |
| TC-R04 | Day status | Each day shows Submitted, Not submitted or Reopened | FR-ACT-14, §10 |
| TC-R05 | Export PDF and Excel | Same rows and totals as the preview. Excel has numeric hours. Names with Filipino characters (ñ) are correct | FR-DAR-03 |
| TC-R06 | No Send | No Send button and no email endpoint. Note "Coming with Microsoft sign-in" | §14 |
| TC-R07 | Save report, then edit an entry in the range and save again | First copy unchanged and tagged "Earlier version", with "{date} was changed after this was saved". New copy tagged "Latest". An overlapping range has no tag | FR-DAR-11 to -15 |
| TC-R08 | Saved report privacy (API) | Supervisor, Admin, Member and Outsider all get 404 on another user's saved report and its export | §15 v0.9.3, NFR-25 |
| TC-R09 | Delete a saved report | No route (404 or 405) for anyone | FR-DAR-15 |
| TC-R10 | XSS in remarks: `<script>`, `<img onerror>` | Shown as text in the preview, saved copy, PDF and Excel. No formula injection: `=HYPERLINK(...)` in Excel is stored as text | NFR security |

## M7: Leave (FR-LV, no approval)
| ID | Case | Expected | Traces |
|---|---|---|---|
| TC-S01 | Record Full day, Half day AM, Half day PM | Shows as on leave. Balance drops by 1, 0.5, 0.5. Supervisor gets an in-app notice | Q-46, FR-LV-03 |
| TC-S02 | Leave across a weekend and a Regular holiday | Those days aren't deducted | EC-78, FR-CAL-02 |
| TC-S03 | Over balance (paid type) / unpaid type | Paid refused with the plural-correct message; unpaid allowed | FR-LV-05, 12.3 |
| TC-S04 | Overlaps on one day (FR-LV-11) | Vacation AM plus Vacation PM: one full day (1.0). Vacation AM plus Sick PM: 0.5 each. A second AM or second PM refused. Full day on a half-day date, or a half day on a full-day date, refused. Overlapping ranges refused | FR-LV-05, FR-LV-11 |
| TC-S05 | Cancel own future leave; cancel past leave | Future cancelled with balance restored and supervisor notified. Past leave: Admin only | §10, FR-LV-08 |
| TC-S06 | Privacy (API) | Reason visible only to the user, supervisor and Admins; others 404. No medical fields | FR-LV-07 |
| TC-S07 | Entitlement reduced below taken | Allowed with a warning; negative balance flagged. Audited | EC-79, FR-LV-08 |
| TC-S08 | No supervisor | Notices go to all Admins; Admin › Users flags "Supervisor needed". Self or cyclic supervisor refused | FR-LV-10, §5 |
| TC-S09 | Timer on a leave day | Warning, overridable only on half-days | FR-LV-06 |
| TC-S10 | Year boundary | Leave 30 Dec 2026 to 4 Jan 2027 deducts from each year's balance correctly | FR-LV-02 |
