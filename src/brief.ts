import { runMessage, type InstrumentalityRun } from './instrumentality-runs.ts';
import { normalizeReminderKind, type ReminderKind } from './reminder-time.ts';
import type { StoreApi } from './runtime.ts';
/**
 * Hyuga's brief (F-003): a short daily summary built from facts in the ledger, not by a model, so it is quick and never
 * invents anything. It lists the cards waiting for the owner, reminders due in the next 24 hours, what finished or
 * failed since the previous brief, approvals that expired without a decision, and health problems. Times are shown in the
 * owner's time zone; every item carries its sortie's short ID (S-1A2B, as in the dashboard) to find its trace (F-028).
 */
export interface BriefInput {
  now: Date;
  timeZone: string;
  language: 'it' | 'en';
  base?: string;
  approvals: { tool: string; expires: string; sortie?: string }[];
  reminders: { title: string; due: string; kind?: ReminderKind | string; end?: string | null }[];
  sorties: { title: string; status: string; closed: string | null; id?: string }[];
  expired?: { tool: string; sortie: string; title: string }[];
  health: string[];
  instrumentality?: InstrumentalityRun;
  /** Every sortie closed since the last brief, counted by the scheduler (the sortie list above only names failures). */
  closed?: { done: number; failed: number };
  /** Sources the brief could not read: shown as such, never as "nothing" or "all fine" (B-006). */
  unavailable?: Source[];
}
export type Source = 'approvals' | 'reminders' | 'sorties' | 'health' | 'expired';
const words = {
  en: {
    title: "Hyuga's brief",
    greetings: ['Good morning', 'Good afternoon', 'Good evening'],
    needs: 'Needs you',
    none: 'Nothing waits for you.',
    expires: 'expires',
    due: 'Due in the next 24 h',
    noDue: 'No reminders in the next 24 h.',
    since: 'Since the last brief',
    done: 'done',
    failed: 'failed',
    quiet: 'Nothing finished or failed.',
    expired: 'Expired without your decision (nothing ran)',
    health: 'Health',
    ok: 'All checks pass.',
    unread: 'could not be read for this brief.',
  },
  it: {
    title: 'Il brief di Hyuga',
    greetings: ['Buongiorno', 'Buon pomeriggio', 'Buonasera'],
    needs: 'Ti aspettano',
    none: 'Nulla ti aspetta.',
    expires: 'scade',
    due: 'In scadenza nelle prossime 24 h',
    noDue: 'Nessun promemoria nelle prossime 24 h.',
    since: "Dall'ultimo brief",
    done: 'fatte',
    failed: 'fallite',
    quiet: 'Nulla di concluso o fallito.',
    expired: 'Scadute senza la tua decisione (nulla è stato eseguito)',
    health: 'Stato',
    ok: 'Tutti i controlli sono a posto.',
    unread: 'non leggibile per questo brief.',
  },
};
/** The sortie's short ID, as the dashboard shows it: the way to its trace. */
export const sortieRef = (id: string | undefined) => (id ? `S-${id.slice(0, 4).toUpperCase()} ` : '');
export function composeBrief(b: BriefInput): string {
  const w = words[b.language];
  const minutes = localClock(b.now, b.timeZone).minutes;
  const greeting = minutes < 360 ? undefined : w.greetings[minutes < 720 ? 0 : minutes < 1080 ? 1 : 2];
  const title = greeting ? `${greeting}. ${w.title}` : w.title;
  const locale = b.language === 'it' ? 'it-IT' : 'en-GB';
  const at = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: b.timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  const dayOnly = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: b.timeZone,
      weekday: 'short',
    }).format(new Date(iso));
  const clockOnly = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: b.timeZone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  const reminderWhen = (r: BriefInput['reminders'][number]) => {
    const kind = normalizeReminderKind(r.kind);
    const it = b.language === 'it';
    if (kind === 'all-day') return `${dayOnly(r.due)}, ${it ? 'tutto il giorno' : 'all day'}`;
    if (kind === 'from-to' && r.end) return `${dayOnly(r.due)}, ${clockOnly(r.due)}–${clockOnly(r.end)}`;
    if (kind === 'from') return `${dayOnly(r.due)}, ${it ? 'dalle' : 'from'} ${clockOnly(r.due)}`;
    if (kind === 'until') {
      const endIso = r.end ?? r.due;
      return `${dayOnly(endIso)}, ${it ? 'entro le' : 'until'} ${clockOnly(endIso)}`;
    }
    return at(r.due);
  };
  const soon = b.reminders
    .filter((r) => {
      const t = Date.parse(r.due);
      return t >= b.now.getTime() && t <= b.now.getTime() + 86_400_000;
    })
    .sort((x, y) => Date.parse(x.due) - Date.parse(y.due));
  const done = b.sorties.filter((s) => s.status === 'done'),
    failed = b.sorties.filter((s) => s.status === 'failed');
  const nDone = b.closed?.done ?? done.length,
    nFailed = b.closed?.failed ?? failed.length;
  const off = (k: Source) => b.unavailable?.includes(k) ?? false;
  const lines = [
    `☀️ ${title}${b.base ? ` · ${b.base}` : ''}`,
    '',
    ...(b.instrumentality ? [runMessage(b.instrumentality, b.language), ''] : []),
    ...(off('approvals')
      ? [`${w.needs}: ${w.unread}`]
      : [
          `${w.needs}: ${b.approvals.length}`,
          ...(b.approvals.length
            ? b.approvals.slice(0, 5).map((a) => `• ${sortieRef(a.sortie)}${a.tool} (${w.expires} ${at(a.expires)})`)
            : [w.none]),
        ]),
    ...(off('expired')
      ? ['', `${w.expired}: ${w.unread}`]
      : b.expired?.length
        ? [
            '',
            `${w.expired}: ${b.expired.length}`,
            ...b.expired.slice(0, 5).map((e) => `• ⌛ ${sortieRef(e.sortie)}${e.tool} · ${e.title}`),
          ]
        : []),
    '',
    ...(off('reminders')
      ? [`${w.due}: ${w.unread}`]
      : [
          `${w.due}: ${soon.length}`,
          ...(soon.length ? soon.slice(0, 8).map((r) => `• ${reminderWhen(r)} ${r.title}`) : [w.noDue]),
        ]),
    '',
    ...(off('sorties')
      ? [`${w.since}: ${w.unread}`]
      : [
          `${w.since}: ${nDone} ${w.done}, ${nFailed} ${w.failed}`,
          ...(failed.length
            ? failed.slice(0, 5).map((s) => `• ✗ ${sortieRef(s.id)}${s.title}`)
            : nDone || nFailed
              ? []
              : [w.quiet]),
        ]),
    '',
    `${w.health}: ${off('health') ? w.unread : b.health.length ? b.health.join('; ') : w.ok}`,
  ];
  return lines.join('\n').slice(0, 3500);
}
/** The local date (YYYY-MM-DD) and minutes since local midnight in the owner's time zone. */
export function localClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
/** Due once per local day, at or after `at` (HH:MM), and only if today's brief has not gone out yet. */
export function briefDue(now: Date, timeZone: string, at: string, lastSent: string | undefined): string | undefined {
  const [h, m] = at.split(':').map(Number);
  const clock = localClock(now, timeZone);
  return clock.minutes >= h! * 60 + m! && lastSent !== clock.date ? clock.date : undefined;
}
/** Reads the brief's facts through the store interface (the running service, or the CLI's local store). Each source is
 read on its own: one that fails is named in `unavailable`, and the brief says so instead of showing it as empty (B-006). */
