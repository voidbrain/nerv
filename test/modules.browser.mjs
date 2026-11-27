// @ts-check
// F-159-T03: the Modules panel end to end in Chrome (run `npm run build` first). A stand-in plant hub (grover) and a
// stand-in live index (coordinator), both streamable-HTTP MCP servers on loopback, granted in config.json and read by
// the real tools process through the Runtime that serves the dashboard. Switching a module in the Modules panel writes
// config.json, changes what Misato is offered, hides the module's cards and stops their calls; on restores it with no
// new grant. Both voices, Italian, axe, phone width. Neutral invented data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeServer } from '../src/server.ts';
import { fingerprint } from '../src/mcp.ts';
import { Runtime } from '../src/runtime.ts';
import { browser } from './fixtures/browser.mjs';
import { AXE_SOURCE, axeRun } from './fixtures/axe.mjs';

const AXE = axeRun('nerv-modules-panel');
const NO_FINDINGS = { violations: [], undecided: [] };
const SELECT = { lang: 0, theme: 1, mode: 2 };
const READ_ONLY = { readOnlyHint: true, destructiveHint: false };
const HUB = [
  { name: 'hub_overview', description: 'Plants and probes.', inputSchema: { type: 'object' }, annotations: READ_ONLY },
];
const INDEX = [
  { name: 'waiting_on_me', description: "The owner's turn.", inputSchema: { type: 'object' }, annotations: READ_ONLY },
  {
    name: 'blocked_by',
    description: 'Open items that name repo:ID.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
    annotations: READ_ONLY,
  },
];
const EMPTY = { version: 1, snapshot: new Date().toISOString(), unknown: [], steps: [], items: [] };

