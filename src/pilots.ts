import { stricter, type Executor } from './policy.ts';

/**
 * Pilots (F-045): the owner's permanent agents, as data. Slice 1: a local roster in config.json, the generic pilot (the
 * consultant model of F-025, for anything no specialist covers) and advice mode: before Misato plans, the pilot whose
 * domain fits the request gives short advice. Advice is data in Misato's prompt, never a vote or an action.
 * Explicit proactive watches may bind their local planner model/stage to a named pilot (F-026); ordinary chat remains advice mode.
 * F-045-T01: full pilot data (role, domain, skills, tools, model, memory scope, EVA class, trust stage, parent),
 * Kaji-style PilotRegistry, and heartbeat pilot offers.
 */
export type Stage = 'prototype' | 'test' | 'production';
export type EvaClass = Executor;
export const EVA_CLASSES: readonly EvaClass[] = ['eva-00', 'eva-01', 'eva-02', 'eva-03'];
export interface Pilot {
  id: string;
  name: string;
  role?: string;
  domain: string;
  keywords: string[];
  skills?: string[];
  tools?: string[];
  model: string;
  memoryScope?: string;
  evaClass?: EvaClass;
  stage: Stage;
  parent?: string;
  pinned?: boolean;
  retired?: boolean;
}
/** Pilot definition offered by a base over the Kaji heartbeat (local roster flags like pinned/retired are omitted). */
export interface PilotOffer {
  id: string;
  name: string;
  role?: string;
  domain: string;
  keywords: string[];
  skills?: string[];
  tools?: string[];
  model: string;
  memoryScope?: string;
  evaClass?: EvaClass;
  stage: Stage;
  parent?: string;
}
export interface RegisteredPilot extends PilotOffer {
  baseId: string;
  local: boolean;
  pinned?: boolean;
  retired?: boolean;
  receivedAt?: string;
}
/** The pilot chosen for one request: who, on which model, and why it was chosen. */
export interface Chosen {
  id: string;
  name: string;
  domain: string;
  model: string;
  why: 'pinned' | 'keywords';
}
export const GENERIC = 'generic';
export const STAGES: readonly Stage[] = ['prototype', 'test', 'production'];
const MAX_PILOTS = 30;
/** Most restrictive EVA class a pilot stage allows: prototype -> eva-00, test -> eva-01, production -> eva-02. */
export function stageExecutor(stage: Stage): EvaClass {
  return stage === 'prototype' ? 'eva-00' : stage === 'test' ? 'eva-01' : 'eva-02';
}
/** Effective EVA class for a pilot: never less confined than its stage or its declared evaClass. */
export function pilotExecutor(pilot: Pick<Pilot, 'stage' | 'evaClass'>): EvaClass {
  return stricter(stageExecutor(pilot.stage), pilot.evaClass);
}
/** Implicit generic pilot for a base, always in the most restrictive EVA its stage allows (F-045-T02). */
export function genericPilot(model: string | null, stage: Stage = 'prototype'): Pilot {
  return {
    id: GENERIC,
    name: 'Generic pilot',
    role: 'generic',
    domain: 'anything no specialist covers',
    keywords: [],
    model: model ?? '',
    stage,
    evaClass: pilotExecutor({ stage }),
  };
}
export type PilotPatch = Partial<
  Pick<
    Pilot,
    | 'name'
    | 'role'
    | 'domain'
    | 'keywords'
    | 'skills'
    | 'tools'
    | 'model'
    | 'memoryScope'
    | 'evaClass'
    | 'stage'
    | 'pinned'
    | 'retired'
  >