export async function gatherBrief(
  store: Pick<StoreApi, 'approvals' | 'list' | 'sorties' | 'health' | 'expiredApprovals' | 'closedSince'>,
  since: Date,
): Promise<
  Pick<
    BriefInput,
    'approvals' | 'reminders' | 'sorties' | 'health' | 'expired' | 'closed' | 'unavailable' | 'instrumentality'
  >
> {
  const unavailable: Source[] = [];
  const read = async <T>(k: Source, f: () => T | Promise<T>): Promise<T | undefined> => {
    try {
      return await f();
    } catch {
      unavailable.push(k);
      return undefined;
    }
  };
  const [cards, reminders, closed, health, expired] = await Promise.all([
    read('approvals', () => store.approvals(5)),
    read('reminders', () => store.list()),
    read('sorties', async () => (store.closedSince ? await store.closedSince(since.toISOString()) : undefined)),
    read('health', () => store.health()),
    read('expired', () => store.expiredApprovals?.(since.toISOString()) ?? []),
  ]);
  // Without closedSince (an older store), the newest 50 sorties are the best available.
  const recent = closed
    ? undefined
    : unavailable.includes('sorties')
      ? []
      : await read('sorties', () => store.sorties(50));
  const p = (health as { processes?: { nervous?: number; brainAlive?: boolean } } | undefined)?.processes;
  const degraded = (health as { degraded?: unknown } | undefined)?.degraded;
  return {
    approvals: (cards ?? []).map((a) => ({ tool: a.card.tool, expires: a.card.expires, sortie: a.card.sortieId })),
    expired: (expired ?? []).map((e) => ({ tool: e.tool, sortie: e.sortieId, title: e.title })),
    reminders: (reminders ?? [])
      .filter((r) => !r.delivered && !r.cancelled)
      .map((r) => ({
        title: r.title,
        due: r.due,
        ...(r.kind && r.kind !== 'at' ? { kind: r.kind } : {}),
        ...(r.end ? { end: r.end } : {}),
      })),
    sorties: closed
      ? closed.failures.map((f) => ({ title: f.title, status: 'failed', closed: f.closed, id: f.id }))
      : (recent ?? [])
          .filter((s) => s.closed && Date.parse(s.closed) > since.getTime())
          .map((s) => ({ title: s.title, status: s.status, closed: s.closed, id: s.id })),
    ...(closed ? { closed: { done: closed.done, failed: closed.failed } } : {}),
    ...((health as { instrumentality?: InstrumentalityRun } | undefined)?.instrumentality
      ? { instrumentality: (health as { instrumentality: InstrumentalityRun }).instrumentality }
      : {}),
    health: [
      ...(p && p.brainAlive === false ? ['brain process not alive'] : []),
      ...(Array.isArray(degraded)
        ? degraded
            .filter(
              (d): d is string =>
                typeof d === 'string' &&
                (!(health as { instrumentality?: unknown })?.instrumentality || !d.startsWith('Instrumentality:')),
            )
            .slice(0, 3)
        : []),
    ],
    ...(unavailable.length ? { unavailable } : {}),
  };
}
