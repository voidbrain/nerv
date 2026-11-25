import { LedgerQueries } from './ledger-queries.ts';
import { LedgerApprovals } from './ledger-approvals.ts';
import { transaction } from './sqlite-transaction.ts';
import { overlappingDomains } from './pilots.ts';
import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  ballot,
  canLeaveMachine,
  defaultPolicy,
  patternOf,
  intentChecked,
  validatePolicy,
  type Ballot,
  type Pattern,
  type Policy,
  type Stage,
  type Tool,
  type Trust,
  type Verdict,
} from './policy.ts';
import type { Step } from './misato.ts';
import { type RoleTimingStats, type SortieTiming } from './timing.ts';
import {
  EVENT_SCHEMA_VERSION,
  encodePayload,
  readPayload,
  type EvaInstanceRef,
  type EventKind,
  type EventPayloads,
  type SortieEvent,
} from './events.ts';
/** Central Dogma (F-024): sorties, actions, grants (A.T. Fields), approvals (Misato's apartment) and append-only events. */
export const LEDGER_SCHEMA = `
 CREATE TABLE IF NOT EXISTS sorties(id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL, trust TEXT NOT NULL, status TEXT NOT NULL, rejects INTEGER NOT NULL DEFAULT 0, spent REAL NOT NULL DEFAULT 0, created TEXT NOT NULL, closed TEXT);
 CREATE TABLE IF NOT EXISTS sortie_controls(sortie_id TEXT PRIMARY KEY REFERENCES sorties(id), stage TEXT NOT NULL, max_actions INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, sortie_id TEXT NOT NULL REFERENCES sorties(id), tool TEXT NOT NULL, args TEXT NOT NULL, ballot TEXT NOT NULL, created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, action_id TEXT NOT NULL UNIQUE REFERENCES actions(id), tool TEXT NOT NULL, args_hash TEXT NOT NULL, expires TEXT NOT NULL, used TEXT, revoked TEXT);
 CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, action_id TEXT NOT NULL UNIQUE REFERENCES actions(id), card TEXT NOT NULL, expires TEXT NOT NULL, decision TEXT, decided TEXT, source TEXT);
 CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, sortie_id TEXT NOT NULL, action_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 1);
 CREATE INDEX IF NOT EXISTS events_sortie ON events(sortie_id, sequence);
 CREATE INDEX IF NOT EXISTS approvals_pending ON approvals(expires) WHERE decision IS NULL;
 CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
 CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;`;
export interface Proposal {
  tool: string;
  args: Record<string, unknown>;
  stage: Stage;
  cost?: number;
  casper?: Verdict;
  extras?: Verdict[];
}
export interface Card {
  sortieId: string;
  actionId: string;
  tool: string;
  args: Record<string, unknown>;
  effect: string;
  pattern: string;
  sync: Ballot['sync'];
  verdicts: Verdict[];
  reason: string;
  expires: string;
}
export interface Approval {
  notify?: false;
  id: string;
  card: Card;
  expires: string;
  decision: string | null;
}
export interface SortieSummary {
  id: string;
  source: string;
  title: string;
  trust: string;
  status: string;
  created: string;
  closed: string | null;
  actions: number;
  waiting: number;
  patterns: string[];
  why: string;
  question?: { text: string; expires: string };
}
export interface ActionDetail {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  ballot: Ballot;
  created: string;
  status: 'proposed' | 'waiting' | 'done' | 'failed' | 'rejected' | 'stood-down';
  durationMs?: number;
  evaInstance?: EvaInstanceRef;
}
export interface Proposed {
  actionId: string;
  ballot: Ballot;
  grantId?: string;
  approvalId?: string;
}
export type Decision = 'approve' | 'reject' | 'edit';
/** Bounded so a page of approval cards fits one IPC frame (rpc.ts MAX_FRAME_BYTES). */
const MAX_ARGS_BYTES = 8192;
/** A verdict reason is shown to the owner, not scored: long model text is cut so the ballot event stays bounded. */
const MAX_REASON_CHARS = 500;
/** Payload bytes per event page, so a page fits one IPC frame (rpc.ts MAX_FRAME_BYTES) with room for the envelope. */
const EVENT_PAGE_BYTES = 32_768;
const clampVerdict = (v: Verdict | undefined) =>
  v && typeof v.reason === 'string' ? { ...v, reason: v.reason.slice(0, MAX_REASON_CHARS) } : v;
