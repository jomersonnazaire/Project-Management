// Regenerates src/vendor/sneat/icons.css: the Boxicons subset this app uses, extracted
// from Sneat free v3.0.0 `assets/vendor/fonts/iconify-icons.css` (MIT) so we don't ship 1.3 MB.
// Usage: node scripts/build-icon-subset.mjs <path-to-iconify-icons.css>
import { readFileSync, writeFileSync } from 'node:fs';

const ICONS = (
  'check home-smile grid-alt folder task time-five file book-content phone group bar-chart-alt-2 ' +
  'cog menu x log-out user search lock-alt plus chevron-left error briefcase buildings envelope ' +
  'check-circle calendar columns list-check detail key link copy power-off user-plus ' +
  'dots-vertical-rounded spreadsheet layout user-x user-check refresh shield-quarter info-circle'
).split(' ');

const src = readFileSync(process.argv[2], 'utf8');
const out = [
  '/* Boxicons subset generated from Sneat free v3.0.0 iconify-icons.css (MIT, see LICENSE). */',
];
const base = /\.bx \{[^}]*\}/.exec(src);
if (!base) throw new Error('.bx base rule not found');
out.push(base[0]);
for (const name of ICONS) {
  const m = new RegExp(`\\.bx-${name} \\{[^}]*\\}`).exec(src);
  if (!m) throw new Error(`icon not found: ${name}`);
  out.push(m[0]);
}
writeFileSync(new URL('../src/vendor/sneat/icons.css', import.meta.url), out.join('\n\n') + '\n');
console.log(`Wrote ${ICONS.length} icons`);
