import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRootKey, signRecord, unlockRootKey, type RegistryBody } from '../src/kaji.ts';
import { KajiLink, sanitizeOffers, signedHeaders } from '../src/kaji-link.ts';
import type { ChatReply } from '../src/runtime.ts';
import { McpClient, fingerprint } from '../src/mcp.ts';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean | Promise<boolean>, describe: () => unknown | Promise<unknown>, ms = 15000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() >= end) throw new Error(`Kaji wait timed out after ${ms} ms: ${JSON.stringify(await describe())}`);
    await wait(25);
  }
}
/** Keep every port bound while allocating the next, so one fixture cannot receive the same ephemeral port twice. */
async function reservePorts(count: number) {
  const servers: Server[] = [];
  const ports: number[] = [];
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await Promise.all(servers.map((s) => new Promise<void>((done, fail) => s.close((e) => (e ? fail(e) : done())))));
  };
  try {
    for (let i = 0; i < count; i++) {
      const s = createServer();
      servers.push(s);
      await new Promise<void>((done, fail) => {
        s.once('error', fail);
        s.listen(0, '127.0.0.1', () => {
          s.off('error', fail);
          done();
        });
      });
      ports.push((s.address() as { port: number }).port);
    }
  } catch (e) {
    await Promise.allSettled(
      servers.filter((s) => s.listening).map((s) => new Promise<void>((done) => s.close(() => done()))),
    );
    throw e;
  }
  return { ports, release };
}
const keys = () => {
  const k = generateKeyPairSync('ed25519');
  return {
    privateKey: k.privateKey,
    publicKey: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
};
const root = (() => {
  const f = createRootKey('a long test passphrase');
  return unlockRootKey(f.file, 'a long test passphrase');
})();
let serial = 0;
const rec = (body: Omit<RegistryBody, 'serial' | 'issued'>) =>
  signRecord(root.privateKey, { ...body, serial: ++serial, issued: new Date().toISOString() } as RegistryBody);
/** A fake local model: Misato follows a script and its system prompt is kept; Casper always approves. */
async function fakeModel(script: (string | (() => Promise<string>))[]) {
  const systems: string[] = [];
  const casperPrompts: string[] = [];
  const s = httpServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', async () => {
        const r = JSON.parse(raw) as { messages: { content: string }[] };
        const casper = r.messages[0]!.content.startsWith('You are Casper');
        if (!casper) systems.push(r.messages[0]!.content);
        else casperPrompts.push(r.messages.at(-1)!.content);
        const next = casper ? undefined : script.shift();
        const content = typeof next === 'function' ? await next() : next;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: casper
                    ? '{"vote":"approve","reason":"Matches.","confidence":0.9}'
                    : (content ?? '{"reply":"ok"}'),
                },
                finish_reason: 'stop',
              },
            ],
          }),
        );
      });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/v1`,
    systems,
    casperPrompts,
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}
test('offers keep action names only', () => {
  assert.deepEqual(
    sanitizeOffers(['reminders.add', 'reminders.add', 'kaji.run']),
    ['reminders.add'],
    'never kaji.run itself',
  );
  for (const bad of [
    null,
    'reminders.add',
    ['Reminders Add'],
    Array.from({ length: 21 }, (_, i) => 'a.b' + String.fromCharCode(97 + i)),
  ])
    assert.equal(sanitizeOffers(bad), undefined);
});
test(
  "kaji.run: the main base's Misato sends one action to a base that offers it; the owner approves it there; that base runs it once through its own gate; the result comes back as a follow-up",
  { timeout: 60000 },
  async (t) => {
    const { Runtime } = await import('../src/runtime.ts');
    const A = keys(),
      B = keys();
    const reserved = await reservePorts(2);
    const [pa, pb] = reserved.ports;
    t.after(() => reserved.release());
    const RUN =
      '{"action":{"tool":"kaji.run","args":{"base":"NERV-02","tool":"reminders.add","args":{"title":"Stretch","due":"2031-01-01T09:00:00Z"}}}}';
    const model = await fakeModel([
      '{"action":{"tool":"kaji.run","args":{"base":"NERV-02","tool":"reminders.cancel","args":{"id":"x"}}}}',
      RUN,
      '{"reply":"Sent to Tabgha."}',
    ]);
    const ha = mkdtempSync(join(tmpdir(), 'nerv-run-a-')),
      hb = mkdtempSync(join(tmpdir(), 'nerv-run-b-'));
    writeFileSync(
      join(ha, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-01', name: 'Neo Tokyo-3' },
        kaji: { root: root.publicKey },
        models: { local: { baseUrl: model.url, model: 'm' } },
      }),
    );
    writeFileSync(
      join(hb, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-02', name: 'Tabgha' },
        kaji: { root: root.publicKey, offers: ['reminders.add'] },
      }),
    );
    const records = [
      rec({
        kind: 'enrol',
        baseId: 'NERV-01',
        name: 'Neo Tokyo-3',
        publicKey: A.publicKey,
        address: `127.0.0.1:${pa}`,
      }),
      rec({ kind: 'enrol', baseId: 'NERV-02', name: 'Tabgha', publicKey: B.publicKey, address: `127.0.0.1:${pb}` }),
      rec({ kind: 'main', baseId: 'NERV-01' }),
    ];
    const a = new Runtime(join(ha, 'nerv.sqlite'), undefined, ha),
      b = new Runtime(join(hb, 'nerv.sqlite'), undefined, hb);
    const links: KajiLink[] = [];
    const logs: string[] = [];
    const heard: Record<string, string[]> = {};
    let advertise = false;
    const describe = async () => {
      const snapshot = await Promise.allSettled([a.bases(), b.bases(), a.remoteOffers()]);
      const value = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? r.value : String(r.reason));
      return {
        basesA: value(snapshot[0]!),
        basesB: value(snapshot[1]!),
        offers: value(snapshot[2]!),
        heard,
        logs: logs.slice(-20),
      };
    };
    const follow: ChatReply[] = [];
    a.onResumed((r) => follow.push(r));
    try {
      await a.ready();
      await b.ready();
      await a.kaji.add(records);
      await b.kaji.add(records);
      a.setBaseKey(A.publicKey);
      b.setBaseKey(B.publicKey);
      // Wired as serve does: offers from config, heard offers kept, actions run by runFromPeer.
      const la = new KajiLink({
        worker: a.worker,
        baseId: 'NERV-01',
        key: A.privateKey,
        publicKey: A.publicKey,
        registry: a.kaji,
        log: (l) => logs.push('NERV-01 ' + l),
        onOffers: (id, t) => {
          heard[id] = t;
          a.notePeerOffers(id, t);
        },
      });
      const lb = new KajiLink({
        worker: b.worker,
        baseId: 'NERV-02',
        key: B.privateKey,
        publicKey: B.publicKey,
        registry: b.kaji,
        log: (l) => logs.push('NERV-02 ' + l),
        offers: () => (advertise ? ['reminders.add'] : []),
      });
      links.push(la, lb);
      await reserved.release();
      await Promise.all([la.start(200), lb.start(200)]);
      a.startResumer(100);
      assert.equal((await a.remoteOffers()).length, 0, 'initial heartbeat has no offers yet');
      advertise = true;
      await until(async () => (await a.remoteOffers()).length === 1, describe);
      await until(() => logs.some((l) => l.includes('Worker connected: NERV-02')), describe);
      const chat = await a.chat('Remind me on Tabgha to stretch');
      assert.match(
        model.systems[0]!,
        /kaji\.run[\s\S]*NERV-02 \(Tabgha\): reminders\.add/,
        'Misato sees what Tabgha offers',
      );
      assert.equal(chat.steps[0]!.outcome, 'invalid', 'an action Tabgha does not offer goes back to Misato');
      assert.match(chat.steps[0]!.error!, /Tabgha does not offer "reminders.cancel"/);
      assert.equal(chat.waiting.length, 1, 'every kaji.run asks the owner first');
      // B-012: Casper is told the bases by id and name, so "on Tabgha" matches kaji.run for NERV-02.
      assert.ok(
        (JSON.parse(model.casperPrompts.at(-1)!) as { bases: { id: string; name: string }[] }).bases.some(
          (b) => b.id === 'NERV-02' && b.name === 'Tabgha',
        ),
      );
      assert.equal(chat.waiting[0]!.tool, 'kaji.run');
      assert.equal((await b.list()).length, 0, 'nothing on Tabgha before the owner decides');
      a.startOutbox((base, item, dispatching) => la.run(base, item, 5000, dispatching), 100);
      await a.decide(chat.waiting[0]!.approvalId, 'approve', 'api');
      await until(async () => (await b.list()).length === 1, describe);
      assert.equal((await b.list())[0]!.title, 'Stretch');
      // B-011: in plain words, and recorded on the sortie (trace, dashboard, why).
      await until(
        () => follow.some((f) => f.reply === 'Tabgha ran reminders.add (“Stretch”).'),
        async () => ({ ...(await describe()), follow }),
      );
      const recorded = (await a.events(chat.sortieId)).filter((e) => e.kind === 'kaji.result');
      assert.deepEqual(
        recorded.map((e) => e.payload),
        [{ base: 'Tabgha', tool: 'reminders.add', outcome: 'grant', text: 'Tabgha ran reminders.add (“Stretch”).' }],
      );
      assert.match(
        (await a.chat(`why S-${chat.sortieId.slice(0, 4).toUpperCase()}?`)).reply!,
        /Kaji: Tabgha ran reminders\.add \(“Stretch”\)\./,
      );
      // A resend with the same id (a crash before the result was saved) returns the first result and runs nothing again.
      const twice = {
        sequence: 900,
        id: '00000000-0000-4000-8000-000000000000',
        request: '',
        tool: 'reminders.add',
        args: { title: 'Twice', due: '2031-01-01T09:00:00Z' },
      };
      const first = await la.run('NERV-02', twice, 5000),
        second = await la.run('NERV-02', twice, 5000);
      assert.equal(first.reached, true);
      assert.deepEqual(second.result, first.result, 'the first result comes back');
      assert.equal((await b.list()).filter((r) => r.title === 'Twice').length, 1, 'the same id runs once');
      // Only what is offered, and only from the main base.
      const refused = await la.run(
        'NERV-02',
        {
          sequence: 901,
          id: '11111111-1111-4111-8111-111111111111',
          request: '',
          tool: 'reminders.cancel',
          args: { id: 'x' },
        },
        5000,
      );
      assert.match(JSON.stringify(refused.result), /does not offer reminders\.cancel/);
      const body = JSON.stringify({
        id: '22222222-2222-4222-8222-222222222222',
        request: '',
        tool: 'reminders.add',
        args: { title: 'x', due: '2031-01-01T09:00:00Z' },
      });
      assert.equal(
        (
          await fetch(`http://127.0.0.1:${pa}/kaji/run`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...signedHeaders('NERV-02', B.privateKey, 'req', 'POST', '/kaji/run', body),
            },
            body,
          })
        ).status,
        403,
        'Tabgha cannot run actions on the main base',
      );
    } finally {
      await Promise.allSettled([reserved.release()]);
      for (const l of links) await l.stop();
      await a.close();
      await b.close();
      await model.close();
      rmSync(ha, { recursive: true, force: true });
      rmSync(hb, { recursive: true, force: true });
    }
  },
);

