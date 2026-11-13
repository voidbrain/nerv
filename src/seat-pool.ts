import { casperAsk, parseCasper } from './casper.ts';
import type { PeerVerdict, VerdictAsk } from './kaji-link.ts';
import { effects, type Effect } from './policy.ts';

/** One free/external API seat in the pool (F-025-T02): one per (provider, model), with its own private key. */
export interface SeatPoolEntry {
  id: string;
  provider: string;
  baseUrl: string;
  model: string;
  effects?: Effect[];
  tools?: string[];
  shadow?: boolean;
  enabled?: boolean;
  cooldownMs?: number;
}

export type SeatStatus = 'ready' | 'missing-key' | 'disabled' | 'cooldown' | 'unavailable';

export interface SeatState {
  id: string;
  provider: string;
  model: string;
  status: SeatStatus;
  reason?: string;
  cooldownUntil?: number;
}

const SEAT_ID_RE = /^[a-zA-Z0-9._:/-]{1,40}$/;
const DEFAULT_CLOUD_EFFECTS: Effect[] = ['write-external', 'irreversible', 'physical'];
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_PER_ACTION = 2;

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validates configured seat pool entries and enforces one seat per (provider, model) and unique IDs. */
export function validateSeatPool(value: unknown): SeatPoolEntry[] {
  if (!Array.isArray(value)) throw new Error('Invalid seats: must be an array.');
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const out: SeatPoolEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid seat entry.');
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || !SEAT_ID_RE.test(e.id)) throw new Error('Invalid seat id.');
    if (ids.has(e.id)) throw new Error(`Duplicate seat id: ${e.id}.`);
    ids.add(e.id);
    if (typeof e.provider !== 'string' || !e.provider.trim() || e.provider.length > 40)
      throw new Error(`Invalid seat provider for ${e.id}.`);
    if (typeof e.baseUrl !== 'string' || !isHttpUrl(e.baseUrl)) throw new Error(`Invalid seat baseUrl for ${e.id}.`);
    if (typeof e.model !== 'string' || !e.model.trim() || e.model.length > 120)
      throw new Error(`Invalid seat model for ${e.id}.`);
    const pairKey = `${e.provider.trim().toLowerCase()}::${e.model.trim()}`;
    if (pairs.has(pairKey)) throw new Error(`Duplicate seat for provider/model: ${e.provider}/${e.model}.`);
    pairs.add(pairKey);
    if (e.effects !== undefined && (!Array.isArray(e.effects) || e.effects.some((x) => !effects.includes(x as Effect))))
      throw new Error(`Invalid seat effects for ${e.id}.`);
    if (
      e.tools !== undefined &&
      (!Array.isArray(e.tools) || e.tools.some((x) => typeof x !== 'string' || !x.trim() || x.length > 100))
    )
      throw new Error(`Invalid seat tools for ${e.id}.`);
    if (e.shadow !== undefined && typeof e.shadow !== 'boolean') throw new Error(`Invalid seat shadow for ${e.id}.`);
    if (e.enabled !== undefined && typeof e.enabled !== 'boolean') throw new Error(`Invalid seat enabled for ${e.id}.`);
    if (
      e.cooldownMs !== undefined &&
      (typeof e.cooldownMs !== 'number' || !Number.isFinite(e.cooldownMs) || e.cooldownMs < 0)
    )
      throw new Error(`Invalid seat cooldownMs for ${e.id}.`);
    out.push({
      id: e.id,
      provider: e.provider.trim(),
      baseUrl: e.baseUrl.replace(/\/+$/, ''),
      model: e.model.trim(),
      ...(e.effects ? { effects: e.effects as Effect[] } : {}),
      ...(e.tools ? { tools: e.tools as string[] } : {}),
      ...(e.shadow !== undefined ? { shadow: e.shadow } : {}),
      ...(e.enabled !== undefined ? { enabled: e.enabled } : {}),
      ...(e.cooldownMs !== undefined ? { cooldownMs: e.cooldownMs } : {}),
    });
  }
  return out;
}

