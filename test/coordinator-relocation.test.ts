import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { assertActiveCoordinator, readCoordinatorFencingState } from '../src/coordinator-authority.ts';
import {
  RELOCATION_HORIZON_ACKED_MS,
  RELOCATION_HORIZON_CONSERVATIVE_MS,
  RelocationRefusedError,
  checkRelocationReadiness,
  drainCoordinator,
  relocateCoordinator,
  relocationHorizonMs,
  signDrainReceipt,
  type RelocationLiveness,
  type SignedDrainReceipt,
} from '../src/coordinator-relocation.ts';
import { COORDINATOR_STATE_SCHEMA } from '../src/coordinator-snapshot.ts';
import { runKajiCommand } from '../src/cli-kaji.ts';
import { Registry, baseKey, createRootKey, enrolmentArgs, signRecord, ROOT_KEY_FILE } from '../src/kaji.ts';
import { Store } from '../src/store.ts';

const PASS = 'neutral test passphrase';
const ROOT_FP = 'root-fp-relocation';

function setState(db: DatabaseSync, epoch: number, mode: string, headSeq: number, digest: string | null) {
  db.exec(COORDINATOR_STATE_SCHEMA);
  db.prepare(
    `INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, state_digest, lease_expires_at)
     VALUES (1, ?, 3, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET coordinator_epoch = excluded.coordinator_epoch, replication_mode = excluded.replication_mode,
       head_seq = excluded.head_seq, state_digest = excluded.state_digest`,
  ).run(epoch, mode, headSeq, digest);
}

function refusal(fn: () => unknown, reason: string) {
  assert.throws(fn, (err: unknown) => err instanceof RelocationRefusedError && err.reason === reason);
}

