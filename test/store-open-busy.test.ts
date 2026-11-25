// B-126: the nervous child and the runtime open the same database at start. Opening the Store while another
// connection briefly holds a write lock must wait (busy timeout), not fail at its first read with "database is locked".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.ts';

test('B-126: opening the Store waits for a short lock held by another process', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-busy-'));
  const path = join(dir, 'nerv.sqlite');
  new Store(path).db.close();
  const holder = spawn(
    process.execPath,
    [
      '-e',
      `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);
       db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');console.log('locked');
       setTimeout(()=>{db.exec('COMMIT');db.close();},700);`,
      path,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const exited = new Promise((done) => holder.on('exit', done));
  try {
    await new Promise<void>((done) => holder.stdout.on('data', (d) => String(d).includes('locked') && done()));
    const store = new Store(path);
    assert.equal(
      typeof (store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      'number',
    );
    store.db.close();
  } finally {
    holder.kill();
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B-126: a lock that is never released still fails, so a dead holder is not waited on forever', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-busy-'));
  const path = join(dir, 'nerv.sqlite');
  new Store(path).db.close();
  const holder = new DatabaseSync(path);
  holder.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
  try {
    const started = Date.now();
    assert.throws(() => new Store(path), /database is locked/);
    assert.ok(Date.now() - started < 15000);
  } finally {
    holder.exec('ROLLBACK');
    holder.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
