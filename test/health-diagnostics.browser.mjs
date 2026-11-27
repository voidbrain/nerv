// F-152 (owner 2026-11-26): the Health diagnostics compare the service sample and each peer link. F-152-T08 (owner,
// 2026-11-27, changed requirement): the table scrolled sideways on the phone and on the Mac, so they are cards at every
// width, one per row with a heading and "label: value" pairs. End to end in Chrome against the real service
// (makeServer) and the production build (run `npm run build` first): at 360, 375, 390 and 1440 px there are three cards,
// each inside the box, nothing scrolls sideways, and axe finds nothing in the cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { browser } from './fixtures/browser.mjs';
import { AXE_SOURCE, axeRun, textContrast } from './fixtures/axe.mjs';

test('F-152-T08: the diagnostics are cards that fit the box at every width', { timeout: 180000 }, async () => {
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
      await page('Page.navigate', { url: origin + '/dashboard/#code=' + login.code });
      await until(`document.querySelectorAll('#health .diag section[data-link-peer]').length === 2`, 30000);
      await evaluate(AXE_SOURCE);
      const fit = `(() => {
        const box = document.querySelector('#health .diag');
        const r = box.getBoundingClientRect();
        const cards = [...box.querySelectorAll('section.diag-card')];
        return {
          page: document.documentElement.scrollWidth <= innerWidth,
          box: box.scrollWidth <= box.clientWidth && r.right <= innerWidth,
          cards: cards.length,
          columns: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))).size,
          lines: cards.some((c) => [...c.querySelectorAll('dl > div')].some((d) => parseFloat(getComputedStyle(d).borderTopWidth) > 0)),
          pad: cards.every((c) => { const s = getComputedStyle(c); return parseFloat(s.paddingTop) <= 4 && parseFloat(s.paddingLeft) <= 6; }),
          tight: cards.every((c) => { const rows = [...c.querySelectorAll('dl > div')].map((d) => d.getBoundingClientRect()); return rows.every((b, i) => i === 0 || b.top - rows[i - 1].bottom <= 0.5); }),
          inside: cards.every((c) => { const b = c.getBoundingClientRect(); return b.left >= r.left - 0.5 && b.right <= r.right + 0.5; }),
        };
      })()`;
      for (const [width, mobile] of [
        [360, true],
        [375, true],
        [390, true],
        [1440, false],
      ]) {
        await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
        await new Promise((done) => setTimeout(done, 200));
        assert.deepEqual(
          await evaluate(fit),
          { page: true, box: true, cards: 3, columns: width >= 720 ? 2 : 1, lines: false, pad: true, tight: true, inside: true },
          `cards fit, two per row on a wide screen and one on a phone, compact and without row lines, at ${width} px`,
        );
        assert.deepEqual(
          await evaluate(axeRun('#health .diag', { '#health .diag': 'measured by textContrast below' })),
          { violations: [], undecided: [] },
          `axe at ${width} px`,
        );
        assert.deepEqual(await evaluate(textContrast('#health .diag')), [], `card text contrast at ${width} px`);
      }
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
