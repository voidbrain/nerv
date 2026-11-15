import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readConfig } from './config.ts';
import { checkHistory, historyPage, type HistoryPage } from './history.ts';
import {
  DEFAULT_BRIEF_AT,
  formatInboxReminderMessage,
  localDayTimeToUtc,
  localParts,
  normalizeReminderKind,
  resolveReminderTime,
  type ReminderKind,
} from './reminder-time.ts';
import { transaction } from './sqlite-transaction.ts';
import type { Reminder, ReminderInput } from './store.ts';

export interface StoreRemindersHost {
  readonly db: DatabaseSync;
  readonly home?: string;
  dispatchPushReminders(reminders: Reminder[]): Promise<void>;
}

/**
 * Reminder CRUD, paging, all-day rescheduling, and due-reminder delivery tick
 * extracted from Store (F-095-T04).
 */
export class StoreReminders {
  private readonly host: StoreRemindersHost;

  constructor(host: StoreRemindersHost) {
    this.host = host;
  }

  reminderDefaults(): { timeZone: string; briefAt: string; language: 'en' | 'it' } {
    const c = this.host.home ? readConfig(this.host.home) : undefined;
    return {
      timeZone: c?.timeZone ?? 'Europe/Rome',
      briefAt: c?.brief?.at ?? DEFAULT_BRIEF_AT,
      language: c?.language ?? 'en',
    };
  }

  normalizeRow<T extends { kind?: unknown; end?: string | null | undefined }>(
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
    const same = this.host.db
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
    this.host.db.prepare('INSERT INTO reminders VALUES(?,?,?,?,NULL,NULL)').run(r.id, r.title, r.due, r.created);
    this.host.db
      .prepare('INSERT OR REPLACE INTO reminder_times(reminder_id, kind, "end") VALUES(?,?,?)')
      .run(r.id, r.kind, r.end);
    return r;
  }

  list(): Reminder[] {
    return (
      this.host.db
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
        this.host.db
          .prepare(
            'SELECT r.rowid AS sequence, r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.rowid<? ORDER BY r.rowid DESC LIMIT ?',
          )
          .all(before || Number.MAX_SAFE_INTEGER, limit + 1) as unknown as (Reminder & { sequence: number })[]
      ).map((r) => this.normalizeRow(r)),
      limit,
    );
  }

  pendingReminders(limit = 5): Reminder[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid pending reminder limit.');
    return (
      this.host.db
        .prepare(
          'SELECT r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.delivered IS NULL AND r.cancelled IS NULL ORDER BY r.due LIMIT ?',
        )
        .all(limit) as Reminder[]
    ).map((r) => this.normalizeRow(r));
  }

  /** Undoes a cancellation while the reminder is still in the future and undelivered: the inverse of cancel. */
  restore(id: string): boolean {
    return transaction(
      this.host.db,
      () =>
        Number(
          this.host.db
            .prepare(
              'UPDATE reminders SET cancelled=NULL WHERE id=? AND delivered IS NULL AND cancelled IS NOT NULL AND due>?',
            )
            .run(id, new Date().toISOString()).changes,
        ) > 0,
    );
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
    return transaction(this.host.db, () => {
      const rawRow = this.host.db
        .prepare(
          'SELECT r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.id=? AND r.delivered IS NULL AND r.cancelled IS NULL',
        )
        .get(id) as Reminder | undefined;
      if (!rawRow) return undefined;
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
      this.host.db
        .prepare('UPDATE reminders SET title=?,due=? WHERE id=? AND delivered IS NULL AND cancelled IS NULL')
        .run(checked.title, checked.due, id);
      this.host.db
        .prepare('INSERT OR REPLACE INTO reminder_times(reminder_id, kind, "end") VALUES(?,?,?)')
        .run(id, checked.kind, checked.end);
      return { ...row, ...checked };
    });
  }

  rescheduleAllDayReminders(briefAt?: string, timeZone?: string): void {
    const defaults = this.reminderDefaults();
    const targetAt = briefAt ?? defaults.briefAt;
    const targetTz = timeZone ?? defaults.timeZone;
    const pending = this.host.db
      .prepare(
        "SELECT r.id, r.due FROM reminders r JOIN reminder_times rt ON rt.reminder_id=r.id WHERE rt.kind='all-day' AND r.delivered IS NULL AND r.cancelled IS NULL",
      )
      .all() as { id: string; due: string }[];
    for (const r of pending) {
      const dayKey = localParts(new Date(r.due), targetTz).dayKey;
      const nextDue = localDayTimeToUtc(dayKey, targetAt, targetTz).toISOString();
      if (nextDue !== r.due) {
        this.host.db.prepare('UPDATE reminders SET due=? WHERE id=?').run(nextDue, r.id);
      }
    }
  }

  cancel(id: string): boolean {
    return transaction(
      this.host.db,
      () =>
        Number(
          this.host.db
            .prepare('UPDATE reminders SET cancelled=? WHERE id=? AND delivered IS NULL AND cancelled IS NULL')
            .run(new Date().toISOString(), id).changes,
        ) > 0,
    );
  }

  tick(now = new Date()): number {
    const config = this.host.home ? readConfig(this.host.home) : undefined;
    const timeZone = config?.timeZone ?? 'Europe/Rome';
    const lang = config?.language ?? 'en';
    const due = transaction(this.host.db, () => {
      if (config?.brief?.at) {
        this.rescheduleAllDayReminders(config.brief.at, timeZone);
      }
      const rows = (
        this.host.db
          .prepare(
            'SELECT r.*, COALESCE(rt.kind, \'at\') AS kind, rt."end" AS "end" FROM reminders r LEFT JOIN reminder_times rt ON rt.reminder_id=r.id WHERE r.due<=? AND r.delivered IS NULL AND r.cancelled IS NULL',
          )
          .all(now.toISOString()) as Reminder[]
      ).map((r) => this.normalizeRow(r));
      for (const r of rows) {
        this.host.db
          .prepare(
            "INSERT OR IGNORE INTO deliveries(id,reminder_id,kind,message,created,read_at) VALUES(?,?,'reminder',?,?,NULL)",
          )
          .run(randomUUID(), r.id, formatInboxReminderMessage(r, timeZone, lang), now.toISOString());
        this.host.db.prepare('UPDATE reminders SET delivered=? WHERE id=?').run(now.toISOString(), r.id);
      }
      return rows;
    });
    if (due.length > 0) {
      void this.host.dispatchPushReminders(due).catch(() => {});
    }
    return due.length;
  }
}
