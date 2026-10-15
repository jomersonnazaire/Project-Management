# OpsTrack logo — final assets (Ops Pulse)

**OpsTrack** — *by Jomerson & Grok*. Mark: an "O" ring crossed by an operations pulse line (live tracking of implementation work).

## Files
| File | Use |
|---|---|
| `logo.svg` | Color lockup (mark + "OpsTrack" + "by Jomerson & Grok"). **Use in the app sidebar header**, login page, docs, on white / light backgrounds. 180×56 viewBox. |
| `logo-white.svg` | White-on-purple lockup. **Use on purple (#5355e0) or dark backgrounds** (e.g. hero bands, emails with a purple header). |
| `icon.svg` | Mark only, color, transparent background (collapsed sidebar, avatars, inline). |
| `icon-white.svg` | Mark only for purple/dark backgrounds. |
| `favicon.svg` | Scalable favicon (modern browsers). |
| `favicon.ico` | 16/32/48 multi-size favicon (legacy browsers). |
| `favicon-16.png`, `favicon-32.png` | PNG favicons. |
| `apple-touch-icon.png` | 180×180, purple tile with white mark (iOS home screen). |
| `icon-192.png`, `icon-512.png` | PWA / manifest icons (purple tile, mark inside the maskable safe zone). |

## HTML snippet
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<!-- sidebar (Sneat .app-brand) -->
<a href="/" class="app-brand-link"><img src="/assets/logo/logo.svg" alt="OpsTrack by Jomerson & Grok" height="40"></a>
```
Manifest: `{"src":"/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any maskable"}` and the same for 512.

## Rules
- Palette: primary `#5355e0`, tints `#8789ff` / `#c7c8ff`, wordmark "Ops" `#384551` + "Track" `#5355e0`; tagline "by" `#646e78`, names bold `#5355e0` (on purple: white / `#c7c8ff`).
- Typeface: Public Sans 700 (wordmark), 500/700 (tagline). Lockup text is live SVG text — the page must load Public Sans (Sneat already does); outline the text if the logo is used outside the app.
- Tagline is always **"by Jomerson & Grok"**.
- Keep clear space ≥ the ring stroke width × 2 around the logo; min lockup height 32px; min icon size 16px.
- Don't recolor, stretch, add shadows, or put the color logo on purple (use `logo-white.svg`).
