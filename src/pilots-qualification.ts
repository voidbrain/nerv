import { canLeaveMachine, type Effect, type Policy, type Trust } from './policy.ts';
import type { Models, Privacy, RouteName } from './model.ts';
import {
  GENERIC,
  MAX_PILOTS,
  addPilot,
  chooseExecutionPilot,
  overlappingDomains,
  recordScore,
  setPilotFlag,
  updatePilot,
  words,
  type ExecutionChoice,
  type Pilot,
  type PilotCandidate,
  type PilotRecord,
  type RegisteredPilot,
} from './pilots.ts';
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

export interface CombinationEvidenceRef {
  configurationId: string;
  candidateArtifactDigest: string;
  finished: string;
  complete: boolean;
  passed: boolean;
  grader: {
    graderHash: string;
    hiddenAcceptanceHash: string;
    tamperDetected: boolean;
  };
  promotionAuthority?: {
    grantsProductionPermission: boolean;
  };
}

export interface PromotionAuthorityInput {
  pilot: Pilot & { suspended?: boolean };
  evidence: CombinationEvidenceRef;
  expectedConfigurationId: string;
  expectedArtifactDigest: string;
  expectedGraderHash: string;
  expectedHiddenAcceptanceHash: string;
  ownerApproved: boolean;
  policy?: Pick<Policy, 'deny' | 'localOnly'>;
  maxAgeMs?: number;
  nowMs?: number;
}

/**
 * Rechecks exact candidate artifact identity, protected grader identity, freshness, and current NERV authority before
 * any promotion or production grant (F-006-T10). A passing or signed evaluation report alone grants nothing.
 */
export function verifyPromotionAuthority(input: PromotionAuthorityInput): { allowed: boolean; reason?: string } {
  const {
    pilot,
    evidence,
    expectedConfigurationId,
    expectedArtifactDigest,
    expectedGraderHash,
    expectedHiddenAcceptanceHash,
    ownerApproved,
    policy,
  } = input;
  if (!ownerApproved) {
    return { allowed: false, reason: 'Owner approval is required; evaluation evidence alone grants no authority.' };
  }
  if (pilot.retired) {
    return { allowed: false, reason: `Pilot ${pilot.id} is retired.` };
  }
  if (pilot.suspended) {
    return { allowed: false, reason: `Pilot ${pilot.id} is suspended.` };
  }
  if (evidence.promotionAuthority && evidence.promotionAuthority.grantsProductionPermission !== false) {
    return { allowed: false, reason: 'Evaluation evidence illegally claims direct production permission.' };
  }
  if (evidence.grader.tamperDetected) {
    return { allowed: false, reason: 'Grader tamper was detected in qualification evidence.' };
  }
  if (evidence.grader.graderHash !== expectedGraderHash) {
    return { allowed: false, reason: 'Grader hash does not match current protected grader.' };
  }
  if (evidence.grader.hiddenAcceptanceHash !== expectedHiddenAcceptanceHash) {
    return { allowed: false, reason: 'Hidden acceptance hash does not match current case pack.' };
  }
  if (!evidence.complete || !evidence.passed) {
    return { allowed: false, reason: 'Qualification evidence is incomplete or did not pass.' };
  }
  if (evidence.candidateArtifactDigest !== expectedArtifactDigest) {
    return { allowed: false, reason: 'Candidate artifact digest does not match current artifact.' };
  }
  if (evidence.configurationId !== expectedConfigurationId) {
    return { allowed: false, reason: 'Configuration identity does not match current coder/reviewer configuration.' };
  }
  const maxAgeMs = input.maxAgeMs ?? 30 * 86_400_000;
  const nowMs = input.nowMs ?? Date.now();
  const finishedMs = Date.parse(evidence.finished);
  if (!Number.isFinite(finishedMs) || nowMs - finishedMs > maxAgeMs || finishedMs > nowMs + 60_000) {
    return { allowed: false, reason: 'Qualification evidence is stale or has an invalid timestamp.' };
  }
  if (policy?.deny && (pilot.tools ?? []).some((t) => policy.deny.includes(t))) {
    return { allowed: false, reason: `Current policy denies one or more tools configured on pilot ${pilot.id}.` };
  }
  return { allowed: true };
}
