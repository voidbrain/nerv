import type { DatabaseSync } from 'node:sqlite';
import type { BatteryRecord } from './batteries.ts';
import { localDayTimeToUtc, localParts } from './reminder-time.ts';
import type { StoreReminders } from './store-reminders.ts';

export const STORAGE_REMINDER_TIME = '21:00';
export const STORAGE_FOLLOWUP_DAYS = 5;

export type StorageReminderStage = 'same_day' | 'five_days' | 'daily';

export const BATTERY_STORAGE_REMINDER_SCHEMA = `
CREATE TABLE IF NOT EXISTS battery_storage_reminders(
  battery_id TEXT PRIMARY KEY REFERENCES batteries(id) ON DELETE CASCADE,
  reminder_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  scheduled_at TEXT NOT NULL
);
`;

function addDaysToDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

function nextEveningAtUtc(now: Date, timeZone: string, offsetDays: number): Date {
  const baseDayKey = localParts(now, timeZone).dayKey;
  const targetDayKey = offsetDays === 0 ? baseDayKey : addDaysToDayKey(baseDayKey, offsetDays);
  const candidate = localDayTimeToUtc(targetDayKey, STORAGE_REMINDER_TIME, timeZone);
  if (offsetDays === 0 && candidate.getTime() <= now.getTime()) {
    return localDayTimeToUtc(addDaysToDayKey(baseDayKey, 1), STORAGE_REMINDER_TIME, timeZone);
  }
  return candidate;
}

function formatStorageTitle(battery: BatteryRecord, language: 'it' | 'en'): string {
  const series = battery.series ? ` (${battery.series})` : battery.seriesColor ? ` (${battery.seriesColor})` : '';
  return language === 'it'
    ? `Metti in storage batteria #${battery.packNumber}${series} (${battery.currentState})`
    : `Store battery #${battery.packNumber}${series} (${battery.currentState})`;
}

/**
 * Schedules and advances FPV battery storage reminders using NERV's existing reminder engine (F-008-T09):
 * 21:00 the same day, then +5 days at 21:00, then daily at 21:00 until the battery is stored.
 */
export class BatteryStorageReminders {
  private readonly db: DatabaseSync;
  private readonly reminders: StoreReminders;

  constructor(db: DatabaseSync, reminders: StoreReminders) {
    this.db = db;
    this.reminders = reminders;
    this.db.exec(BATTERY_STORAGE_REMINDER_SCHEMA);
  }

  onBatteryStateChanged(battery: BatteryRecord, now = new Date()): void {
    if (battery.currentState === 'stored' || battery.retiredAt) {
      this.clearForBattery(battery.id);
      return;
    }
    this.ensureScheduled(battery, 'same_day', now, 0);
  }

  clearForBattery(batteryId: string): void {
    const existing = this.db
      .prepare('SELECT reminder_id FROM battery_storage_reminders WHERE battery_id = ?')
      .get(batteryId) as { reminder_id: string } | undefined;
    if (!existing) return;
    this.reminders.cancel(existing.reminder_id);
    this.db.prepare('DELETE FROM battery_storage_reminders WHERE battery_id = ?').run(batteryId);
  }

  /**
   * Advances delivered storage reminders to their next follow-up (+5 days, then daily)
   * and ensures every non-stored battery has an active reminder.
   */
  syncAll(batteries: readonly BatteryRecord[], now = new Date()): void {
    const byId = new Map(batteries.map((b) => [b.id, b]));
    const tracked = this.db
      .prepare('SELECT battery_id, reminder_id, stage FROM battery_storage_reminders')
      .all() as Array<{ battery_id: string; reminder_id: string; stage: StorageReminderStage }>;

    for (const row of tracked) {
      const bat = byId.get(row.battery_id);
      if (!bat || bat.currentState === 'stored' || bat.retiredAt) {
        this.clearForBattery(row.battery_id);
        continue;
      }
      const rem = this.db.prepare('SELECT delivered, cancelled FROM reminders WHERE id = ?').get(row.reminder_id) as
        { delivered: string | null; cancelled: string | null } | undefined;
      if (!rem || rem.cancelled) {
        this.db.prepare('DELETE FROM battery_storage_reminders WHERE battery_id = ?').run(row.battery_id);
        continue;
      }
      if (rem.delivered) {
        if (row.stage === 'same_day') {
          this.ensureScheduled(bat, 'five_days', now, STORAGE_FOLLOWUP_DAYS, true);
        } else {
          this.ensureScheduled(bat, 'daily', now, 1, true);
        }
      }
    }

    for (const bat of batteries) {
      if (bat.currentState !== 'stored' && !bat.retiredAt) {
        const exists = this.db.prepare('SELECT 1 FROM battery_storage_reminders WHERE battery_id = ?').get(bat.id);
        if (!exists) {
          this.ensureScheduled(bat, 'same_day', now, 0);
        }
      }
    }
  }

  private ensureScheduled(
    battery: BatteryRecord,
    stage: StorageReminderStage,
    now: Date,
    offsetDays: number,
    replaceExisting = false,
  ): void {
    const existing = this.db
      .prepare('SELECT reminder_id FROM battery_storage_reminders WHERE battery_id = ?')
      .get(battery.id) as { reminder_id: string } | undefined;
    if (existing && !replaceExisting) return;

    const { timeZone, language } = this.reminders.reminderDefaults();
    const due = nextEveningAtUtc(now, timeZone, offsetDays);
    const added = this.reminders.add(formatStorageTitle(battery, language), due.toISOString(), now, { kind: 'at' });
    this.db
      .prepare(
        'INSERT OR REPLACE INTO battery_storage_reminders(battery_id, reminder_id, stage, scheduled_at) VALUES (?, ?, ?, ?)',
      )
      .run(battery.id, added.id, stage, now.toISOString());
  }
}
