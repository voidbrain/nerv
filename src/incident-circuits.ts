import type { DatabaseSync } from 'node:sqlite';
import type { Ledger } from './ledger.ts';
import { transaction } from './sqlite-transaction.ts';

export const INCIDENT_CIRCUITS_SCHEMA = `
 CREATE TABLE IF NOT EXISTS incident_circuits(
   scope TEXT PRIMARY KEY,
   state TEXT NOT NULL,
   tainted_blue_attempts INTEGER NOT NULL DEFAULT 0,
   threshold INTEGER NOT NULL DEFAULT 3,
   tripped_at TEXT,
   reason TEXT,
   alert_sent INTEGER NOT NULL DEFAULT 0,
   evidence TEXT NOT NULL DEFAULT '[]',
   rearmed_at TEXT,
   rearmed_by TEXT
 );
 CREATE TABLE IF NOT EXISTS incident_circuit_history(
   sequence INTEGER PRIMARY KEY AUTOINCREMENT,
   scope TEXT NOT NULL,
   kind TEXT NOT NULL,
   actor TEXT NOT NULL,
   detail TEXT NOT NULL,
   created TEXT NOT NULL
 );`;

export interface CircuitSpearEvidence {
  sortieId: string;
  revoked: number;
  stoodDown: number;
  happened: Array<{ actionId: string; tool: string; inverse: string | null }>;
}

export interface ChannelCircuitState {
  scope: string;
  channel: string;
  state: 'armed' | 'tripped';
  taintedBlueAttempts: number;
  threshold: number;
  trippedAt: string | null;
  reason: string | null;
  alertSent: boolean;
  evidence: CircuitSpearEvidence[];
  rearmedAt: string | null;
  rearmedBy: string | null;
}

type CircuitRow = {
  scope: string;
  state: 'armed' | 'tripped';
  tainted_blue_attempts: number;
  threshold: number;
  tripped_at: string | null;
  reason: string | null;
  alert_sent: number;
  evidence: string;
  rearmed_at: string | null;
  rearmed_by: string | null;
};

const scopeFor = (channel: string): string => {
  const clean = channel.trim();
  if (!clean) throw new Error('Channel scope must be non-empty.');
  return clean.startsWith('channel:') ? clean : `channel:${clean}`;
};

const toState = (row: CircuitRow): ChannelCircuitState => ({
  scope: row.scope,
  channel: row.scope.replace(/^channel:/, ''),
  state: row.state,
  taintedBlueAttempts: row.tainted_blue_attempts,
  threshold: row.threshold,
  trippedAt: row.tripped_at,
  reason: row.reason,
  alertSent: row.alert_sent === 1,
  evidence: JSON.parse(row.evidence) as CircuitSpearEvidence[],
  rearmedAt: row.rearmed_at,
  rearmedBy: row.rearmed_by,
});

/**
 * First bounded incident circuit (F-064-T02):
 * On one channel, repeated Blue action attempts from tainted input trip the circuit,
 * spear every open sortie in that channel scope, stop new work in that scope,
 * keep evidence, emit one deduplicated alert, and allow only the owner to rearm.
 */
export class IncidentCircuitStore {
  readonly db: DatabaseSync;
  private readonly ledger: Ledger;

  constructor(db: DatabaseSync, ledger: Ledger) {
    this.db = db;
    this.ledger = ledger;
  }

  private tx<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  private ensure(scope: string, threshold = 3): CircuitRow {
    this.db
      .prepare("INSERT OR IGNORE INTO incident_circuits(scope, state, threshold) VALUES(?, 'armed', ?)")
      .run(scope, threshold);
    return this.db.prepare('SELECT * FROM incident_circuits WHERE scope=?').get(scope) as CircuitRow;
  }

  private appendHistory(scope: string, kind: string, actor: string, detail: unknown, now: Date): void {
    this.db
      .prepare('INSERT INTO incident_circuit_history(scope, kind, actor, detail, created) VALUES(?,?,?,?,?)')
      .run(scope, kind, actor, JSON.stringify(detail), now.toISOString());
  }

  get(channel: string): ChannelCircuitState | undefined {
    const row = this.db.prepare('SELECT * FROM incident_circuits WHERE scope=?').get(scopeFor(channel)) as
      CircuitRow | undefined;
    return row ? toState(row) : undefined;
  }

