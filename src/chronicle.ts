import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Registry, canonical } from './kaji.ts';
import { sortieRef } from './brief.ts';
import { recordedMilestones } from './milestones.ts';
import { ROUTE_NAME } from './route-health.ts';
import type { RouteName } from './model.ts';
/**
 * The base chronicle (F-054): one entry per local day, built only from milestones the agency recorded, never from a
 * model, so it cannot invent anything. This is the Simple version; the Eva retelling (F-054-T02) works from the same
 * entries. Every line names its source: a registry record or a sortie, so the owner can check it.
 *
 * Recorded today: a base enrolled, re-enrolled or revoked and a new main base (signed registry records, dated by the
 * time the root signed them), a pilot created (an approved `pilots.create` that ran), and the first action that ran on
 * another base (a remote action whose result says it ran without an error). Since F-054-T04 also, from that change on and
 * without backfill (src/milestones.ts): a base online for the first time, a base or model route down and back, and a
 * pilot promoted to a later stage.
 */
export type MilestoneKind =
  | 'base.enrolled'
  | 'base.reenrolled'
  | 'base.revoked'
  | 'base.main'
  | 'pilot.created'
  | 'remote.first'
  | 'base.online'
  | 'base.down'
  | 'base.back'
  | 'route.down'
  | 'route.back'
  | 'pilot.promoted';
export interface Milestone {
  /** When it happened, ISO 8601. */
  at: string;
  kind: MilestoneKind;
  /** The base or pilot it is about, as the owner named it. */
  subject: string;
  /** The base ID, the pilot's domain or the remote tool. */
  detail: string;
  /** Where it is recorded: `registry:<first 8 hex>`, a sortie's short ID or `milestone:<row id>`. */
  source: string;
}
export interface ChronicleDay {
  /** The owner's local date, YYYY-MM-DD. */
  day: string;
  milestones: Milestone[];
}
const KINDS = new Set<MilestoneKind>([
  'base.enrolled',
  'base.reenrolled',
  'base.revoked',
  'base.main',
  'pilot.created',
  'remote.first',
  'base.online',
  'base.down',
  'base.back',
  'route.down',
  'route.back',
  'pilot.promoted',
]);
/** The owner's local calendar date of an instant. */
export function localDay(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(at),
  );
}
/**
 * Groups milestones by the owner's local day, newest day first and each day in the order things happened. A day with
 * nothing recorded has no entry. Milestones before `since` or with an unreadable time are left out.
 */
export function chronicleDays(milestones: Milestone[], timeZone: string, since?: Date): ChronicleDay[] {
  const days = new Map<string, Milestone[]>();
  const valid = milestones
    .filter((m) => KINDS.has(m.kind) && Number.isFinite(Date.parse(m.at)))
    .filter((m) => !since || Date.parse(m.at) >= since.getTime())
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.source.localeCompare(b.source));
  for (const m of valid) {
    const day = localDay(m.at, timeZone);
    days.set(day, [...(days.get(day) ?? []), m]);
  }
  return [...days].map(([day, list]) => ({ day, milestones: list })).sort((a, b) => b.day.localeCompare(a.day));
}
const words = {
  en: {
    title: 'Base chronicle',
    empty: 'Nothing recorded yet.',
    line: {
      'base.enrolled': (m: Milestone) => `${m.subject} (${m.detail}) joined the agency.`,
      'base.reenrolled': (m: Milestone) => `${m.subject} (${m.detail}) was enrolled again with a new key or address.`,
      'base.revoked': (m: Milestone) => `${m.subject} (${m.detail}) was revoked.`,
      'base.main': (m: Milestone) => `${m.subject} (${m.detail}) became the main base.`,
      'pilot.created': (m: Milestone) => `New pilot: ${m.subject}, for ${m.detail}.`,
      'remote.first': (m: Milestone) => `First action run on ${m.subject}: ${m.detail}.`,
      'base.online': (m: Milestone) => `${m.subject} (${m.detail}) came online for the first time.`,
      'base.down': (m: Milestone) => `${m.subject} (${m.detail}) stopped answering on the Kaji line.`,
      'base.back': (m: Milestone) => `${m.subject} answered again after ${m.detail} min.`,
      'route.down': (m: Milestone) => `The ${m.subject} went down.`,
      'route.back': (m: Milestone) => `The ${m.subject} came back after ${m.detail} min.`,
      'pilot.promoted': (m: Milestone) => `Pilot ${m.subject} promoted: ${m.detail.replace('>', ' to ')}.`,
    },
  },
  it: {
    title: 'Cronaca della base',
    empty: 'Ancora nulla di registrato.',
    line: {
      'base.enrolled': (m: Milestone) => `La base ${m.subject} (${m.detail}) è entrata nell'agenzia.`,
      'base.reenrolled': (m: Milestone) =>
        `La base ${m.subject} (${m.detail}) è stata registrata di nuovo con una nuova chiave o un nuovo indirizzo.`,
      'base.revoked': (m: Milestone) => `La base ${m.subject} (${m.detail}) è stata revocata.`,
      'base.main': (m: Milestone) => `La base ${m.subject} (${m.detail}) è diventata la base principale.`,
      'pilot.created': (m: Milestone) => `Nuovo pilota: ${m.subject}, per ${m.detail}.`,
      'remote.first': (m: Milestone) => `Prima azione eseguita su ${m.subject}: ${m.detail}.`,
      'base.online': (m: Milestone) => `La base ${m.subject} (${m.detail}) è online per la prima volta.`,
      'base.down': (m: Milestone) => `La base ${m.subject} (${m.detail}) non risponde più sulla linea Kaji.`,
      'base.back': (m: Milestone) => `La base ${m.subject} risponde di nuovo dopo ${m.detail} min.`,
      'route.down': (m: Milestone) => `La ${m.subject} è caduta.`,
      'route.back': (m: Milestone) => `La ${m.subject} è tornata dopo ${m.detail} min.`,
      'pilot.promoted': (m: Milestone) => `Il pilota ${m.subject} è promosso: ${m.detail.replace('>', ' a ')}.`,
    },
  },
};
/** The Simple chronicle as plain text: one block per day, each line with its source in brackets. */
export function composeChronicle(days: ChronicleDay[], language: 'it' | 'en'): string {
  const w = words[language];
  if (!days.length) return `${w.title}\n${w.empty}`;
  return [
    w.title,
    ...days.map((d) => [d.day, ...d.milestones.map((m) => `• ${w.line[m.kind](m)} [${m.source}]`)].join('\n')),
  ].join('\n\n');
}
const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
/**
 * Reads the recorded milestones from the agency's database: the registry under the pinned root (each record's
 * signature checked again), approved pilots that were created, and per base the first remote action that ran.
 */
