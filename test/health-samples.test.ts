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
});
