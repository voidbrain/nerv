// @ts-check
// The live index card end to end in Chrome (run `npm run build` first): a fake coordinator index (streamable HTTP MCP)
// read by the real tools process through read grants in config.json, served by makeServer at /api/live-index, shown
// by the built card on /full. The owner's turn with source links and what it unblocks, the snapshot's age, a project
// the index cannot read, both voices, Italian, axe, phone width, and the index stopped. Neutral invented data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { fingerprint } from '../src/mcp.ts';
import { ProcessClient } from '../src/process-client.ts';
import { readLiveIndex } from '../src/runtime-tools.ts';
import { browser } from './fixtures/browser.mjs';
import { AXE_SOURCE, axeRun } from './fixtures/axe.mjs';

const AXE = axeRun('nerv-live-index-card');
const NO_FINDINGS = { violations: [], undecided: [] };
const SELECT = { lang: 0, theme: 1, mode: 2 };
const READ_ONLY = { readOnlyHint: true, destructiveHint: false };
const REF = { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] };
const TOOLS = [
  { name: 'waiting_on_me', description: "The owner's turn.", inputSchema: { type: 'object' }, annotations: READ_ONLY },
  { name: 'blocked_by', description: 'Open items that name repo:ID.', inputSchema: REF, annotations: READ_ONLY },
];
const src = (repo) => ({
  repo,
  file: 'docs/BACKLOG.md',
  commit: 'abc',
  url: `https://github.com/example/${repo}/blob/abc/docs/BACKLOG.md`,
});
const SNAPSHOT = new Date(Date.now() - 12 * 60_000).toISOString();
const head = { version: 1, snapshot: SNAPSHOT, unknown: [{ repo: 'gamma', message: 'no BACKLOG.md' }] };
const answers = {
  waiting_on_me: {
    ...head,
    steps: [
      {
        kind: 'step',
        repo: 'alpha',
        id: 'F-001-T02',
        title: 'Choose the paint colour',
        ownerKind: 'decision',
        source: src('alpha'),
      },
      {
        kind: 'step',
        repo: 'beta',
        id: 'F-002-T03',
        title: 'Water the garden',
        ownerKind: 'procedure',
        source: src('beta'),
      },
    ],
  },
  blocked_by: {
    ...head,
    items: [{ kind: 'record', repo: 'beta', id: 'F-010', title: 'Paint the hall', source: src('beta') }],
  },
};

function fakeIndex() {
  const s = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const m = JSON.parse(raw);
      if (m.id === undefined) return res.writeHead(202).end();
      const json = (result) =>
        res.setHeader('content-type', 'application/json').end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
      if (m.method === 'initialize') return json({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
      if (m.method === 'tools/list') return json({ tools: TOOLS });
      const a =
        m.params.name === 'blocked_by' && m.params.arguments.ref !== 'alpha:F-001-T02'
          ? { ...head, items: [] }
          : answers[m.params.name];
      json({ content: [{ type: 'text', text: JSON.stringify(a) }], structuredContent: a });
    });
  });
  return new Promise((done) => s.listen(0, '127.0.0.1', () => done(s)));
}

async function choose(evaluate, index, value) {
  await evaluate(
    `(() => { const s = document.querySelectorAll('nerv-dashboard select')[${index}]; s.value = '${value}'; s.dispatchEvent(new Event('change')); })()`,
  );
  await new Promise((done) => setTimeout(done, 100));
}
/** What a row reads as laid out (separate grid cells keep a space between them). */
const shown = (sel) => `document.querySelector('nerv-live-index-card ${sel}')?.innerText.replace(/\\s+/g, ' ').trim()`;
const text = (sel) => `document.querySelector('nerv-live-index-card ${sel}')?.textContent.replace(/\\s+/g, ' ').trim()`;

