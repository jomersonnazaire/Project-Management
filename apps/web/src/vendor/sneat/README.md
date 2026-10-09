# Vendored: Sneat Bootstrap HTML Admin Template – Free v3.0.0

- Source: https://github.com/themeselection/sneat-html-admin-template-free (v3.0.0)
- License: MIT, © ThemeSelection — see [LICENSE](LICENSE). Attribution is kept here and in the app footer.

What we use:

- `scss/` – Sneat's SCSS (Bootstrap 5.3 extended + layout/menu components), compiled by Vite.
  Only `scss/_custom-variables/_bootstrap-extended.scss` is modified, with the WCAG AA colour
  overrides from `docs/design/THEME_TOKENS.md`.
- `icons.css` – a Boxicons subset generated from Sneat's `assets/vendor/fonts/iconify-icons.css`
  by `apps/web/scripts/build-icon-subset.mjs`.

Not shipped: Sneat's HTML pages, jQuery, menu.js/main.js, and other page scripts. Layout behaviour
(sidebar toggle, dropdowns) is implemented in React.
