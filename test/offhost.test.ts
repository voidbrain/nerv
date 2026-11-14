import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupCommand } from '../src/backup-cli.ts';
import { readConfig } from '../src/config.ts';
import { copyDates, copyName, createBackupKey, decryptBackup, encryptBackup, validateBackup } from '../src/offhost.ts';
import { snapshotDates, snapshotDir, startSnapshots } from '../src/snapshots.ts';

const PASS = 'correct horse battery';
const key = createBackupKey(PASS);

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'nerv-offhost-')),
    home = join(root, 'home'),
    disk = join(root, 'disk'),
    database = join(home, 'nerv.sqlite');
  mkdirSync(home);
  const db = new DatabaseSync(database);
  db.exec(
    "PRAGMA journal_mode = WAL; CREATE TABLE reminders (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO reminders (title) VALUES ('Water the plants')",
  );
  return { root, home, disk, database, db, done: () => (db.close(), rmSync(root, { recursive: true, force: true })) };
};

const tick = () => new Promise((r) => setTimeout(r, 60));

test('a copy opens only with the private key and passphrase, and any change to it fails', () => {
  const plain = Buffer.from('reminders and memory');
  const copy = encryptBackup(plain, key.publicKey);
  assert.ok(!copy.includes(plain));
  assert.deepEqual(decryptBackup(copy, key.privatePem, PASS), plain);
  assert.notDeepEqual(encryptBackup(plain, key.publicKey), copy); // fresh key agreement each time

  assert.throws(() => decryptBackup(copy, key.privatePem, 'wrong passphrase!'), /wrong passphrase/);
  const other = createBackupKey('another passphrase');
  assert.throws(() => decryptBackup(copy, other.privatePem, 'another passphrase'), /another backup key/);
  for (const at of [12, copy.length - 1]) {
    const changed = Buffer.from(copy);
    changed[at]! ^= 1;
    assert.throws(() => decryptBackup(changed, key.privatePem, PASS));
  }
  assert.throws(() => decryptBackup(copy.subarray(0, 40), key.privatePem, PASS), /changed or truncated/);
  assert.throws(() => createBackupKey('short'), /12 characters/);
});

test('config holds only the public key; copy folders are absolute and outside the data home', () => {
  const home = '/data/nerv';
  assert.deepEqual(validateBackup({ publicKey: key.publicKey, copies: ['/Volumes/Disk/nerv'] }, home), {
    publicKey: key.publicKey,
    copies: ['/Volumes/Disk/nerv'],
  });
  for (const bad of [
    { publicKey: key.publicKey, copies: ['relative/dir'] },
    { publicKey: key.publicKey, copies: [] },
    { publicKey: key.publicKey, copies: ['/data/nerv/snapshots'] },
    { publicKey: key.publicKey, copies: ['/data/nerv'] },
    { publicKey: key.publicKey, copies: ['/a', '/a/'] },
    { publicKey: 'bm90IGEga2V5', copies: ['/a'] },
    { publicKey: key.privatePem, copies: ['/a'] },
    { publicKey: key.publicKey, copies: ['/a'], keep: 0 },
    { publicKey: key.publicKey, copies: ['/a'], privateKey: 'x' },
  ])
    assert.throws(() => validateBackup(bad, home), /Invalid backup/);
});

