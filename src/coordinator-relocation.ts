import { sign, verify, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readCoordinatorFencingState } from './coordinator-authority.ts';
import { LEASE_TTL_MS, applyCoordinatorLease } from './coordinator-lease.ts';
import {
  promoteStandbyDatabase,
  reassembleCoordinatorSnapshot,
  type PromoteStandbySwapInput,
  type PromoteStandbySwapResult,
} from './coordinator-snapshot.ts';
import { KAJI_CLOCK_SKEW_MS } from './kaji-auth.ts';
import { canonical } from './kaji.ts';

/** The standby store a base keeps next to `nerv.sqlite` (decision §1). */
export const STANDBY_DB_FILE = 'coordinator-standby.sqlite';

/** Promotion horizon when every unrevoked peer and worker acknowledged the new epoch (decision §4). */
export const RELOCATION_HORIZON_ACKED_MS = LEASE_TTL_MS + 5_000;
/** Promotion horizon when any destination did not acknowledge the new epoch, or no ack history exists. */
export const RELOCATION_HORIZON_CONSERVATIVE_MS = LEASE_TTL_MS + 2 * KAJI_CLOCK_SKEW_MS;

export type RelocationRefusal =
  | 'not_named_main'
  | 'epoch_not_next'
  | 'context_only'
  | 'drain_receipt_invalid'
  | 'standby_behind'
  | 'old_host_unconfirmed'
  | 'horizon_not_passed'
  | 'restore_mismatch'
  | 'restore_not_approved'
  | 'previous_main_unknown'
  | 'peer_epoch_unknown';

export class RelocationRefusedError extends Error {
  readonly reason: RelocationRefusal;
  constructor(reason: RelocationRefusal, message: string) {
    super(message);
    this.name = 'RelocationRefusedError';
    this.reason = reason;
  }
}

/** What the old coordinator hands over when it drains for a planned relocation. */
export interface DrainReceipt {
  readonly baseId: string;
  readonly coordinatorEpoch: number;
  readonly finalSeq: number;
  readonly stateDigest: string | null;
  readonly leaseRevokedAt: number;
  /** The base the owner-signed main record names: a receipt hands over to that base only. */
  readonly newMainBaseId: string;
  /** The epoch the owner signed for the new main: a receipt is never reused for a later relocation. */
  readonly newEpoch: number;
}

export interface SignedDrainReceipt {
  readonly receipt: DrainReceipt;
  readonly signature: string;
}

/**
 * Planned relocation, old coordinator side: stops coordinator authority (`draining`, then `fenced`
 * with the lease cleared) in one transaction and returns the drain receipt, bound to the new main
 * and epoch the owner signed. Idempotent for the same epoch so a lost reply can be fetched again;
 * refuses any other epoch. The fencing state is read inside the write transaction.
 *
 * B-121 (review of #721): a receipt says this base's epoch ran last, so it refuses when the verified registry
 * holds a main record signed between that epoch and the target: that base may have promoted and run (with a
 * receipt this base gave it, or unplanned), and this base cannot know it did not. Such a re-target goes through
 * an unplanned `kaji promote`, which hears from every unrevoked base which epochs ran.
 */
