// B-118: runs a probe test file (no .test. name, so not part of the suite) in its own `node --test` process and reports
// whether that process exited on its own within a bound. The exit tests (test/*-exit.test.ts) use it to require that a
// file whose test was cancelled mid-fixture still exits; a leaked fixture keeps its process alive for good.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');

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

/** Runs the probe's test named `name`; `code` is 'hung' when the process was still running after `exitMs`. */
export async function runProbe(
  probe: string,
  name: string,
  exitMs: number,
  options: { args?: string[]; env?: Record<string, string> } = {},
) {
  const child = spawn(
    process.execPath,
    [...(options.args ?? []), '--test', '--test-reporter=tap', `--test-name-pattern=^${name}$`, probe],
    {
      cwd: root,
      // Without dropping NODE_TEST_CONTEXT the child sees it is inside a test run and skips its file.
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, ...options.env },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const started = Date.now();
  const code = await new Promise<number | null | 'hung'>((done) => {
    const timer = setTimeout(() => done('hung'), exitMs);
    child.once('exit', (c) => {
      clearTimeout(timer);
      done(c);
    });
  });
  if (code === 'hung') stopTree(child.pid!);
  return { code, ms: Date.now() - started, output };
}
