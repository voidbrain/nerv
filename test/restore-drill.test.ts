import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupCommand, restoreBackupCopy } from '../src/backup-cli.ts';
import { databasePath } from '../src/config.ts';
import { createBackupKey, encryptBackup } from '../src/offhost.ts';
import { snapshotDir, takeSnapshot } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';

const PASS = 'correct-horse-battery-staple';

test('F-062-T04: restore drill recovers identities, revoked grants, and checkpoints without replaying old work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nerv-restore-drill-'));
  try {
    const sourceHome = join(root, 'source-home');
    const targetHome = join(root, 'restored-home');
    const now = new Date('2026-11-15T09:00:00Z');

    // 1. Seed source base with identity, a speared sortie (revoked grant + stood-down approval),
    //    a delivered & read reminder, and a daily brief checkpoint.
    const source = new Store(databasePath(sourceHome), undefined, { home: sourceHome });
    const sortieId = source.ledger.openSortie('owner', 'Restore drill sortie', 'trusted', now);
    source.db
      .prepare('INSERT INTO actions(id, sortie_id, tool, args, ballot, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run('act-1', sortieId, 'shell.exec', '{"cmd":"echo hi"}', 'green', now.toISOString());
    source.db
      .prepare('INSERT INTO grants(id, action_id, tool, args_hash, expires) VALUES (?, ?, ?, ?, ?)')
      .run('grant-1', 'act-1', 'shell.exec', 'hash-1', '2026-11-16T09:00:00Z');
    source.db
      .prepare('INSERT INTO approvals(id, action_id, card, expires) VALUES (?, ?, ?, ?)')
      .run('app-1', 'act-1', '{"title":"Approve"}', '2026-11-16T09:00:00Z');
    const speared = source.ledger.spear(sortieId, 'drill revocation', now);
    assert.equal(speared.revoked, 1);
    assert.equal(speared.stoodDown, 1);

    source.db
      .prepare(
        'INSERT INTO registry(id, serial, kind, base_id, body, signature, received) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('reg-1', 1, 'enroll', 'base-alpha', '{"base":"base-alpha"}', 'sig-alpha', now.toISOString());

    source.db
      .prepare('INSERT INTO reminders(id, title, due, created) VALUES (?, ?, ?, ?)')
      .run('rem-1', 'Already due reminder', '2026-11-15T08:00:00Z', '2026-11-15T07:00:00Z');
    const delivered = source.tick(now);
    assert.equal(delivered, 1);
    const deliveryRow = source.db.prepare('SELECT id FROM deliveries WHERE reminder_id = ?').get('rem-1') as {
      id: string;
    };
    source.db.prepare('UPDATE deliveries SET read_at = ? WHERE id = ?').run('2026-11-15T09:01:00Z', deliveryRow.id);

    source.db
      .prepare('INSERT INTO deliveries(id, reminder_id, kind, message, created, read_at) VALUES (?, NULL, ?, ?, ?, ?)')
      .run('deliv-brief-1', 'brief', 'Morning brief', '2026-11-15T07:30:00Z', '2026-11-15T07:35:00Z');
    source.db.prepare('INSERT INTO daily_briefs(day, delivery_id) VALUES (?, ?)').run('2026-11-15', 'deliv-brief-1');

    source.close();

    // 2. Take a nightly snapshot and write an encrypted off-host backup copy.
    const snap = await takeSnapshot(databasePath(sourceHome), snapshotDir(sourceHome), '2026-11-15');
    const snapBytes = readFileSync(join(snapshotDir(sourceHome), snap.file));
    const key = createBackupKey(PASS);
    const keyFile = join(root, 'backup.key');
    const copyFile = join(root, 'nerv-2026-11-15.sqlite.nbk');
    writeFileSync(keyFile, key.privatePem, { mode: 0o600 });
    writeFileSync(copyFile, encryptBackup(snapBytes, key.publicKey));

    // 3. Execute restore onto a separate target location within the <1h bound.
    const printed: string[] = [];
    const flags: Record<string, string> = { '--key': keyFile, '--target': targetHome };
    const started = Date.now();
    await backupCommand(sourceHome, ['restore', copyFile, '--key', keyFile, '--target', targetHome], {
      readSecret: async () => PASS,
      flag: (name) => flags[name],
      print: (line) => printed.push(line),
    });
    const elapsedMs = Date.now() - started;
    assert.ok(elapsedMs < 3_600_000, `restore took ${elapsedMs}ms, exceeding 1h bound`);
    assert.match(printed[0] ?? '', /Restored and verified/);

    // Refuses to overwrite an existing restored/live database.
    assert.throws(
      () => restoreBackupCopy({ copyPath: copyFile, keyPath: keyFile, passphrase: PASS, targetHome }),
      /already exists/,
    );

    // 4. Open restored Store and verify identities, revoked grants/approvals, and checkpoints.
    const restored = new Store(databasePath(targetHome), undefined, { home: targetHome });
    try {
      const identity = restored.db.prepare('SELECT id, base_id, signature FROM registry WHERE id = ?').get('reg-1') as
        { id: string; base_id: string; signature: string } | undefined;
      assert.deepEqual({ ...identity }, { id: 'reg-1', base_id: 'base-alpha', signature: 'sig-alpha' });

      const grant = restored.db.prepare('SELECT revoked FROM grants WHERE id = ?').get('grant-1') as {
        revoked: string | null;
      };
      assert.ok(grant.revoked !== null, 'revoked grant must remain revoked after restore');

      const approval = restored.db.prepare('SELECT decision, source FROM approvals WHERE id = ?').get('app-1') as {
        decision: string | null;
        source: string | null;
      };
      assert.equal(approval.decision, 'revoked');
      assert.equal(approval.source, 'spear');

      assert.throws(
        () => restored.ledger.authorize('grant-1', 'shell.exec', { cmd: 'echo hi' }, new Date('2026-11-15T09:05:00Z')),
        /revoked/,
      );

      const brief = restored.db.prepare('SELECT delivery_id FROM daily_briefs WHERE day = ?').get('2026-11-15') as {
        delivery_id: string;
      };
      assert.equal(brief.delivery_id, 'deliv-brief-1');

      const restoredDelivery = restored.db
        .prepare('SELECT read_at FROM deliveries WHERE reminder_id = ?')
        .get('rem-1') as { read_at: string | null };
      assert.equal(restoredDelivery.read_at, '2026-11-15T09:01:00Z');

      // 5. Ticking again at or after restore time must not replay any already-delivered work.
      assert.equal(restored.tick(new Date('2026-11-15T09:10:00Z')), 0);
      const count = restored.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get() as { n: number };
      assert.equal(count.n, 2);
    } finally {
      restored.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