/** A stand-in MCP server; it counts every request it receives. */
function fake(tools) {
  const seen = { requests: 0 };
  const s = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      seen.requests++;
      const m = JSON.parse(raw);
      if (m.id === undefined) return res.writeHead(202).end();
      const json = (result) =>
        res.setHeader('content-type', 'application/json').end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
      if (m.method === 'initialize') return json({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
      if (m.method === 'tools/list') return json({ tools });
      json({ content: [{ type: 'text', text: JSON.stringify(EMPTY) }], structuredContent: EMPTY });
    });
  });
  return new Promise((done) =>
    s.listen(0, '127.0.0.1', () =>
      done({
        server: s,
        seen,
        url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (s.address()).port}/mcp`,
      }),
    ),
  );
}
const grants = (server, tools) =>
  tools.map((t) => ({ server, tool: t.name, effect: 'read', eva: '00', fingerprint: fingerprint(t) }));

async function choose(evaluate, index, value) {
  await evaluate(
    `(() => { const s = document.querySelectorAll('nerv-dashboard select')[${index}]; s.value = '${value}'; s.dispatchEvent(new Event('change')); })()`,
  );
  await new Promise((done) => setTimeout(done, 100));
}
const row = (id) =>
  `document.querySelector('nerv-modules-panel [data-key="${id}"]')?.innerText.replace(/\\s+/g, ' ').trim()`;
const flip = (id) => `document.querySelector('nerv-modules-panel [data-key="${id}"] input').click()`;
const checked = (id) => `document.querySelector('nerv-modules-panel [data-key="${id}"] input')?.checked`;

test(
  'the Modules panel switches a module: config, offered tools, cards and calls follow; on needs no new grant',
  { timeout: 180000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-modules-web-'));
    const home = mkdtempSync(join(tmpdir(), 'nerv-modules-home-'));
    cpSync(resolve('dist/web/browser'), root, { recursive: true });
    const hub = /** @type {any} */ (await fake(HUB));
    const index = /** @type {any} */ (await fake(INDEX));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        tools: {
          mcp: [
            { id: 'coordinator', url: index.url },
            { id: 'grover', url: hub.url },
          ],
          grants: [...grants('coordinator', INDEX), ...grants('grover', HUB)],
        },
      }),
    );
    const granted = readFileSync(join(home, 'config.json'), 'utf8');
    const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    await runtime.ready();
    const offered = async () => (await runtime.externalTools()).docs.map((d) => d.name).sort();
    const token = 'k'.repeat(32);
    const server = makeServer(runtime, token, { webRoot: root, language: 'en', timeZone: 'Europe/Rome' });
    await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
    const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
    try {
      assert.deepEqual(await offered(), ['coordinator.blocked_by', 'coordinator.waiting_on_me', 'grover.hub_overview']);
      await browser(async ({ page, evaluate, until, errors }) => {
        const login = await (
          await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
        ).json();
        await page('Page.navigate', { url: origin + '/full#code=' + login.code });
        await until(`document.querySelectorAll('nerv-modules-panel [data-key]').length === 4`, 30000);
        await until(`!!document.querySelector('nerv-live-index-card h3')`, 30000);
        await choose(evaluate, SELECT.theme, 'simple');

        // Plain voice: one row per module, FPV under FPVBuddy, each on, reachable, with its tools.
        assert.equal(await evaluate(`document.querySelector('nerv-modules-panel h2').textContent.trim()`), 'Modules');
        assert.match(await evaluate(row('fpvbuddy')), /^FPVBuddy On Reachable Tools: \d+$/);
        assert.match(await evaluate(row('cooking')), /^Cooking On Reachable Tools: \d+$/);
        assert.equal(await evaluate(row('coordinator')), 'Work across projects On Reachable Tools: 2');
        assert.equal(await evaluate(row('grover')), 'Grover On Reachable Tools: 1');
        assert.doesNotMatch(
          await evaluate(`document.querySelector('nerv-modules-panel').textContent`),
          /\b[FB]-\d+/,
          'no backlog IDs in what the panel says',
        );

        // Grover off: config keeps the grants, Misato is offered no Grover tool, the hub is not asked.
        await evaluate(flip('grover'));
        await until(`${checked('grover')} === false`, 10000);
        assert.equal(await evaluate(row('grover')), 'Grover Off Not asked while off Tools: 1');
        const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
        assert.equal(config.tools.mcp.find((s) => s.id === 'grover').off, true);
        assert.deepEqual(config.tools.grants, JSON.parse(granted).tools.grants, 'grants kept');
        const hubBefore = hub.seen.requests;
        assert.deepEqual(await offered(), ['coordinator.blocked_by', 'coordinator.waiting_on_me']);
        assert.equal(hub.seen.requests, hubBefore, 'no request reached the hub');

        // The live index off: its card goes, and with it the polling; the index is not asked again.
        await evaluate(flip('coordinator'));
        await until(`!document.querySelector('nerv-live-index-card')`, 10000);
        const indexBefore = index.seen.requests;
        await new Promise((done) => setTimeout(done, 1500));
        assert.equal(index.seen.requests, indexBefore, 'nothing asked the index while off');
        assert.deepEqual(await offered(), []);

        // Eva voice, both modes, axe; Italian; phone width.
        await choose(evaluate, SELECT.theme, 'eva');
        assert.equal(
          await evaluate(`document.querySelector('nerv-modules-panel h2').textContent.trim()`),
          'Umbilical cables · modules',
        );
        assert.equal(await evaluate(row('grover')), 'Grover Ejected Not asked while off Tools: 1');
        await evaluate(AXE_SOURCE);
        for (const theme of ['simple', 'eva'])
          for (const mode of ['dark', 'light']) {
            await choose(evaluate, SELECT.theme, theme);
            await choose(evaluate, SELECT.mode, mode);
            assert.deepEqual(await evaluate(AXE), NO_FINDINGS, `axe ${theme} · ${mode}`);
          }
        await choose(evaluate, SELECT.lang, 'it');
        await choose(evaluate, SELECT.theme, 'simple');
        assert.equal(await evaluate(row('grover')), 'Grover Spento Non interpellato da spento Strumenti: 1');
        assert.match(await evaluate(row('cooking')), /^Cucina Acceso Raggiungibile Strumenti: \d+$/);
        await page('Emulation.setDeviceMetricsOverride', {
          width: 320,
          height: 800,
          deviceScaleFactor: 1,
          mobile: true,
        });
        await new Promise((done) => setTimeout(done, 200));
        assert.equal(await evaluate('document.documentElement.scrollWidth <= 320'), true, 'no horizontal scroll');
        assert.deepEqual(await evaluate(AXE), NO_FINDINGS, 'axe at phone width');

        // On again: offered as granted, no new grant; the live index card comes back.
        await evaluate(flip('grover'));
        await evaluate(flip('coordinator'));
        await until(`!!document.querySelector('nerv-live-index-card')`, 10000);
        assert.equal(await evaluate(checked('grover')), true);
        assert.deepEqual(await offered(), [
          'coordinator.blocked_by',
          'coordinator.waiting_on_me',
          'grover.hub_overview',
        ]);
        assert.equal(readFileSync(join(home, 'config.json'), 'utf8').includes('"off"'), false);
        assert.deepEqual(
          JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).tools.grants,
          JSON.parse(granted).tools.grants,
        );

        // FPVBuddy off: the battery cards on the simple page hide; on brings them back.
        await evaluate(flip('fpvbuddy'));
        await until(`${checked('fpvbuddy')} === false`, 10000);
        assert.deepEqual(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).packs, { fpv: false });
        const again = await (
          await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
        ).json();
        await page('Page.navigate', { url: origin + '/#code=' + again.code });
        await until(`!!document.querySelector('nerv-nodo nerv-surface-renderer')`, 30000);
        await new Promise((done) => setTimeout(done, 1000));
        assert.equal(await evaluate(`!!document.querySelector('nerv-battery-cards')`), false, 'cards hidden while off');
        await fetch(origin + '/api/modules/fpvbuddy', {
          method: 'PUT',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ on: true }),
        });
        await evaluate(`document.querySelector('nerv-nodo .refresh-btn').click()`);
        await until(`!!document.querySelector('nerv-battery-cards')`, 10000);
        assert.deepEqual(errors, [], 'no page errors');
      });
    } finally {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      for (const f of [hub, index]) {
        f.server.close();
        f.server.closeAllConnections();
      }
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  },
);
