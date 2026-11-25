import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ProcessClient } from '../src/process-client.ts';
import { Runtime } from '../src/runtime.ts';
// A stand-in child: waits `delay` ms before it handles requests and says READY (never, if delay<0), records what it got.
const child = (dir: string, delay: number) => {
  const f = join(dir, `child${delay}.mjs`);
  writeFileSync(
    f,
    `import {appendFileSync} from 'node:fs';
const start=()=>{process.on('message',m=>{appendFileSync(${JSON.stringify(join(dir, 'got'))},JSON.stringify(m)+'\\n');process.send({jsonrpc:'2.0',id:m.id,result:{role:'brain'}});});process.send({nerv:'ready'});};
if(${delay}>=0)setTimeout(start,${delay});process.on('disconnect',()=>process.exit(0));process.on('SIGTERM',()=>process.exit(0));`,
  );
  return pathToFileURL(f);
};
test('a call waits for a slow child to be ready; its own timer starts only then (B-007)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-pc-'));
  const c = new ProcessClient(child(dir, 800), [], 'brain', 200);
  try {
    assert.deepEqual(
      await c.call('runtime.ping'),
      { role: 'brain' },
      'answered although start-up took four times the call timeout',
    );
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('a child that never says ready: the call fails as not ready, and nothing was sent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-pc-'));
  const c = new ProcessClient(child(dir, -1), [], 'brain', 200, 300);
  try {
    await assert.rejects(c.call('runtime.ping'), /brain process not ready; nothing was sent/);
    assert.equal(existsSync(join(dir, 'got')) ? readFileSync(join(dir, 'got'), 'utf8') : '', '');
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
// B-126-T02: a child that fails before READY is named by how it ended and its last error output, not "nothing was sent" alone.
test('B-126: a child that exits before ready: the error names its exit code and last error output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-pc-'));
  const f = join(dir, 'dies.mjs');
  writeFileSync(
    f,
    `process.stderr.write('opening the store\\nError: cannot open the database file\\n');process.exit(3);`,
  );
  const c = new ProcessClient(pathToFileURL(f), [], 'nervous', 200, 10_000);
  try {
    const started = Date.now();
    await assert.rejects(c.call('runtime.ping'), (e: Error) => {
      assert.match(e.message, /^nervous process not ready; nothing was sent\. /);
      assert.match(e.message, /exited with code 3/);
      assert.match(e.message, /Error: cannot open the database file/);
      return true;
    });
    assert.ok(Date.now() - started < 5000, 'an exit is reported at once, not at the start-up deadline');
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('B-126: a child still running at the ready deadline: the error says so, with its pid, wait and error output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-pc-'));
  const f = join(dir, 'stuck.mjs');
  writeFileSync(
    f,
    `process.stderr.write('stuck before ready\\n');setInterval(()=>{},1000);process.on('disconnect',()=>process.exit(0));process.on('SIGTERM',()=>process.exit(0));`,
  );
  const c = new ProcessClient(pathToFileURL(f), [], 'nervous', 200, 1500);
  try {
    await assert.rejects(c.call('runtime.ping'), (e: Error) => {
      assert.match(e.message, /^nervous process not ready; nothing was sent\. /);
      assert.match(e.message, new RegExp(`no READY after 1500 ms; still running \\(pid ${c.child.pid}\\)`));
      assert.match(e.message, /stuck before ready/);
      return true;
    });
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('B-126 join: Runtime.ready names why the real nervous child stopped (a database newer than this version)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-pc-'));
  const database = join(dir, 'nerv.sqlite');
  const db = new DatabaseSync(database);
  db.exec('PRAGMA user_version = 9999');
  db.close();
  const runtime = new Runtime(database);
  try {
    await assert.rejects(runtime.ready(), (e: Error) => {
      assert.match(e.message, /^nervous process not ready; nothing was sent\. /);
      assert.match(e.message, /exited with code 1/);
      assert.match(e.message, /Database schema is newer than this NERV Agency version/);
      return true;
    });
  } finally {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('the real children say ready: the first call to a fresh brain answers within its short timeout', async () => {
  const c = new ProcessClient(new URL('../src/brain-process.ts', import.meta.url), [], 'brain', 1500);
  try {
    const r = (await c.call('runtime.ping')) as { role: string };
    assert.equal(r.role, 'brain');
  } finally {
    await c.close();
  }
});

test('B-008: an IPC timeout names its process, method and limit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-timeout-'));
  const file = join(dir, 'silent.mjs');
  writeFileSync(
    file,
    "process.on('message',()=>{});process.on('disconnect',()=>process.exit(0));process.send({nerv:'ready'});",
  );
  const c = new ProcessClient(pathToFileURL(file), [], 'brain', 25);
  try {
    await assert.rejects(c.call('runtime.ping'), /brain runtime.ping timed out after 25 ms; outcome may be unknown/);
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-013: admission includes calls waiting for startup and capacity recovers after settlement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-admission-'));
  const c = new ProcessClient(child(dir, 400), [], 'brain', 1000);
  try {
    const calls = Array.from({ length: 32 }, () => c.call('runtime.ping'));
    await assert.rejects(c.call('runtime.ping'), /queue is full/);
    await Promise.all(calls);
    assert.deepEqual(await c.call('runtime.ping'), { role: 'brain' });
    assert.equal(readFileSync(join(dir, 'got'), 'utf8').trim().split('\n').length, 33, 'rejected call was never sent');
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('F-013: a killed child rejects every outstanding call promptly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-exit-'));
  const file = join(dir, 'silent.mjs');
  writeFileSync(file, "process.on('message',()=>{});process.send({nerv:'ready'});");
  const c = new ProcessClient(pathToFileURL(file), [], 'brain', 10000);
  try {
    await once(c.child, 'message');
    const calls = Array.from({ length: 32 }, () =>
      c.call('runtime.ping').then(
        () => false,
        (e) => e instanceof Error && /unavailable/.test(e.message),
      ),
    );
    c.child.kill('SIGKILL');
    assert.ok((await Promise.all(calls)).every(Boolean));
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-013: timeout never frees admission while the child still holds the request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-timeout-admission-'));
  const file = join(dir, 'slow.mjs');
  writeFileSync(
    file,
    "process.on('message',m=>setTimeout(()=>process.send({jsonrpc:'2.0',id:m.id,result:true}),200));process.send({nerv:'ready'});",
  );
  const c = new ProcessClient(pathToFileURL(file), [], 'brain', 25);
  try {
    await once(c.child, 'message');
    const timed = Array.from({ length: 32 }, () => c.call('runtime.ping').catch((e) => e));
    assert.ok((await Promise.all(timed)).every((e) => e instanceof Error && /timed out/.test(e.message)));
    await assert.rejects(c.call('runtime.ping'), /queue is full/);
    await new Promise((done) => setTimeout(done, 250));
    assert.equal(await c.call('runtime.ping', {}, 500), true, 'late replies release their admission slots');
  } finally {
    await c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
