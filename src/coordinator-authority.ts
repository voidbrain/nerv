import type { DatabaseSync } from 'node:sqlite';

export type CoordinatorAuthorityReason =
  'coordinator_not_active' | 'stale_coordinator_epoch' | 'stale_coordinator_lease';

/** `LEASE_TTL_MS` (coordinator-lease.ts, which imports this module). */
const MAX_LEASE_AHEAD_MS = 60_000;

export class CoordinatorAuthorityError extends Error {
  readonly reason: CoordinatorAuthorityReason;

  constructor(reason: CoordinatorAuthorityReason, message: string) {
    super(message);
    this.name = 'CoordinatorAuthorityError';
    this.reason = reason;
  }
}

export interface CoordinatorFencingState {
  readonly coordinatorEpoch: number;
  readonly coordinatorFence: number;
  readonly replicationMode: 'active' | 'standby' | 'draining' | 'fenced';
  readonly leaseExpiresAt: number;
  readonly stateDigest: string | null;
}

export interface ActiveCoordinatorCheckInput {
  readonly db: DatabaseSync;
  readonly baseId?: string;
  readonly mainBaseId?: string;
  readonly maxSeenCoordinatorEpoch?: number;
  readonly nowMs?: number;
  readonly leaseExpiresMonoNs?: bigint;
  readonly currentMonoNs?: bigint;
}

export type ActiveCoordinatorCheckResult =
  | { readonly ok: true; readonly state?: CoordinatorFencingState }
  | { readonly ok: false; readonly reason: CoordinatorAuthorityReason; readonly detail: string };

/** Reads `coordinator_state` row id=1 if the table is initialized and populated. */
export function readCoordinatorFencingState(db: DatabaseSync): CoordinatorFencingState | undefined {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'coordinator_state'").get();
  if (!hasTable) return undefined;
  const row = db
    .prepare(
      `SELECT coordinator_epoch, coordinator_fence, replication_mode, lease_expires_at, state_digest
       FROM coordinator_state WHERE id = 1`,
    )
    .get() as
    | {
        coordinator_epoch: number;
        coordinator_fence: number;
        replication_mode: 'active' | 'standby' | 'draining' | 'fenced';
        lease_expires_at: number;
        state_digest: string | null;
      }
    | undefined;
  if (!row) return undefined;
  return {
    coordinatorEpoch: row.coordinator_epoch,
    coordinatorFence: row.coordinator_fence,
    replicationMode: row.replication_mode,
    leaseExpiresAt: row.lease_expires_at,
    stateDigest: row.state_digest,
  };
}

/**
 * Synchronous effect-boundary authority check (F-016-T05):
 * verifies active replication_mode, main base identity, coordinatorEpoch >= maxSeenCoordinatorEpoch,
 * and non-expired wall/monotonic lease when armed.
 */
export function isActiveCoordinator(input: ActiveCoordinatorCheckInput): ActiveCoordinatorCheckResult {
  const state = readCoordinatorFencingState(input.db);
  if (!state) {
    if (input.baseId && input.mainBaseId && input.baseId !== input.mainBaseId) {
      return {
        ok: false,
        reason: 'coordinator_not_active',
        detail: `Base ${input.baseId} is not the active main base (${input.mainBaseId}).`,
      };
    }
    return { ok: true };
  }

  if (state.replicationMode !== 'active') {
    return {
      ok: false,
      reason: 'coordinator_not_active',
      detail: `Coordinator is in ${state.replicationMode} mode.`,
    };
  }
  if (input.baseId && input.mainBaseId && input.baseId !== input.mainBaseId) {
    return {
      ok: false,
      reason: 'coordinator_not_active',
      detail: `Base ${input.baseId} is not the active main base (${input.mainBaseId}).`,
    };
  }
  if (input.maxSeenCoordinatorEpoch !== undefined && state.coordinatorEpoch < input.maxSeenCoordinatorEpoch) {
    return {
      ok: false,
      reason: 'stale_coordinator_epoch',
      detail: `Coordinator epoch ${state.coordinatorEpoch} trails maxSeenCoordinatorEpoch ${input.maxSeenCoordinatorEpoch}.`,
    };
  }
  const nowMs = input.nowMs ?? Date.now();
  // F-016-T16: an unarmed lease (0) is authority only for the first coordinator (epoch 0 or 1). A promoted
  // coordinator (epoch 2 or later) acts only under an armed lease: standby-acked, or self-armed when sole.
  if (!(state.leaseExpiresAt > 0) && state.coordinatorEpoch >= 2) {
    return {
      ok: false,
      reason: 'stale_coordinator_lease',
      detail: `Coordinator epoch ${state.coordinatorEpoch} holds no armed lease yet.`,
    };
  }
  // F-016-T16 review: no honest lease ends more than its TTL ahead; more means the wall clock went back.
  if (state.leaseExpiresAt - nowMs > MAX_LEASE_AHEAD_MS) {
    return {
      ok: false,
      reason: 'stale_coordinator_lease',
      detail: `Coordinator lease ends more than ${MAX_LEASE_AHEAD_MS} ms ahead: the wall clock moved back.`,
    };
  }
  if (state.leaseExpiresAt > 0 && nowMs >= state.leaseExpiresAt) {
    return {
      ok: false,
      reason: 'stale_coordinator_lease',
      detail: `Coordinator lease expired at ${state.leaseExpiresAt}.`,
    };
  }
  if (
    input.leaseExpiresMonoNs !== undefined &&
    input.currentMonoNs !== undefined &&
    input.currentMonoNs >= input.leaseExpiresMonoNs
  ) {
    return {
      ok: false,
      reason: 'stale_coordinator_lease',
      detail: 'Coordinator monotonic lease expired.',
    };
  }
  return { ok: true, state };
}

/** Throws `CoordinatorAuthorityError` when the current host lacks active coordinator authority. */
export function assertActiveCoordinator(input: ActiveCoordinatorCheckInput): CoordinatorFencingState | undefined {
  const res = isActiveCoordinator(input);
  if (!res.ok) throw new CoordinatorAuthorityError(res.reason, res.detail);
  return res.state;
}

/**
 * Increments and returns `coordinator_state.coordinator_fence` after verifying active coordinator
 * authority and matching `expectedEpoch` (when `coordinator_state` is present).
 */
export function advanceCoordinatorFence(
  db: DatabaseSync,
  expectedEpoch?: number,
  nowMs = Date.now(),
): number | undefined {
  const state = assertActiveCoordinator({ db, nowMs });
  if (!state) return undefined;
  if (expectedEpoch !== undefined && state.coordinatorEpoch !== expectedEpoch) {
    throw new CoordinatorAuthorityError(
      'stale_coordinator_epoch',
      `Coordinator epoch ${state.coordinatorEpoch} does not match expected epoch ${expectedEpoch}.`,
    );
  }
  db.prepare('UPDATE coordinator_state SET coordinator_fence = coordinator_fence + 1 WHERE id = 1').run();
  const next = db.prepare('SELECT coordinator_fence FROM coordinator_state WHERE id = 1').get() as {
    coordinator_fence: number;
  };
  return next.coordinator_fence;
}
