# CR-19 — Clients: Excel template download and import (add or update clients and contacts)

**Status:** v0.2 draft (2026-11-03, 12:10 PM SGT) · v0.1 draft (2026-11-03, 12:00 PM SGT) · **Author:** Business Analyst · **For:** Jomerson (approval), Lean, Deven, Queen, UIE
**Requested by:** Jomerson (lead dev / product owner), 2026-11-03. **Rules locked by:** Lean (tech lead) and Deven, 2026-11-03. Rules marked **Locked** are decided. Rules marked **Lean-accepted default (2026-11-03)** were proposed in v0.1 and accepted by Lean.
**Part of:** doc 17 (change requests). CR-19 is summarised in `17_CHANGE_REQUESTS.md` and specified in full here. It follows CR-18 and uses the next free IDs: **FR-CLI-23 to FR-CLI-41**, **US-61, US-62**, **AC-61.x, AC-62.x**, **EC-139 to EC-157**, **NFR-36 to NFR-41**, **Q-109 to Q-117** (all decided, see §15), **A-30 to A-35**.
**UI reference:** UIE's mockup **v0.9.17** (`docs/design/mockup/index-v0.9.17.html#clients`), which mirrors the built Clients page plus the Excel button, and `docs/design/CLIENTS_EXCEL_IMPORT_UI.md` (written for v0.9.16; its role notes are replaced by §3 here). *The v0.9.17 file is in the team's local docs pack and isn't on this branch yet.*
**Checked against:** docs 01 to 17 (doc 17 with CR-18), and the build at `main` `16854be` (no client code changed since `3bf528e`).
**Not built.** This is a new request, not a PR review.

**Doc change log:**
- v0.2 (2026-11-03, 12:10 PM SGT): Lean's calls applied. **Q-109** (contact whose company is in neither the file nor the app: Error, never creates a client), **Q-110** (Status change on an existing client needs `clients.delete`; otherwise the **whole row** is an Error and nothing in it is saved; a new client may be Active or Inactive; FR-CLI-18 check kept, Q-107 still pending), **Q-111** (one gate: create **and** edit on **both** `clients` and `contacts` for the button and all three API calls; new AC-61.6; the "contact rows become Errors" path removed), **Q-115** ("No change" tag, not written, not counted as an update) are **Locked**. Q-112, Q-113, Q-114, Q-116 and Q-117 are **Lean-accepted defaults (2026-11-03)**. The existing button is called **"New client"** everywhere. "Company name" header kept and its mapping to the client `name` field noted. UI reference moved to mockup v0.9.17. New FR-CLI-41 and EC-157. No IDs renumbered.
- v0.1 (2026-11-03, 12:00 PM SGT): first draft, Q-109 to Q-117 open.

## 0. What the build has today (baseline)
| Topic | As built | Evidence |
|---|---|---|
| Staff roles | Four fixed Access roles: `ADMIN`, `PROJECT_MANAGER` (PM), `MEMBER`, `VIEWER` | `packages/shared/src/roles.ts:5` |
| `clients` permission (seeded) | Admin VCED, PM VCED, Member V, Viewer V | `packages/shared/src/accessRules.ts:176` (Admin), `:198` (PM), `:220` (Member), `:243` (Viewer); doc 11 §6 |
| `contacts` permission (seeded) | Admin VCED, PM VCED, Member V, Viewer V | `packages/shared/src/accessRules.ts:177`, `:199`, `:221`, `:244` |
| API checks | Client create `perm('clients','create')`, edit `perm('clients','edit')`, deactivate/reactivate `perm('clients','delete')`. Contact create, edit, deactivate: `contacts.create` / `contacts.edit` / `contacts.delete` | `apps/api/src/routes/clients.ts:170`, `:183`, `:206`, `:246`, `:328`, `:348` |
| Web checks | Clients page uses `useCan('clients','create' / 'edit' / 'delete')`. The header button reads **"New client"** and follows `clients.create` | `apps/web/src/pages/clients/ClientsPage.tsx:14-16`, `:27-31` |
| Member scope | Members see only clients of projects they belong to (fixed scope, FR-ACL-07) | `apps/api/src/services/scope.ts:33-36` |
| Client fields | `name` (required, trimmed, max 160), `nameKey` (unique, = name lower-cased), `industry` (120), `address` (500), `notes` (2000), `active` (boolean, default true) | `apps/api/src/models/Client.ts:5-10` |
| Client name labels | List column **"Client"**; New/Edit form label **"Company name"**; API validation message "Client name is required." | `ClientsPage.tsx:78`; `apps/web/src/pages/clients/ClientModal.tsx:48`; `packages/shared/src/schemas.ts:101` |
| Client Status | **No status enum.** Status is the `active` boolean, shown as **Active / Inactive** | `apps/api/src/models/Client.ts:10`; `apps/web/src/components/Badges.tsx:18-21` |
| Client name unique | Case-insensitive via `nameKey`; refusal 409 `CLIENT_NAME_IN_USE`. Inactive clients keep their name | `apps/api/src/routes/clients.ts:173`, `:369-374` |
| Contact fields | `clientId` (required), `name` (required, max 120), `department` (120), `position` (120), `email` (optional, trimmed, lower-cased, max 254, indexed, **not unique**), `phone` (40), `notes` (2000), `active` (boolean) | `apps/api/src/models/ClientContact.ts:26-40`; `packages/shared/src/schemas.ts:112-119` |
| Email format | Zod email check, "Enter a valid email address." | `packages/shared/src/schemas.ts:16-21` |
| Contact portal access | **Not in the code.** No `clientPortalAccounts` model and no portal fields on contacts. Doc 11 FR-ACL-33/34 specify it, and client invites are on hold (doc 11 Q-84) | `apps/api/src/models/` (no portal model); `ClientContact.ts:19-23` |
| Excel library | `exceljs` is already a dependency (DAR export) | `apps/api/package.json:30`; `apps/api/src/services/darExport.ts:11` |
| Uploads | JSON body limit is 100 kB, so the import needs its own raw-body route, like document upload | `apps/api/src/app.ts:82`; `apps/api/src/routes/documents.ts:1169` |
| Transactions | Mongo transactions are already used | `apps/api/src/routes/projects.ts:337-339`; `templates.ts:326-328` |
| Audit | `audit()` / `auditMany()` with `changes` (old/new) and `meta` | `apps/api/src/services/audit.ts:5-14`, `:35-40` |

