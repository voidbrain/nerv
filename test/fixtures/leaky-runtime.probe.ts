// B-118: a test file that leaks a Runtime and a listening server, as any file does whose test is cancelled before its
// own cleanup. Not part of the suite; test/runtime-exit.test.ts runs it with the exit guard (test/fixtures/exit-guard.ts)
// preloaded and requires the file's process to exit and name what held it.
import { after, test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../../src/runtime.ts';
const home = mkdtempSync(join(tmpdir(), 'nerv-leaky-runtime-'));
after(() => {
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // The leaked Runtime may still hold its database on Windows; a leftover temporary directory is harmless.
  }
});
test('leaks a Runtime', async () => {
  const runtime = new Runtime(join(home, 'nerv.sqlite'), new URL('./idle-brain.ts', import.meta.url), home);
  await runtime.ready();
  await new Promise<void>((done) => createServer().listen(0, '127.0.0.1', done));
});