test('the nightly loop writes an encrypted copy that restores the database through backup decrypt', async () => {
  const f = fixture();
  try {
    mkdirSync(f.disk);
    writeFileSync(
      join(f.home, 'config.json'),
      JSON.stringify({ backup: { publicKey: key.publicKey, copies: [f.disk], keep: 2 } }),
    );
    const lines: string[] = [];
    const stop = startSnapshots(
      f.home,
      () => f.database,
      () => 'UTC',
      (l) => lines.push(l),
      5,
      () => readConfig(f.home).backup,
    );
    await tick();
    stop();
    assert.deepEqual(lines, []);
    const [date] = snapshotDates(snapshotDir(f.home));
    assert.deepEqual(copyDates(f.disk), [date]);
    const copy = join(f.disk, copyName(date!));
    assert.ok(!readFileSync(copy).includes(Buffer.from('Water the plants')));
    if (process.platform !== 'win32') assert.equal(statSync(copy).mode & 0o777, 0o600);

    const out = join(f.root, 'restored.sqlite'),
      keyFile = join(f.root, 'key.pem'),
      printed: string[] = [];
    writeFileSync(keyFile, key.privatePem); // the owner's key, brought back from its offline place
    await backupCommand(f.home, ['decrypt', copy, '--key', keyFile, '--out', out], {
      readSecret: async () => PASS,
      flag: (n) => ({ '--key': keyFile, '--out': out })[n],
      print: (l) => printed.push(l),
    });
    const restored = new DatabaseSync(out, { readOnly: true });
    assert.deepEqual(
      restored
        .prepare('SELECT title FROM reminders')
        .all()
        .map((r) => r.title),
      ['Water the plants'],
    );
    restored.close();
    assert.match(printed.join('\n'), /Decrypted and verified/);
  } finally {
    f.done();
  }
});

test('an unplugged disk is reported once, never created, and catches up when it is plugged in', async () => {
  const f = fixture();
  try {
    const config = { publicKey: key.publicKey, copies: [f.disk] },
      lines: string[] = [];
    const stop = startSnapshots(
      f.home,
      () => f.database,
      () => 'UTC',
      (l) => lines.push(l),
      5,
      () => config,
    );
    await tick();
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^Off-host copy 1 for \d{4}-\d{2}-\d{2} waits: its folder is not available/);
    assert.ok(!lines[0]!.includes(f.root));
    assert.ok(!readdirSync(f.root).includes('disk'));

    mkdirSync(f.disk); // plugged in
    await tick();
    stop();
    assert.equal(copyDates(f.disk).length, 1);
    assert.equal(lines.length, 1);
  } finally {
    f.done();
  }
});

test('only the newest copies are kept in each folder', async () => {
  const f = fixture();
  try {
    mkdirSync(f.disk);
    for (const d of ['2020-01-10', '2020-01-11', '2020-01-12']) writeFileSync(join(f.disk, copyName(d)), 'old');
    writeFileSync(join(f.disk, 'unrelated.txt'), 'kept');
    const stop = startSnapshots(
      f.home,
      () => f.database,
      () => 'UTC',
      () => assert.fail('no failure expected'),
      5,
      () => ({ publicKey: key.publicKey, copies: [f.disk], keep: 2 }),
    );
    await tick();
    stop();
    const [today] = snapshotDates(snapshotDir(f.home));
    assert.deepEqual(copyDates(f.disk), [today, '2020-01-12']);
    assert.ok(readdirSync(f.disk).includes('unrelated.txt'));
  } finally {
    f.done();
  }
});

test('backup keygen never overwrites and prints only the public key for config.json', async () => {
  const f = fixture();
  try {
    const out = join(f.root, 'backup-key.pem'),
      printed: string[] = [];
    const io = { readSecret: async () => PASS, flag: (n: string) => (n === '--out' ? out : undefined) };
    await backupCommand(f.home, ['keygen'], { ...io, print: (l) => printed.push(l) });
    const pem = readFileSync(out, 'utf8');
    assert.match(pem, /ENCRYPTED PRIVATE KEY/);
    if (process.platform !== 'win32') assert.equal(statSync(out).mode & 0o777, 0o600);
    const snippet = JSON.parse(printed[0]!.slice(printed[0]!.indexOf('{'))) as {
      backup: { publicKey: string };
    };
    assert.ok(!printed[0]!.includes(pem));
    const plain = Buffer.from('x');
    assert.deepEqual(decryptBackup(encryptBackup(plain, snippet.backup.publicKey), pem, PASS), plain);
    await assert.rejects(backupCommand(f.home, ['keygen'], io), /never overwritten/);
  } finally {
    f.done();
  }
});
