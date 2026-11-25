import type { DatabaseSync } from 'node:sqlite';
import { formatReminderPushPayload, generateVapidKeys, sendWebPush, type PushSubscriptionRecord } from './push.ts';
import type { Reminder } from './store.ts';

export interface StorePushHost {
  readonly db: DatabaseSync;
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

  async dispatchPushReminders(reminders: Reminder[]): Promise<void> {
    const subs = this.listPushSubscriptions();
    if (subs.length === 0 || reminders.length === 0) return;
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
    for (const reminder of reminders) {
      const payload = formatReminderPushPayload(reminder);
      for (const sub of subs) {
        const host = endpointHost(sub.endpoint);
        try {
          const res = await sendWebPush(sub, payload, { ...vapid, subject }, pushFetch);
          this.recordResult(res.ok, res.status, res.reason);
          if (!res.ok)
            console.error(`push: delivery to ${host} failed: HTTP ${res.status}${res.reason ? ` ${res.reason}` : ''}`);
          if (res.expired) {
            this.deletePushSubscription(sub.endpoint);
          }
        } catch (error) {
          // Push dispatch error does not break local delivery, but it is no longer silent.
          const reason = error instanceof Error ? error.message.slice(0, 120) : 'send failed';
          this.recordResult(false, 0, reason);
          console.error(`push: delivery to ${host} failed: ${reason}`);
        }
      }
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
