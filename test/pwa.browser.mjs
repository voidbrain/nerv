// F-004-T01: the installable PWA shell, end to end in Chrome against the real service (makeServer) and the production
// build. Run `npm run build` first. Covers: the manifest is served, parsed and installable by Chrome's own criteria;
// the service worker controls the page and serves the shell with the service down; a new build shows a prompt and the
// page reloads only when the owner presses Reload ("Later" keeps the current version).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { browser } from './fixtures/browser.mjs';

const require = createRequire(import.meta.url);

/** Publish a "new build": change index.html and record its hash in ngsw.json, as `ng build` would. */
function publish(root, build) {
  const index = join(root, 'index.html');
  const html = readFileSync(index, 'utf8').replace(
    /(<meta name="nerv-test-build" content="\d+">)?<\/head>/,
    `<meta name="nerv-test-build" content="${build}"></head>`,
  );
  writeFileSync(index, html);
  const manifestPath = join(root, 'ngsw.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.hashTable['/index.html'] = createHash('sha1').update(html).digest('hex');
  manifest.timestamp = Date.now();
  writeFileSync(manifestPath, JSON.stringify(manifest));
}

test(
  'F-004-T01: installable manifest, offline shell and an update that waits for the owner',
  { timeout: 180000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-pwa-'));
    cpSync(resolve('dist/web/browser'), root, { recursive: true });
    const store = new Store(':memory:');
    const server = makeServer(store, 'p'.repeat(32), { webRoot: root, language: 'en', timeZone: 'Europe/Rome' });
    const listen = (port) => new Promise((done) => server.listen(port, '127.0.0.1', done));
    const stop = () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
    await listen(0);
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    try {
      await browser(async ({ page, evaluate, errors }) => {
        // Evaluations retry across a navigation (the old context disappears while the page reloads).
        const until = async (expression, ms = 30000) => {
          const end = Date.now() + ms;
          for (;;) {
            const ok = await evaluate(expression).catch(() => false);
            if (ok) return;
            assert.ok(Date.now() < end, 'Browser condition timed out: ' + expression);
            await new Promise((d) => setTimeout(d, 100));
          }
        };
        const audit = async (name) => {
          await evaluate(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
          const result = await evaluate(
            `axe.run().then(r=>({violations:r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),incomplete:r.incomplete.map(v=>v.id)}))`,
          );
          assert.deepEqual(result.violations, [], name);
          assert.ok(
            result.incomplete.every((id) => id === 'label-content-name-mismatch'),
            name + ': unexpected manual review required ' + result.incomplete.join(', '),
          );
          t.diagnostic(name + ': axe passed');
        };
        const prompt = `(document.querySelector('nerv-update-prompt [role=status]')?.textContent.trim())`;
        const build = `(document.querySelector('meta[name=nerv-test-build]')?.content ?? null)`;

        await page('Page.navigate', { url: origin });
        await until(`document.querySelector('h1')?.textContent.includes('Your world.')`);

        // Manifest: served with its media type, parsed without errors, and installable by Chrome's own criteria
        // (the checks Lighthouse's installability audit reported).
        const served = await evaluate(`fetch('manifest.webmanifest').then(r=>r.headers.get('content-type'))`);
        assert.equal(served, 'application/manifest+json');
        const manifest = await page('Page.getAppManifest');
        assert.deepEqual(manifest.errors, [], 'manifest parses without errors');
        assert.equal(JSON.parse(manifest.data).name, 'NERV Agency');
        for (const icon of JSON.parse(manifest.data).icons) {
          const ok = await evaluate(`fetch(${JSON.stringify(icon.src)}).then(r=>r.ok&&r.headers.get('content-type'))`);
          assert.equal(ok, 'image/png', icon.src);
        }

        // Service worker: registered by the production build, then in control of the page with the shell cached.
        await until(`navigator.serviceWorker.getRegistration().then(r=>!!r?.active)`);
        await page('Page.reload');
        await until(`!!navigator.serviceWorker.controller && !!document.querySelector('h1')`);
        await until(
          `fetch('ngsw/state').then(r=>r.text()).then(s=>/Driver state: NORMAL/.test(s)&&/Latest manifest hash: [0-9a-f]{40}/.test(s))`,
        );
        const installability = await page('Page.getInstallabilityErrors');
        assert.deepEqual(installability.installabilityErrors, [], 'Chrome reports the app installable');
        // The worker controls the whole origin but leaves the NERV dashboard to the network: it is not the Angular shell.
        await page('Page.navigate', { url: origin + '/dashboard/' });
        await until(`document.title === 'NERV Agency — Tactical Command' && !document.querySelector('nerv-app')`);
        await page('Page.navigate', { url: origin });
        await until(`!!navigator.serviceWorker.controller && !!document.querySelector('h1')`);

        assert.equal(
          await evaluate(`fetch('api/status').then(r=>r.status)`),
          401,
          'the API answers while the service runs',
        );
        // Offline shell: with the service down, a reload still shows the workspace from the worker's cache.
        await stop();
        await page('Page.reload');
        await until(`document.querySelector('h1')?.textContent.includes('Your world.')`);
        assert.equal(
          await evaluate(`getComputedStyle(document.querySelector('.shell')).display`),
          'grid',
          'cached stylesheet applies offline',
        );
        assert.equal(
          await evaluate(`fetch('api/status').then(r=>(r.status===401?'answered':'unreachable'),()=>'unreachable')`),
          'unreachable',
          'the API is never answered from a cache',
        );
        await listen(port);

        // A new build: the prompt appears, the page does not reload by itself.
        await evaluate(`window.nervSameDocument = true`);
        assert.equal(await evaluate(build), null);
        publish(root, 2);
        await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
        await until(`(${prompt} ?? '').includes('A new version of NERV Agency is ready')`);
        await new Promise((d) => setTimeout(d, 1500));
        assert.equal(await evaluate(`window.nervSameDocument === true`), true, 'no silent reload');
        assert.equal(await evaluate(build), null, 'the page stays on the version it opened with');
        await audit('update-prompt-english');

        // Italian copy, then "Later": the prompt goes away and the page is still the same document.
        await evaluate(
          `{const s=document.querySelector('header select');s.value='it';s.dispatchEvent(new Event('change',{bubbles:true}));}`,
        );
        await until(`(${prompt} ?? '').includes('È pronta una nuova versione')`);
        await audit('update-prompt-italian');
        await evaluate(
          `[...document.querySelectorAll('nerv-update-prompt button')].find(b=>b.textContent.trim()==='Più tardi').click()`,
        );
        await until(`${prompt} === '' && !document.querySelector('nerv-update-prompt button')`);
        assert.equal(await evaluate(`window.nervSameDocument === true`), true, '"Later" does not reload');

        // Another build: Reload is the only way the page changes, and it lands on the newest build.
        publish(root, 3);
        await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
        await until(`(${prompt} ?? '').length > 0`);
        assert.equal(await evaluate(`window.nervSameDocument === true`), true);
        await evaluate(
          `[...document.querySelectorAll('nerv-update-prompt button')].find(b=>b.textContent.trim()==='Ricarica').click()`,
        );
        await until(`window.nervSameDocument === undefined && ${build} === '3' && !!document.querySelector('h1')`);
        assert.equal(await evaluate(`${prompt}`), '', 'no prompt after the reload');
        assert.deepEqual(errors, [], 'no uncaught page errors');
      });
    } finally {
      if (server.listening) await stop();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