test('B-029: fixture ports stay distinct and bound through setup, and the wait tolerates a missed exchange', async () => {
  const reserved = await reservePorts(2);
  try {
    assert.equal(new Set(reserved.ports).size, 2);
    for (const port of reserved.ports) {
      const s = createServer();
      await assert.rejects(
        new Promise<void>((done, fail) => {
          s.once('error', fail);
          s.listen(port, '127.0.0.1', () => {
            s.close(() => done());
          });
        }),
        { code: 'EADDRINUSE' },
      );
    }
    let probes = 0;
    await until(
      () => ++probes === 3,
      () => ({ probes }),
      1000,
    );
    assert.equal(probes, 3);
  } finally {
    await reserved.release();
  }
});
test('B-029: a failed wait reports the observed connection and offer state', async () => {
  const snapshot = { connected: false, offers: [], logs: ['NERV-02 listen EADDRINUSE'] };
  await assert.rejects(
    until(
      () => false,
      () => snapshot,
      0,
    ),
    (e) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /Kaji wait timed out/);
      assert.ok(e.message.includes(JSON.stringify(snapshot)));
      return true;
    },
  );
});
test('B-094: kaji.run to a revoked base says it is revoked, not offline', { timeout: 30000 }, async (t) => {
  const { Runtime } = await import('../src/runtime.ts');
  const A = keys(),
    C = keys();
  const model = await fakeModel([
    '{"action":{"tool":"kaji.run","args":{"base":"NERV-03","tool":"reminders.add","args":{"title":"Stretch","due":"2031-01-01T09:00:00Z"}}}}',
    '{"reply":"Done."}',
  ]);
  const home = mkdtempSync(join(tmpdir(), 'nerv-run-revoked-'));
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      base: { id: 'NERV-01', name: 'Neo Tokyo-3' },
      kaji: { root: root.publicKey },
      models: { local: { baseUrl: model.url, model: 'm' } },
    }),
  );
  const a = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  t.after(async () => {
    await a.close();
    await model.close();
    rmSync(home, { recursive: true, force: true });
  });
  await a.ready();
  await a.kaji.add([
    rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Neo Tokyo-3', publicKey: A.publicKey, address: '127.0.0.1:1' }),
    rec({ kind: 'enrol', baseId: 'NERV-03', name: 'Calvary', publicKey: C.publicKey, address: '127.0.0.1:2' }),
    rec({ kind: 'revoke', baseId: 'NERV-03', publicKey: C.publicKey }),
  ]);
  a.setBaseKey(A.publicKey);
  const chat = await a.chat('Remind me on Calvary to stretch');
  const step = chat.steps.find((s) => s.tool === 'kaji.run');
  assert.ok(step, JSON.stringify(chat));
  assert.equal(step.outcome, 'invalid');
  assert.match(step.error!, /NERV-03 \(Calvary\) is revoked/);
  assert.doesNotMatch(step.error!, /online/i);
});
test("B-094: a kaji.result recorded before Misato's final reply is in that reply", { timeout: 60000 }, async (t) => {
  const { Runtime } = await import('../src/runtime.ts');
  const A = keys(),
    B = keys();
  const reserved = await reservePorts(2);
  const [pa, pb] = reserved.ports;
  t.after(() => reserved.release());
  let sortieId = '';
  const resultRecorded = async () => !!sortieId && (await a.events(sortieId)).some((e) => e.kind === 'kaji.result');
  const model = await fakeModel([
    '{"action":{"tool":"kaji.run","args":{"base":"NERV-02","tool":"reminders.add","args":{"title":"Stretch","due":"2031-01-01T09:00:00Z"}}}}',
    // As in the live trace: the worker answers while Misato is still writing her reply.
    async () => {
      await until(resultRecorded, () => 'no kaji.result recorded');
      return '{"reply":"Sent to Tabgha; the result follows."}';
    },
  ]);
  const ha = mkdtempSync(join(tmpdir(), 'nerv-run-a-')),
    hb = mkdtempSync(join(tmpdir(), 'nerv-run-b-'));
  writeFileSync(
    join(ha, 'config.json'),
    JSON.stringify({
      base: { id: 'NERV-01', name: 'Neo Tokyo-3' },
      kaji: { root: root.publicKey },
      models: { local: { baseUrl: model.url, model: 'm' } },
    }),
  );
  writeFileSync(
    join(hb, 'config.json'),
    JSON.stringify({
      base: { id: 'NERV-02', name: 'Tabgha' },
      kaji: { root: root.publicKey, offers: ['reminders.add'] },
    }),
  );
  const records = [
    rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Neo Tokyo-3', publicKey: A.publicKey, address: `127.0.0.1:${pa}` }),
    rec({ kind: 'enrol', baseId: 'NERV-02', name: 'Tabgha', publicKey: B.publicKey, address: `127.0.0.1:${pb}` }),
    rec({ kind: 'main', baseId: 'NERV-01' }),
  ];
  const a = new Runtime(join(ha, 'nerv.sqlite'), undefined, ha);
  const b = new Runtime(join(hb, 'nerv.sqlite'), undefined, hb);
  const links: KajiLink[] = [];
  const logs: string[] = [];
  const follow: ChatReply[] = [];
  a.onResumed((r) => follow.push(r));
  const describe = async () => ({ offers: await a.remoteOffers(), follow, logs: logs.slice(-20) });
  try {
    await a.ready();
    await b.ready();
    await a.kaji.add(records);
    await b.kaji.add(records);
    a.setBaseKey(A.publicKey);
    b.setBaseKey(B.publicKey);
    const la = new KajiLink({
      worker: a.worker,
      baseId: 'NERV-01',
      key: A.privateKey,
      publicKey: A.publicKey,
      registry: a.kaji,
      log: (l) => logs.push('NERV-01 ' + l),
      onOffers: (id, offered) => a.notePeerOffers(id, offered),
    });
    const lb = new KajiLink({
      worker: b.worker,
      baseId: 'NERV-02',
      key: B.privateKey,
      publicKey: B.publicKey,
      registry: b.kaji,
      log: (l) => logs.push('NERV-02 ' + l),
      offers: () => ['reminders.add'],
    });
    links.push(la, lb);
    await reserved.release();
    await Promise.all([la.start(200), lb.start(200)]);
    a.startResumer(100);
    await until(async () => (await a.remoteOffers()).length === 1, describe);
    await until(() => logs.some((l) => l.includes('Worker connected: NERV-02')), describe);
    const chat = await a.chat('Remind me on Tabgha to stretch');
    sortieId = chat.sortieId;
    assert.equal(chat.waiting[0]?.tool, 'kaji.run', JSON.stringify(chat));
    a.startOutbox((base, item, dispatching) => la.run(base, item, 5000, dispatching), 100);
    await a.decide(chat.waiting[0]!.approvalId, 'approve', 'api');
    await until(() => follow.some((f) => f.sortieId === sortieId && f.reply?.startsWith('Sent to Tabgha')), describe);
    const reply = follow.find((f) => f.sortieId === sortieId && f.reply?.startsWith('Sent to Tabgha'))!.reply!;
    assert.equal(reply, 'Sent to Tabgha; the result follows.\n\nTabgha ran reminders.add (“Stretch”).');
    const replied = (await a.events(sortieId)).filter((e) => e.kind === 'misato.reply').at(-1);
    assert.match(JSON.stringify(replied?.payload), /Tabgha ran reminders\.add/, 'the recorded reply carries it too');
  } finally {
    for (const l of links) await l.stop();
    await a.close();
    await b.close();
    await model.close();
    rmSync(ha, { recursive: true, force: true });
    rmSync(hb, { recursive: true, force: true });
  }
});