export function gatherMilestones(db: DatabaseSync, root?: string): Milestone[] {
  const out: Milestone[] = [];
  const names = new Map<string, string>();
  const enrolled = new Set<string>();
  if (root) {
    const registry = new Registry(db, root);
    for (const record of registry.records()) {
      const b = record.body;
      if (b.kind === 'enrol' && b.name) names.set(b.baseId, b.name);
      // The stored registry ID is the SHA-256 of the canonical signed record (Registry.add).
      const source = 'registry:' + createHash('sha256').update(canonical(record)).digest('hex').slice(0, 8);
      const subject = clip(names.get(b.baseId) ?? b.baseId, 40);
      if (b.kind === 'enrol') {
        out.push({
          at: b.issued,
          kind: enrolled.has(b.baseId) ? 'base.reenrolled' : 'base.enrolled',
          subject,
          detail: b.baseId,
          source,
        });
        enrolled.add(b.baseId);
      } else
        out.push({
          at: b.issued,
          kind: b.kind === 'main' ? 'base.main' : 'base.revoked',
          subject,
          detail: b.baseId,
          source,
        });
    }
  }
  const pilots = db
    .prepare(
      "SELECT a.sortie_id AS sortie, a.args AS args, e.created AS at FROM events e JOIN actions a ON a.id=e.action_id WHERE e.kind='action.done' AND a.tool='pilots.create' ORDER BY e.sequence",
    )
    .all() as { sortie: string; args: string; at: string }[];
  for (const p of pilots) {
    const args = JSON.parse(p.args) as { name?: unknown; id?: unknown; domain?: unknown };
    const name = typeof args.name === 'string' ? args.name : typeof args.id === 'string' ? args.id : 'a pilot';
    const domain = typeof args.domain === 'string' ? args.domain : '';
    out.push({
      at: p.at,
      kind: 'pilot.created',
      subject: clip(name, 40),
      detail: clip(domain, 80),
      source: sortieRef(p.sortie).trim(),
    });
  }
  // Per base, the earliest remote action whose result says it ran and did not fail.
  const remote = db
    .prepare(
      "SELECT base, tool, sortie_id AS sortie, MIN(done) AS at FROM kaji_outbox WHERE done IS NOT NULL AND json_valid(result) AND json_extract(result,'$.outcome')='grant' AND json_type(result,'$.error') IS NULL GROUP BY base",
    )
    .all() as { base: string; tool: string; sortie: string; at: string }[];
  for (const r of remote)
    out.push({
      at: r.at,
      kind: 'remote.first',
      subject: clip(names.get(r.base) ?? r.base, 40),
      detail: clip(r.tool, 80),
      source: sortieRef(r.sortie).trim(),
    });
  // F-054-T04: milestones recorded as they happen, from that change on.
  for (const r of recordedMilestones(db)) {
    const source = `milestone:${r.id}`;
    if (r.kind === 'pilot.promoted')
      out.push({ at: r.at, kind: r.kind, subject: clip(r.label || r.subject, 40), detail: r.detail, source });
    else if (r.kind === 'route.down' || r.kind === 'route.back')
      out.push({
        at: r.at,
        kind: r.kind,
        subject: ROUTE_NAME[r.subject as RouteName] ?? clip(r.subject, 40),
        detail: r.detail,
        source,
      });
    else
      out.push({
        at: r.at,
        kind: r.kind,
        subject: clip(names.get(r.subject) ?? r.subject, 40),
        detail: r.kind === 'base.back' ? r.detail : r.subject,
        source,
      });
  }
  return out;
}
