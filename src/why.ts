import { formatSortieTimings, type SortieTiming } from './timing.ts';
/**
 * One sentence of "why" per sortie (F-019): where it stands and the reason, from the ledger's facts only (no model), so
 * the dashboard can say it without opening the sortie. It speaks about the latest action, which decides what happens next.
 */
export interface WhyInput {
  status: string;
  actions: number;
  replied: boolean;
  spearReason?: string | undefined;
  last?:
    | {
        tool: string;
        outcome: 'grant' | 'approval' | 'reject';
        reason: string;
        decision: string | null;
        ran: 'done' | 'failed' | null;
        error?: string | undefined;
      }
    | undefined;
}
const clip = (text: string, max = 160) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
const stop = (text: string) => (/[.!?…]$/.test(text) ? text : text + '.');
export function explainSortie(w: WhyInput): string {
  const l = w.last;
  if (w.status === 'revoked')
    return (
      stop(clip('Stopped with the Spear' + (w.spearReason ? ': ' + w.spearReason : ''))) + ' Nothing more will run.'
    );
  if (!l) {
    if (w.status === 'open') return 'Misato is working on it; no action proposed yet.';
    if (w.status === 'failed') return 'Failed before any action was proposed.';
    return w.replied ? 'Answered without taking any action.' : 'Closed without taking any action.';
  }
  const more = w.actions > 1 ? ` (${w.actions} actions)` : '';
  if (l.ran === 'failed') return stop(clip(`${l.tool} failed: ${l.error ?? 'no reason recorded'}`));
  if (l.ran === 'done')
    return w.status === 'open'
      ? `${l.tool} ran; Misato is deciding the next step.`
      : `Done${more}: the last action, ${l.tool}, ran.`;
  if (l.outcome === 'reject') return stop(clip(`The MAGI refused ${l.tool}: ${l.reason}`));
  if (l.outcome === 'approval') {
    if (l.decision === null)
      return w.status === 'open'
        ? stop(clip(`Waits for you to approve ${l.tool}: ${l.reason}`))
        : `${l.tool} waited for your approval; the sortie closed first.`;
    if (l.decision === 'reject')
      return `You rejected ${l.tool}${w.status === 'open' ? '; Misato is deciding what to do instead' : ''}.`;
    if (l.decision === 'edit') return `You sent ${l.tool} back to Misato to change.`;
    if (l.decision === 'expired') return `Your approval for ${l.tool} expired; expiry never approves.`;
    if (l.decision === 'revoked') return `The card for ${l.tool} was stood down.`;
    if (l.decision === 'approve')
      return w.status === 'open' ? `You approved ${l.tool}; it is running.` : `You approved ${l.tool}.`;
  }
  return w.status === 'open' ? `${l.tool} was cleared to run; it is running.` : `${l.tool} was cleared to run.`;
}

/**
 * "Why S-1A2B …?" (B-004): the question names a sortie by the short ID the dashboard, the brief and Aoba show. Answered from
 * the ledger only, never by a model, so nothing is invented. Returns the ID's hex prefix, lower-case, or undefined.
 */
