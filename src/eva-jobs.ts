import { execFileSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import type { Ledger } from './ledger.ts';
import { transaction } from './sqlite-transaction.ts';
import type { Eva03JobResult, Eva03LedgerEvent } from './eva-runner.ts';

/**
 * F-049-T13: durable receipts for EVA-03 jobs (decisions/eva-runner.md, "Worker recovery join"). A receipt is written
 * before a job runs and holds an exclusive lock on the job's resource. A job that ends with an uncertain effect, or is
 * found still running after a restart, keeps its lock until the owner reconciles it; a replay of a job ID never runs.
 */
export type EvaReceiptState =
  'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'uncertain' | 'reconciled';

export interface EvaReceipt {
  readonly id: string;
  readonly sortieId: string;
  readonly key: string;
  readonly hash: string;
  readonly state: EvaReceiptState;
  readonly started: string;
  readonly ended: string | null;
  readonly detail: string | null;
}

/** States that hold the resource lock: the job may still be running, or what it did is unknown. */
const HOLDS_LOCK: readonly EvaReceiptState[] = ['running', 'uncertain'];

/** A job ID that already has a receipt: it never runs again, whatever its state. */
export class EvaReplayError extends Error {
  readonly receipt: EvaReceipt;
  constructor(receipt: EvaReceipt) {
    super(`EVA job ${receipt.id} already has a receipt (${receipt.state}); it does not run again.`);
    this.name = 'EvaReplayError';
    this.receipt = receipt;
  }
}

/** The resource is held by a running or uncertain job: nothing else runs on it until that one ends or is reconciled. */
export class EvaLockedError extends Error {
  readonly holder: EvaReceipt;
  constructor(holder: EvaReceipt) {
    super(
      `${holder.key} is held by EVA job ${holder.id} (${holder.state}); ` +
        (holder.state === 'uncertain' ? 'the owner reconciles it first.' : 'it waits for that job to end.'),
    );
    this.name = 'EvaLockedError';
    this.holder = holder;
  }
}

interface Row {
  runner: number;
  runner_started: string;
  id: string;
  sortie_id: string;
  lock_key: string;
  hash: string;
  state: EvaReceiptState;
  started: string;
  ended: string | null;
  detail: string | null;
}
const toReceipt = (r: Row): EvaReceipt => ({
  id: r.id,
  sortieId: r.sortie_id,
  key: r.lock_key,
  hash: r.hash,
  state: r.state,
  started: r.started,
  ended: r.ended,
  detail: r.detail,
});

export class EvaJobs {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS eva_jobs(id TEXT PRIMARY KEY,sortie_id TEXT NOT NULL,lock_key TEXT NOT NULL,
      hash TEXT NOT NULL,state TEXT NOT NULL,started TEXT NOT NULL,ended TEXT,detail TEXT,runner INTEGER NOT NULL DEFAULT 0,
      runner_started TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS eva_jobs_lock ON eva_jobs(lock_key,state);`);
  }

  receipt(id: string): EvaReceipt | undefined {
    const row = this.db.prepare('SELECT * FROM eva_jobs WHERE id=?').get(id) as Row | undefined;
    return row && toReceipt(row);
  }

  /** The newest receipts first, for `nerv eva jobs`. */
  list(limit = 50): EvaReceipt[] {
    return (this.db.prepare('SELECT * FROM eva_jobs ORDER BY started DESC LIMIT ?').all(limit) as unknown as Row[]).map(
      toReceipt,
    );
  }

  /** Writes the receipt and takes the lock before anything runs; refuses a replay and a held resource. */
  begin(job: { id: string; sortieId: string; key: string; hash: string }, now = new Date()): EvaReceipt {
    return transaction(this.db, () => {
      const seen = this.receipt(job.id);
      if (seen) throw new EvaReplayError(seen);
      const holder = this.db
        .prepare(
          `SELECT * FROM eva_jobs WHERE lock_key=? AND state IN (${HOLDS_LOCK.map(() => '?').join(',')}) LIMIT 1`,
        )
        .get(job.key, ...HOLDS_LOCK) as Row | undefined;
      if (holder) throw new EvaLockedError(toReceipt(holder));
      this.db
        .prepare("INSERT INTO eva_jobs VALUES(?,?,?,?,'running',?,NULL,NULL,?,?)")
        .run(
          job.id,
          job.sortieId,
          job.key,
          job.hash,
          now.toISOString(),
          process.pid,
          processStarted(process.pid) ?? '',
        );
      return this.receipt(job.id)!;
    });
  }

  /**
   * Ends a running job; an uncertain effect keeps the lock (state `uncertain`) until the owner reconciles it. Returns
   * false when the receipt was already settled (recovery marked it uncertain): that settlement stands.
   */
  finish(
    id: string,
    state: Exclude<EvaReceiptState, 'running' | 'reconciled'>,
    detail?: string,
    now = new Date(),
  ): boolean {
    return (
      this.db
        .prepare("UPDATE eva_jobs SET state=?,ended=?,detail=? WHERE id=? AND state='running'")
        .run(state, now.toISOString(), detail?.slice(0, 600) ?? null, id).changes > 0
    );
  }

  /**
   * A job still marked running whose runner is gone was interrupted; its effect is unknown, so it keeps its lock and its
   * sortie closes as failed. The runner is the process with the recorded pid and start time: a pid reused by another
   * process does not count, and a job whose runner still runs (this process or another `nerv`) is left running.
   */
  recover(
    ledger: Ledger,
    now = new Date(),
    runnerRunning: (pid: number, started: string) => boolean = sameProcessRunning,
  ): EvaReceipt[] {
    return transaction(this.db, () => {
      const rows = (this.db.prepare("SELECT * FROM eva_jobs WHERE state='running'").all() as unknown as Row[]).filter(
        (r) => !runnerRunning(r.runner, r.runner_started),
      );
      const note =
        'Interrupted: its runner stopped, so what the job did is unknown and its processes may still be running; ' +
        'its lock stays until the owner reconciles it.';
      for (const r of rows) {
        this.db
          .prepare("UPDATE eva_jobs SET state='uncertain',ended=?,detail=? WHERE id=?")
          .run(now.toISOString(), note, r.id);
        ledger.evaJob(r.sortie_id, 'eva03.recovered', event(r.id, true, note), now);
        ledger.close(r.sortie_id, 'failed', now);
      }
      return rows.map((r) => this.receipt(r.id)!);
    });
  }

  /** The owner's decision on an uncertain job: what they confirmed is kept, and the lock is released. */
  reconcile(ledger: Ledger, id: string, confirmed: string, now = new Date()): EvaReceipt {
    if (!confirmed.trim()) throw new Error('Say what you confirmed about the job (what it did or did not do).');
    return transaction(this.db, () => {
      const r = this.receipt(id);
      if (!r || r.state !== 'uncertain') throw new Error(`EVA job ${id} is not uncertain; nothing to reconcile.`);
      this.db
        .prepare("UPDATE eva_jobs SET state='reconciled',detail=? WHERE id=?")
        .run(`${r.detail ?? ''} Reconciled: ${confirmed}`.trim().slice(0, 600), id);
      // The effect stays as uncertain as it was; reconciling records the owner's word and frees the resource.
      ledger.evaJob(r.sortieId, 'eva03.reconciled', event(id, true, `Owner: ${confirmed}`.slice(0, 600)), now);
      return this.receipt(id)!;
    });
  }
}

/**
 * A process's start time as `ps` prints it; null when no process has that pid; undefined when it cannot be read
 * (no `ps`, as on Windows, or it failed).
 */
function processStarted(pid: number): string | null | undefined {
  if (!pid) return null;
  try {
    const out = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 });
    return out.trim() || null;
  } catch (e) {
    // ps exits 1 with no output when the pid is not running; anything else means it could not tell.
    return (e as { status?: number }).status === 1 ? null : undefined;
  }
}

function pidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The recorded runner still runs: same pid and, when both are known, the same start time (a reused pid does not
 * count). Where start times cannot be read, a live pid counts as the runner: a job is never taken from a live runner.
 */
function sameProcessRunning(pid: number, started: string): boolean {
  const now = processStarted(pid);
  if (now === undefined) return pidAlive(pid);
  return now !== null && (started === '' || now === started);
}

const event = (jobId: string, uncertain: boolean, detail?: string) => ({
  jobId,
  evaClass: 'eva-03' as const,
  uncertainExternalEffect: uncertain,
  rollbackClaimed: false as const,
  containment: 'best-effort' as const,
  // Bounded: an event stays far below the ledger's payload limit whatever the runner reported.
  ...(detail ? { detail: detail.slice(0, 600) } : {}),
});

/**
 * F-049-T13: runs one EVA-03 job across receipt, runner and ledger. The receipt and lock come first; every runner event
 * is appended to the sortie as it happens; the receipt ends in the job's outcome, or `uncertain` when its effect is.
 */
export async function runEva03Durably(options: {
  readonly jobs: EvaJobs;
  readonly ledger: Ledger;
  readonly sortieId: string;
  readonly jobId: string;
  /** The resource the job may change, held exclusively while it runs or is uncertain. */
  readonly key: string;
  readonly hash: string;
  readonly run: (onLedgerEvent: (e: Eva03LedgerEvent) => void) => Promise<Eva03JobResult>;
}): Promise<Eva03JobResult> {
  const { jobs, ledger, sortieId, jobId } = options;
  jobs.begin({ id: jobId, sortieId, key: options.key, hash: options.hash });
  let last: Eva03LedgerEvent | undefined;
  let result: Eva03JobResult;
  try {
    result = await options.run((e) => {
      last = e;
      ledger.evaJob(sortieId, e.kind, event(e.jobId, e.uncertainExternalEffect, e.detail));
    });
  } catch (e) {
    // The runner threw before it could report an end: nothing proves the job did not act.
    const detail = `The runner failed: ${e instanceof Error ? e.message : String(e)}`;
    ledger.evaJob(sortieId, 'eva03.failed', event(jobId, true, detail));
    jobs.finish(jobId, 'uncertain', detail);
    throw e;
  }
  const outcome = last?.kind.replace('eva03.', '') as 'completed' | 'failed' | 'timed_out' | 'cancelled' | undefined;
  // False when recovery already settled the receipt while the job ran: that settlement stands, the result is kept.
  jobs.finish(jobId, !outcome || last!.uncertainExternalEffect ? 'uncertain' : outcome, last?.detail);
  return result;
}