/** Key order never changes the hash, so a grant binds the exact arguments that were reviewed. */
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k]))
          .join(',')}}`
      : JSON.stringify(v);
export const argsHash = (args: Record<string, unknown>) => createHash('sha256').update(canonical(args)).digest('hex');
const iso = (now: Date, plus = 0) => new Date(now.getTime() + plus).toISOString();
export class Ledger {
  readonly db: DatabaseSync;
  readonly tools: ReadonlyMap<string, Tool>;
  readonly policy: Policy;
  readonly grantTtlMs: number;
  readonly approvalTtlMs: number;
  /** Granted MCP tools (F-021), refreshed from config by the scheduler before each preview and action. */
  private external = new Map<string, Tool>();
  setExternal(tools: Tool[]): void {
    this.external = new Map(tools.map((t) => [t.name, t]));
  }
  isExternal(tool: string): boolean {
    return this.external.has(tool) && !this.tools.has(tool);
  }
  constructor(
    db: DatabaseSync,
    options: { tools?: Tool[]; policy?: Policy; grantTtlMs?: number; approvalTtlMs?: number } = {},
  ) {
    this.db = db;
    this.tools = new Map((options.tools ?? []).map((t) => [t.name, t]));
    this.policy = validatePolicy(options.policy ?? defaultPolicy);
    this.upgradeProvenance();
    this.grantTtlMs = options.grantTtlMs ?? 60_000;
    this.approvalTtlMs = options.approvalTtlMs ?? 3_600_000;
  }
  /** Existing unlabelled planner context cannot be retrospectively certified as owner-only. */
  private upgradeProvenance(): void {
    this.tx(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS provenance_migrations(id TEXT PRIMARY KEY)');
      if (this.db.prepare("SELECT 1 FROM provenance_migrations WHERE id='context-v1'").get()) return;
      const rows = this.db
        .prepare("SELECT id FROM sorties WHERE source NOT IN ('owner') AND trust='trusted'")
        .all() as { id: string }[];
      for (const { id } of rows) {
        this.db.prepare("UPDATE sorties SET trust='tainted' WHERE id=?").run(id);
        this.event(id, null, 'context.intake', { source: 'legacy:unlabelled-context', trust: 'tainted' }, new Date());
      }
      this.db.exec("INSERT INTO provenance_migrations VALUES('context-v1')");
    });
  }
  private event<K extends EventKind>(
    sortieId: string,
    actionId: string | null,
    kind: K,
    payload: EventPayloads[K],
    now: Date,
  ) {
    this.db
      .prepare('INSERT INTO events(sortie_id,action_id,kind,payload,created,v) VALUES(?,?,?,?,?,?)')
      .run(sortieId, actionId, kind, encodePayload(kind, payload), iso(now), EVENT_SCHEMA_VERSION);
  }
  private tx<T>(work: () => T): T {
    return transaction(this.db, work);
  }
  private issue(actionId: string, tool: string, args: Record<string, unknown>, sortieId: string, now: Date): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO grants VALUES(?,?,?,?,?,NULL,NULL)')
      .run(id, actionId, tool, argsHash(args), iso(now, this.grantTtlMs));
    this.event(sortieId, actionId, 'grant.issued', { expires: iso(now, this.grantTtlMs) }, now);
    return id;
  }
  openSortie(source: string, title: string, trust: Trust, now = new Date()): string {
    if (
      typeof source !== 'string' ||
      !source ||
      source.length > 100 ||
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 500 ||
      (trust !== 'trusted' && trust !== 'tainted')
    )
      throw new Error('Invalid sortie.');
    // Avoid four-character short-ID collisions with existing sorties when possible (B-061).
    let id = randomUUID();
    const exists = this.db.prepare('SELECT 1 FROM sorties WHERE id LIKE ? LIMIT 1');
    for (let i = 0; i < 16 && exists.get(id.slice(0, 4) + '%'); i++) id = randomUUID();
    return this.tx(() => {
      this.db
        .prepare('INSERT INTO sorties(id,source,title,trust,status,created) VALUES(?,?,?,?,?,?)')
        .run(id, source, title.trim(), trust, 'open', iso(now));
      this.event(id, null, 'sortie.opened', { source, title: title.trim(), trust }, now);
      return id;
    });
  }
  /** Scheduler-owned proactive limits are frozen at admission, outside planner arguments. */
  openProactive(
    trigger: string,
    slot: string,
    title: string,
    controls: { stage: Stage; maxActions: number },
    now = new Date(),
  ): string {
    if (
      !/^[a-z][a-z0-9-]{1,30}$/.test(trigger) ||
      typeof slot !== 'string' ||
      !slot ||
      slot.length > 100 ||
      !['prototype', 'test', 'production'].includes(controls.stage) ||
      !Number.isInteger(controls.maxActions) ||
      controls.maxActions < 1 ||
      controls.maxActions > 6
    )
      throw new Error('Invalid proactive controls.');
    return this.tx(() => {
      const id = this.openSortie('hyuga', title, 'trusted', now);
      this.db.prepare('INSERT INTO sortie_controls VALUES(?,?,?)').run(id, controls.stage, controls.maxActions);
      this.event(id, null, 'sortie.proactive', { trigger, slot, ...controls }, now);
      return id;
    });
  }
  /** Naoko: persist source labels and only increase Ireul taint. Content never chooses its own trust. */
  intake(sortieId: string, source: string, trust: Trust, now = new Date()): void {
    if (
      typeof source !== 'string' ||
      !source.trim() ||
      source.length > 100 ||
      (trust !== 'trusted' && trust !== 'tainted')
    )
      throw new Error('Invalid context source.');
    this.tx(() => {
      const s = this.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieId) as
        { status: string } | undefined;
      if (s?.status !== 'open') throw new Error('Sortie is not open.');
      if (trust === 'tainted') this.db.prepare("UPDATE sorties SET trust='tainted' WHERE id=?").run(sortieId);
      this.event(sortieId, null, 'context.intake', { source, trust }, now);
    });
  }
  /**
   * F-021-T04: outside content that reached a sortie after it may have closed (another base's MCP result): the sortie is
   * marked tainted and the intake recorded, whatever its status, so later context that cites it is not trusted.
   */
  taintLate(sortieId: string, source: string, now = new Date()): void {
    if (typeof source !== 'string' || !source.trim() || source.length > 100) throw new Error('Invalid context source.');
    this.tx(() => {
      if (!this.db.prepare("UPDATE sorties SET trust='tainted' WHERE id=?").run(sortieId).changes) return;
      this.event(sortieId, null, 'context.intake', { source, trust: 'tainted' }, now);
    });
  }
  trust(sortieId: string): Trust {
    const s = this.db.prepare('SELECT trust FROM sorties WHERE id=?').get(sortieId) as { trust: Trust } | undefined;
    if (!s) throw new Error('No sortie with that ID.');
    return s.trust;
  }
  /** Every agent action passes here. A reject goes back to the planner; after maxRejects it escalates to the owner. */
  propose(sortieId: string, p: Proposal, now = new Date(), approvalUntil?: number): Proposed {
    if (
      !p ||
      typeof p.tool !== 'string' ||
      !p.tool ||
      p.tool.length > 100 ||
      !p.args ||
      typeof p.args !== 'object' ||
      Array.isArray(p.args) ||
      Buffer.byteLength(JSON.stringify(p.args)) > MAX_ARGS_BYTES
    )
      throw new Error('Invalid action.');
    return this.tx(() => {
      const sortie = this.db.prepare('SELECT * FROM sorties WHERE id=?').get(sortieId) as
        { trust: Trust; status: string; rejects: number; spent: number } | undefined;
      if (!sortie || sortie.status !== 'open') throw new Error('Sortie is not open.');
      const controls = this.db
        .prepare('SELECT stage,max_actions FROM sortie_controls WHERE sortie_id=?')
        .get(sortieId) as { stage: Stage; max_actions: number } | undefined;
      const stages: Stage[] = ['prototype', 'test', 'production'];
      const stage = controls && stages.indexOf(controls.stage) < stages.indexOf(p.stage) ? controls.stage : p.stage;
      const result = ballot(
        {
          tool: p.tool,
          args: p.args,
          trust: sortie.trust,
          stage,
          cost: p.cost ?? 0,
          ...(controls ? { proactive: true } : {}),
        },
        this.tools.get(p.tool) ?? this.external.get(p.tool),
        this.policy,
        sortie.spent,
        clampVerdict(p.casper),
        p.extras?.map((v) => clampVerdict(v)!),
      );
      if (controls) {
        const reserved = (
          this.db
            .prepare(
              "SELECT count(*) AS n FROM actions WHERE sortie_id=? AND json_extract(ballot,'$.outcome') IN ('grant','approval')",
            )
            .get(sortieId) as { n: number }
        ).n;
        if (reserved >= controls.max_actions) {
          result.verdicts.push({ seat: 'balthasar', vote: 'reject', reason: 'Proactive action budget exhausted.' });
          Object.assign(result, { outcome: 'reject', blocked: 'budget', reason: 'Proactive action budget exhausted.' });
        }
      }
      if (result.outcome === 'reject' && !result.blocked && sortie.rejects + 1 > this.policy.maxRejects)
        Object.assign(result, {
          outcome: 'approval',
          reason: `Reject limit reached (${result.reason}); the owner decides.`,
        });
      const actionId = randomUUID();
      this.db
        .prepare('INSERT INTO actions VALUES(?,?,?,?,?,?)')
        .run(actionId, sortieId, p.tool, JSON.stringify(p.args), JSON.stringify(result), iso(now));
      this.event(sortieId, actionId, 'ballot', result, now);
      if (result.outcome === 'reject') {
        this.db.prepare('UPDATE sorties SET rejects=rejects+1 WHERE id=?').run(sortieId);
        return { actionId, ballot: result };
      }
      this.db.prepare('UPDATE sorties SET spent=spent+? WHERE id=?').run(p.cost ?? 0, sortieId);
      if (result.outcome === 'grant')
        return { actionId, ballot: result, grantId: this.issue(actionId, p.tool, p.args, sortieId, now) };
      const approvalId = randomUUID();
      const card: Card = {
        sortieId,
        actionId,
        tool: p.tool,
        args: p.args,
        effect: result.effect,
        pattern: result.pattern,
        sync: result.sync,
        verdicts: result.verdicts,
        reason: result.reason,
        expires: new Date(
          Math.min(now.getTime() + this.approvalTtlMs, approvalUntil ?? Number.MAX_SAFE_INTEGER),
        ).toISOString(),
      };
      this.db
        .prepare('INSERT INTO approvals VALUES(?,?,?,?,NULL,NULL,NULL)')
        .run(approvalId, actionId, JSON.stringify(card), card.expires);
      this.event(
        sortieId,
        actionId,
        'approval.requested',
        { approvalId, expires: card.expires, reason: result.reason },
        now,
      );
      return { actionId, ballot: result, approvalId };
    });
  }
  /** The Pattern a proposal would get, without recording anything: the coordinator asks Casper only when it is not Green. */
  preview(
    sortieId: string,
    tool: string,
  ): { pattern: Pattern; effect: Ballot['effect']; intent: boolean; trust: Trust; cloudAllowed: boolean } {
    const sortie = this.db.prepare('SELECT trust,status FROM sorties WHERE id=?').get(sortieId) as
      { trust: Trust; status: string } | undefined;
    if (!sortie || sortie.status !== 'open') throw new Error('Sortie is not open.');
    const t = this.tools.get(tool) ?? this.external.get(tool);
    const effect = t?.effect ?? 'irreversible';
    const pattern = patternOf(effect, sortie.trust, tool, this.policy, t?.owner === true);
    return {
      pattern,
      effect,
      intent: intentChecked(pattern, t),
      trust: sortie.trust,
      cloudAllowed: canLeaveMachine({ tool, effect, trust: sortie.trust }, this.policy),
    };
  }
  /** The reviewed action behind a grant, and whether the grant is still unused. Grant IDs stay inside this process. */
  grantAction(
    grantId: string,
  ): { sortieId: string; actionId: string; tool: string; args: Record<string, unknown>; used: boolean } | undefined {
    const row = this.db
      .prepare(
        'SELECT x.sortie_id,x.id,x.tool,x.args,g.used FROM grants g JOIN actions x ON x.id=g.action_id WHERE g.id=?',
      )
      .get(grantId) as { sortie_id: string; id: string; tool: string; args: string; used: string | null } | undefined;
    return (
      row && {
        sortieId: row.sortie_id,
        actionId: row.id,
        tool: row.tool,
        args: JSON.parse(row.args) as Record<string, unknown>,
        used: row.used !== null,
      }
    );
  }
  /** Misato's loop state, kept in the ledger so a resume after the owner's decision needs no coordinator memory (F-033). */
  note<
    K extends
      | 'misato.request'
      | 'misato.step'
      | 'misato.waiting'
      | 'misato.consult'
      | 'pilot.unmatched'
      | 'kaji.forwarded'
      | 'kaji.answered',
  >(sortieId: string, kind: K, payload: EventPayloads[K], now = new Date()): void {
    this.tx(() => this.event(sortieId, null, kind, payload, now));
  }
  /** Pending clarification in one conversation; expiry never becomes an answer. */
  question(
    conversation: string,
    now = new Date(),
  ): {
    sortieId: string;
    sequence: number;
    text: string;
    expires: string;
    forwarded?: { id: string; name: string };
  } | null {
    if (
      typeof conversation !== 'string' ||
      !/^[a-z]+(:[a-z0-9-]{1,30})?$/.test(conversation) ||
      conversation.length > 40
    )
      throw new Error('Invalid conversation.');
    const row = this.db
      .prepare(
        `SELECT e.sortie_id,e.sequence,e.payload FROM events e JOIN sorties s ON s.id=e.sortie_id
   WHERE s.status='open' AND e.kind='misato.asked' AND json_extract(e.payload,'$.conversation')=? AND json_extract(e.payload,'$.expires')>?
   AND NOT EXISTS (SELECT 1 FROM events a WHERE a.sortie_id=e.sortie_id AND a.sequence>e.sequence AND a.kind IN ('misato.answered','misato.asked'))
   ORDER BY e.sequence DESC LIMIT 1`,
      )
      .get(conversation, iso(now)) as { sortie_id: string; sequence: number; payload: string } | undefined;
    if (!row) return null;
    const p = JSON.parse(row.payload) as EventPayloads['misato.asked'];
    return {
      sortieId: row.sortie_id,
      sequence: row.sequence,
      text: p.text,
      expires: p.expires,
      ...(p.forwarded ? { forwarded: p.forwarded } : {}),
    };
  }
  ask(
    sortieId: string,
    text: string,
    conversation: string,
    forwarded?: { id: string; name: string },
    now = new Date(),
    durationMs?: number,
  ): { text: string; expires: string } {
    return this.tx(() => {
      if (this.question(conversation, now)) throw new Error('A clarification already waits in this conversation.');
      const s = this.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieId) as
        { status: string } | undefined;
      if (s?.status !== 'open' || !text.trim() || text.length > 4000) throw new Error('Invalid clarification.');
      const expires = iso(now, 86_400_000);
      this.event(
        sortieId,
        null,
        'misato.asked',
        {
          text,
          conversation,
          expires,
          ...(forwarded ? { forwarded } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        },
        now,
      );
      return { text, expires };
    });
  }
  answer(conversation: string, sequence: number, text: string, now = new Date()): { sortieId: string } | null {
    return this.tx(() => {
      const q = this.question(conversation, now);
      if (!q || q.sequence !== sequence) return null;
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Invalid answer.');
      this.event(q.sortieId, null, 'misato.answered', { text, questionSequence: q.sequence }, now);
      return { sortieId: q.sortieId };
    });
  }
  private exchange(
    sortieId: string,
    requestPayload: string,
  ): { request: string; reply?: string; actions?: string[]; source?: string; tainted?: boolean } {
    const reply = this.db
      .prepare("SELECT payload FROM events WHERE sortie_id=? AND kind='misato.reply' ORDER BY sequence DESC LIMIT 1")
      .get(sortieId) as { payload: string } | undefined;
    const ran = (
      this.db
        .prepare("SELECT payload FROM events WHERE sortie_id=? AND kind='action.done' ORDER BY sequence")
        .all(sortieId) as { payload: string }[]
    ).map((e) => {
      const p = JSON.parse(e.payload) as { tool: string; result: unknown };
      return `${p.tool} → ${JSON.stringify(p.result).slice(0, 300)}`;
    });
    return {
      source: sortieId,
      tainted: this.trust(sortieId) === 'tainted',
      request: (JSON.parse(requestPayload) as { text: string }).text,
      ...(reply ? { reply: (JSON.parse(reply.payload) as { text: string }).text } : {}),
      ...(ran.length ? { actions: ran } : {}),
    };
  }
  /** The last exchanges of one conversation within `withinMs`, oldest first: request, Misato's reply and the actions that ran. */
  conversation(
    key: string,
    withinMs = 30 * 60_000,
    limit = 3,
    now = new Date(),
  ): { request: string; reply?: string; actions?: string[]; source?: string; tainted?: boolean }[] {
    if (typeof key !== 'string' || !/^[a-z]+(:[a-z0-9-]{1,30})?$/.test(key) || key.length > 40)
      throw new Error('Invalid conversation.');
    const rows = this.db
      .prepare(
        "SELECT sortie_id,payload FROM events WHERE kind='misato.request' AND json_extract(payload,'$.conversation')=? AND created>? ORDER BY sequence DESC LIMIT ?",
      )
      .all(key, iso(now, -withinMs), limit) as { sortie_id: string; payload: string }[];
    return rows.reverse().map((r) => this.exchange(r.sortie_id, r.payload));
  }
  /** When the owner last asked Misato anything, for Instrumentality's idle mode. */
  lastRequestAt(): string | null {
    return (
      this.db.prepare("SELECT max(created) AS t FROM events WHERE kind='misato.request'").get() as { t: string | null }
    ).t;
  }
  /** Every exchange with Misato in [since, until), oldest first, across conversations: Instrumentality's input. */
  exchangesBetween(
    since: string,
    until: string,
    limit = 200,
  ): { request: string; reply?: string; actions?: string[]; source?: string; tainted?: boolean }[] {
    const rows = this.db
      .prepare(
        "SELECT sortie_id,payload FROM events WHERE kind='misato.request' AND sortie_id NOT IN (SELECT id FROM sorties WHERE source='hyuga') AND created>=? AND created<? ORDER BY sequence LIMIT ?",
      )
      .all(since, until, limit) as { sortie_id: string; payload: string }[];
    return rows.map((r) => this.exchange(r.sortie_id, r.payload));
  }
  /** Open Misato sorties whose latest wait is over: every approval it waited for is decided, and no resume has claimed it. */
  resumable(): string[] {
    return (
      this.db
        .prepare(
          `SELECT s.id FROM sorties s WHERE s.source IN ('misato','hyuga') AND s.status='open'
   AND NOT EXISTS (SELECT 1 FROM events q WHERE q.sortie_id=s.id AND q.kind='misato.asked' AND q.sequence>coalesce((SELECT max(sequence) FROM events a WHERE a.sortie_id=s.id AND a.kind='misato.answered'),0))
   AND (SELECT max(sequence) FROM events WHERE sortie_id=s.id AND kind='misato.waiting') > coalesce((SELECT max(sequence) FROM events WHERE sortie_id=s.id AND kind='misato.resumed'),0)
   AND NOT EXISTS (SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=s.id AND a.decision IS NULL)
   ORDER BY s.created LIMIT 20`,
        )
        .all() as { id: string }[]
    ).map((r) => r.id);
  }
  /**
   * B-013: Misato sorties opened before `before` (by an earlier run of the service) that are still open and wait for
   * nothing: no approval pending and no unanswered wait. Their work was cut off by a restart; nobody would ever finish them.
   */
  interrupted(before: string): { id: string; title: string; ran: string[] }[] {
    if (typeof before !== 'string' || !Number.isFinite(Date.parse(before))) throw new Error('Invalid date.');
    const rows = this.db
      .prepare(
        `SELECT s.id,s.title FROM sorties s WHERE s.source='misato' AND s.status='open' AND s.created<?
   AND NOT EXISTS (SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=s.id AND a.decision IS NULL)
   AND NOT EXISTS (SELECT 1 FROM events q WHERE q.sortie_id=s.id AND q.kind='misato.asked' AND q.sequence>coalesce((SELECT max(sequence) FROM events a WHERE a.sortie_id=s.id AND a.kind='misato.answered'),0))
   AND coalesce((SELECT max(sequence) FROM events WHERE sortie_id=s.id AND kind='misato.waiting'),0) <= coalesce((SELECT max(sequence) FROM events WHERE sortie_id=s.id AND kind='misato.resumed'),0)
   ORDER BY s.created LIMIT 20`,
      )
      .all(new Date(before).toISOString()) as { id: string; title: string }[];
    return rows.map((r) => ({
      ...r,
      ran: (
        this.db
          .prepare("SELECT payload FROM events WHERE sortie_id=? AND kind='action.done' ORDER BY sequence")
          .all(r.id) as { payload: string }[]
      ).map((e) => (JSON.parse(e.payload) as { tool: string }).tool),
    }));
  }
  /** Closes one interrupted sortie as failed, with the reply the owner gets; false if it was not open any more. */
  closeInterrupted(sortieId: string, reply: string, now = new Date()): boolean {
    // One transaction: the reply and the close (close() opens its own, which cannot nest).
    return this.tx(() => {
      const changed =
        Number(
          this.db
            .prepare("UPDATE sorties SET status='failed',closed=? WHERE id=? AND status='open'")
            .run(iso(now), sortieId).changes,
        ) > 0;
      if (!changed) return false;
      this.event(sortieId, null, 'misato.reply', { text: reply.slice(0, 4000) }, now);
      this.event(sortieId, null, 'sortie.failed', {}, now);
      return true;
    });
  }
  /** Claims one resume, once: records misato.resumed and returns the request, the steps so far and what became of each awaited approval. */
  claimResume(
    sortieId: string,
    now = new Date(),
  ): {
    request: string;
    steps: { step: Step; actionId?: string }[];
    decisions: {
      actionId: string;
      tool: string;
      args: Record<string, unknown>;
      decision: string;
      result?: unknown;
      error?: string;
    }[];
  } | null {
    return this.tx(() => {
      if (!this.resumable().includes(sortieId)) return null;
      const read = (kind: string) =>
        (
          this.db
            .prepare('SELECT payload FROM events WHERE sortie_id=? AND kind=? ORDER BY sequence')
            .all(sortieId, kind) as { payload: string }[]
        ).map((r) => JSON.parse(r.payload) as unknown);
      const request =
        (read('misato.request').at(-1) as { text: string } | undefined)?.text ??
        (this.db.prepare('SELECT title FROM sorties WHERE id=?').get(sortieId) as { title: string }).title;
      const ids = (read('misato.waiting').at(-1) as { approvalIds: string[] }).approvalIds;
      const decisions = ids.flatMap((id) => {
        const row = this.db
          .prepare(
            'SELECT a.decision,x.id AS action_id,x.tool,x.args FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?',
          )
          .get(id) as { decision: string; action_id: string; tool: string; args: string } | undefined;
        if (!row) return [];
        const done = this.db
          .prepare(
            "SELECT kind,payload FROM events WHERE action_id=? AND kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1",
          )
          .get(row.action_id) as { kind: string; payload: string } | undefined;
        const outcome = done ? (JSON.parse(done.payload) as { result?: unknown; error?: string }) : {};
        return [
          {
            actionId: row.action_id,
            tool: row.tool,
            args: JSON.parse(row.args) as Record<string, unknown>,
            decision: row.decision,
            ...(done?.kind === 'action.done' ? { result: outcome.result } : {}),
            ...(done?.kind === 'action.failed' ? { error: outcome.error } : {}),
          },
        ];
      });
      this.event(sortieId, null, 'misato.resumed', {}, now);
      return { request, steps: read('misato.step') as { step: Step; actionId?: string }[], decisions };
    });
  }
  private _queries?: LedgerQueries;
  private get queries(): LedgerQueries {
    return (this._queries ??= new LedgerQueries({
      db: this.db,
      events: (sortieId, after, limit) => this.events(sortieId, after, limit),
      remoteResults: (sortieId) => this.remoteResults(sortieId),
    }));
  }
  sorties(limit = 20, before?: string, q?: string): SortieSummary[] {
    return this.queries.sorties(limit, before, q);
  }
  sortie(id: string): (SortieSummary & { detail: ActionDetail[]; timings?: SortieTiming[] }) | undefined {
    return this.queries.sortie(id);
  }
  timingSummary(since: string): RoleTimingStats[] {
    return this.queries.timingSummary(since);
  }
  closedSince(since: string) {
    return this.queries.closedSince(since);
  }
  explain(query: string) {
    return this.queries.explain(query);
  }
  /** F-052: a shadow seat's late vote, kept with its action; the action must belong to the sortie. */
  shadowVote(sortieId: string, actionId: string, payload: EventPayloads['ballot.shadow'], now = new Date()): void {
    if (!this.db.prepare('SELECT 1 FROM actions WHERE id=? AND sortie_id=?').get(actionId, sortieId))
      throw new Error('Unknown action.');
    this.tx(() => this.event(sortieId, actionId, 'ballot.shadow', payload, now));
  }
  /** B-011: another base's outcome for an action this sortie sent it, kept with the sortie (also after it closed). */
  remoteResult(sortieId: string, payload: EventPayloads['kaji.result'], now = new Date()): void {
    this.tx(() => this.event(sortieId, null, 'kaji.result', payload, now));
  }
  /** B-094: the plain-words results other bases sent for this sortie, oldest first (at most five). */
  remoteResults(sortieId: string): string[] {
    return (
      this.db
        .prepare("SELECT payload FROM events WHERE sortie_id=? AND kind='kaji.result' ORDER BY sequence LIMIT 5")
        .all(sortieId) as { payload: string }[]
    ).map((r) => (JSON.parse(r.payload) as { text: string }).text);
  }
  /** F-049-T13: an EVA-03 job event on its sortie, appended and never erased. */
  evaJob(
    sortieId: string,
    kind:
      | 'eva03.started'
      | 'eva03.completed'
      | 'eva03.failed'
      | 'eva03.timed_out'
      | 'eva03.cancelled'
      | 'eva03.recovered'
      | 'eva03.reconciled',
    payload: EventPayloads['eva03.started'],
    now = new Date(),
  ): void {
    this.tx(() => this.event(sortieId, null, kind, payload, now));
  }
  /** F-045: requests since `since` that no pilot fitted, for one domain, and the state of a pilots.create proposal for it. */
  unmatched(
    domain: string,
    since: string,
  ): { count: number; sorties: { id: string; title: string }[]; proposal: 'pending' | 'declined' | null } {
    if (typeof domain !== 'string' || !domain || domain.length > 40 || !Number.isFinite(Date.parse(since)))
      throw new Error('Invalid domain query.');
    const at = new Date(since).toISOString();
    const rows = (
      this.db
        .prepare(
          "SELECT DISTINCT s.id,s.title,json_extract(e.payload,'$.domain') AS domain FROM events e JOIN sorties s ON s.id=e.sortie_id WHERE e.kind='pilot.unmatched' AND e.created>? ORDER BY e.sequence DESC",
        )
        .all(at) as { id: string; title: string; domain: string }[]
    ).filter((r) => overlappingDomains(domain, r.domain));
    const proposals = (
      this.db
        .prepare(
          "SELECT a.decision,a.expires,a.decided,json_extract(x.args,'$.domain') AS domain FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.tool='pilots.create' AND (a.decision IS NULL OR a.decided>?) ORDER BY x.created DESC",
        )
        .all(at) as { decision: string | null; expires: string; decided: string | null; domain: string }[]
    ).filter((p) => overlappingDomains(domain, p.domain));
    const proposal = proposals.some((p) => p.decision === null && p.expires > iso(new Date()))
      ? 'pending'
      : proposals.some((p) => p.decision && p.decision !== 'approve' && (p.decided ?? '') > at)
        ? 'declined'
        : null;
    return { count: rows.length, sorties: rows.slice(0, 5).map(({ id, title }) => ({ id, title })), proposal };
  }
  /** Misato's reply to the owner, kept with the sortie it answers. */
  reply(sortieId: string, text: string, now = new Date(), durationMs?: number): void {
    this.tx(() =>
      this.event(
        sortieId,
        null,
        'misato.reply',
        { text: text.slice(0, 4000), ...(durationMs !== undefined ? { durationMs } : {}) },
        now,
      ),
    );
  }
  /** Records what an executor did after `authorize` let it run. */
  finished(
    sortieId: string,
    actionId: string,
    tool: string,
    outcome: { result: unknown } | { error: string },
    now = new Date(),
    durationMs?: number,
    evaInstance?: EvaInstanceRef,
  ): void {
    this.tx(() => {
      if ('error' in outcome)
        this.event(
          sortieId,
          actionId,
          'action.failed',
          {
            tool,
            error: outcome.error.slice(0, 500),
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(evaInstance ? { evaInstance } : {}),
          },
          now,
        );
      else
        this.event(
          sortieId,
          actionId,
          'action.done',
          {
            tool,
            result: outcome.result,
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(evaInstance ? { evaInstance } : {}),
          },
          now,
        );
    });
  }
  private _approvals?: LedgerApprovals;
  private get approvals(): LedgerApprovals {
    return (this._approvals ??= new LedgerApprovals({
      db: this.db,
      tools: this.tools,
      grantTtlMs: this.grantTtlMs,
      tx: (fn) => this.tx(fn),
      event: (sortieId, actionId, kind, payload, now) => this.event(sortieId, actionId, kind, payload, now),
      issue: (actionId, tool, args, sortieId, now) => this.issue(actionId, tool, args, sortieId, now),
    }));
  }
  pendingApprovals(now = new Date(), limit = 5): Approval[] {
    return this.approvals.pendingApprovals(now, limit);
  }
  waitingQuestions(now = new Date(), limit = 10): { sortieId: string; title: string; text: string; expires: string }[] {
    return this.approvals.waitingQuestions(now, limit);
  }
  pendingApprovalIds(ids: string[], now = new Date()): string[] {
    return this.approvals.pendingApprovalIds(ids, now);
  }
  decide(approvalId: string, decision: Decision, source: string, now = new Date()) {
    return this.approvals.decide(approvalId, decision, source, now);
  }
  expiredSince(since: string, limit = 20): { tool: string; sortieId: string; title: string; expired: string }[] {
    return this.approvals.expiredSince(since, limit);
  }
  expire(now = new Date()): number {
    return this.approvals.expire(now);
  }
  authorize(grantId: string, tool: string, args: Record<string, unknown>, now = new Date()): void {
    return this.approvals.authorize(grantId, tool, args, now);
  }
  spear(sortieId: string, reason: string, now = new Date()) {
    return this.approvals.spear(sortieId, reason, now);
  }
  close(sortieId: string, status: 'done' | 'failed', now = new Date()): boolean {
    return this.tx(() => {
      const changed =
        Number(
          this.db
            .prepare("UPDATE sorties SET status=?,closed=? WHERE id=? AND status='open'")
            .run(status, iso(now), sortieId).changes,
        ) > 0;
      if (changed) this.event(sortieId, null, `sortie.${status}`, {}, now);
      return changed;
    });
  }
  /** Events in order after `after`: at most `limit`, and fewer when their payloads would exceed one frame (always at least one). Page on with the last sequence. */
  events(sortieId: string, after = 0, limit = 50): SortieEvent[] {
    if (
      typeof sortieId !== 'string' ||
      !sortieId ||
      sortieId.length > 100 ||
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw new Error('Invalid event page.');
    const rows = this.db
      .prepare(
        'SELECT v,sequence,sortie_id AS sortieId,action_id AS actionId,kind,payload,created FROM events WHERE sortie_id=? AND sequence>? ORDER BY sequence LIMIT ?',
      )
      .all(sortieId, after, limit) as unknown as (Omit<SortieEvent, 'payload'> & { payload: string })[];
    const page: SortieEvent[] = [];
    let bytes = 0;
    for (const r of rows) {
      bytes += Buffer.byteLength(r.payload);
      if (page.length && bytes > EVENT_PAGE_BYTES) break;
      page.push({ ...r, payload: readPayload(r.kind, r.payload) } as SortieEvent);
    }
    return page;
  }
}
