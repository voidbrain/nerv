// B-126-T03: on Windows CI the nervous child stayed over 29 s in "opening the database" without an error. Its main
// thread is blocked there, so no IPC report can leave it; a watch on its own thread names the step it is stuck in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProcessClient } from '../src/process-client.ts';
import { Store } from '../src/store.ts';

test('B-126: a child whose main thread blocks in a start-up step names that step in the not-ready error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-sw-'));
  const f = join(dir, 'blocks.ts');
  writeFileSync(
    f,
    `import { startupWatch } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/startup-watch.ts')).href)};
const watch = startupWatch('nervous', 300);
watch.step('schema migrations');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
setInterval(() => {}, 1000);
process.on('disconnect', () => process.exit(0));`,
  );
  const c = new ProcessClient(pathToFileURL(f), [], 'nervous', 200, 1500);
  try {
    await assert.rejects(c.call('runtime.ping'), /nervous: still in start-up step "schema migrations" after \d+ ms/);
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B-126: opening a Store reports each of its start-up steps in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-sw-'));
  const steps: string[] = [];
  try {
    new Store(join(dir, 'nerv.sqlite'), undefined, { onStep: (s) => steps.push(s) }).db.close();
    assert.deepEqual(steps, [
      'database: open the file',
      'database: first reads',
      'database: journal mode and core schema',
      'database: schema migrations',
      'database: feature stores',
      'database: worker jobs',
      'database: pending approvals',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
