import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshotDates, snapshotDir, snapshotDue, startSnapshots, takeSnapshot } from '../src/snapshots.ts';

const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-snap-')),
    database = join(home, 'nerv.sqlite'),
    db = new DatabaseSync(database);
  db.exec(
    "PRAGMA journal_mode = WAL; CREATE TABLE reminders (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO reminders (title) VALUES ('Water the plants')",
  );
  return { home, database, db, done: () => (db.close(), rmSync(home, { recursive: true, force: true })) };
};

test('a snapshot is a consistent, verified, private copy taken while the service keeps its connection open', async () => {
  const f = fixture();
  try {
    f.db.exec("INSERT INTO reminders (title) VALUES ('Renew the library card')"); // still in the WAL, not checkpointed
    const dir = snapshotDir(f.home),
      { file, bytes } = await takeSnapshot(f.database, dir, '2030-01-15');
    assert.equal(file, 'nerv-2030-01-15.sqlite');
    assert.ok(bytes > 0);
    if (process.platform !== 'win32') {
      // POSIX permissions; Windows has no mode bits and relies on the profile ACL.
      assert.equal(statSync(join(dir, file)).mode & 0o777, 0o600);
      assert.equal(statSync(dir).mode & 0o777, 0o700);
    }
    assert.deepEqual(readdirSync(dir), [file]); // one self-contained file: no partial, -wal or -shm left behind
    const copy = new DatabaseSync(join(dir, file), { readOnly: true });
    try {
      assert.equal(copy.prepare('SELECT count(*) AS n FROM reminders').get()!.n, 2);
    } finally {
      copy.close();
    }
  } finally {
    f.done();
  }
});

test('only the newest snapshots are kept', async () => {
  const f = fixture();
  try {
    const dir = snapshotDir(f.home);
    for (const d of ['2030-01-11', '2030-01-12', '2030-01-13', '2030-01-14']) await takeSnapshot(f.database, dir, d, 2);
    assert.deepEqual(snapshotDates(dir), ['2030-01-14', '2030-01-13']);
  } finally {
    f.done();
  }
});

test('a damaged copy is refused and leaves no snapshot behind', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-snap-'));
  try {
    const bad = join(home, 'nerv.sqlite');
    writeFileSync(bad, 'not a database');
    await assert.rejects(takeSnapshot(bad, snapshotDir(home), '2030-01-15'));
    assert.deepEqual(snapshotDates(snapshotDir(home)), []);
    assert.deepEqual(readdirSync(snapshotDir(home)), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('due once per local night, at or after 03:30 in the owner time zone', () => {
  const zone = 'Europe/Rome';
  assert.equal(snapshotDue(new Date('2030-01-15T02:00:00Z'), zone, '2030-01-14'), undefined); // 03:00 local
  assert.equal(snapshotDue(new Date('2030-01-15T02:30:00Z'), zone, '2030-01-14'), '2030-01-15'); // 03:30 local
  assert.equal(snapshotDue(new Date('2030-01-15T12:00:00Z'), zone, '2030-01-15'), undefined); // already taken
  assert.equal(snapshotDue(new Date('2030-01-15T12:00:00Z'), zone, undefined), '2030-01-15'); // first run catches up
});

test('the schedule takes the snapshot once and logs a failure by reason only, without paths', async () => {
  const f = fixture();
  try {
    const stop = startSnapshots(
      f.home,
      () => f.database,
      () => 'UTC',
      () => assert.fail('no failure expected'),
      5,
    );
    await new Promise((r) => setTimeout(r, 100));
    stop();
    assert.equal(snapshotDates(snapshotDir(f.home)).length, 1);

    const lines: string[] = [],
      missing = join(f.home, 'gone', 'nerv.sqlite');
    rmSync(snapshotDir(f.home), { recursive: true });
    const stop2 = startSnapshots(
      f.home,
      () => missing,
      () => 'UTC',
      (l) => lines.push(l),
      5,
    );
    await new Promise((r) => setTimeout(r, 100));
    stop2();
    assert.equal(lines.length, 1); // one attempt per night, not a retry loop
    assert.match(lines[0]!, /failed \(database not found\)/);
    assert.ok(!lines[0]!.includes(f.home));
  } finally {
    f.done();
  }
});
