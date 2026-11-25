import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type ResumeTargetKind = 'web-chat' | 'vscode-claude' | 'cli-job' | 'worker-job';
export type ResumeIntentStatus = 'pending' | 'leased' | 'resumed' | 'cancelled' | 'expired' | 'failed';

export interface ResumePermissionScope {
  readonly allowedAction: 'resume-named-job';
  readonly targetId: string;
  readonly allowSecurityPrompts: false;
  readonly allowLimitBypass: false;
  readonly modelOverrideBlocked: true;
  readonly grantedBy: 'owner' | 'policy';
}

export interface ResumeIntent {
  readonly id: string;
  readonly targetKind: ResumeTargetKind;
  readonly targetId: string;
  readonly targetWorker: string | null;
  readonly targetFingerprint: string;
  readonly permissionScope: ResumePermissionScope;
  readonly resetAt: number;
  readonly expiresAt: number;
  readonly maxAttempts: number;
  readonly attempts: number;
  readonly backoffMs: number;
  readonly nextAttemptAt: number;
  readonly status: ResumeIntentStatus;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: number | null;
  readonly cancelReason: string | null;
  readonly cancelledAt: number | null;
  readonly lastError: string | null;
  readonly outcome: Record<string, unknown> | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateResumeIntentInput {
  readonly id?: string;
  readonly targetKind: ResumeTargetKind;
  readonly targetId: string;
  readonly targetWorker?: string | null;
  readonly targetFingerprint: string;
  readonly permissionScope: ResumePermissionScope;
  readonly resetAt: number;
  readonly expiresAt: number;
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly now?: number;
}

export type ResumeAttemptOutcome =
  | { readonly kind: 'resumed'; readonly detail?: Record<string, unknown> }
  | { readonly kind: 'deferred'; readonly reason: string; readonly nextResetAt?: number }
  | { readonly kind: 'failed'; readonly reason: string; readonly retryable?: boolean };

export const RESUME_INTENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS resume_intents (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_worker TEXT,
  target_fingerprint TEXT NOT NULL,
  permission_scope TEXT NOT NULL,
  reset_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  backoff_ms INTEGER NOT NULL DEFAULT 60000,
  next_attempt_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  cancel_reason TEXT,
  cancelled_at INTEGER,
  last_error TEXT,
  outcome_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resume_intents_status_next
  ON resume_intents(status, next_attempt_at);
`;

const MAX_BOUNDED_ATTEMPTS = 20;

interface ResumeIntentRow {
  id: string;
  target_kind: ResumeTargetKind;
  target_id: string;
  target_worker: string | null;
  target_fingerprint: string;
  permission_scope: string;
  reset_at: number;
  expires_at: number;
  max_attempts: number;
  attempts: number;
  backoff_ms: number;
  next_attempt_at: number;
  status: ResumeIntentStatus;
  lease_owner: string | null;
  lease_expires_at: number | null;
  cancel_reason: string | null;
  cancelled_at: number | null;
  last_error: string | null;
  outcome_json: string | null;
  created_at: number;
  updated_at: number;
}

function validatePermissionScope(scope: ResumePermissionScope, targetId: string): void {
  if (scope.allowedAction !== 'resume-named-job') {
    throw new Error('Resume permission scope must only allow resume-named-job.');
  }
  if (scope.targetId !== targetId) {
    throw new Error('Resume permission scope targetId must match the intent targetId.');
  }
  if (scope.allowSecurityPrompts !== false) {
    throw new Error('Resume permission scope cannot allow accepting unrelated security prompts.');
  }
  if (scope.allowLimitBypass !== false) {
    throw new Error('Resume permission scope cannot allow bypassing provider limits.');
  }
  if (scope.modelOverrideBlocked !== true) {
    throw new Error('Resume permission scope must block model-originated policy overrides.');
  }
  if (scope.grantedBy !== 'owner' && scope.grantedBy !== 'policy') {
    throw new Error('Resume permission scope must be granted by owner or policy, never by a model.');
  }
}

function mapRow(row: ResumeIntentRow): ResumeIntent {
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    targetWorker: row.target_worker,
    targetFingerprint: row.target_fingerprint,
    permissionScope: JSON.parse(row.permission_scope) as ResumePermissionScope,
    resetAt: row.reset_at,
    expiresAt: row.expires_at,
    maxAttempts: row.max_attempts,
    attempts: row.attempts,
    backoffMs: row.backoff_ms,
    nextAttemptAt: row.next_attempt_at,
    status: row.status,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at,
    lastError: row.last_error,
    outcome: row.outcome_json ? (JSON.parse(row.outcome_json) as Record<string, unknown>) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ResumeIntentStore {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: CreateResumeIntentInput): ResumeIntent {
    const targetId = input.targetId.trim();
    const targetFingerprint = input.targetFingerprint.trim();
    if (!targetId) throw new Error('targetId is required');
    if (!targetFingerprint) throw new Error('targetFingerprint is required');
    if (!Number.isFinite(input.resetAt) || !Number.isFinite(input.expiresAt)) {
      throw new Error('resetAt and expiresAt must be finite epoch milliseconds');
    }
    if (input.expiresAt <= input.resetAt) {
      throw new Error('expiresAt must be later than resetAt');
    }
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_BOUNDED_ATTEMPTS) {
      throw new Error(`maxAttempts must be an integer between 1 and ${MAX_BOUNDED_ATTEMPTS}`);
    }
    const backoffMs = input.backoffMs ?? 60_000;
    if (!Number.isInteger(backoffMs) || backoffMs < 0) {
      throw new Error('backoffMs must be a non-negative integer');
    }
    validatePermissionScope(input.permissionScope, targetId);

    const now = input.now ?? Date.now();
    const id = input.id?.trim() || `ri_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO resume_intents (
          id, target_kind, target_id, target_worker, target_fingerprint, permission_scope,
          reset_at, expires_at, max_attempts, attempts, backoff_ms, next_attempt_at,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        id,
        input.targetKind,
        targetId,
        input.targetWorker ?? null,
        targetFingerprint,
        JSON.stringify(input.permissionScope),
        input.resetAt,
        input.expiresAt,
        maxAttempts,
        backoffMs,
        input.resetAt,
        now,
        now,
      );
    return this.get(id)!;
  }