test(
  "the live index card shows the owner's turn from the index, in both voices, and says when the index is gone",
  { timeout: 180000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-live-index-web-'));
    const home = mkdtempSync(join(tmpdir(), 'nerv-live-index-home-'));
    cpSync(resolve('dist/web/browser'), root, { recursive: true });
    const index = /** @type {import('node:http').Server} */ (await fakeIndex());
    const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (index.address()).port}/mcp`;
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        tools: {
          mcp: [{ id: 'coordinator', url }],
          grants: TOOLS.map((t) => ({
            server: 'coordinator',
            tool: t.name,
            effect: 'read',
            eva: '00',
            fingerprint: fingerprint(t),
          })),
        },
      }),
    );
    const tools = new ProcessClient(new URL('../src/tools-process.ts', import.meta.url), [home], 'tools', 30_000);
    const store = Object.assign(new Store(':memory:'), {
      liveIndex: () => readLiveIndex({ home, toolsProcess: () => tools }),
    });
    const token = 'l'.repeat(32);
    const server = makeServer(store, token, { webRoot: root, language: 'en', timeZone: 'Europe/Rome' });
    await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
    const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
    try {
      await browser(async ({ page, evaluate, until, errors }) => {
        const login = await (
          await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
        ).json();
        await page('Page.navigate', { url: origin + '/full#code=' + login.code });
        await until(`document.querySelectorAll('nerv-live-index-card [data-key]').length === 2`, 30000);
        await choose(evaluate, SELECT.theme, 'simple');

        // Plain voice: the owner's turn, what it unblocks, links to the source files, the age and the unreadable project.
        assert.equal(await evaluate(text('h2')), 'Work across projects');
        assert.equal(await evaluate(text('h3')), 'Your turn · 2');
        assert.match(
          await evaluate(text('[panel-meta]')),
          /^Snapshot age: 1[23] min · Open the index screen \(on this machine\) · Refresh$/,
        );
        assert.equal(
          await evaluate(`document.querySelector('nerv-live-index-card [panel-meta] a').href`),
          url.replace(/mcp$/, ''),
        );
        assert.equal(
          await evaluate(shown('[data-key="alpha:F-001-T02"]')),
          'Decide Choose the paint colour alpha Source · Choose the paint colour Unblocks: Paint the hall beta Source · Paint the hall',
        );
        assert.deepEqual(
          await evaluate(
            `[...document.querySelectorAll('nerv-live-index-card [data-key="alpha:F-001-T02"] a')].map(a => a.href)`,
          ),
          [
            'https://github.com/example/alpha/blob/abc/docs/BACKLOG.md',
            'https://github.com/example/beta/blob/abc/docs/BACKLOG.md',
          ],
        );
        assert.match(
          await evaluate(text('p.warn')),
          /^Projects not readable: their work is unknown, not none: gamma \(no BACKLOG\.md\)$/,
        );
        assert.doesNotMatch(await evaluate(text('')), /\b[FB]-\d+/, 'no backlog IDs in what the card says');

        // Eva voice, then Italian.
        await choose(evaluate, SELECT.theme, 'eva');
        assert.equal(await evaluate(text('h2')), 'Central Dogma · work index');
        assert.equal(await evaluate(text('h3')), 'Awaiting the Commander · 2');
        await evaluate(AXE_SOURCE);
        for (const theme of ['simple', 'eva'])
          for (const mode of ['dark', 'light']) {
            await choose(evaluate, SELECT.theme, theme);
            await choose(evaluate, SELECT.mode, mode);
            assert.deepEqual(await evaluate(AXE), NO_FINDINGS, `axe ${theme} · ${mode}`);
          }
        await choose(evaluate, SELECT.lang, 'it');
        assert.equal(await evaluate(text('h3')), 'In attesa del Comandante · 2');
        await choose(evaluate, SELECT.theme, 'simple');
        assert.equal(await evaluate(text('h2')), 'Lavoro tra i progetti');
        assert.equal(await evaluate(text('h3')), 'Tocca a te · 2');
        assert.match(
          await evaluate(shown('[data-key="alpha:F-001-T02"]')),
          /^Da decidere Choose the paint colour alpha Fonte/,
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

        // The index stops: Refresh says it is not running and shows no list, never "nothing waits".
        await new Promise((done) => {
          index.close(done);
          index.closeAllConnections();
        });
        await evaluate(`document.querySelector('nerv-live-index-card [panel-meta] button').click()`);
        await until(`document.querySelectorAll('nerv-live-index-card [data-key]').length === 0`, 30000);
        assert.match(
          await evaluate(shown('[role=status]')),
          /^Il servizio dell’indice non è in esecuzione .* sconosciuto, non assente\. .*unreachable/,
        );
        assert.equal(await evaluate(`!!document.querySelector('nerv-live-index-card .empty')`), false);
        assert.deepEqual(await evaluate(AXE), NO_FINDINGS, 'axe with the index gone');
        assert.deepEqual(errors, [], 'no page errors');
      });
    } finally {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      index.close();
      index.closeAllConnections();
      await tools.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  },
);
