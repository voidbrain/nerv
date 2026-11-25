import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './sqlite-transaction.ts';

/**
 * F-124-T01: one delivery state shared by every channel. A `deliveries` row (the inbox item) gets one row per channel
 * that handled it, with when it was sent, when it failed (and why) and when the owner opened it there. Telegram and Web
 * Push both write here, so either channel can read what the other did. Additive: the inbox's rowids are untouched.
 */
export const DELIVERY_CHANNELS_SCHEMA = `CREATE TABLE IF NOT EXISTS delivery_channels(
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  channel TEXT NOT NULL CHECK(channel IN ('telegram','push')),
  created TEXT NOT NULL,
  sent_at TEXT,
  failed_at TEXT,
  opened_at TEXT,
  reason TEXT,
  PRIMARY KEY(delivery_id, channel))`;

/**
 * F-004-T09 (owner decision 2026-11-25): a reminder goes to the phone first and reaches Telegram only when the push
 * fails, no device is subscribed, or the owner has not opened it on the phone within this long.
 */
export const PUSH_FALLBACK_MS = 10 * 60_000;

/** A Telegram fallback the store handed out: the inbox item to send once. */
export interface FallbackItem {
  id: string;
  kind: string;
  message: string;
}

export const DELIVERY_CHANNELS = ['telegram', 'push'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export type DeliveryOutcome = 'sent' | 'failed' | 'opened';

/** A channel's state: opened beats sent, sent beats failed (a retry that worked); pending until any of them. */
export interface ChannelState {
  state: 'pending' | 'sent' | 'failed' | 'opened';
  created: string;
  sentAt: string | null;
  failedAt: string | null;
  openedAt: string | null;
  reason: string | null;
}

export type DeliveryState = Partial<Record<DeliveryChannel, ChannelState>>;

interface Row {
  channel: DeliveryChannel;
  created: string;
  sent_at: string | null;
  failed_at: string | null;
  opened_at: string | null;
  reason: string | null;
}

export function channelState(row: Omit<Row, 'channel'>): ChannelState {
  const state = row.opened_at ? 'opened' : row.sent_at ? 'sent' : row.failed_at ? 'failed' : 'pending';
  return {
    state,
    created: row.created,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    openedAt: row.opened_at,
    reason: row.reason,
  };
}

export class DeliveryChannels {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(DELIVERY_CHANNELS_SCHEMA);
    // F-004-T09, additive: the hash of a push's receipt (the phone reports an open with it) and when Telegram last
    // started a fallback send (a claim with no outcome yet is in flight and never handed out again).
    const columns = (db.prepare('PRAGMA table_info(delivery_channels)').all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes('receipt')) db.exec('ALTER TABLE delivery_channels ADD COLUMN receipt TEXT');
    if (!columns.includes('attempt_at')) db.exec('ALTER TABLE delivery_channels ADD COLUMN attempt_at TEXT');
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS delivery_channels_receipt ON delivery_channels(receipt) WHERE receipt IS NOT NULL',
    );
  }

  /** F-004-T09: the item goes to the phone first; Telegram leaves it to the fallback. Called with the inbox write. */
  queuePush(deliveryId: string, now = new Date()): void {
    this.db
      .prepare("INSERT OR IGNORE INTO delivery_channels(delivery_id, channel, created) VALUES(?, 'push', ?)")
      .run(deliveryId, now.toISOString());
  }

  /** Whether the item was queued for the phone first, so Telegram sends it only as the fallback. */
  pushFirst(deliveryId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM delivery_channels WHERE delivery_id=? AND channel='push'").get(deliveryId);
  }

  /** A fresh receipt for a queued push: the phone sends it back when the owner opens the notification. */
  pushReceipt(deliveryId: string): string | undefined {
    const receipt = randomBytes(18).toString('base64url');
    const changed = this.db
      .prepare("UPDATE delivery_channels SET receipt=? WHERE delivery_id=? AND channel='push'")
      .run(hashReceipt(receipt), deliveryId).changes;
    return changed ? receipt : undefined;
  }

  /** The phone's receipt: marks that push opened (once; a repeat keeps the first time). False for an unknown receipt. */
  openedByReceipt(receipt: string, now = new Date()): boolean {
    if (typeof receipt !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(receipt)) return false;
    return (
      Number(
        this.db
          .prepare("UPDATE delivery_channels SET opened_at=COALESCE(opened_at, ?) WHERE receipt=? AND channel='push'")
          .run(now.toISOString(), hashReceipt(receipt)).changes,
      ) > 0
    );
  }

  /**
   * F-004-T09: hands out, once, the items queued for the phone that Telegram must now send: the push failed, or it was
   * not opened within `deadlineMs` of being queued (also when the push never left because NERV stopped first). Each one
   * is claimed in the same transaction, so a receipt arriving later, a second pass or a restart never sends it again;
   * only a send that failed (recorded) is handed out again.
   */
  claimFallback(deadlineMs: number, now = new Date(), limit = 5): FallbackItem[] {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0) throw new Error('Invalid fallback deadline.');
    const cutoff = new Date(now.getTime() - deadlineMs).toISOString();
    return transaction(this.db, () => {
      const due = this.db
        .prepare(
          `SELECT d.id, d.kind, d.message FROM deliveries d
           JOIN delivery_channels p ON p.delivery_id=d.id AND p.channel='push'
           LEFT JOIN delivery_channels t ON t.delivery_id=d.id AND t.channel='telegram'
           WHERE p.opened_at IS NULL
             AND ((p.failed_at IS NOT NULL AND p.sent_at IS NULL) OR p.created<=?)
             AND (t.delivery_id IS NULL OR (t.sent_at IS NULL AND t.failed_at IS NOT NULL AND (t.attempt_at IS NULL OR t.failed_at>=t.attempt_at)))
           ORDER BY d.rowid LIMIT ?`,
        )
        .all(cutoff, limit) as unknown as FallbackItem[];
      const at = now.toISOString();
      for (const item of due) {
        this.db
          .prepare(
            "INSERT INTO delivery_channels(delivery_id, channel, created, attempt_at) VALUES(?, 'telegram', ?, ?) ON CONFLICT(delivery_id, channel) DO UPDATE SET attempt_at=excluded.attempt_at",
          )
          .run(item.id, at, at);
      }
      return due.map((d) => ({ id: d.id, kind: d.kind, message: d.message }));
    });
  }

  /**
   * Records what a channel did with an inbox item. The first sent and opened times are kept (a repeat never moves
   * them); a failure keeps its latest time and reason. Returns false when no such inbox item exists.
   */
  record(deliveryId: string, channel: DeliveryChannel, outcome: DeliveryOutcome, now = new Date(), reason?: string) {
    if (typeof deliveryId !== 'string' || !deliveryId || deliveryId.length > 64)
      throw new Error('Invalid delivery id.');
    if (!DELIVERY_CHANNELS.includes(channel)) throw new Error('Invalid delivery channel.');
    if (outcome !== 'sent' && outcome !== 'failed' && outcome !== 'opened')
      throw new Error('Invalid delivery outcome.');
    if (!this.db.prepare('SELECT 1 FROM deliveries WHERE id=?').get(deliveryId)) return false;
    const at = now.toISOString();
    const why = outcome === 'failed' ? (reason ?? 'failed').replace(/[^\x20-\x7e]/g, ' ').slice(0, 120) : null;
    this.db
      .prepare('INSERT OR IGNORE INTO delivery_channels(delivery_id, channel, created) VALUES(?, ?, ?)')
      .run(deliveryId, channel, at);
    const column = outcome === 'sent' ? 'sent_at' : outcome === 'opened' ? 'opened_at' : 'failed_at';
    this.db
      .prepare(
        outcome === 'failed'
          ? 'UPDATE delivery_channels SET failed_at=?, reason=? WHERE delivery_id=? AND channel=?'
          : `UPDATE delivery_channels SET ${column}=COALESCE(${column}, ?) WHERE delivery_id=? AND channel=?`,
      )
      .run(...(outcome === 'failed' ? [at, why, deliveryId, channel] : [at, deliveryId, channel]));
    return true;
  }

  /** Every channel's state for one inbox item; empty when no channel has handled it yet. */
  state(deliveryId: string): DeliveryState {
    const rows = this.db
      .prepare(
        'SELECT channel, created, sent_at, failed_at, opened_at, reason FROM delivery_channels WHERE delivery_id=? ORDER BY channel',
      )
      .all(deliveryId) as unknown as Row[];
    const out: DeliveryState = {};
    for (const { channel, ...row } of rows) out[channel] = channelState(row);
    return out;
  }
}

function hashReceipt(receipt: string): string {
  return createHash('sha256').update(receipt).digest('hex');
}