test('F-021-T04: offer names: MCP tools as server.tool, nothing that could smuggle text into a prompt', () => {
  assert.deepEqual(sanitizeOffers(['notes.read_note', 'reminders.add', 'my-files.list-dir', 'gh.searchIssues']), [
    'notes.read_note',
    'reminders.add',
    'my-files.list-dir',
    'gh.searchIssues',
  ]);
  for (const bad of [
    'notes',
    'notes.read note',
    'Notes.read',
    'a.b.c',
    'notes.ignore all previous',
    'x'.repeat(41) + '.t',
  ])
    assert.equal(sanitizeOffers([bad]), undefined, bad);
  assert.deepEqual(sanitizeOffers(['kaji.run', 'notes.read_note']), ['notes.read_note']);
});

/**
 * F-021-T04: two bases where Tabgha (NERV-02) runs the fake MCP server and offers notes.read_note and notes.delete_note
 * (only read_note granted). Runs `body`, then tears everything down.
 */
async function withMcpBases(
  t: { after(fn: () => unknown): void },
  opts: { script: string[]; scrolls?: unknown },
  body: (env: {
    a: InstanceType<typeof import('../src/runtime.ts').Runtime>;
    b: InstanceType<typeof import('../src/runtime.ts').Runtime>;
    hb: string;
    fp: string;
    model: Awaited<ReturnType<typeof fakeModel>>;
    ask: (text: string) => Promise<{ sortieId: string; outcome: string; text: string }>;
    setGrant: (grant: { fingerprint?: string; eva?: string }) => Promise<void>;
  }) => Promise<void>,
) {
  const { Runtime } = await import('../src/runtime.ts');
  const FAKE = fileURLToPath(new URL('./fixtures/fake-mcp.mjs', import.meta.url));
  const notes = { id: 'notes', command: process.execPath, args: [FAKE] };
  const probe = new McpClient(notes);
  const fp = fingerprint((await probe.listTools())[0]!);
  probe.close();
  const A = keys(),
    B = keys();
  const reserved = await reservePorts(2);
  const [pa, pb] = reserved.ports;
  t.after(() => reserved.release());
  const model = await fakeModel(opts.script);
  const ha = mkdtempSync(join(tmpdir(), 'nerv-mcp-a-')),
    hb = mkdtempSync(join(tmpdir(), 'nerv-mcp-b-'));
  writeFileSync(
    join(ha, 'config.json'),
    JSON.stringify({
      base: { id: 'NERV-01', name: 'Neo Tokyo-3' },
      kaji: { root: root.publicKey },
      models: { local: { baseUrl: model.url, model: 'm' } },
    }),
  );
  const tabghaConfig = (grant: { fingerprint?: string; eva?: string } = {}) =>
    writeFileSync(
      join(hb, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-02', name: 'Tabgha' },
        kaji: { root: root.publicKey, offers: ['notes.read_note', 'notes.delete_note'] },
        tools: {
          mcp: [notes],
          grants: [
            {
              server: 'notes',
              tool: 'read_note',
              effect: 'read',
              eva: grant.eva ?? '00',
              fingerprint: grant.fingerprint ?? fp,
            },
          ],
        },
      }),
    );
  tabghaConfig();
  if (opts.scrolls) writeFileSync(join(hb, 'scrolls.json'), JSON.stringify(opts.scrolls), { mode: 0o600 });
  const records = [
    rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Neo Tokyo-3', publicKey: A.publicKey, address: `127.0.0.1:${pa}` }),
    rec({ kind: 'enrol', baseId: 'NERV-02', name: 'Tabgha', publicKey: B.publicKey, address: `127.0.0.1:${pb}` }),
    rec({ kind: 'main', baseId: 'NERV-01' }),
  ];
  const a = new Runtime(join(ha, 'nerv.sqlite'), undefined, ha),
    b = new Runtime(join(hb, 'nerv.sqlite'), undefined, hb);
  const links: KajiLink[] = [];
  const logs: string[] = [];
  const describe = async () => ({ offers: await a.remoteOffers(), logs: logs.slice(-20) });
  try {
    await a.ready();
    await b.ready();
    await a.kaji.add(records);
    await b.kaji.add(records);
    a.setBaseKey(A.publicKey);
    b.setBaseKey(B.publicKey);
    const la = new KajiLink({
      worker: a.worker,
      baseId: 'NERV-01',
      key: A.privateKey,
      publicKey: A.publicKey,
      registry: a.kaji,
      log: (l) => logs.push('NERV-01 ' + l),
      onOffers: (id, offered) => a.notePeerOffers(id, offered),
    });
    const lb = new KajiLink({
      worker: b.worker,
      baseId: 'NERV-02',
      key: B.privateKey,
      publicKey: B.publicKey,
      registry: b.kaji,
      log: (l) => logs.push('NERV-02 ' + l),
      offers: () => ['notes.read_note', 'notes.delete_note'],
    });
    links.push(la, lb);
    await reserved.release();
    await Promise.all([la.start(200), lb.start(200)]);
    a.startResumer(100);
    await until(async () => (await a.remoteOffers()).length === 1, describe);
    await until(() => logs.some((l) => l.includes('Worker connected: NERV-02')), describe);
    a.startOutbox((base, item, dispatching) => la.run(base, item, 5000, dispatching), 100);
    // One request on the main base: the owner approves its kaji.run there, and the other base's answer comes back.
    const ask = async (text: string) => {
      const chat = await a.chat(text);
      assert.equal(chat.waiting[0]?.tool, 'kaji.run', JSON.stringify(chat));
      await a.decide(chat.waiting[0]!.approvalId, 'approve', 'api');
      await until(async () => (await a.events(chat.sortieId)).some((e) => e.kind === 'kaji.result'), describe);
      const got = (await a.events(chat.sortieId)).find((e) => e.kind === 'kaji.result')!.payload as {
        outcome: string;
        text: string;
      };
      return { sortieId: chat.sortieId, ...got };
    };
    const setGrant = async (grant: { fingerprint?: string; eva?: string }) => {
      tabghaConfig(grant);
      await b.externalTools(true);
    };
    await body({ a, b, hb, fp, model, ask, setGrant });
  } finally {
    await Promise.allSettled([reserved.release()]);
    for (const l of links) await l.stop();
    await a.close();
    await b.close();
    await model.close();
    rmSync(ha, { recursive: true, force: true });
    rmSync(hb, { recursive: true, force: true });
  }
}
const readOn = (base: string, tool: string) =>
  `{"action":{"tool":"kaji.run","args":{"base":"${base}","tool":"${tool}","args":{"name":"shopping"}}}}`;

