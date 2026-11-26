import type { DatabaseSync } from 'node:sqlite';
import {
  formatBriefPushPayload,
  formatReminderPushPayload,
  generateVapidKeys,
  sendWebPush,
  type PushSubscriptionRecord,
} from './push.ts';
import type { Reminder } from './store.ts';
import type { DeliveryChannels } from './delivery-state.ts';

export interface StorePushHost {
  readonly db: DatabaseSync;
  readonly deliveries: DeliveryChannels;
  getPushFetch(): typeof fetch;
  getPushSubject(): string | undefined;
}

/**
 * Web Push VAPID keys, subscription persistence, and reminder push dispatch
 * extracted from Store (F-095-T04).
 */
export class StorePush {
  private readonly host: StorePushHost;

  constructor(host: StorePushHost) {
    this.host = host;
  }

  getOrGenerateVapidKeys(): { publicKey: string; privateKey: string } {
    const existing = this.host.db.prepare('SELECT public_key, private_key FROM push_vapid WHERE id=?').get('vapid') as
      { public_key: string; private_key: string } | undefined;
    if (existing) {
      return { publicKey: existing.public_key, privateKey: existing.private_key };
    }
    const generated = generateVapidKeys();
    this.host.db
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
    this.host.db
      .prepare(
        'INSERT INTO push_subscriptions(endpoint, p256dh, auth, created, user_agent) VALUES(?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, user_agent=excluded.user_agent',
      )
      .run(sub.endpoint, sub.p256dh, sub.auth, new Date().toISOString(), sub.userAgent ?? null);
  }

  deletePushSubscription(endpoint: string): boolean {
    if (typeof endpoint !== 'string' || !endpoint) return false;
    return this.host.db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint).changes > 0;
  }

  listPushSubscriptions(): PushSubscriptionRecord[] {
    return this.host.db
      .prepare(
        'SELECT endpoint, p256dh, auth, created, user_agent AS userAgent FROM push_subscriptions ORDER BY created DESC',
      )
      .all() as unknown as PushSubscriptionRecord[];
  }

  getPushSubscription(endpoint: string): PushSubscriptionRecord | null {
    return (
      (this.host.db
        .prepare(
          'SELECT endpoint, p256dh, auth, created, user_agent AS userAgent FROM push_subscriptions WHERE endpoint=?',
        )
        .get(endpoint) as unknown as PushSubscriptionRecord | undefined) ?? null
    );
  }

  /** F-004-T09, F-133: with a subscribed device a new reminder or brief goes to the phone first; without one, to Telegram. */
  queuePushFirst(deliveryId: string, now: Date): void {
    const devices = (this.host.db.prepare('SELECT count(*) AS n FROM push_subscriptions').get() as { n: number }).n;
    if (devices > 0) this.host.deliveries.queuePush(deliveryId, now);
  }

  async dispatchPushReminders(reminders: Reminder[]): Promise<void> {
    if (reminders.length === 0) return;
    const deliveryOf = (reminder: Reminder) =>
      (
        this.host.db
          .prepare(
            "SELECT d.id FROM deliveries d JOIN delivery_channels p ON p.delivery_id=d.id AND p.channel='push' WHERE d.reminder_id=?",
          )
          .get(reminder.id) as { id: string } | undefined
      )?.id;
    await this.pushQueued(
      reminders.map((reminder) => ({
        deliveryId: deliveryOf(reminder),
        payload: (receipt?: string) => formatReminderPushPayload(reminder, receipt),
      })),
    );
  }

  /** F-133: brief-kind inbox items queued for the phone first (`queuePushFirst`), pushed like reminders. */
  async dispatchPushBriefs(deliveryIds: string[]): Promise<void> {
    if (deliveryIds.length === 0) return;
    await this.pushQueued(
      deliveryIds.map((id) => {
        const delivery = this.host.db
          .prepare(
            "SELECT d.id, d.message FROM deliveries d JOIN delivery_channels p ON p.delivery_id=d.id AND p.channel='push' WHERE d.id=? AND d.kind='brief'",
          )
          .get(id) as { id: string; message: string } | undefined;
        return {
          deliveryId: delivery?.id,
          payload: (receipt?: string) => formatBriefPushPayload(delivery!, receipt),
        };
      }),
    );
  }

  /**
   * Sends each inbox item queued for the phone to every subscribed device and records the push's outcome. Only items
   * queued for the phone are pushed: one Telegram already sends (no device when it was written) is not.
   */
  private async pushQueued(
    items: { deliveryId: string | undefined; payload: (receipt?: string) => object }[],
  ): Promise<void> {
    const subs = this.listPushSubscriptions();
    if (subs.length === 0) {
      // Queued for the phone, but the last device went away before the send: Telegram sends it at once.
      for (const { deliveryId } of items)
        if (deliveryId) this.host.deliveries.record(deliveryId, 'push', 'failed', new Date(), 'no subscribed device');
      return;
    }
    const vapid = this.getOrGenerateVapidKeys();
    const pushFetch = this.host.getPushFetch();
    let subject: string | undefined;
    try {
      subject = this.host.getPushSubject();
    } catch (error) {
      console.error(
        `push: ${error instanceof Error ? error.message : 'invalid push config'}; using the default subject`,
      );
    }
    for (const { deliveryId, payload: format } of items) {
      if (!deliveryId) continue;
      const payload = format(this.host.deliveries.pushReceipt(deliveryId));
      // F-124-T01: the push service accepted it for at least one device (sent), or for none (failed, last reason).
      let accepted = false;
      let lastReason = 'send failed';
      for (const sub of subs) {
        const host = endpointHost(sub.endpoint);
        try {
          const res = await sendWebPush(sub, payload, { ...vapid, subject }, pushFetch);
          this.recordResult(res.ok, res.status, res.reason);
          if (res.ok) accepted = true;
          else {
            lastReason = `HTTP ${res.status}${res.reason ? ` ${res.reason}` : ''}`;
            console.error(`push: delivery to ${host} failed: ${lastReason}`);
          }
          if (res.expired) {
            this.deletePushSubscription(sub.endpoint);
          }
        } catch (error) {
          // Push dispatch error does not break local delivery, but it is no longer silent.
          const reason = error instanceof Error ? error.message.slice(0, 120) : 'send failed';
          this.recordResult(false, 0, reason);
          lastReason = reason;
          console.error(`push: delivery to ${host} failed: ${reason}`);
        }
      }
      this.host.deliveries.record(
        deliveryId,
        'push',
        accepted ? 'sent' : 'failed',
        new Date(),
        accepted ? undefined : lastReason,
      );
    }
  }

  private recordResult(ok: boolean, status: number, reason?: string): void {
    this.host.db
      .prepare(
        'INSERT INTO push_last_result(id, at, ok, status, reason) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET at=excluded.at, ok=excluded.ok, status=excluded.status, reason=excluded.reason',
      )
      .run('last', new Date().toISOString(), ok ? 1 : 0, status, reason ?? null);
  }

  status(): { devices: number; last: { at: string; ok: boolean; status: number; reason: string | null } | null } {
    const devices = (this.host.db.prepare('SELECT count(*) AS n FROM push_subscriptions').get() as { n: number }).n;
    const row = this.host.db.prepare('SELECT at, ok, status, reason FROM push_last_result WHERE id=?').get('last') as
      { at: string; ok: number; status: number; reason: string | null } | undefined;
    return { devices, last: row ? { at: row.at, ok: row.ok === 1, status: row.status, reason: row.reason } : null };
  }
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown host';
  }
}
