import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { TelegramApi, TelegramChannel } from '../src/telegram.ts';
import type { StoreApi } from '../src/runtime.ts';
import { coordinatorChannelAuthority, coordinatorTelegramContinuity } from '../src/coordinator-serve.ts';
import { KajiLink } from '../src/kaji-link.ts';
import { allUnrevokedAckedEpoch, pushCoordinatorEpoch, registryPort } from '../src/coordinator-epoch.ts';
import { spawnSync } from 'node:child_process';
import {
  CoordinatorAuthorityError,
  assertActiveCoordinator,
  readCoordinatorFencingState,
} from '../src/coordinator-authority.ts';
import { CoordinatorLeaseKeeper, STANDBY_LEASE_SCHEMA } from '../src/coordinator-lease.ts';
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
import { runKajiCommand, runKajiPromoteCommand } from '../src/cli-kaji.ts';
import {
  Registry,
  baseKey,
  createRootKey,
  enrolmentArgs,
  signRecord,
  ROOT_KEY_FILE,
  type RegistryBody,
  type SignedRecord,
} from '../src/kaji.ts';
import { pinKajiRoot, setBase } from '../src/config.ts';
import {
  PROMOTION_MARKER_FILE,
  assertNoPromotionInProgress,
  installedPromotionService,
  promoteCoordinator,
  type PromotionClock,
  type PromotionServiceControl,
} from '../src/coordinator-promote.ts';
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

// Windows CI (run 45354728396): building a promotion home (SQLite stores, base keys, signed records) costs seconds
// there, and this file built one per test. Each variant is built once and copied for every test that needs it.
const templates = new Map<string, { dir: string; data: unknown }>();
after(() => {
  for (const t of templates.values()) rmSync(t.dir, { recursive: true, force: true });
});
function fromTemplate<T>(key: string, prefix: string, build: (dir: string) => T): { dir: string; data: T } {
  let t = templates.get(key);
  if (!t) {
    const built = mkdtempSync(join(tmpdir(), 'nerv-template-'));
    t = { dir: built, data: build(built) };
    templates.set(key, t);
  }
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cpSync(t.dir, dir, { recursive: true });
  return { dir, data: t.data as T };
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
      const ctx = {
        readSecret: async () => PASS,
        flag: (n: string) => (n === '--revoke' ? 'NERV-03' : undefined),
        // F-016-T18: relocate pushes the new records; these test bases are offline.
        promotion: {
          pushEpoch: async (): Promise<never> => {
            throw new Error('offline');
          },
        },
      };
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
    const { dir, data } = fromTemplate(`promotion:${o.revokeOld === true}`, 'nerv-promote-', (t) => {
      const home = join(t, 'home');
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
        drainCoordinator(oldMain.db, {
          baseId: 'NERV-01',
          coordinatorEpoch: 2,
          newMainBaseId: 'NERV-02',
          newEpoch: 3,
        }),
      );
      oldMain.close();
      writeFileSync(join(t, 'receipt.json'), JSON.stringify(receipt));
      return { oldKey, rootPub };
    });
    const { oldKey, rootPub } = data;
    const home = join(dir, 'home');
    const receiptFile = join(dir, 'receipt.json');
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
      // NERV-01 is still enrolled: no sole lease. Re-review BLOCKER: promote cannot prove any base holds a
      // standby store, so it names none; the owner names one with kaji standby, whose probe must be acked from a
      // standby store; then the keeper renews through it and the new main holds authority.
      assert.equal(f.state()?.leaseExpiresAt, 0);
      const db = new DatabaseSync(join(f.home, 'nerv.sqlite'));
      try {
        const standbyOf = () =>
          (
            db.prepare('SELECT standby_base_id FROM coordinator_state WHERE id = 1').get() as {
              standby_base_id: string | null;
            }
          ).standby_base_id;
        assert.equal(standbyOf(), null);
        const acker = new Store(':memory:');
        setState(acker.db, 2, 'standby', 7, 'digest-7');
        const renew = async (id: string, request: { coordinatorEpoch: number; leaseSeq: number }) =>
          acker.handleStandbyLeaseRenew({ standbyBaseId: id, request, maxSeenCoordinatorEpoch: 3, processBootId: 'b' });
        const store = new Store(join(f.home, 'nerv.sqlite'), undefined, { home: f.home });
        const config = {
          kaji: { root: f.rootPub, rootBinding: true },
          base: { id: 'NERV-02' },
        } as unknown as Parameters<typeof runKajiCommand>[3];
        await runKajiCommand(['standby', 'NERV-01'], f.home, store, config, {
          readSecret: async () => '',
          flag: () => undefined,
          renewLease: renew,
        });
        store.close();
        assert.equal(standbyOf(), 'NERV-01');
        const keeper = new CoordinatorLeaseKeeper({ db, renew, hasOtherEnrolledBases: () => true });
        assert.equal(await keeper.renewOnce(), 'renewed');
        assert.equal(assertActiveCoordinator({ db })?.coordinatorEpoch, 3);
        acker.close();
      } finally {
        db.close();
      }
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