## 1. Summary
Users who can create **and** edit **both** clients and contacts get an **Excel ▾** button on the existing Clients list page (`/clients`), next to **"New client"**. It has two items: **Download template** and **Import from Excel**. The template is one `.xlsx` file with two sheets, **Clients** and **Contacts**. Importing a filled template shows a preview (New, Update, No change or Error per row) without saving anything. **Import valid rows** then adds the records with no match and updates the ones that match, in one transaction. Error rows are skipped and can be downloaded as a file.

## 2. Scope
**In scope**
- Excel button on the existing `ClientsPage` (FR-CLI-23).
- Template download (FR-CLI-25 to 28).
- Import preview and commit for clients and contacts (FR-CLI-29 to 37, 41).
- Skipped-rows file, toast, audit (FR-CLI-36, 38, 39).

**Out of scope**
- **No delete through import.** A record that is missing from the file is left alone. Import never deletes or deactivates a contact (the Contacts sheet has no Status column).
- **No client created from the Contacts sheet** (Locked, Q-109).
- **No portal access through import.** Import never turns on portal access, sends invites or changes `clientPortalAccounts` (FR-ACL-33 to 36; not built, invites on hold, Q-84). See Q-112 for email changes on contacts that have portal access.
- **No clearing of fields.** A blank cell on an update keeps the current value (Locked), so a field can't be cleared by import. Use the Edit form.
- **No rename of a client.** Company name is the match key, so a new name adds a new client. Rename on the client's Edit form.
- **No prefilled export** of existing clients and contacts (Q-117). No CSV, `.xls`, `.xlsm` or Google Sheets import. No project or active-contact assignment through import. No mobile.
- No new page, no change to "New client", and no sidebar change.

## 3. Permissions (Locked, Lean and Deven, 2026-11-03; one gate, Q-111)
- **FR-CLI-23 (Must)** The **Excel ▾** button (Download template and Import from Excel) shows on the existing Clients list page, next to the existing **"New client"** button, only when the user has **all four** of these in Access Rules: **`clients.create`, `clients.edit`, `contacts.create` and `contacts.edit`**. The check is the Access Rules check (`useCan` on the web, `perm()` in the API), never a hardcoded role. "New client" keeps its own rule (`clients.create`) and doesn't change.
- **FR-CLI-24 (Must)** The API enforces the same four permissions on **all three calls** (template, preview and commit). Missing **any one** of them returns **403 `FORBIDDEN`** (FR-ACL-09). A portal token gets **401** (FR-ACL-36, once the portal exists). There is no partial path: a user can't import Clients rows only, or Contacts rows only.
- **By default** (seeded; `accessRules.ts:176-177`, `:198-199`, `:220-221`, `:243-244`): **Admin and PM** hold all four, so they see the button. **Member and Viewer** have View only on `clients` and `contacts`, so they don't see it and get 403. If an Admin changes Access Rules, the button follows on the next request (FR-ACL-06). Removing any one of the four (for example PM's `contacts.edit`) hides the button and the API returns 403.
- **Status changes** on an existing client also need **`clients.delete`** (FR-CLI-41). That's a per-row rule, not part of the button gate.
- Fixed scope still applies (FR-ACL-07). If Access Rules ever give a Member all four, matching only uses clients in that Member's scope (EC-154).

## 4. Template design (Locked)
- **FR-CLI-25 (Must)** **Download template** returns `OpsTrack-clients-template.xlsx` (name from UIE). It's built in memory with `exceljs` and contains no customer data.
- **FR-CLI-26 (Must)** Two sheets, in this order:

