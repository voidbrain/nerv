import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.ts';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
import { MAX_CHILD_REQUESTS } from '../src/process-client.ts';
import type { RpcFault } from '../src/rpc.ts';

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
