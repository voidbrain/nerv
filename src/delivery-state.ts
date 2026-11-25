import type { DatabaseSync } from 'node:sqlite';

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