export function askedWhy(text: string): string | undefined {
  if (!/(?<![\p{L}])(why|how come|explain|perch[eé]|perche'|come mai|spiega(mi)?)(?![\p{L}])/iu.test(text))
    return undefined;
  return /\bS-([0-9a-f]{4,12})\b/i.exec(text)?.[1]?.toLowerCase();
}
/**
 * F-042: whether a request asks about the agency itself (sorties, ballots, pending approvals/questions, or base health
 * and status). The consultant is not asked for these: Misato reads the records directly with her read-only tools.
 */
export function isAgencyQuestion(text: string, bases: { id: string; name: string }[] = []): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\bS-[0-9a-f]{4,12}\b/i.test(t)) return true;
  if (/\b(remind(\s+me)?|ricordami|ricorda|remember|add\s+a\s+reminder|aggiungi)\b/iu.test(t)) return false;
  if (
    /\b(sorties?|ballots?|votazion[ei]|magi|casper|melchior|balthasar|pending\s+approvals?|approval\s+cards?|approvazioni\s+in\s+attesa|schede\s+in\s+attesa)\b/iu.test(
      t,
    )
  )
    return true;
  if (
    /\b(what('s|\s+is)\s+waiting(\s+for\s+me)?|anything\s+waiting(\s+for\s+me)?|waiting\s+for\s+(me|my\s+approval)|cosa\s+(c['’]è\s+|sta\s+)?in\s+attesa|cosa\s+mi\s+aspetta|qualcosa\s+in\s+attesa)\b/iu.test(
      t,
    )
  )
    return true;
  if (
    /\b((agency|base|bases)\s+(status|health)|(status|health)\s+of\s+(the\s+)?(agency|bases?)|how\s+(is|are)\s+(the\s+)?(agency|this\s+base|bases?)|(stato|salute)\s+(dell['’]agenzia|dell[ae]\s+bas[ei])|come\s+(sta|va|stanno)\s+(l['’]agenzia|l[ae]\s+bas[ei]))\b/iu.test(
      t,
    )
  )
    return true;
  if (
    /^\s*(?:is|are)\s+[\p{L}\p{N}_-]{2,40}\s+(?:up|down|online|offline|reachable|healthy|degraded|alive)\s*[?.!]*$/iu.test(
      t,
    ) ||
    /^\s*[\p{L}\p{N}_-]{2,40}\s+è\s+(?:online|offline|attiv[ao]|raggiungibile|degradat[ao]|su|giù)\s*[?.!]*$/iu.test(t)
  )
    return true;
  const lower = t.toLowerCase();
  const namesBase = bases.some(
    (b) =>
      (b.id && lower.includes(b.id.toLowerCase())) ||
      (b.name && b.name.length >= 2 && lower.includes(b.name.toLowerCase())),
  );
  if (
    namesBase &&
    /\b(up|down|online|offline|status|stato|health|salute|reachable|raggiungibile|degraded|degradat[ao]|how\s+is|come\s+sta)\b/iu.test(
      t,
    )
  )
    return true;
  return false;
}
/** What the ledger holds for one sortie, as the "why" answer needs it. */
export interface WhyRecord {
  id: string;
  title: string;
  status: string;
  why: string;
  advice?: { text: string; model: string } | undefined;
  /** B-011: what other bases did with actions this sortie sent them. */
  remote?: string[] | undefined;
  /** F-052: per-role/step durations recorded on this sortie. */
  timings?: SortieTiming[] | undefined;
  actions: {
    tool: string;
    pattern: string;
    outcome: 'grant' | 'approval' | 'reject';
    reason: string;
    verdicts: { seat: string; vote: string; reason: string; shadow?: boolean }[];
    decision: string | null;
    decided: string | null;
    source: string | null;
    ran: 'done' | 'failed' | null;
    error?: string | undefined;
  }[];
}
const WORDS = {
  en: {
    none: (r: string) => `No sortie S-${r} in this base's records.`,
    many: (r: string, n: number) => `${n} sorties start with S-${r}; give more of the ID.`,
    pattern: 'Pattern',
    ballot: 'Ballot',
    shadow: 'shadow, not counted',
    outcome: { grant: 'cleared to run', approval: 'needed your approval', reject: 'refused by the MAGI' },
    vote: { approve: 'approve', reject: 'reject', abstain: 'abstain' } as Record<string, string>,
    decision: {
      approve: 'You approved it',
      reject: 'You rejected it',
      edit: 'You sent it back to change',
      expired: 'Your approval expired (expiry never approves)',
      revoked: 'The card was stood down',
    } as Record<string, string>,
    waiting: 'It is waiting for your decision.',
    ran: 'It ran.',
    failed: 'It failed',
    via: 'via',
    on: 'on',
    advice: 'Consultant',
    noActions: 'No action was proposed.',
    status: 'Status',
    timings: 'Timings',
    source: { telegram: 'Telegram', api: 'the dashboard', cli: 'the terminal', ttl: 'expiry' } as Record<
      string,
      string
    >,
  },
  it: {
    none: (r: string) => `Nessuna sortie S-${r} nei registri di questa base.`,
    many: (r: string, n: number) => `${n} sortie iniziano con S-${r}: indica più caratteri dell'ID.`,
    pattern: 'Pattern',
    ballot: 'Votazione',
    shadow: 'ombra, non conta',
    outcome: { grant: 'autorizzata', approval: 'richiedeva la tua approvazione', reject: 'rifiutata dai MAGI' },
    vote: { approve: 'approva', reject: 'rifiuta', abstain: 'si astiene' } as Record<string, string>,
    decision: {
      approve: "L'hai approvata",
      reject: "L'hai rifiutata",
      edit: "L'hai rimandata a Misato da modificare",
      expired: 'La tua approvazione è scaduta (la scadenza non approva mai)',
      revoked: 'La scheda è stata ritirata',
    } as Record<string, string>,
    waiting: 'Aspetta la tua decisione.',
    ran: 'È stata eseguita.',
    failed: 'È fallita',
    via: 'da',
    on: 'il',
    advice: 'Consulente',
    noActions: 'Nessuna azione proposta.',
    status: 'Stato',
    timings: 'Tempi',
    source: { telegram: 'Telegram', api: 'la dashboard', cli: 'il terminale', ttl: 'scadenza' } as Record<
      string,
      string
    >,
  },
};
/** Seat IDs as the owner reads them: melchior → Melchior, tabgha:casper → Tabgha:Casper. */
const seatName = (seat: string) =>
  seat.replace(/^extra:/i, '').replace(/(^|[^\p{L}])(\p{L})/gu, (_, b: string, c: string) => b + c.toUpperCase());
