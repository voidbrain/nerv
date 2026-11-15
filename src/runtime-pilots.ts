import { readConfig, readModelKey, readScrolls, savePilots } from './config.ts';
import type { RemoteOffer } from './misato.ts';
import { detectOllama, ollamaUrlOf } from './model-setup.ts';
import {
  PilotRegistry,
  addPilot as addPilotEntry,
  chooseExecutionPilot,
  choosePilot,
  chooseQualifiedExecution,
  demotePilot,
  evaluatePilotPlacement,
  genericPilot as buildGenericPilot,
  promotionEligible,
  proposePilotMerge,
  proposePilotSplit,
  proposePilotToolChange,
  resolvePilotInference,
  sanitizeProposedDomain,
  selectRemotePilotRun,
  setPilotFlag as setPilotEntryFlag,
  shouldDemotePilot,
  updatePilot as updatePilotEntry,
  verifyPromotionAuthority,
  type CombinationEvidenceRef,
  type ExecutionChoice,
  type Pilot,
  type PilotCandidate,
  type PilotOffer,
  type PilotPatch,
  type PilotRecord,
  type PlacementAssessment,
  type PromotionAuthorityInput,
  type QualificationEvidence,
  type RegisteredPilot,
  type SubdomainSortie,
} from './pilots.ts';
import { defaultPolicy, type Effect, type Stage } from './policy.ts';
import type { ProcessClient } from './process-client.ts';
import type { OwnerAction } from './runtime-api.ts';

/** Requests in one domain without a specialist, within 30 days, before a pilot is proposed (F-045). */
const PILOT_THRESHOLD = 3;

export interface RuntimePilotHost {
  readonly home: string | undefined;
  readonly nervous: ProcessClient;
  pilotRoster(): Pilot[];
  getPilots(): Pilot[];
  gate(sortieId: string, action: OwnerAction, intent?: boolean): Promise<unknown>;
  registeredPilots(now?: number): Promise<RegisteredPilot[]>;
  remoteOffers(): Promise<RemoteOffer[]>;
}

/**
 * Pilot registry, Marduk proposals, qualification/placement, and pilot CRUD extracted from Runtime (F-095-T03).
 */
export class RuntimePilots {
  private readonly host: RuntimePilotHost;
  private pilotReg?: PilotRegistry;
  private pilotProposal: Promise<unknown> = Promise.resolve();

  constructor(host: RuntimePilotHost) {
    this.host = host;
  }

  getPilotRegistry(): PilotRegistry {
    if (!this.pilotReg) {
      const baseId = this.host.home ? (readConfig(this.host.home).base.id ?? 'LOCAL') : 'LOCAL';
      this.pilotReg = new PilotRegistry(baseId, () => this.host.getPilots());
    }
    return this.pilotReg;
  }

  offeredPilots(): PilotOffer[] {
    return this.getPilotRegistry().offered();
  }

  notePeerPilots(baseId: string, pilots: PilotOffer[], now = Date.now()): void {
    this.getPilotRegistry().recordPeer(baseId, pilots, now);
  }

  proposePilot(domain: string, now = new Date()): Promise<boolean> {
    const next = this.pilotProposal.then(() => this.proposePilotOnce(domain, now));
    this.pilotProposal = next.catch(() => {});
    return next;
  }

