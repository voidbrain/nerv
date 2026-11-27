// F-148: who is thinking right now. An in-memory list of the model calls in flight (planner, consultant, Casper, a
// direct ask), each with its pilot, role, model, sortie and start time. Never a prompt or an answer, never stored.
export type ThinkingRole = 'planner' | 'consultant' | 'casper' | 'ask';
export interface ThinkingEntry {
  id: string;
  pilot: string;
  role: ThinkingRole;
  model: string;
  sortieId?: string;
  startedAt: string;
}
export type ThinkingStart = Omit<ThinkingEntry, 'id' | 'startedAt'>;
/** A model call ends well before this (MODEL_TIMEOUT_MS is 180 s); an entry still open after it is a lost end. */
export const THINKING_CEILING_MS = 10 * 60_000;
const ROLES: readonly ThinkingRole[] = ['planner', 'consultant', 'casper', 'ask'];
const text = (v: unknown, max: number, min = 1): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
function valid(v: unknown): v is ThinkingStart {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    text(e.pilot, 40) &&
    ROLES.includes(e.role as ThinkingRole) &&
    text(e.model, 100, 0) &&
    (e.sortieId === undefined || text(e.sortieId, 100))
  );
}
export class ThinkingRegistry {
  private readonly entries = new Map<string, ThinkingEntry>();
  private next = 0;
  /** Goes up on every change (begin, end, expiry, clear): the dashboard feed announces a change when it moves. */
  version = 0;
  private readonly ceilingMs: number;
  private readonly now: () => number;
  constructor(ceilingMs = THINKING_CEILING_MS, now: () => number = Date.now) {
    this.ceilingMs = ceilingMs;
    this.now = now;
  }
  /** Starts an entry; the returned end is idempotent, so a finally may always call it. */
  begin(start: ThinkingStart): { id: string; end: () => void } {
    if (!valid(start)) throw new Error('Invalid thinking entry.');
    const id = `t${++this.next}`;
    this.entries.set(id, {
      id,
      pilot: start.pilot,
      role: start.role,
      model: start.model,
      ...(start.sortieId ? { sortieId: start.sortieId } : {}),
      startedAt: new Date(this.now()).toISOString(),
    });
    this.version++;
    return { id, end: () => this.end(id) };
  }
  end(id: string): void {
    if (this.entries.delete(id)) this.version++;
  }
  /** The entries in flight, oldest first; one past the ceiling is dropped, so a lost end never shows thinking forever. */
  snapshot(): ThinkingEntry[] {
    const now = this.now();
    for (const [id, e] of this.entries) if (now - Date.parse(e.startedAt) > this.ceilingMs) this.end(id);
    return [...this.entries.values()].map((e) => ({ ...e }));
  }
  /** Takes another process's list as it is (the service mirrors the brain's); invalid entries are left out. */
  replace(list: unknown): void {
    const before = JSON.stringify([...this.entries.values()]);
    this.entries.clear();
    if (Array.isArray(list))
      for (const e of list.slice(0, 64))
        if (
          valid(e) &&
          text((e as ThinkingEntry).id, 40) &&
          Number.isFinite(Date.parse((e as ThinkingEntry).startedAt))
        ) {
          const { id, pilot, role, model, sortieId, startedAt } = e as ThinkingEntry;
          this.entries.set(id, { id, pilot, role, model, ...(sortieId ? { sortieId } : {}), startedAt });
        }
    if (JSON.stringify([...this.entries.values()]) !== before) this.version++;
  }
  clear(): void {
    if (!this.entries.size) return;
    this.entries.clear();
    this.version++;
  }
}