/** Checks one candidate seat (key present, provider reachable, model listed) and returns its status with reason. */
export async function checkSeat(
  entry: SeatPoolEntry,
  key: string | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
  timeoutMs = 5000,
): Promise<SeatState> {
  if (entry.enabled === false)
    return { id: entry.id, provider: entry.provider, model: entry.model, status: 'disabled', reason: 'disabled' };
  if (!key)
    return { id: entry.id, provider: entry.provider, model: entry.model, status: 'missing-key', reason: 'missing key' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${entry.baseUrl}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: ac.signal,
    });
    if (res.status === 401 || res.status === 403)
      return {
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        status: 'unavailable',
        reason: 'key refused',
      };
    if (res.status === 429)
      return { id: entry.id, provider: entry.provider, model: entry.model, status: 'cooldown', reason: 'rate limited' };
    if (!res.ok)
      return {
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        status: 'unavailable',
        reason: `provider HTTP ${res.status}`,
      };
    const body = (await res.json()) as { data?: { id?: string }[]; models?: { id?: string; name?: string }[] };
    const listed = [
      ...(Array.isArray(body.data)
        ? body.data.map((m) => m?.id).filter((x): x is string => typeof x === 'string')
        : []),
      ...(Array.isArray(body.models)
        ? body.models.map((m) => m?.id ?? m?.name).filter((x): x is string => typeof x === 'string')
        : []),
    ];
    if (listed.length > 0 && !listed.includes(entry.model))
      return {
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        status: 'unavailable',
        reason: 'model not listed',
      };
    return { id: entry.id, provider: entry.provider, model: entry.model, status: 'ready' };
  } catch {
    return {
      id: entry.id,
      provider: entry.provider,
      model: entry.model,
      status: 'unavailable',
      reason: 'provider unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pool of free/external API veto-only seats (F-025-T02):
 * rotates across actions, skips rate-limited or unavailable seats with reasons,
 * and never sends local-only or tainted actions off-machine.
 */
export class SeatPool {
  readonly entries: SeatPoolEntry[];
  private readonly readKey: (id: string) => string | undefined;
  private readonly maxPerAction: number;
  private readonly defaultCooldownMs: number;
  private readonly fetchFn: typeof fetch;
  private cursor = 0;
  private readonly cooldowns = new Map<string, { until: number; reason: string }>();
  private readonly unavailable = new Map<string, string>();

  constructor(
    entries: SeatPoolEntry[],
    readKey: (id: string) => string | undefined,
    options?: { maxPerAction?: number; cooldownMs?: number; fetchFn?: typeof fetch },
  ) {
    this.entries = validateSeatPool(entries);
    this.readKey = readKey;
    this.maxPerAction = Math.max(1, options?.maxPerAction ?? MAX_PER_ACTION);
    this.defaultCooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  /** Marks a seat as temporarily limited/unavailable until `now + cooldownMs`. */
  markLimited(id: string, reason: string, now = Date.now()): void {
    const entry = this.entries.find((e) => e.id === id);
    const ms = entry?.cooldownMs ?? this.defaultCooldownMs;
    this.cooldowns.set(id, { until: now + ms, reason });
  }

  /** Checks all seats against their providers and caches unavailability reasons. */
  async checkAll(timeoutMs = 5000): Promise<SeatState[]> {
    const states: SeatState[] = [];
    for (const entry of this.entries) {
      const state = await checkSeat(entry, this.readKey(entry.id), this.fetchFn, timeoutMs);
      if (state.status === 'unavailable' && state.reason) this.unavailable.set(entry.id, state.reason);
      else if (state.status === 'ready') this.unavailable.delete(entry.id);
      states.push(state);
    }
    return states;
  }

  /** Picks up to `maxPerAction` eligible seats in round-robin order for one action. */
  pick(
    action: { tool: string; effect: Effect; cloudAllowed: boolean },
    now = Date.now(),
  ): { picked: SeatPoolEntry[]; skipped: { id: string; reason: string }[] } {
    if (!this.entries.length) return { picked: [], skipped: [] };
    if (!action.cloudAllowed) {
      return {
        picked: [],
        skipped: this.entries.map((e) => ({ id: e.id, reason: 'local-only or tainted' })),
      };
    }
    const skipped: { id: string; reason: string }[] = [];
    const eligible: { entry: SeatPoolEntry; index: number }[] = [];
    const n = this.entries.length;
    for (let offset = 0; offset < n; offset++) {
      const idx = (this.cursor + offset) % n;
      const e = this.entries[idx]!;
      const allowedEffects = e.effects?.length ? e.effects : DEFAULT_CLOUD_EFFECTS;
      if (!allowedEffects.includes(action.effect)) {
        skipped.push({ id: e.id, reason: `not attached to ${action.effect}` });
        continue;
      }
      if (e.tools?.length && !e.tools.includes(action.tool)) {
        skipped.push({ id: e.id, reason: `not attached to ${action.tool}` });
        continue;
      }
      if (e.enabled === false) {
        skipped.push({ id: e.id, reason: 'disabled' });
        continue;
      }
      if (!this.readKey(e.id)) {
        skipped.push({ id: e.id, reason: 'missing key' });
        continue;
      }
      const cd = this.cooldowns.get(e.id);
      if (cd && cd.until > now) {
        skipped.push({ id: e.id, reason: cd.reason });
        continue;
      }
      if (cd && cd.until <= now) this.cooldowns.delete(e.id);
      const unavail = this.unavailable.get(e.id);
      if (unavail) {
        skipped.push({ id: e.id, reason: unavail });
        continue;
      }
      eligible.push({ entry: e, index: idx });
    }
    const chosen = eligible.slice(0, this.maxPerAction);
    if (chosen.length) this.cursor = (chosen[chosen.length - 1]!.index + 1) % n;
    return { picked: chosen.map((c) => c.entry), skipped };
  }

  /** Asks one cloud seat for its veto-only verdict; rate limits and outages abstain and trigger cooldown. */
  async ask(entry: SeatPoolEntry, ask: VerdictAsk, signal: AbortSignal, now = Date.now()): Promise<PeerVerdict> {
    const key = this.readKey(entry.id);
    if (!key) return { vote: 'abstain', reason: 'missing key' };
    const prompt = casperAsk({
      request: ask.request,
      tool: ask.tool,
      args: ask.args,
      effect: ask.effect as Effect,
    });
    try {
      const res = await this.fetchFn(`${entry.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: entry.model,
          temperature: 0,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.prompt },
          ],
        }),
        signal,
      });
      if (res.status === 429) {
        this.markLimited(entry.id, 'rate limited', now);
        return { vote: 'abstain', reason: 'rate limited' };
      }
      if (res.status === 401 || res.status === 403) {
        this.markLimited(entry.id, 'key refused', now);
        return { vote: 'abstain', reason: 'key refused' };
      }
      if (!res.ok) {
        this.markLimited(entry.id, `provider HTTP ${res.status}`, now);
        return { vote: 'abstain', reason: `provider HTTP ${res.status}` };
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content ?? '';
      const parsed = parseCasper(text);
      if (!parsed) return { vote: 'abstain', reason: 'unreadable verdict' };
      return {
        vote: parsed.vote,
        reason: parsed.reason,
        ...(typeof parsed.confidence === 'number' ? { confidence: parsed.confidence } : {}),
      };
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'provider unavailable';
      this.markLimited(entry.id, reason, now);
      return { vote: 'abstain', reason };
    }
  }
}