| Sheet | Columns (in order) |
|---|---|
| **Clients** | Company name · Industry · Address · Notes · Status |
| **Contacts** | Company name · Full name · Position · Email · Phone · Department · Notes |

- **"Company name"** is Jomerson's wording and stays as the header on both sheets. It maps to the client's **`name`** field (`Client.ts:5`). The app shows that field as **"Client"** in the list column (`ClientsPage.tsx:78`) and **"Company name"** on the New/Edit form (`ClientModal.tsx:48`). Its API validation message says "Client name" (`schemas.ts:101`). Full name maps to the contact's `name`. Status maps to `active`. Every other header maps to the field of the same name.
- **FR-CLI-27 (Must)** **Row 1 explains each column** (for example "Required. Up to 160 characters. Matches an existing client, with case ignored."). **Row 2 holds the column headers.** Data starts on row 3. Rows 1 and 2 are locked with sheet protection (no password; protection is a guide, not a security control, and the server checks the headers anyway). Data cells stay unlocked. Columns are formatted as Text so phone numbers keep a leading `+` or `0`.
- **FR-CLI-28 (Must)** **Status** (Clients sheet) is an in-cell dropdown with **Active** and **Inactive**. These map to the client's `active` flag (`Client.ts:10`): Active = `true`, Inactive = `false` (Locked).
- **Why the Contacts sheet links by Company name:** users fill it in by hand and already know the company name. The client ID is internal and never shown. It's also the key the Clients sheet matches on, so one file can add a client and its contacts together.
- **Alternatives considered (not chosen):**
  - (a) One flat sheet with the client columns repeated on each contact row. Client data repeats, and conflicts between copies are hard to explain.
  - (b) Two separate files. Users would have to upload twice, in the right order.
  - (c) A hidden client ID column for updates. Safer matching, but it only works on an exported file, which is out of scope (Q-117).

