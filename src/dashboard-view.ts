/**
 * F-130-T01: framework-free feed parsing for the workspace dashboard. The Angular live feed (web/src/live-feed.ts)
 * maps the service's replies with these helpers and keeps unchanged values by identity, so a poll that changes
 * nothing changes no signal and touches no DOM (the live-view rule, docs/STYLE-GUIDE.md). live.js keeps its own copy
 * of mapStatus, toSortie and toApproval until its sections move (F-130-T02 to F-130-T12).
 */

/** A sortie as GET /api/sorties returns it (src/ledger.ts, SortieSummary). */
export interface FeedSortie {
  id: string;
  source: string;
  title: string;
  trust: string;
  status: string;
  created: string;
  closed: string | null;
  actions: number;
  waiting: number;
  patterns: string[];
  why: string;
  question?: { text: string; expires: string };
}

/** A pending approval as GET /api/approvals returns it (src/ledger.ts, Approval). */
export interface FeedApproval {
  id: string;
  card: {
    sortieId: string;
    actionId: string;
    tool: string;
    args: Record<string, unknown>;
    effect: string;
    pattern: string;
    reason: string;
    expires: string;
  };
  expires: string;
  decision: string | null;
}

export type SortieStatus = 'waiting' | 'active' | 'done' | 'failed' | 'stood-down';

export interface SortieRow {
  id: string;
  realId: string;
  title: string;
  pilot: 'misato' | 'owner';
  status: SortieStatus;
  trust: string;
  why: string;
  created: string;
  started: number;
  ended: number | null;
  actions: number;
  waiting: number;
}

export interface ApprovalRow {
  id: string;
  sortie: string;
  tool: string;
  effect: string;
  pattern: string;
  reason: string;
  expires: number;
}

export type HealthGlance = 'ok' | 'degraded' | 'issue' | 'unknown';

/** Same rule as live.js: an open sortie waits when it has a waiting card or an open question. */
export function mapStatus(s: Pick<FeedSortie, 'status' | 'waiting' | 'question'>): SortieStatus {
  if (s.status === 'open') return s.waiting || s.question ? 'waiting' : 'active';
  if (s.status === 'done') return 'done';
  if (s.status === 'failed') return 'failed';
  return 'stood-down';
}

/** The short sortie name the dashboard shows: S- and the first four characters of its id. */
export function shortId(id: string): string {
  return 'S-' + id.slice(0, 4).toUpperCase();
}

export function toSortie(s: FeedSortie): SortieRow {
  return {
    id: shortId(s.id),
    realId: s.id,
    title: s.title,
    pilot: s.source === 'misato' ? 'misato' : 'owner',
    status: mapStatus(s),
    trust: s.trust,
    why: s.why || '',
    created: s.created,
    started: Date.parse(s.created),
    ended: s.closed ? Date.parse(s.closed) : null,
    actions: s.actions,
    waiting: s.waiting,
  };
}

export function toApproval(a: FeedApproval): ApprovalRow {
  const c = a.card;
  return {
    id: a.id,
    sortie: shortId(c.sortieId),
    tool: c.tool,
    effect: c.effect,
    pattern: c.pattern,
    reason: c.reason,
    expires: Date.parse(c.expires),
  };
}

/** Same rule as live.js renderQuestions: a process down is an issue, a degraded check is degraded. */
export function healthGlance(doctor: unknown): HealthGlance {
  if (!doctor || typeof doctor !== 'object') return 'unknown';
  const d = doctor as { processes?: { nervous?: boolean; brainAlive?: boolean }; degraded?: unknown[] };
  const p = d.processes ?? {};
  if (!p.nervous || p.brainAlive === false) return 'issue';
  return Array.isArray(d.degraded) && d.degraded.length > 0 ? 'degraded' : 'ok';
}

/** Structural equality for JSON values: what a poll returns. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((v, i) => sameValue(v, other[i]));
  }
  const ka = Object.keys(a),
    kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) => Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}

/**
 * Keyed merge: each row of `next` that equals the row with the same key in `prev` is replaced by that previous
 * object, and when nothing was added, removed, moved or changed the previous list itself is returned. A signal set
 * with the result and `equal: Object.is` then does not notify, and `@for (…; track key)` keeps every row's DOM.
 */
export function keyed<T>(prev: readonly T[], next: readonly T[], key: (row: T) => string): readonly T[] {
  const before = new Map(prev.map((row) => [key(row), row]));
  let same = prev.length === next.length;
  const merged = next.map((row, i) => {
    const old = before.get(key(row));
    const kept = old !== undefined && sameValue(old, row) ? old : row;
    if (kept !== prev[i]) same = false;
    return kept;
  });
  return same ? prev : merged;
}

/** The longest notification the stream may leave unfinished, as in live.js. */
export const STREAM_BOUND = 8192;

/**
 * Reads one chunk of GET /api/dashboard/stream: server-sent messages separated by a blank line. Returns what is
 * still unfinished and whether a `refresh` event arrived. The stream only says that something changed; the feed then
 * re-reads its pages, so a missed message costs one poll, never a wrong state.
 */
export function readStream(pending: string, chunk: string): { pending: string; refresh: boolean } {
  let rest = pending + chunk,
    refresh = false,
    end: number;
  while ((end = rest.indexOf('\n\n')) >= 0) {
    if (rest.slice(0, end).split('\n').includes('event: refresh')) refresh = true;
    rest = rest.slice(end + 2);
  }
  if (rest.length > STREAM_BOUND) throw new Error('Dashboard notification exceeds bound.');
  return { pending: rest, refresh };
}