describe('F-016-T07: owner-initiated relocation with restore; never a context-only takeover', () => {
  it('drains the old main, promotes the verified standby at E+1, quarantines uncertain outbox rows, and fences the old main', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-reloc-'));
    try {
      const oldKey = generateKeyPairSync('ed25519');
      const oldMain = new Store(':memory:');
      setState(oldMain.db, 2, 'active', 7, 'digest-7');

      // New main's own store (base-local) and its replicated standby at epoch 2.
      const mainPath = join(dir, 'nerv.sqlite');
      const standbyPath = join(dir, 'coordinator-standby.sqlite');
      new Store(mainPath).close();
      const standby = new Store(standbyPath);
      setState(standby.db, 2, 'standby', 7, 'digest-7');
      const t = '2030-01-01T00:00:00.000Z';
      const outbox = standby.db.prepare('INSERT INTO kaji_outbox VALUES(?,?,?,?,?,?,?,NULL,NULL)');
      for (const id of ['sent-unsure', 'never-sent', 'reconciled'])
        outbox.run(id, 'sortie-1', 'NERV-03', 'reminders.add', '{}', '{}', t);
      standby.db.prepare('INSERT INTO worker_outbox_attempts VALUES(?,?)').run('sent-unsure', t);
      standby.db.prepare('INSERT INTO worker_outbox_attempts VALUES(?,?)').run('reconciled', t);
      standby.db
        .prepare("INSERT INTO worker_outbox_reconciliations VALUES(?,'retry','checked','cli',?)")
        .run('reconciled', t);
      standby.close();

      // Without a drain receipt or horizon, a reachable old main blocks promotion.
      const early: RelocationLiveness = {
        kind: 'unplanned',
        lastAckMs: 1_000,
        epochSeenAtMs: 1_000,
        allUnrevokedAckedNewEpoch: true,
        oldHostDownConfirmed: false,
        nowMs: 1_000 + RELOCATION_HORIZON_ACKED_MS - 1,
      };
      const base = {
        mainDbPath: mainPath,
        standbyDbPath: standbyPath,
        selfBaseId: 'NERV-02',
        previousMainBaseId: 'NERV-01',
        registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
        soleCoordinator: false,
      };
      refusal(() => relocateCoordinator({ ...base, liveness: early }), 'horizon_not_passed');

      // A receipt drained before the final batch reached the standby is refused.
      setState(oldMain.db, 2, 'active', 8, 'digest-8');
      const ahead = signDrainReceipt(
        oldKey.privateKey,
        drainCoordinator(oldMain.db, { baseId: 'NERV-01', coordinatorEpoch: 2, nowMs: 5 }),
      );
      refusal(
        () =>
          relocateCoordinator({
            ...base,
            liveness: { kind: 'planned', drain: ahead, oldMainPublicKey: oldKey.publicKey },
          }),
        'standby_behind',
      );

      // Planned: old main drains at seq 7; the old main is fenced and refuses effects.
      setState(oldMain.db, 2, 'active', 7, 'digest-7');
      const receipt = drainCoordinator(oldMain.db, { baseId: 'NERV-01', coordinatorEpoch: 2, nowMs: 10 });
      assert.deepEqual(receipt, {
        baseId: 'NERV-01',
        coordinatorEpoch: 2,
        finalSeq: 7,
        stateDigest: 'digest-7',
        leaseRevokedAt: 10,
      });
      assert.equal(readCoordinatorFencingState(oldMain.db)?.replicationMode, 'fenced');
      assert.throws(() => oldMain.assertActiveCoordinator(), /fenced mode/);
      const drain = signDrainReceipt(oldKey.privateKey, receipt);
      const forged: SignedDrainReceipt = { ...drain, receipt: { ...drain.receipt, finalSeq: 9 } };
      refusal(
        () =>
          relocateCoordinator({
            ...base,
            liveness: { kind: 'planned', drain: forged, oldMainPublicKey: oldKey.publicKey },
          }),
        'drain_receipt_invalid',
      );

      const result = relocateCoordinator({
        ...base,
        liveness: { kind: 'planned', drain, oldMainPublicKey: oldKey.publicKey },
      });
      assert.equal(result.newEpoch, 3);
      assert.equal(result.source, 'standby');
      assert.equal(result.quarantined, 1);

      const promoted = new Store(mainPath);
      try {
        const st = assertActiveCoordinator({ db: promoted.db });
        assert.equal(st?.coordinatorEpoch, 3);
        assert.equal(st?.leaseExpiresAt, 0, 'the old-epoch lease is never inherited');
        const parked = promoted.cancelledWorkerOutbox();
        assert.deepEqual(
          parked.map((r) => r.id),
          ['sent-unsure'],
        );
        assert.match(parked[0]!.reason, /epoch 2/);
      } finally {
        promoted.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a context-only takeover: an empty store, copied context, or an active copy of the old store', () => {
    const live: RelocationLiveness = {
      kind: 'unplanned',
      epochSeenAtMs: 0,
      allUnrevokedAckedNewEpoch: false,
      oldHostDownConfirmed: true,
      nowMs: RELOCATION_HORIZON_CONSERVATIVE_MS,
    };
    const check = (db: DatabaseSync, registryMain = { baseId: 'NERV-02', coordinatorEpoch: 3 }) =>
      checkRelocationReadiness({
        candidateDb: db,
        selfBaseId: 'NERV-02',
        previousMainBaseId: 'NERV-01',
        registryMain,
        liveness: live,
      });
    const empty = new Store(':memory:');
    refusal(() => check(empty.db), 'context_only');
    empty.db
      .prepare(
        "INSERT INTO facts(id, text, status, source, created, updated) VALUES ('f1', 'copied fact', 'active', 'owner', '2030-01-01', '2030-01-01')",
      )
      .run();
    refusal(() => check(empty.db), 'context_only');
    setState(empty.db, 2, 'active', 7, 'digest-7');
    refusal(() => check(empty.db), 'context_only');
    setState(empty.db, 2, 'standby', 7, null);
    refusal(() => check(empty.db), 'context_only');

    setState(empty.db, 2, 'standby', 7, 'digest-7');
    refusal(() => check(empty.db, { baseId: 'NERV-01', coordinatorEpoch: 3 }), 'not_named_main');
    refusal(() => check(empty.db, { baseId: 'NERV-02', coordinatorEpoch: 4 }), 'epoch_not_next');
    assert.equal(check(empty.db).newEpoch, 3);

    // Unplanned without ack history needs the owner's confirmation and the conservative wait.
    const unconfirmed = { ...live, oldHostDownConfirmed: false };
    refusal(
      () =>
        checkRelocationReadiness({
          candidateDb: empty.db,
          selfBaseId: 'NERV-02',
          previousMainBaseId: 'NERV-01',
          registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
          liveness: unconfirmed,
        }),
      'old_host_unconfirmed',
    );
    assert.equal(
      relocationHorizonMs({ allUnrevokedAckedNewEpoch: true, hasStandbyAckHistory: false }),
      RELOCATION_HORIZON_CONSERVATIVE_MS,
    );
    assert.equal(RELOCATION_HORIZON_ACKED_MS, 65_000);
    assert.equal(RELOCATION_HORIZON_CONSERVATIVE_MS, 300_000);
  });

  it('cold-restores a lost main from an owner-approved signed snapshot bound to the previous epoch, as sole coordinator', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-restore-'));
    try {
      const oldKey = generateKeyPairSync('ed25519');
      const lost = new Store(':memory:');
      setState(lost.db, 2, 'active', 12, null);
      lost.db
        .prepare(
          "INSERT INTO facts(id, text, status, source, created, updated) VALUES ('f1', 'kept fact', 'active', 'owner', '2030-01-01', '2030-01-01')",
        )
        .run();
      const exported = lost.exportCoordinatorSnapshot({
        root: ROOT_FP,
        sourceBaseId: 'NERV-01',
        coordinatorEpoch: 2,
        coordinatorFence: 3,
        headSeq: 12,
        privateKey: oldKey.privateKey,
      });
      const mainPath = join(dir, 'nerv.sqlite');
      const standbyPath = join(dir, 'coordinator-standby.sqlite');
      new Store(mainPath).close();
      const standby = new Store(standbyPath);
      standby.importStandbySnapshot({
        frames: exported.chunks,
        publicKey: oldKey.publicKey,
        expectedRoot: ROOT_FP,
        expectedMainBaseId: 'NERV-01',
      });
      standby.close();

      const restore = {
        frames: exported.chunks,
        publicKey: oldKey.publicKey,
        expectedRoot: ROOT_FP,
        ownerApproved: true,
        minHeadSeq: 12,
        snapshotDigest: exported.manifest.sha256,
      };
      const base = {
        mainDbPath: mainPath,
        standbyDbPath: standbyPath,
        selfBaseId: 'NERV-02',
        previousMainBaseId: 'NERV-01',
        registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
        soleCoordinator: true,
        liveness: {
          kind: 'unplanned',
          epochSeenAtMs: 0,
          allUnrevokedAckedNewEpoch: false,
          oldHostDownConfirmed: true,
          nowMs: RELOCATION_HORIZON_CONSERVATIVE_MS,
        } as RelocationLiveness,
      };
      refusal(
        () => relocateCoordinator({ ...base, coldRestore: { ...restore, ownerApproved: false } }),
        'restore_not_approved',
      );
      refusal(
        () => relocateCoordinator({ ...base, coldRestore: { ...restore, snapshotDigest: 'other' } }),
        'restore_mismatch',
      );
      refusal(() => relocateCoordinator({ ...base, coldRestore: { ...restore, minHeadSeq: 13 } }), 'restore_mismatch');

      const res = relocateCoordinator({ ...base, coldRestore: restore, nowMs: Date.now() });
      assert.equal(res.source, 'cold-restore');
      assert.ok(res.leaseExpiresAt > Date.now(), 'a sole coordinator arms its own lease');
      const promoted = new Store(mainPath);
      try {
        assert.equal(assertActiveCoordinator({ db: promoted.db })?.coordinatorEpoch, 3);
        assert.equal(
          (promoted.db.prepare("SELECT text FROM facts WHERE id = 'f1'").get() as { text: string }).text,
          'kept fact',
        );
      } finally {
        promoted.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kaji relocate signs revoke + main E+1; kaji drain refuses before it and signs a receipt after', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-kaji-reloc-'));
    try {
      const home = join(dir, 'home');
      const store = new Store(join(home, 'nerv.sqlite'));
      const key = createRootKey(PASS);
      writeFileSync(join(home, ROOT_KEY_FILE), key.file);
      const self = baseKey(home).publicKey;
      const pk = () =>
        generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      const reg = new Registry(store.db, key.publicKey);
      const root = (await import('../src/kaji.ts')).unlockRootKey(key.file, PASS);
      const enrolled: [string, string][] = [
        ['NERV-01', self],
        ['NERV-02', pk()],
        ['NERV-03', pk()],
      ];
      for (const [id, publicKey] of enrolled) {
        const e = enrolmentArgs(id, 'Base', publicKey, '100.64.0.9', self);
        reg.add(
          signRecord(root.privateKey, {
            kind: 'enrol',
            serial: reg.nextSerial(),
            ...e,
            issued: '2030-01-01T00:00:00.000Z',
          }),
        );
      }
      reg.add(
        signRecord(root.privateKey, {
          kind: 'main',
          serial: reg.nextSerial(),
          coordinatorEpoch: 2,
          baseId: 'NERV-01',
          issued: '2030-01-01T00:00:00.000Z',
        }),
      );
      setState(store.db, 2, 'active', 4, 'digest-4');
      const config = { kaji: { root: key.publicKey } } as unknown as Parameters<typeof runKajiCommand>[3];
      const ctx = { readSecret: async () => PASS, flag: (n: string) => (n === '--revoke' ? 'NERV-03' : undefined) };
      const noFlags = { ...ctx, flag: () => undefined };
      const receiptPath = join(dir, 'receipt.json');

      await assert.rejects(
        runKajiCommand(['drain', receiptPath], home, store, config, noFlags),
        /Sign the relocation first/,
      );
      assert.equal(store.coordinatorFencingState()?.replicationMode, 'active');

      await runKajiCommand(['relocate', 'NERV-02'], home, store, config, ctx);
      assert.equal(reg.main(), 'NERV-02');
      assert.equal(reg.mainEpoch(), 3);
      assert.equal(reg.bases().find((b) => b.baseId === 'NERV-03')?.status, 'revoked');

      await runKajiCommand(['drain', receiptPath], home, store, config, noFlags);
      const signed = JSON.parse(readFileSync(receiptPath, 'utf8')) as SignedDrainReceipt;
      assert.equal(signed.receipt.baseId, 'NERV-01');
      assert.equal(signed.receipt.finalSeq, 4);
      assert.equal(store.coordinatorFencingState()?.replicationMode, 'fenced');
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
