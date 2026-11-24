import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import {
  CoordinatorAuthorityError,
  assertActiveCoordinator,
  readCoordinatorFencingState,
} from '../src/coordinator-authority.ts';
import { STANDBY_LEASE_SCHEMA } from '../src/coordinator-lease.ts';
import {
  RELOCATION_HORIZON_ACKED_MS,
  RELOCATION_HORIZON_CONSERVATIVE_MS,
  RelocationRefusedError,
  STANDBY_DB_FILE,
  checkRelocationReadiness,
  drainCoordinator,
  relocationHorizonMs,
  signDrainReceipt,
  type RelocationLiveness,
  type SignedDrainReceipt,
} from '../src/coordinator-relocation.ts';
import { COORDINATOR_STATE_SCHEMA } from '../src/coordinator-snapshot.ts';
import { runKajiCommand } from '../src/cli-kaji.ts';
import {
  Registry,
  baseKey,
  createRootKey,
  enrolmentArgs,
  signRecord,
  ROOT_KEY_FILE,
  type RegistryBody,
} from '../src/kaji.ts';
import { pinKajiRoot, setBase } from '../src/config.ts';
import { PROMOTION_MARKER_FILE, assertNoPromotionInProgress, promoteCoordinator } from '../src/coordinator-promote.ts';
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

