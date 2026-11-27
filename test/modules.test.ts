// F-159: modules, one on/off switch per MCP server and built-in pack. Off keeps grants and data; Misato is offered none
// of the module's tools and nothing calls its server; on restores it without granting again. Neutral invented data:
// a stand-in plant hub on loopback, no real host or tailnet names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, validateTools } from '../src/mcp.ts';
import { builtinPackRegistry } from '../src/packs.ts';
import { listModules, setModuleOn } from '../src/modules.ts';
import { readConfig, type Config } from '../src/config.ts';
import { ProcessClient } from '../src/process-client.ts';
import { readLiveIndex } from '../src/runtime-tools.ts';

const OVERVIEW = {
  name: 'hub_overview',
  description: 'Plants in every room with the latest probe reading.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
};

/** A stand-in plant hub over streamable HTTP; it counts every request it receives. */
async function fakeHub() {
  let tools = [OVERVIEW];
  let requests = 0;
  const s: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      requests++;
      const m = JSON.parse(raw) as { id?: number; method: string; params?: { name?: string } };
      if (m.id === undefined) return res.writeHead(202).end();
      const json = (result: unknown) =>
        res.setHeader('content-type', 'application/json').end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
      if (m.method === 'initialize') return json({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
      if (m.method === 'tools/list') return json({ tools });
      json({ content: [{ type: 'text', text: 'Basil in the kitchen, mint on the balcony.' }] });
    });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/mcp`,
    requests: () => requests,
    describe: (description: string) => (tools = [{ ...OVERVIEW, description }]),
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}

/** A fake local model: Misato follows its script and every request body is kept; Casper approves. */
async function model(script: string[]) {
  const misato: string[] = [];
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
            : (misato.push(raw), script.shift() ?? '{"reply":"done"}');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: out }, finish_reason: 'stop' }] }));
      });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/v1`,
    misato,
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}

const cliIn =
  (home: string) =>
  (...a: string[]) =>
    new Promise<{ status: number; stdout: string; stderr: string }>((done) =>
      execFile(
        process.execPath,
        ['src/cli.ts', ...a],
        { env: { ...process.env, NERV_HOME: home, NERV_PORT: '9' }, encoding: 'utf8' },
        (e, stdout, stderr) => done({ status: e ? Number(e.code ?? 1) : 0, stdout, stderr }),
      ),
    );

const grant = (server: string) => ({
  server,
  tool: OVERVIEW.name,
  effect: 'read' as const,
  eva: '00' as const,
  fingerprint: fingerprint(OVERVIEW),
});

test('F-159-T01: one row per module; the FPV pack is FPVBuddy, and an FPVBuddy server joins that row', () => {
  const config = {
    packs: { cooking: false },
    tools: {
      mcp: [
        { id: 'grover', url: 'https://hub.example.ts.net/mcp', off: true as const },
        { id: 'fpvbuddy', url: 'https://fpv.example.ts.net/mcp' },
      ],
      grants: [grant('grover'), grant('fpvbuddy')],
    },
  } as unknown as Config;
  const rows = listModules(config, builtinPackRegistry, [{ server: 'fpvbuddy' }]);
  const fpvTools = builtinPackRegistry.get('fpv')!.tools.length;
  assert.deepEqual(
    rows.map((r) => [r.id, r.name, r.on, r.reachable, r.tools]),
    [
      ['fpvbuddy', 'FPVBuddy', true, true, fpvTools + 1],
      ['cooking', 'Cooking', false, true, builtinPackRegistry.get('cooking')!.tools.length],
      ['grover', 'Grover', false, null, 1],
    ],
  );
  assert.ok(!rows.some((r) => r.id === 'fpv'), 'no separate FPV row');
  // Unreachable: the listing's error is the reason.
  const down = listModules(
    { tools: { mcp: [{ id: 'grover', url: 'https://hub.example.ts.net/mcp' }], grants: [] } } as unknown as Config,
    builtinPackRegistry,
    [{ server: 'grover', error: 'hub.example.ts.net is unreachable' }],
  ).find((r) => r.id === 'grover')!;
  assert.deepEqual([down.on, down.reachable, down.why], [true, false, 'hub.example.ts.net is unreachable']);
});