  list(): ChannelCircuitState[] {
    const rows = this.db.prepare('SELECT * FROM incident_circuits ORDER BY scope ASC').all() as CircuitRow[];
    return rows.map(toState);
  }

  isBlocked(channel: string): boolean {
    const row = this.db.prepare('SELECT state FROM incident_circuits WHERE scope=?').get(scopeFor(channel)) as
      { state: string } | undefined;
    return row?.state === 'tripped';
  }

  recordBlueAttempt(input: {
    channel: string;
    sortieId: string;
    tool: string;
    tainted: boolean;
    threshold?: number;
    openSortieIdsInChannel?: string[];
    now?: Date;
  }): { tripped: boolean; alert: boolean; state: ChannelCircuitState } {
    const now = input.now ?? new Date();
    const scope = scopeFor(input.channel);
    const threshold = input.threshold ?? 3;

    return this.tx(() => {
      const current = this.ensure(scope, threshold);
      if (!input.tainted) {
        return { tripped: false, alert: false, state: toState(current) };
      }

      const nextAttempts = current.tainted_blue_attempts + 1;
      this.db
        .prepare('UPDATE incident_circuits SET tainted_blue_attempts=?, threshold=? WHERE scope=?')
        .run(nextAttempts, threshold, scope);
      this.appendHistory(
        scope,
        'attempt',
        'circuit',
        { sortieId: input.sortieId, tool: input.tool, tainted: true, attempt: nextAttempts },
        now,
      );

      if (current.state === 'tripped') {
        const updated = this.db.prepare('SELECT * FROM incident_circuits WHERE scope=?').get(scope) as CircuitRow;
        return { tripped: true, alert: false, state: toState(updated) };
      }

      if (nextAttempts < threshold) {
        const updated = this.db.prepare('SELECT * FROM incident_circuits WHERE scope=?').get(scope) as CircuitRow;
        return { tripped: false, alert: false, state: toState(updated) };
      }

      const targetSorties = new Set<string>(input.openSortieIdsInChannel ?? [input.sortieId]);
      const reason = `Bounded circuit tripped on ${scope}: ${nextAttempts} tainted Blue attempts (last: ${input.tool}).`;
      const evidence: CircuitSpearEvidence[] = [];
      for (const sid of targetSorties) {
        const row = this.db.prepare('SELECT status FROM sorties WHERE id=?').get(sid) as { status: string } | undefined;
        if (!row || row.status !== 'open') continue;
        const speared = this.ledger.spear(sid, reason, now);
        evidence.push({ sortieId: sid, ...speared });
      }

      const shouldAlert = current.alert_sent === 0;
      this.db
        .prepare(
          "UPDATE incident_circuits SET state='tripped', tripped_at=?, reason=?, alert_sent=1, evidence=? WHERE scope=?",
        )
        .run(now.toISOString(), reason, JSON.stringify(evidence), scope);
      this.appendHistory(scope, 'trip', 'circuit', { reason, evidence }, now);

      const trippedRow = this.db.prepare('SELECT * FROM incident_circuits WHERE scope=?').get(scope) as CircuitRow;
      return { tripped: true, alert: shouldAlert, state: toState(trippedRow) };
    });
  }

  rearm(channel: string, actor: string, now = new Date()): ChannelCircuitState {
    if (actor !== 'owner') {
      throw new Error('Only the owner can rearm a tripped incident circuit.');
    }
    const scope = scopeFor(channel);
    return this.tx(() => {
      const current = this.db.prepare('SELECT * FROM incident_circuits WHERE scope=?').get(scope) as
        CircuitRow | undefined;
      if (!current) throw new Error(`No incident circuit for ${scope}.`);
      this.db
        .prepare(
          "UPDATE incident_circuits SET state='armed', tainted_blue_attempts=0, alert_sent=0, rearmed_at=?, rearmed_by=? WHERE scope=?",
        )
        .run(now.toISOString(), actor, scope);
      this.appendHistory(scope, 'rearm', actor, { previousState: current.state }, now);
      const updated = this.db.prepare('SELECT * FROM incident_circuits WHERE scope=?').get(scope) as CircuitRow;
      return toState(updated);
    });
  }
}