const ms = (n: number) => BigInt(n) * 1_000_000n;

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

      const drainTo = { baseId: 'NERV-01', coordinatorEpoch: 2, newMainBaseId: 'NERV-02', newEpoch: 3 };
      // Without a drain receipt or horizon, a reachable old main blocks promotion.
      const early: RelocationLiveness = {
        kind: 'unplanned',
        epochSeenAtMs: 1_000,
        allUnrevokedAckedNewEpoch: true,
        oldHostDownConfirmed: true,
        nowMs: 1_000 + RELOCATION_HORIZON_ACKED_MS - 1,
        monoSinceNs: 0n,
        monoNowNs: ms(RELOCATION_HORIZON_ACKED_MS - 1),
      };
      const base = {
        mainDbPath: mainPath,
        standbyDbPath: standbyPath,
        selfBaseId: 'NERV-02',
        previousMainBaseId: 'NERV-01',
        registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
        soleCoordinator: false,
      };
      refusal(() => Store.relocateCoordinator({ ...base, liveness: early }), 'horizon_not_passed');

      // A receipt drained before the final batch reached the standby is refused.
      setState(oldMain.db, 2, 'active', 8, 'digest-8');
      const ahead = signDrainReceipt(oldKey.privateKey, drainCoordinator(oldMain.db, { ...drainTo, nowMs: 5 }));
      refusal(
        () =>
          Store.relocateCoordinator({
            ...base,
            liveness: { kind: 'planned', drain: ahead, oldMainPublicKey: oldKey.publicKey },
          }),
        'standby_behind',
      );

      // Planned: old main drains at seq 7; the old main is fenced and refuses effects.
      setState(oldMain.db, 2, 'active', 7, 'digest-7');
      const receipt = drainCoordinator(oldMain.db, { ...drainTo, nowMs: 10 });
      assert.deepEqual(receipt, {
        baseId: 'NERV-01',
        coordinatorEpoch: 2,
        finalSeq: 7,
        stateDigest: 'digest-7',
        leaseRevokedAt: 10,
        newMainBaseId: 'NERV-02',
        newEpoch: 3,
      });
      assert.equal(readCoordinatorFencingState(oldMain.db)?.replicationMode, 'fenced');
      assert.throws(() => oldMain.assertActiveCoordinator(), /fenced mode/);
      const drain = signDrainReceipt(oldKey.privateKey, receipt);
      const forged: SignedDrainReceipt = { ...drain, receipt: { ...drain.receipt, finalSeq: 9 } };
      refusal(
        () =>
          Store.relocateCoordinator({
            ...base,
            liveness: { kind: 'planned', drain: forged, oldMainPublicKey: oldKey.publicKey },
          }),
        'drain_receipt_invalid',
      );

      const result = Store.relocateCoordinator({
        ...base,
        liveness: { kind: 'planned', drain, oldMainPublicKey: oldKey.publicKey },
      });
      assert.equal(result.newEpoch, 3);
      assert.equal(result.source, 'standby');
      assert.equal(result.quarantined, 1);

      const promoted = new Store(mainPath);
      try {
        // F-016-T16 (requirement changed): lease 0 is not authority after a relocation; the new main
        // waits for its first standby-acked renewal before any effect.
        assert.equal(readCoordinatorFencingState(promoted.db)?.coordinatorEpoch, 3);
        assert.equal(
          readCoordinatorFencingState(promoted.db)?.leaseExpiresAt,
          0,
          'the old-epoch lease is never inherited',
        );
        assert.throws(
          () => assertActiveCoordinator({ db: promoted.db }),
          (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'stale_coordinator_lease',
        );
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
      monoSinceNs: 0n,
      monoNowNs: ms(RELOCATION_HORIZON_CONSERVATIVE_MS),
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
    // A re-targeted relocation (epoch 4 signed while epoch 3 never activated) takes over epoch 2.
    assert.equal(check(empty.db, { baseId: 'NERV-02', coordinatorEpoch: 4 }).previousEpoch, 2);
    refusal(() => check(empty.db, { baseId: 'NERV-02', coordinatorEpoch: 2 }), 'epoch_not_next');
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
          monoSinceNs: 0n,
          monoNowNs: ms(RELOCATION_HORIZON_CONSERVATIVE_MS),
        } as RelocationLiveness,
      };
      refusal(
        () => Store.relocateCoordinator({ ...base, coldRestore: { ...restore, ownerApproved: false } }),
        'restore_not_approved',
      );
      refusal(
        () => Store.relocateCoordinator({ ...base, coldRestore: { ...restore, snapshotDigest: 'other' } }),
        'restore_mismatch',
      );
      refusal(
        () => Store.relocateCoordinator({ ...base, coldRestore: { ...restore, minHeadSeq: 13 } }),
        'restore_mismatch',
      );

      const res = Store.relocateCoordinator({ ...base, coldRestore: restore, nowMs: Date.now() });
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
      assert.equal(signed.receipt.newMainBaseId, 'NERV-02');
      assert.equal(signed.receipt.newEpoch, 3);
      assert.equal(store.coordinatorFencingState()?.replicationMode, 'fenced');
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('re-targets a pending relocation: relocate B then C, C promotes from the epoch that actually last ran (SHOULD-FIX 3)', () => {
    const oldKey = generateKeyPairSync('ed25519');
    const oldMain = new Store(':memory:');
    setState(oldMain.db, 2, 'active', 7, 'digest-7');
    const standby = new Store(':memory:');
    setState(standby.db, 2, 'standby', 7, 'digest-7');
    // The owner signed NERV-02 at epoch 3, which never promoted, then NERV-03 at epoch 4.
    const drain = signDrainReceipt(
      oldKey.privateKey,
      drainCoordinator(oldMain.db, { baseId: 'NERV-01', coordinatorEpoch: 2, newMainBaseId: 'NERV-03', newEpoch: 4 }),
    );
    const ready = checkRelocationReadiness({
      candidateDb: standby.db,
      selfBaseId: 'NERV-03',
      previousMainBaseId: 'NERV-01',
      registryMain: { baseId: 'NERV-03', coordinatorEpoch: 4 },
      liveness: { kind: 'planned', drain, oldMainPublicKey: oldKey.publicKey },
    });
    assert.deepEqual([ready.previousEpoch, ready.newEpoch], [2, 4]);
    // A receipt whose epoch is not the standby's is refused, never assumed to be newEpoch - 1.
    setState(standby.db, 3, 'standby', 7, 'digest-7');
    refusal(
      () =>
        checkRelocationReadiness({
          candidateDb: standby.db,
          selfBaseId: 'NERV-03',
          previousMainBaseId: 'NERV-01',
          registryMain: { baseId: 'NERV-03', coordinatorEpoch: 4 },
          liveness: { kind: 'planned', drain, oldMainPublicKey: oldKey.publicKey },
        }),
      'drain_receipt_invalid',
    );
  });

  it('binds the signed drain receipt to the new main and epoch (SHOULD-FIX 4)', () => {
    const oldKey = generateKeyPairSync('ed25519');
    const oldMain = new Store(':memory:');
    setState(oldMain.db, 2, 'active', 7, 'digest-7');
    const standby = new Store(':memory:');
    setState(standby.db, 2, 'standby', 7, 'digest-7');
    // Drained for NERV-02 at epoch 3: NERV-03, later named main at epoch 4, cannot reuse it.
    const drain = signDrainReceipt(
      oldKey.privateKey,
      drainCoordinator(oldMain.db, { baseId: 'NERV-01', coordinatorEpoch: 2, newMainBaseId: 'NERV-02', newEpoch: 3 }),
    );
    assert.equal(drain.receipt.newMainBaseId, 'NERV-02');
    const check = (selfBaseId: string, coordinatorEpoch: number) =>
      checkRelocationReadiness({
        candidateDb: standby.db,
        selfBaseId,
        previousMainBaseId: 'NERV-01',
        registryMain: { baseId: selfBaseId, coordinatorEpoch },
        liveness: { kind: 'planned', drain, oldMainPublicKey: oldKey.publicKey },
      });
    refusal(() => check('NERV-03', 4), 'drain_receipt_invalid');
    refusal(() => check('NERV-02', 4), 'drain_receipt_invalid');
    const tampered: SignedDrainReceipt = { ...drain, receipt: { ...drain.receipt, newMainBaseId: 'NERV-03' } };
    refusal(
      () =>
        checkRelocationReadiness({
          candidateDb: standby.db,
          selfBaseId: 'NERV-03',
          previousMainBaseId: 'NERV-01',
          registryMain: { baseId: 'NERV-03', coordinatorEpoch: 3 },
          liveness: { kind: 'planned', drain: tampered, oldMainPublicKey: oldKey.publicKey },
        }),
      'drain_receipt_invalid',
    );
    assert.equal(check('NERV-02', 3).newEpoch, 3);
  });

  it('arms the sole-coordinator lease in the activation transaction, so a crash after it leaves no lease-0 base (SHOULD-FIX 5)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-reloc-crash-'));
    try {
      const mainPath = join(dir, 'nerv.sqlite');
      const standbyPath = join(dir, 'coordinator-standby.sqlite');
      new Store(mainPath).close();
      const standby = new Store(standbyPath);
      setState(standby.db, 2, 'standby', 7, 'digest-7');
      standby.close();
      const nowMs = Date.now();
      assert.throws(
        () =>
          Store.relocateCoordinator({
            mainDbPath: mainPath,
            standbyDbPath: standbyPath,
            selfBaseId: 'NERV-02',
            previousMainBaseId: 'NERV-01',
            registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
            soleCoordinator: true,
            nowMs,
            failAfterStep: 5,
            liveness: {
              kind: 'unplanned',
              epochSeenAtMs: 0,
              allUnrevokedAckedNewEpoch: false,
              oldHostDownConfirmed: true,
              nowMs: RELOCATION_HORIZON_CONSERVATIVE_MS,
              monoSinceNs: 0n,
              monoNowNs: ms(RELOCATION_HORIZON_CONSERVATIVE_MS),
            },
          }),
        /Injected crash after step 5/,
      );
      const promoted = new DatabaseSync(mainPath);
      try {
        const st = readCoordinatorFencingState(promoted);
        assert.equal(st?.replicationMode, 'active');
        assert.equal(st?.coordinatorEpoch, 3);
        assert.ok((st?.leaseExpiresAt ?? 0) > nowMs, 'the lease is armed in the same commit as the activation');
      } finally {
        promoted.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('F-016-T16: an unplanned move drops the owner confirmation only when the old lease was acked here and every unrevoked base acked the new epoch, after both clocks pass the horizon', () => {
    // Requirement changed from the F-016-T07 interim (always confirm): the old main now renews through this
    // standby and fences itself past its lease, so a standby-acked lease bounds it.
    const standby = new Store(':memory:');
    setState(standby.db, 2, 'standby', 7, 'digest-7');
    const check = (o: { confirmed?: boolean; allAcked?: boolean; wallMs?: number; monoMs?: number }) =>
      checkRelocationReadiness({
        candidateDb: standby.db,
        selfBaseId: 'NERV-02',
        previousMainBaseId: 'NERV-01',
        registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
        liveness: {
          kind: 'unplanned',
          epochSeenAtMs: 1_000,
          allUnrevokedAckedNewEpoch: o.allAcked ?? true,
          oldHostDownConfirmed: o.confirmed ?? false,
          nowMs: o.wallMs ?? 1_000 + RELOCATION_HORIZON_ACKED_MS,
          monoSinceNs: 0n,
          monoNowNs: ms(o.monoMs ?? RELOCATION_HORIZON_ACKED_MS),
        },
      });
    // No ack history: the old main may never have armed a lease, so the owner must confirm or revoke.
    refusal(() => check({}), 'old_host_unconfirmed');
    standby.db.exec(STANDBY_LEASE_SCHEMA);
    standby.db.prepare("INSERT INTO standby_lease_state VALUES (1, 1, 9, 1000, 'boot')").run();
    refusal(() => check({}), 'old_host_unconfirmed');
    // Acked here for the epoch that last ran: the 65 s horizon bounds it.
    standby.db.prepare('UPDATE standby_lease_state SET standby_coordinator_epoch = 2 WHERE id = 1').run();
    assert.equal(check({}).newEpoch, 3);
    // A base that did not ack the new epoch keeps the confirmation and the conservative wait.
    refusal(() => check({ allAcked: false }), 'old_host_unconfirmed');
    refusal(() => check({ allAcked: false, confirmed: true }), 'horizon_not_passed');
    // Both clocks must pass: a wall-clock jump alone does not end the wait, nor does an early monotonic reading.
    refusal(() => check({ wallMs: 1_000 + 10 * RELOCATION_HORIZON_CONSERVATIVE_MS, monoMs: 1 }), 'horizon_not_passed');
    refusal(() => check({ wallMs: 1_000 + RELOCATION_HORIZON_ACKED_MS - 1 }), 'horizon_not_passed');
    // The last ack counts from the standby's own record, not from the caller.
    standby.db.prepare('UPDATE standby_lease_state SET last_ack_wall_ms = 30000 WHERE id = 1').run();
    refusal(() => check({}), 'horizon_not_passed');
  });
});

