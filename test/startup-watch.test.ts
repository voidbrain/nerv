// B-126-T03: on Windows CI the nervous child stayed over 29 s in "opening the database" without an error. Its main
// thread is blocked there, so no IPC report can leave it; a watch on its own thread names the step it is stuck in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
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

// B-126-T03: on a Windows runner each flush can take seconds under load, and the Store's start-up commits each of its
// schema statements separately (423 WAL frames for 194 pages): the nervous child sat over 30 s in "journal mode and
// core schema". Its start-up writes are idempotent or their own transactions, so they need not wait for the disk.
test('B-126: the Store starts up without a flush per statement, then keeps the durability the connection had', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-sw-'));
  const script = join(dir, 'open.ts');
  writeFileSync(
    script,
    `import { Store } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/store.ts')).href)};
const during = new Set<number>();
const store = new Store(process.argv[2]!, undefined, {
  onStep: (step, db) => {
    if (db?.isOpen && step !== 'database: open the file' && step !== 'database: first reads')
      during.add((db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous);
  },
});
const after = (store.db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous;
store.db.close();
console.log(JSON.stringify({ during: [...during], after }));`,
  );
  try {
    // A plain process (no test preload), so the connection starts with SQLite's default, FULL (2).
    const run = spawnSync(process.execPath, [script, join(dir, 'nerv.sqlite')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { during: [1], after: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// B-126-T03 review (#767): synchronous=NORMAL is safe only in WAL mode; outside it a power loss can corrupt the file.
test('B-126: a fresh database is in WAL mode before the Store lowers its durability for start-up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-sw-'));
  const script = join(dir, 'open.ts');
  writeFileSync(
    script,
    `import { Store } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/store.ts')).href)};
const seen: string[] = [];
new Store(process.argv[2]!, undefined, {
  onStep: (_step, db) => {
    if (!db?.isOpen) return;
    const sync = (db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous;
    const mode = (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
    if (sync < 2) seen.push(mode);
  },
}).db.close();
console.log(JSON.stringify(seen));`,
  );
  try {
    const run = spawnSync(process.execPath, [script, join(dir, 'nerv.sqlite')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const modes = JSON.parse(run.stdout) as string[];
    assert.ok(modes.length > 0, 'start-up ran at a lowered durability');
    assert.deepEqual([...new Set(modes)], ['wal']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
