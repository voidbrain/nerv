import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { transaction } from './sqlite-transaction.ts';
import { localClock } from './brief.ts';
import type { Ledger } from './ledger.ts';
import type { Trust } from './policy.ts';
import type { Pilot, Stage } from './pilots.ts';

export type WatchSchedule = { everyMinutes: number } | { at: string } | { event: 'sortie.done' | 'sortie.failed' };
export interface WatchTrigger {
  id: string;
  request: string;
  schedule: WatchSchedule;
  maxActions: number;
  maxSteps: number;
  pilot?: string;
}
export interface QuietHours {
  from: string;
  until: string;
}
export interface WatchConfig {
  triggers: WatchTrigger[];
  quietHours?: QuietHours;
}
export interface WatchRun {
  trigger: string;
  slot: string;
  sortieId: string;
  request: string;
  maxSteps: number;
  state: 'pending' | 'running' | 'done' | 'failed' | 'interrupted' | 'cancelled';
  created: string;
  started: string | null;
  finished: string | null;
}
export interface WatchWork extends WatchRun {
  readOnly: boolean;
  model?: string;
}
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid watch object.');
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(value).some((k) => !allowed.includes(k))) throw Error('Unknown watch field.');
};
const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
/** Owner-authored definitions only. No model tool can create a trigger or select its trust stage. */
export function validateWatch(value: unknown): WatchConfig {
  const config = object(value);
  keys(config, ['triggers', 'quietHours']);
  if (!Array.isArray(config.triggers) || config.triggers.length > 20)
    throw Error('Watch supports at most 20 triggers.');
  const triggers: WatchTrigger[] = [];
  for (const value of config.triggers) {
    const t = object(value);
    keys(t, ['id', 'request', 'schedule', 'maxActions', 'maxSteps', 'pilot']);
    if (typeof t.id !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(t.id) || triggers.some((x) => x.id === t.id))
      throw Error('Watch trigger IDs must be unique lower-case identifiers.');
    if (typeof t.request !== 'string' || !t.request.trim() || t.request.length > 1000)
      throw Error('Watch request must contain 1–1000 characters.');
    if (!count(t.maxActions) || !count(t.maxSteps) || (t.maxActions as number) > (t.maxSteps as number))
      throw Error('Watch action/step budgets must be 1–6, actions no more than steps.');
    if (t.pilot !== undefined && (typeof t.pilot !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(t.pilot)))
      throw Error('Invalid watch pilot.');
    const schedule = object(t.schedule);
    if (Object.keys(schedule).length !== 1) throw Error('Choose one watch schedule.');
    let checked: WatchSchedule;
    if (
      typeof schedule.everyMinutes === 'number' &&
      Number.isInteger(schedule.everyMinutes) &&
      schedule.everyMinutes >= 1 &&
      schedule.everyMinutes <= 1440
    )
      checked = { everyMinutes: schedule.everyMinutes };
    else if (typeof schedule.at === 'string' && clock.test(schedule.at)) checked = { at: schedule.at };
    else if (schedule.event === 'sortie.done' || schedule.event === 'sortie.failed')
      checked = { event: schedule.event };
    else throw Error('Invalid watch heartbeat, daily time or event.');
    triggers.push({
      id: t.id,
      request: t.request.trim(),
      schedule: checked,
      maxActions: t.maxActions as number,
      maxSteps: t.maxSteps as number,
      ...(typeof t.pilot === 'string' ? { pilot: t.pilot } : {}),
    });
  }
  let quietHours: QuietHours | undefined;
  if (config.quietHours !== undefined) {
    const q = object(config.quietHours);
    keys(q, ['from', 'until']);
    if (
      typeof q.from !== 'string' ||
      typeof q.until !== 'string' ||
      !clock.test(q.from) ||
      !clock.test(q.until) ||
      q.from === q.until
    )
      throw Error('Quiet hours require two distinct HH:MM times.');
    quietHours = { from: q.from, until: q.until };
  }
  return { triggers, ...(quietHours ? { quietHours } : {}) };
}
const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function watchQuiet(now: Date, timeZone: string, quiet?: QuietHours): boolean {
  if (!quiet) return false;
  const { minutes } = localClock(now, timeZone),
    from = minute(quiet.from),
    until = minute(quiet.until);
  return from < until ? minutes >= from && minutes < until : minutes >= from || minutes < until;
}
/** Missed heartbeat buckets/days are not backfilled after downtime. Repeated DST hours share one daily identity. */
export function watchSlot(schedule: WatchSchedule, now: Date, timeZone: string): string | undefined {
  if (!Number.isFinite(now.getTime())) throw Error('Invalid watch clock.');
  const { date, minutes } = localClock(now, timeZone);
  if ('everyMinutes' in schedule) return 'heartbeat:' + Math.floor(now.getTime() / (schedule.everyMinutes * 60_000));
  if ('at' in schedule && minutes >= minute(schedule.at)) return 'day:' + date;
  return undefined;
}
const binding = (t: WatchTrigger, stage: Stage, model?: string) =>
  createHash('sha256')
    .update(JSON.stringify([t, stage, model ?? null]))
    .digest('hex');
