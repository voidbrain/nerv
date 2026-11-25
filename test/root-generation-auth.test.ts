import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { WorkerLink, type WorkerAdapter } from '../src/worker-link.ts';
import { signedHeaders, verifySigned, Nonces } from '../src/kaji-auth.ts';
import { Store } from '../src/store.ts';
import { Registry, signRecord, type RegistryBody } from '../src/kaji.ts';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
const keys = () => {
  const pair = generateKeyPairSync('ed25519');
  return { ...pair, publicText: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
};
async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const p = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return p;
}
const adapter = (registry: Registry): RegistryPort => ({
  bases: async () => registry.bases(),
  records: async () => registry.records(),
  add: async (records) => {
    for (const r of records) registry.add(r);
    return records.length;
  },
  seen: async (u) => registry.seen(u),
  lastSeen: async () => registry.lastSeen(),
});
test('review regression: migrated and old-root peers retaining identical base keys cannot mark each other online', async () => {
  const roots = [keys(), keys()],
    base = [keys(), keys()],
    ports = [await freePort(), await freePort()],
    stores = [new Store(':memory:'), new Store(':memory:')];
  const links: KajiLink[] = [],
    registries: Registry[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const root = roots[i]!,
        registry = new Registry(stores[i]!.db, root.publicText);
      registries.push(registry);
      for (let j = 0; j < 2; j++) {
        const body: RegistryBody = {
          kind: 'enrol',
          serial: j + 1,
          baseId: 'BASE-0' + (j + 1),
          name: 'Neutral ' + j,
          publicKey: base[j]!.publicText,
          address: '127.0.0.1:' + ports[j],
          issued: new Date().toISOString(),
        };
        registry.add(signRecord(root.privateKey, body));
      }
      const options = {
        baseId: 'BASE-0' + (i + 1),
        key: base[i]!.privateKey,
        publicKey: base[i]!.publicText,
        registry: adapter(registry),
        trust: { root: root.publicText, required: i === 1 },
        log: () => {},
      };
      links.push(new KajiLink(options));
    }
    await Promise.all(links.map((link) => link.start(50)));
    await new Promise((done) => setTimeout(done, 350));
    assert.equal(registries[0]!.lastSeen()['BASE-02'], undefined);
    assert.equal(registries[1]!.lastSeen()['BASE-01'], undefined);
  } finally {
    await Promise.all(links.map((link) => link.stop()));
    stores.forEach((store) => store.close());
  }
});

const until = async (check: () => boolean) => {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw Error('Neutral root-bound link timed out');
    await new Promise((done) => setTimeout(done, 20));
  }
};
test('root context is signed and cannot be stripped/relabelled; unmigrated legacy verification remains compatible', () => {
  const base = keys(),
    root = keys(),
    other = keys(),
    bases = [
      {
        baseId: 'BASE-01',
        name: 'Harbor',
        publicKey: base.publicText,
        address: '127.0.0.1:1',
        fingerprint: 'neutral',
        status: 'enrolled' as const,
        serial: 1,
      },
    ],
    trust = { root: root.publicText, required: true };
  const headers = signedHeaders(
    'BASE-01',
    base.privateKey,
    'req',
    'FRAME',
    '/session',
    '{}',
    undefined,
    root.publicText,
  );
  assert.equal(
    verifySigned(headers, 'req', 'FRAME', '/session', '{}', bases, new Nonces(), undefined, trust),
    'BASE-01',
  );
  assert.throws(
    () =>
      verifySigned(
        { ...headers, 'x-kaji-root': other.publicText },
        'req',
        'FRAME',
        '/session',
        '{}',
        bases,
        new Nonces(),
        undefined,
        { root: other.publicText, required: true },
      ),
    /bad signature/,
  );
  const stripped = { ...headers };
  delete stripped['x-kaji-root'];
  assert.throws(
    () => verifySigned(stripped, 'req', 'FRAME', '/session', '{}', bases, new Nonces(), undefined, trust),
    /root generation/,
  );
  const legacy = signedHeaders('BASE-01', base.privateKey, 'req', 'FRAME', '/session', '{}');
  assert.equal(
    verifySigned(legacy, 'req', 'FRAME', '/session', '{}', bases, new Nonces(), undefined, {
      ...trust,
      required: false,
    }),
    'BASE-01',
  );
  assert.throws(
    () => verifySigned(legacy, 'req', 'FRAME', '/session', '{}', bases, new Nonces(), undefined, trust),
    /root generation/,
  );
  assert.throws(
    () =>
      verifySigned(
        { ...legacy, 'x-kaji-root': root.publicText },
        'req',
        'FRAME',
        '/session',
        '{}',
        bases,
        new Nonces(),
        undefined,
        trust,
      ),
    /bad signature/,
  );
});

