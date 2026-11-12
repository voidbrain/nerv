import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.ts';
import { KajiLink, signedHeaders, type RegistryPort } from '../src/kaji-link.ts';
import { MAX_CHILD_REQUESTS } from '../src/process-client.ts';
import type { RpcFault } from '../src/rpc.ts';
import { createRootKey, signRecord, unlockRootKey, type RegistryBody } from '../src/kaji.ts';

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * B-043: the nervous child stops answering for a while (a stalled runner, a slow disk), modelled by holding every request
 * the coordinator sends to it and releasing them in order later. The ProcessClient bound still counts them as in flight.
 */
function stall(runtime: Runtime) {
  const child = runtime.nervous.child as unknown as {
    send: (message: unknown, callback?: (error: Error | null) => void) => boolean;
  };
  const original = child.send.bind(child);
  const held: { message: unknown; callback?: (error: Error | null) => void }[] = [];
  child.send = (message, callback) => {
    held.push({ message, callback });
    return true;
  };
  return {
    held: (method: string) => held.filter((h) => (h.message as { method?: string }).method === method).length,
    release() {
      if (child.send === original) return;
      child.send = original;
      for (const h of held.splice(0)) original(h.message, h.callback);
    },
  };
}

test('B-043: a stalled nervous child does not let the resumer fill the process queue; other callers still get in', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-overlap-'));
  const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  let child: ReturnType<typeof stall> | undefined;
  try {
    await runtime.ready();
    child = stall(runtime);
    runtime.startResumer(10);
    // Far more than MAX_CHILD_REQUESTS ticks of the resumer while the child does not answer.
    await wait(MAX_CHILD_REQUESTS * 10 * 2);
    assert.ok(
      child.held('misato.resumable') <= 1,
      `one resumer poll at a time, not one per tick (${child.held('misato.resumable')} held)`,
    );
    // A request at the moment the child is slow (Runtime.loop's finish in the CI failure) is not refused.
    const other = runtime.nervous.call('kaji.main').then(
      () => 'answered',
      (e: RpcFault) => `refused ${e.code}`,
    );
    await wait(0);
    child.release();
    assert.equal(await other, 'answered');
    // The resumer keeps working once the child answers again.
    await runtime.sweep();
  } finally {
    child?.release();
    await runtime.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('B-043: a sweep asked for while one is polling gets a fresh poll after it, and many such asks share one', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-overlap-'));
  const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  let child: ReturnType<typeof stall> | undefined;
  try {
    await runtime.ready();
    child = stall(runtime);
    const first = runtime.sweep();
    await wait(20);
    // A decision lands while the first poll is held; its sweep must not reuse the answer to the earlier poll.
    const asked = [runtime.sweep(), runtime.sweep(), runtime.sweep()];
    await wait(20);
    assert.equal(child.held('misato.resumable'), 1, 'only the first poll is sent while it is unanswered');
    let polls = 0;
    const call = runtime.nervous.call.bind(runtime.nervous);
    runtime.nervous.call = (method, ...rest) => {
      if (method === 'misato.resumable') polls++;
      return call(method, ...rest);
    };
    child.release();
    await Promise.all([first, ...asked]);
    assert.equal(polls, 1, 'the sweeps asked for during the first poll share one fresh poll after it');
  } finally {
    child?.release();
    await runtime.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('B-043: a heartbeat tick does not start again while the previous one still waits on the registry', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  let open = true;
  let calls = 0;
  let release = () => {};
  const gate = new Promise<void>((d) => {
    release = d;
  });
  const registry: RegistryPort = {
    bases: async () => {
      calls++;
      if (!open) await gate;
      return [];
    },
    records: async () => [],
    add: async () => 0,
    seen: async () => {},
    lastSeen: async () => ({}),
    main: async () => undefined,
  };
  const link = new KajiLink({
    baseId: 'NERV-01',
    key: privateKey,
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    registry,
    log: () => {},
  });
  try {
    await link.start(10);
    open = false;
    const before = calls;
    await wait(MAX_CHILD_REQUESTS * 10 * 2);
    assert.ok(calls - before <= 1, `one tick at a time while the registry is slow (${calls - before} lookups started)`);
    release();
    await wait(50);
    assert.ok(calls - before >= 2, 'ticks resume once the registry answers');
  } finally {
    release();
    await link.stop();
  }
});

test(
  'B-043: a restart of the link while a tick still waits on the registry does not run two ticks side by side',
  { timeout: 20000 },
  async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    let open = true;
    let calls = 0;
    let release = () => {};
    const gate = new Promise<void>((d) => {
      release = d;
    });
    const registry: RegistryPort = {
      bases: async () => {
        calls++;
        if (!open) await gate;
        return [];
      },
      records: async () => [],
      add: async () => 0,
      seen: async () => {},
      lastSeen: async () => ({}),
      main: async () => undefined,
    };
    const link = new KajiLink({
      baseId: 'NERV-01',
      key: privateKey,
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      registry,
      log: () => {},
    });
    let restarted: Promise<void> = Promise.resolve();
    try {
      await link.start(10);
      open = false;
      const before = calls;
      await wait(50);
      assert.equal(calls - before, 1, 'a tick is waiting on the registry');
      await link.stop();
      // Not awaited: before B-043's fix its first tick would wait on the registry as well.
      restarted = link.start(10);
      await wait(MAX_CHILD_REQUESTS * 10 * 2);
      assert.equal(
        calls - before,
        1,
        `the restarted link waits for the tick still out (${calls - before} lookups started)`,
      );
    } finally {
      release();
      await restarted;
      await link.stop();
    }
  },
);

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

test('B-051: concurrent unsigned requests while the child is slow do not fill the process queue; lookups share one in-flight call', async () => {
  const { ports, release: releasePorts } = await reservePorts(1);
  const port = ports[0]!;
  await releasePorts();
  const home = mkdtempSync(join(tmpdir(), 'nerv-b051-'));
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      base: { id: 'NERV-01', name: 'Main' },
      kaji: { root: root.publicKey },
    }),
  );
  const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  const A = keys();
  const records = [
    rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Main', publicKey: A.publicKey, address: `127.0.0.1:${port}` }),
    rec({ kind: 'main', baseId: 'NERV-01' }),
  ];
  let child: ReturnType<typeof stall> | undefined;
  const link = new KajiLink({
    baseId: 'NERV-01',
    key: A.privateKey,
    publicKey: A.publicKey,
    registry: runtime.kaji,
    log: () => {},
  });
  try {
    await runtime.ready();
    assert.equal(await runtime.kaji.add(records), 2);
    await link.start(5000);
    child = stall(runtime);
    // Send more unsigned requests than the child process queue bound (MAX_CHILD_REQUESTS = 32)
    // while the child is not answering.
    const sends = Array.from({ length: MAX_CHILD_REQUESTS + 5 }, () =>
      fetch(`http://127.0.0.1:${port}/kaji/relay`, {
        method: 'POST',
        body: JSON.stringify({ text: 'unsigned probe' }),
      }).then(
        (r) => ({ status: r.status }),
        (e) => ({ status: 0, error: e instanceof Error ? e.message : String(e) }),
      ),
    );
    await wait(50);
    // Before the fix, every request calls runtime.kaji.bases() separately, so 32 requests fill the
    // queue and any further request or an unrelated caller fails with "Process queue is full" (-32004).
    // After the fix, concurrent lookups share one in-flight call (held <= 1).
    assert.ok(
      child.held('kaji.bases') <= 1,
      `inbound lookups share one in-flight bases() call (${child.held('kaji.bases')} held)`,
    );
    // An unrelated nervous call (e.g. kaji.main) is not refused with "Process queue is full".
    const other = runtime.nervous.call('kaji.main').then(
      () => 'answered',
      (e: RpcFault) => `refused ${e.code}`,
    );
    await wait(0);
    child.release();
    assert.equal(await other, 'answered');
    const results = await Promise.all(sends);
    for (const res of results) {
      assert.ok([401, 403].includes(res.status), `unverified request rejected with 401/403 (got ${res.status})`);
    }
    // Revocation freshness: an enrolled peer's signed request passes, and once revoked, the next lookup rejects it.
    const B = keys();
    await runtime.kaji.add([
      rec({ kind: 'enrol', baseId: 'NERV-02', name: 'Tabgha', publicKey: B.publicKey, address: '127.0.0.1:9999' }),
    ]);
    const signedBody = JSON.stringify({ seen: {} });
    const signedH = signedHeaders('NERV-02', B.privateKey, 'req', 'POST', '/kaji/heartbeat', signedBody);
    const res1 = await fetch(`http://127.0.0.1:${port}/kaji/heartbeat`, {
      method: 'POST',
      headers: signedH,
      body: signedBody,
    });
    assert.equal(res1.status, 200, 'signed request from enrolled peer passes');

    await runtime.kaji.add([rec({ kind: 'revoke', baseId: 'NERV-02', publicKey: B.publicKey })]);
    const signedH2 = signedHeaders('NERV-02', B.privateKey, 'req', 'POST', '/kaji/heartbeat', signedBody);
    const res2 = await fetch(`http://127.0.0.1:${port}/kaji/heartbeat`, {
      method: 'POST',
      headers: signedH2,
      body: signedBody,
    });
    assert.equal(res2.status, 403, 'revoked peer is rejected on next lookup');
  } finally {
    child?.release();
    await link.stop();
    await runtime.close();
    rmSync(home, { recursive: true, force: true });
  }
});