test(
  'F-021-T04: an MCP tool granted on another base runs there through kaji.run, its grant re-checked there; an ungranted, changed or EVA-03 one never runs',
  { timeout: 90000 },
  async (t) => {
    await withMcpBases(
      t,
      {
        script: [
          readOn('NERV-02', 'notes.read_note'),
          '{"reply":"Asked Tabgha."}',
          readOn('NERV-02', 'notes.delete_note'),
          '{"reply":"Asked Tabgha to delete it."}',
          readOn('NERV-02', 'notes.read_note'),
          '{"reply":"Asked again."}',
          readOn('NERV-02', 'notes.read_note'),
          '{"reply":"And again."}',
        ],
      },
      async ({ a, b, model, ask, setGrant }) => {
        const read = await ask('Read my shopping note on Tabgha');
        assert.match(model.systems[0]!, /NERV-02 \(Tabgha\): notes\.read_note/, 'Misato sees the offered MCP tool');
        assert.equal(read.outcome, 'grant');
        assert.match(read.text, /Tabgha ran notes\.read_note/);
        assert.match(read.text, /buy milk and bread/, 'the MCP server answered on Tabgha');
        // Outside content on both bases: the asking sortie here, and the job's sortie there, which is closed.
        assert.equal((await a.sortie(read.sortieId))?.trust, 'tainted');
        const there = (await b.sorties()).find(
          (s) => s.title.includes('notes.read_note') || s.title.includes('From NERV-01'),
        );
        assert.ok(there, JSON.stringify(await b.sorties()));
        assert.equal(there.trust, 'tainted');
        assert.equal(there.status, 'done', 'the job’s sortie on Tabgha closes');
        const evThere = (await b.events(there.id)).map((e) => e.kind);
        assert.ok(evThere.includes('grant.used') && evThere.includes('action.done'), evThere.join(', '));

        const del = await ask('Delete my shopping note on Tabgha');
        assert.equal(del.outcome, 'refused');
        assert.match(del.text, /notes\.delete_note is not granted on this base/);

        await setGrant({ fingerprint: 'ffffffffffffffff' });
        const stale = await ask('Read it again');
        assert.equal(stale.outcome, 'refused', 'a grant whose description no longer matches is suspended there');
        assert.match(stale.text, /notes\.read_note is not granted on this base now/);

        await setGrant({ eva: '03' });
        const quarantined = await ask('Read it once more');
        assert.equal(quarantined.outcome, 'refused');
        assert.match(quarantined.text, /granted for EVA-03/);
      },
    );
  },
);

