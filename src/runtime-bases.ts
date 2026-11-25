import type { KeyObject } from 'node:crypto';
import { channelIsFresh, sanitizeChannel, type ChannelState, type HeardChannel } from './channel-state.ts';
import { readConfig } from './config.ts';
import type { SortieEvent } from './events.ts';
import { baseKey, type BaseEntry } from './kaji.ts';
import { ONLINE_MS, type BaseHealth, type HeardHealth, type RegistryPort } from './kaji-link.ts';
import type { ActionDetail, SortieSummary } from './ledger.ts';
import {
  OperatorDirectory,
  signOperatorEntry,
  type OperatorResolution,
  type PublicOperatorInfo,
  type SignedOperatorEntry,
} from './operator-directory.ts';

export type RemoteSortieLoader = (
  baseId: string,
  sortieId: string,
) => Promise<{
  base: { id: string; name: string };
  sortie: SortieSummary & { detail: ActionDetail[] };
  events: SortieEvent[];
} | null>;

export interface RuntimeBasesHost {
  readonly home?: string;
  readonly kaji: RegistryPort;
  getSelfKey(): string | undefined;
  setSelfKey(publicKey: string): void;
  health(): Promise<{ processes: { brainAlive?: boolean }; degraded: string[] }>;
}

/**
 * Operator directory, base health/channel telemetry, peer base list, and remote sortie loader
 * extracted from Runtime (F-095-T03).
 */
export class RuntimeBases {
  private readonly host: RuntimeBasesHost;
  readonly operatorDirectoryState = new OperatorDirectory();
  private operatorSerial = 0;
  private operatorConfigSignature = '';
  private cachedOwnOperator?: SignedOperatorEntry;
  private selfPrivateKey?: KeyObject;
  private readonly heard = new Map<string, HeardHealth>();
  private readonly channelsHeard = new Map<string, HeardChannel>();
  private readonly reachableHeard = new Map<string, { peers: string[]; at: string }>();
  private ownChannel: () => ChannelState = () => ({ mode: 'unknown', checkedAt: new Date().toISOString() });
  private remoteSortieLoader?: RemoteSortieLoader;

  constructor(host: RuntimeBasesHost) {
    this.host = host;
  }

  /** Marks which entry is this base (by its public key) for the dashboard, and optionally holds its signing key. */
  setBaseKey(publicKey: string, privateKey?: KeyObject): void {
    this.host.setSelfKey(publicKey);
    if (privateKey) this.selfPrivateKey = privateKey;
  }

  ownOperatorEntry(): SignedOperatorEntry | undefined {
    const cfg = this.host.home ? readConfig(this.host.home) : undefined;
    const baseId = cfg?.base.id;
    const key = this.selfPrivateKey ?? (this.host.home ? baseKey(this.host.home).privateKey : undefined);
    if (!baseId || !key) return undefined;
    const sig = JSON.stringify({ baseId, operator: cfg?.operator ?? null });
    if (sig !== this.operatorConfigSignature || !this.cachedOwnOperator) {
      this.operatorConfigSignature = sig;
      this.operatorSerial += 1;
      this.cachedOwnOperator = signOperatorEntry(baseId, key, cfg?.operator, this.operatorSerial);
    }
    return this.cachedOwnOperator;
  }

  notePeerOperator(baseId: string, entry: SignedOperatorEntry, bases?: BaseEntry[]): void {
    if (bases) {
      this.operatorDirectoryState.record(entry, bases, baseId);
      return;
    }
    void this.host.kaji
      .bases()
      .then((list) => this.operatorDirectoryState.record(entry, list, baseId))
      .catch(() => {});
  }

  private syncOwnOperator(bases: BaseEntry[]): void {
    const own = this.ownOperatorEntry();
    if (own) this.operatorDirectoryState.record(own, bases, own.body.baseId);
  }

  async operators(): Promise<PublicOperatorInfo[]> {
    const [list, seen] = await Promise.all([this.host.kaji.bases(), this.host.kaji.lastSeen()]);
    this.syncOwnOperator(list);
    const selfBaseId = list.find((b) => b.publicKey === this.host.getSelfKey())?.baseId;
    return this.operatorDirectoryState.list(list, seen, selfBaseId);
  }

  async resolveOperator(query: string, options?: { excludeSelf?: boolean }): Promise<OperatorResolution> {
    const [list, seen] = await Promise.all([this.host.kaji.bases(), this.host.kaji.lastSeen()]);
    this.syncOwnOperator(list);
    const selfBaseId = list.find((b) => b.publicKey === this.host.getSelfKey())?.baseId;
    return this.operatorDirectoryState.resolve(query, list, seen, {
      selfBaseId,
      excludeSelf: options?.excludeSelf,
    });
  }

