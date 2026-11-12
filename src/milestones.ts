import type { DatabaseSync } from 'node:sqlite';
import { STAGES, type Stage } from './pilots.ts';
/**
 * Milestones the agency did not store before F-054-T04, recorded from the change onward (no backfill): a base seen
 * online for the first time, a base or a model route going down and coming back, and a pilot promoted to a later stage.
 * Append-only like the ledger's events and the registry: a correction is a new row, never an edit.
 */
export const MILESTONE_SCHEMA = `
 CREATE TABLE IF NOT EXISTS milestones(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '');
 CREATE INDEX IF NOT EXISTS milestones_subject ON milestones(subject,kind,id);
 CREATE TRIGGER IF NOT EXISTS milestones_no_update BEFORE UPDATE ON milestones BEGIN SELECT RAISE(ABORT,'milestones are append-only'); END;
 CREATE TRIGGER IF NOT EXISTS milestones_no_delete BEFORE DELETE ON milestones BEGIN SELECT RAISE(ABORT,'milestones are append-only'); END;`;
export type RecordedKind = 'base.online' | 'base.down' | 'base.back' | 'route.down' | 'route.back' | 'pilot.promoted';
export interface RecordedMilestone {
  id: number;
  at: string;
  kind: RecordedKind;
  /** The base ID, the route (`local` or `cloud`) or the pilot ID. */
  subject: string;
  /** The pilot's name when it was promoted; empty for bases and routes (named from the registry when shown). */
  label: string;
  /** Minutes down for a recovery, `from>to` for a promotion. */
  detail: string;
}
export const hasMilestones = (db: DatabaseSync) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='milestones'").get();
const iso = (at: string) => new Date(Date.parse(at)).toISOString();
function add(db: DatabaseSync, at: string, kind: RecordedKind, subject: string, label = '', detail = '') {
  db.prepare('INSERT INTO milestones(at,kind,subject,label,detail) VALUES(?,?,?,?,?)').run(
    iso(at),
    kind,
    subject,
    label,
    detail,
  );
}
/**
 * A base heard of for the first time on this base. `known` says whether a last-seen time was already stored before
 * this update: a base seen before this change was made is never recorded (no backfill), and neither is a second time.
 */
export function recordFirstOnline(db: DatabaseSync, baseId: string, at: string, known: boolean): boolean {
  if (known || !hasMilestones(db) || !Number.isFinite(Date.parse(at))) return false;
  if (db.prepare("SELECT 1 FROM milestones WHERE subject=? AND kind='base.online'").get(baseId)) return false;
  add(db, at, 'base.online', baseId);
  return true;
}
/**
 * A base or model route answering (`ok`) or not. Only a change is recorded: down when the last record for it is not
 * already down, back (with the minutes it was down) when it is. A report not newer than the last record is ignored, so
 * the same report sent twice, or one that arrives late, never adds a row. A route first seen working is not news.
 */
export function recordHealth(
  db: DatabaseSync,
  scope: 'base' | 'route',
  subject: string,
  ok: boolean,
  at: string,
): RecordedKind | undefined {
  if (!hasMilestones(db) || !Number.isFinite(Date.parse(at))) return undefined;
  const down = `${scope}.down` as const,
    back = `${scope}.back` as const;
  const last = db
    .prepare('SELECT kind,at FROM milestones WHERE subject=? AND kind IN (?,?) ORDER BY id DESC LIMIT 1')
    .get(subject, down, back) as { kind: RecordedKind; at: string } | undefined;
  if (last && Date.parse(at) <= Date.parse(last.at)) return undefined;
  if (!ok && last?.kind !== down) {
    add(db, at, down, subject);
    return down;
  }
  if (ok && last?.kind === down) {
    add(db, at, back, subject, '', String(Math.max(1, Math.round((Date.parse(at) - Date.parse(last.at)) / 60_000))));
    return back;
  }
  return undefined;
}
/** A pilot moved to a later trust stage; the same stage or an earlier one is not a promotion. */
export function recordPromotion(
  db: DatabaseSync,
  pilot: { id: string; name: string },
  from: string,
  to: string,
  at: string,
): boolean {
  const a = STAGES.indexOf(from as Stage),
    b = STAGES.indexOf(to as Stage);
  if (a < 0 || b <= a || !hasMilestones(db)) return false;
  add(db, at, 'pilot.promoted', pilot.id, pilot.name, `${from}>${to}`);
  return true;
}
export function recordedMilestones(db: DatabaseSync): RecordedMilestone[] {
  if (!hasMilestones(db)) return [];
  return db
    .prepare('SELECT id,at,kind,subject,label,detail FROM milestones ORDER BY id')
    .all() as unknown as RecordedMilestone[];
}
