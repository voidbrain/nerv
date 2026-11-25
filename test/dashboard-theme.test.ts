// F-130-T01: the workspace theme tokens equal the dashboard's palette (F-047) until F-130-T13 retires the old page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCENTS, DEFAULT_THEME, palette, themeChoice, tokenStyle, type Accent } from '../src/dashboard-theme.ts';

const src = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
const block = /\/\* palette:start[\s\S]*?\*\/([\s\S]*?)\/\* palette:end \*\//.exec(src)![1]!;
const old = new Function(`${block}\nreturn {palette,ACCENTS};`)() as {
  palette: (t: string, m: string, a: string) => Record<string, string>;
  ACCENTS: Record<string, unknown>;
};

test('F-130-T01: every Theme · Mode · Accent gives the same tokens as dashboard.js', () => {
  assert.deepEqual(ACCENTS, old.ACCENTS);
  for (const theme of ['eva', 'simple'] as const)
    for (const mode of ['dark', 'light'] as const)
      for (const accent of Object.keys(ACCENTS) as Accent[])
        assert.deepEqual(
          palette({ theme, mode, accent }),
          old.palette(theme, mode, accent),
          `${theme}·${mode}·${accent}`,
        );
});

test('F-130-T01: plain is the default and EVA optional; a stored choice is checked part by part', () => {
  assert.equal(DEFAULT_THEME.theme, 'simple');
  assert.deepEqual(themeChoice(null), DEFAULT_THEME);
  assert.deepEqual(themeChoice({ theme: 'eva', mode: 'light', accent: 'violet' }), {
    theme: 'eva',
    mode: 'light',
    accent: 'violet',
  });
  assert.deepEqual(themeChoice({ theme: 'neon', mode: 'dim', accent: 'toString' }), DEFAULT_THEME);
  const tokens = tokenStyle(DEFAULT_THEME);
  assert.equal(tokens['--bg'], '#0b0c10');
  assert.ok(Object.keys(tokens).every((k) => k.startsWith('--')));
});
