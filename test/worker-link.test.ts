import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { WorkerLink, type WorkerAdapter } from '../src/worker-link.ts';
import { signedHeaders } from '../src/kaji-auth.ts';
import { signRecord, type RegistryBody } from '../src/kaji.ts';
import { Runtime } from '../src/runtime.ts';
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > end) throw Error('Worker condition timed out');
    await wait(20);
  }
}
const keys = () => {
  const k = generateKeyPairSync('ed25519');
  return {
    privateKey: k.privateKey,
    publicKey: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
};
const item = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  sequence: n,
  request: 'Add a neutral reminder',
  tool: 'reminders.add',
  args: { title: 'Neutral ' + n, due: '2031-01-01T09:00:00Z' },
});
// workerHeartbeatMs lets a test keep the worker side quiet, so only the coordinator heartbeat is in flight.
// Remedy (a) for B-046 mechanism (3): test fixtures use a 500 ms ping reply budget, above the measured store latency
// (50–270 ms nervous-process calls on loaded runners). The B-046 stall tests keep 150 ms explicitly.
async function fixture(heartbeatMs = 500, workerHeartbeatMs = heartbeatMs) {
  const root = keys(),
    a = keys(),
    b = keys(),
    homeA = mkdtempSync(join(tmpdir(), 'nerv-worker-a-')),
    homeB = mkdtempSync(join(tmpdir(), 'nerv-worker-b-'));
  for (const [home, id] of [
    [homeA, 'NERV-01'],
    [homeB, 'NERV-02'],
  ])
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        base: { id, name: 'Neutral fixture' },
        kaji: { root: root.publicKey, offers: ['reminders.add'] },
        models: { local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'unused-fixture' } },
      }),
    );
  // B-046 mechanism (3) diagnosis: every frame a link receives awaits its registry, two calls to that side's nervous
  // process, so a ping is answered only after the nervous process gets to them. Nervous calls of 50 ms or more are
  // printed at close (side, method, duration, start on the process clock, calls already in flight; no payload), to
  // compare with the `atMs` of a heartbeat timeout verdict.
  const slow: string[] = [];
  const timed = (runtime: Runtime, side: string) => {
    const call = runtime.nervous.call.bind(runtime.nervous);
    let inflight = 0;
    runtime.nervous.call = async (method, params, timeout) => {
      const start = performance.now(),
        before = inflight++;
      try {
        return await call(method, params, timeout);
      } finally {
        inflight--;
        const ms = performance.now() - start;
        if (ms >= 50 && method !== 'runtime.ping')
          slow.push(`${side} ${method} ${Math.round(ms)}ms at ${Math.round(start)} behind ${before}`);
      }
    };
    return runtime;
  };
  const ra = timed(new Runtime(join(homeA, 'nerv.sqlite'), undefined, homeA), 'coordinator');
  let rb = timed(new Runtime(join(homeB, 'nerv.sqlite'), undefined, homeB), 'worker');
  await Promise.all([ra.ready(), rb.ready()]);
  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = `127.0.0.1:${(server.address() as { port: number }).port}`;
  let serial = 0;
  const record = (body: Omit<RegistryBody, 'serial' | 'issued'>) =>
    signRecord(root.privateKey, { ...body, serial: ++serial, issued: new Date().toISOString() } as RegistryBody);
  const records = [
    record({ kind: 'enrol', baseId: 'NERV-01', name: 'Aster', publicKey: a.publicKey, address }),
    record({ kind: 'enrol', baseId: 'NERV-02', name: 'Harbor', publicKey: b.publicKey, address: '127.0.0.1:1' }),
    record({ kind: 'main', baseId: 'NERV-01' }),
  ];
  await Promise.all([ra.kaji.add(records), rb.kaji.add(records)]);
  const main = new WorkerLink({
    id: 'NERV-01',
    key: a.privateKey,
    registry: ra.kaji,
    adapter: ra.worker,
    address: (s) => 'ws://' + s,
    heartbeatMs,
    requestMs: 1000,
    reconnectMs: 30,
  });
  main.attach(server);
  let adapter: WorkerAdapter = {
    open: (o, s, k, ok) => rb.worker.open(o, s, k, ok),
    close: (o, s) => rb.worker.close(o, s),
    cancel: (o, id, r, k) => rb.worker.cancel(o, id, r, k),
    run: (o, i, c) => rb.worker.run(o, i, c),
  };
  const worker = () =>
    new WorkerLink({
      id: 'NERV-02',
      key: b.privateKey,
      registry: rb.kaji,
      adapter: {
        open: (o, s, k, ok) => adapter.open(o, s, k, ok),
        close: (o, s) => adapter.close(o, s),
        cancel: (o, id, r, k) => adapter.cancel(o, id, r, k),
        run: (o, i, c) => adapter.run(o, i, c),
      },
      address: (s) => 'ws://' + s,
      heartbeatMs: workerHeartbeatMs,
      requestMs: 1000,
      reconnectMs: 30,
    });
  let link = worker();
  const sockets: WebSocket[] = [];
  return {
    main,
    get rb() {
      return rb;
    },
    ra,
    homeB,
    address,
    b,
    record,
    server,
    setAdapter: (next: WorkerAdapter) => {
      adapter = next;
    },
    get adapter() {
      return adapter;
    },
    start: async () => {
      main.start();
      link.start();
      await until(() => main.connected('NERV-02'));
    },
    restartWorker: async () => {
      await link.stop();
      await rb.close();
      rb = timed(new Runtime(join(homeB, 'nerv.sqlite'), undefined, homeB), 'worker');
      await rb.ready();
      link = worker();
      link.start();
      await until(() => main.connected('NERV-02'));
    },
    raw: async (headers: Record<string, string>, path = '/kaji/worker') => {
      const socket = new WebSocket('ws://' + address + path, { headers });
      sockets.push(socket);
      return socket;
    },
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await link.stop();
      await main.stop();
      await new Promise<void>((done) => server.close(() => done()));
      await Promise.all([ra.close(), rb.close()]);
      rmSync(homeA, { recursive: true, force: true });
      rmSync(homeB, { recursive: true, force: true });
      if (slow.length) process.stderr.write(`B-046 slow nervous calls: ${slow.join('; ')}\n`);
    },
  };
}
test(
  'F-014: actual outbound WebSocket, signed identities, destination gate, lost result and reconnect replay one effect',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let committed = false;
    const original = f.adapter;
    try {
      f.setAdapter({
        ...original,
        run: async (o, i, c) => {
          const result = await original.run(o, i, c);
          if (i.id === item(1).id && !committed) {
            committed = true;
            await gate;
          }
          return result;
        },
      });
      await f.start();
      const lost = f.main.run('NERV-02', item(1), 5000);
      const lostOutcome = lost.catch((e) => e);
      await until(() => committed);
      f.main.dropIncoming();
      assert.ok((await lostOutcome) instanceof Error);
      release();
      await until(() => f.main.connected('NERV-02'));
      const replay = (await f.main.run('NERV-02', item(1), 5000)) as { outcome: string };
      assert.equal(replay.outcome, 'grant');
      assert.equal((await f.rb.list()).length, 1);
      await assert.rejects(
        f.main.run('NERV-02', { ...item(1), args: { title: 'Changed', due: '2031-01-01T09:00:00Z' } }, 5000),
      );
      assert.equal((await f.rb.list()).length, 1);
      const second = (await f.main.run('NERV-02', item(2), 5000)) as { outcome: string };
      assert.equal(second.outcome, 'grant');
      assert.equal((await f.rb.list()).length, 2);
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014: restart during unfinished work preserves uncertainty and resource lock until explicit owner reconciliation',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let paused = false;
    const call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        paused = true;
        await gate;
      }
      return call(method, params, timeout);
    };
    try {
      await f.start();
      const request = f.main.run('NERV-02', item(3), 5000).catch((e) => e);
      await until(() => paused);
      await f.restartWorker();
      release();
      await request;
      const retry = (await f.main.run('NERV-02', item(3), 5000)) as { outcome: string };
      assert.equal(retry.outcome, 'uncertain');
      assert.equal((await f.rb.list()).length, 0);
      assert.equal(((await f.main.run('NERV-02', item(4), 5000)) as { retry: boolean }).retry, true);
      assert.throws(() =>
        execFileSync(
          process.execPath,
          ['src/cli.ts', 'workers', 'release', item(3).id, '--reason', 'Fixture stopped'],
          { env: { ...process.env, NERV_HOME: f.homeB }, stdio: 'pipe' },
        ),
      );
      execFileSync(
        process.execPath,
        [
          'src/cli.ts',
          'workers',
          'release',
          item(3).id,
          '--confirmed-stopped',
          '--reason',
          'Fixture process stopped before execution',
        ],
        { env: { ...process.env, NERV_HOME: f.homeB }, stdio: 'pipe' },
      );
      assert.equal(((await f.main.run('NERV-02', item(4), 5000)) as { outcome: string }).outcome, 'grant');
      assert.equal((await f.rb.list()).length, 1);
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014: upgrade rejects missing/bad identity, Origin and token-bearing URLs; live revocation stops work',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      f.main.start();
      for (const [headers, path] of [
        [{}, '/kaji/worker'],
        [
          {
            ...signedHeaders('NERV-02', f.b.privateKey, 'req', 'GET', '/kaji/worker', ''),
            Origin: 'http://example.test',
          },
          '/kaji/worker',
        ],
        [signedHeaders('NERV-02', f.b.privateKey, 'req', 'GET', '/kaji/worker', ''), '/kaji/worker?token=neutral'],
      ] as [Record<string, string>, string][]) {
        const socket = await f.raw(headers, path);
        await new Promise<void>((done, fail) => {
          socket.once('open', () => fail(Error('Unexpected upgrade')));
          socket.once('error', () => {});
          socket.once('unexpected-response', (_req, res) => {
            assert.equal(res.statusCode, 401);
            res.resume();
            socket.terminate();
            done();
          });
        });
      }
      await f.start();
      const revoke = f.record({ kind: 'revoke', baseId: 'NERV-02', publicKey: f.b.publicKey });
      await Promise.all([f.ra.kaji.add([revoke]), f.rb.kaji.add([revoke])]);
      await assert.rejects(f.main.run('NERV-02', item(5), 2000));
      await until(() => !f.main.connected('NERV-02'));
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
test('F-014 review: deferred owner approval retains the worker resource', { timeout: 30000 }, async () => {
  const f = await fixture(),
    original = f.adapter;
  f.setAdapter({ ...original, run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember', 'reminders.add'], c) });
  try {
    await f.start();
    const request = { ...item(10), tool: 'memory.remember', args: { text: 'Neutral fact' } };
    const result = (await f.main.run('NERV-02', request, 5000)) as { outcome: string };
    assert.equal(result.outcome, 'approval');
    assert.equal(
      ((await f.main.run('NERV-02', item(11), 5000)) as { retry?: boolean }).retry,
      true,
      'waiting for the owner still owns the worker resource',
    );
  } finally {
    await f.close();
  }
});
test(
  'F-014 review: approval after disconnect cannot execute with an invalidated worker lease',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    let closed = false;
    f.setAdapter({
      ...original,
      close: async (o, s) => {
        await original.close(o, s);
        closed = true;
      },
      run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember'], c),
    });
    try {
      await f.start();
      const result = (await f.main.run(
        'NERV-02',
        { ...item(12), tool: 'memory.remember', args: { text: 'Neutral fact' } },
        5000,
      )) as { approvalId: string };
      f.main.dropIncoming();
      await until(() => closed);
      const decision = await f.rb.decide(result.approvalId, 'approve', 'api');
      assert.notEqual(decision.decision, 'approve', 'stale worker authority cannot create a grant');
      assert.equal((await f.rb.lilith.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014 review: destination revocation is rechecked inside the scheduler immediately before execution',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, close: async () => {} });
    let entered = false,
      finished = false;
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    const call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        entered = true;
        await gate;
      }
      try {
        return await call(method, params, timeout);
      } finally {
        if (method === 'actions.act') finished = true;
      }
    };
    try {
      await f.start();
      const result = f.main.run('NERV-02', item(13), 5000).catch((e) => e);
      await until(() => entered);
      await f.rb.kaji.add([f.record({ kind: 'revoke', baseId: 'NERV-02', publicKey: f.b.publicKey })]);
      release();
      await until(() => finished);
      await result;
      assert.equal(
        (await f.rb.list()).length,
        0,
        'revoked destination cannot execute even when transport cleanup is delayed',
      );
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014: valid deferred approval executes once, completes its receipt and releases its resource',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember', 'reminders.add'], c) });
    try {
      await f.start();
      const request = { ...item(14), tool: 'memory.remember', args: { text: 'Neutral fact' } };
      const card = (await f.main.run('NERV-02', request, 5000)) as { approvalId: string };
      assert.ok(card.approvalId);
      await f.rb.decide(card.approvalId, 'approve', 'api');
      await f.rb.decide(card.approvalId, 'approve', 'telegram');
      assert.equal((await f.rb.lilith.list()).length, 1);
      assert.equal(((await f.main.run('NERV-02', request, 5000)) as { outcome: string }).outcome, 'grant');
      assert.equal(((await f.main.run('NERV-02', item(15), 5000)) as { outcome: string }).outcome, 'grant');
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: changing the main base enrolled key fences a request already inside planning',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, close: async () => {} });
    let entered = false,
      finished = false;
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done)),
      call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        entered = true;
        await gate;
      }
      try {
        return await call(method, params, timeout);
      } finally {
        if (method === 'actions.act') finished = true;
      }
    };
    try {
      await f.start();
      const request = f.main.run('NERV-02', item(16), 5000).catch((e) => e);
      await until(() => entered);
      const replacement = keys();
      await f.rb.kaji.add([
        f.record({
          kind: 'enrol',
          baseId: 'NERV-01',
          name: 'Aster',
          address: f.address,
          publicKey: replacement.publicKey,
        }),
      ]);
      release();
      await until(() => finished);
      await request;
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014 review: expired pending worker approval releases only proven unexecuted work without an owner tap',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember', 'reminders.add'], c) });
    try {
      await f.start();
      const request = { ...item(17), tool: 'memory.remember', args: { text: 'Neutral fact' } };
      await f.main.run('NERV-02', request, 5000);
      const { Store } = await import('../src/store.ts');
      const store = new Store(join(f.homeB, 'nerv.sqlite'), undefined, { home: f.homeB });
      try {
        store.expire(new Date(Date.now() + 301000));
      } finally {
        store.close();
      }
      assert.equal((await f.rb.approvals()).length, 0, 'lease-expired card is stood down without a tap');
      assert.equal(((await f.main.run('NERV-02', request, 5000)) as { outcome: string }).outcome, 'reject');
      assert.equal(((await f.main.run('NERV-02', item(18), 5000)) as { outcome: string }).outcome, 'grant');
      assert.equal((await f.rb.lilith.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
async function rawReady(f: Awaited<ReturnType<typeof fixture>>, id = 'NERV-02', key = f.b.privateKey) {
  const socket = await f.raw(signedHeaders(id, key, 'req', 'GET', '/kaji/worker', ''));
  await new Promise<void>((done, fail) => {
    socket.once('open', done);
    socket.once('error', fail);
  });
  const session = randomUUID();
  const frame = (sequence: number, method: string, params: object) => {
    const body = JSON.stringify({ sequence, rpc: { jsonrpc: '2.0', id: randomUUID(), method, params } });
    return JSON.stringify({
      session,
      body,
      headers: signedHeaders(id, key, 'req', 'FRAME', '/kaji/worker/' + session, body),
    });
  };
  const hello = frame(1, 'worker.hello', { version: 1, epoch: 1, cursor: 0, offers: [] });
  const reply = new Promise<unknown>((done) =>
    socket.once('message', (raw) => done(JSON.parse(JSON.parse(raw.toString()).body).rpc)),
  );
  socket.send(hello);
  assert.equal(((await reply) as { result: { version: number } }).result.version, 1);
  return { socket, frame, hello, session };
}
test(
  'F-014: invalid version and forbidden worker RPC never reach the destination gate',
  { timeout: 30000 },
  async () => {
    const f = await fixture(10000);
    try {
      f.main.start();
      const raw = await rawReady(f);
      const response = new Promise<{ error: { code: number } }>((done) =>
        raw.socket.once('message', (data) => done(JSON.parse(JSON.parse(data.toString()).body).rpc)),
      );
      raw.socket.send(raw.frame(2, 'approvals.decide', { id: item(1).id, decision: 'approve' }));
      assert.equal((await response).error.code, -32003);
      assert.equal((await f.rb.list()).length, 0);
      raw.socket.terminate();
      await until(() => !f.main.connected('NERV-02'));
      const socket = await f.raw(signedHeaders('NERV-02', f.b.privateKey, 'req', 'GET', '/kaji/worker', ''));
      await new Promise<void>((done) => socket.once('open', done));
      const session = randomUUID(),
        body = JSON.stringify({
          sequence: 1,
          rpc: {
            jsonrpc: '2.0',
            id: randomUUID(),
            method: 'worker.hello',
            params: { version: 99, epoch: 1, cursor: 0, offers: [] },
          },
        });
      const refused = new Promise<{ error: { code: number } }>((done) =>
        socket.once('message', (data) => done(JSON.parse(JSON.parse(data.toString()).body).rpc)),
      );
      socket.send(
        JSON.stringify({
          session,
          body,
          headers: signedHeaders('NERV-02', f.b.privateKey, 'req', 'FRAME', '/kaji/worker/' + session, body),
        }),
      );
      assert.equal((await refused).error.code, -32003);
      assert.equal(f.main.connected('NERV-02'), false);
    } finally {
      await f.close();
    }
  },
);
for (const attack of ['replay', 'gap', 'tamper', 'other-session', 'binary', 'oversized'] as const)
  test(`F-014: ${attack} frame closes the channel without execution`, { timeout: 30000 }, async () => {
    const f = await fixture(10000);
    try {
      f.main.start();
      const raw = await rawReady(f),
        closed = new Promise<void>((done) => raw.socket.once('close', () => done()));
      if (attack === 'replay') raw.socket.send(raw.hello);
      if (attack === 'gap') raw.socket.send(raw.frame(3, 'worker.ping', { offers: [] }));
      if (attack === 'tamper') {
        const encoded = JSON.parse(raw.frame(2, 'worker.ping', { offers: [] }));
        encoded.body = encoded.body.replace('worker.ping', 'worker.run');
        raw.socket.send(JSON.stringify(encoded));
      }
      if (attack === 'other-session') {
        const encoded = JSON.parse(raw.frame(2, 'worker.ping', { offers: [] }));
        encoded.session = randomUUID();
        raw.socket.send(JSON.stringify(encoded));
      }
      if (attack === 'binary')
        raw.socket.send(Buffer.from(raw.frame(2, 'worker.ping', { offers: [] })), { binary: true });
      if (attack === 'oversized') raw.socket.send('x'.repeat(65537));
      await closed;
      await until(() => !f.main.connected('NERV-02'));
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      await f.close();
    }
  });
test(
  'F-014: pending admission remains occupied after timeout until response or disconnect',
  { timeout: 30000 },
  async () => {
    const f = await fixture(10000);
    try {
      f.main.start();
      const raw = await rawReady(f);
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, (_, i) => f.main.run('NERV-02', item(100 + i), 80)),
      );
      assert.ok(results.every((r) => r.status === 'rejected'));
      await assert.rejects(f.main.run('NERV-02', item(104), 80), /pending request bound/);
      assert.equal(f.main.connected('NERV-02'), true);
      raw.socket.terminate();
      await until(() => !f.main.connected('NERV-02'));
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: an asleep peer missing signed heartbeats is disconnected without inferring that work stopped',
  { timeout: 30000 },
  async () => {
    const f = await fixture(50);
    try {
      f.main.start();
      await rawReady(f);
      await until(() => !f.main.connected('NERV-02'));
      await assert.rejects(f.main.run('NERV-02', item(105), 100));
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
// B-046 review: the late-timeout grace is granted once. A peer that never answers still loses its session after a stall:
// within the stall plus the grace budget, not kept alive by repeated deferrals.
test(
  'B-046: after a stall, a peer that never answers is still disconnected after one grace budget',
  { timeout: 30000 },
  async () => {
    // Budget 400 ms against a 600 ms stall: one grace ends the session near 1,000 ms, a second deferral near 1,400 ms.
    const f = await fixture(400);
    const send = WebSocket.prototype.send;
    let pingAt = 0;
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      const sent = (send as (...args: unknown[]) => void).call(this, data, ...rest);
      if (!pingAt && String(data).includes('worker.ping')) {
        pingAt = performance.now();
        setImmediate(() => {
          const end = Date.now() + 600;
          while (Date.now() < end) {
            /* busy on purpose */
          }
        });
      }
      return sent;
    } as typeof send;
    try {
      f.main.start();
      await rawReady(f);
      await until(() => pingAt > 0);
      await until(() => !f.main.connected('NERV-02'));
      const elapsed = performance.now() - pingAt;
      // Stall (600 ms) plus one fresh budget (400 ms), with 300 ms scheduling slack. Heartbeats sent after the stall also
      // end the session near this time, so the once-only grace itself is checked on a single request below.
      assert.ok(elapsed >= 600, `disconnected after ${Math.round(elapsed)} ms, before the stall ended`);
      assert.ok(elapsed < 600 + 400 + 300, `disconnected only after ${Math.round(elapsed)} ms`);
    } finally {
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
// B-046 review of #278: the grace is granted once per request. With no heartbeat traffic, a request the peer never
// answers is rejected after the stall plus one fresh budget (about 1,000 ms), not after a second one (about 1,400 ms).
test('B-046: a stalled request the peer never answers gets one grace budget, not two', { timeout: 30000 }, async () => {
  const f = await fixture(60000);
  const send = WebSocket.prototype.send;
  let sentAt = 0;
  WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
    const sent = (send as (...args: unknown[]) => void).call(this, data, ...rest);
    if (!sentAt && String(data).includes('worker.run')) {
      sentAt = performance.now();
      setImmediate(() => {
        const end = Date.now() + 600;
        while (Date.now() < end) {
          /* busy on purpose */
        }
      });
    }
    return sent;
  } as typeof send;
  try {
    f.main.start();
    await rawReady(f);
    await assert.rejects(f.main.run('NERV-02', item(108), 400), /Worker result unknown after timeout/);
    const elapsed = performance.now() - sentAt;
    // Timers run on the loop's millisecond clock and can fire a fraction of a millisecond before performance.now() says
    // the budget is over (#278 CI run 43106952492: 1000 ms rounded, failing an exact bound); 50 ms of slack still
    // separates "rejected when the stall ended" (about 600 ms) from "after one grace budget" (about 1,000 ms).
    assert.ok(
      elapsed >= 600 + 400 - 50,
      `rejected after ${Math.round(elapsed)} ms, before stall plus one grace budget`,
    );
    assert.ok(elapsed < 600 + 400 + 300, `rejected only after ${Math.round(elapsed)} ms: more than one grace budget`);
  } finally {
    WebSocket.prototype.send = send;
    await f.close();
  }
});
// B-046 (#275 Windows run 43084555427): the grace budget's own timer can fire late too. A second stall that starts
// after the peer answered the stalled ping leaves the answer unread in the socket when that timer fires; the verdict
// must read it first, not end a healthy session.
test(
  'B-046: an answer that arrives during a second stall is read before the grace budget ends the session',
  { timeout: 30000 },
  async () => {
    // Only the coordinator heartbeat runs: both peers share this process, so the stalls would also freeze the peer
    // that answers a reverse-direction ping, which a real remote peer would not (measured 3 of 15 failures from that).
    const f = await fixture(150, 60000);
    const send = WebSocket.prototype.send;
    let hellos = 0,
      armed = false,
      stalledId = '',
      done = false;
    const stall = (ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        /* busy on purpose */
      }
    };
    const rpcOf = (data: unknown) => {
      try {
        return JSON.parse(JSON.parse(String(data)).body).rpc as { id?: string; method?: string; result?: unknown };
      } catch {
        return {};
      }
    };
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      const sent = (send as (...args: unknown[]) => void).call(this, data, ...rest);
      if (String(data).includes('worker.hello')) hellos++;
      const rpc = rpcOf(data);
      if (armed && rpc.method === 'worker.ping' && rpc.id) {
        armed = false;
        stalledId = rpc.id;
        setImmediate(() => stall(200));
      } else if (stalledId && rpc.id === stalledId && 'result' in rpc) {
        stalledId = '';
        // The answer is written; stall again past the grace budget before this process reads it.
        setImmediate(() => {
          stall(200);
          done = true;
        });
      }
      return sent;
    } as typeof send;
    try {
      await f.start();
      const negotiated = hellos;
      armed = true;
      await until(() => done);
      // Sample the session directly, so a lost session that reconnects slowly cannot pass as a kept one.
      for (let i = 0; i < 40; i++) {
        assert.ok(f.main.connected('NERV-02'), 'an answer already received must not be judged a timeout');
        await wait(10);
      }
      assert.equal(hellos - negotiated, 0, 'an answer already received must not be judged a timeout');
    } finally {
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
// B-046 mechanism (3), PR #280: every frame a link receives is verified against its registry, calls to the receiving
// side's nervous process, so the worker answers a ping only after its nervous process has served what was queued ahead.
// Linux coverage run 43121587426 lost a session this way: the worker's `kaji.bases` for the ping waited 225 ms behind a
// 271 ms `usage.finish` write, with this process's loop on time. Under remedy (a) test fixtures have a 500 ms ping
// budget (above measured store latency of 50–270 ms); here the worker's store answers 300 ms late while the loop stays
// free, and the healthy session survives.
test(
  'B-046: a ping waiting on a slow store on the worker does not end a healthy session',
  { timeout: 30000 },
  async () => {
    const f = await fixture(undefined, 60000);
    const send = WebSocket.prototype.send;
    let hellos = 0;
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      if (String(data).includes('worker.hello')) hellos++;
      return (send as (...args: unknown[]) => void).call(this, data, ...rest);
    } as typeof send;
    try {
      await f.start();
      const negotiated = hellos,
        call = f.rb.nervous.call.bind(f.rb.nervous);
      let slowed = 0;
      f.rb.nervous.call = async (method, params = {}, timeout) => {
        // The next registry read waits as if a durable write were ahead of it; no event-loop stall.
        if (method === 'kaji.bases' && !slowed++) await wait(300);
        return call(method, params, timeout);
      };
      await until(() => slowed > 0);
      for (let i = 0; i < 60; i++) {
        assert.ok(f.main.connected('NERV-02'), 'a slow store on the worker is not a lost peer');
        await wait(10);
      }
      assert.equal(hellos - negotiated, 0, 'a slow store on the worker is not a lost peer');
    } finally {
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
test('F-014: concurrent replay and overload execute the same durable request once', { timeout: 30000 }, async () => {
  // Keep heartbeat traffic out of this deliberate four-slot saturation; heartbeat expiry has its own case.
  const f = await fixture(10000);
  try {
    await f.start();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => f.main.run('NERV-02', item(106), 5000)));
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal((await f.rb.list()).length, 1);
    assert.equal(((await f.main.run('NERV-02', item(107), 5000)) as { outcome: string }).outcome, 'grant');
    assert.equal((await f.rb.list()).length, 2);
  } finally {
    await f.close();
  }
});
test(
  'F-014: global worker connection bound rejects excess upgrades and returns capacity after close',
  { timeout: 30000 },
  async () => {
    const f = await fixture(10000);
    try {
      const identities = [{ id: 'NERV-02', key: f.b.privateKey }];
      const records = [];
      for (let i = 3; i <= 17; i++) {
        const key = keys(),
          id = 'NERV-' + String(i).padStart(2, '0');
        identities.push({ id, key: key.privateKey });
        records.push(
          f.record({
            kind: 'enrol',
            baseId: id,
            name: 'Neutral ' + i,
            address: '127.0.0.1:1',
            publicKey: key.publicKey,
          }),
        );
      }
      await f.ra.kaji.add(records);
      f.main.start();
      const peers = await Promise.all(identities.map((identity) => rawReady(f, identity.id, identity.key)));
      const excess = await f.raw(signedHeaders('NERV-02', f.b.privateKey, 'req', 'GET', '/kaji/worker', ''));
      await new Promise<void>((done, fail) => {
        excess.once('open', () => fail(Error('Excess connection admitted')));
        excess.on('error', () => {});
        excess.once('unexpected-response', (_req, res) => {
          assert.equal(res.statusCode, 503);
          res.resume();
          excess.terminate();
          done();
        });
      });
      peers[0]!.socket.terminate();
      await until(() => !f.main.connected('NERV-02'));
      await rawReady(f);
      assert.equal(f.main.connected('NERV-02'), true);
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: signed cancellation before acceptance creates a durable rejection, and completion is never undone',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      await f.start();
      assert.equal((await f.main.cancel('NERV-02', item(200).id, 'Cancel before delivery')).status, 'cancelled');
      assert.equal(((await f.main.run('NERV-02', item(200), 5000)) as { outcome: string }).outcome, 'reject');
      assert.equal((await f.rb.list()).length, 0);
      await f.main.run('NERV-02', item(201), 5000);
      const completed = await f.main.cancel('NERV-02', item(201).id, 'Owner requested cancellation');
      assert.equal(completed.status, 'completed');
      assert.equal((completed.result as { outcome: string }).outcome, 'grant');
      assert.equal((await f.rb.list()).length, 1);
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: cancellation during planning fences execution but retains the resource until the handler terminates',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done)),
      call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        entered = true;
        await gate;
      }
      return call(method, params, timeout);
    };
    try {
      await f.start();
      const running = f.main.run('NERV-02', item(202), 5000);
      await until(() => entered);
      assert.equal((await f.main.cancel('NERV-02', item(202).id, 'Owner stood down request')).status, 'requested');
      assert.equal(((await f.main.run('NERV-02', item(203), 5000)) as { retry: boolean }).retry, true);
      release();
      await running;
      assert.equal((await f.rb.list()).length, 0);
      assert.equal(((await f.main.run('NERV-02', item(203), 5000)) as { outcome: string }).outcome, 'grant');
    } finally {
      release();
      await f.close();
    }
  },
);
test(
  'F-014: cancellation of a deferred approval stands down its card and makes the terminal result replayable',
  { timeout: 30000 },
  async () => {
    const f = await fixture(),
      original = f.adapter;
    f.setAdapter({ ...original, run: (o, i, c) => f.rb.runFromPeer(o, i, ['memory.remember', 'reminders.add'], c) });
    try {
      await f.start();
      const request = { ...item(204), tool: 'memory.remember', args: { text: 'Neutral fact' } };
      await f.main.run('NERV-02', request, 5000);
      assert.equal((await f.main.cancel('NERV-02', request.id, 'Owner cancelled pending fact')).status, 'completed');
      assert.equal((await f.rb.approvals()).length, 0);
      assert.equal((await f.rb.lilith.list()).length, 0);
      assert.equal(((await f.main.run('NERV-02', request, 5000)) as { outcome: string }).outcome, 'reject');
      assert.equal(((await f.main.run('NERV-02', item(205), 5000)) as { outcome: string }).outcome, 'grant');
    } finally {
      await f.close();
    }
  },
);
test(
  'F-014: source Spear sends signed cancellation while delivery is in flight and later records the terminal observation',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done)),
      call = f.rb.nervous.call.bind(f.rb.nervous);
    f.rb.nervous.call = async (method, params = {}, timeout) => {
      if (method === 'actions.preview') {
        entered = true;
        await gate;
      }
      return call(method, params, timeout);
    };
    try {
      await f.start();
      const proposal = await f.ra.act({
        request: 'Neutral delegated reminder',
        tool: 'kaji.run',
        args: {
          base: 'NERV-02',
          tool: 'reminders.add',
          args: { title: 'Cancelled delegated reminder', due: '2031-01-01T09:00:00Z' },
        },
      });
      assert.ok(proposal.approvalId);
      await f.ra.decide(proposal.approvalId!, 'approve', 'api');
      f.ra.startOutbox(
        async (base, i, dispatching) => {
          await dispatching();
          return { reached: true, result: await f.main.run(base, i, 5000) };
        },
        30,
        (base, id, reason) => f.main.cancel(base, id, reason),
      );
      await until(() => entered);
      const stoodDown = await f.ra.spear(proposal.sortieId, 'Owner stood down delegated work');
      assert.equal(stoodDown!.remotePending, 1);
      await until(async () =>
        (await f.ra.events(proposal.sortieId)).some(
          (e) => e.kind === 'kaji.result' && e.payload.outcome === 'uncertain',
        ),
      );
      release();
      await until(
        async () => (await f.ra.events(proposal.sortieId)).filter((e) => e.kind === 'kaji.result').length >= 2,
      );
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      release();
      await f.close();
    }
  },
);

test(
  'B-045: publishing a negotiated worker accepts an immediate admitted burst after its hello acknowledgement',
  { timeout: 30000 },
  async () => {
    const f = await fixture(10000);
    let burst: Promise<PromiseSettledResult<unknown>[]> | undefined;
    f.main.settings.log = () => {
      burst ??= Promise.allSettled(Array.from({ length: 4 }, () => f.main.run('NERV-02', item(108), 5000)));
    };
    try {
      await f.start();
      await until(() => !!burst);
      const results = await burst!;
      assert.ok(
        results.some((result) => result.status === 'fulfilled'),
        'the accepted session must not lose every admitted request behind its own hello acknowledgement',
      );
      assert.equal((await f.rb.list()).length, 1, 'the burst executes one durable effect');
    } finally {
      await f.close();
    }
  },
);

// B-046 review of #278: a peer on earlier code pings on every tick, so a second ping can arrive while the first is still
// handled. It takes a work slot, as before the heartbeat got its own slot, and the session stays up.
test(
  'B-046: an overlapping ping from a peer on earlier code is answered, not refused',
  { timeout: 30000 },
  async () => {
    const f = await fixture(60000);
    try {
      f.main.start();
      const raw = await rawReady(f);
      // Hold the first ping in its handler (the coordinator records presence) until the second one has arrived.
      const seen = f.ra.kaji.seen.bind(f.ra.kaji);
      let release = () => {};
      const gate = new Promise<void>((done) => (release = done));
      let calls = 0;
      (f.ra.kaji as unknown as { seen: (u: Record<string, string>) => unknown }).seen = async (updates) => {
        if (++calls === 1) await gate;
        return seen(updates);
      };
      const answers: unknown[] = [];
      raw.socket.on('message', (data) => answers.push(JSON.parse(JSON.parse(data.toString()).body).rpc));
      raw.socket.send(raw.frame(2, 'worker.ping', { offers: [] }));
      raw.socket.send(raw.frame(3, 'worker.ping', { offers: [] }));
      await until(() => calls >= 2 || !f.main.connected('NERV-02'));
      assert.ok(f.main.connected('NERV-02'), 'an overlapping ping does not end the session');
      release();
      await until(() => answers.length >= 2);
      for (const a of answers) assert.ok(a && typeof a === 'object' && 'result' in a, 'both pings are answered');
      assert.ok(f.main.connected('NERV-02'), 'an overlapping ping does not end the session');
    } finally {
      await f.close();
    }
  },
);

// B-046 (diagnosis 2026-11-11, "Worker pending request bound reached" under load): a heartbeat counted against the
// work in-flight bound, so a link whose four request slots are busy (deferred approvals, slow runs) refused its own
// heartbeat and ended a healthy session; a fifth incoming request (the ping) did the same on the receiving side.
test(
  'B-046: a link whose request slots are all busy keeps its heartbeat and its session',
  { timeout: 30000 },
  async () => {
    const f = await fixture(150);
    const original = f.adapter;
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    f.setAdapter({
      ...original,
      run: async (o, i, c) => {
        await held;
        return original.run(o, i, c);
      },
    });
    const send = WebSocket.prototype.send;
    let hellos = 0;
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      if (String(data).includes('worker.hello')) hellos++;
      return (send as (...args: unknown[]) => void).call(this, data, ...rest);
    } as typeof send;
    try {
      await f.start();
      const negotiated = hellos;
      const busy = [12, 13, 14, 15].map((n) => f.main.run('NERV-02', item(n), 10000).catch((e: unknown) => e));
      // Several heartbeat ticks while every request slot is taken.
      for (let i = 0; i < 60; i++) {
        assert.ok(f.main.connected('NERV-02'), 'a busy link must keep its session');
        await wait(10);
      }
      assert.equal(hellos - negotiated, 0, 'a busy link must not reconnect');
      release();
      await Promise.all(busy);
    } finally {
      release();
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);

// B-046 reproduction (timing reassessment 2026-11-11), committed as todo before the fix; the fix removed the todo.
// The peer is healthy throughout: only this process's event loop is busy.
test(
  'B-046: a healthy session survives an event-loop stall longer than the heartbeat budget',
  { timeout: 30000 },
  async () => {
    const f = await fixture(150);
    const send = WebSocket.prototype.send;
    let pings = 0,
      hellos = 0,
      armed = false;
    const stall = (ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        /* busy on purpose */
      }
    };
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      const sent = (send as (...args: unknown[]) => void).call(this, data, ...rest);
      if (String(data).includes('worker.hello')) hellos++;
      if (armed && String(data).includes('worker.ping')) {
        pings++;
        armed = false;
        setImmediate(() => stall(200));
      }
      return sent;
    } as typeof send;
    try {
      await f.start();
      const negotiated = hellos;
      for (let i = 0; i < 4; i++) {
        const before = pings;
        armed = true;
        await until(() => pings > before);
        await wait(260);
      }
      assert.equal(hellos - negotiated, 0, 'a reply that arrived during the stall must not end the session');
    } finally {
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
