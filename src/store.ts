import { Watch, watchQuiet, type WatchWork } from './watch.ts';
import { transaction } from './sqlite-transaction.ts';
import type { WorkerLease } from './worker-jobs.ts';
import { readConfig } from './config.ts';
import { UPGRADE_CONTRACT } from './upgrade-contract.ts';
import { WorkerJobs, WORKER_RESULT_BYTES, WORKER_LEASE_MS } from './worker-jobs.ts';
import { InstrumentalityRuns } from './instrumentality-runs.ts';
import { UsageStore } from './model-usage.ts';
import { checkHistory, historyPage, type HistoryPage } from './history.ts';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LEDGER_SCHEMA, Ledger, type Decision, type Proposal } from './ledger.ts';
import { builtinTools, execute, hasExecutor, type AgencyBaseSnapshot, type AgencySnapshot } from './executors.ts';
import { MEMORY_SCHEMA, Memory, type Episode } from './memory.ts';
import { Registry, REGISTRY_SCHEMA } from './kaji.ts';
import { MILESTONE_SCHEMA } from './milestones.ts';
import { defaultPolicy, type Ballot, type Policy } from './policy.ts';
import { generateVapidKeys, sendWebPush, formatReminderPushPayload, type PushSubscriptionRecord } from './push.ts';
import {
  DEFAULT_BRIEF_AT,
  formatInboxReminderMessage,
  localDayTimeToUtc,
  localParts,
  normalizeReminderKind,
  resolveReminderTime,
  type ReminderKind,
} from './reminder-time.ts';
export { REMINDER_KINDS, normalizeReminderKind, type ReminderKind } from './reminder-time.ts';
export type { PushSubscriptionRecord } from './push.ts';
export type Reminder = {
  id: string;
  title: string;
  due: string;
  kind: ReminderKind;
  end: string | null;
  created: string;
  delivered: string | null;
  cancelled: string | null;
};
export interface ReminderInput {
  kind?: ReminderKind | string | undefined;
  end?: string | null | undefined;
  timeZone?: string | undefined;
  briefAt?: string | undefined;
}
export interface InboxCheckpoint {
  sequence: number;
  id?: string;
}
export interface InboxEntry {
  sequence: number;
  id: string;
  message: string;
  created: string;
  kind: 'reminder' | 'brief' | 'approval';
  approval?: { id: string; expires: string; pending: boolean };
}
export interface InboxPage {
  items: InboxEntry[];
  head: InboxCheckpoint;
  next: InboxCheckpoint;
  reset: boolean;
}
/** What one gated action came to: granted and run (result or error), waiting for the owner (approvalId), or rejected. */
export interface ActResult {
  external?: boolean;
  sortieId: string;
  actionId: string;
  outcome: Ballot['outcome'];
  pattern: Ballot['pattern'];
  reason: string;
  sync: Ballot['sync'];
  approvalId?: string;
  /** Every card created by one proposal; `approvalId` remains the first card for compatibility. */
  approvalIds?: string[];
  result?: unknown;
  error?: string;
}
/** Sorties the owner starts directly hold one action and close once it settles. */
export const OWNER_SOURCE = 'owner';
/** Sorties Misato plans hold several actions; the coordinator closes them when the loop ends. */
export const MISATO_SOURCE = 'misato';
export class Store {
  readonly db: DatabaseSync;
  readonly workerJobs: WorkerJobs;
  readonly usage: UsageStore;
  readonly instrumentality: InstrumentalityRuns;
  readonly ledger: Ledger;
  readonly watch: Watch;
  readonly memory: Memory;
  readonly policySource: string;
  pushFetch: typeof fetch = fetch;
  /** The data home, when known: the schedule tool writes config.json there. */
  readonly home?: string;
  constructor(
    path: string,
    scrolls: { policy: Policy; source: string } = { policy: defaultPolicy, source: 'default' },
    options: { home?: string } = {},
  ) {
    if (options.home) this.home = options.home;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > UPGRADE_CONTRACT.readerSchema) {
      this.db.close();
      throw new Error('Database schema is newer than this NERV Agency version.');
    }
    if (
      this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='root_migration_resource'").get() &&
      this.db.prepare('SELECT 1 FROM root_migration_resource').get()
    ) {
      this.db.close();
      throw new Error('Root migration is unresolved; inspect its receipt before starting NERV.');
    }
    if (version.user_version >= 6 && options.home && readConfig(options.home).kaji?.rootBinding !== true) {
      this.db.close();
      throw new Error('Migrated trust requires root-bound peer authentication.');
    }
    this.usage = new UsageStore(this.db);
    this.instrumentality = new InstrumentalityRuns(this.db);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY, title TEXT NOT NULL, due TEXT NOT NULL, created TEXT NOT NULL, delivered TEXT, cancelled TEXT);
      CREATE TABLE IF NOT EXISTS reminder_times(reminder_id TEXT PRIMARY KEY REFERENCES reminders(id) ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT 'at', "end" TEXT);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, reminder_id TEXT UNIQUE REFERENCES reminders(id), kind TEXT NOT NULL DEFAULT 'reminder', message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders(due);
      CREATE INDEX IF NOT EXISTS reminders_pending_due ON reminders(due) WHERE delivered IS NULL AND cancelled IS NULL;
      ${LEDGER_SCHEMA}`);
    this.db.exec(
      'INSERT OR IGNORE INTO reminder_times(reminder_id, kind, "end") SELECT id, \'at\', NULL FROM reminders',
    );
    // Schema 3: events record the event schema version they were written under (F-024); earlier rows read as version 1.
    if (!(this.db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).some((c) => c.name === 'v'))
      this.db.exec('ALTER TABLE events ADD COLUMN v INTEGER NOT NULL DEFAULT 1');
    // Schema 4: Lilith's facts, their append-only history and the FTS5 index (F-022).
    this.db.exec(MEMORY_SCHEMA);
    // The Gehirn registry of bases for the Kaji line (F-036): signed, append-only records; an additive table, no version change.
    this.db.exec(REGISTRY_SCHEMA);
    // F-054-T04, additive: milestones recorded from now on (first online, outages and recoveries, promotions).
    this.db.exec(MILESTONE_SCHEMA);
    // F-036 slice 3b, additive: actions queued for other bases, and actions other bases asked of this one (by their id, so a
    // resend after a crash returns the first result instead of running twice).
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS kaji_outbox(id TEXT PRIMARY KEY, sortie_id TEXT NOT NULL, base TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, request TEXT NOT NULL, created TEXT NOT NULL, done TEXT, result TEXT);
      CREATE TABLE IF NOT EXISTS kaji_outbox_pilots(id TEXT PRIMARY KEY, pilot TEXT NOT NULL);`,
    );
    // Schema 5: the inbox holds Hyuga's briefs as well as reminders (F-028). The table is rebuilt once, keeping every
    // row's rowid: inbox cursors (Telegram, the menu-bar app) are rowids, so none of them jumps or repeats.
    if (
      !(this.db.prepare('PRAGMA table_info(deliveries)').all() as { name: string }[]).some((c) => c.name === 'kind')
    ) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db
          .exec(`CREATE TABLE deliveries_v5(id TEXT PRIMARY KEY, reminder_id TEXT UNIQUE REFERENCES reminders(id), kind TEXT NOT NULL DEFAULT 'reminder', message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);
          INSERT INTO deliveries_v5(rowid,id,reminder_id,kind,message,created,read_at) SELECT rowid,id,reminder_id,'reminder',message,created,read_at FROM deliveries;
          DROP TABLE deliveries;ALTER TABLE deliveries_v5 RENAME TO deliveries;`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS deliveries_kind_created ON deliveries(kind,created); PRAGMA user_version=' +
        Math.max(5, version.user_version),
    );
    // Additive daily identities preserve the inbox's existing rowids and UUIDs.
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS daily_briefs(day TEXT PRIMARY KEY,delivery_id TEXT NOT NULL UNIQUE REFERENCES deliveries(id))',
    );
    // Approval delivery identities are additive: existing reminder/brief rowids remain channel cursors.
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS approval_deliveries(approval_id TEXT PRIMARY KEY REFERENCES approvals(id),delivery_id TEXT NOT NULL UNIQUE REFERENCES deliveries(id))',
    );
    // F-004-T05: Web push subscription storage and VAPID keypair
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS push_subscriptions(endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created TEXT NOT NULL, user_agent TEXT);
       CREATE TABLE IF NOT EXISTS push_vapid(id TEXT PRIMARY KEY, public_key TEXT NOT NULL, private_key TEXT NOT NULL, created TEXT NOT NULL);`,
    );
    this.ledger = new Ledger(this.db, { policy: scrolls.policy, tools: builtinTools });
    this.memory = new Memory(this.db);
    this.watch = new Watch(this.db, this.ledger);
    this.policySource = scrolls.source;
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS worker_legacy_outbox(id TEXT PRIMARY KEY,state TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_outbox_cancels(id TEXT PRIMARY KEY,reason TEXT NOT NULL,created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_outbox_attempts(id TEXT PRIMARY KEY,attempted TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_outbox_reconciliations(id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,created TEXT NOT NULL)',
    );
    try {
      this.workerJobs = transaction(this.db, () => {
        const legacy = !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kaji_runs'").get();
        const jobs = new WorkerJobs(this.db, (raw) => this.legacyWorkerResult(raw));
        if (legacy)
          this.db
            .prepare(
              "INSERT OR IGNORE INTO worker_legacy_outbox SELECT id,'pending','Predates durable worker receipts; verify the destination before replay.',? FROM kaji_outbox WHERE done IS NULL",
            )
            .run(new Date().toISOString());
        return jobs;
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
    // Upgrade existing pending cards once; settled/expired cards never become new notifications.
    transaction(this.db, () => {
      const pending = this.db
        .prepare(
          'SELECT id FROM approvals WHERE decision IS NULL AND expires>? AND id NOT IN (SELECT approval_id FROM approval_deliveries)',
        )
        .all(new Date().toISOString()) as { id: string }[];
      for (const approval of pending) this.deliverApproval(approval.id);
    });
  }
  private readonly watchStarted = new Date();
  private watchSettings() {
    const c = this.home ? readConfig(this.home) : undefined;
    return {
      definition: c?.watch ?? { triggers: [] },
      pilots: c?.pilots ?? [],
      timeZone: c?.timeZone ?? 'UTC',
      language: c?.language ?? 'en',
    };
  }
  private syncWatch(now = new Date()) {
    const settings = this.watchSettings();
    try {
      this.watch.admit(settings.definition, settings.pilots, settings.timeZone, now);
    } finally {
      this.reconcileWatchOutbox(settings, now);
    }
    return settings;
  }
  private reconcileWatchOutbox(settings: ReturnType<Store['watchSettings']>, now = new Date()): void {
    const queued = this.db
      .prepare(
        'SELECT q.id,q.sortie_id FROM kaji_outbox q JOIN watch_runs w ON w.sortie_id=q.sortie_id WHERE q.done IS NULL AND q.id NOT IN (SELECT id FROM worker_outbox_cancels) ORDER BY q.rowid LIMIT 20',
      )
      .all() as { id: string; sortie_id: string }[];
    for (const row of queued)
      if (!this.watch.authorized(row.sortie_id, settings.definition, settings.pilots))
        this.db
          .prepare('INSERT OR IGNORE INTO worker_outbox_cancels VALUES(?,?,?)')
          .run(row.id, 'Proactive definition, pilot or attempt authority changed.', now.toISOString());
  }
  private watchIsQuiet(now = new Date()): boolean {
    try {
      const s = this.watchSettings();
      return watchQuiet(now, s.timeZone, s.definition.quietHours);
    } catch {
      return true;
    }
  }
  watchContext(sortieId: string): WatchWork | null {
    const row = this.watch.get(sortieId);
    if (!row) return null;
    const settings = this.syncWatch();
    const run = this.watch.get(sortieId)!;
    const trigger = settings.definition.triggers.find((t) => t.id === run.trigger),
      pilot = settings.pilots.find((p) => p.id === trigger?.pilot && !p.retired);
    return { ...run, readOnly: pilot?.stage !== 'production', ...(pilot ? { model: pilot.model } : {}) };
  }
  watchClaim(): WatchWork | null {
    this.syncWatch();
    const run = this.watch.claim();
    return run ? this.watchContext(run.sortieId) : null;
  }
  watchRecover(): number {
    const settings = this.syncWatch();
    const count = this.watch.interrupt(this.watchStarted);
    this.reconcileWatchOutbox(settings);
    return count;
  }
  watchPlan(sortieId: string): boolean {
    this.syncWatch();
    return this.watch.reserveStep(sortieId);
  }
  watchFinish(sortieId: string, status: 'done' | 'failed', reply: string, now = new Date()): boolean {
    if (typeof reply !== 'string' || !reply.trim() || reply.length > 4000)
      throw Error('Watch reply must contain 1–4000 characters.');
    this.syncWatch(now);
    return transaction(this.db, () => {
      if (!this.watch.finish(sortieId, status, now, reply)) return false;
      this.db
        .prepare('INSERT OR IGNORE INTO watch_notices VALUES(?,?,?,NULL)')
        .run('completion:' + sortieId, sortieId, reply);
      this.releaseWatch(now);
      return true;
    });
  }
  watchPoll(now = new Date()): number {
    this.syncWatch(now);
    return this.releaseWatch(now);
  }
  private releaseWatch(now: Date): number {
    const settings = this.watchSettings();
    return transaction(this.db, () => {
      const fallback =
        settings.language === 'it'
          ? 'Un controllo automatico è stato interrotto. Apri NERV per verificare cosa è successo.'
          : 'An automatic check was interrupted. Open NERV to inspect what happened.';
      this.db
        .prepare(
          "INSERT OR IGNORE INTO watch_notices SELECT 'completion:'||w.sortie_id,w.sortie_id,?,NULL FROM watch_runs w WHERE state='interrupted' AND NOT EXISTS (SELECT 1 FROM watch_notices n WHERE n.id='completion:'||w.sortie_id) LIMIT 20",
        )
        .run(fallback);
      if (this.watchIsQuiet(now)) return 0;
      const notices = this.db
        .prepare('SELECT id,message FROM watch_notices WHERE delivery_id IS NULL ORDER BY rowid LIMIT 20')
        .all() as { id: string; message: string }[];
      for (const notice of notices) {
        const delivery = this.addBrief(notice.message, now);
        this.db.prepare('UPDATE watch_notices SET delivery_id=? WHERE id=?').run(delivery.id, notice.id);
      }
      const approvals = this.db
        .prepare(
          'SELECT a.id FROM approvals a JOIN actions x ON x.id=a.action_id JOIN watch_runs w ON w.sortie_id=x.sortie_id WHERE a.decision IS NULL AND a.expires>? AND a.id NOT IN (SELECT approval_id FROM approval_deliveries) LIMIT 20',
        )
        .all(now.toISOString()) as { id: string }[];
      for (const approval of approvals) this.deliverApproval(approval.id, now);
      return notices.length;
    });
  }
  private deliverApproval(approvalId: string, now = new Date()): void {
    const origin = this.db
      .prepare('SELECT x.sortie_id AS id FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?')
      .get(approvalId) as { id: string } | undefined;
    if (origin && this.watch.get(origin.id) && this.watchIsQuiet(now)) return;
    if (this.db.prepare('SELECT 1 FROM approval_deliveries WHERE approval_id=?').get(approvalId)) return;
    const row = this.db
      .prepare('SELECT x.created FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?')
      .get(approvalId) as { created: string };
    const id = randomUUID();
    // No tool arguments, recipients, fact text or grant handles belong in OS notification bodies.
    this.db
      .prepare("INSERT INTO deliveries(id,kind,message,created) VALUES(?,'approval',?,?)")
      .run(id, 'Approval needs review. Open NERV to check its current status.', row.created);
    this.db.prepare('INSERT INTO approval_deliveries VALUES(?,?)').run(approvalId, id);
  }
  private legacyWorkerResult(raw: string): { state: 'completed' | 'running'; result?: unknown } {
    const result = JSON.parse(raw) as { outcome?: string; approvalId?: string; external?: boolean };
    if (result.outcome !== 'approval') return result.external ? { state: 'running' } : { state: 'completed', result };
    const row = this.db.prepare('SELECT action_id,decision FROM approvals WHERE id=?').get(result.approvalId ?? '') as
      { action_id: string; decision: string | null } | undefined;
    if (!row) return { state: 'running' };
    if (!row.decision) this.decideCore(result.approvalId!, 'reject', 'worker-upgrade');
    if (row.decision !== 'approve')
      return {
        state: 'completed',
        result: {
          outcome: 'reject',
          reason: 'Pre-protocol remote approval stood down or already declined; request again explicitly if needed.',
        },
      };
    const grant = this.db.prepare('SELECT used FROM grants WHERE action_id=?').get(row.action_id) as
      { used: string | null } | undefined;
    if (grant && !grant.used) {
      const action = this.db.prepare('SELECT sortie_id FROM actions WHERE id=?').get(row.action_id) as {
        sortie_id: string;
      };
      this.ledger.spear(action.sortie_id, 'Worker upgrade revoked the unused pre-protocol grant.');
      return {
        state: 'completed',
        result: { outcome: 'reject', reason: 'The pre-protocol grant was revoked before use; no execution occurred.' },
      };
    }
    const done = this.db
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
  /** Same-connection writes plus external SQLite commits, without scanning events or running integrity checks. */
  dashboardRevision(): string {
    const own = this.db.prepare('SELECT total_changes() AS n').get() as { n: number };
    const external = this.db.prepare('PRAGMA data_version').get() as { data_version: number };
    return `${external.data_version}:${own.n}`;
  }
  reminderDefaults(): { timeZone: string; briefAt: string; language: 'en' | 'it' } {
    const c = this.home ? readConfig(this.home) : undefined;
    return {
      timeZone: c?.timeZone ?? 'Europe/Rome',
      briefAt: c?.brief?.at ?? DEFAULT_BRIEF_AT,
      language: c?.language ?? 'en',
    };
  }
  private normalizeRow<T extends { kind?: unknown; end?: string | null | undefined }>(
    row: T,
  ): T & { kind: ReminderKind; end: string | null } {
    return {
      ...row,
      kind: normalizeReminderKind(row.kind),
      end: row.end ?? null,
    };
  }
  /** A valid title and a future ISO date with an explicit timezone, as UTC; the same rules for a new reminder and an edit. */
  private checkReminder(
    title: string,
    due: string,
    now: Date,
    options: ReminderInput = {},
  ): { title: string; due: string; kind: ReminderKind; end: string | null } {
    if (typeof title !== 'string' || !title.trim() || title.length > 500)
      throw new Error('Title must contain 1–500 characters.');
    const defaults = this.reminderDefaults();
    const resolved = resolveReminderTime({
      due,
      kind: options.kind,
      end: options.end,
      now,
      timeZone: options.timeZone ?? defaults.timeZone,
      briefAt: options.briefAt ?? defaults.briefAt,
    });
    return {
      title: title.trim(),
      due: resolved.due,
      kind: resolved.kind,
      end: resolved.end,
    };
  }
  /** Adds a reminder, or returns the pending one with the same title (ignoring case and outer spaces) and the same moment,
      marked `existing`: a request sent twice (a retry, two channels) never makes two reminders (B-003). */
  add(title: string, due: string, now = new Date(), options: ReminderInput = {}): Reminder & { existing?: true } {
    const checked = this.checkReminder(title, due, now, options);
    const same = this.db
      .prepare(
        "SELECT r.*, COALESCE(rt.kind, 'at') AS kind, rt.\"end\" AS \"end\" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.delivered IS NULL AND r.cancelled IS NULL AND r.due=? AND COALESCE(rt.kind,'at')=? AND COALESCE(rt.\"end\",'')=COALESCE(?,'') AND lower(trim(r.title))=lower(trim(?)) LIMIT 1",
      )
      .get(checked.due, checked.kind, checked.end, checked.title) as Reminder | undefined;
    if (same) return { ...this.normalizeRow(same), existing: true };
    const r: Reminder = {
      id: randomUUID(),
      title: checked.title,
      due: checked.due,
      kind: checked.kind,
      end: checked.end,
      created: now.toISOString(),
      delivered: null,
      cancelled: null,
    };
    this.db.prepare('INSERT INTO reminders VALUES(?,?,?,?,NULL,NULL)').run(r.id, r.title, r.due, r.created);
    this.db
      .prepare('INSERT OR REPLACE INTO reminder_times(reminder_id, kind, "end") VALUES(?,?,?)')
      .run(r.id, r.kind, r.end);
    return r;
  }
  list(): Reminder[] {
    return (
      this.db
        .prepare(
          'SELECT r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id ORDER BY r.due',
        )
        .all() as Reminder[]
    ).map((r) => this.normalizeRow(r));
  }
  reminderPage(before = 0, limit = 20): HistoryPage<Reminder & { sequence: number }> {
    checkHistory(before, limit);
    return historyPage(
      (
        this.db
          .prepare(
            'SELECT r.rowid AS sequence, r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.rowid<? ORDER BY r.rowid DESC LIMIT ?',
          )
          .all(before || Number.MAX_SAFE_INTEGER, limit + 1) as unknown as (Reminder & { sequence: number })[]
      ).map((r) => this.normalizeRow(r)),
      limit,
    );
  }
  inboxHistory(before = 0, limit = 20): HistoryPage<InboxEntry> {
    checkHistory(before, limit);
    return historyPage(
      this.db
        .prepare('SELECT rowid AS sequence,* FROM deliveries WHERE rowid<? ORDER BY rowid DESC LIMIT ?')
        .all(before || Number.MAX_SAFE_INTEGER, limit + 1) as unknown as InboxEntry[],
      limit,
    );
  }
  /** Bounded dashboard facts; counts are SQL aggregates, never a downloaded full inbox. */
  dashboardHistory(since: string) {
    if (typeof since !== 'string' || !Number.isFinite(Date.parse(since))) throw new Error('Invalid dashboard time.');
    const delivered = (
      this.db
        .prepare("SELECT count(*) AS count FROM deliveries WHERE kind='reminder' AND created>?")
        .get(new Date(since).toISOString()) as { count: number }
    ).count;
    const brief =
      this.db
        .prepare(
          "SELECT message,created FROM deliveries WHERE kind='brief' AND id NOT IN (SELECT delivery_id FROM watch_notices WHERE delivery_id IS NOT NULL) ORDER BY rowid DESC LIMIT 1",
        )
        .get() ?? null;
    const pending = (
      this.db
        .prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL')
        .get() as { count: number }
    ).count;
    const reminders = (
      this.db
        .prepare(
          'SELECT r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.delivered IS NULL AND r.cancelled IS NULL ORDER BY r.due LIMIT 10',
        )
        .all() as Reminder[]
    ).map((r) => this.normalizeRow(r));
    return { delivered, brief, pending, reminders };
  }
  pendingReminders(limit = 5): Reminder[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid pending reminder limit.');
    return (
      this.db
        .prepare(
          'SELECT r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.delivered IS NULL AND r.cancelled IS NULL ORDER BY r.due LIMIT ?',
        )
        .all(limit) as Reminder[]
    ).map((r) => this.normalizeRow(r));
  }
  /** Undoes a cancellation while the reminder is still in the future and undelivered: the inverse of cancel. */
  restore(id: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const ok =
        Number(
          this.db
            .prepare(
              'UPDATE reminders SET cancelled=NULL WHERE id=? AND delivered IS NULL AND cancelled IS NOT NULL AND due>?',
            )
            .run(id, new Date().toISOString()).changes,
        ) > 0;
      this.db.exec('COMMIT');
      return ok;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  /** Changes the title and/or the time of a reminder that has not fired or been cancelled; undefined when there is none. */
  update(
    id: string,
    patch: { title?: string; due?: string; kind?: ReminderKind | string; end?: string | null },
    now = new Date(),
  ): Reminder | undefined {
    if (
      typeof id !== 'string' ||
      !id ||
      (patch.title === undefined && patch.due === undefined && patch.kind === undefined && patch.end === undefined)
    )
      throw new Error('Give a new title or a new due time.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const rawRow = this.db
        .prepare(
          'SELECT r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.id=? AND r.delivered IS NULL AND r.cancelled IS NULL',
        )
        .get(id) as Reminder | undefined;
      if (!rawRow) {
        this.db.exec('COMMIT');
        return undefined;
      }
      const row = this.normalizeRow(rawRow);
      const nextKind = patch.kind !== undefined ? normalizeReminderKind(patch.kind) : row.kind;
      const nextDue = patch.due ?? (nextKind === 'until' && patch.end === undefined && row.end ? row.end : row.due);
      const nextEnd =
        patch.end !== undefined
          ? patch.end
          : nextKind === 'from-to'
            ? row.end
            : nextKind === 'until' && patch.due === undefined
              ? row.end
              : undefined;
      const checked = this.checkReminder(patch.title ?? row.title, nextDue, now, {
        kind: nextKind,
        end: nextEnd,
      });
      this.db
        .prepare('UPDATE reminders SET title=?,due=? WHERE id=? AND delivered IS NULL AND cancelled IS NULL')
        .run(checked.title, checked.due, id);
      this.db
        .prepare('INSERT OR REPLACE INTO reminder_times(reminder_id, kind, "end") VALUES(?,?,?)')
        .run(id, checked.kind, checked.end);
      this.db.exec('COMMIT');
      return { ...row, ...checked };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  rescheduleAllDayReminders(briefAt?: string, timeZone?: string): void {
    const defaults = this.reminderDefaults();
    const targetAt = briefAt ?? defaults.briefAt;
    const targetTz = timeZone ?? defaults.timeZone;
    const pending = this.db
      .prepare(
        "SELECT r.id, r.due FROM reminders r JOIN reminder_times rt ON rt.reminder_id=r.id WHERE rt.kind='all-day' AND r.delivered IS NULL AND r.cancelled IS NULL",
      )
      .all() as { id: string; due: string }[];
    for (const r of pending) {
      const dayKey = localParts(new Date(r.due), targetTz).dayKey;
      const nextDue = localDayTimeToUtc(dayKey, targetAt, targetTz).toISOString();
      if (nextDue !== r.due) {
        this.db.prepare('UPDATE reminders SET due=? WHERE id=?').run(nextDue, r.id);
      }
    }
  }
  cancel(id: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const ok =
        Number(
          this.db
            .prepare('UPDATE reminders SET cancelled=? WHERE id=? AND delivered IS NULL AND cancelled IS NULL')
            .run(new Date().toISOString(), id).changes,
        ) > 0;
      this.db.exec('COMMIT');
      return ok;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  tick(now = new Date()): number {
    const config = this.home ? readConfig(this.home) : undefined;
    const timeZone = config?.timeZone ?? 'Europe/Rome';
    const lang = config?.language ?? 'en';
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (config?.brief?.at) {
        this.rescheduleAllDayReminders(config.brief.at, timeZone);
      }
      const due = (
        this.db
          .prepare(
            'SELECT r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.due<=? AND r.delivered IS NULL AND r.cancelled IS NULL',
          )
          .all(now.toISOString()) as Reminder[]
      ).map((r) => this.normalizeRow(r));
      for (const r of due) {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO deliveries(id,reminder_id,kind,message,created,read_at) VALUES(?,?,'reminder',?,?,NULL)",
          )
          .run(randomUUID(), r.id, formatInboxReminderMessage(r, timeZone, lang), now.toISOString());
        this.db.prepare('UPDATE reminders SET delivered=? WHERE id=?').run(now.toISOString(), r.id);
      }
      this.db.exec('COMMIT');
      if (due.length > 0) {
        void this.dispatchPushReminders(due).catch(() => {});
      }
      return due.length;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  getOrGenerateVapidKeys(): { publicKey: string; privateKey: string } {
    const existing = this.db.prepare('SELECT public_key, private_key FROM push_vapid WHERE id=?').get('vapid') as
      { public_key: string; private_key: string } | undefined;
    if (existing) {
      return { publicKey: existing.public_key, privateKey: existing.private_key };
    }
    const generated = generateVapidKeys();
    this.db
      .prepare('INSERT OR IGNORE INTO push_vapid(id, public_key, private_key, created) VALUES(?, ?, ?, ?)')
      .run('vapid', generated.publicKey, generated.privateKey, new Date().toISOString());
    return generated;
  }
  pushPublicKey(): string {
    return this.getOrGenerateVapidKeys().publicKey;
  }
  savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string }): void {
    if (!sub || typeof sub !== 'object') throw new Error('Invalid subscription.');
    if (typeof sub.endpoint !== 'string' || !/^https?:\/\//.test(sub.endpoint) || sub.endpoint.length > 1024)
      throw new Error('Invalid subscription endpoint.');
    if (typeof sub.p256dh !== 'string' || !sub.p256dh || sub.p256dh.length > 256)
      throw new Error('Invalid subscription p256dh key.');
    if (typeof sub.auth !== 'string' || !sub.auth || sub.auth.length > 256)
      throw new Error('Invalid subscription auth secret.');
    this.db
      .prepare(
        'INSERT INTO push_subscriptions(endpoint, p256dh, auth, created, user_agent) VALUES(?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, user_agent=excluded.user_agent',
      )
      .run(sub.endpoint, sub.p256dh, sub.auth, new Date().toISOString(), sub.userAgent ?? null);
  }
  deletePushSubscription(endpoint: string): boolean {
    if (typeof endpoint !== 'string' || !endpoint) return false;
    return this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint).changes > 0;
  }
  listPushSubscriptions(): PushSubscriptionRecord[] {
    return this.db
      .prepare(
        'SELECT endpoint, p256dh, auth, created, user_agent AS userAgent FROM push_subscriptions ORDER BY created DESC',
      )
      .all() as unknown as PushSubscriptionRecord[];
  }
  getPushSubscription(endpoint: string): PushSubscriptionRecord | null {
    return (
      (this.db
        .prepare(
          'SELECT endpoint, p256dh, auth, created, user_agent AS userAgent FROM push_subscriptions WHERE endpoint=?',
        )
        .get(endpoint) as unknown as PushSubscriptionRecord | undefined) ?? null
    );
  }
  async dispatchPushReminders(reminders: Reminder[]): Promise<void> {
    const subs = this.listPushSubscriptions();
    if (subs.length === 0 || reminders.length === 0) return;
    const vapid = this.getOrGenerateVapidKeys();
    for (const reminder of reminders) {
      const payload = formatReminderPushPayload(reminder);
      for (const sub of subs) {
        try {
          const res = await sendWebPush(sub, payload, vapid, this.pushFetch);
          if (res.expired) {
            this.deletePushSubscription(sub.endpoint);
          }
        } catch {
          // Push dispatch error does not break local delivery
        }
      }
    }
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
      (this.db.prepare('SELECT title FROM sorties WHERE id=?').get(sortieId) as { title: string } | undefined)?.title ??
      '';
    this.db
      .prepare('INSERT INTO kaji_outbox VALUES(?,?,?,?,?,?,?,NULL,NULL)')
      .run(id, sortieId, base, tool, JSON.stringify(args), title.slice(0, 500), new Date().toISOString());
    if (pilot) this.db.prepare('INSERT INTO kaji_outbox_pilots VALUES(?,?)').run(id, pilot);
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
      this.db
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
    return transaction(this.db, () => {
      const existingOwner = this.workerJobs.owner(id);
      if (existingOwner && existingOwner !== owner) throw new Error('Worker cancellation owner differs.');
      const pending = this.workerJobs.waitingApprovals().find((p) => p.lease.id === id && !p.decision);
      if (pending) {
        this.decideCore(pending.id, 'reject', 'worker-cancel');
        this.workerJobs.finish(pending.lease, {
          outcome: 'reject',
          reason: 'Owner cancelled the pending worker approval; no execution occurred.',
        });
      }
      return this.workerJobs.cancel(owner, id, reason, source);
    });
  }
  cancelWorkerOutbox(id: string, reason: string): void {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500)
      throw new Error('A cancellation reason is required.');
    if (!this.db.prepare('SELECT 1 FROM kaji_outbox WHERE id=? AND done IS NULL').get(id))
      throw new Error('No pending remote request with that ID.');
    this.db
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
      this.db
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
    return transaction(this.db, () => {
      const result = this.ledger.spear(id, reason);
      this.db
        .prepare(
          'INSERT OR IGNORE INTO worker_outbox_cancels SELECT id,?,? FROM kaji_outbox WHERE sortie_id=? AND done IS NULL',
        )
        .run(reason.slice(0, 500), new Date().toISOString(), id);
      const remotePending = (
        this.db.prepare('SELECT count(*) AS n FROM kaji_outbox WHERE sortie_id=? AND done IS NULL').get(id) as {
          n: number;
        }
      ).n;
      return { ...result, ...(remotePending ? { remotePending } : {}) };
    });
  }
  attemptWorkerOutbox(id: string): void {
    const origin = this.db.prepare('SELECT sortie_id FROM kaji_outbox WHERE id=? AND done IS NULL').get(id) as
      { sortie_id: string } | undefined;
    if (origin && this.watch.get(origin.sortie_id)) {
      try {
        const settings = this.syncWatch();
        this.watch.interrupt(this.watchStarted);
        this.reconcileWatchOutbox(settings);
        if (!this.watch.authorized(origin.sortie_id, settings.definition, settings.pilots)) {
          this.cancelWorkerOutbox(id, 'Proactive authority no longer permits dispatch.');
          throw Error('Proactive dispatch authority changed.');
        }
      } catch (error) {
        this.cancelWorkerOutbox(id, 'Proactive dispatch authority is unavailable or changed.');
        throw error;
      }
    }
    transaction(this.db, () => {
      const row = this.db
        .prepare(
          'SELECT created FROM kaji_outbox WHERE id=? AND done IS NULL AND NOT EXISTS (SELECT 1 FROM worker_outbox_cancels c WHERE c.id=kaji_outbox.id)',
        )
        .get(id) as { created: string } | undefined;
      if (!row || Date.parse(row.created) + WORKER_LEASE_MS <= Date.now())
        throw new Error('Worker request was cancelled or expired before dispatch.');
      this.db.prepare('INSERT OR IGNORE INTO worker_outbox_attempts VALUES(?,?)').run(id, new Date().toISOString());
    });
  }
  heldWorkerOutbox(
    before = Number.MAX_SAFE_INTEGER,
  ): { sequence: number; id: string; base: string; tool: string; reason: string }[] {
    if (!Number.isSafeInteger(before) || before < 1) throw new Error('Invalid held-outbox cursor.');
    return this.db
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
    transaction(this.db, () => {
      const row = this.db
        .prepare(
          "SELECT q.base FROM kaji_outbox q JOIN worker_legacy_outbox h ON h.id=q.id WHERE q.id=? AND q.done IS NULL AND h.state='pending'",
        )
        .get(id) as { base: string } | undefined;
      if (!row) throw new Error('No held legacy request with that ID.');
      if (action === 'retry') {
        this.db.prepare('UPDATE kaji_outbox SET created=?,result=NULL WHERE id=?').run(new Date().toISOString(), id);
        this.db.prepare('DELETE FROM worker_outbox_attempts WHERE id=?').run(id);
      } else
        this.outboxDone(
          id,
          { outcome: 'uncertain', error: 'Owner stood down legacy retries; effects were not assumed undone.' },
          { base: row.base, text: 'Owner stood down the pre-upgrade request; its prior effects remain unknown.' },
        );
      this.db.prepare('UPDATE worker_legacy_outbox SET state=? WHERE id=?').run(action, id);
      this.db
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
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT sortie_id,tool,result,done FROM kaji_outbox WHERE id=?').get(id) as
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
      this.db
        .prepare('UPDATE kaji_outbox SET done=?,result=? WHERE id=?')
        .run(terminal ? new Date().toISOString() : null, encoded, id);
      if (said && this.watch.get(row.sortie_id))
        this.db
          .prepare('INSERT OR IGNORE INTO watch_notices VALUES(?,?,?,NULL)')
          .run(
            'remote:' + id + ':' + createHash('sha256').update(encoded).digest('hex'),
            row.sortie_id,
            said.text.slice(0, 600),
          );
      if (said) {
        const r = result as { outcome?: unknown; refused?: unknown };
        this.ledger.remoteResult(row.sortie_id, {
          base: said.base.slice(0, 60),
          tool: row.tool,
          outcome: typeof r.refused === 'string' ? 'refused' : typeof r.outcome === 'string' ? r.outcome : 'answered',
          text: said.text.slice(0, 600),
        });
      }
      return true;
    });
  }

  inbox() {
    return this.db.prepare('SELECT * FROM deliveries ORDER BY created DESC').all();
  }
  /** Hyuga's brief into the inbox (F-028): every channel delivers it from here, once. */
  addBrief(message: string, now = new Date(), day?: string): { id: string; created: string; existing?: true } {
    if (typeof message !== 'string' || !message.trim() || message.length > 4000)
      throw new Error('A brief is 1–4000 characters.');
    if (
      day !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(Date.parse(day + 'T00:00:00Z')) ||
        new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day)
    )
      throw new Error('Invalid daily brief date.');
    const insert = () => {
      const id = randomUUID(),
        created = now.toISOString();
      this.db
        .prepare("INSERT INTO deliveries(id,reminder_id,kind,message,created,read_at) VALUES(?,NULL,'brief',?,?,NULL)")
        .run(id, message, created);
      return { id, created };
    };
    if (day === undefined) return insert();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT delivery_id AS id FROM daily_briefs WHERE day=?').get(day) as
        { id: string } | undefined;
      if (previous) {
        const delivery = this.db.prepare('SELECT id,created FROM deliveries WHERE id=?').get(previous.id) as
          { id: string; created: string } | undefined;
        if (!delivery) throw new Error('Daily brief checkpoint has no delivery.');
        this.db.exec('COMMIT');
        return { ...delivery, existing: true };
      }
      const delivery = insert();
      this.db.prepare('INSERT INTO daily_briefs(day,delivery_id) VALUES(?,?)').run(day, delivery.id);
      this.db.exec('COMMIT');
      return delivery;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** When the latest brief was written, if any: the next brief covers what happened since. */
  lastBrief(): string | null {
    return (
      (
        this.db
          .prepare(
            "SELECT created FROM deliveries WHERE kind='brief' AND id NOT IN (SELECT delivery_id FROM watch_notices WHERE delivery_id IS NOT NULL) ORDER BY rowid DESC LIMIT 1",
          )
          .get() as { created: string } | undefined
      )?.created ?? null
    );
  }
  inboxPage(after = 0, limit = 5, afterId?: string): InboxPage {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20 ||
      (after > 0 && (typeof afterId !== 'string' || !afterId || afterId.length > 100))
    )
      throw new Error('Invalid inbox checkpoint or limit.');
    this.db.exec('BEGIN');
    try {
      const head = (this.db
        .prepare('SELECT rowid AS sequence,id FROM deliveries ORDER BY rowid DESC LIMIT 1')
        .get() as unknown as InboxCheckpoint | undefined) ?? { sequence: 0 };
      const previous = after
        ? (this.db.prepare('SELECT id FROM deliveries WHERE rowid=?').get(after) as { id: string } | undefined)
        : undefined;
      if (after > 0 && previous?.id !== afterId) {
        this.db.exec('COMMIT');
        return { items: [], head, next: head, reset: true };
      }
      const rows = this.db
        .prepare(
          `SELECT d.rowid AS sequence,d.id,d.message,d.created,d.kind,a.id AS approvalId,a.expires,a.decision
        FROM deliveries d LEFT JOIN approval_deliveries n ON n.delivery_id=d.id LEFT JOIN approvals a ON a.id=n.approval_id
        WHERE d.rowid>? ORDER BY d.rowid LIMIT ?`,
        )
        .all(after, limit) as {
        sequence: number;
        id: string;
        message: string;
        created: string;
        kind: InboxEntry['kind'];
        approvalId: string | null;
        expires: string | null;
        decision: string | null;
      }[];
      const now = new Date().toISOString();
      const items: InboxEntry[] = rows.map(({ approvalId, expires, decision, ...item }) => ({
        ...item,
        ...(approvalId && expires
          ? { approval: { id: approvalId, expires, pending: decision === null && expires > now } }
          : {}),
      }));
      const last = items.at(-1);
      const next = last
        ? { sequence: last.sequence, id: last.id }
        : after
          ? { sequence: after, id: afterId }
          : { sequence: 0 };
      this.db.exec('COMMIT');
      return { items, head, next, reset: false };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  approvals(limit = 5) {
    let quiet: boolean | undefined;
    return this.ledger.pendingApprovals(new Date(), limit).map((a) => ({
      ...a,
      ...(this.watch.get(a.card.sortieId) && (quiet ??= this.watchIsQuiet()) ? { notify: false as const } : {}),
    }));
  }
  waitingQuestions(now = new Date()) {
    return this.ledger.waitingQuestions(now);
  }
  agencyStatus(target?: string, live?: AgencySnapshot) {
    const pendingReminders = (
      this.db
        .prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL')
        .get() as { count: number }
    ).count;
    const instrumentality = this.instrumentality.latest();
    const health = {
      state: live?.health.state ?? ('online' as const),
      reasons: live?.health.reasons ?? [],
      pendingReminders,
      ...(live?.routes ? { routes: live.routes } : {}),
      ...(instrumentality ? { instrumentality } : {}),
    };
    const cfg = (() => {
      try {
        return this.home ? readConfig(this.home) : undefined;
      } catch {
        return undefined;
      }
    })();
    let bases: AgencyBaseSnapshot[] = live?.bases ? [...live.bases] : [];
    if (!bases.length) {
      const reg = new Registry(this.db, cfg?.kaji?.root);
      const enrolled = reg.bases();
      if (enrolled.length) {
        const seen = reg.lastSeen();
        const main = reg.main();
        const now = Date.now();
        bases = enrolled.map((b) => {
          const self = cfg?.base.id ? b.baseId === cfg.base.id : false;
          const online =
            b.status === 'enrolled' && (self || (!!seen[b.baseId] && now - Date.parse(seen[b.baseId]!) < 90_000));
          return {
            baseId: b.baseId,
            name: b.name,
            status: b.status,
            self,
            main: b.baseId === main,
            online,
            lastSeen: seen[b.baseId] ?? null,
            health: self ? { state: health.state, reasons: health.reasons } : null,
            channel: null,
          };
        });
      } else {
        const base = cfg?.base ?? { id: 'LOCAL', name: 'This base' };
        bases = [
          {
            baseId: base.id,
            name: base.name,
            status: 'enrolled',
            self: true,
            main: true,
            online: true,
            lastSeen: null,
            health: { state: health.state, reasons: health.reasons },
            channel: null,
          },
        ];
      }
    }
    const filtered = target
      ? bases.filter(
          (b) => b.baseId.toLowerCase() === target.toLowerCase() || b.name.toLowerCase() === target.toLowerCase(),
        )
      : bases;
    return {
      health,
      bases: filtered,
      ...(target && !filtered.length ? { notFound: target } : {}),
    };
  }
  pendingApprovalIds(ids: string[]) {
    return this.ledger.pendingApprovalIds(ids);
  }
  expiredApprovals(since: string) {
    return this.ledger.expiredSince(since);
  }
  /** The grant ID stays inside the coordinator: callers learn only the outcome. */
  /** Applies the owner's decision; an approval of a tool with an executor runs it once, here, with the grant it issued. */
  assertWorkerAuthority(owner: string, key: string, ownerKey: string): void {
    if (!this.home) throw new Error('Worker identity unavailable.');
    const config = readConfig(this.home),
      registry = new Registry(this.db, config.kaji?.root);
    if (
      registry.main() !== owner ||
      !registry.bases().some((b) => b.baseId === owner && b.status === 'enrolled' && b.publicKey === ownerKey) ||
      !registry.bases().some((b) => b.baseId === config.base.id && b.status === 'enrolled' && b.publicKey === key)
    )
      throw new Error('Worker authority or destination enrollment changed.');
  }
  releaseWorker(id: string, reason: string, confirmedStopped: boolean): void {
    transaction(this.db, () => {
      if (!confirmedStopped) throw new Error('Explicit owner confirmation required.');
      for (const pending of this.workerJobs.waitingApprovals())
        if (pending.lease.id === id && !pending.decision) this.decideCore(pending.id, 'reject', 'worker-release');
      this.workerJobs.release(id, reason, confirmedStopped);
    });
  }
  private assertWorker(lease: WorkerLease) {
    this.assertWorkerAuthority(lease.owner, lease.key, lease.ownerKey);
    this.workerJobs.assertLease(lease);
  }
  decide(id: string, decision: Decision, source = 'api'): { decision: string; result?: unknown; error?: string } {
    const lease = this.workerJobs.approval(id);
    if (!lease) return this.decideCore(id, decision, source);
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT decision FROM approvals WHERE id=?').get(id) as
        { decision: string | null } | undefined;
      if (row?.decision) return this.decideCore(id, decision, source);
      if (decision === 'approve')
        try {
          this.assertWorker(lease);
        } catch {
          const rejected = this.decideCore(id, 'reject', 'worker-fence');
          this.workerJobs.finish(lease, {
            outcome: 'reject',
            error: 'Worker lease or authority changed before approval; nothing ran.',
          });
          return { ...rejected, error: 'Worker lease or authority changed; nothing ran.' };
        }
      const result = this.decideCore(id, decision, source);
      this.workerJobs.finish(lease, {
        outcome: result.decision === 'approve' && !result.error ? 'grant' : 'reject',
        ...result,
      });
      return result;
    });
  }
  private decideCore(
    id: string,
    decision: Decision,
    source = 'api',
  ): { decision: string; result?: unknown; error?: string } {
    const proactive = this.db
      .prepare(
        'SELECT x.sortie_id AS id FROM approvals a JOIN actions x ON x.id=a.action_id JOIN watch_runs w ON w.sortie_id=x.sortie_id WHERE a.id=?',
      )
      .get(id) as { id: string } | undefined;
    if (proactive) this.syncWatch();
    const applied = this.ledger.decide(id, decision, source);
    const action = applied.grantId ? this.ledger.grantAction(applied.grantId) : undefined;
    if (applied.grantId && action && !action.used && hasExecutor(action.tool)) {
      const outcome = this.run(action.sortieId, action.actionId, applied.grantId, action.tool, action.args);
      this.settle(action.sortieId, 'error' in outcome ? 'failed' : 'done');
      return { decision: applied.decision, ...outcome };
    }
    const sortie = this.db
      .prepare('SELECT x.sortie_id AS id FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?')
      .get(id) as { id: string } | undefined;
    if (sortie && applied.decision !== 'approve') this.settle(sortie.id, 'failed');
    return { decision: applied.decision };
  }
  /** One owner action through the gate (F-017): ballot, then on a grant the executor runs at once; otherwise it waits for the owner or stops. */
  runAction(sortieId: string, proposal: Proposal, worker?: WorkerLease, agency?: AgencySnapshot): ActResult {
    if (this.watch.get(sortieId)) this.syncWatch();
    if (!worker) return this.runActionCore(sortieId, proposal, undefined, agency);
    return transaction(this.db, () => {
      this.assertWorker(worker);
      const result = this.runActionCore(sortieId, proposal, worker.expires, agency);
      if (result.approvalId) this.workerJobs.bindApproval(worker, result.approvalId, result);
      return result;
    });
  }
  private runActionCore(
    sortieId: string,
    proposal: Proposal,
    approvalUntil?: number,
    agency?: AgencySnapshot,
  ): ActResult {
    if (proposal.tool === 'memory.remember' && Array.isArray(proposal.args.texts)) {
      const texts = proposal.args.texts;
      if (
        texts.length < 2 ||
        texts.length > 10 ||
        texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > 500)
      )
        throw new Error('texts must contain 2 to 10 facts of up to 500 characters each.');
      const unique = new Set(texts.map((text) => text.trim()));
      if (unique.size !== texts.length) throw new Error('Each proposed fact must be distinct.');
      const proposed = transaction(this.db, () =>
        texts.map((text) => {
          const item = this.ledger.propose(
            sortieId,
            { ...proposal, args: { text: text.trim() } },
            new Date(),
            approvalUntil,
          );
          if (!item.approvalId) throw new Error('Every memory fact must reach owner approval.');
          this.deliverApproval(item.approvalId);
          return item;
        }),
      );
      const first = proposed[0]!;
      const approvalIds = proposed.map((item) => item.approvalId!);
      return {
        sortieId,
        actionId: first.actionId,
        outcome: first.ballot.outcome,
        pattern: first.ballot.pattern,
        reason: first.ballot.reason,
        sync: first.ballot.sync,
        approvalId: approvalIds[0],
        approvalIds,
      };
    }
    const p = transaction(this.db, () => {
      const proposed = this.ledger.propose(sortieId, proposal, new Date(), approvalUntil);
      if (proposed.approvalId) this.deliverApproval(proposed.approvalId);
      return proposed;
    });
    const base: ActResult = {
      sortieId,
      actionId: p.actionId,
      outcome: p.ballot.outcome,
      pattern: p.ballot.pattern,
      reason: p.ballot.reason,
      sync: p.ballot.sync,
      ...(p.approvalId ? { approvalId: p.approvalId } : {}),
    };
    if (p.grantId && hasExecutor(proposal.tool)) {
      const outcome = this.run(sortieId, p.actionId, p.grantId, proposal.tool, proposal.args, agency);
      this.settle(sortieId, 'error' in outcome ? 'failed' : 'done');
      return { ...base, ...outcome };
    }
    // F-021: a granted MCP tool: the single-use grant is used here, the call is made by the tools process.
    if (p.grantId && this.ledger.isExternal(proposal.tool)) {
      this.ledger.authorize(p.grantId, proposal.tool, proposal.args);
      this.ledger.intake(sortieId, 'mcp:' + proposal.tool, 'tainted');
      return { ...base, external: true };
    }
    if (p.ballot.outcome === 'reject') this.settle(sortieId, 'failed');
    return base;
  }
  private run(
    sortieId: string,
    actionId: string,
    grantId: string,
    tool: string,
    args: Record<string, unknown>,
    agency?: AgencySnapshot,
  ): { result: unknown } | { error: string } {
    this.ledger.authorize(grantId, tool, args);
    let outcome: { result: unknown } | { error: string };
    const execT0 = performance.now();
    try {
      outcome = {
        result: execute(this, tool, args, {
          sortieId,
          tainted: this.ledger.trust(sortieId) === 'tainted',
          ...(agency ? { agency } : {}),
        }),
      };
    } catch (e) {
      outcome = { error: e instanceof Error ? e.message : 'Executor failed.' };
    }
    const durationMs = Math.max(0, Math.round(performance.now() - execT0));
    if ('result' in outcome && tool === 'memory.recall') {
      const facts = outcome.result as { tainted: boolean }[];
      this.ledger.intake(sortieId, 'tool:' + tool, facts.some((f) => f.tainted) ? 'tainted' : 'trusted');
    }
    // Reminder text predates per-item provenance; treat recalled stored text conservatively.
    if ('result' in outcome && tool === 'reminders.list') this.ledger.intake(sortieId, 'tool:' + tool, 'tainted');
    if ('result' in outcome && tool === 'sorties.explain') {
      const res = outcome.result as { id?: string } | { id: string }[];
      const ids = Array.isArray(res) ? res.map((s) => s.id) : res.id ? [res.id] : [];
      this.ledger.intake(
        sortieId,
        'tool:' + tool,
        ids.some((id) => this.ledger.trust(id) === 'tainted') ? 'tainted' : 'trusted',
      );
    }
    if ('result' in outcome && tool === 'approvals.list') {
      const res = outcome.result as { approvals: { sortieId: string }[]; questions: { sortieId: string }[] };
      const ids = [...res.approvals.map((a) => a.sortieId), ...res.questions.map((q) => q.sortieId)];
      this.ledger.intake(
        sortieId,
        'tool:' + tool,
        ids.some((id) => this.ledger.trust(id) === 'tainted') ? 'tainted' : 'trusted',
      );
    }
    if ('result' in outcome && tool === 'agency.status') this.ledger.intake(sortieId, 'tool:' + tool, 'trusted');
    this.ledger.finished(sortieId, actionId, tool, outcome, new Date(), durationMs);
    return outcome;
  }
  private settle(sortieId: string, status: 'done' | 'failed') {
    const sortie = this.db.prepare('SELECT source FROM sorties WHERE id=?').get(sortieId) as
      { source: string } | undefined;
    if (sortie?.source === OWNER_SOURCE) this.ledger.close(sortieId, status);
    // Proposals (Instrumentality; Marduk Institute pilots, B-026): the sortie is done once the owner has decided every
    // card, whatever the decisions: nothing resumes after them.
    if (
      (sortie?.source === 'instrumentality' || sortie?.source === 'marduk') &&
      !this.db
        .prepare(
          'SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=? AND a.decision IS NULL',
        )
        .get(sortieId)
    )
      this.ledger.close(sortieId, 'done');
  }
  private settledOnce = false;
  /**
   * Scheduler tick: stands down approvals past their TTL, then closes the sorties nothing will finish any more (B-026):
   * an owner action or a proposal whose every card is decided (an expired card included). Misato's sorties resume
   * instead. The first tick also closes those left open by an earlier version.
   */
  expire(now = new Date()): number {
    const n = this.ledger.expire(now);
    for (const pending of this.workerJobs.waitingApprovals())
      transaction(this.db, () => {
        // An already issued grant without a terminal receipt is uncertain, never proof that nothing ran.
        if (pending.decision === 'approve') return;
        let invalid = !!pending.decision;
        try {
          this.assertWorkerAuthority(pending.lease.owner, pending.lease.key, pending.lease.ownerKey);
          this.workerJobs.assertLease(pending.lease, now.getTime());
        } catch {
          invalid = true;
        }
        if (invalid) {
          if (!pending.decision) this.decideCore(pending.id, 'reject', 'worker-fence');
          this.workerJobs.finish(pending.lease, {
            outcome: 'reject',
            error: 'Worker approval expired or its lease/authority ended; nothing ran.',
          });
        }
      });
    if (n || !this.settledOnce) {
      this.settledOnce = true;
      const stuck = this.db
        .prepare(
          `SELECT s.id,s.source FROM sorties s WHERE s.status='open' AND s.source IN (?,'instrumentality','marduk')
     AND EXISTS (SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=s.id)
     AND NOT EXISTS (SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=s.id AND a.decision IS NULL)`,
        )
        .all(OWNER_SOURCE) as { id: string; source: string }[];
      for (const s of stuck) {
        // An owner action whose card expired or was refused did not happen; a proposal is settled whatever was decided.
        const ran = this.db.prepare("SELECT 1 FROM events WHERE sortie_id=? AND kind='action.done'").get(s.id);
        this.ledger.close(s.id, s.source === OWNER_SOURCE && !ran ? 'failed' : 'done', now);
      }
    }
    return n;
  }
  events(sortieId: string, after = 0, limit = 50) {
    return this.ledger.events(sortieId, after, limit);
  }
  sorties(limit = 20, before?: string, q?: string) {
    return this.ledger.sorties(limit, before, q);
  }
  sortie(id: string) {
    return this.ledger.sortie(id) ?? null;
  }
  closedSince(since: string) {
    return this.ledger.closedSince(since);
  }
  timingSummary(since: string) {
    return this.ledger.timingSummary(since);
  }
  /** F-021: what an external tool returned, recorded on its action like a built-in tool's result. */
  finishedExternal(
    sortieId: string,
    actionId: string,
    tool: string,
    outcome: { text: string } | { error: string },
    durationMs?: number,
  ) {
    this.ledger.finished(
      sortieId,
      actionId,
      tool,
      'error' in outcome ? { error: outcome.error } : { result: { text: outcome.text } },
      new Date(),
      durationMs,
    );
    return true;
  }
  unmatched(domain: string, since: string) {
    return this.ledger.unmatched(domain, since);
  }
  shadowVote(
    sortieId: string,
    actionId: string,
    vote: { seat: string; vote: 'approve' | 'reject' | 'abstain'; reason: string; confidence?: number },
  ) {
    this.ledger.shadowVote(sortieId, actionId, vote);
    return true;
  }
  explain(ref: string) {
    return this.ledger.explain(ref);
  }
  /** The scheduled outcome and episode checkpoint commit together, or neither does. */
  saveEpisode(value: Omit<Episode, 'id' | 'created'> & { runId?: string }): Episode {
    const { runId, ...episode } = value;
    const now = new Date();
    return this.memory.saveEpisode(
      episode,
      now,
      runId
        ? () => {
            if (
              !this.instrumentality.finish(
                runId,
                episode.exchanges ? 'completed' : 'skipped',
                episode.exchanges ? null : 'no-exchanges',
                now.toISOString(),
              )
            )
              throw new Error('Stale consolidation claim.');
          }
        : undefined,
    );
  }
  health() {
    return { integrityCheck: 'not-run', instrumentality: this.instrumentality.latest() };
  }
  doctor() {
    return {
      instrumentality: this.instrumentality.latest(),
      database: this.db.prepare('PRAGMA quick_check').get(),
      schema: this.db.prepare('PRAGMA user_version').get(),
      pending: this.db
        .prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL')
        .get(),
      policy: { source: this.policySource, ...this.ledger.policy },
    };
  }
  close() {
    this.db.close();
  }
}
