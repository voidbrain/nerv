import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Decision, Ledger } from './ledger.ts';
import { transaction } from './sqlite-transaction.ts';
import type { Watch } from './watch.ts';
import { WORKER_LEASE_MS, WORKER_RESULT_BYTES, type WorkerJobs } from './worker-jobs.ts';

export interface StoreKajiOutboxHost {
  readonly db: DatabaseSync;
  readonly ledger: Ledger;
  readonly workerJobs: WorkerJobs;
  readonly watch: Watch;
  decideCore(
    id: string,
    decision: Decision,
    source: 'coordinator' | 'cli' | 'worker-cancel' | 'worker-release' | 'worker-fence' | 'worker-upgrade',
    options?: { useSuggestedFix?: boolean },
  ): unknown;
  verifyWatchOutboxAuthority(sortieId: string): boolean;
}

/**
 * Kaji outbox queueing, cancellation, spear revocation, legacy reconciliation, and worker-result recording
 * extracted from Store (F-095-T04).
 */
export class StoreKajiOutbox {
  private readonly host: StoreKajiOutboxHost;

  constructor(host: StoreKajiOutboxHost) {
    this.host = host;
  }

  legacyWorkerResult(raw: string): { state: 'completed' | 'running'; result?: unknown } {
    const result = JSON.parse(raw) as { outcome?: string; approvalId?: string; external?: boolean };
    if (result.outcome !== 'approval') return result.external ? { state: 'running' } : { state: 'completed', result };
    const row = this.host.db
      .prepare('SELECT action_id,decision FROM approvals WHERE id=?')
      .get(result.approvalId ?? '') as { action_id: string; decision: string | null } | undefined;
    if (!row) return { state: 'running' };
    if (!row.decision) this.host.decideCore(result.approvalId!, 'reject', 'worker-upgrade');
    if (row.decision !== 'approve')
      return {
        state: 'completed',
        result: {
          outcome: 'reject',
          reason: 'Pre-protocol remote approval stood down or already declined; request again explicitly if needed.',
        },
      };
    const grant = this.host.db.prepare('SELECT used FROM grants WHERE action_id=?').get(row.action_id) as
      { used: string | null } | undefined;
    if (grant && !grant.used) {
      const action = this.host.db.prepare('SELECT sortie_id FROM actions WHERE id=?').get(row.action_id) as {
        sortie_id: string;
      };
      this.host.ledger.spear(action.sortie_id, 'Worker upgrade revoked the unused pre-protocol grant.');
      return {
        state: 'completed',
        result: { outcome: 'reject', reason: 'The pre-protocol grant was revoked before use; no execution occurred.' },
      };
    }
    const done = this.host.db
      .prepare(
        "SELECT kind,payload FROM events WHERE action_id=? AND kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1",
      )
      .get(row.action_id) as { kind: string; payload: string } | undefined;
    return done
      ? {
          state: 'completed',
          result: { outcome: 'grant', ...(JSON.parse(done.payload) as { result?: unknown; error?: string }) },
        }
      : { state: 'running' };
  }

  queueRemote(
    sortieId: string,
    base: string,
    tool: string,
    args: Record<string, unknown>,
    pilot?: string,
  ): { id: string } {
    const id = randomUUID();
    const title =
      (this.host.db.prepare('SELECT title FROM sorties WHERE id=?').get(sortieId) as { title: string } | undefined)
        ?.title ?? '';
    this.host.db
      .prepare('INSERT INTO kaji_outbox VALUES(?,?,?,?,?,?,?,NULL,NULL)')
      .run(id, sortieId, base, tool, JSON.stringify(args), title.slice(0, 500), new Date().toISOString());
    if (pilot) this.host.db.prepare('INSERT INTO kaji_outbox_pilots VALUES(?,?)').run(id, pilot);
    return { id };
  }

  /** Queued actions not settled yet, oldest first: the coordinator sends them (the same id each time). */
  outbox(): {
    attempted: boolean;
    deadline: number;
    sequence: number;
    id: string;
    sortieId: string;
    base: string;
    tool: string;
    args: Record<string, unknown>;
    request: string;
    pilot?: string;
  }[] {
    return (
      this.host.db
        .prepare(
          `SELECT q.rowid AS sequence,q.id,q.sortie_id,q.base,q.tool,q.args,q.request,q.created,p.pilot,EXISTS(SELECT 1 FROM worker_outbox_attempts a WHERE a.id=q.id) AS attempted FROM kaji_outbox q LEFT JOIN kaji_outbox_pilots p ON p.id=q.id WHERE q.done IS NULL AND NOT EXISTS (SELECT 1 FROM worker_legacy_outbox h WHERE h.id=q.id AND h.state='pending') AND NOT EXISTS (SELECT 1 FROM worker_outbox_cancels c WHERE c.id=q.id) ORDER BY q.created LIMIT 10`,
        )
        .all() as {
        sequence: number;
        id: string;
        sortie_id: string;
        base: string;
        tool: string;
        args: string;
        request: string;
        created: string;
        pilot: string | null;
        attempted: number;
      }[]
    ).map((r) => ({
      attempted: !!r.attempted,
      deadline: Date.parse(r.created) + WORKER_LEASE_MS,
      sequence: r.sequence,
      id: r.id,
      sortieId: r.sortie_id,
      base: r.base,
      tool: r.tool,
      args: JSON.parse(r.args) as Record<string, unknown>,
      request: r.request,
      ...(r.pilot ? { pilot: r.pilot } : {}),
    }));
  }