  setChannelState(read: () => ChannelState): void {
    this.ownChannel = read;
  }

  channelState(): ChannelState {
    try {
      const c = sanitizeChannel(this.ownChannel());
      if (c) return c;
    } catch {
      /* telemetry never prevents diagnostics */
    }
    return { mode: 'unknown', checkedAt: new Date().toISOString() };
  }

  notePeerChannel(baseId: string, channel: HeardChannel | null): void {
    if (channel) this.channelsHeard.set(baseId, channel);
    else this.channelsHeard.delete(baseId);
  }

  notePeerHealth(baseId: string, health: HeardHealth): void {
    this.heard.set(baseId, health);
  }

  notePeerReachable(baseId: string, peers: string[], at = new Date().toISOString()): void {
    this.reachableHeard.set(baseId, { peers: [...peers], at });
  }

  /** This base's health as it reports it to its peers: degraded with the reasons doctor and status give. */
  async baseHealth(): Promise<BaseHealth> {
    const h = await this.host.health();
    const reasons = [
      ...new Set([...(h.processes.brainAlive === false ? ['brain process not alive'] : []), ...h.degraded]),
    ].slice(0, 3);
    return { state: reasons.length ? 'degraded' : 'online', reasons };
  }

  async bases() {
    const [list, seen, main] = await Promise.all([
      this.host.kaji.bases(),
      this.host.kaji.lastSeen(),
      this.host.kaji.main?.(),
    ]);
    this.syncOwnOperator(list);
    const selfKey = this.host.getSelfKey();
    const selfBaseId = list.find((b) => b.publicKey === selfKey)?.baseId;
    const directory = new Map(this.operatorDirectoryState.list(list, seen, selfBaseId).map((o) => [o.baseId, o]));
    const now = Date.now();
    const mine = await this.baseHealth().catch((): BaseHealth => ({
      state: 'degraded',
      reasons: ['health check failed'],
    }));
    return list.map((b) => {
      const self = b.publicKey === selfKey;
      const online =
        b.status === 'enrolled' && (self || (!!seen[b.baseId] && now - Date.parse(seen[b.baseId]!) < ONLINE_MS));
      // A peer's report counts only while it is online; an older base that sends none has health null (online/offline only).
      const heard = this.heard.get(b.baseId);
      const health = self
        ? { ...mine, at: new Date(now).toISOString() }
        : online && heard && now - Date.parse(heard.at) < ONLINE_MS
          ? heard
          : null;
      const reported = this.channelsHeard.get(b.baseId);
      const channel = self ? { ...this.channelState(), receivedAt: new Date(now).toISOString() } : (reported ?? null);
      const channelFresh =
        !!channel &&
        online &&
        now - Date.parse(channel.receivedAt) < ONLINE_MS &&
        channelIsFresh(channel, now, ONLINE_MS);
      const op = directory.get(b.baseId);
      const heardReach = this.reachableHeard.get(b.baseId);
      const reachable =
        b.status !== 'enrolled'
          ? null
          : self
            ? heardReach && now - Date.parse(heardReach.at) < ONLINE_MS
              ? heardReach.peers
              : null
            : online && heardReach && now - Date.parse(heardReach.at) < ONLINE_MS
              ? heardReach.peers
              : null;
      return {
        ...b,
        channel,
        channelFresh,
        reachable,
        operator: op ? { name: op.operatorName, aliases: op.aliases, defaulted: op.defaulted, stale: op.stale } : null,
        lastSeen: seen[b.baseId] ?? null,
        online,
        self,
        health,
        main: b.baseId === main,
      };
    });
  }

  /** The owner's main base as this base sees it (F-036 phase 2): whether it is this base and whether it is online now. */
  async mainBase(): Promise<{ baseId: string; self: boolean; online: boolean } | undefined> {
    const main = await this.host.kaji.main?.();
    if (!main) return undefined;
    const b = (await this.bases()).find((x) => x.baseId === main);
    return b ? { baseId: main, self: b.self, online: b.online } : undefined;
  }

  setRemoteSortie(loader: RemoteSortieLoader): void {
    this.remoteSortieLoader = loader;
  }

  async remoteSortie(baseId: string, sortieId: string) {
    if (!this.remoteSortieLoader) throw new Error('Kaji unavailable.');
    return this.remoteSortieLoader(baseId, sortieId);
  }
}