test(
  "F-021-T04: an MCP job the other base's gate would send to its owner is refused there, its card rejected and its receipt saying so",
  { timeout: 60000 },
  async (t) => {
    await withMcpBases(
      t,
      {
        script: [readOn('NERV-02', 'notes.read_note'), '{"reply":"Asked Tabgha."}'],
        scrolls: { deny: [], blue: ['notes.read_note'], syncThreshold: 80, maxRejects: 3, budget: 1 },
      },
      async ({ b, hb, ask }) => {
        const r = await ask('Read my shopping note on Tabgha');
        assert.equal(r.outcome, 'refused');
        assert.match(r.text, /needs the owner's approval on this base/);
        assert.deepEqual(await b.approvals(), [], 'no card is left waiting on Tabgha');
        const db = new DatabaseSync(join(hb, 'nerv.sqlite'), { readOnly: true });
        try {
          const job = db.prepare('SELECT state, result FROM worker_jobs').get() as { state: string; result: string };
          assert.match(job.result, /needs the owner's approval on this base/, 'a resend hears the same refusal');
          const card = db.prepare('SELECT decision, source FROM approvals').get() as {
            decision: string;
            source: string;
          };
          assert.deepEqual({ ...card }, { decision: 'reject', source: 'kaji-mcp' });
        } finally {
          db.close();
        }
      },
    );
  },
);

test('F-021-T04: kaji offer accepts a granted MCP tool and refuses one that is not granted', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-offer-mcp-'));
  try {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        kaji: { root: root.publicKey },
        tools: {
          mcp: [{ id: 'notes', command: process.execPath, args: ['-e', ''] }],
          grants: [{ server: 'notes', tool: 'read_note', effect: 'read', eva: '00', fingerprint: '0123456789abcdef' }],
        },
      }),
    );
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ['src/cli.ts', 'kaji', 'offer', ...args], {
        env: { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' },
        encoding: 'utf8',
      });
    const ok = cli('notes.read_note', 'reminders.add');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /now offers: notes\.read_note, reminders\.add/);
    const bad = cli('notes.delete_note');
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /Not an action this base can offer: notes\.delete_note/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
