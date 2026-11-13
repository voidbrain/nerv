import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient, fingerprint, grantRefusal, validateTools, type McpServer } from '../src/mcp.ts';
import { builtinToolDescriptors, builtinTools, toolDocs } from '../src/executors.ts';
const FAKE = fileURLToPath(new URL('./fixtures/fake-mcp.mjs', import.meta.url));
const server = (id = 'notes', v2 = false): McpServer => ({
  id,
  command: process.execPath,
  args: [FAKE, ...(v2 ? ['--v2'] : [])],
});
test("NERV's own tools expose stable versioned descriptors in the tool registry (F-021)", () => {
  assert.equal(builtinToolDescriptors.length, builtinTools.length);
  assert.equal(builtinToolDescriptors.length, toolDocs.length + 1, 'kaji.run has a dynamic planner description');
  assert.ok(builtinToolDescriptors.every((tool) => tool.source === 'nerv'));
  assert.ok(builtinToolDescriptors.every((tool) => /^[0-9a-f]{16}$/.test(tool.version)));
  assert.equal(new Set(builtinToolDescriptors.map((tool) => tool.name)).size, builtinToolDescriptors.length);
  assert.equal(builtinToolDescriptors.find((tool) => tool.name === 'reminders.add')?.effect, 'write-local');
});
test('the tools config: reserved server ids refused, grants only for known servers, reads only for now (F-021)', () => {
  assert.throws(() => validateTools({ mcp: [{ id: 'reminders', command: 'x' }] }), /not one of NERV's own/);
  assert.throws(
    () =>
      validateTools({
        mcp: [],
        grants: [{ server: 'nope', tool: 't', effect: 'read', eva: '00', fingerprint: '0123456789abcdef' }],
      }),
    /unknown server/,
  );
  assert.throws(
    () =>
      validateTools({
        mcp: [{ id: 'notes', command: 'x' }],
        grants: [{ server: 'notes', tool: 't', effect: 'write-local', eva: '00', fingerprint: '0123456789abcdef' }],
      }),
    /only "read" for now/,
  );
  assert.deepEqual(
    validateTools({
      mcp: [{ id: 'notes', command: 'x' }],
      grants: [{ server: 'notes', tool: 't', effect: 'read', eva: '00', fingerprint: '0123456789abcdef' }],
    }).grants.length,
    1,
  );
  assert.match(
    grantRefusal({ name: 'd', annotations: { destructiveHint: true } }, 'read', '00')!,
    /cannot be granted as a read/,
  );
  assert.match(grantRefusal({ name: 'r' }, 'write-local', '00')!, /only "read"/);
  assert.equal(grantRefusal({ name: 'r', annotations: { readOnlyHint: true } }, 'read', '00'), undefined);
});
test('an MCP server over stdio: tools listed, a call answered, the fingerprint follows the description (F-021)', async () => {
  assert.equal(
    fingerprint({
      name: 'read_note',
      description: 'Reads one note.',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
    }),
    '63a67c8c6510dd5f',
    'existing grants keep their descriptor fingerprint across the unified registry change',
  );
  const c = new McpClient(server());
  const c2 = new McpClient(server('notes', true));
  try {
    const tools = await c.listTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      ['read_note', 'delete_note'],
    );
    assert.deepEqual(await c.callTool('read_note', { name: 'shopping' }), {
      text: 'Note shopping: buy milk and bread.',
      isError: false,
    });
    assert.deepEqual(await c.callTool('delete_note', { name: 'x' }), { text: 'Not allowed here.', isError: true });
    const v1 = fingerprint(tools[0]!),
      v2 = fingerprint((await c2.listTools())[0]!);
    assert.match(v1, /^[0-9a-f]{16}$/);
    assert.notEqual(v1, v2, 'a changed description is a new fingerprint');
    assert.equal(fingerprint(tools[0]!), v1, 'stable');
  } finally {
    c.close();
    c2.close();
  }
});
/** A fake local model: Misato follows its script; every system prompt (the tools Misato is offered) is kept. */
async function model(script: string[]) {
  const systems: string[] = [],
    consulted: string[] = [];
  const s = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (d) => (raw += d))
      .on('end', () => {
        const r = JSON.parse(raw) as { messages: { content: string }[] };
        const sys = r.messages[0]!.content;
        let out = '{"reply":"ok"}';
        if (sys.startsWith('You are Casper')) out = '{"vote":"approve","reason":"Matches.","confidence":0.9}';
        else if (sys.startsWith('You are a consultant')) consulted.push(r.messages.at(-1)!.content);
        else {
          systems.push(sys);
          out = script.shift() ?? '{"reply":"done"}';
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: out }, finish_reason: 'stop' }] }));
      });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/v1`,
    systems,
    consulted,
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}
test(
  'through every process: a granted read runs through the gate and the tools process; an ungranted, changed or EVA-03 tool never runs (F-021)',
  { timeout: 60000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const probe = new McpClient(server());
    const fp = fingerprint((await probe.listTools())[0]!);
    probe.close();
    const script = [
      '{"action":{"tool":"notes.read_note","args":{"name":"shopping"}}}',
      '{"reply":"Your shopping note says milk and bread."}',
      '{"action":{"tool":"notes.delete_note","args":{"name":"shopping"}}}',
      '{"reply":"I cannot delete notes."}',
    ];
    const m = await model(script);
    const home = mkdtempSync(join(tmpdir(), 'nerv-mcp-'));
    const config = (srv: McpServer, eva = '00') =>
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({
          models: {
            local: { baseUrl: m.url, model: 'm' },
            roles: { misato: { route: 'local' }, consultant: { model: 'c' } },
          },
          tools: { mcp: [srv], grants: [{ server: 'notes', tool: 'read_note', effect: 'read', eva, fingerprint: fp }] },
        }),
      );
    config(server());
    const r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    try {
      await r.ready();
      const one = await r.chat('What is on my shopping note?');
      assert.match(m.systems[0]!, /notes\.read_note/, 'the granted tool is offered');
      assert.doesNotMatch(m.systems[0]!, /notes\.delete_note/, 'an ungranted one is not');
      assert.deepEqual(
        one.steps.map((s) => [s.tool, s.outcome]),
        [['notes.read_note', 'grant']],
      );
      assert.deepEqual(one.steps[0]!.result, { text: 'Note shopping: buy milk and bread.' });
      assert.equal(one.reply, 'Your shopping note says milk and bread.');
      const ev = await r.events(one.sortieId);
      assert.ok(
        ev.some((e) => e.kind === 'grant.used'),
        'the single-use grant was used',
      );
      // B-025: granted for EVA-00, it runs under EVA-00, not the EVA its stage alone would pick.
      assert.equal((ev.find((e) => e.kind === 'ballot')!.payload as { executor: string }).executor, 'eva-00');
      // B-024: the consultant is told what Misato can do: NERV's own tools and the granted one.
      const told =
        (JSON.parse(m.consulted[0]!) as { tools?: { name: string; about: string }[] }).tools?.map((t) => t.name) ?? [];
      assert.ok(told.includes('notes.read_note') && told.includes('reminders.add'), told.join(', '));
      assert.ok(!told.includes('notes.delete_note'), 'not an ungranted one');
      assert.deepEqual((ev.find((e) => e.kind === 'action.done')!.payload as { result: unknown }).result, {
        text: 'Note shopping: buy milk and bread.',
      });
      const two = await r.chat('Delete my shopping note');
      assert.deepEqual(
        two.steps.map((s) => [s.tool, s.outcome]),
        [['notes.delete_note', 'invalid']],
        'not granted: back to Misato, never a card',
      );
      // The server changed the tool's description: its grant is suspended, Misato is no longer offered it.
      config(server('notes', true));
      const ext = await r.externalTools(true);
      assert.equal(ext.byName.size, 0);
      assert.deepEqual(
        ext.suspended.map((x) => x.name),
        ['notes.read_note'],
      );
      assert.match(ext.suspended[0]!.why, /changed since it was granted/);
      // Granted for EVA-03: no sandbox yet (F-049), so it does not run.
      config(server(), '03');
      await r.externalTools(true);
      script.push('{"action":{"tool":"notes.read_note","args":{"name":"x"}}}', '{"reply":"not now"}');
      const three = await r.chat('Read note x');
      assert.equal(three.steps[0]?.outcome, 'invalid');
      assert.match(three.steps[0]?.error ?? '', /EVA-03 .*F-049/);
    } finally {
      await r.close();
      await m.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
test(
  'the CLI: tools add, list, a destructive tool refused as a read, grant pinned to the description, revoke (F-021)',
  { timeout: 60000 },
  async () => {
    const { spawnSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const home = mkdtempSync(join(tmpdir(), 'nerv-tools-cli-'));
    const run = (...a: string[]) =>
      spawnSync(process.execPath, ['src/cli.ts', ...a], {
        env: { ...process.env, NERV_HOME: home, NERV_PORT: '9' },
        encoding: 'utf8',
      });
    try {
      assert.equal(run('init').status, 0);
      const own = run('tools').stdout;
      assert.match(own, /NERV · \d+ built-in tool\(s\)/);
      assert.match(own, /reminders\.add · write-local · version [0-9a-f]{16}/);
      assert.match(own, /No MCP servers yet/);
      assert.equal(run('tools', 'add', 'notes', process.execPath, FAKE).status, 0);
      const list = run('tools').stdout;
      assert.match(list, /notes\.read_note · read-only · not granted/);
      assert.match(list, /notes\.delete_note · destructive · not granted/);
      const bad = run('tools', 'grant', 'notes/delete_note');
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /cannot be granted as a read/);
      const ok = run('tools', 'grant', 'notes/read_note');
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /granted as a read \(Pattern Green\), EVA-00/);
      assert.match(run('tools').stdout, /notes\.read_note · read-only · granted read · EVA-00/);
      assert.match(readFileSync(join(home, 'config.json'), 'utf8'), /"fingerprint": "[0-9a-f]{16}"/);
      assert.equal(run('tools', 'revoke', 'notes/read_note').status, 0);
      assert.match(run('tools').stdout, /notes\.read_note · read-only · not granted/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
test('a server that fails at start says why: the last lines of its error output (B-019)', async () => {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-mcp-bad-'));
  const bad = join(dir, 'bad.mjs');
  writeFileSync(bad, "console.error('Error: Cannot find module \\'./npm-cli.js\\'');process.exit(1);");
  const c = new McpClient({ id: 'bad', command: process.execPath, args: [bad] });
  try {
    await assert.rejects(c.listTools(), /MCP server ended \(exit 1\): Error: Cannot find module '\.\/npm-cli\.js'/);
  } finally {
    c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("B-025: a granted tool runs under the stricter of its grant's EVA and the stage's; EVA-03 stays quarantine", async () => {
  const { stricter } = await import('../src/policy.ts');
  assert.equal(stricter('eva-02', 'eva-00'), 'eva-00', 'granted for EVA-00 in production: EVA-00');
  assert.equal(stricter('eva-00', 'eva-02'), 'eva-00', 'a prototype stage still confines a tool granted for EVA-02');
  assert.equal(stricter('eva-01', 'eva-02'), 'eva-01');
  assert.equal(stricter('eva-03', 'eva-00'), 'eva-03', 'tainted local work stays in quarantine');
  assert.equal(stricter('eva-02', undefined), 'eva-02', "NERV's own tools: the stage decides");
});

test(
  'F-027: MCP result taints the durable sortie, approved memory, resume and the next conversation turn',
  { timeout: 60000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const probe = new McpClient(server());
    const fp = fingerprint((await probe.listTools())[0]!);
    probe.close();
    const script = [
      '{"action":{"tool":"notes.read_note","args":{"name":"fixture"}}}',
      '{"action":{"tool":"memory.remember","args":{"text":"Fixture prefers tea"}}}',
      '{"reply":"Recorded after approval."}',
      '{"action":{"tool":"notes.read_note","args":{"name":"fixture-again"}}}',
      ...Array.from({ length: 4 }, (_, n) =>
        JSON.stringify({ action: { tool: 'notes.read_note', args: { name: 'blocked-' + n } } }),
      ),
      '{"reply":"Quarantine required."}',
    ];
    const m = await model(script);
    const home = mkdtempSync(join(tmpdir(), 'nerv-mcp-taint-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        models: {
          local: { baseUrl: m.url, model: 'm' },
          roles: { misato: { route: 'local' }, consultant: { model: 'c' } },
        },
        tools: {
          mcp: [server()],
          grants: [{ server: 'notes', tool: 'read_note', effect: 'read', eva: '02', fingerprint: fp }],
        },
      }),
    );
    let r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    try {
      await r.ready();
      const first = await r.chat('Read the fixture and remember its preference', 'cli');
      assert.equal((await r.sortie(first.sortieId))?.trust, 'tainted');
      assert.equal(first.steps[0]?.tainted, true);
      assert.equal(first.waiting[0]?.tool, 'memory.remember');
      // Restart while the card waits: propagation must not depend on coordinator memory.
      await r.close();
      r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
      await r.ready();
      const resumed: unknown[] = [];
      r.onResumed((x) => resumed.push(x));
      await r.decide(first.waiting[0]!.approvalId, 'approve');
      await r.sweep();
      assert.equal(resumed.length, 1);
      assert.equal((await r.lilith.list())[0]?.tainted, true, 'approval does not cleanse third-party content');
      const next = await r.chat('Read another fixture note', 'cli');
      assert.equal((await r.sortie(next.sortieId))?.trust, 'tainted', 'earlier context retains its provenance');
      assert.equal(next.steps.length, 5);
      assert.ok(next.steps.every((s) => s.outcome === 'reject'));
      assert.equal(next.waiting.length, 0);
      assert.equal(next.steps[0]?.outcome, 'reject');
      assert.match(next.steps[0]?.reason ?? '', /EVA-03/);
      assert.equal(
        (await r.events(next.sortieId)).some((e) => e.kind === 'grant.used'),
        false,
        'quarantined outside code never dispatches',
      );
    } finally {
      await r.close();
      await m.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
