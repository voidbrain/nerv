// Shared fixture of the worker-link tests (test/worker-link*.test.ts): two bases, each a full Runtime, joined by
// signed WebSocket links. B-118: the tests were split over three files so they run in parallel; the fixture is shared.
import assert from 'node:assert/strict';
import { after, afterEach } from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { WorkerLink, type WorkerAdapter } from '../../src/worker-link.ts';
import { signedHeaders } from '../../src/kaji-auth.ts';
import { signRecord, type RegistryBody } from '../../src/kaji.ts';
import { Runtime } from '../../src/runtime.ts';
export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
// B-118: node:test cancels a test at its timeout without stopping its function, so a test's own `finally` may never
// run; its two Runtimes (four child processes), links and HTTP server then kept the file's process alive for good
// (Windows run 45307748925 stopped at its 18-minute limit). Every fixture therefore registers each resource as it
// creates it, and these hooks close what is still open after every test (also a timed-out one) and after the file.
// A close is idempotent and bounded, and a fixture whose test already ended stops building and closes what it made.
// A fixture still open here was left by a test that did not close it (cancelled at its timeout, most likely): its last
// step is printed so a CI report names where the test was waiting.
const open = new Set<{ close: () => Promise<void>; last: () => string }>();
const closeOpen = () =>
  Promise.all(
    [...open].map((f) => {
      process.stderr.write(`B-118: worker-link fixture left open by its test; last step ${f.last()}\n`);
      return f.close();
    }),
  );
afterEach(closeOpen);
after(closeOpen);
const brain = new URL('./idle-brain.ts', import.meta.url);
/** Resolves after `ms` without holding the process open. */
const grace = (ms: number) => new Promise<void>((done) => setTimeout(done, ms).unref());
function scope() {
  const closers: (() => unknown)[] = [];
  const born = performance.now();
  let closing: Promise<void> | undefined,
    step = 'creating the fixture',
    stepAt = born;
  const self = {
    /** Names what the fixture is waiting for now, for the report above. */
    step(name: string) {
      step = name;
      stepAt = performance.now();
    },
    last: () => `"${step}", ${Math.round(stepAt - born)} ms after the fixture started`,
    /** Registers a resource's closer; once the scope is closed, closes the resource at once and stops the caller. */
    add<T>(resource: T, close: (resource: T) => unknown): T {
      if (closing) {
        void Promise.resolve()
          .then(() => close(resource))
          .catch(() => {});
        throw Error('Worker-link fixture already closed: its test ended.');
      }
      closers.push(() => close(resource));
      return resource;
    },
    /** A link started after its test ended would keep the process alive: starting then fails instead. */
    guard(link: WorkerLink) {
      const start = link.start.bind(link);
      link.start = () => {
        if (closing) throw Error('Worker-link fixture already closed: its test ended.');
        start();
      };
      return self.add(link, (l) => l.stop());
    },
    /** Closes in reverse order; each step gets at most 10 s, so a stuck step never holds the rest. */
    close() {
      closing ??= (async () => {
        open.delete(self);
        for (const closer of closers.reverse())
          await Promise.race([Promise.resolve().then(closer).catch(() => {}), grace(10_000)]);
      })();
      return closing;
    },
  };
  open.add(self);
  return self;
}
// On Windows a child that has just been killed can still hold the database for a moment.
const removeHome = (home: string) => {
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A leftover temporary directory is not worth failing the run over.
  }
};
export async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > end) throw Error('Worker condition timed out');
    await wait(20);
  }
}
export const keys = () => {
  const k = generateKeyPairSync('ed25519');
  return {
    privateKey: k.privateKey,
    publicKey: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
};
export const item = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  sequence: n,
  request: 'Add a neutral reminder',
  tool: 'reminders.add',
  args: { title: 'Neutral ' + n, due: '2031-01-01T09:00:00Z' },
});
// workerHeartbeatMs lets a test keep the worker side quiet, so only the coordinator heartbeat is in flight.
// B-046 remedy (a): fixtures use a 500 ms ping budget, above measured store latency (50-270 ms) and Windows scheduling
// delays. B-066-T02 had set 150 ms again; Windows CI then lost sessions in unrelated tests (B-066-T03).
export async function fixture(heartbeatMs = 500, workerHeartbeatMs = heartbeatMs) {
  const own = scope();
  const root = keys(),
    a = keys(),
    b = keys(),
    homeA = own.add(mkdtempSync(join(tmpdir(), 'nerv-worker-a-')), removeHome),
    homeB = own.add(mkdtempSync(join(tmpdir(), 'nerv-worker-b-')), removeHome);
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
  own.add(slow, () => {
    if (slow.length) process.stderr.write(`B-046 slow nervous calls: ${slow.join('; ')}\n`);
  });
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
  const ra = own.add(timed(new Runtime(join(homeA, 'nerv.sqlite'), brain, homeA), 'coordinator'), (r) => r.close());
  let rb = own.add(timed(new Runtime(join(homeB, 'nerv.sqlite'), brain, homeB), 'worker'), (r) => r.close());
  own.step('waiting for both Runtimes to be ready');
  await Promise.all([ra.ready(), rb.ready()]);
  own.step('enrolling both bases');
  const server = own.add(
    createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    }),
    // closeAllConnections: close() alone waits for every upgraded socket a test left open.
    (s) =>
      new Promise<void>((done) => {
        s.close(() => done());
        s.closeAllConnections();
      }),
  );
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
  own.guard(main);
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
  let link = own.guard(worker());
  own.step('fixture built; in the test');
  return {
    main,
    get link() {
      return link;
    },
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
      own.step('start(): waiting for both sides of the link');
      // B-066: the worker marks its client session ready only when the coordinator's acknowledgement arrives, which can
      // land after the coordinator already counts the worker; under CI load F-006-T11 asserted the worker side too early.
      await until(() => main.connected('NERV-02') && link.connected('NERV-01'));
      own.step('started; in the test');
    },
    restartWorker: async () => {
      own.step('restartWorker(): stopping the worker');
      await link.stop();
      await rb.close();
      // Registered again (closing a Runtime twice is harmless): if the test already ended, it is closed at once.
      rb = own.add(timed(new Runtime(join(homeB, 'nerv.sqlite'), brain, homeB), 'worker'), (r) => r.close());
      await rb.ready();
      link = own.guard(worker());
      link.start();
      own.step('restartWorker(): waiting for both sides of the link');
      await until(() => main.connected('NERV-02') && link.connected('NERV-01'));
      own.step('worker restarted; in the test');
    },
    step: (name: string) => own.step(name),
    raw: async (headers: Record<string, string>, path = '/kaji/worker') => {
      return own.add(new WebSocket('ws://' + address + path, { headers }), (socket) => socket.terminate());
    },
    close: () => own.close(),
  };
}
export async function rawReady(f: Awaited<ReturnType<typeof fixture>>, id = 'NERV-02', key = f.b.privateKey) {
  f.step('rawReady(): opening a raw channel');
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
  // B-118: a channel closed before its hello reply fails here at once instead of waiting for the test's timeout.
  const reply = new Promise<unknown>((done, fail) => {
    socket.once('message', (raw) => done(JSON.parse(JSON.parse(raw.toString()).body).rpc));
    socket.once('close', (code) => fail(Error(`Worker channel closed (${code}) before the hello reply.`)));
  });
  f.step('rawReady(): waiting for the hello reply');
  socket.send(hello);
  assert.equal(((await reply) as { result: { version: number } }).result.version, 1);
  f.step('raw channel ready; in the test');
  return { socket, frame, hello, session };
}
