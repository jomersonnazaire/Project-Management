// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * DR-12: icons.css is a generated subset of Boxicons. Every bx- / bxs- / bxl- class used in src
 * must have a rule there, or it renders as an empty square. Fix a failure by re-running
 * `node scripts/build-icon-subset.mjs`.
 */
const src = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(src, 'vendor/sneat/icons.css'), 'utf8');
const ICON_CLASS = /\b(bx[sl]?-[a-z0-9]+(?:-[a-z0-9]+)*)\b/g;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'vendor' && name !== 'test') yield* files(p);
    } else if (/\.(tsx?|s?css|html)$/.test(name)) yield p;
  }
}

const hasRule = (name: string) =>
  new RegExp(`^\\.${name} \\{\\s*--svg: url\\("data:image/svg\\+xml,`, 'm').test(css);

describe('Boxicons subset (DR-12)', () => {
  const used = new Map<string, string>();
  for (const f of files(src))
    for (const m of readFileSync(f, 'utf8').matchAll(ICON_CLASS))
      used.set(m[1]!, f.slice(src.length));

  it('finds the icons the app uses (sanity check of the scan)', () => {
    expect(used.has('bx-pencil')).toBe(true);
    expect(used.has('bx-dots-vertical-rounded')).toBe(true);
  });

  it('every bx-/bxs-/bxl- class used in src has a rule in icons.css', () => {
    const missing = [...used].filter(([name]) => !hasRule(name)).map(([n, f]) => `${n} (${f})`);
    expect(missing).toEqual([]);
  });

  it('keeps the icons listed in icons.required.json', () => {
    const { icons } = JSON.parse(
      readFileSync(join(src, 'vendor/sneat/icons.required.json'), 'utf8'),
    ) as { icons: string[] };
    expect(icons.filter((n) => !hasRule(n))).toEqual([]);
  });

  it('has the .bx base rule that draws the mask', () => {
    expect(css).toMatch(/^\.bx \{[^}]*mask-image: var\(--svg\)/m);
  });
});