  private async proposePilotOnce(domain: string, now: Date): Promise<boolean> {
    const cleanDomain = sanitizeProposedDomain(domain);
    if (!cleanDomain) return false;
    if (choosePilot(cleanDomain, this.host.getPilots())) return false;
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const seen = (await this.host.nervous.call('pilots.unmatched', { domain: cleanDomain, since })) as {
      count: number;
      sorties: { id: string; title: string }[];
      proposal: string | null;
    };
    if (seen.count < PILOT_THRESHOLD || seen.proposal) return false;
    const id = (/^[a-z]/.test(cleanDomain) ? '' : 'p-') + cleanDomain.replace(/ /g, '-').slice(0, 28);
    const name = cleanDomain.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 40);
    const keywords = [...new Set([cleanDomain, ...cleanDomain.split(' ').filter((w) => w.length >= 4)])].slice(0, 10);
    const sortieId = (await this.host.nervous.call('sorties.open', {
      title: `Marduk Institute: a pilot for ${cleanDomain}?`,
      source: 'marduk',
    })) as string;
    const why = `${seen.count} requests about ${cleanDomain} in 30 days (sample size ${seen.count}) had no specialist: ${seen.sorties.map((s) => `S-${s.id.slice(0, 4).toUpperCase()} “${s.title.slice(0, 60)}”`).join(', ')}.`;
    await this.host.gate(
      sortieId,
      {
        request: `Marduk Institute proposes a pilot for ${cleanDomain} at Prototype. ${why}`,
        tool: 'pilots.create',
        args: { id, name, domain: cleanDomain, keywords },
      },
      false,
    );
    return true;
  }

  genericPilot(): Pilot {
    const model = this.host.home ? (readConfig(this.host.home).models.roles?.consultant?.model ?? null) : null;
    return buildGenericPilot(model, 'prototype');
  }

  selectPilotForExecution(
    request: string,
    candidates?: readonly (Pilot | RegisteredPilot | PilotCandidate)[],
    opts?: { suggestOnly?: boolean },
  ): ExecutionChoice {
    return chooseExecutionPilot(request, candidates ?? this.host.pilotRoster(), this.genericPilot(), opts);
  }

  async selectRemotePilotForExecution(
    request: string,
    tool?: string,
    opts?: { suggestOnly?: boolean },
  ): Promise<{ choice: ExecutionChoice; remote: boolean; allowed: boolean; reason?: string }> {
    const candidates = await this.host.registeredPilots();
    const offers = await this.host.remoteOffers();
    const offeredByBase = new Map(offers.map((o) => [o.base, o.tools]));
    return selectRemotePilotRun(request, candidates, offeredByBase, this.genericPilot(), tool, {
      ...opts,
      localBaseId: this.getPilotRegistry().localBaseId,
    });
  }

  evaluatePilotPromotion(id: string, record: PilotRecord & { daysInStage?: number }) {
    const pilot = this.host.pilotRoster().find((p) => p.id === id);
    if (!pilot) throw new Error(`Unknown specialist pilot: ${id}.`);
    return promotionEligible(pilot, record);
  }

  verifyPilotPromotionAuthority(
    id: string,
    input: Omit<PromotionAuthorityInput, 'pilot' | 'policy'> & {
      evidence: CombinationEvidenceRef;
      policy?: PromotionAuthorityInput['policy'];
    },
  ) {
    const pilot = this.host.pilotRoster().find((p) => p.id === id);
    if (!pilot) throw new Error(`Unknown specialist pilot: ${id}.`);
    const policy =
      input.policy ??
      (() => {
        try {
          return this.host.home ? readScrolls(this.host.home).policy : defaultPolicy;
        } catch {
          return defaultPolicy;
        }
      })();
    return verifyPromotionAuthority({ ...input, pilot, policy });
  }

  demotePilotOnSignal(
    id: string,
    signals: { failure?: boolean; spear?: boolean; overrides?: number; maxOverrides?: number },
  ): { demoted: boolean; from?: Stage; to?: Stage; reason?: string } {
    const roster = this.host.pilotRoster();
    const pilot = roster.find((p) => p.id === id);
    if (!pilot) return { demoted: false };
    const check = shouldDemotePilot(pilot, signals);
    if (!check.demote) return { demoted: false };
    const next = demotePilot(roster, id);
    if (!next.changed) return { demoted: false };
    if (this.host.home) savePilots(this.host.home, next.roster);
    return { demoted: true, from: next.from, to: next.to, reason: check.reason };
  }

  assessPilotPlacement(
    id: string,
    evidence: readonly QualificationEvidence[],
    opts?: { baseId?: string; partnerPilotIds?: readonly string[] },
  ): PlacementAssessment {
    const pilot = this.host.pilotRoster().find((p) => p.id === id);
    if (!pilot) throw new Error(`Unknown specialist pilot: ${id}.`);
    return evaluatePilotPlacement({
      pilotId: pilot.id,
      role: pilot.role,
      baseId: opts?.baseId ?? this.getPilotRegistry().localBaseId,
      partnerPilotIds: opts?.partnerPilotIds,
      evidence,
    });
  }

  selectQualifiedPilotForExecution(
    request: string,
    evidence: readonly QualificationEvidence[],
    opts?: { partnerPilotIds?: readonly string[]; candidates?: readonly (Pilot | RegisteredPilot | PilotCandidate)[] },
  ) {
    return chooseQualifiedExecution(
      request,
      opts?.candidates ?? this.host.pilotRoster(),
      this.genericPilot(),
      evidence,
      {
        baseId: this.getPilotRegistry().localBaseId,
        partnerPilotIds: opts?.partnerPilotIds,
      },
    );
  }

  selectPilotInference(
    id: string,
    input: {
      trust: 'trusted' | 'tainted';
      privacy: 'local-only' | 'owner-bases' | 'any';
      tool?: string;
      effect?: Effect;
    },
  ) {
    if (!this.host.home) throw new Error('Pilot routing needs the data home.');
    const config = readConfig(this.host.home);
    const pilot = (config.pilots ?? []).find((p) => p.id === id);
    if (!pilot) throw new Error(`Unknown specialist pilot: ${id}.`);
    const hasCloudKey = Boolean(readModelKey(this.host.home));
    return resolvePilotInference(pilot, config.models, readScrolls(this.host.home).policy, { ...input, hasCloudKey });
  }

  async proposePilotSplit(parentId: string, sorties: readonly SubdomainSortie[]) {
    const parent = this.host.pilotRoster().find((p) => p.id === parentId);
    if (!parent) throw new Error(`Unknown specialist pilot: ${parentId}.`);
    const proposal = proposePilotSplit(parent, sorties);
    if (!proposal) return undefined;
    const sortieId = (await this.host.nervous.call('sorties.open', {
      title: `Marduk Institute: split ${proposal.proposedId} from ${parent.id}?`,
      source: 'marduk',
    })) as string;
    await this.host.gate(
      sortieId,
      {
        request: `Marduk Institute proposes splitting ${proposal.proposedId} from ${parent.id}. ${proposal.rationale}`,
        tool: 'pilots.split',
        args: {
          parentId: parent.id,
          id: proposal.proposedId,
          name: proposal.name,
          domain: proposal.domain,
          keywords: proposal.keywords,
        },
      },
      false,
    );
    return proposal;
  }

  async proposePilotMerge(records?: ReadonlyMap<string, PilotRecord & { score?: number }>) {
    const proposal = proposePilotMerge(this.host.pilotRoster(), records);
    if (!proposal) return undefined;
    const sortieId = (await this.host.nervous.call('sorties.open', {
      title: `Marduk Institute: merge ${proposal.sourceIds.join(' + ')}?`,
      source: 'marduk',
    })) as string;
    await this.host.gate(
      sortieId,
      {
        request: `Marduk Institute proposes merging ${proposal.sourceIds.join(' and ')} into ${proposal.proposedId}. ${proposal.rationale}`,
        tool: 'pilots.merge',
        args: {
          sourceIds: proposal.sourceIds,
          id: proposal.proposedId,
          name: proposal.name,
          domain: proposal.domain,
          keywords: proposal.keywords,
        },
      },
      false,
    );
    return proposal;
  }

  async proposePilotTools(
    pilotId: string,
    evidence: {
      missingTools?: readonly { tool: string; count: number }[];
      unusedTools?: readonly { tool: string; daysUnused: number; uses?: number }[];
    },
  ) {
    const pilot = this.host.pilotRoster().find((p) => p.id === pilotId);
    if (!pilot) throw new Error(`Unknown specialist pilot: ${pilotId}.`);
    const proposal = proposePilotToolChange(pilot, evidence);
    if (!proposal) return undefined;
    const sortieId = (await this.host.nervous.call('sorties.open', {
      title: `Marduk Institute: update tools for ${pilot.id}?`,
      source: 'marduk',
    })) as string;
    await this.host.gate(
      sortieId,
      {
        request: `Marduk Institute proposes updating tools for ${pilot.id}. ${proposal.rationale}`,
        tool: 'pilots.tools',
        args: {
          id: pilot.id,
          ...(proposal.add.length ? { add: proposal.add } : {}),
          ...(proposal.remove.length ? { remove: proposal.remove } : {}),
        },
      },
      false,
    );
    return proposal;
  }

  private async requireInstalledModel(model: string): Promise<void> {
    if (!this.host.home) throw new Error('Pilot setup needs the data home.');
    if (typeof model !== 'string' || !model.trim() || model.length > 100)
      throw new Error('Pick a local model up to 100 characters.');
    const found = await detectOllama(ollamaUrlOf(readConfig(this.host.home).models));
    if (!found.reachable) throw new Error('Ollama is unavailable; pilot settings were not changed.');
    if (!found.models.some((m) => m.name === model)) throw new Error('Pick an installed Ollama model.');
  }

  async changePilotModel(id: string, model: string): Promise<Pilot[]> {
    await this.requireInstalledModel(model);
    const roster = readConfig(this.host.home!).pilots ?? [];
    if (!roster.some((p) => p.id === id)) throw new Error('Unknown specialist pilot.');
    const next = updatePilotEntry(roster, id, { model });
    savePilots(this.host.home!, next);
    return next;
  }

  async addPilot(entry: Pilot): Promise<Pilot[]> {
    await this.requireInstalledModel(entry.model);
    const roster = readConfig(this.host.home!).pilots ?? [];
    const next = addPilotEntry(roster, entry);
    savePilots(this.host.home!, next);
    return next;
  }

  async updatePilot(id: string, patch: PilotPatch): Promise<Pilot[]> {
    if (!this.host.home) throw new Error('Pilot setup needs the data home.');
    if (patch.model !== undefined) await this.requireInstalledModel(patch.model);
    const roster = readConfig(this.host.home).pilots ?? [];
    const next = updatePilotEntry(roster, id, patch);
    savePilots(this.host.home, next);
    return next;
  }

  async setPilotFlag(id: string, flag: 'pinned' | 'retired', on: boolean): Promise<Pilot[]> {
    if (!this.host.home) throw new Error('Pilot setup needs the data home.');
    const roster = readConfig(this.host.home).pilots ?? [];
    const next = setPilotEntryFlag(roster, id, flag, on);
    savePilots(this.host.home, next);
    return next;
  }
}
