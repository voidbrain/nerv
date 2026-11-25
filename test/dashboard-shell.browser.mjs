// F-130-T01: the workspace dashboard shell end to end in Chrome against the real service (makeServer) and the
// production build (run `npm run build` first): a login code signs in on /full, the keyed rows keep their DOM nodes
// across an unchanged poll and update in place on a change (B-144), both layouts link to each other, every
// Theme · Mode passes axe, and the layout holds at phone width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { browser } from './fixtures/browser.mjs';

const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE = `axe.run(document.querySelector('nerv-dashboard')).then(r=>r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target),why:v.nodes.map(n=>n.any.map(a=>a.message).join(' '))})))`;

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
        await page('Page.navigate', { url: origin + '/full#code=' + login.code });
        await until(`document.querySelectorAll('nerv-dashboard [data-key]').length === 2`, 30000);
        assert.equal(await evaluate('location.hash'), '', 'the login code left the address');
        assert.equal(await evaluate(`sessionStorage.getItem('nerv.workspace.session') !== null`), true, 'session kept');
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
            await evaluate(
              `(() => { const s = document.querySelector('select'); s.value = '${theme}'; s.dispatchEvent(new Event('change')); const m = document.querySelectorAll('select')[1]; m.value = '${mode}'; m.dispatchEvent(new Event('change')); })()`,
            );
            await until(`document.querySelector('nerv-dashboard').dataset.theme === '${theme}'`);
            await new Promise((done) => setTimeout(done, 100));
            assert.deepEqual(await evaluate(AXE), [], `axe ${theme} · ${mode}`);
          }
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
        assert.deepEqual(await evaluate(AXE), [], 'axe at phone width');
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
