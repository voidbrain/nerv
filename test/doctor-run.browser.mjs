// B-129 (owner 2026-11-24): Health → Run doctor logged a canned "all ok" line and never asked the service. End to end
// in Chrome against the real service (makeServer) and the production build (run `npm run build` first): Run doctor ->
// GET /api/doctor -> the answer shows next to the button and stays; with the service gone it says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { browser } from './fixtures/browser.mjs';

test(
  'B-129: Run doctor shows the service’s answer next to the button, and an unreachable service plainly',
  { timeout: 180000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-b129-web-'));
    cpSync(resolve('dist/web/browser'), root, { recursive: true });
    const store = new Store(':memory:');
    // The adapters the dashboard's poll reads, as test/angular.browser.mjs sets them.
    store.modelUsage = async (before, limit) => store.usage.page(before, limit);
    store.lilith = { list: async () => store.memory.list(), episodes: async () => store.memory.episodes() };
    let doctorCalls = 0;
    const doctor = store.doctor.bind(store);
    store.doctor = () => {
      doctorCalls++;
      return doctor();
    };
    const token = 'r'.repeat(32);
    const server = makeServer(store, token, { webRoot: root, language: 'en', timeZone: 'Europe/Rome' });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let open = true;
    try {
      await browser(async ({ page, evaluate, until, errors }) => {
        const login = await (
          await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
        ).json();
        await page('Page.navigate', { url: origin + '/dashboard/#code=' + login.code });
        await until(`document.querySelector('#health')?.textContent.includes('Central Dogma')`, 30000);
        assert.equal(await evaluate(`document.querySelector('#doctor-result').hidden`), true, 'nothing before a run');
        const before = doctorCalls;
        await evaluate(`document.querySelector('#btn-doctor').click()`);
        await until(`document.querySelector('#doctor-run')?.textContent.includes('Database: integrity ok')`, 15000);
        assert.ok(doctorCalls > before, 'the click asked the service');
        const text = await evaluate(`document.querySelector('#doctor-run').textContent`);
        assert.match(text, /Doctor · /);
        assert.match(text, /Revision /);
        assert.match(text, /schema \d+ · 0 pending reminders/);
        assert.doesNotMatch(text, /scheduler ok · brain ok/);
        // Next to the button: the block right under the Health header that holds it.
        assert.equal(
          await evaluate(
            `document.querySelector('#doctor-result').previousElementSibling.contains(document.querySelector('#btn-doctor'))`,
          ),
          true,
        );
        assert.equal(
          await evaluate(`/Doctor: .* details in Health\\./.test(document.getElementById('log').textContent)`),
          true,
          'Maya points to it in Comms',
        );
        // It stays across the next refresh of the Health panel.
        await new Promise((done) => setTimeout(done, 3500));
        assert.match(await evaluate(`document.querySelector('#doctor-run').textContent`), /Database: integrity ok/);

        await new Promise((done) => {
          server.close(done);
          server.closeAllConnections();
        });
        open = false;
        await evaluate(`document.querySelector('#btn-doctor').click()`);
        await until(
          `document.querySelector('#doctor-run')?.textContent.includes('Doctor could not reach the service')`,
          20000,
        );
        assert.deepEqual(errors, [], 'no page errors');
      });
    } finally {
      if (open)
        await new Promise((done) => {
          server.close(done);
          server.closeAllConnections();
        });
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
