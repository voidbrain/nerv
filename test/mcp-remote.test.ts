// F-123: an MCP server at a URL (a hub on the tailnet), across the join: a fake streamable-HTTP MCP server in the test,
// registered with the CLI, listed, a read run as Green, a hardware action through the gate and the owner's card, and
// the server gone reported, not hidden. Neutral invented data: no real host or tailnet names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpHttpClient, grantRefusal, httpFailure, urlRefusal, validateTools } from '../src/mcp.ts';
import { toolListing } from '../src/tool-listing.ts';
import { Store } from '../src/store.ts';
import type { ChatReply } from '../src/runtime-api.ts';

const TOOLS = [
  {
    name: 'hub_overview',
    description: 'Rooms and the latest reading of every probe.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'hub_run_pump',
    description: 'CHANGES HARDWARE STATE. Runs a pump for a bounded time.',
    inputSchema: {
      type: 'object',
      properties: { pumpId: { type: 'string' }, durationMs: { type: 'number' } },
      required: ['pumpId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

/** A stand-in hub: streamable HTTP MCP at /mcp, a session id after initialize, the pump's answer as an SSE stream. */
async function fakeHub() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const sessions: (string | undefined)[] = [];
  const body = (req: IncomingMessage) =>
    new Promise<string>((done) => {
      let raw = '';
      req.on('data', (d) => (raw += d)).on('end', () => done(raw));
    });
  const s: Server = createServer((req, res) => {
    void (async () => {
      if (req.url !== '/mcp' || req.method !== 'POST') {
        res.statusCode = 404;
        return res.end('not found');
      }
      const m = JSON.parse(await body(req)) as {
        id?: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      if (m.method !== 'initialize') sessions.push(req.headers['mcp-session-id'] as string | undefined);
      if (m.id === undefined) {
        res.statusCode = 202;
        return res.end();
      }
      const json = (result: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
      };
      if (m.method === 'initialize') {
        res.setHeader('mcp-session-id', 'session-1');
        return json({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'hub' } });
      }
      if (m.method === 'tools/list') return json({ tools: TOOLS });
      if (m.method === 'tools/call') {
        calls.push({ name: m.params!.name!, args: m.params!.arguments ?? {} });
        if (m.params!.name === 'hub_overview')
          return json({ content: [{ type: 'text', text: 'Room tent: EC 1.4, pH 6.0.' }] });
        const event = {
          jsonrpc: '2.0',
          id: m.id,
          result: { content: [{ type: 'text', text: `Pump ${String(m.params!.arguments?.pumpId)} ran.` }] },
        };
        res.setHeader('content-type', 'text/event-stream');
        return res.end(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
      }
      json({});
    })();
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/mcp`,
    calls,
    sessions,
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}

/** A fake local model: Misato follows its script; Casper approves. */
async function model(script: string[]) {
  const s = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (d) => (raw += d))
      .on('end', () => {
        const sys = (JSON.parse(raw) as { messages: { content: string }[] }).messages[0]!.content;
        const out = sys.startsWith('You are Casper')
          ? '{"vote":"approve","reason":"Matches.","confidence":0.9}'
          : sys.startsWith('You are a consultant')
            ? '{"reply":"ok"}'
            : (script.shift() ?? '{"reply":"done"}');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: out }, finish_reason: 'stop' }] }));
      });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/v1`,
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}

test('a remote MCP server: HTTPS, or plain HTTP on loopback only; effect classes follow what the tool says (F-123)', () => {
  assert.equal(urlRefusal('https://hub.example.ts.net/mcp'), undefined);
  assert.equal(urlRefusal('http://127.0.0.1:8080/mcp'), undefined);
  assert.match(urlRefusal('http://hub.example.ts.net/mcp')!, /https:\/\//);
  assert.match(urlRefusal('https://me:secret@hub.example.ts.net/mcp')!, /no user name or password/);
  assert.match(urlRefusal('not a url')!, /not a URL/);
  const cfg = validateTools({
    mcp: [{ id: 'hub', url: 'https://hub.example.ts.net/mcp' }],
    grants: [{ server: 'hub', tool: 'hub_run_pump', effect: 'physical', eva: '01', fingerprint: '0123456789abcdef' }],
  });
  assert.deepEqual(cfg.mcp, [{ id: 'hub', url: 'https://hub.example.ts.net/mcp' }]);
  assert.equal(cfg.grants[0]!.effect, 'physical');
  assert.throws(
    () => validateTools({ mcp: [{ id: 'hub', url: 'https://hub.example.ts.net/mcp', command: 'x' }] }),
    /not both/,
  );
  assert.throws(() => validateTools({ mcp: [{ id: 'hub', url: 'ftp://hub.example/mcp' }] }), /https/);
  assert.throws(
    () =>
      validateTools({
        mcp: [{ id: 'hub', url: 'https://hub.example.ts.net/mcp' }],
        grants: [{ server: 'hub', tool: 't', effect: 'write-local', eva: '01', fingerprint: '0123456789abcdef' }],
      }),
    /another machine/,
  );
  assert.throws(
    () =>
      validateTools({
        mcp: [{ id: 'hub', url: 'https://hub.example.ts.net/mcp' }],
        grants: [{ server: 'hub', tool: 't', effect: 'anything', eva: '01', fingerprint: '0123456789abcdef' }],
      }),
    /effect is one of/,
  );
  const pump = TOOLS[1]!;
  assert.match(grantRefusal(pump, 'read', '01', true)!, /cannot be granted as a read/);
  assert.match(grantRefusal(pump, 'write-external', '01', true)!, /irreversible or physical/);
  assert.equal(grantRefusal(pump, 'physical', '01', true), undefined);
  assert.match(grantRefusal({ name: 'note' }, 'write-local', '01', true)!, /write-external or above/);
  assert.equal(grantRefusal({ name: 'note' }, 'write-local', '01', false), undefined);
  // The kinds of failure are told apart: an unreachable machine is not a wrong path or a bad certificate.
  const cause = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
  assert.match(httpFailure('hub.example', cause('ECONNREFUSED')), /unreachable \(ECONNREFUSED\).*tailnet/);
  assert.match(httpFailure('hub.example', cause('ENOTFOUND')), /unreachable/);
  assert.match(httpFailure('hub.example', cause('DEPTH_ZERO_SELF_SIGNED_CERT')), /certificate/);
  assert.match(httpFailure('hub.example', Object.assign(new Error('x'), { name: 'TimeoutError' })), /in time/);
});

test('the HTTP client: a session kept, an SSE answer read, a wrong path and a dead server said plainly (F-123)', async () => {
  const hub = await fakeHub();
  try {
    const c = new McpHttpClient({ id: 'hub', url: hub.url });
    assert.deepEqual(
      (await c.listTools()).map((t) => t.name),
      ['hub_overview', 'hub_run_pump'],
    );
    assert.deepEqual(await c.callTool('hub_run_pump', { pumpId: 'p1' }), { text: 'Pump p1 ran.', isError: false });
    assert.ok(hub.sessions.length >= 2 && hub.sessions.every((x) => x === 'session-1'), 'the session id is sent back');
    await assert.rejects(
      new McpHttpClient({ id: 'hub', url: hub.url.replace('/mcp', '/nope') }).listTools(),
      /HTTP 404: is the path right/,
    );
  } finally {
    await hub.close();
  }
  await assert.rejects(new McpHttpClient({ id: 'hub', url: hub.url }).listTools(), /unreachable \(ECONN[A-Z]+\)/);
});

test('an answer larger than 4 MiB is cut off while it streams, for a listing and a call (F-123)', async () => {
  let sent = 0;
  let mode: 'list' | 'call' = 'list';
  const s = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (d) => (raw += d))
      .on('end', () => {
        const m = JSON.parse(raw) as { id?: number; method: string };
        if (m.id === undefined) return res.writeHead(202).end();
        res.setHeader('content-type', 'application/json');
        if (m.method === 'initialize' || (mode === 'call' && m.method === 'tools/list'))
          return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [] } }));
        // Streams without end: 64 KiB chunks until the client stops reading (or 64 MiB, a bound for the test).
        const chunk = 'x'.repeat(64 * 1024);
        res.write(`{"jsonrpc":"2.0","id":${m.id},"result":{"pad":"`);
        const pump = () => {
          while (sent < 64 * 1024 * 1024 && !res.destroyed) {
            sent += chunk.length;
            if (!res.write(chunk)) return void res.once('drain', pump);
          }
          res.end('"}}');
        };
        pump();
      });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  const url = `http://127.0.0.1:${(s.address() as { port: number }).port}/mcp`;
  try {
    await assert.rejects(new McpHttpClient({ id: 'big', url }).listTools(), /too large/);
    assert.ok(sent < 16 * 1024 * 1024, `stopped reading early (${sent} bytes sent)`);
    sent = 0;
    mode = 'call';
    await assert.rejects(new McpHttpClient({ id: 'big', url }).callTool('t', {}), /too large/);
    assert.ok(sent < 16 * 1024 * 1024, `stopped reading early (${sent} bytes sent)`);
  } finally {
    await new Promise<void>((d) => {
      s.close(() => d());
      s.closeAllConnections();
    });
  }
});

test('an approved MCP action runs at most once: a replay is refused, an expired grant does not run (F-123)', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-mcp-grant-'));
  const store = new Store(join(home, 'nerv.sqlite'));
  try {
    store.ledger.setExternal([{ name: 'hub.hub_run_pump', effect: 'physical', eva: 'eva-01' }]);
    const card = (pumpId: string) => {
      const sortie = store.ledger.openSortie('misato', `Run pump ${pumpId}`, 'trusted');
      const r = store.runAction(sortie, { tool: 'hub.hub_run_pump', stage: 'production', args: { pumpId } });
      assert.equal(r.outcome, 'approval', 'physical: Pattern Blue, a card');
      return { sortie, actionId: r.actionId!, approvalId: r.approvalId! };
    };
    // Before the owner decides there is no grant to use.
    const one = card('p1');
    assert.throws(() => store.authorizeApproved(one.sortie, one.actionId), /No approved MCP action/);
    store.decide(one.approvalId, 'approve', 'owner');
    assert.deepEqual(store.authorizeApproved(one.sortie, one.actionId), {
      tool: 'hub.hub_run_pump',
      args: { pumpId: 'p1' },
    });
    // A replay (a second resume, the same card approved again) never gets a second call.
    assert.throws(() => store.authorizeApproved(one.sortie, one.actionId), /already used/);
    store.decide(one.approvalId, 'approve', 'owner');
    assert.throws(() => store.authorizeApproved(one.sortie, one.actionId), /already used/);
    // The approval's grant lasts 60 s: a resume after that does not run the call.
    const two = card('p2');
    store.decide(two.approvalId, 'approve', 'owner');
    store.db.prepare('UPDATE grants SET expires=? WHERE action_id=?').run('2000-01-01T00:00:00.000Z', two.actionId);
    assert.throws(() => store.authorizeApproved(two.sortie, two.actionId), /expired/);
    // A rejected card never authorizes a call.
    const three = card('p3');
    store.decide(three.approvalId, 'reject', 'owner');
    assert.throws(() => store.authorizeApproved(three.sortie, three.actionId), /No approved MCP action/);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test(
  'across the join: registered by URL, listed, a read runs Green, a pump waits for the card and runs once approved, a dead hub is reported (F-123)',
  { timeout: 90000 },
  async () => {
    const hub = await fakeHub();
    const m = await model([
      '{"action":{"tool":"hub.hub_overview","args":{}}}',
      '{"reply":"The tent reads EC 1.4 and pH 6.0."}',
      '{"action":{"tool":"hub.hub_run_pump","args":{"pumpId":"p1","durationMs":2000}}}',
      '{"reply":"Pump p1 ran."}',
      '{"action":{"tool":"hub.hub_run_pump","args":{"pumpId":"p2"}}}',
      '{"reply":"Pump p2 did not run."}',
    ]);
    const home = mkdtempSync(join(tmpdir(), 'nerv-mcp-remote-'));
    // Asynchronous: the fake hub answers in this process while the CLI runs.
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
    try {
      assert.equal((await cli('init')).status, 0);
      // Registration: by URL; a remote plain-HTTP address is refused.
      assert.match((await cli('tools', 'add', 'hub', 'http://hub.example.ts.net/mcp')).stderr, /https:\/\//);
      const added = await cli('tools', 'add', 'hub', hub.url);
      assert.equal(added.status, 0, added.stderr);
      assert.match(added.stdout, /Nothing is sent to it until NERV lists or calls its tools/);
      const listed = (await cli('tools')).stdout;
      assert.match(listed, new RegExp(`hub · ${hub.url} · 2 tool\\(s\\)`));
      assert.match(listed, /hub\.hub_overview · read-only · not granted/);
      assert.match(listed, /hub\.hub_run_pump · destructive · not granted/);
      // Effect classes: the pump is refused as a read or a plain external write; granted as physical it is Blue.
      assert.match((await cli('tools', 'grant', 'hub/hub_run_pump')).stderr, /cannot be granted as a read/);
      assert.match(
        (await cli('tools', 'grant', 'hub/hub_run_pump', '--effect', 'write-external')).stderr,
        /irreversible or physical/,
      );
      assert.match((await cli('tools', 'grant', 'hub/hub_overview')).stdout, /as a read \(Pattern Green/);
      const pump = await cli('tools', 'grant', 'hub/hub_run_pump', '--effect', 'physical');
      assert.equal(pump.status, 0, pump.stderr);
      assert.match(pump.stdout, /as physical \(Pattern Blue: you approve each call on a card\), EVA-01/);
      assert.match((await cli('tools')).stdout, /hub\.hub_run_pump · destructive · granted physical · EVA-01/);
      const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as Record<string, unknown>;
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({
          ...config,
          models: {
            local: { baseUrl: m.url, model: 'm' },
            roles: { misato: { route: 'local' }, consultant: { model: 'c' } },
          },
        }),
      );

      r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
      await r.ready();
      r.startResumer(100);
      const listing = toolListing(await r.externalTools(true));
      assert.deepEqual(
        listing.tools.filter((t) => t.source === 'mcp:hub').map((t) => [t.name, t.effect, t.eva]),
        [
          ['hub.hub_overview', 'read', '00'],
          ['hub.hub_run_pump', 'physical', '01'],
        ],
      );

      // A read: Pattern Green, it runs at once through the tools process.
      const read = await r.chat('How is the tent?');
      assert.deepEqual(
        read.steps.map((s) => [s.tool, s.outcome]),
        [['hub.hub_overview', 'grant']],
      );
      assert.deepEqual(read.steps[0]!.result, { text: 'Room tent: EC 1.4, pH 6.0.' });
      const readBallot = (await r.events(read.sortieId)).find((e) => e.kind === 'ballot')!.payload as {
        pattern: string;
      };
      assert.equal(readBallot.pattern, 'green');

      // An action on hardware: the gate sends it to the owner; nothing reaches the hub before the approval.
      const ask = await r.chat('Run pump p1 for two seconds');
      assert.equal(ask.steps.at(-1)?.outcome, 'approval');
      assert.equal(ask.waiting.length, 1);
      assert.ok(!hub.calls.some((c) => c.name === 'hub_run_pump'), 'not called before the approval');
      const resumed = new Promise<ChatReply>((done) =>
        r!.onResumed((reply) => {
          if (reply.sortieId === ask.sortieId) done(reply);
        }),
      );
      await r.decide(ask.waiting[0]!.approvalId, 'approve');
      const after = await resumed;
      assert.deepEqual(
        hub.calls.filter((c) => c.name === 'hub_run_pump'),
        [{ name: 'hub_run_pump', args: { pumpId: 'p1', durationMs: 2000 } }],
        'called once, with the approved arguments',
      );
      const ran = after.steps.find((s) => s.tool === 'hub.hub_run_pump' && s.outcome === 'grant')!;
      assert.deepEqual(ran.result, { text: 'Pump p1 ran.' });
      assert.equal(ran.reason, 'The owner approved it; it ran.');
      assert.equal(after.reply, 'Pump p1 ran.');
      const ev = await r.events(ask.sortieId);
      assert.equal(ev.filter((e) => e.kind === 'grant.used').length, 1, 'the single-use grant was used once');
      assert.deepEqual((ev.find((e) => e.kind === 'action.done')!.payload as { result: unknown }).result, {
        text: 'Pump p1 ran.',
      });

      // The same card approved again: the call does not run a second time.
      await r.decide(ask.waiting[0]!.approvalId, 'approve');
      await new Promise((d) => setTimeout(d, 500));
      assert.equal(hub.calls.filter((c) => c.name === 'hub_run_pump').length, 1, 'no second call on a replay');

      // A card waits while the hub goes away: approved, the call does not run, and Misato is told so.
      const ask2 = await r.chat('Run pump p2');
      assert.equal(ask2.waiting.length, 1);
      const resumed2 = new Promise<ChatReply>((done) =>
        r!.onResumed((reply) => {
          if (reply.sortieId === ask2.sortieId) done(reply);
        }),
      );
      // The hub goes away: its tools are suspended with why, in the listing and in the CLI; never silently dropped.
      await hub.close();
      await r.decide(ask2.waiting[0]!.approvalId, 'approve');
      const notRun = (await resumed2).steps.find((s) => s.tool === 'hub.hub_run_pump' && s.outcome === 'grant')!;
      assert.equal(notRun.reason, 'The owner approved it, but it did not run.');
      assert.match(notRun.error ?? '', /Approved, but it did not run: .*unreachable/);
      assert.ok(!hub.calls.some((c) => c.args.pumpId === 'p2'));
      const gone = toolListing(await r.externalTools(true));
      assert.equal(gone.tools.filter((t) => t.source === 'mcp:hub').length, 0);
      assert.deepEqual(
        gone.suspended.map((x) => x.name),
        ['hub.hub_overview', 'hub.hub_run_pump'],
      );
      assert.match(gone.suspended[0]!.why, /unreachable \(ECONN[A-Z]+\)/);
      assert.match(
        (await cli('tools')).stdout,
        /hub · http:\/\/127\.0\.0\.1:\d+\/mcp\n\s+could not list its tools: .*unreachable/,
      );
    } finally {
      await r?.close();
      await hub.close().catch(() => undefined);
      await m.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