describe('F-016-T17: nerv kaji promote stops the service, derives its inputs from verified records and resumes', () => {
  /** A base (NERV-02) holding the owner's main record at epoch 3 and a verified standby of epoch 2 from NERV-01. */
  async function promotionHome(o: { revokeOld?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-promote-'));
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const root = generateKeyPairSync('ed25519');
    const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    setBase(home, { id: 'NERV-02', name: 'Tabgha' });
    pinKajiRoot(home, rootPub, true);
    const oldKey = generateKeyPairSync('ed25519');
    const oldPub = oldKey.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
    const reg = new Registry(store.db, rootPub);
    let serial = 0;
    const add = (body: Record<string, unknown>) =>
      reg.add(
        signRecord(root.privateKey, {
          ...body,
          serial: ++serial,
          issued: '2026-11-24T10:00:00.000Z',
        } as unknown as RegistryBody),
      );
    add({ kind: 'enrol', baseId: 'NERV-01', name: 'Tokyo', publicKey: oldPub, address: '127.0.0.1:4320' });
    add({
      kind: 'enrol',
      baseId: 'NERV-02',
      name: 'Tabgha',
      publicKey: baseKey(home).publicKey,
      address: '127.0.0.1:4321',
    });
    add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
    if (o.revokeOld) add({ kind: 'revoke', baseId: 'NERV-01', publicKey: oldPub });
    add({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 });
    store.close();
    const standby = new Store(join(home, STANDBY_DB_FILE));
    setState(standby.db, 2, 'standby', 7, 'digest-7');
    standby.close();
    const oldMain = new Store(':memory:');
    setState(oldMain.db, 2, 'active', 7, 'digest-7');
    const receipt = signDrainReceipt(
      oldKey.privateKey,
      drainCoordinator(oldMain.db, { baseId: 'NERV-01', coordinatorEpoch: 2, newMainBaseId: 'NERV-02', newEpoch: 3 }),
    );
    const receiptFile = join(dir, 'receipt.json');
    writeFileSync(receiptFile, JSON.stringify(receipt));
    const events: string[] = [];
    const state = () => {
      const db = new DatabaseSync(join(home, 'nerv.sqlite'));
      try {
        return readCoordinatorFencingState(db);
      } finally {
        db.close();
      }
    };
    const service = {
      stop: async () => {
        events.push(`stop:${existsSync(join(home, STANDBY_DB_FILE)) ? 'standby-present' : 'swapped'}`);
        assert.throws(() => assertNoPromotionInProgress(home), /promotion is in progress/);
      },
      start: async () => {
        events.push(`start:${state()?.replicationMode ?? 'none'}`);
      },
    };
    let wall = Date.now();
    let mono = 0n;
    const clock = {
      wall: () => wall,
      mono: () => mono,
      sleep: async (ms: number) => {
        wall += ms;
        mono += BigInt(ms) * 1_000_000n;
      },
    };
    return {
      dir,
      home,
      oldKey,
      receiptFile,
      events,
      state,
      service,
      clock,
      ownPublicKey: baseKey(home).publicKey,
      rootPub,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  }

  it('planned: stops the service before the swap, verifies the receipt against the registry key, restarts after', async () => {
    const f = await promotionHome();
    try {
      const base = {
        home: f.home,
        rootPublicKey: f.rootPub,
        ownPublicKey: f.ownPublicKey,
        confirmOldHostDown: false,
        service: f.service,
        clock: f.clock,
      };
      // A receipt signed by a key the registry does not hold for the previous main is refused, service untouched.
      const forged = join(f.dir, 'forged.json');
      const other = generateKeyPairSync('ed25519');
      const signed = JSON.parse(readFileSync(f.receiptFile, 'utf8')) as SignedDrainReceipt;
      writeFileSync(forged, JSON.stringify(signDrainReceipt(other.privateKey, signed.receipt)));
      await assert.rejects(
        promoteCoordinator({ ...base, drainReceiptFile: forged }),
        (err: unknown) => err instanceof RelocationRefusedError && err.reason === 'drain_receipt_invalid',
      );
      assert.deepEqual(f.events, []);
      assert.doesNotThrow(() => assertNoPromotionInProgress(f.home));

      const res = await promoteCoordinator({ ...base, drainReceiptFile: f.receiptFile });
      assert.ok(!('resumed' in res));
      assert.deepEqual(f.events, ['stop:standby-present', 'start:active']);
      assert.equal(f.state()?.coordinatorEpoch, 3);
      assert.doesNotThrow(() => assertNoPromotionInProgress(f.home));
      // NERV-01 is still enrolled: no sole lease; the new main waits for its first standby ack.
      assert.equal(f.state()?.leaseExpiresAt, 0);
    } finally {
      f.cleanup();
    }
  });

  it('unplanned: needs the owner confirmation or a root-signed revoke, waits on both clocks, and resumes after a crash', async () => {
    const f = await promotionHome();
    try {
      await assert.rejects(
        promoteCoordinator({
          home: f.home,
          rootPublicKey: f.rootPub,
          ownPublicKey: f.ownPublicKey,
          confirmOldHostDown: false,
          service: f.service,
          clock: f.clock,
        }),
        (err: unknown) => err instanceof RelocationRefusedError && err.reason === 'old_host_unconfirmed',
      );
      assert.deepEqual(f.events, []);
    } finally {
      f.cleanup();
    }

    const g = await promotionHome({ revokeOld: true });
    try {
      const base = {
        home: g.home,
        rootPublicKey: g.rootPub,
        ownPublicKey: g.ownPublicKey,
        confirmOldHostDown: false,
        service: g.service,
        clock: g.clock,
      };
      const start = g.clock.wall();
      await assert.rejects(promoteCoordinator({ ...base, failAfterStep: 4 }), /Injected crash after step 4/);
      assert.ok(g.clock.wall() - start >= RELOCATION_HORIZON_CONSERVATIVE_MS, 'the conservative wait passed first');
      assert.deepEqual(g.events, ['stop:standby-present']);
      // The service stays down while the promotion is unfinished.
      assert.throws(() => assertNoPromotionInProgress(g.home), /promotion is in progress/);

      const res = await promoteCoordinator(base);
      assert.ok(!('resumed' in res));
      assert.deepEqual(g.events, ['stop:standby-present', 'stop:swapped', 'start:active']);
      assert.equal(g.state()?.coordinatorEpoch, 3);
      assert.ok((g.state()?.leaseExpiresAt ?? 0) > 0, 'the only enrolled base arms its own lease');

      // A crash after activation: a re-run only finishes (restart, guard cleared).
      writeFileSync(join(g.home, PROMOTION_MARKER_FILE), '{}');
      const again = await promoteCoordinator(base);
      assert.ok('resumed' in again);
      assert.equal(g.events.at(-1), 'start:active');
      assert.doesNotThrow(() => assertNoPromotionInProgress(g.home));
    } finally {
      g.cleanup();
    }
  });

  it('kaji promote runs from the CLI with the receipt file and the injected service control', async () => {
    const f = await promotionHome();
    try {
      const store = new Store(join(f.home, 'nerv.sqlite'), undefined, { home: f.home });
      const config = { kaji: { root: f.rootPub, rootBinding: true }, base: { id: 'NERV-02' } } as unknown as Parameters<
        typeof runKajiCommand
      >[3];
      store.close();
      await runKajiCommand(['promote', '--drain-receipt', f.receiptFile], f.home, store, config, {
        readSecret: async () => PASS,
        flag: (n: string) => (n === '--drain-receipt' ? f.receiptFile : undefined),
        promotion: { service: f.service, clock: f.clock },
      });
      assert.deepEqual(f.events, ['stop:standby-present', 'start:active']);
      assert.equal(f.state()?.coordinatorEpoch, 3);
    } finally {
      f.cleanup();
    }
  });
});
