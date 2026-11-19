import type { DatabaseSync } from 'node:sqlite';
import { readCoordinatorFencingState } from './coordinator-authority.ts';

export const LEASE_TTL_MS = 60_000;
const LEASE_SAFETY_MARGIN_MS = 5_000;
export const LEASE_EFFECTIVE_TTL_MS = LEASE_TTL_MS - LEASE_SAFETY_MARGIN_MS;

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
      readonly reason: 'stale_coordinator_epoch' | 'stale_lease_seq' | 'promoting';
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
     WHERE id = 1 AND coordinator_epoch = ?`,
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
