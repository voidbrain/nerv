// B-123 (owner 2026-11-24): after Update now the dashboard showed only "Manual update started · fd0f2a0" and never
// the updater's refusal. End to end in Chrome against the real service (makeServer) and the production build (run
// `npm run build` first): Update now -> the outside updater (a double) writes its result -> GET /api/update/status ->
// the Health row shows it beside the button, after a reload too, until the owner dismisses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { writeUpdaterResult } from '../src/updater-result.ts';
import { browser } from './fixtures/browser.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const OWNERSHIP = 'Service or runtime ownership is unknown or belongs elsewhere.';
const NOTHING_STOPPED = 'Nothing was stopped; NERV keeps running the current revision.';

test(
  'B-123: Update now shows the updater refusal in Health, across a reload, until dismissed',
  { timeout: 180000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-b123-web-'));
    const home = mkdtempSync(join(tmpdir(), 'nerv-b123-home-'));
    cpSync(resolve('dist/web/browser'), root, { recursive: true });
    const store = new Store(':memory:');
  // The adapters the dashboard's poll reads, as test/angular.browser.mjs sets them.
  store.modelUsage = async (before, limit) => store.usage.page(before, limit);
  store.lilith = { list: async () => store.memory.list(), episodes: async () => store.memory.episodes() };
    const token = 'u'.repeat(32);
    const handed = [];
    const server = makeServer(store, token, {
      webRoot: root,
      language: 'en',
      timeZone: 'Europe/Rome',
      updaterHome: home,
      updateCheck: async ({ channel }) => ({
        version: 1,
        channel,
        installedRevision: A,
        runningRevision: A,
        availableRevision: B,
        status: 'update-available',
        updateAvailable: true,
        restartRequired: false,
        checkedAt: new Date().toISOString(),
      }),
      // The outside updater: it refuses a few seconds after the hand-off and leaves its result, as B-108 does.
      startUpdater: async (input) => {
        handed.push(input.revision);
        setTimeout(
          () =>
            writeUpdaterResult(home, {
              outcome: 'refused',
              channel: 'main',
              revision: input.revision,
              reasons: [OWNERSHIP],
              recovery: [NOTHING_STOPPED],
            }),
          4000,
        );
      },
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      await browser(async ({ page, evaluate, until, errors }) => {
        const login = await (
          await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
        ).json();
        await page('Page.navigate', { url: origin + '/dashboard/#code=' + login.code });
        await until(`!!document.querySelector('#btn-apply-update')`, 30000);
        await evaluate(`document.querySelector('#btn-apply-update').click()`);
        await until(
          `document.querySelector('#update-status')?.textContent.includes('Update in progress · bbbbbbb')`,
          15000,
        );
        assert.equal(
          await evaluate(`document.querySelector('#btn-apply-update').disabled`),
          true,
          'busy while running',
        );
        await until(
          `document.querySelector('#update-status')?.textContent.includes('Update refused · bbbbbbb')`,
          30000,
        );
        const text = await evaluate(`document.querySelector('#update-status').textContent`);
        assert.ok(text.includes(OWNERSHIP), 'the reason is shown');
        assert.ok(text.includes(NOTHING_STOPPED), 'the recovery is shown');
        assert.doesNotMatch(text, /Manual update started/, 'not the hand-off alone');
        await until(`document.querySelector('#btn-apply-update')?.disabled === false`, 15000);
        assert.deepEqual(handed, [B]);
        // The status sits in the Health panel, next to the availability row that holds the button.
        assert.equal(
          await evaluate(
            `document.querySelector('#update-status').previousElementSibling?.contains(document.querySelector('#btn-apply-update'))`,
          ),
          true,
        );

        await page('Page.reload');
        await until(
          `document.querySelector('#update-status')?.textContent.includes('Update refused · bbbbbbb')`,
          30000,
        );

        await evaluate(`document.querySelector('#btn-dismiss-update-status').click()`);
        await until(`!document.querySelector('#update-status')`, 15000);
        await page('Page.reload');
        await until(`!!document.querySelector('#btn-apply-update')`, 30000);
        await new Promise((done) => setTimeout(done, 3500));
        assert.equal(await evaluate(`!!document.querySelector('#update-status')`), false, 'dismissed stays dismissed');
        assert.deepEqual(errors, [], 'no page errors');
      });
    } finally {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      store.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  },
);
