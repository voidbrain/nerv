import type { DatabaseSync } from 'node:sqlite';
import { argsHash } from './ledger.ts';
import { transaction } from './sqlite-transaction.ts';

export type HandoffSelectionReason = 'capability' | 'load' | 'locality';
export type HandoffState = 'accepted' | 'uncertain' | 'completed' | 'failed' | 'not-started';
export type UncertainCause = 'lost-reply' | 'restart' | 'sleeping-base';

export interface WholeJobDispatchInput {
  jobId: string;
  targetBase: string;
  selectionReason: HandoffSelectionReason;
  args: Record<string, unknown>;
  mainScrollFloorDigest: string;
  targetScrollFloorDigest: string;
  containsLocalOnlyOrTainted?: boolean;
  loadForwardingAccepted?: boolean;
  resourceLock?: string;
  now?: string;
}

export interface WholeJobReceipt {
  base: string;
  status: 'not-started' | 'running' | 'completed' | 'failed';
  receiptDigest: string;
  result?: unknown;
  now?: string;
}

export interface WholeJobHandoffRecord {
  jobId: string;
  targetBase: string;
  selectionReason: HandoffSelectionReason;
  argsDigest: string;
  scrollFloorDigest: string;
  state: HandoffState;
  receipt: WholeJobReceipt | null;
  resourceLock: string | null;
  attempts: number;
  updatedAt: string;
}

export interface WholeJobDispatchResult {
  allowed: boolean;
  record: WholeJobHandoffRecord;
  reason: string;
}

interface HandoffRow {
  job_id: string;
  target_base: string;
  selection_reason: HandoffSelectionReason;
  args_digest: string;
  scroll_floor_digest: string;
  state: HandoffState;
  receipt_json: string | null;
  resource_lock: string | null;
  attempts: number;
  updated_at: string;
}

function toRecord(row: HandoffRow): WholeJobHandoffRecord {
  return {
    jobId: row.job_id,
    targetBase: row.target_base,
    selectionReason: row.selection_reason,
    argsDigest: row.args_digest,
    scrollFloorDigest: row.scroll_floor_digest,
    state: row.state,
    receipt: row.receipt_json ? (JSON.parse(row.receipt_json) as WholeJobReceipt) : null,
    resourceLock: row.resource_lock,
    attempts: row.attempts,
    updatedAt: row.updated_at,
  };
}

/**
 * Receipt-bound durable store for whole-job handoffs (F-050-T02).
 * Silence (lost reply, restart, sleeping base) marks a job `uncertain` and holds its lock;
 * retry or reassignment is refused until the receiving base reconciles a `not-started` receipt.
 */