export function drainCoordinator(
  db: DatabaseSync,
  input: {
    readonly baseId: string;
    readonly coordinatorEpoch: number;
    readonly newMainBaseId: string;
    readonly newEpoch: number;
    /** Every verified owner-signed main record in this base's registry. */
    readonly registryMains: readonly { readonly baseId: string | undefined; readonly coordinatorEpoch: number }[];
    readonly nowMs?: number;
  },
): DrainReceipt {
  if (input.newEpoch <= input.coordinatorEpoch)
    throw new Error(`The new epoch ${input.newEpoch} must be later than ${input.coordinatorEpoch}.`);
  const between = input.registryMains
    .filter((m) => m.coordinatorEpoch > input.coordinatorEpoch && m.coordinatorEpoch < input.newEpoch)
    .sort((a, b) => a.coordinatorEpoch - b.coordinatorEpoch);
  if (between.length)
    throw new Error(
      `The owner named ${between.map((m) => `${m.baseId ?? 'a base'} at epoch ${m.coordinatorEpoch}`).join(', ')} after this coordinator's epoch ${input.coordinatorEpoch}: it may have run, so a receipt from here cannot say epoch ${input.coordinatorEpoch} ran last. Move with kaji promote on ${input.newMainBaseId} without a receipt (every unrevoked base must answer).`,
    );
  const nowMs = input.nowMs ?? Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const state = readCoordinatorFencingState(db);
    if (!state) throw new Error('This base holds no coordinator state to drain.');
    if (state.coordinatorEpoch !== input.coordinatorEpoch)
      throw new Error(`Coordinator epoch ${state.coordinatorEpoch} does not match ${input.coordinatorEpoch}.`);
    if (state.replicationMode === 'standby') throw new Error('A standby has no coordinator authority to drain.');
    if (state.replicationMode === 'active')
      db.prepare("UPDATE coordinator_state SET replication_mode = 'draining' WHERE id = 1").run();
    db.prepare("UPDATE coordinator_state SET replication_mode = 'fenced', lease_expires_at = 0 WHERE id = 1").run();
    const row = db.prepare('SELECT head_seq, state_digest FROM coordinator_state WHERE id = 1').get() as {
      head_seq: number;
      state_digest: string | null;
    };
    db.exec('COMMIT');
    return {
      baseId: input.baseId,
      coordinatorEpoch: input.coordinatorEpoch,
      finalSeq: row.head_seq,
      stateDigest: row.state_digest,
      leaseRevokedAt: nowMs,
      newMainBaseId: input.newMainBaseId,
      newEpoch: input.newEpoch,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function signDrainReceipt(privateKey: KeyObject, receipt: DrainReceipt): SignedDrainReceipt {
  return { receipt, signature: sign(null, Buffer.from(canonical(receipt), 'utf8'), privateKey).toString('base64') };
}

export function verifyDrainReceipt(signed: SignedDrainReceipt, publicKey: KeyObject): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonical(signed.receipt), 'utf8'),
      publicKey,
      Buffer.from(signed.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/** The wait a standby must observe before an unplanned promotion (decision §4, Section 2 horizon). */
export function relocationHorizonMs(input: {
  readonly allUnrevokedAckedNewEpoch: boolean;
  readonly hasStandbyAckHistory: boolean;
}): number {
  return input.allUnrevokedAckedNewEpoch && input.hasStandbyAckHistory
    ? RELOCATION_HORIZON_ACKED_MS
    : RELOCATION_HORIZON_CONSERVATIVE_MS;
}

/** How the old coordinator is known to have stopped. */
export type RelocationLiveness =
  | {
      readonly kind: 'planned';
      readonly drain: SignedDrainReceipt;
      readonly oldMainPublicKey: KeyObject;
    }
  | {
      readonly kind: 'unplanned';
      /** When this base first saw the owner-signed main record for the new epoch. */
      readonly epochSeenAtMs: number;
      readonly allUnrevokedAckedNewEpoch: boolean;
      /**
       * A root-signed revoke of the old main is held here (`kaji promote` sets this only from the registry).
       * Required unless this standby acked the old main's lease for the epoch that last ran (so the old main
       * renews through it and fences itself past the lease, F-016-T16) and every unrevoked base acked the new epoch.
       */
      readonly oldHostDownConfirmed: boolean;
      readonly nowMs?: number;
      /**
       * The monotonic instant the wait counts from: the last ack in this process, or this process's start
       * when the ack was recorded by an earlier one. The wait must pass on this clock and on the wall clock.
       */
      readonly monoSinceNs: bigint;
      readonly monoNowNs?: bigint;
    };

/** Wall time of the last lease ack this standby gave for `epoch` (`standby_lease_state`), if any. */
function standbyLastAckMs(db: DatabaseSync, epoch: number): number | undefined {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='standby_lease_state'").get())
    return undefined;
  const row = db
    .prepare('SELECT standby_coordinator_epoch, last_ack_wall_ms FROM standby_lease_state WHERE id = 1')
    .get() as { standby_coordinator_epoch: number; last_ack_wall_ms: number } | undefined;
  return row && row.standby_coordinator_epoch === epoch ? row.last_ack_wall_ms : undefined;
}

/** The newest epoch this standby acked a lease for (`standby_lease_state`), 0 when it never acked one. */
function standbyAckedEpoch(db: DatabaseSync): number {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='standby_lease_state'").get()) return 0;
  const row = db.prepare('SELECT standby_coordinator_epoch FROM standby_lease_state WHERE id = 1').get() as
    { standby_coordinator_epoch: number } | undefined;
  return row?.standby_coordinator_epoch ?? 0;
}

/**
 * B-121-T02: the newest coordinator epoch this base ran or acked a lease at: the epoch of the coordinator state
 * in `nerv.sqlite` and in the standby store next to it (a state at epoch E exists only because a coordinator ran
 * E), and the newest lease ack in either. `/kaji/epoch-push` replies carry it, so a re-targeted move learns that a
 * later coordinator ran than the state its standby holds, even when that coordinator renewed through another base.
 */
export function ranOrAckedCoordinatorEpoch(mainDb: DatabaseSync, standbyDbPath: string): number {
  const of = (db: DatabaseSync) =>
    Math.max(readCoordinatorFencingState(db)?.coordinatorEpoch ?? 0, standbyAckedEpoch(db));
  if (!existsSync(standbyDbPath)) return of(mainDb);
  const standby = new DatabaseSync(standbyDbPath);
  try {
    standby.exec('PRAGMA busy_timeout = 5000');
    return Math.max(of(mainDb), of(standby));
  } finally {
    standby.close();
  }
}

/** Owner-approved cold restore from a verified signed snapshot bound to the previous epoch. */
export interface ColdRestoreBinding {
  readonly frames: readonly Buffer[];
  readonly publicKey: KeyObject;
  readonly expectedRoot: string;
  readonly ownerApproved: boolean;
  readonly minHeadSeq: number;
  readonly snapshotDigest: string;
}

export interface RelocationReadinessInput {
  /** The database that would become the coordinator: `coordinator-standby.sqlite`, or `nerv.sqlite` after an interrupted swap. */
  readonly candidateDb: DatabaseSync;
  readonly selfBaseId: string;
  readonly previousMainBaseId: string;
  /** The newest owner-signed `kind: 'main'` record this base holds. */
  readonly registryMain: { readonly baseId: string | undefined; readonly coordinatorEpoch: number };
  readonly liveness: RelocationLiveness;
  readonly coldRestore?: ColdRestoreBinding;
}

export interface RelocationReadiness {
  readonly previousEpoch: number;
  readonly newEpoch: number;
  readonly headSeq: number;
  readonly source: 'standby' | 'cold-restore';
}

/**
 * The checks that need only this base's own stores (#717 review): the owner-signed record names this base at
 * a later epoch, the candidate is a verified standby, and it acked no lease at a later epoch than its state.
 * `kaji promote` runs them before it pushes the new epoch, so a move that cannot happen tells no other base.
 */
export function checkStandbyCandidate(
  input: Pick<RelocationReadinessInput, 'candidateDb' | 'selfBaseId' | 'registryMain'>,
): {
  readonly previousEpoch: number;
  readonly newEpoch: number;
  readonly headSeq: number;
  readonly stateDigest: string;
} {
  const refuse = (reason: RelocationRefusal, detail: string): never => {
    throw new RelocationRefusedError(reason, detail);
  };
  const { registryMain } = input;
  if (registryMain.baseId !== input.selfBaseId)
    refuse('not_named_main', `The owner-signed main record names ${registryMain.baseId ?? 'no base'}, not this base.`);
  const newEpoch = registryMain.coordinatorEpoch;
  if (newEpoch < 2)
    refuse('epoch_not_next', `Relocation needs a main record at epoch 2 or later; this one is ${newEpoch}.`);

  const state = readCoordinatorFencingState(input.candidateDb);
  const head =
    state &&
    (input.candidateDb.prepare('SELECT head_seq FROM coordinator_state WHERE id = 1').get() as { head_seq: number });
  if (!state || state.replicationMode !== 'standby' || !state.stateDigest || !head)
    refuse(
      'context_only',
      'No verified standby state: copied context, chat logs or an empty store never grant coordinator authority.',
    );
  const previousEpoch = state!.coordinatorEpoch;
  if (previousEpoch < 1 || previousEpoch >= newEpoch)
    refuse(
      'epoch_not_next',
      `The standby holds epoch ${previousEpoch}; the owner-signed record at epoch ${newEpoch} must be later.`,
    );
  // F-016-T08: this standby acked a lease at a later epoch than the state it holds, so a later coordinator ran
  // (with effects) after that state: taking over from it would undo, and could repeat, what that coordinator did.
  const ackedEpoch = standbyAckedEpoch(input.candidateDb);
  if (ackedEpoch > previousEpoch)
    refuse(
      'standby_behind',
      `This standby acked a coordinator lease at epoch ${ackedEpoch}, but its store holds epoch ${previousEpoch}: re-seed it from the epoch ${ackedEpoch} coordinator first.`,
    );
  return { previousEpoch, newEpoch, headSeq: head!.head_seq, stateDigest: state!.stateDigest! };
}

/**
 * Decides whether this base may activate as coordinator for the epoch the owner signed.
 * Never automatic: the owner-signed main record must name this base at a later epoch than its standby.
 * Context alone never grants leadership: the candidate must be a verified standby
 * (`replication_mode = 'standby'` with a state digest), or an owner-approved cold restore whose
 * signed snapshot binds to the standby's epoch.
 *
 * The previous epoch is the epoch of the coordinator that actually last ran, never assumed to be
 * `newEpoch - 1`: it is the standby's replicated epoch, and the signed drain receipt or snapshot must
 * name the same epoch. So a relocation the owner re-targets (main B at E+1 signed, B never promoted,
 * main C at E+2 signed) still takes over from epoch E.
 */
export function checkRelocationReadiness(input: RelocationReadinessInput): RelocationReadiness {
  const refuse = (reason: RelocationRefusal, detail: string): never => {
    throw new RelocationRefusedError(reason, detail);
  };
  const { previousEpoch, newEpoch, headSeq, stateDigest } = checkStandbyCandidate(input);

  let source: RelocationReadiness['source'] = 'standby';
  if (input.coldRestore) {
    const restore = input.coldRestore;
    if (!restore.ownerApproved) refuse('restore_not_approved', 'A cold restore needs explicit owner approval.');
    let manifest;
    try {
      manifest = reassembleCoordinatorSnapshot(restore.frames, {
        publicKey: restore.publicKey,
        expectedRoot: restore.expectedRoot,
        expectedMainBaseId: input.previousMainBaseId,
      }).manifest;
    } catch (err) {
      return refuse('restore_mismatch', `The snapshot does not verify: ${(err as Error).message}`);
    }
    if (manifest.coordinatorEpoch !== previousEpoch)
      refuse('restore_mismatch', `The snapshot is from epoch ${manifest.coordinatorEpoch}, not ${previousEpoch}.`);
    if (manifest.sha256 !== restore.snapshotDigest)
      refuse('restore_mismatch', 'The snapshot digest is not the one the owner approved.');
    if (manifest.headSeq < restore.minHeadSeq)
      refuse('restore_mismatch', `The snapshot head ${manifest.headSeq} is older than ${restore.minHeadSeq}.`);
    if (stateDigest !== manifest.sha256 || headSeq !== manifest.headSeq)
      refuse('restore_mismatch', 'The standby store does not hold the approved snapshot.');
    source = 'cold-restore';
  }

  const live = input.liveness;
  if (live.kind === 'planned') {
    const r = live.drain.receipt;
    if (
      !verifyDrainReceipt(live.drain, live.oldMainPublicKey) ||
      r.baseId !== input.previousMainBaseId ||
      r.coordinatorEpoch !== previousEpoch ||
      r.newMainBaseId !== input.selfBaseId ||
      r.newEpoch !== newEpoch
    )
      refuse(
        'drain_receipt_invalid',
        'The drain receipt is not signed by the previous main base for the standby epoch, handing over to this base at this epoch.',
      );
    if (headSeq !== r.finalSeq || stateDigest !== r.stateDigest)
      refuse(
        'standby_behind',
        `The standby is at ${headSeq}; the drained coordinator ended at ${r.finalSeq}. Replicate the final batch first.`,
      );
  } else {
    // F-016-T16: the old main's lease is bounded only when it was acked here for the epoch that last ran
    // (it then renews through this base and fences itself past it). The ack is read from this base's own
    // record, never from the caller. Without it, or with a base that did not ack the new epoch, the owner
    // confirms the old host is down or revokes it.
    const lastAckMs = standbyLastAckMs(input.candidateDb, previousEpoch);
    const hasAckHistory = lastAckMs !== undefined;
    if (!live.oldHostDownConfirmed && !(hasAckHistory && live.allUnrevokedAckedNewEpoch))
      refuse(
        'old_host_unconfirmed',
        'The wait alone does not bound the old main here: revoke it with the root key first (kaji relocate BASE-ID --revoke OLD-ID, then kaji import here).',
      );
    const horizon = relocationHorizonMs({
      allUnrevokedAckedNewEpoch: live.allUnrevokedAckedNewEpoch,
      hasStandbyAckHistory: hasAckHistory,
    });
    const since = Math.max(lastAckMs ?? 0, live.epochSeenAtMs);
    const nowMs = live.nowMs ?? Date.now();
    const monoElapsedMs = Number(((live.monoNowNs ?? process.hrtime.bigint()) - live.monoSinceNs) / 1_000_000n);
    if (nowMs - since < horizon || monoElapsedMs < horizon)
      refuse(
        'horizon_not_passed',
        `The old lease may still be live: wait ${horizon / 1000} s on this base's clocks (wall clock until ${new Date(since + horizon).toISOString()}).`,
      );
  }
  return { previousEpoch, newEpoch, headSeq, source };
}

/**
 * Quarantines remote requests whose delivery is uncertain across the cutover: incomplete outbox rows
 * that were attempted without a reconciliation, and pending legacy rows. They are parked for the
 * owner (`workers` cancelled list) and never redelivered under the new epoch.
 */
export function quarantineUncertainOutbox(db: DatabaseSync, previousEpoch: number, nowIso: string): number {
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (!has('kaji_outbox') || !has('worker_outbox_cancels')) return 0;
  const attempted = has('worker_outbox_attempts')
    ? `EXISTS (SELECT 1 FROM worker_outbox_attempts a WHERE a.id = q.id)${
        has('worker_outbox_reconciliations')
          ? ' AND NOT EXISTS (SELECT 1 FROM worker_outbox_reconciliations r WHERE r.id = q.id)'
          : ''
      }`
    : '0';
  const legacy = has('worker_legacy_outbox')
    ? "EXISTS (SELECT 1 FROM worker_legacy_outbox h WHERE h.id = q.id AND h.state = 'pending')"
    : '0';
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO worker_outbox_cancels(id, reason, created)
       SELECT q.id, ?, ? FROM kaji_outbox q WHERE q.done IS NULL AND ((${attempted}) OR (${legacy}))`,
    )
    .run(
      `Uncertain: sent under coordinator epoch ${previousEpoch} before relocation; reconcile by hand, never resent.`,
      nowIso,
    );
  return Number(res.changes);
}

export interface RelocateCoordinatorInput extends Omit<RelocationReadinessInput, 'candidateDb'> {
  readonly mainDbPath: string;
  readonly standbyDbPath: string;
  /** No other enrolled, unrevoked base remains to ack the lease: arm a single-base lease. */
  readonly soleCoordinator: boolean;
  /**
   * The enrolled, unrevoked base this coordinator renews its lease through (F-016-T16 review). Without it a
   * coordinator with other bases enrolled holds no lease until the owner names one (`nerv kaji standby`).
   */
  readonly standbyBaseId?: string;
  readonly quiesce?: () => void;
  readonly restart?: () => void;
  readonly nowMs?: number;
  /** Test-only crash injection, passed to the promotion swap. */
  readonly failAfterStep?: PromoteStandbySwapInput['failAfterStep'];
}

export interface RelocateCoordinatorResult extends RelocationReadiness {
  readonly promotion: PromoteStandbySwapResult;
  readonly quarantined: number;
  readonly leaseExpiresAt: number;
}

/**
 * Owner-initiated relocation, new coordinator side (F-016-T07): checks readiness on the candidate store,
 * runs the promotion swap, and in its activation transaction quarantines uncertain outbox rows,
 * clears the inherited lease and, for a sole coordinator, arms its own lease in the same commit, so a
 * crash after activation never leaves an active base with lease 0. With other bases enrolled the lease
 * waits for a standby ack (`POST /kaji/lease/renew`).
 */
export function relocateCoordinator(input: RelocateCoordinatorInput): RelocateCoordinatorResult {
  const candidatePath = existsSync(input.standbyDbPath) ? input.standbyDbPath : input.mainDbPath;
  if (!existsSync(candidatePath))
    throw new RelocationRefusedError('context_only', 'No standby store to promote: restore a verified snapshot first.');
  const candidateDb = new DatabaseSync(candidatePath);
  let readiness: RelocationReadiness;
  try {
    readiness = checkRelocationReadiness({ ...input, candidateDb });
  } finally {
    candidateDb.close();
  }
  const nowMs = input.nowMs ?? Date.now();
  let quarantined = 0;
  let leaseExpiresAt = 0;
  const promotion = promoteStandbyDatabase({
    mainDbPath: input.mainDbPath,
    standbyDbPath: input.standbyDbPath,
    newCoordinatorEpoch: readiness.newEpoch,
    ...(input.quiesce ? { quiesce: input.quiesce } : {}),
    ...(input.failAfterStep ? { failAfterStep: input.failAfterStep } : {}),
    activate: (db) => {
      quarantined = quarantineUncertainOutbox(db, readiness.previousEpoch, new Date(nowMs).toISOString());
      // The standby the old main renewed through was this base: the new main renews through the one named here.
      db.prepare(
        'UPDATE coordinator_state SET lease_issued_at = NULL, lease_expires_at = 0, standby_base_id = ? WHERE id = 1',
      ).run(input.soleCoordinator ? null : (input.standbyBaseId ?? null));
      if (input.soleCoordinator)
        leaseExpiresAt = applyCoordinatorLease(db, {
          coordinatorEpoch: readiness.newEpoch,
          reqStartedWallMs: nowMs,
          reqStartedMonoNs: process.hrtime.bigint(),
        }).leaseExpiresAt;
    },
  });
  if (input.restart) input.restart();
  return { ...readiness, promotion, quarantined, leaseExpiresAt };
}