  cancelWorker(
    owner: string,
    id: string,
    reason: string,
    source: 'coordinator' | 'cli',
  ): { status: string; result?: unknown } {
    return transaction(this.host.db, () => {
      const existingOwner = this.host.workerJobs.owner(id);
      if (existingOwner && existingOwner !== owner) throw new Error('Worker cancellation owner differs.');
      const pending = this.host.workerJobs.waitingApprovals().find((p) => p.lease.id === id && !p.decision);
      if (pending) {
        if (pending.hasApproval) this.host.decideCore(pending.id, 'reject', 'worker-cancel');
        this.host.workerJobs.persistApprovalDecision(pending.id, 'reject');
        this.host.workerJobs.finish(pending.lease, {
          outcome: 'reject',
          reason: 'Owner cancelled the pending worker approval; no execution occurred.',
        });
      }
      return this.host.workerJobs.cancel(owner, id, reason, source);
    });
  }

  cancelWorkerOutbox(id: string, reason: string): void {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500)
      throw new Error('A cancellation reason is required.');
    if (!this.host.db.prepare('SELECT 1 FROM kaji_outbox WHERE id=? AND done IS NULL').get(id))
      throw new Error('No pending remote request with that ID.');
    this.host.db
      .prepare('INSERT OR IGNORE INTO worker_outbox_cancels VALUES(?,?,?)')
      .run(id, reason, new Date().toISOString());
  }

  cancelledWorkerOutbox(): {
    sortieId: string;
    id: string;
    base: string;
    tool: string;
    reason: string;
    attempted: boolean;
    legacy: boolean;
  }[] {
    return (
      this.host.db
        .prepare(
          "SELECT q.sortie_id AS sortieId,q.id,q.base,q.tool,c.reason,EXISTS(SELECT 1 FROM worker_outbox_attempts a WHERE a.id=q.id) AS attempted,EXISTS(SELECT 1 FROM worker_legacy_outbox h WHERE h.id=q.id AND h.state='pending') AS legacy FROM kaji_outbox q JOIN worker_outbox_cancels c ON c.id=q.id WHERE q.done IS NULL ORDER BY q.rowid LIMIT 4",
        )
        .all() as {
        sortieId: string;
        id: string;
        base: string;
        tool: string;
        reason: string;
        attempted: number;
        legacy: number;
      }[]
    ).map((r) => ({ ...r, attempted: !!r.attempted, legacy: !!r.legacy }));
  }

  spear(id: string, reason: string) {
    return transaction(this.host.db, () => {
      const result = this.host.ledger.spear(id, reason);
      this.host.db
        .prepare(
          'INSERT OR IGNORE INTO worker_outbox_cancels SELECT id,?,? FROM kaji_outbox WHERE sortie_id=? AND done IS NULL',
        )
        .run(reason.slice(0, 500), new Date().toISOString(), id);
      const remotePending = (
        this.host.db.prepare('SELECT count(*) AS n FROM kaji_outbox WHERE sortie_id=? AND done IS NULL').get(id) as {
          n: number;
        }
      ).n;
      return { ...result, ...(remotePending ? { remotePending } : {}) };
    });
  }

  attemptWorkerOutbox(id: string): void {
    const origin = this.host.db.prepare('SELECT sortie_id FROM kaji_outbox WHERE id=? AND done IS NULL').get(id) as
      { sortie_id: string } | undefined;
    if (origin && this.host.watch.get(origin.sortie_id)) {
      try {
        if (!this.host.verifyWatchOutboxAuthority(origin.sortie_id)) {
          this.cancelWorkerOutbox(id, 'Proactive authority no longer permits dispatch.');
          throw Error('Proactive dispatch authority changed.');
        }
      } catch (error) {
        this.cancelWorkerOutbox(id, 'Proactive dispatch authority is unavailable or changed.');
        throw error;
      }
    }
    transaction(this.host.db, () => {
      const row = this.host.db
        .prepare(
          'SELECT created FROM kaji_outbox WHERE id=? AND done IS NULL AND NOT EXISTS (SELECT 1 FROM worker_outbox_cancels c WHERE c.id=kaji_outbox.id)',
        )
        .get(id) as { created: string } | undefined;
      if (!row || Date.parse(row.created) + WORKER_LEASE_MS <= Date.now())
        throw new Error('Worker request was cancelled or expired before dispatch.');
      this.host.db
        .prepare('INSERT OR IGNORE INTO worker_outbox_attempts VALUES(?,?)')
        .run(id, new Date().toISOString());
    });
  }

  heldWorkerOutbox(
    before = Number.MAX_SAFE_INTEGER,
  ): { sequence: number; id: string; base: string; tool: string; reason: string }[] {
    if (!Number.isSafeInteger(before) || before < 1) throw new Error('Invalid held-outbox cursor.');
    return this.host.db
      .prepare(
        "SELECT q.rowid AS sequence,q.id,q.base,q.tool,h.reason FROM kaji_outbox q JOIN worker_legacy_outbox h ON h.id=q.id WHERE h.state='pending' AND q.done IS NULL AND q.rowid<? ORDER BY q.rowid DESC LIMIT 20",
      )
      .all(before) as { sequence: number; id: string; base: string; tool: string; reason: string }[];
  }

  reconcileWorkerOutbox(id: string, action: 'retry' | 'abandon', reason: string, confirmedNotRun = false): void {
    if (
      !['retry', 'abandon'].includes(action) ||
      typeof reason !== 'string' ||
      reason.trim().length < 8 ||
      reason.length > 500 ||
      (action === 'retry' && !confirmedNotRun)
    )
      throw new Error('A reason and explicit not-run confirmation for retry are required.');
    transaction(this.host.db, () => {
      const row = this.host.db
        .prepare(
          "SELECT q.base FROM kaji_outbox q JOIN worker_legacy_outbox h ON h.id=q.id WHERE q.id=? AND q.done IS NULL AND h.state='pending'",
        )
        .get(id) as { base: string } | undefined;
      if (!row) throw new Error('No held legacy request with that ID.');
      if (action === 'retry') {
        this.host.db
          .prepare('UPDATE kaji_outbox SET created=?,result=NULL WHERE id=?')
          .run(new Date().toISOString(), id);
        this.host.db.prepare('DELETE FROM worker_outbox_attempts WHERE id=?').run(id);
      } else
        this.outboxDone(
          id,
          { outcome: 'uncertain', error: 'Owner stood down legacy retries; effects were not assumed undone.' },
          { base: row.base, text: 'Owner stood down the pre-upgrade request; its prior effects remain unknown.' },
        );
      this.host.db.prepare('UPDATE worker_legacy_outbox SET state=? WHERE id=?').run(action, id);
      this.host.db
        .prepare("INSERT INTO worker_outbox_reconciliations VALUES(?,?,?,'cli',?)")
        .run(id, action, reason, new Date().toISOString());
    });
  }

  /** Marks a sent action done with its result and, the first time only, records what the other base did on the sortie (B-011). */
  outboxDone(id: string, result: unknown, said?: { base: string; text: string }): boolean {
    return this.recordOutbox(id, result, said, true);
  }

  outboxProgress(id: string, result: unknown, said: { base: string; text: string }): boolean {
    return this.recordOutbox(id, result, said, false);
  }

  private recordOutbox(
    id: string,
    result: unknown,
    said: { base: string; text: string } | undefined,
    terminal: boolean,
  ): boolean {
    const encoded = JSON.stringify(result);
    if (!encoded || Buffer.byteLength(encoded) > WORKER_RESULT_BYTES)
      throw new Error('Remote result exceeds its persistence bound.');
    return transaction(this.host.db, () => {
      const row = this.host.db.prepare('SELECT sortie_id,tool,result,done FROM kaji_outbox WHERE id=?').get(id) as
        { sortie_id: string; tool: string; result: string | null; done: string | null } | undefined;
      if (!row) return false;
      if (row.done) {
        const previous = row.result ? (JSON.parse(row.result) as { outcome?: string }) : {};
        const next = result as { outcome?: string; refused?: unknown };
        if (
          !terminal ||
          previous.outcome !== 'uncertain' ||
          !(['grant', 'reject', 'invalid'].includes(next.outcome ?? '') || typeof next.refused === 'string')
        )
          return false;
      }
      if (
        !terminal &&
        row.result &&
        (JSON.parse(row.result) as { approvalId?: unknown }).approvalId ===
          (result as { approvalId?: unknown }).approvalId
      )
        return false;
      this.host.db
        .prepare('UPDATE kaji_outbox SET done=?,result=? WHERE id=?')
        .run(terminal ? new Date().toISOString() : null, encoded, id);
      if (said && this.host.watch.get(row.sortie_id))
        this.host.db
          .prepare('INSERT OR IGNORE INTO watch_notices VALUES(?,?,?,NULL)')
          .run(
            'remote:' + id + ':' + createHash('sha256').update(encoded).digest('hex'),
            row.sortie_id,
            said.text.slice(0, 600),
          );
      if (said) {
        const r = result as { outcome?: unknown; refused?: unknown };
        this.host.ledger.remoteResult(row.sortie_id, {
          base: said.base.slice(0, 60),
          tool: row.tool,
          outcome: typeof r.refused === 'string' ? 'refused' : typeof r.outcome === 'string' ? r.outcome : 'answered',
          text: said.text.slice(0, 600),
        });
      }
      return true;
    });
  }
}