test('matching migrated root contexts exchange actual Kaji heartbeats', async () => {
  const root = keys(),
    base = [keys(), keys()],
    ports = [await freePort(), await freePort()],
    stores = [new Store(':memory:'), new Store(':memory:')],
    links: KajiLink[] = [],
    registries: Registry[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const registry = new Registry(stores[i]!.db, root.publicText);
      registries.push(registry);
      for (let j = 0; j < 2; j++)
        registry.add(
          signRecord(root.privateKey, {
            kind: 'enrol',
            serial: j + 1,
            baseId: 'BASE-0' + (j + 1),
            name: 'Neutral ' + j,
            publicKey: base[j]!.publicText,
            address: '127.0.0.1:' + ports[j],
            issued: new Date().toISOString(),
          }),
        );
      links.push(
        new KajiLink({
          baseId: 'BASE-0' + (i + 1),
          key: base[i]!.privateKey,
          publicKey: base[i]!.publicText,
          registry: adapter(registry),
          trust: { root: root.publicText, required: true },
          log: () => {},
        }),
      );
    }
    await Promise.all(links.map((link) => link.start(50)));
    await until(() => !!registries[0]!.lastSeen()['BASE-02'] && !!registries[1]!.lastSeen()['BASE-01']);
  } finally {
    await Promise.all(links.map((link) => link.stop()));
    stores.forEach((store) => store.close());
  }
});

test(
  'root-bound worker upgrade and every signed frame refuse legacy/foreign roots while matching roots negotiate and dispatch once',
  { timeout: 15000 },
  async () => {
    const root = keys(),
      other = keys(),
      a = keys(),
      b = keys(),
      store = new Store(':memory:'),
      registry = new Registry(store.db, root.publicText),
      server = httpServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = '127.0.0.1:' + (server.address() as { port: number }).port;
    let calls = 0;
    const entries = [
      { baseId: 'BASE-01', name: 'Harbor', publicKey: a.publicText, address },
      { baseId: 'BASE-02', name: 'Garden', publicKey: b.publicText, address: '127.0.0.1:1' },
    ];
    for (let i = 0; i < entries.length; i++)
      registry.add(
        signRecord(root.privateKey, { kind: 'enrol', serial: i + 1, ...entries[i]!, issued: new Date().toISOString() }),
      );
    registry.add(
      signRecord(root.privateKey, { kind: 'main', serial: 3, baseId: 'BASE-01', issued: new Date().toISOString() }),
    );
    const port = { ...adapter(registry), main: async () => registry.main() },
      workerAdapter: WorkerAdapter = {
        open: async () => ({ epoch: 1, cursor: 0 }),
        close: async () => {},
        cancel: async () => ({ status: 'cancelled' }),
        run: async () => {
          calls++;
          return { outcome: 'grant', items: [] };
        },
      },
      trust = { root: root.publicText, required: true };
    const main = new WorkerLink({
      id: 'BASE-01',
      key: a.privateKey,
      registry: port,
      adapter: workerAdapter,
      address: (s) => 'ws://' + s,
      trust,
      reconnectMs: 30,
      heartbeatMs: 1000,
    });
    main.attach(server);
    const worker = new WorkerLink({
      id: 'BASE-02',
      key: b.privateKey,
      registry: port,
      adapter: workerAdapter,
      address: (s) => 'ws://' + s,
      trust,
      reconnectMs: 30,
      heartbeatMs: 1000,
    });
    const sockets: WebSocket[] = [];
    try {
      main.start();
      for (const headerRoot of [undefined, other.publicText]) {
        const ws = new WebSocket('ws://' + address + '/kaji/worker', {
          headers: signedHeaders('BASE-02', b.privateKey, 'req', 'GET', '/kaji/worker', '', undefined, headerRoot),
        });
        sockets.push(ws);
        ws.on('error', () => {});
        const status = await new Promise<number>((done) => {
          ws.once('unexpected-response', (request, response) => {
            response.resume();
            done(response.statusCode ?? 0);
            request.destroy();
          });
          ws.once('open', () => done(101));
        });
        assert.equal(status, 401);
        ws.terminate();
      }
      assert.equal(calls, 0);
      worker.start();
      await until(() => main.connected('BASE-02'));
      const id = randomUUID();
      await main.run(
        'BASE-02',
        { id, sequence: 1, request: 'List neutral fixture items', tool: 'reminders.list', args: {} },
        2000,
      );
      assert.equal(calls, 1);
      const ws = new WebSocket('ws://' + address + '/kaji/worker', {
        headers: signedHeaders('BASE-02', b.privateKey, 'req', 'GET', '/kaji/worker', '', undefined, root.publicText),
      });
      sockets.push(ws);
      ws.on('error', () => {});
      await new Promise<void>((done, fail) => {
        const timer = setTimeout(() => fail(Error('Foreign-root frame did not close its channel')), 3000);
        ws.once('close', () => {
          clearTimeout(timer);
          done();
        });
        ws.once('open', () => {
          const session = randomUUID(),
            body = JSON.stringify({
              sequence: 1,
              rpc: {
                jsonrpc: '2.0',
                id: randomUUID(),
                method: 'worker.hello',
                params: { version: 1, epoch: 1, cursor: 0, offers: [] },
              },
            });
          ws.send(
            JSON.stringify({
              session,
              body,
              headers: signedHeaders(
                'BASE-02',
                b.privateKey,
                'req',
                'FRAME',
                '/kaji/worker/' + session,
                body,
                undefined,
                other.publicText,
              ),
            }),
          );
        });
      });
      assert.equal(calls, 1);
    } finally {
      for (const ws of sockets) ws.terminate();
      await worker.stop();
      await main.stop();
      await new Promise<void>((done) => server.close(() => done()));
      store.close();
    }
  },
);
