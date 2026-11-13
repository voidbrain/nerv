import { canLeaveMachine, stricter, type Effect, type Executor, type Policy, type Trust } from './policy.ts';
import type { Models, Privacy, RouteName } from './model.ts';

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
  route?: RouteName;
  provider?: string;
  memoryScope?: string;
  evaClass?: EvaClass;
  stage: Stage;
  parent?: string;
  version?: number;
  lineage?: string[];
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
  route?: RouteName;
  provider?: string;
  memoryScope?: string;
  evaClass?: EvaClass;
  stage: Stage;
  parent?: string;
  version?: number;
  lineage?: string[];
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
  baseId?: string;
}
export interface PilotRecord {
  cleanRuns?: number;
  rejects?: number;
  edits?: number;
}
export interface PilotCandidate {
  pilot: Pilot | RegisteredPilot;
  mainBase?: boolean;
  record?: PilotRecord;
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
    | 'route'
    | 'provider'
    | 'memoryScope'
    | 'evaClass'
    | 'stage'
    | 'version'
    | 'lineage'
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
    if (patch.route !== undefined) updated.route = patch.route;
    if (patch.provider !== undefined) updated.provider = patch.provider;
    if (patch.memoryScope !== undefined) updated.memoryScope = patch.memoryScope;
    if (patch.evaClass !== undefined) updated.evaClass = patch.evaClass;
    if (patch.stage !== undefined) updated.stage = patch.stage;
    if (patch.version !== undefined) updated.version = patch.version;
    if (patch.lineage !== undefined) updated.lineage = patch.lineage;
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
  'route',
  'provider',
  'memoryScope',
  'evaClass',
  'stage',
  'parent',
  'version',
  'lineage',
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
    throw new Error(`Pilot ${p.id}: a model name up to 100 characters.`);
  if (p.route !== undefined && p.route !== 'local' && p.route !== 'cloud')
    throw new Error(`Pilot ${p.id}: route must be local or cloud.`);
  if (p.provider !== undefined && (typeof p.provider !== 'string' || !SCOPE_RE.test(p.provider)))
    throw new Error(`Pilot ${p.id}: provider is lower-case letters, digits and dashes (2-40 chars).`);
  if (p.memoryScope !== undefined && (typeof p.memoryScope !== 'string' || !SCOPE_RE.test(p.memoryScope)))
    throw new Error(`Pilot ${p.id}: memoryScope is lower-case letters, digits and dashes (2-40 chars).`);
  if (p.evaClass !== undefined && !EVA_CLASSES.includes(p.evaClass as EvaClass))
    throw new Error(`Pilot ${p.id}: evaClass is ${EVA_CLASSES.join(', ')}.`);
  if (p.stage !== undefined && !STAGES.includes(p.stage as Stage))
    throw new Error(`Pilot ${p.id}: stage is prototype, test or production.`);
  if (p.parent !== undefined && (typeof p.parent !== 'string' || !ID_RE.test(p.parent)))
    throw new Error(`Pilot ${p.id}: parent is a pilot id or "${GENERIC}".`);
  if (p.version !== undefined && (!Number.isInteger(p.version) || (p.version as number) < 1))
    throw new Error(`Pilot ${p.id}: version must be a positive integer.`);
  const lineage = p.lineage !== undefined ? validateStringList(p.lineage, 'lineage', p.id) : undefined;
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
    ...(p.route !== undefined ? { route: p.route } : {}),
    ...(p.provider !== undefined ? { provider: p.provider } : {}),
    ...(p.memoryScope !== undefined ? { memoryScope: p.memoryScope as string } : {}),
    ...(p.evaClass !== undefined ? { evaClass: p.evaClass as EvaClass } : {}),
    stage: (p.stage as Stage | undefined) ?? 'prototype',
    ...(p.parent ? { parent: p.parent as string } : {}),
    ...(p.version !== undefined ? { version: p.version as number } : {}),
    ...(lineage !== undefined ? { lineage } : {}),
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
      ...(offer.lineage ? { lineage: [...offer.lineage] } : {}),
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
const recordScore = (r: PilotRecord | undefined) => (r ? (r.cleanRuns ?? 0) - (r.rejects ?? 0) - (r.edits ?? 0) : 0);
/**
 * Ranks active pilots matching the request by F-041 consultant rules:
 * owner's pin -> most keyword matches -> main base's own -> best record -> later trust stage -> id.
 */
export function rankPilots(
  request: string,
  candidates: readonly (Pilot | RegisteredPilot | PilotCandidate)[],
): Chosen[] {
  const normalized = candidates.map((c) => {
    if ('pilot' in c) return c;
    const reg = c as Partial<RegisteredPilot>;
    return {
      pilot: c,
      mainBase: reg.local ?? true,
      record: undefined,
    };
  });
  const scored = normalized
    .filter((c) => !('retired' in c.pilot && c.pilot.retired))
    .map((c) => ({ ...c, n: hits(request, c.pilot) }))
    .filter((x) => x.n > 0);
  scored.sort(
    (a, b) =>
      Number(!!('pinned' in b.pilot && b.pilot.pinned)) - Number(!!('pinned' in a.pilot && a.pilot.pinned)) ||
      b.n - a.n ||
      Number(!!b.mainBase) - Number(!!a.mainBase) ||
      recordScore(b.record) - recordScore(a.record) ||
      (b.record?.cleanRuns ?? 0) - (a.record?.cleanRuns ?? 0) ||
      STAGES.indexOf(b.pilot.stage) - STAGES.indexOf(a.pilot.stage) ||
      a.pilot.id.localeCompare(b.pilot.id),
  );
  return scored.map(({ pilot: p }) => {
    const baseId = 'baseId' in p ? p.baseId : undefined;
    return {
      id: p.id,
      name: p.name,
      domain: p.domain,
      model: p.model,
      why: 'pinned' in p && p.pinned ? 'pinned' : 'keywords',
      ...(baseId !== undefined ? { baseId } : {}),
    };
  });
}
/**
 * Advisers for one topic/request (F-045-T03 / F-041): at most one per topic by default, or up to two for "ask both".
 */
export function chooseAdvisers(
  request: string,
  candidates: readonly (Pilot | RegisteredPilot | PilotCandidate)[],
  opts?: { askBoth?: boolean },
): Chosen[] {
  return rankPilots(request, candidates).slice(0, opts?.askBoth ? 2 : 1);
}
/**
 * The specialist for a request, if any: among active pilots whose keywords it contains, a pinned one first, then the
 * most keywords matched, then main base's own, best record, later trust stage, then id.
 */
export function choosePilot(request: string, roster: readonly Pilot[]): Chosen | undefined {
  return rankPilots(request, roster)[0];
}
export function nextStage(stage: Stage): Stage | undefined {
  return stage === 'prototype' ? 'test' : stage === 'test' ? 'production' : undefined;
}
/** Previous watermelon trust stage when demoting (F-025-T04). */
export function previousStage(stage: Stage): Stage | undefined {
  return stage === 'production' ? 'test' : stage === 'test' ? 'prototype' : undefined;
}
/** Automatic demotion rule (F-025-T04): failure, override spikes, or Spear revocation demote one stage. */
export function shouldDemotePilot(
  pilot: Pick<Pilot, 'stage'>,
  signals: { failure?: boolean; spear?: boolean; overrides?: number; maxOverrides?: number },
): { demote: boolean; next?: Stage; reason?: string } {
  const next = previousStage(pilot.stage);
  if (!next) return { demote: false };
  if (signals.spear) return { demote: true, next, reason: 'Spear revocation' };
  if (signals.failure) return { demote: true, next, reason: 'failure' };
  const maxOverrides = signals.maxOverrides ?? 3;
  if ((signals.overrides ?? 0) >= maxOverrides) return { demote: true, next, reason: 'override spike' };
  return { demote: false };
}
/** Moves a pilot back one trust stage and tightens its EVA class to match. */
export function demotePilot(
  roster: readonly Pilot[],
  id: string,
): { roster: Pilot[]; changed: boolean; from?: Stage; to?: Stage } {
  const idx = roster.findIndex((p) => p.id === id);
  if (idx < 0) return { roster: [...roster], changed: false };
  const current = roster[idx]!;
  const to = previousStage(current.stage);
  if (!to) return { roster: [...roster], changed: false, from: current.stage };
  const updated: Pilot = { ...current, stage: to, evaClass: pilotExecutor({ stage: to, evaClass: current.evaClass }) };
  const next = [...roster];
  next[idx] = updated;
  return { roster: next, changed: true, from: current.stage, to };
}
/** Evaluates whether a pilot is eligible for owner-approved promotion (never automatic). */
export function promotionEligible(
  pilot: Pick<Pilot, 'stage'>,
  record: PilotRecord & { daysInStage?: number },
  opts?: { minCleanRuns?: number; minDays?: number },
): { eligible: boolean; current: Stage; next?: Stage; progress: string } {
  const next = nextStage(pilot.stage);
  if (!next) return { eligible: false, current: pilot.stage, progress: 'at production' };
  const minRuns = opts?.minCleanRuns ?? 10;
  const minDays = opts?.minDays ?? 7;
  const runs = record.cleanRuns ?? 0;
  const days = record.daysInStage ?? 0;
  const clean = (record.rejects ?? 0) === 0 && (record.edits ?? 0) === 0;
  const eligible = clean && runs >= minRuns && days >= minDays;
  const daysLeft = Math.max(0, minDays - days);
  const progress = eligible
    ? 'ready to promote'
    : !clean
      ? 'blocked by rejects or edits'
      : `eligible in ${daysLeft} d · ${runs}/${minRuns} runs`;
  return { eligible, current: pilot.stage, next, progress };
}
export interface ExecutionChoice {
  pilot: Pilot | RegisteredPilot;
  executor: EvaClass;
  suggestOnly: boolean;
  why: 'pinned' | 'keywords' | 'generic';
  baseId?: string;
}
/**
 * Chooses a pilot for execution mode by domain/keywords and evidence; falls back to the base's generic pilot.
 * Defaults to suggest-only (`suggestOnly: true`); effects still require owner/MAGI approval.
 */
export function chooseExecutionPilot(
  request: string,
  candidates: readonly (Pilot | RegisteredPilot | PilotCandidate)[],
  fallbackGeneric: Pilot,
  opts?: { suggestOnly?: boolean },
): ExecutionChoice {
  const suggestOnly = opts?.suggestOnly ?? true;
  const ranked = rankPilots(request, candidates);
  const top = ranked[0];
  if (!top) {
    return {
      pilot: fallbackGeneric,
      executor: pilotExecutor(fallbackGeneric),
      suggestOnly: true,
      why: 'generic',
    };
  }
  const matched = candidates
    .map((c) => ('pilot' in c ? c.pilot : c))
    .find((p) => p.id === top.id && ('baseId' in p ? p.baseId : undefined) === top.baseId)!;
  return {
    pilot: matched,
    executor: pilotExecutor(matched),
    suggestOnly,
    why: top.why,
    ...(top.baseId !== undefined ? { baseId: top.baseId } : {}),
  };
}
/** Result of checking whether a remote pilot may run an action through the authenticated line (F-045-T05). */
export interface RemotePilotGrant {
  allowed: boolean;
  reason?: string;
}
/** Checks grant rules for a remote pilot: active, non-recursive, offered by its base, and within its tool grants. */
export function canRunRemotePilot(
  pilot: Pick<Pilot, 'id' | 'retired' | 'tools'>,
  offeredTools: readonly string[],
  tool?: string,
): RemotePilotGrant {
  if (pilot.retired) return { allowed: false, reason: `Pilot ${pilot.id} is retired.` };
  if (tool) {
    if (tool === 'kaji.run') return { allowed: false, reason: 'Remote pilots cannot chain kaji.run.' };
    if (!offeredTools.includes(tool)) return { allowed: false, reason: `Base does not offer "${tool}".` };
    if (pilot.tools && pilot.tools.length > 0 && !pilot.tools.includes(tool))
      return { allowed: false, reason: `Pilot ${pilot.id} does not grant tool "${tool}".` };
  }
  return { allowed: true };
}
/** Selects a local or remote pilot for execution and verifies remote base/pilot grants when remote (F-045-T05). */
export function selectRemotePilotRun(
  request: string,
  candidates: readonly (Pilot | RegisteredPilot | PilotCandidate)[],
  offeredByBase: ReadonlyMap<string, readonly string[]>,
  fallbackGeneric: Pilot,
  tool?: string,
  opts?: { suggestOnly?: boolean; localBaseId?: string },
): { choice: ExecutionChoice; remote: boolean; allowed: boolean; reason?: string } {
  const choice = chooseExecutionPilot(request, candidates, fallbackGeneric, opts);
  if (choice.baseId !== undefined && choice.baseId !== opts?.localBaseId) {
    const offered = offeredByBase.get(choice.baseId);
    if (!offered)
      return {
        choice,
        remote: true,
        allowed: false,
        reason: `Base ${choice.baseId} is not online or offering actions.`,
      };
    const grant = canRunRemotePilot(choice.pilot, offered, tool);
    return { choice, remote: true, ...grant };
  }
  return { choice, remote: false, allowed: true };
}
/** Qualification evidence scopes kept distinct per docs/decisions/configuration-qualification.md (F-045-T06). */
export type QualificationScope = 'individual' | 'combination' | 'placement';
export interface IndividualRoleEvidence {
  scope: 'individual';
  id: string;
  pilotId: string;
  role: NonNullable<Pilot['role']>;
  model: string;
  passed: number;
  total: number;
  recordedAt: string;
}
export interface CombinationEvidence {
  scope: 'combination';
  id: string;
  roles: readonly string[];
  componentEvidenceIds: readonly string[];
  passed: number;
  total: number;
  escapedDefects: number;
  falseRejections: number;
  independentGrader: boolean;
  recordedAt: string;
}
export interface HostPlacementEvidence {
  scope: 'placement';
  id: string;
  pilotId: string;
  baseId: string;
  inferenceHost: string;
  executionHost: string;
  passed: number;
  total: number;
  recordedAt: string;
}
export type QualificationEvidence = IndividualRoleEvidence | CombinationEvidence | HostPlacementEvidence;
export interface PlacementAssessment {
  qualified: boolean;
  suggestOnly: true;
  individualQualified: boolean;
  combinationQualified: boolean;
  placementQualified: boolean;
  missing: QualificationScope[];
  reason: string;
}
/**
 * Evaluates F-006-T03/T04 qualification evidence for pilot placement (F-045-T06).
 * Individual-role, combination, and host-placement evidence remain strictly distinct;
 * no placement claim is made without required passing evidence, and suggestOnly stays true.
 */
export function evaluatePilotPlacement(input: {
  pilotId: string;
  role?: NonNullable<Pilot['role']>;
  baseId: string;
  partnerPilotIds?: readonly string[];
  evidence: readonly QualificationEvidence[];
}): PlacementAssessment {
  const individuals = input.evidence.filter((e): e is IndividualRoleEvidence => e.scope === 'individual');
  const combinations = input.evidence.filter((e): e is CombinationEvidence => e.scope === 'combination');
  const placements = input.evidence.filter((e): e is HostPlacementEvidence => e.scope === 'placement');

  const passingIndividuals = individuals.filter((e) => e.total > 0 && e.passed === e.total);
  const passingIndividualIds = new Set(passingIndividuals.map((e) => e.id));
  const individualQualified = passingIndividuals.some(
    (e) => e.pilotId === input.pilotId && (!input.role || e.role === input.role),
  );

  const partners = input.partnerPilotIds ?? [];
  const needsCombination = partners.length > 0;
  const combinationQualified = !needsCombination
    ? true
    : combinations.some(
        (e) =>
          e.independentGrader &&
          e.total > 0 &&
          e.passed === e.total &&
          e.escapedDefects === 0 &&
          e.roles.includes(input.pilotId) &&
          partners.every((p) => e.roles.includes(p)) &&
          e.componentEvidenceIds.length > 0 &&
          e.componentEvidenceIds.every((id) => passingIndividualIds.has(id)),
      );

  const placementQualified = placements.some(
    (e) => e.pilotId === input.pilotId && e.baseId === input.baseId && e.total > 0 && e.passed === e.total,
  );

  const missing: QualificationScope[] = [];
  if (!individualQualified) missing.push('individual');
  if (needsCombination && !combinationQualified) missing.push('combination');
  if (!placementQualified) missing.push('placement');

  const qualified = missing.length === 0;
  return {
    qualified,
    suggestOnly: true,
    individualQualified,
    combinationQualified,
    placementQualified,
    missing,
    reason: qualified
      ? `Qualified by individual${needsCombination ? ', combination,' : ''} and placement evidence (suggest-only retained).`
      : `No placement claim without ${missing.join(', ')} evidence.`,
  };
}
/** Chooses an execution pilot and attaches its F-006-T03/T04 placement assessment (F-045-T06). */
export function chooseQualifiedExecution(
  request: string,
  candidates: readonly (Pilot | RegisteredPilot | PilotCandidate)[],
  fallbackGeneric: Pilot,
  evidence: readonly QualificationEvidence[],
  opts?: { baseId?: string; partnerPilotIds?: readonly string[]; suggestOnly?: boolean },
): { choice: ExecutionChoice; placement: PlacementAssessment } {
  const choice = chooseExecutionPilot(request, candidates, fallbackGeneric, { suggestOnly: true });
  const placement = evaluatePilotPlacement({
    pilotId: choice.pilot.id,
    role: choice.pilot.role,
    baseId: choice.baseId ?? opts?.baseId ?? 'LOCAL',
    partnerPilotIds: opts?.partnerPilotIds,
    evidence,
  });
  return { choice: { ...choice, suggestOnly: true }, placement };
}
/** Checks whether a pilot may leave the machine for cloud/other-provider inference under Scrolls and trust stage (F-045-T07). */
export function canPilotLeaveMachine(
  pilot: Pick<Pilot, 'id' | 'stage' | 'route' | 'provider'>,
  input: { trust: Trust; privacy: Privacy; tool?: string; effect?: Effect; policy: Policy; remoteProvider?: boolean },
): { allowed: boolean; leavesMachine: boolean; reason?: string } {
  const leavesMachine = pilot.route === 'cloud' || Boolean(input.remoteProvider);
  if (!leavesMachine) return { allowed: true, leavesMachine: false };
  if (pilot.stage === 'prototype') {
    return { allowed: false, leavesMachine: true, reason: `Prototype pilot ${pilot.id} must stay on the local route.` };
  }
  if (input.trust === 'tainted') {
    return { allowed: false, leavesMachine: true, reason: 'Tainted input never leaves the machine.' };
  }
  if (input.privacy === 'local-only' || input.privacy === 'owner-bases') {
    return {
      allowed: false,
      leavesMachine: true,
      reason: `Privacy "${input.privacy}" forbids external pilot routing.`,
    };
  }
  if (input.policy.deny.includes('pilots.cloud') || input.policy.localOnly?.includes('pilots.cloud')) {
    return { allowed: false, leavesMachine: true, reason: 'Scrolls forbid cloud pilot routing.' };
  }
  if (input.tool) {
    if (input.policy.deny.includes(input.tool) || input.policy.localOnly?.includes(input.tool)) {
      return { allowed: false, leavesMachine: true, reason: `Scrolls keep tool "${input.tool}" on the machine.` };
    }
    if (
      input.effect &&
      !canLeaveMachine({ tool: input.tool, effect: input.effect, trust: input.trust }, input.policy)
    ) {
      return { allowed: false, leavesMachine: true, reason: `Scrolls forbid "${input.tool}" leaving the machine.` };
    }
  }
  return { allowed: true, leavesMachine: true };
}
/** Resolves a pilot's model route and provider against configured Models, Scrolls, and trust stage (F-045-T07). */
export function resolvePilotInference(
  pilot: Pick<Pilot, 'id' | 'stage' | 'model' | 'route' | 'provider'>,
  models: Models,
  policy: Policy,
  input: { trust: Trust; privacy: Privacy; hasCloudKey: boolean; tool?: string; effect?: Effect },
): { allowed: boolean; route: RouteName; model: string; provider?: string; models?: Models; reason?: string } {
  const engine = pilot.provider
    ? models.engines?.find((e) => e.id === pilot.provider || e.provider === pilot.provider)
    : undefined;
  if (pilot.provider && pilot.provider !== 'ollama' && pilot.provider !== 'anthropic' && !engine) {
    return {
      allowed: false,
      route: pilot.route ?? 'local',
      model: pilot.model,
      provider: pilot.provider,
      reason: `Provider "${pilot.provider}" is not configured.`,
    };
  }
  const remoteProvider = engine ? engine.locality === 'remote' : pilot.provider === 'anthropic';
  const gate = canPilotLeaveMachine(pilot, { ...input, policy, remoteProvider });
  if (!gate.allowed) {
    return { allowed: false, route: 'local', model: pilot.model, provider: pilot.provider, reason: gate.reason };
  }
  if (pilot.route === 'cloud' || remoteProvider) {
    if (pilot.route === 'cloud' && (!models.cloud?.enabled || !input.hasCloudKey)) {
      return {
        allowed: false,
        route: 'cloud',
        model: pilot.model,
        provider: pilot.provider,
        reason: !models.cloud?.enabled
          ? 'Cloud route (Umbilical) is disabled.'
          : 'Cloud route (Umbilical) has no API key.',
      };
    }
    if (engine && engine.locality === 'remote') {
      return {
        allowed: true,
        route: 'cloud',
        model: pilot.model,
        provider: engine.id,
        models: { ...models, cloud: { provider: 'anthropic', model: pilot.model, enabled: true } },
      };
    }
    return {
      allowed: true,
      route: 'cloud',
      model: pilot.model,
      provider: pilot.provider ?? 'anthropic',
      models: {
        ...models,
        cloud: { ...(models.cloud ?? { provider: 'anthropic', enabled: true }), model: pilot.model, enabled: true },
      },
    };
  }
  if (!models.local) {
    return { allowed: false, route: 'local', model: pilot.model, reason: 'Local route (S²) is not configured.' };
  }
  return {
    allowed: true,
    route: 'local',
    model: pilot.model,
    provider: pilot.provider ?? 'ollama',
    models: { ...models, local: { ...models.local, model: pilot.model } },
  };
}
export interface SubdomainSortie {
  id: string;
  title: string;
  subdomain: string;
  keywords: readonly string[];
  parentScore: number;
  narrowerScore: number;
}
export interface PilotSplitProposal {
  kind: 'split';
  parentId: string;
  proposedId: string;
  name: string;
  domain: string;
  keywords: string[];
  lineage: string[];
  sampleSize: number;
  parentScore: number;
  narrowerScore: number;
  sortieIds: string[];
  rationale: string;
}
export interface PilotMergeProposal {
  kind: 'merge';
  sourceIds: [string, string];
  proposedId: string;
  name: string;
  domain: string;
  keywords: string[];
  skills: string[];
  tools: string[];
  lineage: string[];
  version: number;
  rationale: string;
}
const toPilotId = (text: string): string => {
  const slug = words(text)
    .replace(/\s+/g, '-')
    .slice(0, 28)
    .replace(/^-+|-+$/g, '');
  return (/^[a-z]/.test(slug) ? slug : `p-${slug || 'pilot'}`).slice(0, 31);
};
const versionTag = (pilot: Pick<Pilot, 'id' | 'version'>) => `${pilot.id}@v${pilot.version ?? 1}`;
/** Proposes a split when sorties cluster in a subdomain and a narrower keyword set scores strictly higher (F-045-T08). */
export function proposePilotSplit(
  pilot: Pilot,
  sorties: readonly SubdomainSortie[],
  opts?: { minClusterSize?: number; minScoreGain?: number },
): PilotSplitProposal | undefined {
  const minCluster = opts?.minClusterSize ?? 3;
  const minGain = opts?.minScoreGain ?? 0.05;
  const groups = new Map<string, SubdomainSortie[]>();
  for (const s of sorties) {
    const key = words(s.subdomain);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  let best: PilotSplitProposal | undefined;
  for (const [subdomain, list] of groups) {
    if (list.length < minCluster) continue;
    const parentAvg = list.reduce((sum, s) => sum + s.parentScore, 0) / list.length;
    const narrowerAvg = list.reduce((sum, s) => sum + s.narrowerScore, 0) / list.length;
    if (narrowerAvg - parentAvg < minGain) continue;
    const keywords = [...new Set(list.flatMap((s) => s.keywords.map(words)).filter(Boolean))].slice(0, 30);
    if (!keywords.length) continue;
    const candidate: PilotSplitProposal = {
      kind: 'split',
      parentId: pilot.id,
      proposedId: toPilotId(subdomain),
      name: subdomain.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 40),
      domain: subdomain,
      keywords,
      lineage: [...(pilot.lineage ?? []), versionTag(pilot)],
      sampleSize: list.length,
      parentScore: Number(parentAvg.toFixed(3)),
      narrowerScore: Number(narrowerAvg.toFixed(3)),
      sortieIds: list.map((s) => s.id),
      rationale: `${list.length} sorties clustered in "${subdomain}" with narrower score ${narrowerAvg.toFixed(2)} vs parent ${parentAvg.toFixed(2)}.`,
    };
    if (!best || candidate.narrowerScore - candidate.parentScore > best.narrowerScore - best.parentScore) {
      best = candidate;
    }
  }
  return best;
}
/** Proposes merging two active pilots when their domains overlap and neither is clearly better (F-045-T08). */
export function proposePilotMerge(
  roster: readonly Pilot[],
  records?: ReadonlyMap<string, PilotRecord & { score?: number }>,
  opts?: { maxScoreDelta?: number },
): PilotMergeProposal | undefined {
  const active = roster.filter((p) => !p.retired);
  const maxDelta = opts?.maxScoreDelta ?? 0.1;
  const scoreOf = (id: string) => records?.get(id)?.score ?? recordScore(records?.get(id));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      const sharedKeywords = a.keywords.some((k) => b.keywords.includes(k));
      if (!overlappingDomains(a.domain, b.domain) && !sharedKeywords) continue;
      if (Math.abs(scoreOf(a.id) - scoreOf(b.id)) > maxDelta) continue;
      const version = Math.max(a.version ?? 1, b.version ?? 1) + 1;
      return {
        kind: 'merge',
        sourceIds: [a.id, b.id],
        proposedId: a.id,
        name: a.name,
        domain: a.domain,
        keywords: [...new Set([...a.keywords, ...b.keywords])].slice(0, 30),
        skills: [...new Set([...(a.skills ?? []), ...(b.skills ?? [])])].slice(0, MAX_PILOTS),
        tools: [...new Set([...(a.tools ?? []), ...(b.tools ?? [])])].slice(0, MAX_PILOTS),
        lineage: [...new Set([...(a.lineage ?? []), versionTag(a), ...(b.lineage ?? []), versionTag(b)])].slice(
          0,
          MAX_PILOTS,
        ),
        version,
        rationale: `Pilots ${a.id} and ${b.id} overlap in "${a.domain}" / "${b.domain}" with equivalent evidence.`,
      };
    }
  }
  return undefined;
}
/** Applies an owner-approved pilot split, creating the narrower child at Prototype with versioned lineage (F-045-T08). */
export function splitPilot(
  roster: readonly Pilot[],
  parentId: string,
  child: Pick<Pilot, 'id' | 'name' | 'domain' | 'keywords'> & { model?: string; tools?: string[]; skills?: string[] },
): Pilot[] {
  const parent = roster.find((p) => p.id === parentId);
  if (!parent) throw new Error(`Unknown specialist pilot: ${parentId}.`);
  if (roster.some((p) => p.id === child.id)) throw new Error(`A pilot ${child.id} already exists.`);
  const lineage = [...new Set([...(parent.lineage ?? []), versionTag(parent)])];
  const entry: Pilot = {
    id: child.id,
    name: child.name,
    domain: child.domain,
    keywords: child.keywords,
    model: child.model ?? parent.model,
    ...(parent.route ? { route: parent.route } : {}),
    ...(parent.provider ? { provider: parent.provider } : {}),
    ...((child.skills ?? parent.skills) ? { skills: child.skills ?? [...parent.skills!] } : {}),
    ...((child.tools ?? parent.tools) ? { tools: child.tools ?? [...parent.tools!] } : {}),
    stage: 'prototype',
    parent: parent.id,
    version: 1,
    lineage,
  };
  return addPilot(roster, entry);
}
/** Applies an owner-approved pilot merge, preserving versioned lineage and retiring superseded sources (F-045-T08). */
export function mergePilots(
  roster: readonly Pilot[],
  sourceIds: readonly [string, string],
  target: { id: string; name?: string; domain?: string; keywords?: string[] },
): Pilot[] {
  const [leftId, rightId] = sourceIds;
  const left = roster.find((p) => p.id === leftId);
  const right = roster.find((p) => p.id === rightId);
  if (!left || !right) throw new Error(`Merge sources must exist: ${leftId}, ${rightId}.`);
  if (leftId === rightId) throw new Error('Merge sources must be distinct.');
  const lineage = [
    ...new Set([...(left.lineage ?? []), versionTag(left), ...(right.lineage ?? []), versionTag(right)]),
  ];
  const version = Math.max(left.version ?? 1, right.version ?? 1) + 1;
  const keywords = [...new Set(target.keywords ?? [...left.keywords, ...right.keywords])].slice(0, 30);
  const skills = [...new Set([...(left.skills ?? []), ...(right.skills ?? [])])].slice(0, MAX_PILOTS);
  const tools = [...new Set([...(left.tools ?? []), ...(right.tools ?? [])])].slice(0, MAX_PILOTS);
  let next = [...roster];
  if (target.id === leftId || target.id === rightId) {
    const keep = target.id === leftId ? left : right;
    const retire = target.id === leftId ? right : left;
    next = updatePilot(next, keep.id, {
      ...(target.name ? { name: target.name } : {}),
      ...(target.domain ? { domain: target.domain } : {}),
      keywords,
      ...(skills.length ? { skills } : {}),
      ...(tools.length ? { tools } : {}),
      version,
      lineage,
    });
    return setPilotFlag(next, retire.id, 'retired', true);
  }
  next = setPilotFlag(setPilotFlag(next, leftId, 'retired', true), rightId, 'retired', true);
  return addPilot(next, {
    id: target.id,
    name: target.name ?? left.name,
    domain: target.domain ?? left.domain,
    keywords,
    ...(skills.length ? { skills } : {}),
    ...(tools.length ? { tools } : {}),
    model: left.model,
    stage: 'prototype',
    parent: left.id,
    version,
    lineage,
  });
}
export interface PilotToolProposal {
  pilotId: string;
  add: string[];
  remove: string[];
  rationale: string;
}
/** Proposes owner-approved tool acquisition or discard for a pilot from missing/unused tool evidence (F-045-T09). */
export function proposePilotToolChange(
  pilot: Pick<Pilot, 'id' | 'tools'>,
  evidence: {
    missingTools?: readonly { tool: string; count: number }[];
    unusedTools?: readonly { tool: string; daysUnused: number; uses?: number }[];
  },
  opts?: { minMissingCount?: number; minUnusedDays?: number },
): PilotToolProposal | undefined {
  const minMissing = opts?.minMissingCount ?? 2;
  const minUnused = opts?.minUnusedDays ?? 30;
  const current = new Set(pilot.tools ?? []);
  const add = (evidence.missingTools ?? [])
    .filter((m) => m.count >= minMissing && !current.has(m.tool))
    .map((m) => m.tool);
  const remove = (evidence.unusedTools ?? [])
    .filter((u) => u.daysUnused >= minUnused && (u.uses ?? 0) === 0 && current.has(u.tool))
    .map((u) => u.tool);
  if (!add.length && !remove.length) return undefined;
  const parts: string[] = [];
  if (add.length) parts.push(`add ${add.join(', ')} (missing in repeated sorties)`);
  if (remove.length) parts.push(`discard ${remove.join(', ')} (unused for ${minUnused}+ days)`);
  return { pilotId: pilot.id, add, remove, rationale: `Pilot ${pilot.id}: ${parts.join('; ')}.` };
}
/** Applies an owner-approved tool acquisition/discard change to a pilot and bumps its version (F-045-T09). */
export function applyPilotToolChange(
  roster: readonly Pilot[],
  id: string,
  change: { add?: readonly string[]; remove?: readonly string[] },
): { roster: Pilot[]; pilot: Pilot; added: string[]; removed: string[] } {
  const current = roster.find((p) => p.id === id);
  if (!current) throw new Error(`Unknown specialist pilot: ${id}.`);
  if (current.retired) throw new Error(`Pilot ${id} is retired.`);
  const existing = current.tools ?? [];
  const removeSet = new Set(change.remove ?? []);
  const removed = existing.filter((t) => removeSet.has(t));
  const kept = existing.filter((t) => !removeSet.has(t));
  const added = (change.add ?? []).filter((t) => !kept.includes(t));
  const tools = [...kept, ...added];
  const next = updatePilot(roster, id, { tools, version: (current.version ?? 1) + 1 });
  return { roster: next, pilot: next.find((p) => p.id === id)!, added, removed };
}
const GENERIC_DOMAINS = new Set([
  'none',
  'general',
  'generic',
  'other',
  'misc',
  'miscellaneous',
  'unknown',
  'n a',
  'na',
  'not applicable',
  'no domain',
  'anything',
  'everything',
  'chat',
  'greeting',
  'conversation',
  'question',
  'request',
  'help',
  'clarification',
  'time',
  'time request',
  'date',
  'clock',
  'timezone',
  'status',
  'reminder',
  'reminders',
  'schedule',
  'brief',
  'general request',
  'general help',
  'general question',
  'user request',
  'new request',
  'built in',
]);
/** Rejects generic, meta, or routine built-in domain labels (e.g. "time request") from pilot proposals (F-045-T09). */
export function sanitizeProposedDomain(raw: string): string | undefined {
  const normalized = words(raw).split(' ').filter(Boolean).slice(0, 4).join(' ').slice(0, 40);
  if (!normalized || GENERIC_DOMAINS.has(normalized)) return undefined;
  const tokens = normalized.split(' ');
  if (tokens.length === 1 && tokens[0]!.length < 3) return undefined;
  if (tokens.every((t) => GENERIC_DOMAINS.has(t))) return undefined;
  return normalized;
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
