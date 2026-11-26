// F-130-T01: the workspace dashboard shell end to end in Chrome against the real service (makeServer) and the
// production build (run `npm run build` first): a login code signs in on /full, the keyed rows keep their DOM nodes
// across an unchanged poll and update in place on a change (B-144), both layouts link to each other, every
// Theme · Mode passes axe, and the layout holds at phone width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { browser } from './fixtures/browser.mjs';
import { AXE_SOURCE, axeRun } from './fixtures/axe.mjs';

const axe = AXE_SOURCE;
/** B-154: violations and colour contrast axe could not decide, both empty. */
const AXE = axeRun('nerv-dashboard');
const NO_FINDINGS = { violations: [], undecided: [] };

/** The header selects, in order: language, theme, mode, colour. */
const SELECT = { lang: 0, theme: 1, mode: 2, accent: 3 };
async function choose(evaluate, index, value) {
  await evaluate(
    `(() => { const s = document.querySelectorAll('nerv-dashboard select')[${index}]; s.value = '${value}'; s.dispatchEvent(new Event('change')); })()`,
  );
  await new Promise((done) => setTimeout(done, 100));
}

test(
  'F-130-T01: the workspace dashboard shell signs in, keeps unchanged rows and passes axe',
  { timeout: 180000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-f130-web-'));
    cpSync(resolve('dist/web/browser'), root, { recursive: true });
    const store = new Store(':memory:');
    const first = store.ledger.openSortie('owner', 'Neutral sortie one', 'trusted');
    store.ledger.openSortie('owner', 'Neutral sortie two', 'trusted');
    const token = 'w'.repeat(32);
    const server = makeServer(store, token, { webRoot: root, language: 'en', timeZone: 'Europe/Rome' });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      await browser(async ({ page, evaluate, until, errors }) => {
        const login = await (
          await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
        ).json();
        // Not signed in: the sign-in box passes axe in the plain and the EVA theme, and speaks Italian when chosen.
        await page('Page.navigate', { url: origin + '/full' });
        await until(`!!document.querySelector('nerv-sign-in input#signin-value')`, 30000);
        await evaluate(axe);
        await choose(evaluate, SELECT.theme, 'simple');
        assert.deepEqual(await evaluate(AXE), NO_FINDINGS, 'axe sign-in · simple');
        await choose(evaluate, SELECT.theme, 'eva');
        assert.deepEqual(await evaluate(AXE), NO_FINDINGS, 'axe sign-in · eva');
        await choose(evaluate, SELECT.lang, 'it');
        await until(`document.querySelector('nerv-sign-in h2').textContent.trim() === 'Accedi'`);
        assert.equal(await evaluate(`document.documentElement.lang`), 'it');
        assert.deepEqual(await evaluate(AXE), NO_FINDINGS, 'axe sign-in · Italian');
        await choose(evaluate, SELECT.lang, 'en');
        await choose(evaluate, SELECT.theme, 'simple');

        await page('Page.navigate', { url: 'about:blank' });
        await page('Page.navigate', { url: origin + '/full#code=' + login.code });
        await until(`document.querySelectorAll('nerv-dashboard [data-key]').length === 2`, 30000);
        assert.equal(await evaluate('location.hash'), '', 'the login code left the address');
        assert.equal(await evaluate(`sessionStorage.length`), 0, 'the session stays in memory, as on the simple page');
        await until(`document.querySelector('nerv-dashboard [role=status]').textContent.trim() === 'Connected · live'`);

        // B-144: mark every row node, then change something the rows do not show (a new reminder). The stream says
        // refresh, the feed re-reads every page, the Reminders count moves, and no row node is replaced.
        await evaluate(`document.querySelectorAll('nerv-dashboard [data-key]').forEach(n => n.__mark = 1)`);
        const added = await fetch(origin + '/api/reminders', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Neutral reminder', due: '2099-01-01T08:00:00.000Z' }),
        });
        assert.equal(added.status, 201);
        await until(`document.querySelector('nerv-stat[aria-label=Reminders] strong')?.textContent === '1'`, 15000);
        assert.equal(
          await evaluate(`[...document.querySelectorAll('nerv-dashboard [data-key]')].every(n => n.__mark === 1)`),
          true,
          'an unchanged poll leaves every row in place',
        );
        store.ledger.close(first, 'done');
        await until(
          `document.querySelector('nerv-dashboard [data-key="${first}"] [data-state]')?.textContent === 'done'`,
          15000,
        );
        assert.equal(
          await evaluate(`document.querySelector('nerv-dashboard [data-key="${first}"]').__mark`),
          1,
          'a changed row is updated in place, not rebuilt',
        );

        await evaluate(axe);
        for (const theme of ['simple', 'eva'])
          for (const mode of ['dark', 'light']) {
            await choose(evaluate, SELECT.theme, theme);
            await choose(evaluate, SELECT.mode, mode);
            await until(`document.querySelector('nerv-dashboard').dataset.theme === '${theme}'`);
            assert.deepEqual(await evaluate(AXE), NO_FINDINGS, `axe ${theme} · ${mode}`);
          }
        // Every EVA colour, dark and light (the accent tints text and borders).
        for (const mode of ['dark', 'light'])
          for (const accent of ['orange', 'blue', 'green', 'violet', 'ochre']) {
            await choose(evaluate, SELECT.mode, mode);
            await choose(evaluate, SELECT.accent, accent);
            assert.deepEqual(await evaluate(AXE), NO_FINDINGS, `axe eva · ${mode} · ${accent}`);
          }

        // A hidden page pauses the feed; visible again, it reconnects.
        await evaluate(
          `Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))`,
        );
        await until(`document.querySelector('nerv-dashboard [role=status]').textContent.includes('paused')`);
        await evaluate(
          `Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'))`,
        );
        await until(`document.querySelector('nerv-dashboard [role=status]').textContent.trim() === 'Connected · live'`);
        assert.equal(
          await evaluate(`JSON.parse(localStorage.getItem('nerv.workspace.theme')).theme`),
          'eva',
          'choice kept',
        );

        await page('Emulation.setDeviceMetricsOverride', {
          width: 320,
          height: 800,
          deviceScaleFactor: 1,
          mobile: true,
        });
        await new Promise((done) => setTimeout(done, 200));
        assert.equal(
          await evaluate('document.documentElement.scrollWidth <= 320'),
          true,
          'no horizontal scroll at 320 px',
        );
        assert.deepEqual(await evaluate(AXE), NO_FINDINGS, 'axe at phone width');
        await page('Emulation.setDeviceMetricsOverride', {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false,
        });

        // The simple view and the full dashboard link to each other; the session carries over.
        await evaluate(`document.querySelector('nerv-dashboard nav a[href="/"]').click()`);
        await until(`!!document.querySelector('nerv-nodo header a[href="/full"]')`);
        await until(`!document.querySelector('nerv-nodo .connect')`, 15000);
        await evaluate(`document.querySelector('nerv-nodo a[href="/full"]').click()`);
        await until(`document.querySelectorAll('nerv-dashboard [data-key]').length === 2`, 15000);
        assert.deepEqual(errors, [], 'no page errors');
      });
    } finally {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('F-130-T01: the old dashboard header links to the workspace dashboard', () => {
  assert.match(
    readFileSync('web/public/dashboard/index.html', 'utf8'),
    /<a class="btn sm" id="go-workspace" href="\/full">/,
  );
});