const bare = (text: string) => text.replace(/[.\s]+$/, '');
const when = (iso: string, timeZone: string, lang: 'it' | 'en') => {
  try {
    return new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
};
/** The answer, in the request's language: the sortie, then each action with its Pattern, every seat's vote and reason
 (shadow seats marked as not counted), the outcome, the owner's decision with when and where, and what ran. */
export function explainRecord(
  found: { found: 'none' | 'many'; count?: number } | { found: 'one'; record: WhyRecord },
  ref: string,
  lang: 'it' | 'en',
  timeZone: string,
): string {
  const w = WORDS[lang];
  const short = ref.slice(0, 4).toUpperCase();
  if (found.found !== 'one') return found.found === 'none' ? w.none(short) : w.many(short, found.count ?? 2);
  const r = found.record;
  const lines = [`S-${r.id.slice(0, 4).toUpperCase()} · “${clip(r.title, 120)}” · ${w.status}: ${r.status}.`];
  if (r.advice) lines.push(`${w.advice}${r.advice.model ? ` (${r.advice.model})` : ''}: ${clip(r.advice.text, 300)}`);
  if (!r.actions.length) lines.push(w.noActions);
  for (const a of r.actions) {
    lines.push(
      '',
      `${a.tool} · ${w.pattern} ${a.pattern}: ${w.outcome[a.outcome]}${a.reason ? ` (${bare(clip(a.reason, 200))})` : ''}.`,
    );
    if (a.verdicts.length)
      lines.push(
        `${w.ballot}: ` +
          a.verdicts
            .map(
              (v) =>
                `${seatName(v.seat)} ${w.vote[v.vote] ?? v.vote}${v.shadow ? ` (${w.shadow})` : ''}${v.reason ? ` — ${bare(clip(v.reason, 140))}` : ''}`,
            )
            .join('; ') +
          '.',
      );
    if (a.decision)
      lines.push(
        `${w.decision[a.decision] ?? a.decision}${a.decided ? ` ${w.on} ${when(a.decided, timeZone, lang)}` : ''}${a.source && a.decision !== 'expired' ? ` ${w.via} ${w.source[a.source] ?? a.source}` : ''}.`,
      );
    else if (a.outcome === 'approval' && !a.ran) lines.push(w.waiting);
    if (a.ran === 'done') lines.push(w.ran);
    else if (a.ran === 'failed') lines.push(stop(clip(`${w.failed}: ${a.error ?? '—'}`)));
  }
  for (const t of r.remote ?? []) lines.push('', `Kaji: ${clip(t, 300)}`);
  if (r.timings?.length) lines.push('', `${w.timings}: ${formatSortieTimings(r.timings, lang)}.`);
  return lines.join('\n').slice(0, 3500);
}
