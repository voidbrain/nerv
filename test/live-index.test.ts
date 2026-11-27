// The coordinator's live index on NERV's dashboard, across the join: a fake index (streamable HTTP MCP, the contract's
// three read tools and one tool that writes) registered and granted with the CLI, read by the service through the
// tools process and the grants, and served at GET /api/live-index for the card. Neutral invented data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/server.ts';
import { liveIndexAgeMinutes, readLiveIndexAnswer, type LiveIndexView } from '../src/live-index.ts';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false };
const REF = { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] };
const TOOLS = [
  { name: 'record_lookup', description: 'A record or step by repo:ID.', inputSchema: REF, annotations: READ_ONLY },
  {
    name: 'waiting_on_me',
    description: "The owner's turn.",
    inputSchema: { type: 'object', properties: {} },
    annotations: READ_ONLY,
  },
  {
    name: 'blocked_by',
    description: 'Open items whose prerequisites name repo:ID.',
    inputSchema: REF,
    annotations: READ_ONLY,
  },
  {
    name: 'rebuild_now',
    description: 'Rebuilds the cache.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false },
  },
];
const SNAPSHOT = '2026-03-02T10:00:00.000Z';
const source = (repo: string, file: string) => ({
  repo,
  file,
  commit: 'abc123',
  url: `https://github.com/example/${repo}/blob/abc123/${file}`,
});
/** Forty owner steps with long titles: the text form is far past the 8000 characters a tool result's text keeps. */
const turn = Array.from({ length: 40 }, (_, i) => ({
  kind: 'step',
  repo: i === 0 ? 'alpha' : 'beta',
  id: `F-00${i}-T01`,
  parent: `F-00${i}`,
  title: i === 0 ? 'Choose the paint colour' : `Owner check number ${i} ${'with a long neutral title '.repeat(8)}`,
  status: 'Planned',
  ownerKind: i === 0 ? 'decision' : 'procedure',
  agentHours: 0,
  ownerHours: 0.25,
  dependsOn: [],
  prs: [],
  source:
    i === 1 ? { ...source('beta', 'docs/BACKLOG.md'), url: 'javascript:alert(1)' } : source('alpha', 'docs/BACKLOG.md'),
}));
const blocked = {
  kind: 'record',
  repo: 'beta',
  id: 'F-010',
  title: 'Paint the hall',
  status: 'Open',
  priority: 'P2',
  humanAction: 'No',
  next: '',
  archived: false,
  dependsOn: ['alpha:F-000-T01'],
  prs: [],
  source: source('beta', 'docs/BACKLOG.md'),
};

