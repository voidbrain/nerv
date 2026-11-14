import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
import { Registry, createRootKey, signRecord, unlockRootKey, type RegistryBody } from '../src/kaji.ts';
import {
  copyDates,
  copyName,
  createBackupKey,
  decryptBackup,
  encryptBackup,
  receivedDir,
  storeReceived,
  validateBackup,
  type BackupConfig,
} from '../src/offhost.ts';
import { snapshotDates, snapshotDir, startSnapshots } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';

const PASS = 'correct horse battery';
const backupKey = createBackupKey(PASS);
const root = (() => {
  const f = createRootKey('a long test passphrase');
  return unlockRootKey(f.file, 'a long test passphrase');
})();
let serial = 0;
const rec = (body: Omit<RegistryBody, 'serial' | 'issued'>) =>
  signRecord(root.privateKey, { ...body, serial: ++serial, issued: new Date().toISOString() } as RegistryBody);
const keys = () => {
  const k = generateKeyPairSync('ed25519');
  return {
    privateKey: k.privateKey,
    publicKey: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
};
const freePort = async () => {
  const s = createServer();
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((d) => s.close(() => d()));
  return p;
};
const port = (reg: Registry): RegistryPort => ({
  bases: async () => reg.bases(),
  records: async () => reg.records(),
  add: async () => 0,
  seen: async (u) => reg.seen(u),
  lastSeen: async () => reg.lastSeen(),
});
const until = async (done: () => boolean, ms = 10_000) => {
  for (const end = Date.now() + ms; !done();) {
    if (Date.now() > end) throw Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Two enrolled bases on loopback: the Mac (NERV-01) and Tabgha (NERV-02), each with its own data home. */
async function bases(tabghaBackup: () => BackupConfig | undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-kaji-backup-')),
    mac = join(dir, 'mac'),
    tabgha = join(dir, 'tabgha');
  mkdirSync(mac);
  mkdirSync(tabgha);
  const A = keys(),
    B = keys(),
    pa = await freePort(),
    pb = await freePort();
  const sa = new Store(':memory:'),
    sb = new Store(':memory:'),
    ra = new Registry(sa.db, root.publicKey),
    rb = new Registry(sb.db, root.publicKey);
  for (const r of [
    rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Neo Tokyo-3', publicKey: A.publicKey, address: `127.0.0.1:${pa}` }),
    rec({ kind: 'enrol', baseId: 'NERV-02', name: 'Tabgha', publicKey: B.publicKey, address: `127.0.0.1:${pb}` }),
  ]) {
    ra.add(r);
    rb.add(r);
  }
  const la = new KajiLink({
    baseId: 'NERV-01',
    key: A.privateKey,
    publicKey: A.publicKey,
    registry: port(ra),
    log: () => {},
  });
  const lb = new KajiLink({
    baseId: 'NERV-02',
    key: B.privateKey,
    publicKey: B.publicKey,
    registry: port(rb),
    log: () => {},
    onBackup: async (from, date, copy) => storeReceived(tabgha, tabghaBackup(), from, date, copy),
  });
  const database = join(mac, 'nerv.sqlite'),
    db = new DatabaseSync(database);
  db.exec(
    "CREATE TABLE reminders (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO reminders (title) VALUES ('Water the plants')",
  );
  return {
    mac,
    tabgha,
    database,
    la,
    lb,
    done: async () => {
      await la.stop();
      await lb.stop();
      db.close();
      sa.close();
      sb.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const macConfig: BackupConfig = { publicKey: backupKey.publicKey, copies: [], peers: ['NERV-02'] };

test('the nightly copy reaches Tabgha over the Kaji line encrypted, and only the owner key restores it', async () => {
  const b = await bases(() => ({ copies: [], accept: ['NERV-01'] }));
  try {
    await b.la.start(60_000);
    await b.lb.start(60_000);
    const lines: string[] = [];
    const stop = startSnapshots(
      b.mac,
      () => b.database,
      () => 'UTC',
      (l) => lines.push(l),
      5,
      () => macConfig,
      (peer, date, copy) => b.la.sendBackup(peer, date, copy),
    );
    const received = receivedDir(b.tabgha, 'NERV-01');
    await until(() => copyDates(received).length > 0);
    await stop();
    assert.deepEqual(lines, []);
    const [date] = snapshotDates(snapshotDir(b.mac));
    assert.deepEqual(copyDates(received), [date]);
    const stored = readFileSync(join(received, copyName(date!)));
    assert.ok(!stored.includes(Buffer.from('Water the plants')));

    const restored = join(b.mac, 'restored.sqlite');
    writeFileSync(restored, decryptBackup(stored, backupKey.privatePem, PASS));
    const db = new DatabaseSync(restored, { readOnly: true });
    assert.deepEqual(
      db
        .prepare('SELECT title FROM reminders')
        .all()
        .map((r) => r.title),
      ['Water the plants'],
    );
    db.close();
  } finally {
    await b.done();
  }
});

test('a base that does not accept copies refuses them; the sender logs it once and does not ask again that night', async () => {
  const b = await bases(() => undefined);
  try {
    await b.la.start(60_000);
    await b.lb.start(60_000);
    const lines: string[] = [];
    let sends = 0;
    const stop = startSnapshots(
      b.mac,
      () => b.database,
      () => 'UTC',
      (l) => lines.push(l),
      5,
      () => macConfig,
      (peer, date, copy) => (sends++, b.la.sendBackup(peer, date, copy)),
    );
    await until(() => lines.length > 0);
    await new Promise((r) => setTimeout(r, 100));
    await stop();
    assert.equal(sends, 1);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^Copy for \d{4}-\d{2}-\d{2} to NERV-02 was refused \(403\); next attempt tomorrow\.$/);
    assert.equal(copyDates(receivedDir(b.tabgha, 'NERV-01')).length, 0);
  } finally {
    await b.done();
  }
});

test('an unreachable peer is reported as waiting, once, and is not retried every minute', async () => {
  const b = await bases(() => ({ copies: [], accept: ['NERV-01'] }));
  try {
    await b.la.start(60_000); // Tabgha's link is not started: nothing listens on its address
    await assert.rejects(b.la.sendBackup('NERV-02', '2030-01-15', Buffer.from('x')), { code: 'EUNREACHABLE' });
    await assert.rejects(b.la.sendBackup('NERV-09', '2030-01-15', Buffer.from('x')), { code: 'EREFUSED' });
    const lines: string[] = [];
    let sends = 0;
    const stop = startSnapshots(
      b.mac,
      () => b.database,
      () => 'UTC',
      (l) => lines.push(l),
      5,
      () => macConfig,
      (peer, date, copy) => (sends++, b.la.sendBackup(peer, date, copy)),
    );
    await until(() => lines.length > 0);
    await new Promise((r) => setTimeout(r, 100));
    await stop();
    assert.equal(sends, 1);
    assert.match(lines[0]!, /to NERV-02 waits: the base cannot be reached over the Kaji line/);
  } finally {
    await b.done();
  }
});

test('a receiver stores only copies from bases it accepts, only shaped like a copy, and keeps the newest', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-received-'));
  try {
    const config = validateBackup({ accept: ['NERV-01'], keep: 2 }, home);
    const copy = encryptBackup(Buffer.from('x'), backupKey.publicKey);
    assert.equal(storeReceived(home, config, 'NERV-03', '2030-01-15', copy), 'refused');
    assert.equal(storeReceived(home, config, 'NERV-01', '2030-01-15', Buffer.from('not a copy')), 'refused');
    assert.equal(storeReceived(home, config, 'NERV-01', '../../x', copy), 'refused');
    for (const d of ['2030-01-13', '2030-01-14', '2030-01-15'])
      assert.equal(storeReceived(home, config, 'NERV-01', d, copy), 'stored');
    assert.deepEqual(copyDates(receivedDir(home, 'NERV-01')), ['2030-01-15', '2030-01-14']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('config: a receiver needs no backup key; a sender to peers needs one', () => {
  assert.deepEqual(validateBackup({ accept: ['NERV-01'] }, '/data/nerv'), { copies: [], accept: ['NERV-01'] });
  for (const bad of [
    { peers: ['NERV-02'] },
    { accept: ['nerv-01'] },
    { accept: ['NERV-01', 'NERV-01'] },
    { accept: ['NERV-01'], publicKey: backupKey.publicKey },
    {},
  ])
    assert.throws(() => validateBackup(bad, '/data/nerv'), /Invalid backup/);
});
