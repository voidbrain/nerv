import type { DatabaseSync } from 'node:sqlite';
import { readCoordinatorFencingState } from './coordinator-authority.ts';

export const LEASE_TTL_MS = 60_000;
const LEASE_SAFETY_MARGIN_MS = 5_000;
export const LEASE_EFFECTIVE_TTL_MS = LEASE_TTL_MS - LEASE_SAFETY_MARGIN_MS;
/** Target renewal interval of the active coordinator's lease (decision §2). */
export const LEASE_RENEW_MS = 15_000;

export const STANDBY_LEASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS standby_lease_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  standby_coordinator_epoch INTEGER NOT NULL,
  last_ack_seq INTEGER NOT NULL,
  last_ack_wall_ms INTEGER NOT NULL,
  process_boot_id TEXT NOT NULL
);
`;

export interface LeaseRenewRequest {
  readonly coordinatorEpoch: number;
  readonly leaseSeq: number;
}

export type LeaseRenewResult =
  | {
      readonly ok: true;
      readonly standbyBaseId: string;
      readonly coordinatorEpoch: number;
      readonly ackSeq: number;
      readonly headSeq: number;
      readonly leaseTtlMs: number;
    }
  | {
      readonly ok: false;
      /** `not_standby`: this base holds no standby store, so it never acks a lease (F-016-T16 re-review). */
      readonly reason: 'stale_coordinator_epoch' | 'stale_lease_seq' | 'promoting' | 'not_standby';
      readonly maxSeenCoordinatorEpoch?: number;
      readonly error: string;
    };

export interface HandleStandbyLeaseRenewInput {
  readonly standbyBaseId: string;
  readonly request: LeaseRenewRequest;
  readonly maxSeenCoordinatorEpoch: number;
  readonly processBootId: string;
  readonly promoting?: boolean;
  readonly nowMs?: number;
}

/**
 * Standby-side handler for `POST /kaji/lease/renew` (F-016-T06):
 * verifies epoch continuity, non-promotion, and monotonic `leaseSeq`, persists `standby_lease_state`,
 * and returns a signed lease acknowledgement without rejecting expired incoming `X-Kaji-Lease-Expires-At`.
 */
export function handleStandbyLeaseRenew(db: DatabaseSync, input: HandleStandbyLeaseRenewInput): LeaseRenewResult {
  db.exec(STANDBY_LEASE_SCHEMA);
  const { request, maxSeenCoordinatorEpoch, standbyBaseId, processBootId } = input;
  const nowMs = input.nowMs ?? Date.now();

  if (
    !Number.isSafeInteger(request.coordinatorEpoch) ||
    request.coordinatorEpoch < 1 ||
    !Number.isSafeInteger(request.leaseSeq) ||
    request.leaseSeq < 1
  ) {
    return {
      ok: false,
      reason: 'stale_lease_seq',
      error: 'Invalid coordinatorEpoch or leaseSeq.',
    };
  }

  const fencing = readCoordinatorFencingState(db);
  if (input.promoting || fencing?.replicationMode === 'active') {
    return {
      ok: false,
      reason: 'promoting',
      maxSeenCoordinatorEpoch,
      error: 'Standby has begun promoting and cannot renew an older lease.',
    };
  }

  // Only a store that holds the replicated standby acks: its base is the one that would promote, so its refusal
  // is what bounds the old main. A worker's or a drained main's store never acks.
  if (fencing?.replicationMode !== 'standby') {
    return {
      ok: false,
      reason: 'not_standby',
      maxSeenCoordinatorEpoch,
      error: 'This base holds no coordinator standby store.',
    };
  }

  const prev = db
    .prepare('SELECT standby_coordinator_epoch, last_ack_seq FROM standby_lease_state WHERE id = 1')
    .get() as { standby_coordinator_epoch: number; last_ack_seq: number } | undefined;

  if (
    request.coordinatorEpoch !== maxSeenCoordinatorEpoch ||
    (prev && request.coordinatorEpoch < prev.standby_coordinator_epoch)
  ) {
    return {
      ok: false,
      reason: 'stale_coordinator_epoch',
      maxSeenCoordinatorEpoch,
      error: `Coordinator epoch ${request.coordinatorEpoch} does not match maxSeenCoordinatorEpoch ${maxSeenCoordinatorEpoch}.`,
    };
  }

  if (prev && prev.standby_coordinator_epoch === request.coordinatorEpoch && request.leaseSeq <= prev.last_ack_seq) {
    return {
      ok: false,
      reason: 'stale_lease_seq',
      maxSeenCoordinatorEpoch,
      error: `Lease seq ${request.leaseSeq} is not newer than last acked seq ${prev.last_ack_seq}.`,
    };
  }

  db.prepare(
    `INSERT INTO standby_lease_state (id, standby_coordinator_epoch, last_ack_seq, last_ack_wall_ms, process_boot_id)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       standby_coordinator_epoch = excluded.standby_coordinator_epoch,
       last_ack_seq = excluded.last_ack_seq,
       last_ack_wall_ms = excluded.last_ack_wall_ms,
       process_boot_id = excluded.process_boot_id`,
  ).run(request.coordinatorEpoch, request.leaseSeq, nowMs, processBootId);

  const headRow = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coordinator_state'").get()
    ? (db.prepare('SELECT head_seq FROM coordinator_state WHERE id = 1').get() as { head_seq: number } | undefined)
    : undefined;

  return {
    ok: true,
    standbyBaseId,
    coordinatorEpoch: request.coordinatorEpoch,
    ackSeq: request.leaseSeq,
    headSeq: headRow?.head_seq ?? 0,
    leaseTtlMs: LEASE_TTL_MS,
  };
}

export interface ApplyCoordinatorLeaseInput {
  readonly coordinatorEpoch: number;
  readonly reqStartedWallMs: number;
  readonly reqStartedMonoNs: bigint;
}

export interface AppliedCoordinatorLease {
  readonly leaseIssuedAt: number;
  readonly leaseExpiresAt: number;
  readonly leaseExpiresMonoNs: bigint;
}

/**
 * Coordinator-side commit after receiving a signed standby lease ack (or sole-coordinator re-arm):
 * sets `lease_issued_at` and `lease_expires_at = reqStartedWallMs + LEASE_EFFECTIVE_TTL_MS` (55,000 ms).
 */
export function applyCoordinatorLease(db: DatabaseSync, input: ApplyCoordinatorLeaseInput): AppliedCoordinatorLease {
  const fencing = readCoordinatorFencingState(db);
  if (!fencing || fencing.coordinatorEpoch !== input.coordinatorEpoch) {
    throw new Error('Cannot apply lease for mismatched coordinator epoch.');
  }
  const leaseIssuedAt = input.reqStartedWallMs;
  const leaseExpiresAt = input.reqStartedWallMs + LEASE_EFFECTIVE_TTL_MS;
  const leaseExpiresMonoNs = input.reqStartedMonoNs + BigInt(LEASE_EFFECTIVE_TTL_MS) * 1_000_000n;
  db.prepare(
    `UPDATE coordinator_state
     SET lease_issued_at = ?, lease_expires_at = ?
     WHERE id = 1 AND coordinator_epoch = ? AND replication_mode = 'active'`,
  ).run(leaseIssuedAt, leaseExpiresAt, input.coordinatorEpoch);
  return { leaseIssuedAt, leaseExpiresAt, leaseExpiresMonoNs };
}

/**
 * Self-fences an active coordinator on partition or renewal failure so no coordinator effects can run.
 */
export function selfFenceCoordinator(db: DatabaseSync): void {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coordinator_state'").get();
  if (!hasTable) return;
  db.prepare(
    `UPDATE coordinator_state
     SET replication_mode = 'fenced', lease_expires_at = 0
     WHERE id = 1`,
  ).run();
}

/**
 * Explicit owner-confirmed lease re-arm (`nerv kaji lease-rearm --confirm-sole-coordinator`)
 * permitted only when no enrolled standby base exists.
 */
export function rearmSoleCoordinatorLease(
  db: DatabaseSync,
  input: {
    readonly coordinatorEpoch: number;
    readonly hasEnrolledStandby: boolean;
    readonly confirmSoleCoordinator: boolean;
    readonly nowMs?: number;
    readonly nowMonoNs?: bigint;
  },
): AppliedCoordinatorLease {
  if (input.hasEnrolledStandby) {
    throw new Error('Cannot re-arm sole coordinator lease while an enrolled standby base exists.');
  }
  if (!input.confirmSoleCoordinator) {
    throw new Error('Pass --confirm-sole-coordinator to re-arm a sole coordinator after wake.');
  }
  const nowMs = input.nowMs ?? Date.now();
  const nowMonoNs = input.nowMonoNs ?? process.hrtime.bigint();
  const fencing = readCoordinatorFencingState(db);
  if (!fencing || fencing.coordinatorEpoch !== input.coordinatorEpoch) {
    throw new Error('Cannot re-arm lease for mismatched coordinator epoch.');
  }
  db.prepare(
    `UPDATE coordinator_state
     SET replication_mode = 'active'
     WHERE id = 1 AND coordinator_epoch = ?`,
  ).run(input.coordinatorEpoch);
  return applyCoordinatorLease(db, {
    coordinatorEpoch: input.coordinatorEpoch,
    reqStartedWallMs: nowMs,
    reqStartedMonoNs: nowMonoNs,
  });
}

export type LeaseKeeperOutcome = 'renewed' | 'self-renewed' | 'waiting' | 'fenced' | 'inactive';

/** Base-local: the last lease sequence this coordinator sent, so a restart never reuses one (F-016-T16 review). */
const LEASE_SEQ_SCHEMA = `
CREATE TABLE IF NOT EXISTS coordinator_lease_seq (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  seq INTEGER NOT NULL
);`;

/** The next lease sequence of this coordinator, persisted before it is sent so a restart never reuses one. */
export function nextLeaseSeq(db: DatabaseSync): number {
  db.exec(LEASE_SEQ_SCHEMA);
  const row = db.prepare('SELECT seq FROM coordinator_lease_seq WHERE id = 1').get() as { seq: number } | undefined;
  const seq = (row?.seq ?? 0) + 1;
  db.prepare(
    'INSERT INTO coordinator_lease_seq(id, seq) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET seq = excluded.seq',
  ).run(seq);
  return seq;
}

export interface CoordinatorLeaseKeeperOptions {
  /** The coordinator's own store (`nerv.sqlite`). */
  readonly db: DatabaseSync;
  /** Signed `POST /kaji/lease/renew` to the named standby (`KajiLink.renewLease`). */
  readonly renew: (standbyBaseId: string, request: LeaseRenewRequest) => Promise<LeaseRenewResult>;
  /** Another enrolled, unrevoked base exists: a sole-coordinator self-renewal is then never allowed. */
  readonly hasOtherEnrolledBases: () => boolean;
  /**
   * This base and the newest owner-signed main record it holds. With both, a main this keeper fenced re-arms
   * when its standby acks again at the same epoch and the record still names it; without them it never re-arms.
   */
  readonly selfBaseId?: string;
  readonly registryMain?: () => { readonly baseId: string | undefined; readonly epoch: number };
  readonly wallNow?: () => number;
  readonly monoNow?: () => bigint;
  readonly onFenced?: (detail: string) => void;
}

/**
 * The active coordinator's lease loop (F-016-T16, decision §2). Every `LEASE_RENEW_MS` it asks the standby
 * named in `coordinator_state.standby_base_id` to ack the lease and commits `reqStarted + 55 s` on an ack.
 * - Before any renewal is awaited, a lease past on the wall clock or on the monotonic clock fences the base;
 *   after a restart the monotonic deadline is derived from the remaining lease at first sight.
 * - A standby that is promoting, or that holds a newer epoch (signed evidence), fences it at once.
 * - A fenced main re-arms when its standby acks again at the same epoch and the registry still names it
 *   (a drained main never: draining needs a newer main record first).
 * - A sole coordinator (no other enrolled base) extends its own lease only while it is live; after a sleep
 *   past it the owner re-arms (`nerv kaji lease-rearm --confirm-sole-coordinator`).
 */
export class CoordinatorLeaseKeeper {
  private readonly options: CoordinatorLeaseKeeperOptions;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  /** Monotonic deadline of the lease, from this process's last commit or its first sight of the lease. */
  leaseExpiresMonoNs: bigint | undefined;

  constructor(options: CoordinatorLeaseKeeperOptions) {
    this.options = options;
  }

  private wall(): number {
    return this.options.wallNow?.() ?? Date.now();
  }
  private mono(): bigint {
    return this.options.monoNow?.() ?? process.hrtime.bigint();
  }

  private fence(detail: string): 'fenced' {
    selfFenceCoordinator(this.options.db);
    this.leaseExpiresMonoNs = undefined;
    this.options.onFenced?.(detail);
    return 'fenced';
  }

  private commit(epoch: number, wallMs: number, monoNs: bigint): void {
    this.leaseExpiresMonoNs = applyCoordinatorLease(this.options.db, {
      coordinatorEpoch: epoch,
      reqStartedWallMs: wallMs,
      reqStartedMonoNs: monoNs,
    }).leaseExpiresMonoNs;
  }

  /** Lease live on both clocks; an unarmed lease (0) is not live. */
  private live(leaseExpiresAt: number): boolean {
    if (!(leaseExpiresAt > 0) || this.wall() >= leaseExpiresAt) return false;
    return this.leaseExpiresMonoNs === undefined || this.mono() < this.leaseExpiresMonoNs;
  }

  private passedDetail(db: DatabaseSync): string {
    const standby = (
      db.prepare('SELECT standby_base_id FROM coordinator_state WHERE id = 1').get() as
        { standby_base_id: string | null } | undefined
    )?.standby_base_id;
    return `The coordinator lease passed without a renewal (standby ${standby ?? 'none named'}; last error: ${this.lastError || 'none'}).`;
  }

  /** The registry still names this base at `epoch`: no newer main record was seen. */
  private namedAt(epoch: number): boolean {
    const main = this.options.registryMain?.();
    return !!main && !!this.options.selfBaseId && main.baseId === this.options.selfBaseId && main.epoch === epoch;
  }

  private lastError = '';

  async renewOnce(): Promise<LeaseKeeperOutcome> {
    const { db } = this.options;
    const state = readCoordinatorFencingState(db);
    if (!state) return 'inactive';
    const active = state.replicationMode === 'active';
    if (!active && !(state.replicationMode === 'fenced' && this.namedAt(state.coordinatorEpoch))) return 'inactive';
    const reqWall = this.wall();
    const reqMono = this.mono();
    if (active && state.leaseExpiresAt > 0) {
      if (this.leaseExpiresMonoNs === undefined) {
        const remaining = Math.min(Math.max(state.leaseExpiresAt - reqWall, 0), LEASE_EFFECTIVE_TTL_MS);
        this.leaseExpiresMonoNs = reqMono + BigInt(remaining) * 1_000_000n;
      }
      if (!this.live(state.leaseExpiresAt)) return this.fence(this.passedDetail(db));
    }
    const standby = (
      db.prepare('SELECT standby_base_id FROM coordinator_state WHERE id = 1').get() as
        { standby_base_id: string | null } | undefined
    )?.standby_base_id;
    if (standby) {
      let result: LeaseRenewResult | undefined;
      const leaseSeq = nextLeaseSeq(db);
      try {
        result = await this.options.renew(standby, { coordinatorEpoch: state.coordinatorEpoch, leaseSeq });
        this.lastError = result.ok ? '' : `${result.reason}: ${result.error}`;
      } catch (err) {
        result = undefined;
        this.lastError = err instanceof Error ? err.message : 'renewal failed';
      }
      const now = readCoordinatorFencingState(db);
      if (!now || now.replicationMode !== state.replicationMode || now.coordinatorEpoch !== state.coordinatorEpoch)
        return 'inactive';
      // The ack must answer this request: a held-back ack for an earlier sequence never extends the lease.
      if (
        result?.ok &&
        result.standbyBaseId === standby &&
        result.coordinatorEpoch === state.coordinatorEpoch &&
        result.ackSeq === leaseSeq
      ) {
        if (!active) {
          if (!this.namedAt(state.coordinatorEpoch)) return 'inactive';
          db.prepare(
            "UPDATE coordinator_state SET replication_mode = 'active' WHERE id = 1 AND replication_mode = 'fenced' AND coordinator_epoch = ?",
          ).run(state.coordinatorEpoch);
        }
        this.commit(state.coordinatorEpoch, reqWall, reqMono);
        return 'renewed';
      }
      const newer =
        !!result &&
        !result.ok &&
        (result.reason === 'promoting' ||
          (result.reason === 'stale_coordinator_epoch' &&
            (result.maxSeenCoordinatorEpoch ?? 0) > state.coordinatorEpoch));
      if (newer && active)
        return this.fence(`Standby ${standby} holds a newer epoch or is promoting (${this.lastError}).`);
    } else if (active && !this.options.hasOtherEnrolledBases() && this.live(state.leaseExpiresAt)) {
      this.commit(state.coordinatorEpoch, reqWall, reqMono);
      return 'self-renewed';
    }
    if (!active) return 'inactive';
    const after = readCoordinatorFencingState(db);
    if (!after || after.replicationMode !== 'active') return 'inactive';
    if (after.leaseExpiresAt > 0 && !this.live(after.leaseExpiresAt)) return this.fence(this.passedDetail(db));
    return 'waiting';
  }

  start(intervalMs = LEASE_RENEW_MS): void {
    if (this.timer) return;
    const tick = () => {
      if (this.running) return;
      this.running = true;
      void this.renewOnce()
        .catch(() => undefined)
        .finally(() => {
          this.running = false;
        });
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