>;
/** Adds a pilot to a roster and validates the result. */
export function addPilot(roster: readonly Pilot[], entry: Pilot): Pilot[] {
  return validatePilots([...roster, entry]);
}
/** Updates (including renaming) an existing pilot in a roster and validates the result. */
export function updatePilot(roster: readonly Pilot[], id: string, patch: PilotPatch): Pilot[] {
  const idx = roster.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`Unknown specialist pilot: ${id}.`);
  const next = roster.map((p) => {
    if (p.id !== id) return p;
    const updated: Pilot = { ...p };
    if (patch.name !== undefined) updated.name = patch.name;
    if (patch.role !== undefined) updated.role = patch.role;
    if (patch.domain !== undefined) updated.domain = patch.domain;
    if (patch.keywords !== undefined) updated.keywords = patch.keywords;
    if (patch.skills !== undefined) updated.skills = patch.skills;
    if (patch.tools !== undefined) updated.tools = patch.tools;
    if (patch.model !== undefined) updated.model = patch.model;
    if (patch.memoryScope !== undefined) updated.memoryScope = patch.memoryScope;
    if (patch.evaClass !== undefined) updated.evaClass = patch.evaClass;
    if (patch.stage !== undefined) updated.stage = patch.stage;
    if (patch.pinned !== undefined) {
      if (patch.pinned) updated.pinned = true;
      else delete updated.pinned;
    }
    if (patch.retired !== undefined) {
      if (patch.retired) updated.retired = true;
      else delete updated.retired;
    }
    return updated;
  });
  return validatePilots(next);
}
/** Pins/unpins or retires/restores an existing pilot and validates the result. */
export function setPilotFlag(roster: readonly Pilot[], id: string, flag: 'pinned' | 'retired', on: boolean): Pilot[] {
  return updatePilot(roster, id, { [flag]: on });
}
/** Lower case, accents removed, words only: "Perché la stampa 3D?" → "perche la stampa 3d". */
export function words(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
/** B-027: domain labels overlap when they share a significant whole word. */
export function overlappingDomains(left: string, right: string): boolean {
  const a = words(left),
    b = words(right);
  if (a === b) return true;
  const significant = (text: string) =>
    text.split(' ').filter((w) => w.length >= 4 && !['with', 'from', 'that', 'this', 'and', 'for', 'the'].includes(w));
  const terms = new Set(significant(a));
  return significant(b).some((w) => terms.has(w));
}
const PILOT_KEYS = [
  'id',
  'name',
  'role',
  'domain',
  'keywords',
  'skills',
  'tools',
  'model',
  'memoryScope',
  'evaClass',
  'stage',
  'parent',
  'pinned',
  'retired',
] as const;
const OFFER_KEYS = PILOT_KEYS.filter((k) => k !== 'pinned' && k !== 'retired');
const SCOPE_RE = /^[a-z][a-z0-9-]{1,39}$/;
const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const cleanText = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
function validateStringList(value: unknown, label: string, pilotId: string, maxLen = 64): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_PILOTS ||
    value.some((v) => typeof v !== 'string' || !cleanText(v) || v.length > maxLen)
  )
    throw new Error(
      `Pilot ${pilotId}: ${label} is a list of up to ${MAX_PILOTS} items, each up to ${maxLen} characters.`,
    );
  return [...new Set((value as string[]).map(cleanText))];
}
function parsePilotEntry(raw: unknown, out: readonly Pilot[], allowLocalFlags: boolean): Pilot {
  const p = raw as Record<string, unknown>;
  const allowed = allowLocalFlags ? (PILOT_KEYS as readonly string[]) : (OFFER_KEYS as readonly string[]);
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some((k) => !allowed.includes(k)))
    throw new Error(`Invalid pilot: ${allowed.join(', ')}.`);
  if (typeof p.id !== 'string' || !ID_RE.test(p.id) || p.id === GENERIC)
    throw new Error(
      `Invalid pilot id ${JSON.stringify(p.id)}: lower-case letters, digits and dashes, not "${GENERIC}".`,
    );
  if (out.some((o) => o.id === p.id)) throw new Error(`Pilot ${p.id} is listed twice.`);
  if (typeof p.name !== 'string' || !cleanText(p.name) || p.name.length > 40)
    throw new Error(`Pilot ${p.id}: a name up to 40 characters.`);
  if (p.role !== undefined && (typeof p.role !== 'string' || !cleanText(p.role) || p.role.length > 40))
    throw new Error(`Pilot ${p.id}: role up to 40 characters.`);
  if (typeof p.domain !== 'string' || !cleanText(p.domain) || p.domain.length > 200)
    throw new Error(`Pilot ${p.id}: a domain up to 200 characters.`);
  if (
    !Array.isArray(p.keywords) ||
    !p.keywords.length ||
    p.keywords.length > 30 ||
    p.keywords.some((k) => typeof k !== 'string' || !words(k) || k.length > 40)
  )
    throw new Error(`Pilot ${p.id}: 1 to 30 keywords, each up to 40 characters.`);
  const skills = p.skills !== undefined ? validateStringList(p.skills, 'skills', p.id) : undefined;
  const tools = p.tools !== undefined ? validateStringList(p.tools, 'tools', p.id) : undefined;
  if (typeof p.model !== 'string' || !cleanText(p.model) || p.model.length > 100)
    throw new Error(`Pilot ${p.id}: a local model name.`);
  if (p.memoryScope !== undefined && (typeof p.memoryScope !== 'string' || !SCOPE_RE.test(p.memoryScope)))
    throw new Error(`Pilot ${p.id}: memoryScope is lower-case letters, digits and dashes (2-40 chars).`);
  if (p.evaClass !== undefined && !EVA_CLASSES.includes(p.evaClass as EvaClass))
    throw new Error(`Pilot ${p.id}: evaClass is ${EVA_CLASSES.join(', ')}.`);
  if (p.stage !== undefined && !STAGES.includes(p.stage as Stage))
    throw new Error(`Pilot ${p.id}: stage is prototype, test or production.`);
  if (p.parent !== undefined && (typeof p.parent !== 'string' || !ID_RE.test(p.parent)))
    throw new Error(`Pilot ${p.id}: parent is a pilot id or "${GENERIC}".`);
  if (allowLocalFlags)
    for (const f of ['pinned', 'retired'] as const)
      if (p[f] !== undefined && typeof p[f] !== 'boolean') throw new Error(`Pilot ${p.id}: ${f} is true or false.`);
  return {
    id: p.id,
    name: cleanText(p.name),
    ...(p.role !== undefined ? { role: cleanText(p.role as string) } : {}),
    domain: cleanText(p.domain),
    keywords: [...new Set((p.keywords as string[]).map(words))],
    ...(skills !== undefined ? { skills } : {}),
    ...(tools !== undefined ? { tools } : {}),
    model: cleanText(p.model),
    ...(p.memoryScope !== undefined ? { memoryScope: p.memoryScope as string } : {}),
    ...(p.evaClass !== undefined ? { evaClass: p.evaClass as EvaClass } : {}),
    stage: (p.stage as Stage | undefined) ?? 'prototype',
    ...(p.parent ? { parent: p.parent as string } : {}),
    ...(allowLocalFlags && p.pinned ? { pinned: true } : {}),
    ...(allowLocalFlags && p.retired ? { retired: true } : {}),
  };
}
/** Checks the roster from config.json; the generic pilot is implicit (its model is roles.consultant) and never listed. */
export function validatePilots(value: unknown): Pilot[] {
  if (!Array.isArray(value) || value.length > MAX_PILOTS)
    throw new Error(`Invalid pilots: a list of at most ${MAX_PILOTS}.`);
  const out: Pilot[] = [];
  for (const raw of value) out.push(parsePilotEntry(raw, out, true));
  for (const p of out)
    if (p.parent && p.parent !== GENERIC && !out.some((o) => o.id === p.parent))
      throw new Error(`Pilot ${p.id}: parent ${p.parent} is not in the roster.`);
  return out;
}
/** Active local pilots formatted for a Kaji heartbeat offer (retired pilots and local roster flags are excluded). */
export function toPilotOffers(roster: readonly Pilot[]): PilotOffer[] {
  return roster
    .filter((p) => !p.retired)
    .map(({ pinned: _pinned, retired: _retired, ...offer }) => ({
      ...offer,
      keywords: [...offer.keywords],
      ...(offer.skills ? { skills: [...offer.skills] } : {}),
      ...(offer.tools ? { tools: [...offer.tools] } : {}),
    }));
}
/** Validates pilot offers heard from another base's heartbeat; returns undefined if malformed. */
export function sanitizePilotOffers(value: unknown): PilotOffer[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PILOTS) return undefined;
  const out: PilotOffer[] = [];
  try {
    for (const raw of value) out.push(parsePilotEntry(raw, out, false));
    for (const p of out) if (p.parent && p.parent !== GENERIC && !out.some((o) => o.id === p.parent)) return undefined;
    return out;
  } catch {
    return undefined;
  }
}
const DEFAULT_ONLINE_MS = 90_000;
/**
 * Kaji-style pilot registry: combines this base's local roster with pilots offered by enrolled peers in heartbeats.
 * Peer offers expire after maxAgeMs (90s by default) and can be cleared when a base is revoked.
 */