  get(id: string): ResumeIntent | null {
    const row = this.db.prepare('SELECT * FROM resume_intents WHERE id = ?').get(id) as ResumeIntentRow | undefined;
    return row ? mapRow(row) : null;
  }

  list(status?: ResumeIntentStatus): ResumeIntent[] {
    const rows = (status
      ? this.db
          .prepare('SELECT * FROM resume_intents WHERE status = ? ORDER BY next_attempt_at ASC, created_at ASC')
          .all(status)
      : this.db
          .prepare('SELECT * FROM resume_intents ORDER BY next_attempt_at ASC, created_at ASC')
          .all()) as unknown as ResumeIntentRow[];
    return rows.map(mapRow);
  }

  due(now = Date.now()): ResumeIntent[] {
    this.expireStale(now);
    const rows = this.db
      .prepare(
        `SELECT * FROM resume_intents
         WHERE status = 'pending'
           AND next_attempt_at <= ?
           AND expires_at > ?
           AND attempts < max_attempts
         ORDER BY next_attempt_at ASC, created_at ASC`,
      )
      .all(now, now) as unknown as ResumeIntentRow[];
    return rows.map(mapRow);
  }

  claimLease(id: string, owner: string, leaseMs: number, now = Date.now()): ResumeIntent | null {
    if (!owner.trim()) throw new Error('lease owner is required');
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) throw new Error('leaseMs must be a positive integer');
    this.expireStale(now);
    const res = this.db
      .prepare(
        `UPDATE resume_intents
         SET status = 'leased',
             attempts = attempts + 1,
             lease_owner = ?,
             lease_expires_at = ?,
             updated_at = ?
         WHERE id = ?
           AND expires_at > ?
           AND attempts < max_attempts
           AND (
             (status = 'pending' AND next_attempt_at <= ?)
             OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
           )`,
      )
      .run(owner, now + leaseMs, now, id, now, now, now);
    if (res.changes === 0) return null;
    return this.get(id);
  }

  recordAttemptOutcome(id: string, outcome: ResumeAttemptOutcome, now = Date.now()): ResumeIntent {
    const current = this.get(id);
    if (!current) throw new Error(`Resume intent ${id} not found`);
    if (current.status === 'cancelled' || current.status === 'resumed') {
      return current;
    }

    if (outcome.kind === 'resumed') {
      this.db
        .prepare(
          `UPDATE resume_intents
           SET status = 'resumed',
               lease_owner = NULL,
               lease_expires_at = NULL,
               last_error = NULL,
               outcome_json = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(JSON.stringify(outcome.detail ?? { resumedAt: now }), now, id);
      return this.get(id)!;
    }

    if (outcome.kind === 'deferred') {
      const nextAttemptAt = Math.max(now + current.backoffMs, outcome.nextResetAt ?? now + current.backoffMs);
      const exhausted = current.attempts >= current.maxAttempts || nextAttemptAt >= current.expiresAt;
      this.db
        .prepare(
          `UPDATE resume_intents
           SET status = ?,
               next_attempt_at = ?,
               lease_owner = NULL,
               lease_expires_at = NULL,
               last_error = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(exhausted ? 'expired' : 'pending', nextAttemptAt, outcome.reason, now, id);
      return this.get(id)!;
    }

    const nextAttemptAt = now + current.backoffMs;
    const canRetry =
      Boolean(outcome.retryable) && current.attempts < current.maxAttempts && nextAttemptAt < current.expiresAt;
    this.db
      .prepare(
        `UPDATE resume_intents
         SET status = ?,
             next_attempt_at = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(canRetry ? 'pending' : 'failed', nextAttemptAt, outcome.reason, now, id);
    return this.get(id)!;
  }

  expireStale(now = Date.now()): number {
    const res = this.db
      .prepare(
        `UPDATE resume_intents
         SET status = 'expired',
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE status IN ('pending', 'leased')
           AND expires_at <= ?`,
      )
      .run(now, now);
    return Number(res.changes);
  }

  cancel(id: string, reason = 'cancelled by owner', now = Date.now()): ResumeIntent {
    const current = this.get(id);
    if (!current) throw new Error(`Resume intent ${id} not found`);
    if (current.status === 'resumed') {
      throw new Error(`Resume intent ${id} was already resumed and cannot be cancelled`);
    }
    if (current.status === 'cancelled') return current;
    this.db
      .prepare(
        `UPDATE resume_intents
         SET status = 'cancelled',
             cancel_reason = ?,
             cancelled_at = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(reason, now, now, id);
    return this.get(id)!;
  }
}

export interface ResumeAvailabilityCheck {
  readonly available: boolean;
  readonly reason?: string;
  readonly nextResetAt?: number;
}

export interface ResumeJobIdentity {
  readonly targetId: string;
  readonly targetFingerprint: string;
  readonly stillActive?: boolean;
}

export interface ResumeEngineDeps {
  readonly owner: string;
  /** Intents this adapter handles; others are left untouched for their own adapter (F-090-T04). Default: all. */
  readonly accepts?: (intent: ResumeIntent) => boolean;
  readonly leaseMs?: number;
  readonly now?: number;
  readonly checkAvailability: (intent: ResumeIntent) => Promise<ResumeAvailabilityCheck> | ResumeAvailabilityCheck;
  readonly verifyIdentity: (intent: ResumeIntent) => Promise<ResumeJobIdentity | null> | ResumeJobIdentity | null;
  readonly executeResume: (intent: ResumeIntent) => Promise<ResumeAttemptOutcome> | ResumeAttemptOutcome;
  readonly notifyOutcome?: (intent: ResumeIntent, message: string) => Promise<void> | void;
}

export interface ResumeEngineTickResult {
  readonly expired: number;
  readonly processed: ResumeIntent[];
}

/**
 * F-012-T02: Readiness check and once-only resume engine.
 * At the deadline, inspects live availability (never assumed), rechecks job identity and fingerprint,
 * executes at most once under a lease, and notifies the outcome.
 */
export async function runResumeEngineTick(
  store: ResumeIntentStore,
  deps: ResumeEngineDeps,
): Promise<ResumeEngineTickResult> {
  const now = deps.now ?? Date.now();
  const leaseMs = deps.leaseMs ?? 60_000;
  const expired = store.expireStale(now);
  const due = store.due(now);
  const processed: ResumeIntent[] = [];

  for (const intent of due) {
    if (deps.accepts && !deps.accepts(intent)) continue;
    const leased = store.claimLease(intent.id, deps.owner, leaseMs, now);
    if (!leased) continue;

    const availability = await deps.checkAvailability(leased);
    if (!availability.available) {
      const updated = store.recordAttemptOutcome(
        leased.id,
        {
          kind: 'deferred',
          reason: availability.reason ?? 'Quota or capacity unavailable at deadline.',
          nextResetAt: availability.nextResetAt,
        },
        now,
      );
      await deps.notifyOutcome?.(
        updated,
        `Resume ${updated.id} (${updated.targetId}) ${updated.status}: ${updated.lastError ?? 'deferred'}`,
      );
      processed.push(updated);
      continue;
    }

    const identity = await deps.verifyIdentity(leased);
    if (
      !identity ||
      identity.targetId !== leased.targetId ||
      identity.targetFingerprint !== leased.targetFingerprint ||
      identity.stillActive === false
    ) {
      const updated = store.recordAttemptOutcome(
        leased.id,
        {
          kind: 'failed',
          reason: 'Job identity or fingerprint mismatch; refusing to resume wrong target.',
          retryable: false,
        },
        now,
      );
      await deps.notifyOutcome?.(updated, `Resume ${updated.id} (${updated.targetId}) failed: ${updated.lastError}`);
      processed.push(updated);
      continue;
    }

    const outcome = await deps.executeResume(leased);
    const updated = store.recordAttemptOutcome(leased.id, outcome, now);
    const summary =
      updated.status === 'resumed'
        ? `Resumed ${updated.targetKind} ${updated.targetId} (intent ${updated.id}).`
        : `Resume ${updated.id} (${updated.targetId}) ${updated.status}: ${updated.lastError ?? 'no detail'}`;
    await deps.notifyOutcome?.(updated, summary);
    processed.push(updated);
  }

  return { expired, processed };
}
