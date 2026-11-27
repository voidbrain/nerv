// @ts-check
// B-182 (owner 2026-11-27, the dashboard installed as an iPhone app): (1) a pinch zoomed the page out to a narrow
// column, because something was wider than the screen; (2) focusing a field zoomed in (iOS zooms on a control whose
// text is under 16 px) and the page stayed zoomed. End to end in Chrome against the real service (makeServer) and the
// production build (run `npm run build` first), at iPhone widths, on the simple page `/`, the full dashboard `/full`
// in every Theme · Mode, and the old `/dashboard/` in dark and light: the document never scrolls sideways, no element
// pokes out of the screen unless a box of its own clips or scrolls it, and every visible form control is at least 16 px.
// Data holds long unbroken words, as real reminders and sorties do (links, paths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { browser } from './fixtures/browser.mjs';

const WIDTHS = [320, 375, 390, 430];
const LONG = 'neutral-reminder-https://example.invalid/a-long/unbroken/path/that/never/wraps/by-itself';

/** What would let a pinch zoom out on iOS, and every visible control under 16 px. */
const MEASURE = `(() => {
  const W = document.documentElement.clientWidth;
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
  // A box clips a descendant only if it contains it: an absolutely placed element (a screen-reader-only label) escapes
  // every box up to its positioned ancestor, and WebKit then counts it in the page width although Chrome does not.
  const clipped = (e) => {
    let free = ['absolute', 'fixed'].includes(getComputedStyle(e).position);
    for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.position !== 'static') free = false; // p contains everything below it
      if (!free && s.overflowX !== 'visible') return true;
      if (['absolute', 'fixed'].includes(s.position)) free = true;
    }
    return false;
  };
  const wide = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width && (r.right > W + 0.5 || r.left < -0.5) && !clipped(e)) wide.push(name(e) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  const small = [...document.querySelectorAll('input, select, textarea')]
    .filter((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 16)
    .map((e) => name(e) + ' ' + getComputedStyle(e).fontSize);
  return { scroll: document.documentElement.scrollWidth - W, wide: wide.slice(0, 5), small: small.slice(0, 5) };
})()`;
const FITS = { scroll: 0, wide: [], small: [] };

test(
  'B-182: at iPhone widths no page is wider than the screen and no field zooms on focus',
  { timeout: 300000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-b182-web-'));
    cpSync(resolve('dist/web/browser'), root, { recursive: true });
    // The stubs below stand in for the brain and the health sampler; their shapes are not the point here.
    const store = /** @type {any} */ (new Store(':memory:'));
    store.modelUsage = async (before, limit) => store.usage.page(before, limit);
    store.lilith = { list: async () => store.memory.list(), episodes: async () => store.memory.episodes() };
    // A service sample, as a running service has: its row has cells that do not apply, each a dash with a
    // screen-reader-only name.
    store.healthMetrics = async () => ({
      latestSample: { rssBytes: 600 * 1048576, heapUsedBytes: 120 * 1048576, eventLoopDelayMs: 12, pollCount: 9 },
      recentSamples: [],
      links: [],
      thresholds: null,
      warnings: [],
    });
    store.ledger.openSortie('owner', 'Neutral sortie ' + LONG, 'trusted');
    store.ledger.openSortie('owner', 'Neutral sortie two', 'trusted');
    const token = 'm'.repeat(32);
    const server = makeServer(store, token, { webRoot: root, language: 'en', timeZone: 'Europe/Rome' });
    await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
    const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
    const added = await fetch(origin + '/api/reminders', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ title: LONG, due: '2099-01-01T08:00:00.000Z' }),
    });
    assert.equal(added.status, 201);
    const code = async () =>
      (
        await (
          await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
        ).json()
      ).code;
    try {
      await browser(async ({ page, evaluate, until, errors }) => {
        /** @param {string} label */
        const fits = async (label) => {
          await new Promise((done) => setTimeout(done, 300));
          assert.deepEqual(await evaluate(MEASURE), FITS, label);
        };
        for (const width of WIDTHS) {
          await page('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: true });

          await page('Page.navigate', { url: 'about:blank' });
          await page('Page.navigate', { url: origin + '/' });
          await until(`!!document.querySelector('nerv-nodo .connect input')`, 30000);
          await fits(`/ signed out at ${width} px`);
          await page('Page.navigate', { url: 'about:blank' });
          await page('Page.navigate', { url: origin + '/#code=' + (await code()) });
          await until(`!!document.querySelector('nerv-nodo [data-reminder-id]')`, 30000);
          await fits(`/ at ${width} px`);
          await evaluate(`document.querySelector('nerv-nodo .edit-btn').click()`);
          await until(`!!document.querySelector('nerv-nodo .rem-edit input')`);
          await fits(`/ editing a reminder at ${width} px`);

          for (const theme of ['simple', 'eva'])
            for (const mode of ['dark', 'light']) {
              await page('Page.navigate', { url: 'about:blank' });
              await page('Page.navigate', { url: origin + '/full' });
              await evaluate(
                `localStorage.setItem('nerv.workspace.theme', JSON.stringify({ theme: '${theme}', mode: '${mode}', accent: 'orange' }))`,
              );
              // A fresh load: the workspace reads `#code=` only when it starts, never on a hash change.
              await page('Page.navigate', { url: 'about:blank' });
              await page('Page.navigate', { url: origin + '/full#code=' + (await code()) });
              await until(`document.querySelectorAll('nerv-dashboard [data-key]').length === 2`, 30000);
              await until(`document.querySelector('nerv-dashboard').dataset.theme === '${theme}'`);
              await fits(`/full ${theme} · ${mode} at ${width} px`);
            }

          for (const mode of ['dark', 'light']) {
            await page('Page.navigate', { url: 'about:blank' });
            await page('Page.navigate', { url: origin + '/dashboard/#code=' + (await code()) });
            await until(`document.querySelectorAll('#sortie-list .card').length === 2`, 30000);
            await evaluate(
              `(() => { const s = document.querySelector('#mode'); s.value = '${mode}'; s.dispatchEvent(new Event('change')); })()`,
            );
            await until(`document.body.classList.contains('mode-${mode}')`);
            await fits(`/dashboard/ ${mode} at ${width} px`);
          }
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
  },
);
