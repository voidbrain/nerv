// F-021-T05: the tools this base can use, with versions and grants, as the dashboard's Tools panel shows them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { builtinToolDescriptors } from '../src/executors.ts';
import type { ExternalTools } from '../src/runtime-api.ts';
import { toolListing } from '../src/tool-listing.ts';

const external: ExternalTools = {
  docs: [
    {
      name: 'notes.read_note',
      effect: 'read',
      about: 'Reads a note by name.',
      args: '{}',
      version: 'abc123def4567890',
      source: 'mcp:notes',
    },
  ],
  byName: new Map([['notes.read_note', { server: 'notes', tool: 'read_note', fingerprint: 'abc123', eva: '00' }]]),
  suspended: [{ name: 'notes.delete_note', why: 'its description changed since it was granted: grant it again' }],
};

test('F-021-T05: NERV’s own tools and the granted MCP tools, with versions; suspended grants say why', () => {
  const own = toolListing();
  assert.equal(own.tools.length, builtinToolDescriptors.length);
  assert.ok(own.tools.every((t) => t.grant === 'built-in' && t.source === 'nerv' && t.version));
  assert.deepEqual(own.suspended, []);
  const all = toolListing(external);
  assert.deepEqual(
    all.tools.find((t) => t.name === 'notes.read_note'),
    {
      name: 'notes.read_note',
      source: 'mcp:notes',
      effect: 'read',
      version: 'abc123def4567890',
      grant: 'granted',
      eva: '00',
    },
  );
  assert.deepEqual(all.suspended, external.suspended);
  assert.deepEqual(
    all.tools.map((t) => t.name),
    [...all.tools.map((t) => t.name)].sort((a, b) => a.localeCompare(b)),
  );
});

test('F-021-T05: GET /api/tools through the server; without a runtime it lists NERV’s own tools', async () => {
  const { makeServer } = await import('../src/server.ts');
  for (const [store, granted] of [
    [{ externalTools: async () => external }, true],
    [{}, false],
    [{ externalTools: async () => Promise.reject(new Error('tools process down')) }, false],
  ] as const) {
    const server = makeServer(store as never, 'tool-listing-token-fixture-0000');
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/tools`, {
        headers: { authorization: 'Bearer tool-listing-token-fixture-0000' },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { tools: { name: string }[]; suspended: unknown[] };
      assert.equal(
        body.tools.some((t) => t.name === 'notes.read_note'),
        granted,
      );
      assert.ok(body.tools.some((t) => t.name === 'reminders.add'));
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  }
});

test('F-021-T05: the Tools panel shows granted tools first, suspended ones with why, NERV’s own collapsed; all escaped', () => {
  const source = readFileSync('web/public/dashboard/live.js', 'utf8');
  const start = source.indexOf('  /** F-021-T05: the Tools panel');
  const end = source.indexOf('  // end F-021-T05 toolsHtml');
  assert.ok(start > 0 && end > start);
  const esc = (s: unknown) =>
    String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#39;');
  const toolsHtml = new Function('esc', source.slice(start, end) + ';return toolsHtml;')(esc) as (d: unknown) => string;
  const html = toolsHtml(toolListing(external));
  assert.ok(html.indexOf('notes.read_note') < html.indexOf('<details>'), 'granted tools come before NERV’s own');
  assert.match(html, /granted · mcp:notes · EVA-00/);
  assert.match(html, /notes\.delete_note.*suspended.*grant it again/s);
  assert.match(html, new RegExp(`NERV's own tools \\(${builtinToolDescriptors.length}\\)`));
  assert.match(toolsHtml(toolListing()), /No MCP tools granted on this base/);
  assert.ok(
    toolsHtml({
      tools: [{ name: '<b>x</b>', source: 'mcp:s', effect: 'read', version: '1', grant: 'granted' }],
    }).includes('&lt;b&gt;x&lt;/b&gt;'),
  );
  assert.match(toolsHtml({ error: 'down' }), /danger/);
});
