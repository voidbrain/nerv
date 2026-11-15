import type { DatabaseSync } from 'node:sqlite';
import { readConfig } from './config.ts';
import { transaction } from './sqlite-transaction.ts';
import { watchQuiet, type Watch, type WatchWork } from './watch.ts';

export interface StoreWatchHost {
  readonly db: DatabaseSync;
  readonly home?: string;
  readonly watch: Watch;
  readonly watchStarted: Date;
  addBrief(message: string, now?: Date, day?: string): { id: string; created: string; existing?: true };
  deliverApproval(approvalId: string, now?: Date): void;
}

/**
 * Proactive watch admission, outbox reconciliation, quiet hours, and completion notices
 * extracted from Store (F-095-T04).
 */
export class StoreWatch {
  private readonly host: StoreWatchHost;

  constructor(host: StoreWatchHost) {
    this.host = host;
  }

  private watchSettings() {
    const c = this.host.home ? readConfig(this.host.home) : undefined;
    return {
      definition: c?.watch ?? { triggers: [] },
      pilots: c?.pilots ?? [],
      timeZone: c?.timeZone ?? 'UTC',
      language: c?.language ?? 'en',
    };
  }

  syncWatch(now = new Date()) {
    const settings = this.watchSettings();
    try {
      this.host.watch.admit(settings.definition, settings.pilots, settings.timeZone, now);
    } finally {
      this.reconcileWatchOutbox(settings, now);
    }
    return settings;
  }

  private reconcileWatchOutbox(settings: ReturnType<StoreWatch['watchSettings']>, now = new Date()): void {
    const queued = this.host.db
      .prepare(
        'SELECT q.id,q.sortie_id FROM kaji_outbox q JOIN watch_runs w ON w.sortie_id=q.sortie_id WHERE q.done IS NULL AND q.id NOT IN (SELECT id FROM worker_outbox_cancels) ORDER BY q.rowid LIMIT 20',
      )
      .all() as { id: string; sortie_id: string }[];
    for (const row of queued)
      if (!this.host.watch.authorized(row.sortie_id, settings.definition, settings.pilots))
        this.host.db
          .prepare('INSERT OR IGNORE INTO worker_outbox_cancels VALUES(?,?,?)')
          .run(row.id, 'Proactive definition, pilot or attempt authority changed.', now.toISOString());
  }

  watchIsQuiet(now = new Date()): boolean {
    try {
      const s = this.watchSettings();
      return watchQuiet(now, s.timeZone, s.definition.quietHours);
    } catch {
      return true;
    }
  }

  watchContext(sortieId: string): WatchWork | null {
    const row = this.host.watch.get(sortieId);
    if (!row) return null;
    const settings = this.syncWatch();
    const run = this.host.watch.get(sortieId)!;
    const trigger = settings.definition.triggers.find((t) => t.id === run.trigger),
      pilot = settings.pilots.find((p) => p.id === trigger?.pilot && !p.retired);
    return { ...run, readOnly: pilot?.stage !== 'production', ...(pilot ? { model: pilot.model } : {}) };
  }

  watchClaim(): WatchWork | null {
    this.syncWatch();
    const run = this.host.watch.claim();
    return run ? this.watchContext(run.sortieId) : null;
  }

  watchRecover(): number {
    const settings = this.syncWatch();
    const count = this.host.watch.interrupt(this.host.watchStarted);
    this.reconcileWatchOutbox(settings);
    return count;
  }

  verifyWatchOutboxAuthority(sortieId: string): boolean {
    const settings = this.syncWatch();
    this.host.watch.interrupt(this.host.watchStarted);
    this.reconcileWatchOutbox(settings);
    return this.host.watch.authorized(sortieId, settings.definition, settings.pilots);
  }

  watchPlan(sortieId: string): boolean {
    this.syncWatch();
    return this.host.watch.reserveStep(sortieId);
  }

  watchFinish(sortieId: string, status: 'done' | 'failed', reply: string, now = new Date()): boolean {
    if (typeof reply !== 'string' || !reply.trim() || reply.length > 4000)
      throw Error('Watch reply must contain 1–4000 characters.');
    this.syncWatch(now);
    return transaction(this.host.db, () => {
      if (!this.host.watch.finish(sortieId, status, now, reply)) return false;
      this.host.db
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
    return transaction(this.host.db, () => {
      const fallback =
        settings.language === 'it'
          ? 'Un controllo automatico è stato interrotto. Apri NERV per verificare cosa è successo.'
          : 'An automatic check was interrupted. Open NERV to inspect what happened.';
      this.host.db
        .prepare(
          "INSERT OR IGNORE INTO watch_notices SELECT 'completion:'||w.sortie_id,w.sortie_id,?,NULL FROM watch_runs w WHERE state='interrupted' AND NOT EXISTS (SELECT 1 FROM watch_notices n WHERE n.id='completion:'||w.sortie_id) LIMIT 20",
        )
        .run(fallback);
      if (this.watchIsQuiet(now)) return 0;
      const notices = this.host.db
        .prepare('SELECT id,message FROM watch_notices WHERE delivery_id IS NULL ORDER BY rowid LIMIT 20')
        .all() as { id: string; message: string }[];
      for (const notice of notices) {
        const delivery = this.host.addBrief(notice.message, now);
        this.host.db.prepare('UPDATE watch_notices SET delivery_id=? WHERE id=?').run(delivery.id, notice.id);
      }
      const approvals = this.host.db
        .prepare(
          'SELECT a.id FROM approvals a JOIN actions x ON x.id=a.action_id JOIN watch_runs w ON w.sortie_id=x.sortie_id WHERE a.decision IS NULL AND a.expires>? AND a.id NOT IN (SELECT approval_id FROM approval_deliveries) LIMIT 20',
        )
        .all(now.toISOString()) as { id: string }[];
      for (const approval of approvals) this.host.deliverApproval(approval.id, now);
      return notices.length;
    });
  }
}
