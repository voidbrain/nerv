import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
import type { BaseEntry, SignedRecord } from '../src/kaji.ts';
import { LinkLoadTracker } from '../src/link-load.ts';

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((done) => s.listen(0, '127.0.0.1', done));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((done) => s.close(() => done()));
  return p;
}

describe('F-103-T02: per-link load between bases', () => {
  it('tracks in-flight calls, latency, bytes each way, and reconnects without storing message content', () => {
    const tracker = new LinkLoadTracker();
    const finish = tracker.trackOutboundStart('base-b', 120);
    assert.equal(tracker.get('base-b')?.inFlight, 1);
    assert.equal(tracker.get('base-b')?.bytesSent, 120);

    finish(45);
    finish(999); // idempotent
    const after = tracker.get('base-b')!;
    assert.equal(after.inFlight, 0);
    assert.equal(after.bytesSent, 120);
    assert.equal(after.bytesReceived, 45);
    assert.equal(after.samples, 1);
    assert.ok(after.lastLatencyMs !== null && after.lastLatencyMs >= 0);

    tracker.recordReconnect('base-b');
    tracker.recordReconnect('base-b');
    assert.equal(tracker.get('base-b')?.reconnects, 2);
  });

  it('join across two KajiLink bases moves counters on both sides without carrying message content', async () => {
    const portA = await freePort();
    const portB = await freePort();
    const keyA = generateKeyPairSync('ed25519');
    const keyB = generateKeyPairSync('ed25519');
    const pubA = keyA.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const pubB = keyB.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    const bases: BaseEntry[] = [
      {
        baseId: 'base-a',
        name: 'Alpha',
        address: `127.0.0.1:${portA}`,
        publicKey: pubA,
        fingerprint: pubA,
        serial: 1,
        status: 'enrolled',
      },
      {
        baseId: 'base-b',
        name: 'Beta',
        address: `127.0.0.1:${portB}`,
        publicKey: pubB,
        fingerprint: pubB,
        serial: 2,
        status: 'enrolled',
      },
    ];
    const seen = new Map<string, string>();
    const port: RegistryPort = {
      bases: async () => bases,
      main: async () => 'base-a',
      records: async () => [] as SignedRecord[],
      add: async () => 0,
      seen: async (updates) => {
        for (const [k, v] of Object.entries(updates)) seen.set(k, v);
      },
      lastSeen: async () => Object.fromEntries(seen),
    };

    const sentinel = 'NEUTRAL_SENTINEL_CONTENT_SHOULD_NOT_APPEAR_IN_COUNTERS';
    const linkA = new KajiLink({
      baseId: 'base-a',
      key: keyA.privateKey,
      publicKey: pubA,
      registry: port,
      health: async () => ({ state: 'online', reasons: [] }),
      onChat: async () => ({
        sortieId: 's-1',
        reply: sentinel,
        steps: [],
        waiting: [],
      }),
    });
    const linkB = new KajiLink({
      baseId: 'base-b',
      key: keyB.privateKey,
      publicKey: pubB,
      registry: port,
      health: async () => ({ state: 'online', reasons: [] }),
    });

    await linkA.start();
    await linkB.start();
    try {
      const reply = await linkB.chat(sentinel, 'telegram', 5000);
      assert.equal(reply?.reply, sentinel);

      const metricsA = linkA.linkMetrics();
      const metricsB = linkB.linkMetrics();

      const fromBOnA = metricsA.find((m) => m.peerId === 'base-b');
      const fromAOnB = metricsB.find((m) => m.peerId === 'base-a');
      assert.ok(fromBOnA, 'base-a must record inbound/outbound traffic with base-b');
      assert.ok(fromBOnA.bytesReceived > 0);
      assert.ok(fromBOnA.bytesSent > 0);

      assert.ok(fromAOnB, 'base-b must record outbound/inbound traffic with base-a');
      assert.ok(fromAOnB.bytesSent > 0);
      assert.ok(fromAOnB.bytesReceived > 0);
      assert.equal(fromAOnB.inFlight, 0);
      assert.ok(fromAOnB.samples >= 1);
      assert.ok(fromAOnB.lastLatencyMs !== null && fromAOnB.lastLatencyMs >= 0);

      const serialized = JSON.stringify({ metricsA, metricsB });
      assert.equal(serialized.includes(sentinel), false, 'counters must never carry message content');
    } finally {
      await linkA.stop();
      await linkB.stop();
    }
  });
});
