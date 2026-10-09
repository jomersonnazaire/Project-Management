# Milestone 1 functional pass: preview at 424ea75 (in progress, 2026-10-09 13:05 SGT)

## API results (passed)
A02, A04, A06 (incl. EC-21), A08, A10, A12, A03 (silent lockout: 5 failures, then correct password returns 401; unlock check due 13:21), A13 (setup + change password), A14 (verify, replacement, single use, old GET path returns 404, reset purpose with 24 h expiry, invite 72 h), B01, B02, B03, B05, K02, K03, K04 (no secrets in bundle), K05 (Helmet/CSP/HSTS; CORS rejects foreign origin).

## Defects
| ID | Severity | Title | Steps | Expected | Actual | Fix |
|---|---|---|---|---|---|---|
| DEF-001 | High | Invite and reset links point to a domain with no deployment | As Admin, create a user or copy a reset link on the preview; open the link | Opens the preview's set-password page | Link is `https://xc8-projectmgmt-web.vercel.app/setup-password#token=…`, which returns Vercel 404 DEPLOYMENT_NOT_FOUND | Set the API's `WEB_APP_URL` to the preview URL (or assign that domain), then restart |
| DEF-002 | High | Per-IP sign-in rate limit never triggers (NFR-05, TC-A09) | From one public IP (104.28.194.105), send 60+ failed sign-ins in ~5 min, through the Vercel rewrite and directly to Azure | 429 after 20 in 15 min | No 429. The `RateLimit-Policy` partition key (`pk`) changes from request to request, with remaining counts jumping between 9 and 19, so the limiter isn't keying on the real client IP. A spoofed `X-Forwarded-For` also starts a fresh bucket | Log the resolved client IP and the raw `X-Forwarded-For` on the App Service, then fix `TRUST_PROXY_HOPS` or the parsing for Azure's front ends, for both direct and Vercel-rewritten traffic. Add a test for the real header shape |

## Info
- ARRAffinity cookies are passed through the Vercel rewrite (scoped to the azurewebsites.net domain, so browsers drop them). Harmless; turn ARR affinity off since the app is pinned to one instance.

## Still to run
A01, A07, A11, B04, B06–B09, K07 (UI); A03 unlock after 15 min; A05 30-min idle; A15 12 h cap; K01 IDOR sweep is limited until projects exist (M2).
