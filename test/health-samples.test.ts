import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { HealthSampleStore, startLocalHealthSampler } from '../src/health-samples.ts';

describe('F-103-T01 local health sample', () => {
  it('enforces minimum sampling rate and bounded retention in local SQLite', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const store = new HealthSampleStore(db, {
        minIntervalMs: 10_000,
        maxSamples: 3,
        maxAgeMs: 60_000,
      });

      assert.deepEqual(
        store.record({
          sampledAtMs: 100_000,
          rssBytes: 1024,
          heapUsedBytes: 512,
          cpuUserUs: 100,
          cpuSystemUs: 50,
          eventLoopDelayMs: 1.2,
          pollCount: 1,
        }),
        { recorded: true },
      );

      // Within minIntervalMs -> rate-limited
      assert.deepEqual(
        store.record({
          sampledAtMs: 105_000,
          rssBytes: 1024,
          heapUsedBytes: 512,
          cpuUserUs: 100,
          cpuSystemUs: 50,
          eventLoopDelayMs: 1.2,
          pollCount: 2,
        }),
        { recorded: false, reason: 'rate-limited' },
      );

      // Three more valid samples -> maxSamples=3 retains only the newest 3
      for (const [ts, polls] of [
        [110_000, 3],
        [120_000, 4],
        [130_000, 5],
      ] as const) {
        assert.equal(
          store.record({
            sampledAtMs: ts,
            rssBytes: 2048,
            heapUsedBytes: 1024,
            cpuUserUs: 200,
            cpuSystemUs: 80,
            eventLoopDelayMs: 0.5,
            pollCount: polls,
          }).recorded,
          true,
        );
      }

      const samples = store.list(10);
      assert.equal(samples.length, 3);
      assert.deepEqual(
        samples.map((s) => s.pollCount),
        [5, 4, 3],
      );
    } finally {
      db.close();
    }
  });

  it('captures live process memory, CPU, event-loop delay, and poll counts locally', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const store = new HealthSampleStore(db, { minIntervalMs: 100 });
      const polls = 7;
      const sampler = startLocalHealthSampler(store, () => polls, 60_000);
      try {
        const res = sampler.sampleNow(1000);
        assert.equal(res.recorded, true);
        const rows = store.list();
        assert.equal(rows.length, 1);
        assert.ok(rows[0].rssBytes > 0);
        assert.ok(rows[0].heapUsedBytes > 0);
        assert.equal(rows[0].pollCount, 7);
      } finally {
        sampler.stop();
      }
    } finally {
      db.close();
    }
  });

  it('F-103-T03: validates thresholds and deduplicates crossed sample and link warnings', async () => {
    const { DEFAULT_HEALTH_THRESHOLDS, evaluateHealthWarnings, validateHealthThresholds } =
      await import('../src/health-samples.ts');
    const valid = validateHealthThresholds({
      rssMb: 128,
      eventLoopDelayMs: 25,
      linkLatencyMs: 200,
      inFlight: 2,
      reconnects: 1,
    });
    assert.deepEqual(valid, { rssMb: 128, eventLoopDelayMs: 25, linkLatencyMs: 200, inFlight: 2, reconnects: 1 });
    assert.throws(() => validateHealthThresholds({ rssMb: -1 }), /Invalid health threshold rssMb/);
    assert.deepEqual(validateHealthThresholds(undefined), DEFAULT_HEALTH_THRESHOLDS);

    const warnings = evaluateHealthWarnings(
      {
        sampledAtMs: 1000,
        rssBytes: 256 * 1024 * 1024,
        heapUsedBytes: 64 * 1024 * 1024,
        cpuUserUs: 10,
        cpuSystemUs: 5,
        eventLoopDelayMs: 40,
        pollCount: 3,
      },
      [
        {
          peerId: 'NERV-02',
          bytesSent: 100,
          bytesReceived: 200,
          inFlight: 4,
          reconnects: 3,
          lastLatencyMs: 350,
          avgLatencyMs: 300,
          maxLatencyMs: 400,
          samples: 2,
          updatedAt: '2026-11-20T00:00:00.000Z',
        },
        {
          peerId: 'NERV-02',
          bytesSent: 120,
          bytesReceived: 220,
          inFlight: 5,
          reconnects: 4,
          lastLatencyMs: 360,
          avgLatencyMs: 310,
          maxLatencyMs: 400,
          samples: 3,
          updatedAt: '2026-11-20T00:00:01.000Z',
        },
      ],
      valid,
    );
    assert.equal(warnings.length, 5);
    assert.deepEqual(
      warnings.map((w) => w.key),
      [
        'sample:rssMb',
        'sample:eventLoopDelayMs',
        'link:NERV-02:linkLatencyMs',
        'link:NERV-02:inFlight',
        'link:NERV-02:reconnects',
      ],
    );
  });

  it('F-103-T03: GET /api/health/metrics and PUT /api/health/thresholds persist settings and compute warnings', async () => {
    const { Store } = await import('../src/store.ts');
    const { makeServer } = await import('../src/server.ts');
    const store = new Store(':memory:');
    new HealthSampleStore(store.db, { minIntervalMs: 100 }).record({
      sampledAtMs: Date.now(),
      rssBytes: 600 * 1024 * 1024,
      heapUsedBytes: 120 * 1024 * 1024,
      cpuUserUs: 100,
      cpuSystemUs: 50,
      eventLoopDelayMs: 12,
      pollCount: 9,
    });
    store.linkLoad.recordBytes('NERV-02', 512, 1024);
    store.linkLoad.recordReconnect('NERV-02');
    const srv = makeServer(store, 'h'.repeat(32));
    await new Promise<void>((done) => srv.listen(0, '127.0.0.1', done));
    try {
      const port = (srv.address() as { port: number }).port;
      const unauth = await fetch(`http://127.0.0.1:${port}/api/health/metrics`);
      assert.equal(unauth.status, 401);

      const getRes = await fetch(`http://127.0.0.1:${port}/api/health/metrics`, {
        headers: { Authorization: 'Bearer ' + 'h'.repeat(32) },
      });
      assert.equal(getRes.status, 200);
      const body = (await getRes.json()) as {
        latestSample: { pollCount: number } | null;
        links: { peerId: string; bytesSent: number }[];
        warnings: { key: string }[];
      };
      assert.equal(body.latestSample?.pollCount, 9);
      assert.equal(body.links[0]?.peerId, 'NERV-02');
      assert.deepEqual(
        body.warnings.map((w) => w.key),
        ['sample:rssMb'],
      );

      const putRes = await fetch(`http://127.0.0.1:${port}/api/health/thresholds`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + 'h'.repeat(32), 'Content-Type': 'application/json' },
        body: JSON.stringify({ rssMb: 1024, eventLoopDelayMs: 10, linkLatencyMs: 500, inFlight: 10, reconnects: 5 }),
      });
      assert.equal(putRes.status, 200);
      const putBody = (await putRes.json()) as { ok: boolean; warnings: { key: string }[] };
      assert.equal(putBody.ok, true);
      assert.deepEqual(
        putBody.warnings.map((w) => w.key),
        ['sample:eventLoopDelayMs'],
      );
    } finally {
      await new Promise<void>((done) => {
        srv.close(() => done());
        srv.closeAllConnections();
      });
      store.close();
    }
  });
});
