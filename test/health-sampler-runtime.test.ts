import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';

// B-111 (live NERV-01 2026-11-23): `serve` hands the server a Runtime, which has no `db`, so the local health sampler
// (F-103-T01) never started and the dashboard said "No health samples yet" forever. Tested before only with a Store.
test('B-111: the server given a Runtime, as serve does, records health samples that the metrics endpoint returns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-b111-'));
  const runtime = new Runtime(join(dir, 'db'));
  const token = 'h'.repeat(32);
  let server: ReturnType<typeof makeServer> | undefined;
  try {
    await runtime.ready();
    server = makeServer(runtime, token, { healthSampleIntervalMs: 100 });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    let latest: unknown = null;
    for (let i = 0; i < 40 && !latest; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const r = await fetch(`http://127.0.0.1:${port}/api/health/metrics`, {
        headers: { authorization: `Bearer ${token}` },
      });
      latest = ((await r.json()) as { latestSample: unknown }).latestSample;
    }
    assert.ok(latest, 'a health sample was recorded and returned');
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
