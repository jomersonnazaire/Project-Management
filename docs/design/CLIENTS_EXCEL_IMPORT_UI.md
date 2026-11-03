# Clients: Excel import and export (UI spec)

- **Mockup:** `mockup/index-v0.9.17.html#clients` (clickable). Screenshots: `mockup/clients-excel-1-admin-dropdown.png`, `-2-viewer.png`, `-3-preview.png`, `-4-bad-file.png`.
- **Requirements:** CR-19, `CR_CLIENTS_EXCEL_IMPORT.md` (Rich): FR-CLI-23 to 40, EC-139 to 156, Q-109 to 117. Decisions: Lean, Nov 3 2026.
- **Built page this copies:** `ClientsPage` at `/clients`, `apps/web/src/pages/clients/ClientsPage.tsx`. Source: jomersonnazaire/Project-Management, `origin/main` @ 16854be (Nov 3 2026, 11:30 AM SGT), read from the local clone `/workspace/pm-opstrack`. Its branch `fix/api-proxy-ops-track` has the same code as `origin/main`.

## The Clients page (as built)
- **Header:** the title "Clients" and the primary **New client** button, which has a plus icon (`bx-plus`). In the app, `PageHeader` puts both in the top bar.
- **Filters:** a **Search clients…** box and a **Show inactive** switch, which is off by default.
- **Columns:**
  - Client (links to the client)
  - Industry
  - Active contacts (links to the client's Contacts tab)
  - Projects
  - Status (an Active or Inactive badge)
  - Row actions: **Edit** and **Deactivate** / **Reactivate**
- **States:**
  - Loading: skeleton rows.
  - Empty: "No clients yet". Roles that can create also get "Add your first client company." and a **New client** button. Everyone else gets "Clients you can see will appear here."
  - No search results: "No clients match" and "Try a different search or show inactive clients."
- The only change to this page is the new **Excel ▾** button, which sits beside **New client** (FR-CLI-23).
- The sidebar and Member's menu are unchanged.

## Who sees it (Access rules, decided)
- **One gate, from Access rules.** The whole Excel button, including Download template, shows only to users with **create and edit on both `clients` and `contacts`**. It isn't tied to fixed roles. This decides Q-111. It also replaces the clients-only check in FR-CLI-23 and FR-CLI-24, so the API needs the same four permissions on the template, preview and commit calls.
- **Who that is by default:** `DEFAULT_SPEC` in `packages/shared/src/accessRules.ts` gives **Admin** and **Project Manager** `clients: 'VCED'` and `contacts: 'VCED'`, so they see the button. **Member** and **Viewer** have `'V'` on both, so they don't.
- **How the app checks it:** `useCan('clients','create') && useCan('clients','edit') && useCan('contacts','create') && useCan('contacts','edit')`.
- **How it relates to the other buttons:**
  - **New client** follows `clients.create` only.
  - **Edit** follows `clients.edit`. **Deactivate** and **Reactivate** follow `clients.delete`.
  - With the default rules, the Excel button shows exactly when New client does. If an Admin changes the rules, the two can differ.
- **In the mockup:** the Demo role switcher shows the defaults. Admin and PM see Excel, New client and the row actions. Member and Viewer see none of them.

## Template (FR-CLI-25 to 28)
- **File:** a single file, `OpsTrack-clients-template.xlsx`, with two sheets in this order:

| Sheet | Columns |
|---|---|
| Clients | Company name, Industry, Address, Notes, Status |
| Contacts | Company name (links the contact to its client), Full name, Position, Email, Phone, Department, Notes |

- **Rows:** row 1 explains each column and row 2 holds the headers. Data starts on row 3, so the preview's Row numbers start at 3 (FR-CLI-27).
- **Fields in the built model:**
  - Company name → `name` (form label "Company name" in `ClientModal.tsx:48`, list column "Client", up to 160 characters). Template header stays "Company name" (CR-19).
  - Industry → `industry`
  - Address → `address`
  - Notes → `notes`
  - Status → `active`
  - Contacts columns → `name`, `position`, `email`, `phone`, `department` and `notes`
  - These come from `clientSchema` and `contactSchema` in `packages/shared/src/schemas.ts`.
- **Download in the mockup:** it only shows the toast "Template downloaded: OpsTrack-clients-template.xlsx".

## Status values (decided)
- **Where Status comes from:** the client's `active` flag:
  - `apps/api/src/models/Client.ts:10`: `active: { type: Boolean, default: true }`
  - `packages/shared/src/types.ts`: `ClientDto.active: boolean`
  - `apps/web/src/components/Badges.tsx`: the `ActiveBadge` label
- **Values:** only **Active** (`true`) and **Inactive** (`false`), with case ignored (FR-CLI-28). An invalid value gives the error "Status must be Active or Inactive". This is locked.
- **New clients** can be Active or Inactive. A blank Status means Active, the model default (EC-142).
- **Changing Status on an update (decided, Q-110):** this is allowed only for roles with `clients` **delete**, the same permission as Deactivate and Reactivate. For anyone else the row is an Error: "You don't have permission to change Status". By default Admin and PM have delete, so the mockup doesn't show this error.

## Matching and import rules
- **Clients** match on Company name, trimmed, with case ignored (FR-CLI-29).
- **Contacts** match on Email under that client. A contact with no email matches on Full name within its client, with case ignored. The same email under a different client is a separate contact (FR-CLI-30).
- **Results:** a match updates the record, and anything else is added. On an update, **blank cells keep the current value** (FR-CLI-31).
- **Duplicates in one file:** every copy is an Error and no copy wins. Copy: "Duplicate in file (rows 4 and 7)" (FR-CLI-33, EC-139).
- **Company not found (decided, Q-109):** a contact whose company is in neither the file nor OpsTrack is an Error and is skipped. Copy: "Company not found in file or OpsTrack". Import never creates a client from the Contacts sheet (EC-140).
- **No change (decided, Q-115):** a row that matches and changes nothing gets a grey **No change** result. It isn't written or audited, and it isn't counted as an update (FR-CLI-31, EC-156).
- **Possible duplicate (decided, Lean Nov 3):** a contact row that has an email and matches an existing no-email contact by Full name is added as **New**, with an amber "Possible duplicate" warning shown in the Reason column. It's never merged automatically and doesn't block the import.
- **Limits:** 5 MB per file and 2,000 rows per sheet (EC-147).
- **Formula safety:** cells that start with `=` `+` `-` `@` are saved as plain text and escaped on every export (FR-CLI-37, EC-153). This rule is in the spec only and doesn't appear in the UI.

## Modal flow and states
1. **Choose file:** a drop zone that says "Drop your filled template here or choose a file", with a **Choose file** button. Helper text: ".xlsx only · up to 5 MB · 2,000 rows per sheet". Below it there's a "Download template" link.
2. **Loading:** a spinner with "Reading file…".
3. **Preview** (FR-CLI-34):
   - **Header:** a file chip and a "Choose another file" link.
   - **Summary chips:** "5 new", "3 to update", "1 no change", "6 with errors".
   - **Matching note:** "Clients match on Company name (spaces trimmed, case doesn't matter). Contacts match on Email under that client, or on Full name within that client when there's no email. The same email under a different client is a separate contact. Matches update the record; others are added. Rows with nothing to change show No change and aren't saved. Rows with errors are skipped, and if a row appears twice in the file, every copy is skipped." It's followed by "**Update:** blank cells keep the current value."
   - **Tabs:** **Clients (7)** and **Contacts (8)**. Each table has Row, the key columns, Result and Reason. Result is one of these badges: New (green), Update (blue), No change (grey) or Error (red).
   - **Buttons:** **Cancel** and **Import valid rows (8)**. The 8 is new plus update; No change rows aren't written.
4. **Done** (FR-CLI-38): the modal closes, the list refreshes and a toast says "Imported 5 new, updated 3. 6 rows skipped." It has a **Download skipped rows (.xlsx)** link (FR-CLI-36). No change rows aren't included in any of the toast's numbers.

**Error states.** The modal stays open so the user can choose another file. Demo links in the modal footer open each one.

| State | Copy | Code |
|---|---|---|
| Not the template | "This file isn't the OpsTrack template. Download the template and try again." | 422 `NOT_TEMPLATE` (EC-146) |
| No rows | "No rows found in the file." | 422 `EMPTY_FILE` (EC-145) |
| Too many rows | "Too many rows: the Contacts sheet has 2,340. The limit is 2,000 per sheet." | 422 `TOO_MANY_ROWS` (EC-147) |

## Sample preview data
All names are fictional.
- **Clients sheet:**
  - New: Bluewave Marine Supply, and Sunridge Builders (Inactive)
  - Update: Acme Trading Corp., and "northwind distribution inc." (matched with case ignored)
  - No change: Globex Retail Group
  - Error, "Company name is blank": a row with no Company name
  - Error, "Status must be Active or Inactive": Pinecrest Foods Inc., whose Status is "Paused"
- **Contacts sheet:**
  - New: Maria Santos, Paolo Mendoza (no email) and Ana Villareal
  - Update: R. Santos
  - Error: Daniel Reyes on rows 4 and 7 (duplicate), Grace Tan ("Email isn't valid"), and Leo Navarro at Cobalt Ridge Mining ("Company not found in file or OpsTrack")
- **Totals:** 5 new, 3 to update, 1 no change and 6 errors.

## Row error reasons (copy)
- Company name is blank
- Email isn't valid
- Status must be Active or Inactive
- Duplicate in file (rows 4 and 7)
- Company not found in file or OpsTrack (Q-109, decided)
- You don't have permission to change Status (Q-110, decided; not drawn because the default roles have delete)
- From the CR, not drawn: "Its client row {n} has an error." (EC-141), and "Matches more than one contact in {Company name}. Fix it on the Contacts tab first." (FR-CLI-32, EC-152)

## Decided (Lean, Nov 3 2026)
- **Q-111:** one Access-rules gate, create and edit on both `clients` and `contacts`.
- **Q-109:** a contact whose company isn't found is an Error. Import never creates a client from the Contacts sheet.
- **Q-110:** a Status change on an update needs `clients` delete. Otherwise the row is an Error.
- **Q-115:** rows with nothing to change show **No change**, aren't written and aren't counted as updates.
- **Q-113:** a row with an Email that matches a no-email contact by Full name is added as **New** with an amber "Possible duplicate" warning, never merged.
- **Q-116 (CR-19 v0.6, FR-CLI-35b; any change to a matched record counts as stale):** the preview returns a signed token (tied to the user, valid 15 minutes). At commit the server recomputes. If anything differs, or the token is someone else's or expired, it returns 409 `PREVIEW_STALE` and saves nothing. The modal stays open on the preview with a warning alert, "This preview is out of date. Preview again.", and a **Preview again** button that re-runs the preview with the same file. Editing any matched client or contact, or another user's commit, also makes an open preview stale.
- **Busy / rate limited (NFR-41, 429):** if a commit is already running for this user, or the rate limit is hit, the modal stays on the preview with a warning alert: "Another import is still running. Wait a moment, then try again. Nothing was saved." The Import button is disabled while a commit is in flight, so a double click can't send a second one.
- **Not configured (AC-62.23):** if the API returns 503 `IMPORT_NOT_CONFIGURED`, the modal shows "Excel import isn't available right now. Nothing was saved." The rest of the page works.
- **Unknown errors:** server text is shown only for the known codes (`NOT_TEMPLATE`, `EMPTY_FILE`, `TOO_MANY_ROWS`, `UNREADABLE_FILE`, 413, 415). Any other import failure shows "Import failed. Nothing was saved. Try again." and a template failure shows "Couldn't download the template. Try again." Page alerts can be dismissed, and choosing a new file clears old errors.
- Blank cells keep the current value on update, every copy of a duplicate is an Error, and Status is Active or Inactive from `active`.

## Settled by CR-19 defaults (Lean-accepted; see CR-19 v0.6 for the chosen answer)
- **Q-112:** once the portal exists, may import change the email of a contact that has portal access?
- **Q-114:** rows that match an inactive client or contact: update them (tagged "Update (inactive)", EC-150) or make them Errors? The mockup has no example yet.
- **Q-117:** a later "Export clients (.xlsx)" prefilled with existing data?
- **Not drawn yet:** file-level messages from the CR. These are "Upload an .xlsx file." (415), "The file is larger than 5 MB." (413), "This file can't be read. Save it again as .xlsx and retry." (422 `UNREADABLE_FILE`), "Extra columns were ignored: {names}." and "Import failed. Nothing was saved. Try again." (AC-62.8).
