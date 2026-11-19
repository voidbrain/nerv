import type { DatabaseSync } from 'node:sqlite';
import type { Ballot, Verdict } from './policy.ts';
import { explainSortie, type WhyRecord } from './why.ts';
import { computeRoleTimingStats, type RoleTimingStats, type SortieTiming } from './timing.ts';
import { type SortieEvent } from './events.ts';
import type { ActionDetail, SortieSummary } from './ledger.ts';

export interface LedgerQueryHost {
  readonly db: DatabaseSync;
  events(sortieId: string, after?: number, limit?: number): SortieEvent[];
  remoteResults(sortieId: string): string[];
}

export class LedgerQueries {
  private readonly host: LedgerQueryHost;
  constructor(host: LedgerQueryHost) {
    this.host = host;
  }
  summarize(r: {
    id: string;
    source: string;
    title: string;
    trust: string;
    status: string;
    created: string;
    closed: string | null;
  }): SortieSummary {
    const actions = this.host.db
      .prepare('SELECT id,tool,ballot FROM actions WHERE sortie_id=? ORDER BY created, rowid')
      .all(r.id) as { id: string; tool: string; ballot: string }[];
    const waiting = (
      this.host.db
        .prepare(
          'SELECT count(*) AS n FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=? AND a.decision IS NULL',
        )
        .get(r.id) as { n: number }
    ).n;
    const ballots = actions.map((a) => JSON.parse(a.ballot) as Ballot);
    const q = this.host.db
      .prepare(
        "SELECT payload FROM events WHERE sortie_id=? AND kind='misato.asked' AND sequence>coalesce((SELECT max(sequence) FROM events WHERE sortie_id=? AND kind='misato.answered'),0) ORDER BY sequence DESC LIMIT 1",
      )
      .get(r.id, r.id) as { payload: string } | undefined;
    const question =
      r.status === 'open' && q ? (JSON.parse(q.payload) as { text: string; expires: string }) : undefined;
    return {
      ...r,
      ...(question ? { question: { text: question.text, expires: question.expires } } : {}),
      actions: actions.length,
      waiting,
      patterns: ballots.map((b) => b.pattern),
      why: question
        ? 'Waiting for your answer: ' + question.text
        : this.why(r, actions.length, actions.at(-1), ballots.at(-1)),
    };
  }
  /** The facts explainSortie needs: the latest action's ballot, the owner's decision and what became of it. */
  why(
    r: { id: string; status: string },
    count: number,
    last: { id: string; tool: string } | undefined,
    ballot: Ballot | undefined,
  ): string {
    const one = (sql: string, ...args: string[]) =>
      this.host.db.prepare(sql).get(...args) as
        { kind?: string; payload?: string; decision?: string | null } | undefined;
    const ran = last
      ? one(
          "SELECT kind,payload FROM events WHERE action_id=? AND kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1",
          last.id,
        )
      : undefined;
    const spear =
      r.status === 'revoked'
        ? one("SELECT payload FROM events WHERE sortie_id=? AND kind='spear' ORDER BY sequence DESC LIMIT 1", r.id)
        : undefined;
    const replied = !!one("SELECT 1 AS kind FROM events WHERE sortie_id=? AND kind='misato.reply' LIMIT 1", r.id);
    const error = ran?.kind === 'action.failed' ? (JSON.parse(ran.payload!) as { error?: string }).error : undefined;
    return explainSortie({
      status: r.status,
      actions: count,
      replied,
      spearReason: spear ? (JSON.parse(spear.payload!) as { reason?: string }).reason : undefined,
      last:
        last && ballot
          ? {
              tool: last.tool,
              outcome: ballot.outcome,
              reason: ballot.reason,
              decision: one('SELECT decision FROM approvals WHERE action_id=?', last.id)?.decision ?? null,
              ran: ran?.kind === 'action.done' ? 'done' : ran?.kind === 'action.failed' ? 'failed' : null,
              error,
            }
          : undefined,
    });
  }
  /** Newest sorties first, for the dashboard (F-019): status, counts, each action's Pattern and one sentence of why, never
  grant IDs. `before` pages back through history; `q` keeps sorties whose title contains it (case-insensitive, literal). */
  sorties(limit = 20, before?: string, q?: string): SortieSummary[] {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (before !== undefined && (typeof before !== 'string' || !Number.isFinite(Date.parse(before)))) ||
      (q !== undefined && (typeof q !== 'string' || !q.trim() || q.length > 200))
    )
      throw new Error('Invalid sortie page.');
    const where = [...(before ? ['created<?'] : []), ...(q ? ["title LIKE ? ESCAPE '\\'"] : [])];
    const like = q ? '%' + q.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%' : undefined;
    const rows = this.host.db
      .prepare(
        `SELECT id,source,title,trust,status,created,closed FROM sorties ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created DESC LIMIT ?`,
      )
      .all(...(before ? [before] : []), ...(like ? [like] : []), limit) as Parameters<LedgerQueries['summarize']>[0][];
    return rows.map((r) => this.summarize(r));
  }
  /** One sortie with its actions: tool, arguments, ballot and what became of each. */
  sortie(id: string): (SortieSummary & { detail: ActionDetail[]; timings?: SortieTiming[] }) | undefined {
    if (typeof id !== 'string' || !id || id.length > 100) throw new Error('Invalid sortie.');
    const row = this.host.db
      .prepare('SELECT id,source,title,trust,status,created,closed FROM sorties WHERE id=?')
      .get(id) as Parameters<LedgerQueries['summarize']>[0] | undefined;
    if (!row) return undefined;
    const actions = this.host.db
      .prepare(
        `SELECT x.id,x.tool,x.args,x.ballot,x.created,a.decision,
    (SELECT kind FROM events e WHERE e.action_id=x.id AND e.kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1) AS ran,
    (SELECT payload FROM events e WHERE e.action_id=x.id AND e.kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1) AS ran_payload
    FROM actions x LEFT JOIN approvals a ON a.action_id=x.id WHERE x.sortie_id=? ORDER BY x.created`,
      )
      .all(id) as {
      id: string;
      tool: string;
      args: string;
      ballot: string;
      created: string;
      decision: string | null;
      ran: string | null;
      ran_payload: string | null;
    }[];
    const detail = actions.map((x): ActionDetail => {
      const ballot = JSON.parse(x.ballot) as Ballot;
      const ranPayload = x.ran_payload ? (JSON.parse(x.ran_payload) as { durationMs?: number }) : undefined;
      const durationMs = typeof ranPayload?.durationMs === 'number' ? ranPayload.durationMs : undefined;
      const status: ActionDetail['status'] =
        x.ran === 'action.done'
          ? 'done'
          : x.ran === 'action.failed'
            ? 'failed'
            : ballot.outcome === 'reject'
              ? 'rejected'
              : ballot.outcome === 'approval' && x.decision === null
                ? 'waiting'
                : ballot.outcome === 'approval' && x.decision !== 'approve'
                  ? 'stood-down'
                  : 'proposed';
      return {
        id: x.id,
        tool: x.tool,
        args: JSON.parse(x.args) as Record<string, unknown>,
        ballot,
        created: x.created,
        status,
        ...(durationMs !== undefined ? { durationMs } : {}),
      };
    });
    const timings = this.collectTimings(id);
    return { ...this.summarize(row), detail, ...(timings.length ? { timings } : {}) };
  }
  seatDisplayName(seat: string): string {
    return seat
      .replace(/^extra:/i, '')
      .replace(/(^|[^\p{L}])(\p{L})/gu, (_, b: string, c: string) => b + c.toUpperCase());
  }
  collectTimings(sortieId: string): SortieTiming[] {
    const rows = this.host.db
      .prepare(
        "SELECT kind,payload FROM events WHERE sortie_id=? AND kind IN ('misato.consult','misato.step','misato.reply','misato.asked','ballot','ballot.shadow','action.done','action.failed','kaji.answered') ORDER BY sequence",
      )
      .all(sortieId) as { kind: string; payload: string }[];
    const timings: SortieTiming[] = [];
    let misatoMs = 0;
    let hasMisato = false;
    let casperMs = 0;
    let hasCasper = false;
    const seatOrder: string[] = [];
    const seatMap = new Map<string, SortieTiming>();
    let executorLabel = '';
    let executorMs = 0;
    let hasExecutor = false;
    const actionExecutors = new Map<string, string>();
    const actionRows = this.host.db.prepare('SELECT id,ballot FROM actions WHERE sortie_id=?').all(sortieId) as {
      id: string;
      ballot: string;
    }[];
    for (const a of actionRows) {
      const b = JSON.parse(a.ballot) as { executor?: string };
      if (b.executor) actionExecutors.set(a.id, b.executor.toUpperCase());
    }
    for (const r of rows) {
      const p = JSON.parse(r.payload) as Record<string, unknown>;
      if (r.kind === 'misato.consult' && typeof p.durationMs === 'number') {
        const pilot = p.pilot as { name?: string } | undefined;
        timings.push({
          role: 'consultant',
          label: pilot?.name ? pilot.name : 'Consultant',
          durationMs: p.durationMs,
        });
      } else if (
        (r.kind === 'misato.step' || r.kind === 'misato.reply' || r.kind === 'misato.asked') &&
        typeof p.durationMs === 'number'
      ) {
        misatoMs += p.durationMs;
        hasMisato = true;
      } else if (r.kind === 'ballot') {
        const verdicts = Array.isArray(p.verdicts) ? (p.verdicts as Verdict[]) : [];
        if (typeof p.executor === 'string') executorLabel = p.executor.toUpperCase();
        for (const v of verdicts) {
          if (typeof v.durationMs !== 'number') continue;
          if (v.seat === 'casper') {
            casperMs += v.durationMs;
            hasCasper = true;
          } else if (v.seat.startsWith('extra:')) {
            const label = this.seatDisplayName(v.seat);
            if (!seatMap.has(label)) seatOrder.push(label);
            seatMap.set(label, {
              role: 'seat',
              label,
              durationMs: v.durationMs,
              ...(v.shadow ? { shadow: true } : {}),
              ...(typeof v.transferMs === 'number' ? { transferMs: v.transferMs } : {}),
            });
          }
        }
      } else if (r.kind === 'ballot.shadow' && typeof p.durationMs === 'number' && typeof p.seat === 'string') {
        const label = this.seatDisplayName(p.seat);
        if (!seatMap.has(label)) seatOrder.push(label);
        seatMap.set(label, {
          role: 'seat',
          label,
          durationMs: p.durationMs,
          shadow: true,
          ...(typeof p.transferMs === 'number' ? { transferMs: p.transferMs } : {}),
        });
      } else if ((r.kind === 'action.done' || r.kind === 'action.failed') && typeof p.durationMs === 'number') {
        executorMs += p.durationMs;
        hasExecutor = true;
      } else if (r.kind === 'kaji.answered' && typeof p.transferMs === 'number') {
        const base = p.base as { name?: string } | undefined;
        timings.push({
          role: 'kaji',
          label: base?.name ? `Kaji (${base.name})` : 'Kaji',
          durationMs: p.transferMs,
          transferMs: p.transferMs,
        });
      }
    }
    if (hasMisato) timings.push({ role: 'misato', label: 'Misato', durationMs: misatoMs });
    if (hasCasper) timings.push({ role: 'casper', label: 'Casper', durationMs: casperMs });
    for (const label of seatOrder) timings.push(seatMap.get(label)!);
    if (hasExecutor)
      timings.push({
        role: 'executor',
        label: executorLabel || [...actionExecutors.values()].at(-1) || 'EVA-02',
        durationMs: executorMs,
      });
    return timings;
  }
  /** Daily timing summary (F-052-T05): median and slowest duration per role since `since`. */
  timingSummary(since: string): RoleTimingStats[] {
    if (typeof since !== 'string' || !Number.isFinite(Date.parse(since))) throw new Error('Invalid date.');
    const at = new Date(since).toISOString();
    const rows = this.host.db
      .prepare(
        "SELECT kind,payload FROM events WHERE created>? AND kind IN ('misato.consult','misato.step','misato.reply','misato.asked','ballot','ballot.shadow','action.done','action.failed','kaji.answered')",
      )
      .all(at) as { kind: string; payload: string }[];
    const samples: { role: string; durationMs: number }[] = [];
    for (const r of rows) {
      const p = JSON.parse(r.payload) as Record<string, unknown>;
      if (r.kind === 'misato.consult' && typeof p.durationMs === 'number') {
        const model = typeof p.model === 'string' && p.model ? p.model : undefined;
        const pilot = p.pilot as { name?: string } | undefined;
        const who = pilot?.name ?? 'Consultant';
        samples.push({ role: model ? `${who} (${model})` : who, durationMs: p.durationMs });
      } else if (
        (r.kind === 'misato.step' || r.kind === 'misato.reply' || r.kind === 'misato.asked') &&
        typeof p.durationMs === 'number'
      ) {
        samples.push({ role: 'Misato', durationMs: p.durationMs });
      } else if (r.kind === 'ballot') {
        const verdicts = Array.isArray(p.verdicts) ? (p.verdicts as Verdict[]) : [];
        for (const v of verdicts) {
          if (typeof v.durationMs !== 'number') continue;
          if (v.seat === 'casper') samples.push({ role: 'Casper', durationMs: v.durationMs });
          else if (v.seat.startsWith('extra:'))
            samples.push({ role: this.seatDisplayName(v.seat), durationMs: v.durationMs });
        }
      } else if (r.kind === 'ballot.shadow' && typeof p.durationMs === 'number' && typeof p.seat === 'string') {
        samples.push({ role: this.seatDisplayName(p.seat), durationMs: p.durationMs });
      } else if ((r.kind === 'action.done' || r.kind === 'action.failed') && typeof p.durationMs === 'number') {
        samples.push({ role: 'Executor', durationMs: p.durationMs });
      } else if (r.kind === 'kaji.answered' && typeof p.transferMs === 'number') {
        const base = p.base as { name?: string } | undefined;
        samples.push({ role: base?.name ? `Kaji (${base.name})` : 'Kaji', durationMs: p.transferMs });
      }
    }
    return computeRoleTimingStats(samples);
  }
  /** Sorties closed after `since`, counted by status, with the latest five failures (for the brief, B-006). */
  closedSince(since: string): {
    done: number;
    failed: number;
    failures: { id: string; title: string; closed: string }[];
  } {
    if (typeof since !== 'string' || !Number.isFinite(Date.parse(since))) throw new Error('Invalid date.');
    const at = new Date(since).toISOString();
    const n = (status: string) =>
      (
        this.host.db.prepare('SELECT count(*) AS n FROM sorties WHERE closed>? AND status=?').get(at, status) as {
          n: number;
        }
      ).n;
    const failures = this.host.db
      .prepare("SELECT id,title,closed FROM sorties WHERE closed>? AND status='failed' ORDER BY closed DESC LIMIT 5")
      .all(at) as { id: string; title: string; closed: string }[];
    return { done: n('done'), failed: n('failed'), failures };
  }
  /** A sortie by the short ID shown to the owner (a hex prefix of its ID), with what a "why" answer needs (B-004). */
  explain(
    ref: string,
  ):
    | { found: 'none' }
    | { found: 'many'; count: number; candidates: { shortId: string; title: string; status: string }[] }
    | { found: 'one'; record: WhyRecord } {
    if (typeof ref !== 'string' || !/^[0-9a-f]{4,36}$/.test(ref)) throw new Error('Invalid sortie reference.');
    const rows = this.host.db
      .prepare('SELECT id,title,status FROM sorties WHERE id LIKE ? ORDER BY created DESC LIMIT 6')
      .all(ref + '%') as { id: string; title: string; status: string }[];
    if (!rows.length) return { found: 'none' };
    if (rows.length > 1) {
      const hexes = rows.map((r) => r.id.replace(/-/g, ''));
      let len = Math.max(8, ref.replace(/-/g, '').length + 1);
      while (len < 12 && new Set(hexes.map((h) => h.slice(0, len))).size < hexes.length) len++;
      return {
        found: 'many',
        count: rows.length,
        candidates: rows.map((r, i) => ({
          shortId: 'S-' + hexes[i]!.slice(0, len).toUpperCase(),
          title: r.title,
          status: r.status,
        })),
      };
    }
    const s = this.sortie(rows[0]!.id)!;
    const consult = this.host.db
      .prepare("SELECT payload FROM events WHERE sortie_id=? AND kind='misato.consult' ORDER BY sequence LIMIT 1")
      .get(s.id) as { payload: string } | undefined;
    const advice = consult
      ? (JSON.parse(consult.payload) as { advice?: string; model?: string; pilot?: { name?: string } })
      : undefined;
    const actions = s.detail.map((d) => {
      const ap = this.host.db.prepare('SELECT decision,decided,source FROM approvals WHERE action_id=?').get(d.id) as
        { decision: string | null; decided: string | null; source: string | null } | undefined;
      const done = this.host.db
        .prepare(
          "SELECT kind,payload FROM events WHERE action_id=? AND kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1",
        )
        .get(d.id) as { kind: string; payload: string } | undefined;
      const late = (
        this.host.db
          .prepare("SELECT payload FROM events WHERE action_id=? AND kind='ballot.shadow' ORDER BY sequence")
          .all(d.id) as { payload: string }[]
      ).map((r) => {
        const p = JSON.parse(r.payload) as { seat: string; vote: string; reason: string };
        return { seat: 'extra:' + p.seat, vote: p.vote, reason: p.reason, shadow: true };
      });
      return {
        tool: d.tool,
        pattern: d.ballot.pattern,
        outcome: d.ballot.outcome,
        reason: d.ballot.reason,
        verdicts: [
          ...d.ballot.verdicts.map((v) => ({
            seat: v.seat,
            vote: v.vote,
            reason: v.reason,
            ...(v.shadow ? { shadow: true } : {}),
          })),
          ...late,
        ],
        decision: ap?.decision ?? null,
        decided: ap?.decided ?? null,
        source: ap?.source ?? null,
        ran:
          done?.kind === 'action.done'
            ? ('done' as const)
            : done?.kind === 'action.failed'
              ? ('failed' as const)
              : null,
        ...(done?.kind === 'action.failed' ? { error: (JSON.parse(done.payload) as { error?: string }).error } : {}),
      };
    });
    const remote = this.host.remoteResults(s.id);
    const timings = this.collectTimings(s.id);
    return {
      found: 'one',
      record: {
        id: s.id,
        title: s.title,
        status: s.status,
        why: s.why,
        ...(remote.length ? { remote } : {}),
        ...(timings.length ? { timings } : {}),
        ...(advice?.advice
          ? { advice: { text: advice.advice, model: [advice.pilot?.name, advice.model].filter(Boolean).join(' · ') } }
          : {}),
        actions,
      },
    };
  }
}
