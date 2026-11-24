// B-118: a worker-link test file always exits, even when a test is cancelled at its timeout before its own cleanup.
// Windows CI run 45307748925 stopped at its 18-minute limit with worker-link.test.ts and worker-link-heartbeat.test.ts
// started and never finished: a cancelled test's Runtimes (nervous and brain child processes), WebSocket links and
// HTTP server stayed alive, so the file's process never exited and `--test-timeout` did not stop it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { WorkerLink } from '../src/worker-link.ts';
import { runProbe } from './fixtures/probe.ts';
import type { BaseEntry } from '../src/kaji.ts';
import type { RegistryPort } from '../src/kaji-link.ts';

const probe = join(import.meta.dirname, 'fixtures', 'worker-link-timeout.probe.ts');
// Generous for a slow Windows runner: the probe's own tests end within about 10 s; a leaked fixture never ends.
const EXIT_MS = 45_000;

for (const name of ['times out while the fixture starts', 'times out with both links connected']) {
  test(
    `B-118: a worker-link test file exits when a test ${name.replace('times out', 'is cancelled')}`,
    {
      timeout: EXIT_MS + 15_000,
    },
    async () => {
      const run = await runProbe(probe, name, EXIT_MS);
      assert.notEqual(run.code, 'hung', `the probe file was still running after ${EXIT_MS} ms:\n${run.output}`);
      // The probe's test itself failed on its timeout: the cancellation this test is about really happened.
      assert.match(run.output, /failureType: 'testTimeoutFailure'/, run.output);
      assert.match(run.output, /# cancelled 1\b/, run.output);
    },
  );
}

// The fixture closes its links first; a stop that waits on a connection attempt stuck in the worker's store (here an
// adapter that never answers `open`) would hold every later close and the file with it.
// src/worker-link.ts gives a stop 5 s for what is in flight; the rest is margin for a loaded runner.
const STOP_BOUND_MS = 9000;
test('B-118: WorkerLink.stop() returns within its grace period while a connection attempt is stuck', async () => {
  const key = generateKeyPairSync('ed25519');
  const publicKey = key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const base = (baseId: string, address: string) =>
    ({ baseId, name: baseId, publicKey, address, status: 'enrolled' }) as unknown as BaseEntry;
  let opened = false;
  const link = new WorkerLink({
    id: 'NERV-02',
    key: key.privateKey,
    registry: {
      bases: async () => [base('NERV-01', '127.0.0.1:9'), base('NERV-02', '127.0.0.1:1')],
      main: async () => 'NERV-01',
    } as unknown as RegistryPort,
    adapter: {
      open: () => {
        opened = true;
        return new Promise(() => {});
      },
      close: async () => {},
      cancel: async () => ({ status: 'unknown' }),
      run: async () => ({}),
    },
    address: (s) => 'ws://' + s,
    reconnectMs: 30,
  });
  link.start();
  const end = Date.now() + 10_000;
  while (!opened && Date.now() < end) await new Promise((done) => setTimeout(done, 10));
  assert.ok(opened, 'the link started a connection attempt');
  const started = Date.now();
  const stopped = await Promise.race([
    link.stop().then(() => true),
    new Promise<false>((done) => setTimeout(() => done(false), STOP_BOUND_MS).unref()),
  ]);
  assert.ok(stopped, `stop() still waiting after ${Date.now() - started} ms`);
});