## 5. Matching rules (Locked)
- **FR-CLI-29 (Must)** **Client match:** Company name, trimmed and case-insensitive. This is the built `nameKey` rule (`clients.ts:173`). Matching includes **inactive** clients, because their names stay unique and adding one would fail with `CLIENT_NAME_IN_USE`. Spaces inside a name aren't collapsed: "Client  A" (two spaces) and "Client A" are different names, as today.
- **FR-CLI-30 (Must)** **Contact match, within the contact's client only:**
  1. If the row has an Email, it matches the contact of that client with the same email (lower-cased, as stored).
  2. If the row has no Email, it matches the contact of that client with the same Full name, trimmed and case-insensitive, **that also has no email**.
  3. The same email under a different client is allowed and is a separate contact (EC-21 pattern; emails aren't unique, `ClientContact.ts:30-37`).
- **FR-CLI-31 (Must)** **Result:**
  - A match **updates** the record. On an update, **a blank cell keeps the current value**, and a filled cell replaces it.
  - No match **adds** a record.
  - A match where no filled cell differs from the stored value is tagged **"No change"** (Locked, Q-115). It isn't written or audited, and it isn't counted as an update.
- **FR-CLI-32 (Must)** **Ambiguous match in the app** (two contacts of one client with the same email, or two no-email contacts with the same Full name): the row is an **Error**, "Matches more than one contact in {Company name}. Fix it on the Contacts tab first." Nothing is guessed.
- **FR-CLI-33 (Must)** **Duplicates in one file (Locked):** the same Company name twice on the Clients sheet, or the same Email (or the same no-email Full name) twice under one client on the Contacts sheet: **every copy is an Error** and no row wins. Reason: "Duplicate in file (rows {a} and {b})" (UIE copy).
- **Inactive records (Lean-accepted default, 2026-11-03, Q-114):** a row that matches an inactive client or contact updates it as usual. It stays inactive unless Status changes it (clients only, FR-CLI-41). The preview tag reads **"Update (inactive)"**.
- **Email against a no-email contact (Lean-accepted default, 2026-11-03, Q-113):** a row with an Email is matched only by email (FR-CLI-30). If the client has no contact with that email but does have a **no-email** contact with the same Full name, the row is still **New**, as the locked rule says. The preview adds a warning, "Possible duplicate of {Full name} (no email) on the Contacts tab." The warning doesn't block the row. To add an email to an existing contact, use the Contacts tab.

## 6. Validation rules (per field, from the real model limits)
All text is trimmed. Limits follow `schemas.ts:100-119`, `Client.ts` and `ClientContact.ts`.

| Sheet | Column | New record | Update | Rule and error reason |
|---|---|---|---|---|
| Clients | Company name | Required | Required (match key) | 1 to 160 chars. "Company name is blank" / "Company name is longer than 160 characters" |
| Clients | Industry | Optional | Blank keeps | Up to 120 chars |
| Clients | Address | Optional | Blank keeps | Up to 500 chars. Line breaks allowed |
| Clients | Notes | Optional | Blank keeps | Up to 2,000 chars |
| Clients | Status | Active or Inactive; blank = **Active** (model default). No `clients.delete` needed for a new client | Blank keeps. A **changed** value needs `clients.delete` (FR-CLI-41) | Active or Inactive, case ignored. "Status must be Active or Inactive" |
| Contacts | Company name | Required | Required (link) | Must match a client on the Clients sheet (a row that isn't an Error) or in the app. Otherwise Error (FR-CLI-34a) |
| Contacts | Full name | Required | Blank keeps (except as the match key when there's no email) | 1 to 120 chars. "Full name is blank" |
| Contacts | Position | Optional | Blank keeps | Up to 120 chars |
| Contacts | Email | Optional | Match key when filled | Up to 254 chars, valid format, stored lower-cased. "Email isn't valid" |
| Contacts | Phone | Optional | Blank keeps | Up to 40 chars, free text (leading `+` kept) |
| Contacts | Department | Optional | Blank keeps | Up to 120 chars |
| Contacts | Notes | Optional | Blank keeps | Up to 2,000 chars |

- A row where every cell is blank is ignored, isn't counted, and isn't an error.
- A contact row whose client row is an Error in the same file is also an Error: "Its client row {n} has an error."
- Each cell is read as text. A date, number or boolean cell is converted to its displayed text. A formula cell is read as its formula text and never evaluated (FR-CLI-37).
- **FR-CLI-34a (Must, Locked, Q-109)** A Contacts row whose Company name matches neither a valid Clients row in the file nor a client in the app is an **Error** and is skipped: "Company {name} isn't on the Clients sheet or in OpsTrack. Add it on the Clients sheet." Import **never creates a client from the Contacts sheet**.
- **FR-CLI-41 (Must, Locked, Q-110) Status on an existing client:**
  - Changing Status on a matched client (Active to Inactive, or Inactive to Active) counts as Deactivate or Reactivate. It's allowed only if the user has **`clients.delete`**, which is how deactivation works today (FR-CLI-13; `clients.ts:206`).
  - **Without `clients.delete`, the whole row is an Error and none of its fields are saved**, including fields the user may edit (Industry, Address, Notes). Reason: **"You don't have permission to change Status. Set it back to {current status} or leave it blank, then import this row again."** The user fixes the row and imports it again. Contacts rows that point to this client still import, because the client already exists in the app.
  - A Status equal to the current value, or a blank Status, isn't a change and needs no `clients.delete`.
  - A **new** client can be created as Active or Inactive with the button gate alone (no `clients.delete`).
  - **Open-project check:** when FR-CLI-18 is built, a change to Inactive also goes through it. If the client has open projects, the whole row is an Error with the FR-CLI-18 message, and nothing in it is saved. **Q-107 (whether to block) is still pending with Jomerson.** Until FR-CLI-18 is built, no such check runs (as today).
  - Each allowed Status change writes the existing `client_deactivated` / `client_reactivated` audit entry with `meta.importId`.

## 7. Import flow (Locked: two API calls)
- **FR-CLI-34 (Must) Preview.** `POST /clients/import/preview` (raw `.xlsx` body, read **in memory**, no Storage or Blob use). The server checks the file, then validates and matches every row. It returns counts (**new / update / no change / error**, per sheet and in total) and **per-row tags** (sheet, Excel row number, key columns, result New / Update / No change / Error, reason or warning). **Nothing is saved.**
- **FR-CLI-35 (Must) Commit.** **Import valid rows ({n})** calls `POST /clients/import/commit` with the same file (the browser keeps it, because the server stores nothing). The server **re-runs** the full validation and matching, then writes all New and Update rows **in one transaction**. If anything fails, everything rolls back and nothing is saved ("Import failed. Nothing was saved. Try again."). Clients are written before contacts, so new contacts can link to new clients from the same file. {n} counts New and Update rows only.
- **Preview vs commit (Lean-accepted default, 2026-11-03, Q-116):** the commit applies the result as of the commit, so if the data changed after the preview, its counts can differ from the preview. The toast always shows the counts actually applied, and the skipped-rows file holds the commit's Error rows. A write conflict during the commit rolls everything back (EC-149).
- **FR-CLI-36 (Must) Error rows are skipped**, never partly saved. The user can download them with **"Download skipped rows (.xlsx)"**: the same two sheets with only the Error rows, plus **Row** and **Reason** columns, built in the browser from the commit result (no server storage). Cells are escaped (FR-CLI-37).
- **FR-CLI-38 (Must) Done.** The modal closes, the list refreshes, and a toast says **"Imported {X} new, updated {Y}. {Z} rows skipped."** X and Y cover clients and contacts. "No change" rows aren't in X, Y or Z. Z = Error rows. The toast has the skipped-rows link when Z > 0.
- **Modal states (UIE, mockup v0.9.17):** Choose file → Reading file… → Preview (Clients and Contacts tabs, summary chips including "No change", Cancel, Import valid rows) → Done. File-level errors keep the user in the modal (§9 messages).
- Import valid rows is disabled when there are no New or Update rows, and while a commit is running (no double submit).

## 8. Functional requirements (summary table)
| ID | Requirement | Priority |
|---|---|---|
| FR-CLI-23 | Excel ▾ button on the existing `/clients` list, next to "New client", shown only with `clients.create`, `clients.edit`, `contacts.create` AND `contacts.edit` (Access Rules check) | Must |
| FR-CLI-24 | All three API calls (template, preview, commit) check the same four permissions: 403 `FORBIDDEN` if any one is missing | Must |
| FR-CLI-25 | Download template: `OpsTrack-clients-template.xlsx`, built in memory | Must |
| FR-CLI-26 | Two sheets, Clients and Contacts, with the §4 columns in order; "Company name" maps to the client `name` | Must |
| FR-CLI-27 | Row 1 explains each column, row 2 headers, both locked; data from row 3; Text format | Must |
| FR-CLI-28 | Status dropdown Active / Inactive, mapped to `active` | Must |
| FR-CLI-29 | Client match on Company name, trimmed, case-insensitive, inactive clients included | Must |
| FR-CLI-30 | Contact match on Email within the client, else Full name (no-email contacts) within the client; same email under another client = separate contact | Must |
| FR-CLI-31 | Match = update (blank cell keeps the value), no match = add, unchanged match = "No change" (not written or counted) | Must |
| FR-CLI-32 | Ambiguous match in the app = Error | Must |
| FR-CLI-33 | Duplicates in one file: every copy is an Error | Must |
| FR-CLI-34 | Preview call: validates, returns counts and per-row tags, saves nothing | Must |
| FR-CLI-34a | Contact whose Company name is in neither the file nor the app = Error; import never creates a client from Contacts | Must |
| FR-CLI-35 | Commit call: re-validates, writes valid rows in one transaction, full rollback on failure | Must |
| FR-CLI-36 | Error rows skipped and downloadable as .xlsx with Row and Reason | Must |
| FR-CLI-37 | Cells starting with `=` `+` `-` `@` saved as plain text; escaped in every export | Must |
| FR-CLI-38 | Toast "Imported {X} new, updated {Y}. {Z} rows skipped." | Must |
| FR-CLI-39 | Audit: one entry per created or updated record, plus one import summary entry | Must |
| FR-CLI-40 | Email change on a contact with a portal account is an Error (once the portal exists) | Must |
| FR-CLI-41 | Status change on an existing client needs `clients.delete`; without it the whole row is an Error and nothing in it is saved; FR-CLI-18 check applies once built | Must |

**FR-CLI-37 detail (formula safety, Locked):** a value that starts with `=`, `+`, `-` or `@` (also after a leading tab or carriage return) is stored exactly as typed, as plain text. It's never evaluated on import. On every export (the skipped-rows file, and any later CSV or Excel export of clients or contacts) it's written as a text cell, never a formula; CSV output prefixes it with `'`. The UI shows the value as typed. A phone number such as `+63 900 000 0000` is stored unchanged.

**FR-CLI-39 detail (audit):** each created or updated client or contact writes the existing actions (`client_created`, `client_updated`, `contact_created`, `contact_updated`, and for Status `client_deactivated` / `client_reactivated`) with `changes` (field, old, new) and `meta.importId`. One `clients_imported` summary entry records the actor, time, file name, size, SHA-256, and the counts (new, updated, no change, skipped, per sheet). Audit entries are written in the same transaction, so a rollback leaves none of them; a `clients_import_failed` entry is written after the rollback. Previews aren't audited, because nothing changes. "No change" rows aren't audited.

**FR-CLI-40 detail (Lean-accepted default, 2026-11-03, Q-112):** the build has no portal fields yet. Once portal accounts exist, a Contacts row that would change the email of a contact with a portal account (any status) is an Error: "This contact has portal access. Change the email on the Contacts tab." The portal email is the sign-in (FR-ACL-34). Other fields on such a contact update as usual, and import never touches portal status or invites.

## 9. File checks (before row validation)
| Check | Message (UIE copy where it exists) | HTTP |
|---|---|---|
| Not `.xlsx` (by content: ZIP/OOXML workbook, not by name alone; `.xls`, `.xlsm`, `.csv` refused) | "Upload an .xlsx file." | 415 `UNSUPPORTED_FILE` |
| Over 5 MB | "The file is larger than 5 MB." | 413 `FILE_TOO_LARGE` |
| Sheets Clients and Contacts missing, or row 2 headers don't match (renamed, reordered, missing) | "This file isn't the OpsTrack template. Download the template and try again." | 422 `NOT_TEMPLATE` |
| Extra columns to the right of the template columns | Ignored; the preview shows "Extra columns were ignored: {names}." | — |
| Extra sheets | Ignored | — |
| Both sheets have no data rows | "No rows found in the file." | 422 `EMPTY_FILE` |
| A sheet has more than 2,000 data rows | "Too many rows: the {Sheet} sheet has {n}. The limit is 2,000 per sheet." | 422 `TOO_MANY_ROWS` |
| Password-protected or corrupt workbook | "This file can't be read. Save it again as .xlsx and retry." | 422 `UNREADABLE_FILE` |

## 10. User stories
- **US-61** As a user who can create and edit clients and contacts, I want to download a ready-made Excel template for clients and contacts, so I can fill it in offline in the right format. (FR-CLI-23 to 28)
- **US-62** As a user who can create and edit clients and contacts, I want to upload the filled template, see what will be added, updated, left unchanged or skipped, and then import the valid rows, so I can load or refresh many clients and contacts at once without duplicates. (FR-CLI-29 to 41)

## 11. Acceptance criteria
- **AC-61.1** Given a user whose role has `clients.create`, `clients.edit`, `contacts.create` and `contacts.edit` (by default Admin or PM), when they open `/clients`, then an **Excel ▾** button shows next to **"New client"**, with **Download template** and **Import from Excel**.
- **AC-61.2 (API)** Given a Member or Viewer (default rules: View only on `clients` and `contacts`), when they open `/clients`, then the Excel button isn't shown, and `GET /clients/import/template`, `POST /clients/import/preview` and `POST /clients/import/commit` each return **403 `FORBIDDEN`**.
- **AC-61.3 (API)** Given a PM with all four permissions, when an Admin removes **any one** of PM's `clients.create`, `clients.edit`, `contacts.create` or `contacts.edit` and saves, then on the PM's next request the Excel button is gone and all three import calls return 403. When the permission is granted back, the button returns and the calls work. "New client" follows only `clients.create` throughout.
- **AC-61.4 (API)** Given a portal token (once the portal exists), when it calls any import endpoint, then the API returns 401.
- **AC-61.5** Given the template is downloaded, then it has sheets **Clients** and **Contacts** with the §4 columns in order, both starting with "Company name". Row 1 explains each column, row 2 has the headers, rows 1 and 2 are locked, and the Status cells offer only **Active** and **Inactive**.
- **AC-61.6 (API)** Given a role with `clients.create` and `clients.edit` but no `contacts.create` or `contacts.edit` (View only on contacts), when its user opens `/clients`, then the Excel button is hidden, "New client" still shows, and all three import calls return **403 `FORBIDDEN`**. The same holds for a role with contacts rights but no clients create or edit.
- **AC-62.1 (API)** Given a filled template, when it's previewed, then the response has counts (new / update / no change / error) and a tag per row with its Excel row number and reason, and nothing in the app or the audit log changes.
- **AC-62.2 (API)** Given the Clients sheet has "client a " and the app has "Client A", when previewed, then the row is tagged **Update** (or **No change** if no filled cell differs). Given "Client B" isn't in the app, then it's **New**.
- **AC-62.3 (API)** Given an existing contact `contact@example.com` under Client A, when a row for Client A has `CONTACT@example.com`, then it's an **Update**. When the same email appears under Client B, then it's **New** under Client B, and the Client A contact is unchanged.
- **AC-62.4 (API)** Given an existing Client A contact "Contact One" with no email, when a row for Client A has Full name "contact one" and no email, then it matches that contact.
- **AC-62.5 (API)** Given an update row with Industry blank and Notes filled with a new value, when committed, then Industry keeps its value and Notes is replaced.
- **AC-62.6 (API)** Given Client A appears on rows 4 and 7 of the Clients sheet, when previewed, then both rows are **Error** "Duplicate in file (rows 4 and 7)" and neither is imported. The same applies to two rows with `contact@example.com` under one client.
- **AC-62.7 (API)** Given 6 New, 2 Update, 3 No change and 5 Error rows, when **Import valid rows (8)** is confirmed, then the 8 rows are saved in one transaction, the 3 No change rows aren't written or audited, the 5 Error rows are skipped, and the toast reads "Imported 6 new, updated 2. 5 rows skipped." with a **Download skipped rows (.xlsx)** link that holds the 5 rows with Row and Reason.
- **AC-62.8 (API)** Given the database fails part-way through a commit, then nothing from the file is saved, no create or update audit entries remain, and the user sees "Import failed. Nothing was saved. Try again."
- **AC-62.9 (API)** Given a cell `=HYPERLINK("http://example.com")` in Notes, when committed, then Notes stores that exact text, and the skipped-rows file and any export write it as text, not a formula.
- **AC-62.10 (API)** Given a 6 MB file, a `.csv` or `.xls` file, a file with renamed headers, an empty template, or a sheet with 2,001 rows, then the preview returns the §9 error and nothing is saved.
- **AC-62.11 (API)** Given a **new** client row with Status blank, when committed, then the client is Active. Given a new row with Status "Inactive", then the client is created inactive, with no `clients.delete` needed. Given an update row with Status blank, then `active` is unchanged.
- **AC-62.12 (API)** Given a commit, then each created or updated record has one audit entry with old and new values and `meta.importId`, and one `clients_imported` entry has the counts and the file SHA-256.
- **AC-62.13 (API)** Given an upload, then no file is written to Storage or Blob, and nothing about the file stays on the server after the response, except the audit entries.
- **AC-62.14 (API)** Given a Contacts row with Company name "Client Z", and "Client Z" is on neither the Clients sheet nor in the app, then the row is an **Error** ("Company Client Z isn't on the Clients sheet or in OpsTrack. Add it on the Clients sheet."), it's skipped, and no client is created.
- **AC-62.15 (API)** Given a user **without** `clients.delete` (for example a role with the four gate permissions but Delete off on `clients`) and an Active Client A, when a Clients row for Client A sets Status "Inactive" **and** changes Notes, then the **whole row** is an **Error** ("You don't have permission to change Status. Set it back to Active or leave it blank, then import this row again."). After the commit, Client A is still Active **and its Notes are unchanged**. When the user sets Status back to Active (or blank) and imports again, then the Notes change is saved.
- **AC-62.16 (API)** Given a user **with** `clients.delete` and an Active Client A, when a row sets Status "Inactive", then Client A becomes inactive with a `client_deactivated` audit entry. Once FR-CLI-18 is built (Q-107 pending), a client with open projects instead gets an Error row with the FR-CLI-18 message, and nothing in the row is saved.
- **AC-62.17 (API)** Given a row that matches an inactive contact, when committed, then the contact is updated, stays inactive, and the preview tag reads "Update (inactive)".
- **AC-62.18 (API)** Given Client A has a no-email contact "Contact One", when a Client A row has Full name "Contact One" and Email `contact@example.com`, then the row is **New**, with the warning "Possible duplicate of Contact One (no email) on the Contacts tab."

## 12. Non-functional
- **NFR-36 Limits (Locked):** 5 MB per file, `.xlsx` only (checked by content), 2,000 data rows per sheet. The raw-body limit on the import routes is 5 MB plus a small margin (pattern: `documents.ts:1169`). The 100 kB JSON limit stays for everything else.
- **NFR-37 In memory (Locked):** the upload is parsed in memory and doesn't depend on Storage. The workbook buffer is dropped after the response. The parser limits decompressed size (zip-bomb guard, for example 50 MB uncompressed) and ignores macros, external links and embedded objects.
- **NFR-38 Formula/CSV injection (Locked):** FR-CLI-37 on import and every export, covered by automated tests.
- **NFR-39 Audit:** FR-CLI-39. Import entries show in the Audit log like other client edits.
- **NFR-40 Performance (proposed target):** a full file (2,000 + 2,000 rows) previews and commits within 30 seconds server-side, well under the App Service request timeout. Matching uses bulk lookups (one query per sheet), not one query per row. Deven checks that a 4,000-write transaction fits the production database's transaction limits, and reports back before building if it doesn't.
- **NFR-41 Abuse limits (proposed):** import calls are rate-limited per user (20 previews and 5 commits per 15 minutes; 429 after that). Only one commit per user runs at a time.

## 13. Edge cases
- **EC-139** Duplicate rows in the file (same company twice, or same email or same no-email full name twice under one client): every copy is an Error (FR-CLI-33).
- **EC-140** A contact's Company name is in neither the file nor the app: Error, skipped, no client created (FR-CLI-34a, Locked).
- **EC-141** A contact's Company name matches a Clients row that is an Error: the contact is an Error too ("Its client row {n} has an error."). If the client already exists in the app (for example the client row failed only on Status, FR-CLI-41), the contact links to the existing client and imports.
- **EC-142** A blank Status: new client → Active; update → unchanged (AC-62.11).
- **EC-143** An email used by a contact under another client: allowed; it's a separate contact under this client (FR-CLI-30). An email equal to a staff user's email is also allowed (EC-21).
- **EC-144** A contact with portal access is updated (once the portal exists): name, position, phone, department and notes update as usual. Portal access, status and invites aren't touched. An email change on such a contact is an Error (FR-CLI-40).
- **EC-145** Empty file (headers only): 422 "No rows found in the file."
- **EC-146** Wrong template (renamed or missing sheets, renamed or reordered headers): 422 `NOT_TEMPLATE`. Extra columns on the right and extra sheets are ignored, with a note in the preview.
- **EC-147** Very large file (over 5 MB, or over 2,000 rows on a sheet): refused before row validation (§9). A small file that expands hugely when unzipped is refused as unreadable (NFR-37).
- **EC-148** The data changes between preview and commit (another user edits or adds a client): the commit re-validates and applies the current result, and the toast shows the counts actually applied (Q-116).
- **EC-149** Two users commit overlapping files at once: the unique `nameKey` index or the transaction refuses one of them. That commit rolls back fully and says "Someone changed these clients while you were importing. Preview again."
- **EC-150** A row matches an inactive client or contact: it's updated, stays inactive unless Status (clients only, FR-CLI-41) changes it, and the preview tag reads "Update (inactive)" (Q-114).
- **EC-151** A row has an Email, and the client has a no-email contact with the same Full name: **New**, with a "Possible duplicate" warning (Q-113, AC-62.18).
- **EC-152** Two existing contacts of one client share an email (allowed today): Error "Matches more than one contact" (FR-CLI-32).
- **EC-153** A cell starting with `=`, `+`, `-` or `@` (formula, phone, note): stored as plain text and escaped on export (FR-CLI-37).
- **EC-154** Access Rules give a Member all four gate permissions: a row whose Company name belongs to a client outside that Member's scope is an Error "This company name can't be used.", and the reason never says the client exists (FR-ACL-09 pattern). A new client a Member adds stays outside their scope until they're on one of its projects.
- **EC-155** A user loses any gate permission between preview and commit: the commit returns 403 and nothing is saved.
- **EC-156** The same file is committed twice: the second preview shows every row as **No change** (or Error), nothing is written, and no duplicates appear (FR-CLI-31).
- **EC-157** A user without `clients.delete` changes Status on a matched client, together with other fields they may edit: the **whole row** is an Error and **none** of its fields are saved, not even the allowed ones. They set Status back (or blank) and re-import the row (FR-CLI-41, AC-62.15). Other rows in the file still import.

## 14. Assumptions
- **A-30** The template is blank (no existing clients). A prefilled export is out of scope (Q-117).
- **A-31** Lean's "first row explains each column" means a separate explanation row above the header row (row 1 explanations, row 2 headers). If Lean meant the header row itself carries the explanation (for example as cell notes), FR-CLI-27 and the header check move up one row.
- **A-32** The commit re-sends the file instead of keeping state on the server, because the upload doesn't depend on Storage (Locked).
- **A-33** The skipped-rows file is built in the browser from the API result. No server endpoint stores it.
- **A-34** Import doesn't change projects, active contacts, tasks or portal accounts.
- **A-35** Contacts written by import are created active. Import never changes a contact's `active` flag (the Contacts sheet has no Status column).

## 15. Decisions and open questions
| ID | Question | Decision |
|---|---|---|
| Q-109 | Contact whose Company name is in neither the file nor the app | **Locked (Lean, 2026-11-03):** Error row, skipped. Import never creates a client from the Contacts sheet (FR-CLI-34a). |
| Q-110 | Status change on an existing client | **Locked (Lean, 2026-11-03):** needs `clients.delete`. Without it the **whole row** is an Error and nothing in it is saved. A new client may be Active or Inactive. The FR-CLI-18 open-project check applies once built (FR-CLI-41). |
| Q-111 | Rights on clients but not contacts | **Locked (Lean, 2026-11-03):** one gate. Button and all three calls need create and edit on both `clients` and `contacts` (FR-CLI-23/24, AC-61.6). |
| Q-112 | Email change on a contact with portal access | **Lean-accepted default (2026-11-03):** Error row; change the email on the Contacts tab (FR-CLI-40). |
| Q-113 | Row with an Email vs a no-email contact with the same name | **Lean-accepted default (2026-11-03):** New, with a "Possible duplicate" warning (§5, AC-62.18). |
| Q-114 | Rows matching inactive records | **Lean-accepted default (2026-11-03):** update them, tag "Update (inactive)", active flag unchanged (§5, AC-62.17). |
| Q-115 | Matched rows with nothing changed | **Locked (Lean, 2026-11-03):** "No change" tag, not written, not counted as an update (FR-CLI-31). |
| Q-116 | Commit result differs from the preview | **Lean-accepted default (2026-11-03):** apply the result at commit time and report the counts actually applied (§7, EC-148). |
| Q-117 | Prefilled "Export clients (.xlsx)" | **Lean-accepted default (2026-11-03):** not in this CR. A prefilled export would be a new request for Jomerson. |

**Still open:**
- **Q-107** (from CR-18, Jomerson): block deactivating a client with open projects? It decides whether the FR-CLI-18 check exists, and so whether import Status changes to Inactive are refused for clients with open projects (FR-CLI-41).
- **CR-19 approval** by Jomerson.

## 16. Status
**New, not built.** Rules are decided (Locked or Lean-accepted defaults, 2026-11-03). Jomerson approves the CR. Q-107 stays pending under CR-18. UIE's mockup v0.9.17 is the UI reference, and the role notes in `CLIENTS_EXCEL_IMPORT_UI.md` (v0.9.16, "Admin and Member") are replaced by §3. When approved, FR-CLI-23 to 41 go into doc 11 (Clients section), US-61/62 into doc 04, AC-61.x/62.x into doc 05, EC-139 to 157 into doc 08, NFR-36 to 41 into doc 07, and Q-109 to Q-117 into doc 09 as decided.
