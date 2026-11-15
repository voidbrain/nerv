import type { DatabaseSync } from 'node:sqlite';
import { MAX_SPEAR_HAPPENED, type EventKind, type EventPayloads, type Happened } from './events.ts';
import type { Tool } from './policy.ts';
import type { Approval, Card, Decision } from './ledger.ts';
import { argsHash } from './ledger.ts';

const iso = (now: Date, plus = 0) => new Date(now.getTime() + plus).toISOString();

export interface LedgerApprovalHost {
  readonly db: DatabaseSync;
  readonly tools: ReadonlyMap<string, Tool>;
  readonly grantTtlMs: number;
  tx<T>(fn: () => T): T;
  event<K extends EventKind>(
    sortieId: string,
    actionId: string | null,
    kind: K,
    payload: EventPayloads[K],
    now: Date,
  ): void;
  issue(actionId: string, tool: string, args: Record<string, unknown>, sortieId: string, now: Date): string;
}

export class LedgerApprovals {
  private readonly host: LedgerApprovalHost;
  constructor(host: LedgerApprovalHost) {
    this.host = host;
  }
  pendingApprovals(now = new Date(), limit = 5): Approval[] {
    // Up to 20: one Instrumentality night can propose 10 facts, sent to the owner as one bundled card (F-022).
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid approval page.');
    return (
      this.host.db
        .prepare(
          'SELECT id,card,expires,decision FROM approvals WHERE decision IS NULL AND expires>? ORDER BY expires LIMIT ?',
        )
        .all(iso(now), limit) as { id: string; card: string; expires: string; decision: null }[]
    ).map((r) => ({ ...r, card: JSON.parse(r.card) as Card }));
  }
  /** F-042: open clarification questions currently waiting for the owner's answer. */
  waitingQuestions(now = new Date(), limit = 10): { sortieId: string; title: string; text: string; expires: string }[] {
    const rows = this.host.db
      .prepare(
        `SELECT s.id AS sortie_id,s.title,q.payload FROM sorties s JOIN events q ON q.sortie_id=s.id
         WHERE s.status='open' AND q.kind='misato.asked'
         AND q.sequence=(SELECT max(sequence) FROM events e WHERE e.sortie_id=s.id AND e.kind='misato.asked')
         AND q.sequence>coalesce((SELECT max(sequence) FROM events a WHERE a.sortie_id=s.id AND a.kind='misato.answered'),0)
         ORDER BY q.sequence DESC LIMIT ?`,
      )
      .all(limit) as { sortie_id: string; title: string; payload: string }[];
    const at = iso(now);
    return rows.flatMap((r) => {
      const p = JSON.parse(r.payload) as { text: string; expires: string };
      return p.expires > at ? [{ sortieId: r.sortie_id, title: r.title, text: p.text, expires: p.expires }] : [];
    });
  }
  /** Authoritative point lookup: absence from a limited pending page is not a decision. */
  pendingApprovalIds(ids: string[], now = new Date()): string[] {
    if (
      !Array.isArray(ids) ||
      ids.length > 200 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
    )
      throw new Error('Invalid approval IDs.');
    if (!ids.length) return [];
    return (
      this.host.db
        .prepare(
          `SELECT id FROM approvals WHERE id IN (${ids.map(() => '?').join(',')}) AND decision IS NULL AND expires>?`,
        )
        .all(...ids, iso(now)) as { id: string }[]
    ).map((r) => r.id);
  }
  /** Applied once: repeating a decision returns the first outcome. Expiry never approves. */
  decide(
    approvalId: string,
    decision: Decision,
    source: string,
    now = new Date(),
  ): { decision: string; grantId?: string } {
    if (
      !['approve', 'reject', 'edit'].includes(decision) ||
      typeof source !== 'string' ||
      !source ||
      source.length > 100
    )
      throw new Error('Invalid decision.');
    return this.host.tx(() => {
      const row = this.host.db
        .prepare(
          'SELECT a.*,x.sortie_id,x.tool,x.args FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?',
        )
        .get(approvalId) as
        | { action_id: string; expires: string; decision: string | null; sortie_id: string; tool: string; args: string }
        | undefined;
      if (!row) throw new Error('No approval with that ID.');
      if (row.decision) {
        const grant = this.host.db.prepare('SELECT id FROM grants WHERE action_id=?').get(row.action_id) as
          { id: string } | undefined;
        return { decision: row.decision, ...(grant ? { grantId: grant.id } : {}) };
      }
      const final = row.expires <= iso(now) ? 'expired' : decision;
      this.host.db
        .prepare('UPDATE approvals SET decision=?,decided=?,source=? WHERE id=?')
        .run(final, iso(now), final === 'expired' ? 'ttl' : source, approvalId);
      if (final === 'expired')
        this.host.event(row.sortie_id, row.action_id, 'approval.expired', { approvalId, source: 'ttl' }, now);
      else this.host.event(row.sortie_id, row.action_id, `approval.${final}`, { approvalId, source }, now);
      return final === 'approve'
        ? {
            decision: final,
            grantId: this.host.issue(
              row.action_id,
              row.tool,
              JSON.parse(row.args) as Record<string, unknown>,
              row.sortie_id,
              now,
            ),
          }
        : { decision: final };
    });
  }
  /** Approvals that expired without the owner deciding, since a time (F-028): what the brief reports as not done. */
  expiredSince(since: string, limit = 20): { tool: string; sortieId: string; title: string; expired: string }[] {
    if (typeof since !== 'string' || !Number.isFinite(Date.parse(since))) throw new Error('Invalid time.');
    return this.host.db
      .prepare(
        `SELECT x.tool,x.sortie_id AS sortieId,s.title,a.decided AS expired FROM approvals a JOIN actions x ON x.id=a.action_id JOIN sorties s ON s.id=x.sortie_id
    WHERE a.decision='expired' AND a.decided>? ORDER BY a.decided LIMIT ?`,
      )
      .all(new Date(Date.parse(since)).toISOString(), Math.min(Math.max(1, limit), 50)) as {
      tool: string;
      sortieId: string;
      title: string;
      expired: string;
    }[];
  }
  /** Run on scheduler ticks: stand down approvals whose TTL passed. */
  expire(now = new Date()): number {
    return this.host.tx(() => {
      const due = this.host.db
        .prepare(
          'SELECT a.id,a.action_id,x.sortie_id FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.decision IS NULL AND a.expires<=?',
        )
        .all(iso(now)) as { id: string; action_id: string; sortie_id: string }[];
      for (const r of due) {
        this.host.db
          .prepare('UPDATE approvals SET decision=?,decided=?,source=? WHERE id=?')
          .run('expired', iso(now), 'ttl', r.id);
        this.host.event(r.sortie_id, r.action_id, 'approval.expired', { approvalId: r.id, source: 'ttl' }, now);
      }
      const questions = this.host.db
        .prepare(
          `SELECT e.sortie_id,e.sequence FROM events e JOIN sorties s ON s.id=e.sortie_id
    WHERE s.status='open' AND e.kind='misato.asked' AND json_extract(e.payload,'$.expires')<=?
    AND NOT EXISTS (SELECT 1 FROM events a WHERE a.sortie_id=e.sortie_id AND a.sequence>e.sequence AND a.kind IN ('misato.answered','misato.asked'))`,
        )
        .all(iso(now)) as { sortie_id: string; sequence: number }[];
      for (const q of questions) {
        this.host.db.prepare("UPDATE sorties SET status='failed',closed=? WHERE id=?").run(iso(now), q.sortie_id);
        this.host.event(q.sortie_id, null, 'misato.unanswered', { questionSequence: q.sequence }, now);
        this.host.event(
          q.sortie_id,
          null,
          'misato.reply',
          { text: 'No answer within 24 hours; this request is closed. Nothing was resumed.' },
          now,
        );
        this.host.event(q.sortie_id, null, 'sortie.failed', {}, now);
      }
      return due.length + questions.length;
    });
  }
  /** The executor's check, on every call: exact tool and arguments, unexpired, unrevoked, single use. */
  authorize(grantId: string, tool: string, args: Record<string, unknown>, now = new Date()): void {
    // The denial is committed as an event before the caller sees the error.
    const reason = this.host.tx(() => {
      const g = this.host.db
        .prepare('SELECT g.*,x.sortie_id FROM grants g JOIN actions x ON x.id=g.action_id WHERE g.id=?')
        .get(grantId) as
        | {
            action_id: string;
            tool: string;
            args_hash: string;
            expires: string;
            used: string | null;
            revoked: string | null;
            sortie_id: string;
          }
        | undefined;
      if (!g) return 'unknown grant';
      const denied = g.revoked
        ? 'revoked'
        : g.used
          ? 'already used'
          : g.expires <= iso(now)
            ? 'expired'
            : g.tool !== tool || g.args_hash !== argsHash(args)
              ? 'action differs from the reviewed one'
              : undefined;
      if (denied) {
        this.host.event(g.sortie_id, g.action_id, 'grant.denied', { reason: denied }, now);
        return denied;
      }
      this.host.db.prepare('UPDATE grants SET used=? WHERE id=?').run(iso(now), grantId);
      this.host.event(g.sortie_id, g.action_id, 'grant.used', {}, now);
      return undefined;
    });
    if (reason) throw new Error(`A.T. Field denied: ${reason}.`);
  }
  /** Spear of Longinus: revoke grants, stand down approvals, close the sortie. Effects already executed are reported, never assumed undone. */
  spear(
    sortieId: string,
    reason: string,
    now = new Date(),
  ): { revoked: number; stoodDown: number; happened: Happened[] } {
    return this.host.tx(() => {
      const sortie = this.host.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieId) as
        { status: string } | undefined;
      if (!sortie) throw new Error('No sortie with that ID.');
      const revoked = Number(
        this.host.db
          .prepare(
            'UPDATE grants SET revoked=? WHERE revoked IS NULL AND used IS NULL AND action_id IN (SELECT id FROM actions WHERE sortie_id=?)',
          )
          .run(iso(now), sortieId).changes,
      );
      const stoodDown = Number(
        this.host.db
          .prepare(
            "UPDATE approvals SET decision='revoked',decided=?,source='spear' WHERE decision IS NULL AND action_id IN (SELECT id FROM actions WHERE sortie_id=?)",
          )
          .run(iso(now), sortieId).changes,
      );
      const happened = (
        this.host.db
          .prepare(
            'SELECT x.id AS actionId,x.tool FROM grants g JOIN actions x ON x.id=g.action_id WHERE x.sortie_id=? AND g.used IS NOT NULL ORDER BY g.used',
          )
          .all(sortieId) as { actionId: string; tool: string }[]
      ).map((h) => ({ ...h, inverse: this.host.tools.get(h.tool)?.inverse ?? null }));
      this.host.db
        .prepare("UPDATE sorties SET status='revoked',closed=? WHERE id=? AND status='open'")
        .run(iso(now), sortieId);
      this.host.event(
        sortieId,
        null,
        'spear',
        {
          reason: String(reason).slice(0, 500),
          revoked,
          stoodDown,
          happenedCount: happened.length,
          happened: happened.slice(0, MAX_SPEAR_HAPPENED),
        },
        now,
      );
      return { revoked, stoodDown, happened };
    });
  }
}
