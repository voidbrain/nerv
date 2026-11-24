// B-118: a worker-link test file always exits, even when a test is cancelled at its timeout before its own cleanup.
// Windows CI run 45307748925 stopped at its 18-minute limit with worker-link.test.ts and worker-link-heartbeat.test.ts
// started and never finished: a cancelled test's Runtimes (nervous and brain child processes), WebSocket links and
// HTTP server stayed alive, so the file's process never exited and `--test-timeout` did not stop it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const probe = join(import.meta.dirname, 'fixtures', 'worker-link-timeout.probe.ts');
// Generous for a slow Windows runner: the probe's own tests end within about 10 s; a leaked fixture never ends.
const EXIT_MS = 45_000;

function stopTree(pid: number) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

async function runProbe(name: string) {
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=^${name}$`, probe], {
    cwd: join(import.meta.dirname, '..'),
    // Without this the child sees it is inside a test run and skips its file.
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const started = Date.now();
  const code = await new Promise<number | null | 'hung'>((done) => {
    const timer = setTimeout(() => done('hung'), EXIT_MS);
    child.once('exit', (c) => {
      clearTimeout(timer);
      done(c);
    });
  });
  if (code === 'hung') stopTree(child.pid!);
  return { code, ms: Date.now() - started, output };
}

for (const name of ['times out while the fixture starts', 'times out with both links connected']) {
  test(`B-118: a worker-link test file exits when a test ${name.replace('times out', 'is cancelled')}`, {
    timeout: EXIT_MS + 15_000,
  }, async () => {
    const run = await runProbe(name);
    assert.notEqual(run.code, 'hung', `the probe file was still running after ${EXIT_MS} ms:\n${run.output}`);
    // The probe's test itself failed on its timeout: the cancellation this test is about really happened.
    assert.match(run.output, /failureType: 'testTimeoutFailure'/, run.output);
    assert.match(run.output, /# cancelled 1\b/, run.output);
  });
}