export class PilotRegistry {
  private readonly peers = new Map<string, { pilots: PilotOffer[]; at: number }>();
  readonly localBaseId: string;
  private readonly localPilots: () => readonly Pilot[];
  constructor(localBaseId: string, localPilots: () => readonly Pilot[] = () => []) {
    this.localBaseId = localBaseId;
    this.localPilots = localPilots;
  }
  offered(): PilotOffer[] {
    return toPilotOffers(this.localPilots());
  }
  recordPeer(baseId: string, offers: unknown, now = Date.now()): PilotOffer[] | undefined {
    if (!baseId || baseId === this.localBaseId) return undefined;
    const clean = sanitizePilotOffers(offers);
    if (!clean) return undefined;
    this.peers.set(baseId, { pilots: clean, at: now });
    return clean;
  }
  clearPeer(baseId: string): void {
    this.peers.delete(baseId);
  }
  forBase(baseId: string, opts?: { includeRetired?: boolean; maxAgeMs?: number; now?: number }): RegisteredPilot[] {
    const includeRetired = opts?.includeRetired ?? false;
    if (baseId === this.localBaseId)
      return this.localPilots()
        .filter((p) => includeRetired || !p.retired)
        .map((p) => ({ ...p, baseId: this.localBaseId, local: true }));
    const entry = this.peers.get(baseId);
    const now = opts?.now ?? Date.now();
    const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_ONLINE_MS;
    if (!entry || now - entry.at >= maxAgeMs) return [];
    const receivedAt = new Date(entry.at).toISOString();
    return entry.pilots.map((p) => ({ ...p, baseId, local: false, receivedAt }));
  }
  list(opts?: {
    includeRetired?: boolean;
    maxAgeMs?: number;
    now?: number;
    onlineBases?: ReadonlySet<string>;
  }): RegisteredPilot[] {
    const out = this.forBase(this.localBaseId, opts);
    for (const baseId of [...this.peers.keys()].sort()) {
      if (opts?.onlineBases && !opts.onlineBases.has(baseId)) continue;
      out.push(...this.forBase(baseId, opts));
    }
    return out;
  }
  get(
    baseId: string,
    pilotId: string,
    opts?: { includeRetired?: boolean; maxAgeMs?: number; now?: number },
  ): RegisteredPilot | undefined {
    return this.forBase(baseId, opts).find((p) => p.id === pilotId);
  }
}
/** How many of a pilot's keywords (whole words or phrases) the request contains. */
export function hits(request: string, pilot: Pick<Pilot, 'keywords'>): number {
  const text = ` ${words(request)} `;
  return pilot.keywords.filter((k) => text.includes(` ${k} `)).length;
}
/**
 * The specialist for a request, if any: among active pilots whose keywords it contains, a pinned one first, then the
 * most keywords matched, then the later trust stage, then the id. Undefined means the generic pilot (or none) advises.
 */