describe('F-016-T18: /kaji/epoch-push, so the new epoch acks are measured, not assumed', () => {
  it('pushes the signed records over the Kaji line; peers persist the epoch and refuse the old main; acks are recorded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-epoch-push-'));
    const root = generateKeyPairSync('ed25519');
    const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const free = async () =>
      new Promise<number>((resolve) => {
        const srv = createServer();
        srv.listen(0, '127.0.0.1', () => {
          const p = (srv.address() as { port: number }).port;
          srv.close(() => resolve(p));
        });
      });
    const ids = ['NERV-01', 'NERV-02', 'NERV-03'] as const;
    const bases = await Promise.all(
      ids.map(async (id) => {
        const home = join(dir, id);
        mkdirSync(home, { recursive: true });
        setBase(home, { id, name: id });
        pinKajiRoot(home, rootPub, true);
        const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
        return { id, home, store, reg: new Registry(store.db, rootPub), port: await free(), key: baseKey(home) };
      }),
    );
    let serial = 0;
    const signed = (body: Record<string, unknown>) =>
      signRecord(root.privateKey, {
        ...body,
        serial: ++serial,
        issued: '2026-11-24T10:00:00.000Z',
      } as unknown as RegistryBody);
    const common = [
      ...bases.map((b) =>
        signed({ kind: 'enrol', baseId: b.id, name: b.id, publicKey: b.key.publicKey, address: `127.0.0.1:${b.port}` }),
      ),
      signed({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 }),
    ];
    for (const b of bases) for (const r of common) b.reg.add(r);
    const [a, b, c] = bases as unknown as [(typeof bases)[0], (typeof bases)[0], (typeof bases)[0]];
    b.reg.add(signed({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 }));
    const links = [b, c].map(
      (x) =>
        new KajiLink({
          baseId: x.id,
          key: x.key.privateKey,
          publicKey: x.key.publicKey,
          registry: registryPort(x.reg),
          minCoordinatorEpoch: () => x.reg.mainEpoch(),
          holdsStandby: () => x.id === 'NERV-03',
          onLeaseRenew: async () => ({ ok: false, reason: 'promoting', error: 'not a standby' }),
        }),
    );
    const oldMain = new KajiLink({
      baseId: 'NERV-01',
      key: a.key.privateKey,
      publicKey: a.key.publicKey,
      registry: registryPort(a.reg),
    });
    for (const l of links) await l.start(60_000);
    try {
      const push = (id: string, records: SignedRecord[]) => links[0]!.pushEpoch(id, records);
      // NERV-01 (the old main) is unreachable: its link never listens.
      const first = await pushCoordinatorEpoch({
        db: b.store.db,
        rootPublicKey: rootPub,
        ownPublicKey: b.key.publicKey,
        push,
      });
      assert.deepEqual([first.acked, first.missing], [['NERV-03'], ['NERV-01']]);
      assert.equal(c.reg.main(), 'NERV-02');
      assert.equal(c.reg.mainEpoch(), 3, 'the peer persisted the new epoch');
      // The signed reply says whether the base holds a standby store (re-review: only such a base may be named).
      assert.equal((await links[0]!.pushEpoch('NERV-03', [])).standby, true);
      assert.equal(
        allUnrevokedAckedEpoch({ db: b.store.db, rootPublicKey: rootPub, ownPublicKey: b.key.publicKey, epoch: 3 }),
        false,
      );
      // The peer now refuses the old main with signed newer-epoch evidence (#701 review fix 2: no longer a 403).
      const refused = await oldMain.renewLease('NERV-03', { coordinatorEpoch: 2, leaseSeq: 1 });
      assert.equal(refused.ok, false);
      if (!refused.ok)
        assert.deepEqual([refused.reason, refused.maxSeenCoordinatorEpoch], ['stale_coordinator_epoch', 3]);

      // The owner revokes the lost old main: a revoked base needs no ack.
      b.reg.add(signed({ kind: 'revoke', baseId: 'NERV-01', publicKey: a.key.publicKey }));
      const second = await pushCoordinatorEpoch({
        db: b.store.db,
        rootPublicKey: rootPub,
        ownPublicKey: b.key.publicKey,
        push,
      });
      assert.deepEqual([second.acked, second.missing], [['NERV-03'], []]);
      assert.equal(
        allUnrevokedAckedEpoch({ db: b.store.db, rootPublicKey: rootPub, ownPublicKey: b.key.publicKey, epoch: 3 }),
        true,
      );
      // An ack for an older epoch does not count for a newer one.
      assert.equal(
        allUnrevokedAckedEpoch({ db: b.store.db, rootPublicKey: rootPub, ownPublicKey: b.key.publicKey, epoch: 4 }),
        false,
      );
    } finally {
      for (const l of links) await l.stop();
      for (const x of bases) x.store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('B-121-T02: the signed epoch-push reply carries the newest epoch the base ran or acked; an older peer leaves it out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-epoch-witness-'));
    const root = generateKeyPairSync('ed25519');
    const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const free = async () =>
      new Promise<number>((resolve) => {
        const srv = createServer();
        srv.listen(0, '127.0.0.1', () => {
          const p = (srv.address() as { port: number }).port;
          srv.close(() => resolve(p));
        });
      });
    const ids = ['NERV-02', 'NERV-03', 'NERV-04'] as const;
    const bases = await Promise.all(
      ids.map(async (id) => {
        const home = join(dir, id);
        mkdirSync(home, { recursive: true });
        setBase(home, { id, name: id });
        pinKajiRoot(home, rootPub, true);
        const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
        return { id, home, store, reg: new Registry(store.db, rootPub), port: await free(), key: baseKey(home) };
      }),
    );
    let serial = 0;
    const records = [
      ...bases.map((b) => ({
        kind: 'enrol',
        baseId: b.id,
        name: b.id,
        publicKey: b.key.publicKey,
        address: `127.0.0.1:${b.port}`,
      })),
      { kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 },
    ].map((body) =>
      signRecord(root.privateKey, {
        ...body,
        serial: ++serial,
        issued: '2026-11-24T10:00:00.000Z',
      } as unknown as RegistryBody),
    );
    for (const b of bases) for (const r of records) b.reg.add(r);
    const [pusher, current, older] = bases as unknown as [(typeof bases)[0], (typeof bases)[0], (typeof bases)[0]];
    const link = (x: (typeof bases)[0], ranOrAckedEpoch?: () => number) =>
      new KajiLink({
        baseId: x.id,
        key: x.key.privateKey,
        publicKey: x.key.publicKey,
        registry: registryPort(x.reg),
        holdsStandby: () => true,
        ...(ranOrAckedEpoch ? { ranOrAckedEpoch } : {}),
      });
    const self = link(pusher);
    // NERV-03 runs this version (it acked a lease at epoch 3); NERV-04 an older one, without the field.
    const peers = [link(current, () => 3), link(older)];
    for (const l of peers) await l.start(60_000);
    try {
      const now = await self.pushEpoch('NERV-03', []);
      assert.deepEqual(now, { maxSeenCoordinatorEpoch: 3, standby: true, ranOrAckedEpoch: 3 });
      const old = await self.pushEpoch('NERV-04', []);
      assert.deepEqual(old, { maxSeenCoordinatorEpoch: 3, standby: true });
      assert.equal('ranOrAckedEpoch' in old, false, 'unknown, never read as 0');
    } finally {
      for (const l of peers) await l.stop();
      for (const x of bases) x.store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kaji promote measures the acks itself: every unrevoked base acked and the lease was acked here, so no confirmation and the 65 s wait', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-promote-acks-'));
    try {
      const home = join(dir, 'home');
      mkdirSync(home, { recursive: true });
      const root = generateKeyPairSync('ed25519');
      const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      setBase(home, { id: 'NERV-02', name: 'Tabgha' });
      pinKajiRoot(home, rootPub, true);
      const oldPub = generateKeyPairSync('ed25519')
        .publicKey.export({ type: 'spki', format: 'der' })
        .toString('base64');
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
      add({ kind: 'enrol', baseId: 'NERV-01', name: 'Tokyo', publicKey: oldPub, address: '127.0.0.1:1' });
      add({
        kind: 'enrol',
        baseId: 'NERV-02',
        name: 'Tabgha',
        publicKey: baseKey(home).publicKey,
        address: '127.0.0.1:2',
      });
      add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
      add({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 });
      store.close();
      const standby = new Store(join(home, STANDBY_DB_FILE));
      setState(standby.db, 2, 'standby', 7, 'digest-7');
      standby.db.exec(STANDBY_LEASE_SCHEMA);
      standby.db.prepare("INSERT INTO standby_lease_state VALUES (1, 2, 9, ?, 'boot')").run(Date.now());
      standby.close();
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
      const events: string[] = [];
      const service = { stop: () => void events.push('stop'), start: () => void events.push('start') };
      const base = {
        home,
        rootPublicKey: rootPub,
        ownPublicKey: baseKey(home).publicKey,
        confirmOldHostDown: false,
        service,
        clock,
      };
      // The old main does not answer: not measured as acked, so the owner must confirm.
      await assert.rejects(
        promoteCoordinator({
          ...base,
          pushEpoch: async () => {
            throw new Error('unreachable');
          },
        }),
        (err: unknown) => err instanceof RelocationRefusedError && err.reason === 'old_host_unconfirmed',
      );
      // It answers with the new epoch (and fences itself): measured, the fast horizon applies.
      const start = wall;
      const res = await promoteCoordinator({ ...base, pushEpoch: async () => ({ maxSeenCoordinatorEpoch: 3 }) });
      assert.ok(!('resumed' in res));
      assert.ok(wall - start >= RELOCATION_HORIZON_ACKED_MS && wall - start < RELOCATION_HORIZON_CONSERVATIVE_MS);
      assert.deepEqual(events, ['stop', 'start']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F-016-T19: Telegram polling is handed over on activation', () => {
  it('the old main stops answering, the promoted main answers from the replicated offset, and no two bases poll at once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-tg-handover-'));
    const token = '123456:' + 'r'.repeat(35);
    const OWNER = 1111;
    // A loopback Bot API shared by both bases: it answers 409 to a poll while another is in flight, as Telegram does.
    const calls: { base: string; method: string; body: Record<string, unknown> }[] = [];
    const updates: { update_id: number; message: Record<string, unknown> }[] = [];
    let polling = 0;
    let conflicts = 0;
    const server = createHttpServer((req, res) => {
      let raw = '';
      req
        .on('data', (c) => (raw += c))
        .on('end', async () => {
          const m = /^\/(a|b)\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
          res.setHeader('content-type', 'application/json');
          const body = JSON.parse(raw || '{}') as Record<string, unknown>;
          if (!m || m[2] !== token) {
            res.statusCode = 401;
            res.end('{"ok":false}');
            return;
          }
          calls.push({ base: m[1]!, method: m[3]!, body });
          if (m[3] === 'getUpdates') {
            if (polling > 0) {
              conflicts++;
              res.statusCode = 409;
              res.end('{"ok":false,"description":"Conflict"}');
              return;
            }
            // Like Telegram, a long poll is held (2 s here) and ends early when its client disconnects.
            polling++;
            let gone = false;
            res.once('close', () => (gone = true));
            const from = (body.offset as number | undefined) ?? 0;
            for (let i = 0; i < 100 && !gone && !updates.some((u) => u.update_id >= from); i++)
              await new Promise((r) => setTimeout(r, 20));
            polling--;
            if (!gone) res.end(JSON.stringify({ ok: true, result: updates.filter((u) => u.update_id >= from) }));
            return;
          }
          res.end(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
        });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    let next = 1;
    const say = (text: string) =>
      updates.push({
        update_id: next++,
        message: {
          date: Math.floor(Date.now() / 1000),
          text,
          chat: { id: OWNER, type: 'private' },
          from: { id: OWNER },
        },
      });
    const replies = (b: string) =>
      calls.filter((c) => c.base === b && c.method === 'sendMessage').map((c) => String(c.body.text));
    const until = async (check: () => boolean) => {
      const end = Date.now() + 8000;
      while (!check()) {
        if (Date.now() > end) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const homeA = join(dir, 'a');
    const homeB = join(dir, 'b');
    mkdirSync(homeA, { recursive: true });
    mkdirSync(homeB, { recursive: true });
    const storeA = new Store(join(homeA, 'nerv.sqlite'));
    setState(storeA.db, 2, 'active', 7, 'digest-7');
    // Within the lease TTL: a lease ending further ahead is refused (#701 review fix 3).
    storeA.db.prepare('UPDATE coordinator_state SET lease_expires_at = ? WHERE id = 1').run(Date.now() + 50_000);
    new Store(join(homeB, 'nerv.sqlite')).close();
    const standby = new Store(join(homeB, STANDBY_DB_FILE));
    setState(standby.db, 2, 'standby', 7, 'digest-7');
    standby.close();
    const channel = (home: string, tag: 'a' | 'b', store: Store) =>
      new TelegramChannel({
        api: new TelegramApi(token, `${base}/${tag}`),
        store: store as unknown as StoreApi,
        chatId: OWNER,
        statePath: join(home, 'telegram-state.json'),
        log: () => {},
        authority: coordinatorChannelAuthority({
          home,
          databasePath: join(home, 'nerv.sqlite'),
          baseId: tag === 'a' ? 'NERV-01' : 'NERV-02',
          root: undefined,
        }),
        continuity: coordinatorTelegramContinuity(join(home, 'nerv.sqlite')),
        // The old main notices it lost authority only at its next check (400 ms here, 5 s by default), so its
        // last long poll can still be open when the new main activates: the new main waits a hand-over grace
        // longer than that before its first poll (observed as a 409 under load before this was added).
        standbyCheckMs: tag === 'a' ? 400 : 30,
        handoverGraceMs: 1000,
      });
    const storeB0 = new Store(join(homeB, 'nerv.sqlite'));
    let storeB: Store | undefined;
    const a = channel(homeA, 'a', storeA);
    let b = channel(homeB, 'b', storeB0);
    try {
      await a.start(50);
      await b.start(50);
      say('/start');
      await until(() => replies('a').length === 1);
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(
        calls.filter((c) => c.base === 'b').length,
        0,
        'the standby makes no Bot API call while the old main answers',
      );

      // Planned move: A drains (fenced), the offset it reached is in the replicated coordinator state.
      const oldKey = generateKeyPairSync('ed25519');
      const offset = (
        storeA.db.prepare('SELECT telegram_offset FROM coordinator_state WHERE id = 1').get() as {
          telegram_offset: number | null;
        }
      ).telegram_offset;
      assert.equal(offset, 2, 'the active main persisted its offset into the coordinator state');
      const drain = signDrainReceipt(
        oldKey.privateKey,
        drainCoordinator(storeA.db, { baseId: 'NERV-01', coordinatorEpoch: 2, newMainBaseId: 'NERV-02', newEpoch: 3 }),
      );
      const sb = new DatabaseSync(join(homeB, STANDBY_DB_FILE));
      sb.prepare('UPDATE coordinator_state SET telegram_offset = ? WHERE id = 1').run(offset);
      sb.close();
      // As kaji promote does: the service stops, the stores swap, the service starts again.
      await b.stop();
      storeB0.close();
      Store.relocateCoordinator({
        mainDbPath: join(homeB, 'nerv.sqlite'),
        standbyDbPath: join(homeB, STANDBY_DB_FILE),
        selfBaseId: 'NERV-02',
        previousMainBaseId: 'NERV-01',
        registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
        soleCoordinator: true,
        liveness: { kind: 'planned', drain, oldMainPublicKey: oldKey.publicKey },
      });
      storeB = new Store(join(homeB, 'nerv.sqlite'));
      b = channel(homeB, 'b', storeB);
      await b.start(50);
      // The old main's last long poll is still open here (its next authority check is at 400 ms).
      await new Promise((r) => setTimeout(r, 300));
      say('/start');
      await until(() => replies('b').length === 1);
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(replies('a').length, 1, 'the old main no longer answers');
      assert.equal(replies('b').length, 1, 'the new main answered only the new message, not the replayed one');
      assert.equal(calls.find((c) => c.base === 'b' && c.method === 'getUpdates')!.body.offset, 2);
      assert.equal(conflicts, 0, 'no 409 polling race');
    } finally {
      // Every handle in the two homes is closed before they are removed: Windows cannot delete an open file
      // (the channels' stop also closes their authority connections).
      await a.stop();
      await b.stop();
      storeA.close();
      if (storeB0.db.isOpen) storeB0.close();
      if (storeB?.db.isOpen) storeB.close();
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe('F-016-T17 review fixes (#702)', () => {
  it('fix 5: the installed service stops and starts idempotently, and starts on a resumed run', async () => {
    const calls: string[] = [];
    let running = true;
    const deps = (o: { stopThrows?: boolean; startThrows?: boolean; installed?: boolean } = {}) => ({
      service: (action: string) => {
        calls.push(action);
        if (o.installed === false) throw new Error('NERV Agency service is not installed.');
        if (action === 'stop') {
          if (o.stopThrows) throw new Error('launchctl failed; inspect service status and logs.');
          running = false;
        }
        if (action === 'start') {
          if (o.startThrows) throw new Error('launchctl failed; inspect service status and logs.');
          running = true;
        }
      },
      answering: async () => running,
      sleep: async () => {},
    });
    const svc = installedPromotionService('/nonexistent', deps());
    await svc.stop();
    assert.equal(running, false);
    // Already stopped: bootout fails, nothing answers, so the stop succeeded.
    await installedPromotionService('/nonexistent', deps({ stopThrows: true })).stop();
    // A fresh process (a resumed promotion) starts the service even though it did not stop it.
    await installedPromotionService('/nonexistent', deps()).start();
    assert.equal(running, true);
    // Already running: bootstrap fails, the port answers, so the start succeeded.
    await installedPromotionService('/nonexistent', deps({ startThrows: true })).start();
    // Still answering after a failed stop: refused.
    await assert.rejects(
      async () => installedPromotionService('/nonexistent', deps({ stopThrows: true })).stop(),
      /launchctl failed/,
    );
    // Not installed (a NERV run by hand): nothing to start.
    running = false;
    await installedPromotionService('/nonexistent', deps({ installed: false })).start();
    assert.deepEqual(calls.slice(0, 3), ['stop', 'stop', 'start']);
  });

  it('fix 5: a failing service stop leaves no marker behind, so serve can start again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-promote-stopfail-'));
    try {
      const home = join(dir, 'home');
      mkdirSync(home, { recursive: true });
      const root = generateKeyPairSync('ed25519');
      const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      setBase(home, { id: 'NERV-02', name: 'Tabgha' });
      pinKajiRoot(home, rootPub, true);
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
      const oldPub = generateKeyPairSync('ed25519')
        .publicKey.export({ type: 'spki', format: 'der' })
        .toString('base64');
      add({ kind: 'enrol', baseId: 'NERV-01', name: 'Tokyo', publicKey: oldPub, address: '127.0.0.1:1' });
      add({
        kind: 'enrol',
        baseId: 'NERV-02',
        name: 'Tabgha',
        publicKey: baseKey(home).publicKey,
        address: '127.0.0.1:2',
      });
      add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
      add({ kind: 'revoke', baseId: 'NERV-01', publicKey: oldPub });
      add({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 });
      store.close();
      const standby = new Store(join(home, STANDBY_DB_FILE));
      setState(standby.db, 2, 'standby', 7, 'digest-7');
      standby.close();
      await assert.rejects(
        promoteCoordinator({
          home,
          rootPublicKey: rootPub,
          ownPublicKey: baseKey(home).publicKey,
          service: {
            stop: () => {
              throw new Error('the service did not stop');
            },
            start: () => {},
          },
        }),
        /did not stop/,
      );
      assert.doesNotThrow(() => assertNoPromotionInProgress(home));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F-016-T18 review (#703): the promoted main names a base that acked the new epoch from a standby store', () => {
  it('names an acked base that holds a standby store; never one without a store (re-review)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-promote-standby-'));
    try {
      const home = join(dir, 'home');
      mkdirSync(home, { recursive: true });
      const root = generateKeyPairSync('ed25519');
      const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      setBase(home, { id: 'NERV-02', name: 'Tabgha' });
      pinKajiRoot(home, rootPub, true);
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
      const pub = () =>
        generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      const oldPub = pub();
      add({ kind: 'enrol', baseId: 'NERV-01', name: 'Tokyo', publicKey: oldPub, address: '127.0.0.1:1' });
      add({
        kind: 'enrol',
        baseId: 'NERV-02',
        name: 'Tabgha',
        publicKey: baseKey(home).publicKey,
        address: '127.0.0.1:2',
      });
      add({ kind: 'enrol', baseId: 'NERV-03', name: 'Relay', publicKey: pub(), address: '127.0.0.1:3' });
      add({ kind: 'enrol', baseId: 'NERV-04', name: 'Harbor', publicKey: pub(), address: '127.0.0.1:4' });
      add({ kind: 'enrol', baseId: 'NERV-00', name: 'Worker', publicKey: pub(), address: '127.0.0.1:5' });
      add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
      // Third review: an unplanned move needs a revoke of the old main (the owner's word is refused).
      add({ kind: 'revoke', baseId: 'NERV-01', publicKey: oldPub });
      add({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 });
      store.close();
      const standby = new Store(join(home, STANDBY_DB_FILE));
      setState(standby.db, 2, 'standby', 7, 'digest-7');
      // The old main renewed through this base: a bare confirmation is accepted (F-016-T17 re-review).
      standby.db.exec(STANDBY_LEASE_SCHEMA);
      standby.db.prepare("INSERT INTO standby_lease_state VALUES (1, 2, 9, ?, 'boot')").run(Date.now());
      standby.close();
      let wall = Date.now();
      let mono = 0n;
      await promoteCoordinator({
        home,
        rootPublicKey: rootPub,
        ownPublicKey: baseKey(home).publicKey,
        service: { stop: () => {}, start: () => {} },
        clock: {
          wall: () => wall,
          mono: () => mono,
          sleep: async (ms: number) => {
            wall += ms;
            mono += BigInt(ms) * 1_000_000n;
          },
        },
        pushEpoch: async (id) => {
          // NERV-00 acks but is a worker without a standby store; it sorts first and must still not be named.
          // NERV-00 and NERV-03 ack without a standby store (an unacked base now refuses the move: fourth review).
          if (id === 'NERV-00' || id === 'NERV-03') return { maxSeenCoordinatorEpoch: 3, standby: false };
          if (id !== 'NERV-04') throw new Error('unreachable');
          return { maxSeenCoordinatorEpoch: 3, standby: true };
        },
      });
      const db = new DatabaseSync(join(home, 'nerv.sqlite'));
      try {
        const row = db.prepare('SELECT standby_base_id FROM coordinator_state WHERE id = 1').get() as {
          standby_base_id: string | null;
        };
        assert.equal(row.standby_base_id, 'NERV-04');
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F-016-T17 re-review fixes (#702)', () => {
  async function home(o: { revokeOld?: boolean; ackHistory?: boolean } = {}) {
    const { dir, data } = fromTemplate(
      `rr:${o.revokeOld === true}:${o.ackHistory === true}`,
      'nerv-promote-rr-',
      (t) => {
        const h = join(t, 'home');
        mkdirSync(h, { recursive: true });
        const root = generateKeyPairSync('ed25519');
        const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
        setBase(h, { id: 'NERV-02', name: 'Tabgha' });
        pinKajiRoot(h, rootPub, true);
        const store = new Store(join(h, 'nerv.sqlite'), undefined, { home: h });
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
        const oldPub = generateKeyPairSync('ed25519')
          .publicKey.export({ type: 'spki', format: 'der' })
          .toString('base64');
        add({ kind: 'enrol', baseId: 'NERV-01', name: 'Tokyo', publicKey: oldPub, address: '127.0.0.1:1' });
        add({
          kind: 'enrol',
          baseId: 'NERV-02',
          name: 'Tabgha',
          publicKey: baseKey(h).publicKey,
          address: '127.0.0.1:2',
        });
        add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
        if (o.revokeOld) add({ kind: 'revoke', baseId: 'NERV-01', publicKey: oldPub });
        add({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 });
        store.close();
        const standby = new Store(join(h, STANDBY_DB_FILE));
        setState(standby.db, 2, 'standby', 7, 'digest-7');
        if (o.ackHistory) {
          standby.db.exec(STANDBY_LEASE_SCHEMA);
          standby.db.prepare("INSERT INTO standby_lease_state VALUES (1, 2, 9, ?, 'boot')").run(Date.now());
        }
        standby.close();
        return { rootPub };
      },
    );
    const { rootPub } = data;
    const h = join(dir, 'home');
    let wall = Date.now();
    let mono = 0n;
    const events: string[] = [];
    return {
      dir,
      h,
      events,
      base: {
        home: h,
        rootPublicKey: rootPub,
        ownPublicKey: baseKey(h).publicKey,
        service: { stop: () => void events.push('stop'), start: () => void events.push('start') },
        clock: {
          wall: () => wall,
          mono: () => mono,
          sleep: async (ms: number) => {
            wall += ms;
            mono += BigInt(ms) * 1_000_000n;
          },
        },
      },
      state: () => {
        const db = new DatabaseSync(join(h, 'nerv.sqlite'));
        try {
          return readCoordinatorFencingState(db);
        } finally {
          db.close();
        }
      },
    };
  }

  const config = (f: { base: { rootPublicKey: string } }) =>
    ({ kaji: { root: f.base.rootPublicKey, rootBinding: true }, base: { id: 'NERV-02' } }) as unknown as Parameters<
      typeof runKajiCommand
    >[3];
  const ctx = (f: { base: { service: PromotionServiceControl; clock: PromotionClock } }, flags: string[] = []) => ({
    readSecret: async () => '',
    flag: (n: string) => (flags.includes(n) ? '' : undefined),
    promotion: { service: f.base.service, clock: f.base.clock },
  });

  it('third review: an unplanned promotion needs a revoke of the old main; the owner word never suffices, not with stale ack history either', async () => {
    // B acked A's lease at epoch 2, then A moved its standby to D (kaji standby D) and kept renewing through D.
    const f = await home({ ackHistory: true });
    try {
      await assert.rejects(
        runKajiPromoteCommand(['promote', '--confirm-old-host-down'], f.h, config(f), ctx(f)),
        (err: unknown) =>
          err instanceof RelocationRefusedError &&
          err.reason === 'old_host_unconfirmed' &&
          /revoke/.test(err.message) &&
          /root key/.test(err.message),
      );
      assert.deepEqual(f.events, []);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
    const g = await home({ revokeOld: true });
    try {
      await runKajiPromoteCommand(['promote'], g.h, config(g), ctx(g));
      assert.equal(g.state()?.coordinatorEpoch, 3);
    } finally {
      rmSync(g.dir, { recursive: true, force: true });
    }
  });

  it('third review BLOCKER: through the CLI, a crash inside swap step 4 resumes, with no store opened or an empty one opened first', async () => {
    for (const openStoreFirst of [false, true]) {
      const f = await home({ revokeOld: true });
      try {
        await assert.rejects(promoteCoordinator({ ...f.base, failAfterStep: 3 }), /Injected crash after step 3/);
        renameSync(join(f.h, 'nerv.sqlite'), join(f.h, 'nerv.sqlite.pre-standby'));
        if (openStoreFirst) {
          // What the CLI did before this fix: it opened (and so created) an empty, migrated nerv.sqlite first.
          const store = new Store(join(f.h, 'nerv.sqlite'), undefined, { home: f.h });
          store.close();
          await runKajiCommand(['promote'], f.h, store, config(f), ctx(f));
        } else {
          // What the CLI does now for kaji promote: no Store is opened before the promotion.
          await runKajiPromoteCommand(['promote'], f.h, config(f), ctx(f));
        }
        assert.equal(f.state()?.coordinatorEpoch, 3, `openStoreFirst=${openStoreFirst}`);
        assert.equal(f.state()?.replicationMode, 'active');
        assert.doesNotThrow(() => assertNoPromotionInProgress(f.h));
      } finally {
        rmSync(f.dir, { recursive: true, force: true });
      }
    }
  });

  it('re-review fix 1: a crash between the two renames of step 4 is resumed, never answered with an empty store', async () => {
    const f = await home({ revokeOld: true });
    try {
      await assert.rejects(promoteCoordinator({ ...f.base, failAfterStep: 3 }), /Injected crash after step 3/);
      // The crash fell between "nerv.sqlite → archive" and "standby → nerv.sqlite".
      renameSync(join(f.h, 'nerv.sqlite'), join(f.h, 'nerv.sqlite.pre-standby'));
      const res = await promoteCoordinator(f.base);
      assert.ok(!('resumed' in res));
      assert.equal(f.state()?.coordinatorEpoch, 3);
      assert.equal(f.state()?.replicationMode, 'active');
      assert.doesNotThrow(() => assertNoPromotionInProgress(f.h));
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('re-review fix 2: a run never removes the marker an earlier crashed swap left', async () => {
    const f = await home({ revokeOld: true });
    try {
      await assert.rejects(promoteCoordinator({ ...f.base, failAfterStep: 4 }), /Injected crash after step 4/);
      await assert.rejects(
        promoteCoordinator({
          ...f.base,
          service: {
            stop: () => {
              throw new Error('the service did not stop');
            },
            start: () => {},
          },
        }),
        /did not stop/,
      );
      assert.throws(() => assertNoPromotionInProgress(f.h), /promotion is in progress/);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });
});

describe('F-016-T16 fourth review: the refusal names the revoke, not a removed flag', () => {
  it('an unplanned move without ack history asks for a root-signed revoke', () => {
    const standby = new Store(':memory:');
    setState(standby.db, 2, 'standby', 7, 'digest-7');
    assert.throws(
      () =>
        checkRelocationReadiness({
          candidateDb: standby.db,
          selfBaseId: 'NERV-02',
          previousMainBaseId: 'NERV-01',
          registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
          liveness: {
            kind: 'unplanned',
            epochSeenAtMs: 0,
            allUnrevokedAckedNewEpoch: false,
            oldHostDownConfirmed: false,
            nowMs: 10 * RELOCATION_HORIZON_CONSERVATIVE_MS,
            monoSinceNs: 0n,
            monoNowNs: ms(10 * RELOCATION_HORIZON_CONSERVATIVE_MS),
          },
        }),
      (err: unknown) =>
        err instanceof RelocationRefusedError &&
        err.reason === 'old_host_unconfirmed' &&
        /revoke/.test(err.message) &&
        !/confirm-old-host-down/.test(err.message),
    );
    standby.close();
  });
});

describe('F-016-T17 fourth review (#702)', () => {
  it('a revoke alone does not bound the old main while another unrevoked base may still ack its lease', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-promote-d-'));
    try {
      // Set up through the same helper shape: old main X revoked, D enrolled and unreachable (no epoch push yet).
      const h = join(dir, 'home');
      mkdirSync(h, { recursive: true });
      const root = generateKeyPairSync('ed25519');
      const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      setBase(h, { id: 'NERV-02', name: 'Tabgha' });
      pinKajiRoot(h, rootPub, true);
      const store = new Store(join(h, 'nerv.sqlite'), undefined, { home: h });
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
      const pub = () =>
        generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      const oldPub = pub();
      add({ kind: 'enrol', baseId: 'NERV-01', name: 'X', publicKey: oldPub, address: '127.0.0.1:1' });
      add({ kind: 'enrol', baseId: 'NERV-02', name: 'B', publicKey: baseKey(h).publicKey, address: '127.0.0.1:2' });
      add({ kind: 'enrol', baseId: 'NERV-04', name: 'D', publicKey: pub(), address: '127.0.0.1:4' });
      add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
      add({ kind: 'revoke', baseId: 'NERV-01', publicKey: oldPub });
      add({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 });
      store.close();
      const standby = new Store(join(h, STANDBY_DB_FILE));
      setState(standby.db, 2, 'standby', 7, 'digest-7');
      standby.close();
      const events: string[] = [];
      let wall = Date.now();
      let mono = 0n;
      await assert.rejects(
        runKajiPromoteCommand(
          ['promote'],
          h,
          { kaji: { root: rootPub, rootBinding: true }, base: { id: 'NERV-02' } } as unknown as Parameters<
            typeof runKajiCommand
          >[3],
          {
            flag: () => undefined,
            promotion: {
              service: { stop: () => void events.push('stop'), start: () => void events.push('start') },
              clock: {
                wall: () => wall,
                mono: () => mono,
                sleep: async (ms: number) => {
                  wall += ms;
                  mono += BigInt(ms) * 1_000_000n;
                },
              },
            },
          },
        ),
        (err: unknown) =>
          err instanceof RelocationRefusedError && err.reason === 'old_host_unconfirmed' && /NERV-04/.test(err.message),
      );
      assert.deepEqual(events, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a command that opens the store refuses while a promotion is unfinished, and creates no store', () => {
    const h = mkdtempSync(join(tmpdir(), 'nerv-marker-cli-'));
    try {
      writeFileSync(join(h, PROMOTION_MARKER_FILE), '{}');
      const run = spawnSync(process.execPath, ['src/cli.ts', 'remind', 'Neutral', '2031-01-01T09:00:00Z'], {
        env: { ...process.env, NERV_HOME: h, NERV_OLLAMA: 'http://127.0.0.1:9' },
        encoding: 'utf8',
      });
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /promotion is in progress/);
      assert.equal(existsSync(join(h, 'nerv.sqlite')), false);
    } finally {
      rmSync(h, { recursive: true, force: true });
    }
  });
});

describe('F-016-T18 fourth review (#703): the D scenario', () => {
  it('with the old main revoked, an unreachable unrevoked base refuses the move; once it acks the push the move proceeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-promote-d-push-'));
    try {
      const h = join(dir, 'home');
      mkdirSync(h, { recursive: true });
      const root = generateKeyPairSync('ed25519');
      const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      setBase(h, { id: 'NERV-02', name: 'B' });
      pinKajiRoot(h, rootPub, true);
      const store = new Store(join(h, 'nerv.sqlite'), undefined, { home: h });
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
      const pub = () =>
        generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      const xPub = pub();
      add({ kind: 'enrol', baseId: 'NERV-01', name: 'X', publicKey: xPub, address: '127.0.0.1:1' });
      add({ kind: 'enrol', baseId: 'NERV-02', name: 'B', publicKey: baseKey(h).publicKey, address: '127.0.0.1:2' });
      add({ kind: 'enrol', baseId: 'NERV-04', name: 'D', publicKey: pub(), address: '127.0.0.1:4' });
      add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
      add({ kind: 'revoke', baseId: 'NERV-01', publicKey: xPub });
      add({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 });
      store.close();
      const standby = new Store(join(h, STANDBY_DB_FILE));
      setState(standby.db, 2, 'standby', 7, 'digest-7');
      standby.close();
      let wall = Date.now();
      let mono = 0n;
      const base = {
        home: h,
        rootPublicKey: rootPub,
        ownPublicKey: baseKey(h).publicKey,
        service: { stop: () => {}, start: () => {} },
        clock: {
          wall: () => wall,
          mono: () => mono,
          sleep: async (ms: number) => {
            wall += ms;
            mono += BigInt(ms) * 1_000_000n;
          },
        },
      };
      // {X, D} | {B}: D does not get the revoke, so it could keep acking X's lease.
      await assert.rejects(
        promoteCoordinator({
          ...base,
          pushEpoch: async () => {
            throw new Error('partitioned');
          },
        }),
        (err: unknown) =>
          err instanceof RelocationRefusedError && err.reason === 'old_host_unconfirmed' && /NERV-04/.test(err.message),
      );
      // D acks the push carrying the revoke: it now refuses X, so B may promote.
      const res = await promoteCoordinator({ ...base, pushEpoch: async () => ({ maxSeenCoordinatorEpoch: 3 }) });
      assert.ok(!('resumed' in res));
      assert.equal(res.newEpoch, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
