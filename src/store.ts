import { Watch, type WatchWork } from './watch.ts';
import {
  exportCoordinatorSnapshot,
  importCoordinatorSnapshotToStandby,
  promoteStandbyDatabase,
  type ExportCoordinatorSnapshotInput,
  type ImportStandbySnapshotInput,
  type PromoteStandbySwapInput,
} from './coordinator-snapshot.ts';
import { transaction } from './sqlite-transaction.ts';
import type { WorkerLease } from './worker-jobs.ts';
import { credentialAges, readConfig } from './config.ts';
import { UPGRADE_CONTRACT } from './upgrade-contract.ts';
import { WorkerJobs } from './worker-jobs.ts';
import { WholeJobHandoffStore } from './whole-job-handoff.ts';
import { InstrumentalityRuns } from './instrumentality-runs.ts';
import { UsageStore } from './model-usage.ts';
import type { HistoryPage } from './history.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LEDGER_SCHEMA, Ledger, type Decision, type Proposal } from './ledger.ts';
import { builtinTools, type AgencySnapshot } from './executors.ts';
import { MEMORY_SCHEMA, Memory, type Episode } from './memory.ts';
import { INCIDENT_CIRCUITS_SCHEMA, IncidentCircuitStore } from './incident-circuits.ts';
import { BATTERY_SCHEMA, BatteryRegistry } from './batteries.ts';
import { LISTS_SCHEMA, ListStore } from './lists.ts';
import { FPV_BUILDS_SCHEMA, FpvBuildStore } from './fpv-builds.ts';
import { DOCUMENTS_SCHEMA, DocumentStore } from './documents.ts';
import { PANTRY_SCHEMA, PantryStore } from './pantry.ts';
import { FLEET_SCHEMA, FleetStore } from './fleet.ts';
import { REGISTRY_SCHEMA } from './kaji.ts';
import { MILESTONE_SCHEMA } from './milestones.ts';
import { RESUME_INTENT_SCHEMA, ResumeIntentStore } from './resume-intent.ts';
import { defaultPolicy, type Ballot, type Policy } from './policy.ts';
import type { PushSubscriptionRecord } from './push.ts';
import type { ReminderKind } from './reminder-time.ts';
import { StoreWatch } from './store-watch.ts';
import { StoreReminders } from './store-reminders.ts';
import { StorePush } from './store-push.ts';
import { StoreKajiOutbox } from './store-kaji-outbox.ts';
import { StoreInbox } from './store-inbox.ts';
import { StoreSorties } from './store-sorties.ts';
import { BatteryStorageReminders } from './battery-storage-reminders.ts';
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
  readonly wholeJobHandoffs: WholeJobHandoffStore;
  readonly usage: UsageStore;
  readonly instrumentality: InstrumentalityRuns;
  readonly ledger: Ledger;
  readonly watch: Watch;
  readonly memory: Memory;
  readonly circuits: IncidentCircuitStore;
  readonly batteries: BatteryRegistry;
  readonly fleet: FleetStore;
  readonly resumeIntents: ResumeIntentStore;
  readonly lists: ListStore;
  readonly fpvBuilds: FpvBuildStore;
  readonly documents: DocumentStore;
  readonly pantry: PantryStore;
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
    this.db.exec(DOCUMENTS_SCHEMA);
    this.db.exec(INCIDENT_CIRCUITS_SCHEMA);
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
    this.db.exec(RESUME_INTENT_SCHEMA);
    this.db.exec(LISTS_SCHEMA);
    this.db.exec(FPV_BUILDS_SCHEMA);
    this.ledger = new Ledger(this.db, { policy: scrolls.policy, tools: builtinTools });
    this.memory = new Memory(this.db);
    this.circuits = new IncidentCircuitStore(this.db, this.ledger);
    this.db.exec(BATTERY_SCHEMA);
    this.batteries = new BatteryRegistry(this.db);
    this.db.exec(FLEET_SCHEMA);
    this.fleet = new FleetStore(this.db);
    this.resumeIntents = new ResumeIntentStore(this.db);
    this.lists = new ListStore(this.db);
    this.fpvBuilds = new FpvBuildStore(this.db);
    this.db.exec(DOCUMENTS_SCHEMA);
    this.documents = new DocumentStore(this.db);
    this.db.exec(PANTRY_SCHEMA);
    this.pantry = new PantryStore(this.db);
    this.watch = new Watch(this.db, this.ledger);
    this.policySource = scrolls.source;
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS worker_legacy_outbox(id TEXT PRIMARY KEY,state TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_outbox_cancels(id TEXT PRIMARY KEY,reason TEXT NOT NULL,created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_outbox_attempts(id TEXT PRIMARY KEY,attempted TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_outbox_reconciliations(id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,created TEXT NOT NULL)',
    );
    try {
      this.workerJobs = transaction(this.db, () => {
        const legacy = !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kaji_runs'").get();
        const jobs = new WorkerJobs(this.db, (raw) => this.kajiOutboxController.legacyWorkerResult(raw));
        if (legacy)
          this.db
            .prepare(
              "INSERT OR IGNORE INTO worker_legacy_outbox SELECT id,'pending','Predates durable worker receipts; verify the destination before replay.',? FROM kaji_outbox WHERE done IS NULL",
            )
            .run(new Date().toISOString());
        return jobs;
      });
      this.wholeJobHandoffs = new WholeJobHandoffStore(this.db);
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
      for (const approval of pending) this.sortiesController.deliverApproval(approval.id);
    });
  }
  private readonly watchStarted = new Date();
  private _watchController?: StoreWatch;
  private get watchController(): StoreWatch {
    return (this._watchController ??= new StoreWatch({
      db: this.db,
      home: this.home,
      watch: this.watch,
      watchStarted: this.watchStarted,
      addBrief: (message, now, day) => this.addBrief(message, now, day),
      deliverApproval: (approvalId, now) => this.sortiesController.deliverApproval(approvalId, now),
    }));
  }
  watchContext(sortieId: string): WatchWork | null {
    return this.watchController.watchContext(sortieId);
  }
  watchClaim(): WatchWork | null {
    return this.watchController.watchClaim();
  }
  watchRecover(): number {
    return this.watchController.watchRecover();
  }
  watchPlan(sortieId: string): boolean {
    return this.watchController.watchPlan(sortieId);
  }
  watchFinish(sortieId: string, status: 'done' | 'failed', reply: string, now = new Date()): boolean {
    return this.watchController.watchFinish(sortieId, status, reply, now);
  }
  watchPoll(now = new Date()): number {
    return this.watchController.watchPoll(now);
  }
  /** Same-connection writes plus external SQLite commits, without scanning events or running integrity checks. */
  dashboardRevision(): string {
    const own = this.db.prepare('SELECT total_changes() AS n').get() as { n: number };
    const external = this.db.prepare('PRAGMA data_version').get() as { data_version: number };
    return `${external.data_version}:${own.n}`;
  }
  private _remindersController?: StoreReminders;
  private get remindersController(): StoreReminders {
    return (this._remindersController ??= new StoreReminders({
      db: this.db,
      home: this.home,
      dispatchPushReminders: (reminders) => this.dispatchPushReminders(reminders),
    }));
  }
  reminderDefaults(): { timeZone: string; briefAt: string; language: 'en' | 'it' } {
    return this.remindersController.reminderDefaults();
  }
  add(title: string, due: string, now = new Date(), options: ReminderInput = {}): Reminder & { existing?: true } {
    return this.remindersController.add(title, due, now, options);
  }
  list(): Reminder[] {
    return this.remindersController.list();
  }
  reminderPage(before = 0, limit = 20): HistoryPage<Reminder & { sequence: number }> {
    return this.remindersController.reminderPage(before, limit);
  }
  inboxHistory(before = 0, limit = 20): HistoryPage<InboxEntry> {
    return this.inboxController.inboxHistory(before, limit);
  }
  /** Bounded dashboard facts; counts are SQL aggregates, never a downloaded full inbox. */
  dashboardHistory(since: string) {
    return this.inboxController.dashboardHistory(since);
  }
  pendingReminders(limit = 5): Reminder[] {
    return this.remindersController.pendingReminders(limit);
  }
  /** Undoes a cancellation while the reminder is still in the future and undelivered: the inverse of cancel. */
  restore(id: string): boolean {
    return this.remindersController.restore(id);
  }
  /** Changes the title and/or the time of a reminder that has not fired or been cancelled; undefined when there is none. */
  update(
    id: string,
    patch: { title?: string; due?: string; kind?: ReminderKind | string; end?: string | null },
    now = new Date(),
  ): Reminder | undefined {
    return this.remindersController.update(id, patch, now);
  }
  rescheduleAllDayReminders(briefAt?: string, timeZone?: string): void {
    this.remindersController.rescheduleAllDayReminders(briefAt, timeZone);
  }
  cancel(id: string): boolean {
    return this.remindersController.cancel(id);
  }
  private _batteryStorageReminders?: BatteryStorageReminders;
  get batteryStorageReminders(): BatteryStorageReminders {
    return (this._batteryStorageReminders ??= new BatteryStorageReminders(this.db, this.remindersController));
  }
  showList(name: string) {
    return this.lists.show(name);
  }
  toggleListItem(itemId: string) {
    return this.lists.toggleItemById(itemId);
  }
  listsShow(name: string) {
    return this.lists.show(name);
  }
  listsToggle(itemId: string, done?: boolean, now = new Date()) {
    return this.lists.setDoneById(itemId, done, now);
  }
  tick(now = new Date()): number {
    const count = this.remindersController.tick(now);
    const lang = this.remindersController.reminderDefaults().language;
    this.batteries.deliverDueResistancePrompts(now, lang);
    this.batteryStorageReminders.syncAll(this.batteries.list(), now);
    return count;
  }
  private _pushController?: StorePush;
  private get pushController(): StorePush {
    return (this._pushController ??= new StorePush({
      db: this.db,
      getPushFetch: () => this.pushFetch,
    }));
  }
  getOrGenerateVapidKeys(): { publicKey: string; privateKey: string } {
    return this.pushController.getOrGenerateVapidKeys();
  }
  pushPublicKey(): string {
    return this.pushController.pushPublicKey();
  }
  savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string }): void {
    this.pushController.savePushSubscription(sub);
  }
  deletePushSubscription(endpoint: string): boolean {
    return this.pushController.deletePushSubscription(endpoint);
  }
  listPushSubscriptions(): PushSubscriptionRecord[] {
    return this.pushController.listPushSubscriptions();
  }
  getPushSubscription(endpoint: string): PushSubscriptionRecord | null {
    return this.pushController.getPushSubscription(endpoint);
  }
  async dispatchPushReminders(reminders: Reminder[]): Promise<void> {
    return this.pushController.dispatchPushReminders(reminders);
  }
  private _kajiOutboxController?: StoreKajiOutbox;
  private get kajiOutboxController(): StoreKajiOutbox {
    return (this._kajiOutboxController ??= new StoreKajiOutbox({
      db: this.db,
      ledger: this.ledger,
      workerJobs: this.workerJobs,
      watch: this.watch,
      decideCore: (id, decision, source, options) => this.sortiesController.decideCore(id, decision, source, options),
      verifyWatchOutboxAuthority: (sortieId) => this.watchController.verifyWatchOutboxAuthority(sortieId),
    }));
  }
  queueRemote(
    sortieId: string,
    base: string,
    tool: string,
    args: Record<string, unknown>,
    pilot?: string,
  ): { id: string } {
    return this.kajiOutboxController.queueRemote(sortieId, base, tool, args, pilot);
  }
  /** Queued actions not settled yet, oldest first: the coordinator sends them (the same id each time). */
  outbox() {
    return this.kajiOutboxController.outbox();
  }
  cancelWorker(
    owner: string,
    id: string,
    reason: string,
    source: 'coordinator' | 'cli',
  ): { status: string; result?: unknown } {
    return this.kajiOutboxController.cancelWorker(owner, id, reason, source);
  }
  cancelWorkerOutbox(id: string, reason: string): void {
    this.kajiOutboxController.cancelWorkerOutbox(id, reason);
  }
  cancelledWorkerOutbox() {
    return this.kajiOutboxController.cancelledWorkerOutbox();
  }
  spear(id: string, reason: string) {
    return this.kajiOutboxController.spear(id, reason);
  }
  attemptWorkerOutbox(id: string): void {
    this.kajiOutboxController.attemptWorkerOutbox(id);
  }
  heldWorkerOutbox(before = Number.MAX_SAFE_INTEGER) {
    return this.kajiOutboxController.heldWorkerOutbox(before);
  }
  reconcileWorkerOutbox(id: string, action: 'retry' | 'abandon', reason: string, confirmedNotRun = false): void {
    this.kajiOutboxController.reconcileWorkerOutbox(id, action, reason, confirmedNotRun);
  }
  /** Marks a sent action done with its result and, the first time only, records what the other base did on the sortie (B-011). */
  outboxDone(id: string, result: unknown, said?: { base: string; text: string }): boolean {
    return this.kajiOutboxController.outboxDone(id, result, said);
  }
  outboxProgress(id: string, result: unknown, said: { base: string; text: string }): boolean {
    return this.kajiOutboxController.outboxProgress(id, result, said);
  }

  private _inboxController?: StoreInbox;
  private get inboxController(): StoreInbox {
    return (this._inboxController ??= new StoreInbox({
      db: this.db,
      ledger: this.ledger,
      watch: this.watch,
      normalizeRow: (row) => this.remindersController.normalizeRow(row),
      watchIsQuiet: (now) => this.watchController.watchIsQuiet(now),
    }));
  }
  inbox() {
    return this.inboxController.inbox();
  }
  /** Hyuga's brief into the inbox (F-028): every channel delivers it from here, once. */
  addBrief(message: string, now = new Date(), day?: string): { id: string; created: string; existing?: true } {
    return this.inboxController.addBrief(message, now, day);
  }
  /** When the latest brief was written, if any: the next brief covers what happened since. */
  lastBrief(): string | null {
    return this.inboxController.lastBrief();
  }
  inboxPage(after = 0, limit = 5, afterId?: string): InboxPage {
    return this.inboxController.inboxPage(after, limit, afterId);
  }
  approvals(limit = 5) {
    return this.inboxController.approvals(limit);
  }
  waitingQuestions(now = new Date()) {
    return this.inboxController.waitingQuestions(now);
  }
  private _sortiesController?: StoreSorties;
  private get sortiesController(): StoreSorties {
    return (this._sortiesController ??= new StoreSorties({
      store: this,
      db: this.db,
      home: this.home,
      ledger: this.ledger,
      watch: this.watch,
      workerJobs: this.workerJobs,
      instrumentality: this.instrumentality,
      syncWatch: (now) => this.watchController.syncWatch(now),
      watchIsQuiet: (now) => this.watchController.watchIsQuiet(now),
    }));
  }
  agencyStatus(target?: string, live?: AgencySnapshot) {
    return this.sortiesController.agencyStatus(target, live);
  }
  pendingApprovalIds(ids: string[]) {
    return this.sortiesController.pendingApprovalIds(ids);
  }
  expiredApprovals(since: string) {
    return this.sortiesController.expiredApprovals(since);
  }
  /** The grant ID stays inside the coordinator: callers learn only the outcome. */
  /** Applies the owner's decision; an approval of a tool with an executor runs it once, here, with the grant it issued. */
  assertWorkerAuthority(owner: string, key: string, ownerKey: string): void {
    this.sortiesController.assertWorkerAuthority(owner, key, ownerKey);
  }
  releaseWorker(id: string, reason: string, confirmedStopped: boolean): void {
    this.sortiesController.releaseWorker(id, reason, confirmedStopped);
  }
  decide(
    id: string,
    decision: Decision,
    source = 'api',
    options?: { useSuggestedFix?: boolean },
  ): { decision: string; result?: unknown; error?: string } {
    return this.sortiesController.decide(id, decision, source, options);
  }
  /** One owner action through the gate (F-017): ballot, then on a grant the executor runs at once; otherwise it waits for the owner or stops. */
  runAction(sortieId: string, proposal: Proposal, worker?: WorkerLease, agency?: AgencySnapshot): ActResult {
    return this.sortiesController.runAction(sortieId, proposal, worker, agency);
  }
  /**
   * Scheduler tick: stands down approvals past their TTL, then closes the sorties nothing will finish any more (B-026):
   * an owner action or a proposal whose every card is decided (an expired card included). Misato's sorties resume
   * instead. The first tick also closes those left open by an earlier version.
   */
  expire(now = new Date()): number {
    return this.sortiesController.expire(now);
  }
  events(sortieId: string, after = 0, limit = 50) {
    return this.sortiesController.events(sortieId, after, limit);
  }
  sorties(limit = 20, before?: string, q?: string) {
    return this.sortiesController.sorties(limit, before, q);
  }
  sortie(id: string) {
    return this.sortiesController.sortie(id);
  }
  closedSince(since: string) {
    return this.sortiesController.closedSince(since);
  }
  timingSummary(since: string) {
    return this.sortiesController.timingSummary(since);
  }
  /** F-021: what an external tool returned, recorded on its action like a built-in tool's result. */
  finishedExternal(
    sortieId: string,
    actionId: string,
    tool: string,
    outcome: { text: string } | { error: string },
    durationMs?: number,
  ) {
    return this.sortiesController.finishedExternal(sortieId, actionId, tool, outcome, durationMs);
  }
  unmatched(domain: string, since: string) {
    return this.sortiesController.unmatched(domain, since);
  }
  shadowVote(
    sortieId: string,
    actionId: string,
    vote: { seat: string; vote: 'approve' | 'reject' | 'abstain'; reason: string; confidence?: number },
  ) {
    return this.sortiesController.shadowVote(sortieId, actionId, vote);
  }
  explain(ref: string) {
    return this.sortiesController.explain(ref);
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
      ...(this.home ? { credentials: credentialAges(this.home) } : {}),
      instrumentality: this.instrumentality.latest(),
      database: this.db.prepare('PRAGMA quick_check').get(),
      schema: this.db.prepare('PRAGMA user_version').get(),
      pending: this.db
        .prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL')
        .get(),
      policy: { source: this.policySource, ...this.ledger.policy },
    };
  }
  exportCoordinatorSnapshot(input: Omit<ExportCoordinatorSnapshotInput, 'db'>) {
    return exportCoordinatorSnapshot({ ...input, db: this.db });
  }
  importStandbySnapshot(input: Omit<ImportStandbySnapshotInput, 'standbyDb'>) {
    return importCoordinatorSnapshotToStandby({ ...input, standbyDb: this.db });
  }
  static promoteStandby(input: PromoteStandbySwapInput) {
    return promoteStandbyDatabase(input);
  }
  close() {
    this.db.close();
  }
}
