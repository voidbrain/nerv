/**
 * F-147: the coordinator's live index (every project's backlog, rebuilt from git) on NERV's dashboard. It is read
 * through NERV's MCP registry like any server: registered as `coordinator`, its read tools granted as reads (Green),
 * called by the tools process only while the grant's fingerprint holds. NERV keeps no copy: each read asks the index.
 * The interface is the "Live index contract" (version 1) in the coordinator's docs/SOLUTION.md. This file is the
 * answer's shape and reading, shared by the service and the card; the service's read is `readLiveIndex` (runtime-tools).
 */
const VERSION = 1;

export interface LiveIndexItem {
  /** `repo:ID`, for keyed rows only: the card shows the title, the repository and the source link. */
  key: string;
  repo: string;
  title: string;
  /** The file on GitHub at the commit it was read from; null when the index has none or it is not a GitHub link. */
  url: string | null;
}
export interface LiveIndexTurn extends LiveIndexItem {
  ownerKind: string;
  /** Open items whose prerequisites name this step: what the owner's turn unblocks. */
  blocks: LiveIndexItem[];
}
export type LiveIndexView =
  | {
      state: 'ready';
      /** The index's own screen. */
      screen: string;
      /** The oldest read time of the repositories in the index (ISO), or null before the first. */
      snapshot: string | null;
      /** Repositories the index could not read: their work is unknown, never none. */
      unknown: { repo: string; reason: string }[];
      turn: LiveIndexTurn[];
    }
  | { state: 'not-set-up'; commands: string[] }
  /** F-159: the module is off: nothing is asked of the index, and the card hides. */
  | { state: 'off' }
  | { state: 'offline'; screen: string; reason: string }
  | { state: 'failed'; reason: string };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const link = (v: unknown) => (typeof v === 'string' && /^https:\/\/github\.com\/[^\s"<>]+$/.test(v) ? v : null);

/** One answer of the index, checked against the contract: its version, snapshot, unknown repositories and rows. */
export function readLiveIndexAnswer(value: unknown): {
  snapshot: string | null;
  unknown: { repo: string; reason: string }[];
  items: (LiveIndexItem & { ownerKind: string })[];
} {
  const a = value as Record<string, unknown> | null;
  if (!a || typeof a !== 'object' || typeof a.version !== 'number') throw new Error('not a live index answer');
  if (a.version !== VERSION)
    throw new Error(`the index answers contract version ${a.version}; this NERV reads version ${VERSION}`);
  const rows = (Array.isArray(a.steps) ? a.steps : Array.isArray(a.items) ? a.items : []) as Record<string, unknown>[];
  return {
    snapshot: typeof a.snapshot === 'string' && !Number.isNaN(Date.parse(a.snapshot)) ? a.snapshot : null,
    unknown: (Array.isArray(a.unknown) ? (a.unknown as Record<string, unknown>[]) : []).map((u) => ({
      repo: text(u?.repo, 60),
      reason: text(u?.message ?? u?.reason, 300),
    })),
    items: rows
      .filter((r) => r && typeof r.repo === 'string' && typeof r.id === 'string')
      .map((r) => ({
        key: `${text(r.repo, 60)}:${text(r.id, 40)}`,
        repo: text(r.repo, 60),
        title: text(r.title, 300),
        url: link((r.source as Record<string, unknown> | undefined)?.url),
        ownerKind: text(r.ownerKind, 20),
      })),
  };
}

/** Whole minutes since the snapshot; null without one. */
export function liveIndexAgeMinutes(snapshot: string | null, now: number): number | null {
  if (!snapshot) return null;
  return Math.max(0, Math.floor((now - Date.parse(snapshot)) / 60_000));
}