test('F-159-T01: off is stored on the server entry or as packs.<id>: false, grants kept; on clears it', () => {
  assert.throws(
    () => validateTools({ mcp: [{ id: 'grover', url: 'https://hub.example.ts.net/mcp', off: false }] }),
    /off is true or absent/,
  );
  const home = mkdtempSync(join(tmpdir(), 'nerv-modules-'));
  try {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        tools: { mcp: [{ id: 'grover', url: 'https://hub.example.ts.net/mcp' }], grants: [grant('grover')] },
      }),
    );
    setModuleOn(home, 'grover', false);
    setModuleOn(home, 'fpvbuddy', false);
    let c = readConfig(home);
    assert.equal((c.tools!.mcp[0] as { off?: true }).off, true);
    assert.deepEqual(c.tools!.grants, [grant('grover')], 'grants kept while off');
    assert.deepEqual(c.packs, { fpv: false });
    setModuleOn(home, 'grover', true);
    setModuleOn(home, 'FPVBuddy', true);
    c = readConfig(home);
    assert.equal('off' in c.tools!.mcp[0]!, false);
    assert.deepEqual(c.tools!.grants, [grant('grover')]);
    assert.equal(c.packs, undefined);
    assert.throws(() => setModuleOn(home, 'garden', false), /No module garden: nerv modules lists them/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test(
  'F-159-T01: nerv modules lists and switches; tools remove still drops the grants',
  { timeout: 60000 },
  async () => {
    const hub = await fakeHub();
    const home = mkdtempSync(join(tmpdir(), 'nerv-modules-cli-'));
    const cli = cliIn(home);
    try {
      assert.equal((await cli('init')).status, 0);
      assert.equal((await cli('tools', 'add', 'grover', hub.url)).status, 0);
      assert.equal((await cli('tools', 'grant', 'grover/hub_overview')).status, 0);
      const listed = await cli('modules');
      assert.equal(listed.status, 0, listed.stderr);
      assert.match(listed.stdout, /FPVBuddy \(fpvbuddy\) · on · reachable · \d+ tool\(s\)/);
      assert.match(listed.stdout, /Cooking \(cooking\) · on · reachable · \d+ tool\(s\)/);
      assert.match(listed.stdout, /Grover \(grover\) · on · reachable · 1 tool\(s\)/);
      const off = await cli('modules', 'off', 'grover');
      assert.equal(off.status, 0, off.stderr);
      assert.match(
        off.stdout,
        /Grover is off: Misato is offered none of its tools.*1 grant\(s\) and its data are kept/s,
      );
      const before = hub.requests();
      assert.match((await cli('modules')).stdout, /Grover \(grover\) · off · not asked while off · 1 tool\(s\)/);
      assert.equal(hub.requests(), before, 'an off server is not contacted by the listing');
      assert.match((await cli('modules', 'on', 'grover')).stdout, /Grover is on/);
      assert.match((await cli('modules', 'off', 'garden')).stderr, /No module garden/);
      assert.match((await cli('modules', 'pause', 'grover')).stderr, /Usage: modules/);
      assert.match((await cli('tools', 'remove', 'grover')).stdout, /removed, with its grants/);
      assert.equal(readConfig(home).tools, undefined);
    } finally {
      await hub.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test(
  'F-159-T02 across the join: off offers Misato no Grover tool and nothing reaches the hub; on restores without re-granting',
  { timeout: 120000 },
  async () => {
    const hub = await fakeHub();
    const m = await model([
      '{"action":{"tool":"grover.hub_overview","args":{}}}',
      '{"reply":"Basil and mint."}',
      '{"reply":"I cannot see your plants now."}',
      '{"action":{"tool":"grover.hub_overview","args":{}}}',
      '{"reply":"Basil and mint."}',
    ]);
    const home = mkdtempSync(join(tmpdir(), 'nerv-modules-join-'));
    const cli = cliIn(home);
    const { Runtime } = await import('../src/runtime.ts');
    let r: InstanceType<typeof Runtime> | undefined;
    try {
      assert.equal((await cli('init')).status, 0);
      assert.equal((await cli('tools', 'add', 'grover', hub.url)).status, 0);
      assert.equal((await cli('tools', 'grant', 'grover/hub_overview')).status, 0);
      const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as Record<string, unknown>;
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
      const offered = async () => (await r!.externalTools()).docs.map((d) => d.name);

      // On: the tool is offered and runs.
      assert.deepEqual(await offered(), ['grover.hub_overview']);
      const on = await r.chat('quali piante ho?');
      assert.deepEqual(
        on.steps.map((s) => [s.tool, s.outcome]),
        [['grover.hub_overview', 'grant']],
      );

      // Off, from the CLI while the service runs: offered nothing at once (no stale cache), nothing reaches the hub.
      assert.equal((await cli('modules', 'off', 'grover')).status, 0);
      const before = hub.requests();
      assert.deepEqual(await offered(), []);
      assert.deepEqual((await r.externalTools(true)).suspended, [], 'off is not reported as suspended');
      const asked = m.misato.length;
      const off = await r.chat('quali piante ho?');
      assert.deepEqual(off.steps, []);
      assert.ok(
        m.misato.slice(asked).every((body) => !body.includes('grover.')),
        'Misato sees no Grover tool',
      );
      assert.equal(hub.requests(), before, 'no request reached the hub while off');
      assert.deepEqual(
        readConfig(home).tools!.grants.map((g) => g.tool),
        ['hub_overview'],
        'grant kept',
      );

      // The tools process refuses a call to an off server, even with the right fingerprint.
      const tools = new ProcessClient(new URL('../src/tools-process.ts', import.meta.url), [home], 'tools', 30_000);
      try {
        const refused = (await tools.call('tools.call', {
          server: 'grover',
          tool: 'hub_overview',
          args: {},
          fingerprint: fingerprint(OVERVIEW),
        })) as { error?: string };
        assert.match(refused.error ?? '', /grover is off: nerv modules on grover/);
        assert.deepEqual(await tools.call('tools.list'), []);
        assert.equal(hub.requests(), before);
      } finally {
        tools.close();
      }

      // On again: offered with no new grant, and it runs.
      assert.equal((await cli('modules', 'on', 'grover')).status, 0);
      assert.deepEqual(await offered(), ['grover.hub_overview']);
      const back = await r.chat('quali piante ho?');
      assert.deepEqual(
        back.steps.map((s) => [s.tool, s.outcome]),
        [['grover.hub_overview', 'grant']],
      );

      // A description changed while off stays suspended after on: it needs a new grant.
      assert.equal((await cli('modules', 'off', 'grover')).status, 0);
      hub.describe('Plants, and now also waters them.');
      assert.equal((await cli('modules', 'on', 'grover')).status, 0);
      const changed = await r.externalTools(true);
      assert.deepEqual(changed.docs, []);
      assert.match(changed.suspended[0]?.why ?? '', /description changed since it was granted/);
    } finally {
      await r?.close();
      await hub.close();
      await m.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test('F-159-T02: the live index read says off without calling; doctor does not report an off server', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-modules-index-'));
  try {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        tools: {
          mcp: [{ id: 'coordinator', url: 'http://127.0.0.1:9/mcp', off: true }],
          grants: ['waiting_on_me', 'blocked_by'].map((tool) => ({
            server: 'coordinator',
            tool,
            effect: 'read',
            eva: '00',
            fingerprint: '0123456789abcdef',
          })),
        },
      }),
    );
    let calls = 0;
    const toolsProcess = () =>
      ({
        call: async () => {
          calls++;
          return [];
        },
      }) as unknown as ProcessClient;
    assert.deepEqual(await readLiveIndex({ home, toolsProcess }), { state: 'off' });
    const { mcpServerHealth } = await import('../src/runtime-tools.ts');
    assert.deepEqual(await mcpServerHealth({ home, toolsProcess }), []);
    assert.equal(calls, 0, 'nothing asked of the tools process');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
