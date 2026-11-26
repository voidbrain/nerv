import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { checkHistory, historyPage, type HistoryPage } from './history.ts';
import type { Ledger } from './ledger.ts';
import type { ReminderKind } from './reminder-time.ts';
import { transaction } from './sqlite-transaction.ts';
import type { InboxCheckpoint, InboxEntry, InboxPage, Reminder } from './store.ts';
import type { Watch } from './watch.ts';

/**
 * F-133 review: a notice written just before NERV stops (an update starting) skips push first and goes to Telegram at
 * once, as before F-133: the push would leave after the commit and the service may be gone by then.
 */
export interface BriefOptions {
  beforeStop?: boolean;
}

export interface StoreInboxHost {
  readonly db: DatabaseSync;
  readonly ledger: Ledger;
  readonly watch: Watch;
  normalizeRow<T extends { kind?: unknown; end?: string | null | undefined }>(
    row: T,
  ): T & { kind: ReminderKind; end: string | null };
  watchIsQuiet(now?: Date): boolean;
  /** F-133: with a subscribed device the new brief goes to the phone first (same write as the inbox item). */
  queuePushFirst?(deliveryId: string, now: Date): void;
}

/**
 * Deliveries/inbox paging, daily briefs, dashboard history, and pending approval/question queries
 * extracted from Store (F-095-T04).
 */
export class StoreInbox {
  private readonly host: StoreInboxHost;

  constructor(host: StoreInboxHost) {
    this.host = host;
  }

  inbox() {
    return this.host.db.prepare('SELECT * FROM deliveries ORDER BY created DESC').all();
  }

  /**
   * B-149: the owner saw this inbox item in the app (dashboard or workspace). The first read is kept; the Telegram
   * fallback skips a read item (`claimFallback`). False when no such item exists.
   */
  markRead(id: string, now = new Date()): boolean {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return false;
    return (
      Number(
        this.host.db.prepare('UPDATE deliveries SET read_at=COALESCE(read_at, ?) WHERE id=?').run(now.toISOString(), id)
          .changes,
      ) > 0
    );
  }

  inboxHistory(before = 0, limit = 20): HistoryPage<InboxEntry> {
    checkHistory(before, limit);
    return historyPage(
      this.host.db
        .prepare('SELECT rowid AS sequence,* FROM deliveries WHERE rowid<? ORDER BY rowid DESC LIMIT ?')
        .all(before || Number.MAX_SAFE_INTEGER, limit + 1) as unknown as InboxEntry[],
      limit,
    );
  }

  /** Bounded dashboard facts; counts are SQL aggregates, never a downloaded full inbox. */
  dashboardHistory(since: string) {
    if (typeof since !== 'string' || !Number.isFinite(Date.parse(since))) throw new Error('Invalid dashboard time.');
    const delivered = (
      this.host.db
        .prepare("SELECT count(*) AS count FROM deliveries WHERE kind='reminder' AND created>?")
        .get(new Date(since).toISOString()) as { count: number }
    ).count;
    const brief =
      this.host.db
        .prepare(
          "SELECT id,message,created,read_at FROM deliveries WHERE kind='brief' AND id NOT IN (SELECT delivery_id FROM watch_notices WHERE delivery_id IS NOT NULL) AND id NOT IN (SELECT notice_id FROM session_limit_targets WHERE notice_id IS NOT NULL) ORDER BY rowid DESC LIMIT 1",
        )
        .get() ?? null;
    const pending = (
      this.host.db
        .prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL')
        .get() as { count: number }
    ).count;
    const reminders = (
      this.host.db
        .prepare(
          'SELECT r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.delivered IS NULL AND r.cancelled IS NULL ORDER BY r.due LIMIT 10',
        )
        .all() as Reminder[]
    ).map((r) => this.host.normalizeRow(r));
    return { delivered, brief, pending, reminders };
  }

  /**
   * Hyuga's brief into the inbox (F-028): every channel delivers it from here, once. F-133: with a subscribed device it
   * is queued for the phone first in the same transaction; the caller pushes it once the write is committed.
   */
  addBrief(
    message: string,
    now = new Date(),
    day?: string,
    options: BriefOptions = {},
  ): { id: string; created: string; existing?: true } {
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
      this.host.db
        .prepare("INSERT INTO deliveries(id,reminder_id,kind,message,created,read_at) VALUES(?,NULL,'brief',?,?,NULL)")
        .run(id, message, created);
      if (!options.beforeStop) this.host.queuePushFirst?.(id, now);
      return { id, created };
    };
    if (day === undefined) return transaction(this.host.db, insert);
    return transaction(this.host.db, () => {
      const previous = this.host.db.prepare('SELECT delivery_id AS id FROM daily_briefs WHERE day=?').get(day) as
        { id: string } | undefined;
      if (previous) {
        const delivery = this.host.db.prepare('SELECT id,created FROM deliveries WHERE id=?').get(previous.id) as
          { id: string; created: string } | undefined;
        if (!delivery) throw new Error('Daily brief checkpoint has no delivery.');
        return { ...delivery, existing: true };
      }
      const delivery = insert();
      this.host.db.prepare('INSERT INTO daily_briefs(day,delivery_id) VALUES(?,?)').run(day, delivery.id);
      return delivery;
    });
  }

  /** When the latest brief was written, if any: the next brief covers what happened since. */
  lastBrief(): string | null {
    return (
      (
        this.host.db
          .prepare(
            "SELECT created FROM deliveries WHERE kind='brief' AND id NOT IN (SELECT delivery_id FROM watch_notices WHERE delivery_id IS NOT NULL) AND id NOT IN (SELECT notice_id FROM session_limit_targets WHERE notice_id IS NOT NULL) ORDER BY rowid DESC LIMIT 1",
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
    return transaction(this.host.db, () => {
      const head = (this.host.db
        .prepare('SELECT rowid AS sequence,id FROM deliveries ORDER BY rowid DESC LIMIT 1')
        .get() as unknown as InboxCheckpoint | undefined) ?? { sequence: 0 };
      const previous = after
        ? (this.host.db.prepare('SELECT id FROM deliveries WHERE rowid=?').get(after) as { id: string } | undefined)
        : undefined;
      if (after > 0 && previous?.id !== afterId) {
        return { items: [], head, next: head, reset: true };
      }
      const rows = this.host.db
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
      return { items, head, next, reset: false };
    });
  }

  approvals(limit = 5) {
    let quiet: boolean | undefined;
    return this.host.ledger.pendingApprovals(new Date(), limit).map((a) => ({
      ...a,
      ...(this.host.watch.get(a.card.sortieId) && (quiet ??= this.host.watchIsQuiet())
        ? { notify: false as const }
        : {}),
    }));
  }

  waitingQuestions(now = new Date()) {
    return this.host.ledger.waitingQuestions(now);
  }
}
