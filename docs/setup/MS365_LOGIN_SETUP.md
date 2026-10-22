# Microsoft 365 sign-in — setup guide

Microsoft sign-in lets Xceler8 staff sign in to OpsTrack Portal with their company Microsoft account. Email + password login keeps working. Client PMs never use Microsoft sign-in (see doc 15).

## Who can do this
An account in the **Xceler8 Microsoft 365 tenant** with one of: Global Administrator, Application Administrator, or Cloud Application Administrator.

## 1. Register the app (Entra admin center)
1. Sign in to https://entra.microsoft.com with the company admin account.
2. Go to **Identity > Applications > App registrations > New registration**.
3. Name: `OpsTrack`. Supported account types: **Accounts in this organizational directory only (single tenant)**.
4. Redirect URI: platform **Web**, value `https://xc8-projectmgmt-web.vercel.app/api/auth/microsoft/callback`. Click **Register**.
5. **Authentication**: add a second Web redirect URI `http://localhost:5173/api/auth/microsoft/callback` (local dev). Leave implicit grant / ID tokens **off** (we use the authorization code flow).
6. **Overview**: copy the **Application (client) ID** and **Directory (tenant) ID**.

## 2. Client secret
1. **Certificates & secrets > Client secrets > New client secret**, expiry 6 or 12 months.
2. Copy the **Value** (not the Secret ID) immediately — it is shown once.
3. Never post it in chat rooms, tickets or commits. Give it only to whoever sets up Azure Key Vault (privately).
4. Put a calendar reminder ~2 weeks before it expires; rotate by creating a new secret, updating Key Vault, then deleting the old one.

## 3. Token claims
**Token configuration > Add optional claim > ID**: add `email`, `xms_edov`, `acct`. Accept the prompt to enable the Microsoft Graph `email` permission.
- `acct` is required: the API refuses sign-in unless `acct` is `0` (tenant member). Without it **every** Microsoft sign-in is refused.
- `xms_edov` tells the API the email domain is verified (used for linking existing accounts).

## 4. API permissions
Keep Microsoft Graph delegated `openid`, `profile`, `email`, and **`Mail.Send`** (for DAR Send from the user's mailbox). **Remove `User.Read`** (added by default). Then click **Grant admin consent for Xceler8**, including for `Mail.Send`, and check every row shows "Granted". With admin consent in place, users aren't asked to approve `Mail.Send` when they first press **Send** on a saved DAR. Sign-in itself still asks only for `openid profile email`; `Mail.Send` is requested only when someone presses Send.
- Microsoft always adds `openid profile offline_access` to the Send request, so a consent screen may say "Maintain access to data you have given it access to". The API uses the token once to send and never stores it.
- Send attaches the saved report as a PDF of up to **2.5 MB**. Larger reports are refused before anything is sent (base64 adds about 33%, and Graph's `sendMail` request is capped at about 4 MB); users can export them instead.

## 5. Who may sign in
1. **Identity > Applications > Enterprise applications > OpsTrack > Properties**: set **Assignment required?** to **Yes**. Save.
2. **Users and groups > Add user/group**: add the staff (or a staff group) allowed in. Anyone not assigned is refused by Microsoft before reaching the app.
3. Do not assign guest accounts — the API refuses guests anyway.

## 6. API settings (Azure App Service `xc8-projectmgmt-api-tc3w`)
| Setting | Value |
|---|---|
| `MS_TENANT_ID` | Directory (tenant) ID |
| `MS_CLIENT_ID` | Application (client) ID |
| `MS_CLIENT_SECRET` | Key Vault reference, e.g. `@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/ms-client-secret/)` |
| `MS_REDIRECT_URI` | `https://xc8-projectmgmt-web.vercel.app/api/auth/microsoft/callback` |
| `MS_ALLOWED_TENANT_IDS` | the tenant ID (comma-separated if ever more than one) |
| `MS_ALLOWED_DOMAINS` | company email domains, comma-separated, e.g. `xceler8.com` |
| `EDGE_PROXY_SECRET` | 32+ character secret (same value as on Vercel for the API proxy); signs the short-lived Microsoft sign-in state cookie |

The API fails closed: if any of these is missing (including `EDGE_PROXY_SECRET`) or either allowlist is empty, the Microsoft button is hidden and no one can sign in with Microsoft. Email login is unaffected. A non-empty `EDGE_PROXY_SECRET` shorter than 32 characters is a configuration error: the API refuses to start.

## 7. Local development
Add the same keys to `apps/api/.env` (never commit it), with `MS_REDIRECT_URI=http://localhost:5173/api/auth/microsoft/callback`, a dev client secret, and `EDGE_PROXY_SECRET` set to any random string of at least 32 characters. Start API + web as usual and open http://localhost:5173/login.

## 8. Check it works
1. Login page shows **Sign in with Microsoft**.
2. An assigned staff member with no account signs in: a new user is created as **Viewer**, job role **Not set**, active.
3. An existing staff member with a matching company email signs in: their account is linked; their password still works.
4. An unassigned user, a guest, or a personal Microsoft account: refused, nothing created.
5. An Admin promotes new users and sets their job role in Users.
6. Send a saved DAR from **Saved reports**; it arrives from your mailbox with the PDF attached and appears in your Sent Items.

## Mobile app
The OpsTrack mobile app opens the **system browser** at the API mobile login route (`/api/v1/auth/mobile/microsoft/login` with PKCE). Microsoft redirects to the **same** web callback (`MS_REDIRECT_URI`, proxied to the API on Vercel). No extra Entra redirect URI and no new App Service settings. After sign-in, the callback sends the user back to the app at `opstrack://auth/microsoft` with a one-time code; the app exchanges it for a bearer session at `POST /api/v1/auth/mobile/microsoft/exchange`.

End-to-end sign-in on a physical device needs the deployed API and Vercel (a phone cannot reach `localhost:5173`). Local mobile runs rely on the automated API and Flutter tests for this flow.

## Behaviour summary
- New users: Viewer, job role empty ("Not set"), active. Never Admin, never a client contact. Viewers can't log time until promoted.
- Matching: by Microsoft object ID + tenant ID; first-time link to an existing account by verified company email only.
- Deactivated users stay blocked.
- Removing someone in Entra blocks new sign-ins; an already-open session can last up to 12 hours (deactivate them in OpsTrack too for immediate effect).