export function choosePilot(request: string, roster: readonly Pilot[]): Chosen | undefined {
  const scored = roster
    .filter((p) => !p.retired)
    .map((p) => ({ p, n: hits(request, p) }))
    .filter((x) => x.n > 0);
  scored.sort(
    (a, b) =>
      Number(!!b.p.pinned) - Number(!!a.p.pinned) ||
      b.n - a.n ||
      STAGES.indexOf(b.p.stage) - STAGES.indexOf(a.p.stage) ||
      a.p.id.localeCompare(b.p.id),
  );
  const best = scored[0];
  if (!best) return undefined;
  return {
    id: best.p.id,
    name: best.p.name,
    domain: best.p.domain,
    model: best.p.model,
    why: best.p.pinned ? 'pinned' : 'keywords',
  };
}
/** The roster as `nerv pilots` prints it, the generic pilot first. */
export function describePilots(roster: readonly Pilot[], generic: string | null): string {
  const lines = [
    `generic · Generic pilot · anything no specialist covers · ${generic ?? 'off (nerv pilots generic MODEL)'}`,
  ];
  for (const p of roster)
    lines.push(
      `${p.id} · ${p.name} · ${p.domain} · ${p.model} · ${p.stage}${p.pinned ? ' · pinned' : ''}${p.retired ? ' · retired' : ''}${p.parent && p.parent !== GENERIC ? ` · from ${p.parent}` : ''}\n   keywords: ${p.keywords.join(', ')}`,
    );
  return lines.join('\n');
}