const fields =
  'trigger_id AS trigger,slot,sortie_id AS sortieId,request,max_steps AS maxSteps,state,created,started,finished';
/** A-owned trigger admission, durable budgets and lifecycle; Runtime owns timers and planning. */
export class Watch {
  private readonly db: DatabaseSync;
  private readonly ledger: Ledger;
  constructor(db: DatabaseSync, ledger: Ledger) {
    this.db = db;
    this.ledger = ledger;
    db.exec(`CREATE TABLE IF NOT EXISTS watch_runs(trigger_id TEXT NOT NULL,slot TEXT NOT NULL,sortie_id TEXT NOT NULL UNIQUE REFERENCES sorties(id),request TEXT NOT NULL,max_steps INTEGER NOT NULL,definition TEXT NOT NULL,state TEXT NOT NULL,created TEXT NOT NULL,started TEXT,finished TEXT,PRIMARY KEY(trigger_id,slot));
   CREATE TABLE IF NOT EXISTS watch_steps(sortie_id TEXT PRIMARY KEY REFERENCES sorties(id),used INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS watch_notices(id TEXT PRIMARY KEY,sortie_id TEXT NOT NULL REFERENCES sorties(id),message TEXT NOT NULL,delivery_id TEXT UNIQUE REFERENCES deliveries(id));
   CREATE TABLE IF NOT EXISTS watch_cursors(trigger_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,sequence INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS watch_pending ON watch_runs(state,created);
   CREATE INDEX IF NOT EXISTS events_kind_sequence ON events(kind,sequence);`);
  }
  private reconcile(now: Date): void {
    this.db
      .prepare(
        "UPDATE watch_runs SET state=CASE (SELECT status FROM sorties WHERE id=sortie_id) WHEN 'done' THEN 'done' WHEN 'failed' THEN 'failed' ELSE 'cancelled' END,finished=coalesce((SELECT closed FROM sorties WHERE id=sortie_id),?) WHERE state IN ('pending','running') AND EXISTS (SELECT 1 FROM sorties WHERE id=sortie_id AND status<>'open')",
      )
      .run(now.toISOString());
  }
  admit(value: unknown, pilots: Pilot[], timeZone: string, now = new Date()): WatchRun[] {
    const config = validateWatch(value);
    localClock(now, timeZone);
    const stages = new Map<string, Stage>();
    let invalidPilot = false;
    for (const trigger of config.triggers) {
      const pilot = trigger.pilot ? pilots.find((p) => p.id === trigger.pilot && !p.retired) : undefined;
      if (trigger.pilot && !pilot) {
        invalidPilot = true;
        continue;
      }
      stages.set(trigger.id, pilot?.stage ?? 'prototype');
    }
    const admitted = transaction(this.db, () => {
      this.reconcile(now);
      const out: WatchRun[] = [];
      const definitions = new Map(
        config.triggers
          .filter((t) => stages.has(t.id))
          .map((t) => [t.id, binding(t, stages.get(t.id)!, pilots.find((p) => p.id === t.pilot)?.model)]),
      );
      const active = this.db
        .prepare("SELECT trigger_id,sortie_id,definition FROM watch_runs WHERE state IN ('pending','running')")
        .all() as { trigger_id: string; sortie_id: string; definition: string }[];
      for (const row of active)
        if (definitions.get(row.trigger_id) !== row.definition) {
          this.db
            .prepare("UPDATE watch_runs SET state='cancelled',finished=? WHERE sortie_id=?")
            .run(now.toISOString(), row.sortie_id);
          this.ledger.spear(row.sortie_id, 'Owner removed or changed the proactive definition or pilot stage.', now);
        }
      const subscribed = config.triggers.filter((t) => 'event' in t.schedule && stages.has(t.id)).map((t) => t.id);
      if (subscribed.length)
        this.db
          .prepare(`DELETE FROM watch_cursors WHERE trigger_id NOT IN (${subscribed.map(() => '?').join(',')})`)
          .run(...subscribed);
      else this.db.exec('DELETE FROM watch_cursors');
      if (invalidPilot) return out;
      let outstanding = (
        this.db.prepare("SELECT count(*) AS n FROM watch_runs WHERE state IN ('pending','running')").get() as {
          n: number;
        }
      ).n;
      const head = (this.db.prepare('SELECT coalesce(max(sequence),0) AS n FROM events').get() as { n: number }).n;
      for (const trigger of config.triggers) {
        const add = (slot: string, origin?: { source: string; trust: Trust }): boolean => {
          if (this.db.prepare('SELECT 1 FROM watch_runs WHERE trigger_id=? AND slot=?').get(trigger.id, slot))
            return true;
          if (outstanding >= 20) return false;
          const sortieId = this.ledger.openProactive(
            trigger.id,
            slot,
            trigger.request.slice(0, 500),
            { stage: stages.get(trigger.id)!, maxActions: trigger.maxActions },
            now,
          );
          if (origin) this.ledger.intake(sortieId, origin.source, origin.trust, now);
          this.db
            .prepare("INSERT INTO watch_runs VALUES(?,?,?,?,?,?,'pending',?,NULL,NULL)")
            .run(
              trigger.id,
              slot,
              sortieId,
              trigger.request,
              trigger.maxSteps,
              definitions.get(trigger.id)!,
              now.toISOString(),
            );
          out.push(this.get(sortieId)!);
          outstanding++;
          return true;
        };
        if ('event' in trigger.schedule) {
          const fingerprint = createHash('sha256').update(JSON.stringify(trigger)).digest('hex');
          const cursor = this.db
            .prepare('SELECT fingerprint,sequence FROM watch_cursors WHERE trigger_id=?')
            .get(trigger.id) as { fingerprint: string; sequence: number } | undefined;
          // New/changed event definitions begin at the current head, never replaying old unrelated activity.
          if (!cursor || cursor.fingerprint !== fingerprint) {
            this.db.prepare('INSERT OR REPLACE INTO watch_cursors VALUES(?,?,?)').run(trigger.id, fingerprint, head);
            continue;
          }
          const events = this.db
            .prepare(
              "SELECT e.sequence,s.trust FROM events e JOIN sorties s ON s.id=e.sortie_id WHERE e.sequence>? AND e.kind=? AND s.source<>'hyuga' ORDER BY e.sequence LIMIT 20",
            )
            .all(cursor.sequence, trigger.schedule.event) as { sequence: number; trust: Trust }[];
          for (const event of events) {
            if (!add('event:' + event.sequence, { source: 'event:' + event.sequence, trust: event.trust })) break;
            this.db.prepare('UPDATE watch_cursors SET sequence=? WHERE trigger_id=?').run(event.sequence, trigger.id);
          }
        } else {
          const slot = watchSlot(trigger.schedule, now, timeZone);
          if (slot) add(slot);
        }
      }
      return out;
    });
    if (invalidPilot) throw Error('Watch pilot is missing or retired; prior work for it was revoked.');
    return admitted;
  }
  authorized(sortieId: string, value: unknown, pilots: Pilot[]): boolean {
    const run = this.get(sortieId);
    if (!run || !['running', 'done'].includes(run.state)) return false;
    const row = this.db
      .prepare('SELECT w.definition,s.status FROM watch_runs w JOIN sorties s ON s.id=w.sortie_id WHERE w.sortie_id=?')
      .get(sortieId) as { definition: string; status: string } | undefined;
    if (!row || !['open', 'done'].includes(row.status)) return false;
    const trigger = validateWatch(value).triggers.find((t) => t.id === run.trigger);
    if (!trigger) return false;
    const pilot = pilots.find((p) => p.id === trigger.pilot && !p.retired);
    if (trigger.pilot && !pilot) return false;
    return row.definition === binding(trigger, pilot?.stage ?? 'prototype', pilot?.model);
  }
  get(sortieId: string): WatchRun | undefined {
    return this.db.prepare(`SELECT ${fields} FROM watch_runs WHERE sortie_id=?`).get(sortieId) as unknown as
      WatchRun | undefined;
  }
  claim(now = new Date()): WatchRun | null {
    return transaction(this.db, () => {
      this.reconcile(now);
      const row = this.db
        .prepare(`SELECT ${fields} FROM watch_runs WHERE state='pending' ORDER BY created,trigger_id,slot LIMIT 1`)
        .get() as unknown as WatchRun | undefined;
      if (!row) return null;
      this.db
        .prepare("UPDATE watch_runs SET state='running',started=? WHERE sortie_id=?")
        .run(now.toISOString(), row.sortieId);
      return this.get(row.sortieId)!;
    });
  }
  reserveStep(sortieId: string): boolean {
    return transaction(this.db, () => {
      const run = this.get(sortieId);
      if (run?.state !== 'running') return false;
      const sortie = this.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieId) as
        { status: string } | undefined;
      if (sortie?.status !== 'open') return false;
      const used =
        (
          this.db.prepare('SELECT used FROM watch_steps WHERE sortie_id=?').get(sortieId) as
            { used: number } | undefined
        )?.used ?? 0;
      if (used >= run.maxSteps) return false;
      this.db
        .prepare('INSERT INTO watch_steps VALUES(?,?) ON CONFLICT(sortie_id) DO UPDATE SET used=excluded.used')
        .run(sortieId, used + 1);
      return true;
    });
  }
  finish(sortieId: string, status: 'done' | 'failed', now = new Date(), reply?: string): boolean {
    return transaction(this.db, () => {
      const run = this.get(sortieId);
      if (run?.state !== 'running') return false;
      const sortie = this.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieId) as
        { status: string } | undefined;
      if (sortie?.status !== 'open') {
        const terminal = sortie?.status === 'done' ? 'done' : sortie?.status === 'failed' ? 'failed' : 'cancelled';
        this.db
          .prepare('UPDATE watch_runs SET state=?,finished=? WHERE sortie_id=?')
          .run(terminal, now.toISOString(), sortieId);
        return terminal === status;
      }
      if (
        this.db
          .prepare(
            'SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=? AND a.decision IS NULL',
          )
          .get(sortieId)
      )
        return false;
      if (reply) this.ledger.reply(sortieId, reply, now);
      if (!this.ledger.close(sortieId, status, now)) return false;
      this.db
        .prepare('UPDATE watch_runs SET state=?,finished=? WHERE sortie_id=?')
        .run(status, now.toISOString(), sortieId);
      return true;
    });
  }
  /** An unfinished attempt stays interrupted; losing the process never authorizes replay. */
  interrupt(before: Date, now = new Date()): number {
    return transaction(this.db, () => {
      this.reconcile(now);
      const rows = this.db
        .prepare(
          "SELECT w.sortie_id AS id,s.status FROM watch_runs w JOIN sorties s ON s.id=w.sortie_id WHERE w.state='running' AND w.started<? AND NOT EXISTS (SELECT 1 FROM events r WHERE r.sortie_id=w.sortie_id AND r.kind='misato.resumed' AND r.created>=?) AND coalesce((SELECT max(sequence) FROM events WHERE sortie_id=w.sortie_id AND kind='misato.waiting'),0)<=coalesce((SELECT max(sequence) FROM events WHERE sortie_id=w.sortie_id AND kind='misato.resumed'),0)",
        )
        .all(before.toISOString(), before.toISOString()) as { id: string; status: string }[];
      let interrupted = 0;
      for (const { id, status } of rows) {
        const terminal =
          status === 'open' ? 'interrupted' : status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'cancelled';
        this.db
          .prepare('UPDATE watch_runs SET state=?,finished=? WHERE sortie_id=?')
          .run(terminal, now.toISOString(), id);
        if (terminal === 'interrupted') {
          this.ledger.spear(
            id,
            'Proactive attempt interrupted; inspect prior effects before requesting new work.',
            now,
          );
          interrupted++;
        }
      }
      return interrupted;
    });
  }
}
