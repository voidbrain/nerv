// F-152 (owner 2026-11-26): the Health diagnostics are a table (service sample and one row per peer link). End to end
// in Chrome against the real service (makeServer) and the production build (run `npm run build` first): at 360 px the
// page does not scroll sideways and axe finds nothing in the table. F-152-T08 (owner, 2026-11-27, changed requirement):
// on a phone the table no longer scrolls sideways in its box; at 360, 375 and 390 px each row is a card of
// "column: value" lines that fits the box, and a wide screen keeps the table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { browser } from './fixtures/browser.mjs';
import { AXE_SOURCE, axeRun, textContrast } from './fixtures/axe.mjs';

test('F-152: the diagnostics table is readable at 360 px without page scroll', { timeout: 180000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'nerv-f152-web-'));
  cpSync(resolve('dist/web/browser'), root, { recursive: true });
  const store = new Store(':memory:');
  store.modelUsage = async (before, limit) => store.usage.page(before, limit);
  store.lilith = { list: async () => store.memory.list(), episodes: async () => store.memory.episodes() };
  const link = (/** @type {string} */ peerId) => ({
    peerId,
    bytesSent: 3 * 1048576,
    bytesReceived: 52000,
    lastLatencyMs: 38,
    inFlight: 1,
    reconnects: 2,
  });
  store.healthMetrics = async () => ({
    latestSample: { rssBytes: 600 * 1048576, heapUsedBytes: 120 * 1048576, eventLoopDelayMs: 12, pollCount: 9 },
    recentSamples: [],
    links: [link('NERV-02'), link('NERV-03-LONG-NAME')],
    thresholds: null,
    warnings: [{ key: 'link:NERV-02:reconnects', message: 'Link NERV-02 reconnected twice.' }],
  });
  const token = 'f'.repeat(32);
  const server = makeServer(store, token, { webRoot: root, language: 'en', timeZone: 'Europe/Rome' });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  try {
    await browser(async ({ page, evaluate, until, errors }) => {
      const login = await (
        await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
      ).json();
      await page('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
      await page('Page.navigate', { url: origin + '/dashboard/#code=' + login.code });
      await until(`document.querySelectorAll('#health .diag tr[data-link-peer]').length === 2`, 30000);
      assert.equal(await evaluate(`document.querySelectorAll('#health .diag thead th[scope=col]').length`), 7);
      assert.equal(
        await evaluate('document.documentElement.scrollWidth <= innerWidth'),
        true,
        'no page scroll at 360 px',
      );
      assert.equal(
        await evaluate(
          `(() => { const w = document.querySelector('#health .diag-wrap'); return w.getBoundingClientRect().right <= innerWidth; })()`,
        ),
        true,
        'the table box stays inside the screen',
      );
      const cards = `(() => {
        const w = document.querySelector('#health .diag-wrap');
        const row = document.querySelector("#health .diag tr[data-link-peer='NERV-02']");
        const cell = row.querySelector('td:nth-of-type(2)');
        return { fits: w.scrollWidth <= w.clientWidth, row: getComputedStyle(row).display, label: getComputedStyle(cell, '::before').content };
      })()`;
      for (const width of [360, 375, 390]) {
        await page('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
        await new Promise((done) => setTimeout(done, 200));
        assert.deepEqual(
          await evaluate(cards),
          { fits: true, row: 'block', label: '"Sent: "' },
          `one card per row, nothing to scroll, at ${width} px`,
        );
      }
      await evaluate(AXE_SOURCE);
      // axe leaves one-character cells ("1", "—") undecided; textContrast measures every text in the table instead.
      assert.deepEqual(
        await evaluate(axeRun('#health .diag-wrap', { '#health .diag': 'measured by textContrast below' })),
        { violations: [], undecided: [] },
        'axe',
      );
      assert.deepEqual(await evaluate(textContrast('#health .diag')), [], 'table text contrast');
      await page('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((done) => setTimeout(done, 200));
      assert.equal(
        await evaluate(
          `getComputedStyle(document.querySelector("#health .diag tr[data-link-peer='NERV-02']")).display`,
        ),
        'table-row',
        'a wide screen keeps the table',
      );
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
});
