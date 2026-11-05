# CR-21 — Microsoft profile photo (avatar)

**Status:** v0.1.2 draft (2026-11-05, SGT) · **Author:** Business Analyst (Rich) · **For:** Jomerson (approval), Lean, Deven, Queen, UIE
**Requested by:** Lean (tech lead) / PM room, 2026-11-05. **Rules locked by:** Lean. Rules marked **Locked** are Lean's. Anything not locked is an assumption (§7) or an open question (§8).
**Part of:** doc 17 (change requests). CR-21 is summarised in `17_CHANGE_REQUESTS.md` and specified in full here. It follows CR-20 and uses the next free IDs: **FR-USR-07 to FR-USR-12**, **FR-SSO-12 / FR-SSO-12a**, **US-68**, **AC-68.1 to AC-68.8**, **EC-176 to EC-182**, **NFR-47 to NFR-49**, **Q-126**, **A-42 to A-46**.
**Checked against:** docs 01 to 17 (with CR-20), the build at `main` `dbaea24` (includes PR #47 CR-20), and UIE design note `docs/design/FOLLOWUPS_CONVERSATION_UI.md` (Avatars; mockup `docs/design/mockup/index-v0.9.19.html#followups`).
**Not built.** This is a new request, not a PR review.
**UI reference:** Avatars section of [`docs/design/FOLLOWUPS_CONVERSATION_UI.md`](../design/FOLLOWUPS_CONVERSATION_UI.md). One shared avatar component for top bar, Users list, and Follow-ups: photo from `GET /users/:id/avatar`, initials on 404 (or image error). Mockup: `docs/design/mockup/index-v0.9.19.html#followups`.

**Related (not this CR):** Follow-ups conversation restyle is **UI-only** per UIE's note; no new CR. Same delivery branch as this API + web work is fine. See CR-20 changelog pointer to that note.

**Doc change log:**
- v0.1.2 (2026-11-05 ~5:39 PM SGT): **A-44 updated (Lean).** Any signed-in active staff may fetch `GET /users/:id/avatar`; never public. Aligns with Follow-ups authors and Queen's cases (signed-out 401; deactivated cannot fetch).
- v0.1.1 (2026-11-05 ~5:07 PM SGT): **Q-126 closed (Lean).** Add delegated **`User.Read`** to Microsoft sign-in scopes for the Graph photo only (FR-SSO-12a). No other Graph scopes. `User.Read` is Microsoft's basic delegated permission (app registrations list it by default; normally no admin consent). Deven checks it is listed under the app registration's API permissions; if staff get a consent prompt on staging, Jomerson can grant tenant-wide consent once in Entra. Setup guide updated (stop removing `User.Read`). No IDs renumbered.
- v0.1 (2026-11-05, SGT): first draft from Lean's locks. Photo fetch on Microsoft sign-in callback; 96px blob; signed-in avatar route; initials fallback; never block sign-in.

## 1. Summary
When someone signs in with Microsoft, the API reads their Teams/Office photo from Microsoft Graph during that sign-in callback, resizes it to **96px**, stores it in our blob storage, and serves it to signed-in clients via **`GET /users/:id/avatar`**. Missing photo → **404** → UI shows initials. Refresh the stored copy on **every** Microsoft sign-in. Never keep their Microsoft token for a later photo fetch. Password sign-in or no photo keeps initials. A failed photo fetch must **not** block sign-in.

## 2. Scope
**In scope**
- Fetch Graph `/me/photo/$value` in the Microsoft sign-in callback (web; mobile Microsoft sign-in same callback path if it shares the API).
- Require delegated **`User.Read`** for that fetch (FR-SSO-12a; Q-126 closed). No other Graph scopes invented here.
- Resize to 96px; store in existing blob storage; serve via signed-in `GET /users/:id/avatar` with good cache headers.
- UI: one avatar component — top-bar account avatar, Users list, beside each Follow-ups author — photo then initials on 404 / image error (UIE Avatars section).

**Out of scope**
- Follow-ups conversation restyle (day chips, bubbles, runs, New divider, composer). That is UI-only in UIE's note; CR-20 changelog points at it. Not specified here.
- Uploading a custom OpsTrack photo, Admin photo edit, or password-user photo upload.
- Keeping a Microsoft refresh/access token after the sign-in callback to fetch photos later.
- Changing Entra app config beyond adding / confirming **`User.Read`** (FR-SSO-12a) and the optional tenant-wide consent path if a staging prompt appears.

## 3. Functional requirements (Locked, Lean, 2026-11-05)
- **FR-SSO-12 (Must)** On a successful **Microsoft** sign-in callback, the API fetches the user's photo from Graph **`GET /me/photo/$value`** using the access token from that callback only. It does **not** store the Microsoft token for later photo use. Amends the Microsoft sign-in flow (CR-01 / FR-SSO-01 family); password sign-in is unchanged.
- **FR-SSO-12a (Must, Locked Lean, Q-126 closed 2026-11-05 ~5:07 PM SGT)** Microsoft sign-in scopes include delegated **`User.Read`** (in addition to existing `openid profile email`) so the callback can call Graph `/me/photo/$value`. **Photo only — do not add any other Graph scopes.** Update `DEFAULT_SCOPES`, the Entra app registration API permissions, and `docs/setup/MS365_LOGIN_SETUP.md` (stop telling people to remove `User.Read`). Deven checks **`User.Read` is listed** under the app registration's API permissions. It is Microsoft's basic delegated permission and app registrations list it by default, so it **normally needs no admin consent**. If staff get a consent prompt on staging, Jomerson can grant **tenant-wide consent once** in Entra.
- **FR-USR-07 (Must)** The fetched image is resized to **96×96** (or longest side 96px, square crop — Deven's call within 96px) and written to **blob storage**. A successful write replaces any previous stored photo for that user.
- **FR-USR-08 (Must)** The stored copy is **refreshed on every Microsoft sign-in** (success path). There is no separate "sync photo" action in this CR.
- **FR-USR-09 (Must)** Signed-in clients read the photo via **`GET /users/:id/avatar`**. Any signed-in **active** staff may read any user id's avatar (not limited to Users-list / task-membership visibility); unauthenticated requests are refused (AC-68.5); deactivated accounts cannot fetch (Queen TC-AV-003b; see A-44). Response is the image bytes with cache-friendly headers (NFR-47). **No stored photo → 404** (not an empty 200).
- **FR-USR-10 (Must)** UI uses **one** avatar component for: **top-bar** account avatar, **Users** list, and **Follow-ups** thread (beside each author). It requests `GET /users/:id/avatar`; on **404** or image load error it shows **initials**. Spec for size, initials letters, and colours: UIE Avatars section in `FOLLOWUPS_CONVERSATION_UI.md` (Follow-ups thread avatar is 32px there; top bar / Users keep their current sizes but the same photo→initials behaviour).
- **FR-USR-11 (Must)** **Password** sign-in, Microsoft users with **no** Graph photo, and seeded `@xceler8.example` accounts (not real Microsoft accounts) keep **initials**. No photo is invented.
- **FR-USR-12 (Must)** If the Graph photo fetch, resize, or blob write **fails**, **sign-in still succeeds**. Log the failure for ops; leave any previous stored photo as-is (or none). Do not surface a blocking error to the user for the photo step alone.

**Graph scopes (Locked, Q-126):** sign-in today requests `openid profile email` only (`microsoftAuth.ts` `DEFAULT_SCOPES`). Setup guide `docs/setup/MS365_LOGIN_SETUP.md` currently says to **remove** `User.Read`. Graph `/me/photo/$value` needs delegated **`User.Read`**. **FR-SSO-12a** locks adding **`User.Read` only** to the Microsoft sign-in scopes (app registration + `DEFAULT_SCOPES` + setup guide). Entra listing check by Deven; tenant-wide consent by Jomerson only if a staging consent prompt appears. **Do not add any other Graph scopes** for this CR.

## 4. User story
- **US-68** As a teammate signed in with Microsoft, I want my Microsoft profile photo to show in the top bar, Users, and Follow-ups, so people recognise me without opening my profile; if there is no photo I still see clear initials.

## 5. Acceptance criteria
- **AC-68.1 (API)** After a Microsoft sign-in that returns a Graph photo, blob storage holds a ~96px image for that user and `GET /users/:id/avatar` (signed in) returns **200** with an image body. (FR-SSO-12, FR-USR-07, FR-USR-09)
- **AC-68.2 (API)** A second Microsoft sign-in with a different Graph photo replaces the stored image; the avatar route serves the new one. (FR-USR-08)
- **AC-68.3 (API)** User with no Graph photo (Graph 404 / empty): no blob required; avatar route returns **404**; sign-in still succeeds. (FR-USR-11, FR-USR-12)
- **AC-68.4 (API)** Graph or blob failure during the photo step: sign-in completes; avatar route behaviour unchanged from before that attempt (previous image or 404). (FR-USR-12)
- **AC-68.5 (API)** Unauthenticated `GET /users/:id/avatar` is refused (401/403 as for other protected routes). (FR-USR-09)
- **AC-68.6 (UI)** Top bar, Users list, and Follow-ups show the photo when the avatar route returns 200; on 404 or image error they show initials with no layout jump. (FR-USR-10; UIE Avatars)
- **AC-68.7 (UI)** Password-only user (e.g. seed `@xceler8.example`) always shows initials; no call depends on a Microsoft token after sign-in. (FR-USR-11)
- **AC-68.8 (Staging)** Real Microsoft photo check is **Jomerson on staging** (not seed accounts). Placeholder samples in docs use `@xceler8.example` only. (A-45)

## 6. Edge cases and non-functional
- **EC-176** Microsoft user deletes their Graph photo: next sign-in fetch fails or 404 → treat as no photo; prefer clearing the stored blob so the UI falls back to initials (Deven: clear on Graph 404; on transient errors keep previous — A-46).
- **EC-177** Very large Graph image: still resize to 96px; refuse or skip only if decode fails (then FR-USR-12).
- **EC-178** Concurrent Microsoft sign-ins for the same user: last successful write wins; avatar route never returns a partial file.
- **EC-179** User id not found or caller cannot see that user: same access rule as other user profile reads (404/403); do not leak whether a blob exists.
- **EC-180** Mobile Microsoft sign-in: if it uses the same API callback, photo refresh applies the same way; mobile UI surface is out of scope unless already showing an avatar.
- **EC-181** Cached avatar after refresh: cache headers may delay UI update until revalidation; acceptable within NFR-47.
- **EC-182** `User.Read` missing from scopes / registration, or consent refused: photo step fails; sign-in still succeeds (FR-USR-12); initials until scopes + listing (and tenant consent if needed) match FR-SSO-12a.
- **NFR-47 (Must)** `GET /users/:id/avatar` sends cache headers suitable for private/authenticated images (e.g. short `Cache-Control` / `ETag` or equivalent). Do not put long-lived public CDN cache on avatars without auth.
- **NFR-48 (Must)** Microsoft access/refresh tokens used for the photo fetch are **not persisted** after the callback finishes.
- **NFR-49 (Should)** Photo fetch + resize + blob write stay off the critical user-visible path as much as practical, but may run inline in the callback provided FR-USR-12 holds (failure never fails sign-in).

## 7. Assumptions
- **A-42** Blob storage is the same Azure (or memory) blob stack already used for documents; a dedicated key prefix such as `avatars/{userId}` is fine (Deven).
- **A-43** Initials algorithm and Sneat label colours follow UIE's Avatars section (first+last initial, or first two of a single word; stable hash of name).
- **A-44 (updated v0.1.2, Lean)** Any signed-in **active** staff may `GET /users/:id/avatar` for any user id (so Follow-ups / top bar / assignees can show the photo wherever a name shows). The route is **never public**: unauthenticated → 401/403 (AC-68.5). Deactivated accounts must not be able to fetch avatars (Queen TC-AV-003b).
- **A-45** Seed `@xceler8.example` accounts are not Microsoft accounts; staging check is Jomerson with a real Microsoft account.
- **A-46** On Graph **404** (no photo), clear any stored avatar so initials show; on **transient** Graph/blob errors, keep the previous stored image if any (FR-USR-12).

## 8. Open questions
| ID | Question | Status / proposed default | Who |
|---|---|---|---|
| **Q-126** | Sign-in scopes today are `openid profile email` and the setup guide removes `User.Read`. Confirm we **add `User.Read`** to Microsoft sign-in scopes (app registration + `DEFAULT_SCOPES` + setup guide) for Graph photo. No other scopes for this CR. | **Closed (Lean, 2026-11-05 ~5:07 PM SGT):** Yes — add **`User.Read` only** (FR-SSO-12a). Basic delegated permission; listed by default, normally no admin consent. Deven checks it is listed under the app registration's API permissions. If staff get a consent prompt on staging, Jomerson grants tenant-wide consent once in Entra. | Lean (closed); Deven (listing); Jomerson (tenant consent if prompted) |

## 9. Status
- **Draft v0.1.2.** Lean locks captured. **Q-126 closed** (add `User.Read` only; FR-SSO-12a). **A-44 updated** (any signed-in active staff; never public). Awaiting Jomerson's OK to build.
- **Build:** same branch as the Follow-ups thread redesign (web + this API) is fine; thread restyle itself remains UI-only (UIE note / CR-20 pointer). Deven: confirm `User.Read` listed on the app registration; update scopes + setup guide.
- **Test:** AC-68.x; Queen covers 404→initials, failed fetch still signs in, and cache/auth on the avatar route.
- Once approved: FR-USR-07 to 12 into doc 03, FR-SSO-12 / FR-SSO-12a into doc 14, US/AC into docs 04/05, EC into doc 08, NFR into doc 07, Q-126 into doc 09 (closed).