/** A stand-in live index: stateless streamable HTTP MCP at /mcp, answers as JSON with structuredContent. */
async function fakeIndex() {
  const state = { version: 1, calls: [] as { name: string; args: Record<string, unknown> }[] };
  const body = (req: IncomingMessage) =>
    new Promise<string>((done) => {
      let raw = '';
      req.on('data', (d) => (raw += d)).on('end', () => done(raw));
    });
  const s: Server = createServer((req, res) => {
    void (async () => {
      if (req.url !== '/mcp' || req.method !== 'POST') {
        res.statusCode = 404;
        return res.end();
      }
      const m = JSON.parse(await body(req)) as {
        id?: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      if (m.id === undefined) {
        res.statusCode = 202;
        return res.end();
      }
      const json = (result: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
      };
      if (m.method === 'initialize')
        return json({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'index' } });
      if (m.method === 'tools/list') return json({ tools: TOOLS });
      const name = m.params!.name!,
        args = m.params!.arguments ?? {};
      state.calls.push({ name, args });
      const head = {
        version: state.version,
        snapshot: SNAPSHOT,
        unknown: [{ repo: 'gamma', message: 'no BACKLOG.md' }],
      };
      const a =
        name === 'waiting_on_me'
          ? { ...head, steps: turn }
          : name === 'blocked_by'
            ? { ...head, ref: args.ref, items: args.ref === 'alpha:F-000-T01' ? [blocked] : [] }
            : { ...head, ref: args.ref, item: null, steps: [] };
      json({ content: [{ type: 'text', text: JSON.stringify(a) }], structuredContent: a });
    })();
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/mcp`,
    state,
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}

test('an answer is read only in the contract version it knows, with safe links only', () => {
  assert.throws(() => readLiveIndexAnswer({ version: 2, snapshot: SNAPSHOT, unknown: [] }), /version 2/);
  assert.throws(() => readLiveIndexAnswer('not an answer'), /not a live index answer/);
  const a = readLiveIndexAnswer({
    version: 1,
    snapshot: SNAPSHOT,
    unknown: [{ repo: 'gamma', message: 'gone' }],
    steps: turn,
  });
  assert.deepEqual(a.unknown, [{ repo: 'gamma', reason: 'gone' }]);
  assert.equal(a.items.length, 40);
  assert.equal(a.items[0]!.url, 'https://github.com/example/alpha/blob/abc123/docs/BACKLOG.md');
  assert.equal(a.items[1]!.url, null, 'a link that is not on GitHub is dropped');
  assert.equal(liveIndexAgeMinutes(SNAPSHOT, Date.parse(SNAPSHOT) + 7 * 60_000 + 30_000), 7);
  assert.equal(liveIndexAgeMinutes(null, Date.now()), null);
});

test(
  'across the join: set up with nerv tools, read through read grants, a writing tool refused, the index gone reported',
  { timeout: 90000 },
  async () => {
    const idx = await fakeIndex();
    const home = mkdtempSync(join(tmpdir(), 'nerv-live-index-'));
    const cli = (...a: string[]) =>
      new Promise<{ status: number; stdout: string; stderr: string }>((done) =>
        execFile(
          process.execPath,
          ['src/cli.ts', ...a],
          { env: { ...process.env, NERV_HOME: home, NERV_PORT: '9' }, encoding: 'utf8' },
          (e, stdout, stderr) => done({ status: e ? Number(e.code ?? 1) : 0, stdout, stderr }),
        ),
      );
    const { Runtime } = await import('../src/runtime.ts');
    let r: InstanceType<typeof Runtime> | undefined;
    const server = { close: () => {} } as { close(): void; port?: number };
    try {
      assert.equal((await cli('init')).status, 0);
      r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
      await r.ready();
      const token = 't'.repeat(32);
      const http = makeServer(r, token);
      await new Promise<void>((d) => http.listen(0, '127.0.0.1', d));
      server.close = () => http.close();
      const port = (http.address() as { port: number }).port;
      const card = async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/live-index`, {
          headers: { authorization: 'Bearer ' + token },
        });
        assert.equal(res.status, 200);
        return (await res.json()) as LiveIndexView;
      };

      // Nothing registered: the card says how to set it up, and nothing reaches the index.
      assert.deepEqual(await card(), {
        state: 'not-set-up',
        commands: [
          'nerv tools add coordinator http://127.0.0.1:7380/mcp',
          'nerv tools grant coordinator/waiting_on_me',
          'nerv tools grant coordinator/blocked_by',
        ],
      });
      assert.equal(idx.state.calls.length, 0);

      // Registered and one read granted: only the missing grant is asked for.
      assert.equal((await cli('tools', 'add', 'coordinator', idx.url)).status, 0);
      assert.equal((await cli('tools', 'grant', 'coordinator/waiting_on_me')).status, 0);
      assert.deepEqual(await card(), { state: 'not-set-up', commands: ['nerv tools grant coordinator/blocked_by'] });
      // A tool that writes cannot be granted as a read.
      assert.match((await cli('tools', 'grant', 'coordinator/rebuild_now')).stderr, /cannot be granted as a read/);
      // A read tool granted as anything but a read is not used by the card.
      assert.equal((await cli('tools', 'grant', 'coordinator/blocked_by', '--effect', 'write-external')).status, 0);
      const wrong = await card();
      assert.equal(wrong.state, 'failed');
      assert.match(wrong.state === 'failed' ? wrong.reason : '', /blocked_by is granted as write-external/);
      assert.equal(idx.state.calls.length, 0, 'nothing is called through a grant that is not a read');
      assert.equal((await cli('tools', 'revoke', 'coordinator/blocked_by')).status, 0);
      assert.equal((await cli('tools', 'grant', 'coordinator/blocked_by')).status, 0);
      assert.equal((await cli('tools', 'grant', 'coordinator/record_lookup')).status, 0);

      // Ready: every owner step, read from the structured answer (its text is far past 8000 characters).
      const ready = await card();
      assert.equal(ready.state, 'ready', JSON.stringify(ready));
      if (ready.state !== 'ready') return;
      assert.equal(ready.snapshot, SNAPSHOT);
      assert.equal(ready.screen, idx.url.replace(/mcp$/, ''));
      assert.deepEqual(ready.unknown, [{ repo: 'gamma', reason: 'no BACKLOG.md' }]);
      assert.equal(ready.turn.length, 40);
      assert.deepEqual(ready.turn[0], {
        key: 'alpha:F-000-T01',
        repo: 'alpha',
        title: 'Choose the paint colour',
        ownerKind: 'decision',
        url: 'https://github.com/example/alpha/blob/abc123/docs/BACKLOG.md',
        blocks: [
          {
            key: 'beta:F-010',
            repo: 'beta',
            title: 'Paint the hall',
            url: 'https://github.com/example/beta/blob/abc123/docs/BACKLOG.md',
          },
        ],
      });
      assert.deepEqual(ready.turn[1]!.blocks, []);
      assert.ok(
        idx.state.calls.some((c) => c.name === 'blocked_by' && c.args.ref === 'alpha:F-000-T01'),
        'blocked_by is asked for each owner step',
      );

      // A contract version this NERV does not know is refused, never shown half-read.
      idx.state.version = 2;
      const refused = await card();
      assert.equal(refused.state, 'failed');
      assert.match(refused.state === 'failed' ? refused.reason : '', /version 2/);
      idx.state.version = 1;

      // The index stops: the card says it is not running, never that nothing waits.
      await idx.close();
      const gone = await card();
      assert.equal(gone.state, 'offline');
      if (gone.state === 'offline') {
        assert.equal(gone.screen, idx.url.replace(/mcp$/, ''));
        assert.match(gone.reason, /unreachable/);
      }
    } finally {
      server.close();
      await r?.close();
      await idx.close().catch(() => undefined);
      rmSync(home, { recursive: true, force: true });
    }
  },
);