export class WholeJobHandoffStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS whole_job_handoffs (
      job_id TEXT PRIMARY KEY,
      target_base TEXT NOT NULL,
      selection_reason TEXT NOT NULL,
      args_digest TEXT NOT NULL,
      scroll_floor_digest TEXT NOT NULL,
      state TEXT NOT NULL,
      receipt_json TEXT,
      resource_lock TEXT,
      attempts INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );`);
  }

  private tx<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  get(jobId: string): WholeJobHandoffRecord | null {
    const row = this.db.prepare('SELECT * FROM whole_job_handoffs WHERE job_id = ?').get(jobId) as
      HandoffRow | undefined;
    return row ? toRecord(row) : null;
  }

  isResourceLocked(resourceLock: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM whole_job_handoffs WHERE resource_lock = ? AND state IN ('accepted', 'uncertain')")
      .get(resourceLock);
    return !!row;
  }

  dispatch(input: WholeJobDispatchInput): WholeJobDispatchResult {
    if (!input.jobId.trim() || !input.targetBase.trim()) {
      throw new Error('jobId and targetBase are required.');
    }
    if (input.containsLocalOnlyOrTainted) {
      throw new Error('Cannot forward a job containing local-only or tainted data.');
    }
    if (input.targetScrollFloorDigest !== input.mainScrollFloorDigest) {
      throw new Error('Receiving base Scrolls cannot be looser than the main base.');
    }
    if (input.selectionReason === 'load' && input.loadForwardingAccepted !== true) {
      throw new Error('Load-based forwarding requires F-048 acceptance.');
    }

    const digest = argsHash(input.args);
    const now = input.now ?? new Date().toISOString();
    const lock = input.resourceLock ?? null;

    return this.tx(() => {
      const existing = this.db.prepare('SELECT * FROM whole_job_handoffs WHERE job_id = ?').get(input.jobId) as
        HandoffRow | undefined;

      if (existing) {
        if (existing.state !== 'not-started') {
          return {
            allowed: false,
            record: toRecord(existing),
            reason: `Job ${input.jobId} is ${existing.state} on ${existing.target_base}; reconcile durable receipt before retry or reassignment.`,
          };
        }
        if (lock && this.isResourceLocked(lock)) {
          throw new Error(`Resource lock ${lock} is currently held by another uncertain or active handoff.`);
        }
        this.db
          .prepare(
            `UPDATE whole_job_handoffs
             SET target_base = ?, selection_reason = ?, args_digest = ?, scroll_floor_digest = ?,
                 state = 'accepted', receipt_json = NULL, resource_lock = ?, attempts = attempts + 1, updated_at = ?
             WHERE job_id = ?`,
          )
          .run(input.targetBase, input.selectionReason, digest, input.mainScrollFloorDigest, lock, now, input.jobId);
        const updated = this.get(input.jobId)!;
        return {
          allowed: true,
          record: updated,
          reason: `Re-dispatched ${input.jobId} after reconciled not-started receipt.`,
        };
      }

      if (lock && this.isResourceLocked(lock)) {
        throw new Error(`Resource lock ${lock} is currently held by another uncertain or active handoff.`);
      }

      this.db
        .prepare(
          `INSERT INTO whole_job_handoffs
           (job_id, target_base, selection_reason, args_digest, scroll_floor_digest, state, receipt_json, resource_lock, attempts, updated_at)
           VALUES (?, ?, ?, ?, ?, 'accepted', NULL, ?, 1, ?)`,
        )
        .run(input.jobId, input.targetBase, input.selectionReason, digest, input.mainScrollFloorDigest, lock, now);

      return {
        allowed: true,
        record: this.get(input.jobId)!,
        reason: `Dispatched ${input.jobId} to ${input.targetBase} (${input.selectionReason}).`,
      };
    });
  }

  markUncertain(jobId: string, cause: UncertainCause, now = new Date().toISOString()): WholeJobHandoffRecord {
    return this.tx(() => {
      const existing = this.db.prepare('SELECT * FROM whole_job_handoffs WHERE job_id = ?').get(jobId) as
        HandoffRow | undefined;
      if (!existing) {
        throw new Error(`Unknown whole-job handoff: ${jobId}`);
      }
      if (existing.state === 'completed' || existing.state === 'failed') {
        return toRecord(existing);
      }
      this.db
        .prepare("UPDATE whole_job_handoffs SET state = 'uncertain', updated_at = ? WHERE job_id = ?")
        .run(now, jobId);
      const updated = this.get(jobId)!;
      if (!updated) throw new Error(`Failed to mark ${jobId} uncertain (${cause}).`);
      return updated;
    });
  }

  reconcileReceipt(jobId: string, receipt: WholeJobReceipt): WholeJobHandoffRecord {
    if (!receipt.receiptDigest.trim()) {
      throw new Error('Receipt digest is required for reconciliation.');
    }
    const now = receipt.now ?? new Date().toISOString();

    return this.tx(() => {
      const existing = this.db.prepare('SELECT * FROM whole_job_handoffs WHERE job_id = ?').get(jobId) as
        HandoffRow | undefined;
      if (!existing) {
        throw new Error(`Unknown whole-job handoff: ${jobId}`);
      }
      if (receipt.base !== existing.target_base) {
        throw new Error(`Receipt from ${receipt.base} cannot reconcile handoff assigned to ${existing.target_base}.`);
      }
      if (existing.state === 'completed' || existing.state === 'failed') {
        return toRecord(existing);
      }

      const nextState: HandoffState =
        receipt.status === 'running' ? 'uncertain' : receipt.status === 'not-started' ? 'not-started' : receipt.status;
      const nextLock = nextState === 'uncertain' ? existing.resource_lock : null;

      this.db
        .prepare(
          'UPDATE whole_job_handoffs SET state = ?, receipt_json = ?, resource_lock = ?, updated_at = ? WHERE job_id = ?',
        )
        .run(nextState, JSON.stringify(receipt), nextLock, now, jobId);

      return this.get(jobId)!;
    });
  }
}
