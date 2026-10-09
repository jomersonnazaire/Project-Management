# 12 — Evidence Uploads, Follow-up Notifications, Project Conversation, Checklist UX

**Status:** v0.5.0 draft for Jomerson's approval · **Author:** Rich · **Date:** 2026-10-09
**Source:** Jomerson's testing feedback (room, 3:52 PM); Queen's test rules; UIE's v0.6 plan; Lean's split (PR #3 vs Milestone 3).

## 1. Scope
| Item | Where |
|------|-------|
| "+ Add activity" inside each phase (template editor) with the phase pre-selected | PR #3 |
| Drag-and-drop reordering of activities (template editor and project Checklist) | PR #3 |
| Click anywhere on a phase card to expand/collapse (Checklist) | PR #3 (UIE's reading, unless Jomerson says otherwise) |
| Evidence as uploaded files only (PDF, Word, Excel) | M3 |
| Follow-up notifications to the task's team | M3 |
| Project Conversation tab | M3 |

## 2. Business requirements
| ID | Requirement |
|----|-------------|
| BR-24 | Evidence is a real file kept in the system, not an external link that can break or change. |
| BR-25 | Everyone working a task learns about a client follow-up without having to look for it. |
| BR-26 | Project discussions (calls, meetings, decisions) are recorded in the project, permanently and in order. |
| BR-27 | Building and running checklists is quick: add activities in place and arrange them freely. |

## 3. Functional requirements

### 3.1 Checklist and template editor (PR #3)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-TPL-12 | Each phase in the template editor has "+ Add activity"; the new activity is created in that phase at the end of its list. | Must |
| FR-PRJ-18 | Each Checklist row's ⋮ menu has **Move up / Move down** (greyed out at the ends of a phase) for touch screens and non-drag users (UIE, Lean). Moving across phases stays in Edit task. | Must |
| FR-PRJ-19 | **DEF-003 fix (Lean):** task Owner and Assignees list only project members. PMs and Admins get "+ Add someone to this project…" at the bottom of the list, which adds the person as a project member and assigns them in one step, audited, with a confirmation naming them. Members and Viewers see "Only project members can be assigned". The template field is labelled **Default job role**. | Must |
| FR-TPL-13 | Activities can be reordered by drag-and-drop within a phase and moved between phases; a keyboard alternative ("Move up/down/to phase…") is provided. | Must |
| FR-PRJ-14 | On the project Checklist, clicking anywhere on a phase card header expands or collapses it; the expanded state is remembered per user per project. | Must |
| FR-PRJ-15 | Users with Edit on the project can reorder activities in the Checklist (drag-and-drop plus keyboard alternative). | Must |
| FR-PRJ-16 | **Reordering changes display order only (Queen):** dependencies, dates, owners and status are untouched. Moving a task to another phase also moves its future evidence folder target but not files already uploaded. Each reorder is audited. | Must |
| FR-PRJ-17 | Reordering in a project never changes its template, and reordering a template only affects projects created from a later published version. | Must |

### 3.2 Evidence uploads (M3) — replaces FR-TSK-07
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-EVD-01 | Task evidence is added only by **uploading files**. Allowed: **PDF (.pdf), Word (.doc, .docx), Excel (.xls, .xlsx)** (Jomerson). Images and links are no longer accepted as new evidence. | Must |
| FR-EVD-02 | **The server checks the real file type** from its content (magic bytes / file signature), not the name or browser type. A mismatch, e.g. an executable renamed `report.pdf`, is refused with 422 `INVALID_FILE_TYPE` (Queen). Macro-enabled files (.docm, .xlsm) are refused. | Must |
| FR-EVD-03 | Size limit is **25 MiB (26,214,400 bytes)** per file, same as Documents (FR-DOC-13); larger files get 413 with a clear message. Up to 10 files per upload. | Must |
| FR-EVD-04 | Files go to the private Azure Blob container and are recorded as documents in the task's phase folder (FR-DOC-17), linked to the task. Downloads use signed links that expire within 5 minutes. | Must |
| FR-EVD-05 | Each file shows name, type icon, size, uploader and time. Who can upload follows Edit on the task (owner/assignee for Members); who can view follows project access. | Must |
| FR-EVD-06 | **Existing link evidence stays readable** (Queen), labelled "Link (legacy)", and can be removed by those with Edit, but no new links can be added. | Must |
| FR-EVD-07 | A file attached as evidence to a task in For Review or Completed can't be removed without reopening the task; removals are audited. | Must |
| FR-EVD-08 | Malware scanning of uploads (e.g. Microsoft Defender for Storage) is recommended; see Q-29. | Should |

### 3.3 Follow-up notifications (M3)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-NTF-01 | When a follow-up note is added to a task, notify the task's **owner, all assignees, the designated reviewer, and the project PM**, except the person who wrote it. | Must |
| FR-NTF-02 | Channel: **in-app** (bell with unread count, notification list). Email is deferred to the External integrations stage (Q-28); build so a channel can be added later. | Must |
| FR-NTF-03 | A notification reads e.g. "Maria P. added a follow-up on Client master data – Items" with the project name and time; clicking it opens the task and marks it read. "Mark all as read" is available. | Must |
| FR-NTF-04 | Notifications respect access at read time: if a user loses access to the project, its notifications disappear from their list. | Must |
| FR-NTF-05 | Also notify on: being assigned a task, a task sent For Review (to reviewer), approved or rejected (to owner). | Should |
| FR-NTF-06 | Unread count refreshes at least every 60 seconds or on page focus; notifications older than 90 days are removed. | Should |

### 3.4 Project Conversation tab (M3)
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CNV-01 | Each project has a **Conversation** tab: a timeline of messages, oldest at top and newest at bottom, with a message box. | Must |
| FR-CNV-02 | A message has text (up to 5,000 characters), author, time, and optional tags: one task of the project and/or client contacts active on the project. A type can be chosen: Note, Call, Meeting, Decision (default Note). | Must |
| FR-CNV-03 | **Messages are permanent:** no edit or delete (Lean's default). A mistaken message is corrected by posting a follow-up. | Must |
| FR-CNV-04 | **Access follows the project (Queen):** anyone who can view the project can read; posting needs Edit on the project or membership of it (Members post on projects they're on). Viewers read only. Enforced in the API. | Must |
| FR-CNV-05 | A task's detail panel shows conversation messages tagged to it. | Should |
| FR-CNV-06 | Search and filter by type, task, contact and date. | Should |
| FR-CNV-07 | Text is stored and shown as plain text (links auto-detected); no HTML is rendered. | Must |
| FR-CNV-08 | File attachments in conversations are out of scope for now; files go in Documents. | — |

Access rules (doc 11): add record types `notifications` (own only, not configurable) and `conversations` (View, Create; Edit and Delete n/a). Defaults: Admin VC, PM VC, Member VC (own projects), Viewer V.

## 4. User stories
- **US-37** As a PM, I want to add an activity inside the phase I'm looking at, so I don't have to pick the phase again.
- **US-38** As a PM, I want to drag activities into the order we actually work, without breaking dependencies.
- **US-39** As a consultant, I want to upload signed PDFs and spreadsheets as evidence, so proof lives in the project.
- **US-40** As an assignee, I want to be told when someone adds a follow-up on my task.
- **US-41** As a PM, I want to record calls and decisions in the project, tagged to the task and contact, so the history is in one place.

## 5. Acceptance criteria
- **AC-37.1** Clicking "+ Add activity" in Phase 2 creates the activity in Phase 2 with no phase picker.
- **AC-38.1** Dragging task B above task A changes only their order; dependencies and dates are unchanged (API compares before and after). **(API)**
- **AC-38.2** Clicking a phase card header expands it; clicking again collapses it.
- **AC-39.1** Uploading a valid .docx, .xlsx or .pdf works; a .png, a link, or a .docm is refused. **(API)**
- **AC-39.2** An .exe renamed `report.pdf` is refused with `INVALID_FILE_TYPE`. **(API)**
- **AC-39.3** A file of 26,214,401 bytes is refused with 413; one of exactly 26,214,400 bytes is accepted. **(API)**
- **AC-39.4** A task with old link evidence still shows it as "Link (legacy)".
- **AC-40.1** When Maria adds a follow-up, the owner, assignees, reviewer and PM each see one new notification; Maria sees none. **(API)**
- **AC-40.2** A user removed from the project no longer sees its notifications.
- **AC-41.1** A Member not on the project gets 404 for its conversation; a Viewer can read but posting returns 403. **(API)**
- **AC-41.2** There is no edit or delete for messages in the UI, and PATCH/DELETE return 404/405. **(API)**
- **AC-41.3** `<script>` in a message is shown as text.

## 6. Edge cases
- **EC-59** Upload interrupted: no half-saved document; the user can retry.
- **EC-60** Same file name uploaded twice to one task: both kept, the second shown with its upload time (or versioned per FR-DOC rules).
- **EC-61** Task with no assignees gets a follow-up: the owner and PM are notified.
- **EC-62** Deactivated user: gets no new notifications; their past messages still show with "(deactivated)".
- **EC-63** Two people reorder the same phase at once: the second save gets 409 and reloads.
- **EC-64** Activity moved to another phase while it has dependencies: allowed; dependency arrows still show; a warning appears if it now depends on a task in a later phase.
- **EC-65** A tagged client contact is later deactivated: the tag stays, marked inactive.

## 7. Open questions and assumptions
- **Q-28 (resolved, Jomerson 2026-10-09):** in-app only. Email notifications move to the External integrations stage in `docs/FEATURES_AND_ROADMAP.md`. Email needs an email service (e.g. Azure Communication Services) and would also enable emailed invite and reset links.
- **Q-29** Turn on malware scanning for uploads (Microsoft Defender for Storage, per-GB cost)? Proposed: yes for production.
- **Q-30** Should images (PNG, JPG) still be allowed in Documents, while evidence is limited to PDF, Word and Excel? Proposed: yes.
- **Q-31** Conversation messages permanent with no edit or delete, matching Lean's default? Proposed: yes; Admins can hide abusive content with an audited "hidden by Admin" marker.
- **A-14** Old `.doc` and `.xls` formats are accepted as Word and Excel.
