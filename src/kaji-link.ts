import { WorkerLink, type WorkerAdapter } from './worker-link.ts';
import { sanitizeChannel, type ChannelState, type HeardChannel } from './channel-state.ts';
import { sanitizePilotOffers, type PilotOffer } from './pilots.ts';
import { verifyOperatorEntry, type SignedOperatorEntry } from './operator-directory.ts';
import type { KeyObject } from 'node:crypto';
import { KAJI_CLOCK_SKEW_MS, signedHeaders, verifySigned, Nonces, type RootTrust } from './kaji-auth.ts';
export { signedHeaders, verifySigned, Nonces } from './kaji-auth.ts';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { type BaseEntry, type SignedRecord } from './kaji.ts';
/**
 * The Kaji line's live link (F-036, phase 1b). Each base listens on its enrolled address only (the Tailscale IP),
 * speaks only to enrolled bases, and signs every request and reply with its own base key. Heartbeats every 30 s give
 * each base the others' last-seen times (merged: newest wins), and a base that is behind on the registry fetches the
 * missing records and verifies each one against its own pinned root, so a compromised peer cannot add a base.
 * Tailscale encrypts the traffic; these signatures are what make a message trustworthy.
 */
export const KAJI_PORT = 4320;
export const ONLINE_MS = 90_000;
const MAX_BODY = 256 * 1024,
  HEARTBEAT_MS = 30_000;
/** F-062-T06: an encrypted backup copy (base64 in JSON) may be larger than any other Kaji message. */
export const MAX_BACKUP_BODY = 64 * 1024 * 1024;
const BACKUP_TIMEOUT_MS = 120_000;
/** What the link needs from the registry, implemented by the scheduler process (or directly in tests). */
export interface RegistryPort {
  bases(): Promise<BaseEntry[]>;
  records(): Promise<SignedRecord[]>;
  add(records: SignedRecord[]): Promise<number>;
  seen(updates: Record<string, string>): Promise<void>;
  lastSeen(): Promise<Record<string, string>>;
  /** The owner's main base, if named (F-036 phase 2). Optional: a registry without one has no main base. */
  main?(): Promise<string | undefined>;
  /** F-054-T04: a peer answering again or found unreachable, for the chronicle. Optional: tests may leave it out. */
  reachability?(baseId: string, ok: boolean, at: string): Promise<void>;
}
/** host or host:port; the default port is KAJI_PORT. IPv4 and hostnames only for now. */
export function endpoint(address: string): { host: string; port: number } {
  const m = /^(.*?)(?::(\d{2,5}))?$/.exec(address)!;
  return { host: m[1]!, port: m[2] ? Number(m[2]) : KAJI_PORT };
}
/** A base's own report of its health (F-036 phase 2): online, or degraded with up to three short reasons. */
export interface BaseHealth {
  state: 'online' | 'degraded';
  reasons: string[];
}
/** A peer's report as this base heard it, stamped with this base's clock when it arrived. */
export interface HeardHealth extends BaseHealth {
  at: string;
}
/** Keeps only a well-formed report; reasons are short display text (never instructions), at most three of 200 characters. */
export function sanitizeHealth(value: unknown): BaseHealth | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const h = value as Record<string, unknown>;
  if (h.state !== 'online' && h.state !== 'degraded') return undefined;
  const reasons = Array.isArray(h.reasons)
    ? h.reasons
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .slice(0, 3)
        .map((r) => r.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200))
    : [];
  return { state: h.state, reasons: h.state === 'online' ? [] : reasons };
}
/** Missed heartbeats in a row before a peer is logged unreachable: as many as fit in the online window (3 at 30 s / 90 s). */
export const missesToLog = (everyMs: number) => Math.max(1, Math.ceil(ONLINE_MS / everyMs));
/** The actions a base offers the main base (F-036 slice 3b): action names only, at most 20. */
export function sanitizeOffers(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((v) => typeof v !== 'string' || !/^[a-z]+\.[a-z]+$/.test(v))
  )
    return undefined;
  return [...new Set(value as string[])].filter((t) => t !== 'kaji.run');
}
/** What the main base asks another base's Casper about (F-036 phase 2): the action and its request, never a grant. */
export interface VerdictAsk {
  request: string;
  tool: string;
  args: Record<string, unknown>;
  effect: string;
}
export interface PeerVerdict {
  vote: 'approve' | 'reject' | 'abstain';
  reason: string;
  confidence?: number;
  durationMs?: number;
  transferMs?: number;
}
/** A peer's vote, kept only when well-formed; its reason is short display text. */
export function sanitizeVerdict(value: unknown): PeerVerdict | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (!['approve', 'reject', 'abstain'].includes(v.vote as string) || typeof v.reason !== 'string') return undefined;
  return {
    vote: v.vote as PeerVerdict['vote'],
    reason: v.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300),
    ...(typeof v.confidence === 'number' && v.confidence >= 0 && v.confidence <= 1 ? { confidence: v.confidence } : {}),
    ...(typeof v.durationMs === 'number' && Number.isFinite(v.durationMs) && v.durationMs >= 0
      ? { durationMs: Math.round(v.durationMs) }
      : {}),
  };
}
/** One action the main base asks another base to run, by an id that base remembers (a resend returns the first result). */
export interface RunItem {
  deadline?: number;
  sequence?: number;
  id: string;
  request: string;
  tool: string;
  args: Record<string, unknown>;
  pilot?: string;
}
/** The main base's answer to a dispatched request: the reply Misato gave there (its sortie and cards live there). */
export interface DispatchedReply {
  sortieId: string;
  question?: { text: string; expires: string };
  reply?: string;
  error?: string;
  /** Set by this base, never read from the reply: the main base turned the request away before running anything (B-021). */
  refused?: true;
  steps: unknown[];
  waiting: { approvalId: string; tool: string; reason: string }[];
  base?: { id: string; name: string };
}
/** What a base relays to the main base's Aoba (F-036 phase 2): text to show, and the approval cards it carries. */
export interface Relay {
  text: string;
  cards: { id: string; label: string }[];
}
const UUID = /^[a-f0-9-]{36}$/;
/** Keeps a relay that is plain text and well-formed card references; the main base builds the buttons itself. */
export function sanitizeRelay(value: unknown): Relay | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== 'string' || !v.text.trim() || v.text.length > 3500) return undefined;
  const cards = Array.isArray(v.cards) ? v.cards : [];
  if (cards.length > 20) return undefined;
  const ok = cards.every(
    (c) =>
      c &&
      typeof c === 'object' &&
      UUID.test((c as { id?: unknown }).id as string) &&
      typeof (c as { label?: unknown }).label === 'string' &&
      (c as { label: string }).label.length <= 20,
  );
  return ok
    ? {
        text: v.text,
        cards: cards.map((c) => ({ id: (c as { id: string }).id, label: (c as { label: string }).label })),
      }
    : undefined;
}
const head = (records: SignedRecord[]) => ({
  count: records.length,
  serial: records.reduce((m, r) => Math.max(m, r.body.serial), 0),
});
export class KajiLink {
  readonly baseId: string;
  readonly key: KeyObject;
  readonly publicKey: string;
  readonly port: RegistryPort;
  readonly log: (line: string) => void;
  private readonly workers?: WorkerLink;
  private server?: Server;
  private timer?: NodeJS.Timeout;
  private nonces = new Nonces();
  private listening?: string;
  private stopped = false;
  /** B-043: one tick at a time, across a stop and start too. A tick still waiting on the registry (the nervous process)
  or a slow peer is not joined by another every interval; their requests would pile up against the process queue bound. */
  private ticking = false;
  /** B-051: coalesce concurrent bases() lookups while a call is in flight, so concurrent inbound requests (or an unverified
  probe) do not flood the nervous child process queue. Once settled, the in-flight reference is cleared so subsequent
  requests make a fresh lookup, preserving revocation freshness per lookup. */
  private inFlightBases?: Promise<BaseEntry[]>;
  private async bases(): Promise<BaseEntry[]> {
    if (this.inFlightBases) return this.inFlightBases;
    const promise = this.port.bases().finally(() => {
      if (this.inFlightBases === promise) this.inFlightBases = undefined;
    });
    this.inFlightBases = promise;
    return promise;
  }
  /** Per peer, whether heartbeats reach it, logged only when that changes. A peer counts as unreachable in the log only
  after enough missed heartbeats in a row to fill the online window (one slow Tailscale path or a machine waking from
  sleep is not news: the dashboard keeps it online for ONLINE_MS anyway). */
  private reachable = new Map<string, boolean>();
  private misses = new Map<string, number>();
  private mark(peer: string, ok: boolean, detail = '', every = this.every) {
    if (ok) {
      this.misses.set(peer, 0);
      if (this.reachable.get(peer) !== true) {
        this.log(`Kaji: ${peer} reachable.`);
        // After a restart the first answer also closes an outage recorded before it; nothing open, nothing recorded.
        this.port.reachability?.(peer, true, new Date().toISOString()).catch(() => {});
      }
      this.reachable.set(peer, true);
      return;
    }
    const n = (this.misses.get(peer) ?? 0) + 1;
    this.misses.set(peer, n);
    if (n >= missesToLog(every) && this.reachable.get(peer) !== false) {
      this.log(`Kaji: ${peer} unreachable${detail ? ` (${detail})` : ''}; ${n} heartbeats missed.`);
      this.port.reachability?.(peer, false, new Date().toISOString()).catch(() => {});
      this.reachable.set(peer, false);
    }
  }
  private every = HEARTBEAT_MS;
  private readonly trust?: RootTrust;
  constructor(options: {
    trust?: RootTrust;
    worker?: WorkerAdapter;
    baseId: string;
    key: KeyObject;
    publicKey: string;
    registry: RegistryPort;
    log?: (line: string) => void;
    channel?: () => ChannelState;
    onChannel?: (baseId: string, channel: HeardChannel | null) => void;
    health?: () => Promise<BaseHealth>;
    onHealth?: (baseId: string, health: HeardHealth) => void;
    onRelay?: (from: string, relay: Relay) => Promise<boolean>;
    onChat?: (from: string, message: string, conversation?: string) => Promise<DispatchedReply>;
    offers?: () => string[];
    onOffers?: (baseId: string, offers: string[]) => void;
    pilots?: () => PilotOffer[];
    onPilots?: (baseId: string, pilots: PilotOffer[]) => void;
    operator?: () => SignedOperatorEntry | undefined;
    onOperator?: (baseId: string, entry: SignedOperatorEntry, bases: BaseEntry[]) => void;
    onVerdict?: (from: string, ask: VerdictAsk) => Promise<PeerVerdict | null>;
    onPendingApprovals?: (ids: string[]) => Promise<string[]>;
    onDecide?: (approvalId: string, decision: 'approve' | 'reject') => Promise<string>;
    onSortie?: (from: string, sortieId: string) => Promise<{ sortie: unknown; events: unknown[] } | null>;
    /** F-062-T06: stores an encrypted backup copy from an enrolled base, if this base accepts copies from it. */
    onBackup?: (from: string, date: string, copy: Buffer) => Promise<'stored' | 'refused'>;
  }) {
    this.trust = options.trust;
    this.baseId = options.baseId;
    this.key = options.key;
    this.publicKey = options.publicKey;
    this.port = options.registry;
    this.log = options.log ?? ((l) => console.error(l));
    this.channel = options.channel;
    this.onChannel = options.onChannel;
    this.health = options.health;
    this.onHealth = options.onHealth;
    this.onRelay = options.onRelay;
    this.onBackup = options.onBackup;
    this.onDecide = options.onDecide;
    this.onPendingApprovals = options.onPendingApprovals;
    this.onSortie = options.onSortie;
    this.onChat = options.onChat;
    this.offers = options.offers;
    this.onOffers = options.onOffers;
    this.pilotOffers = options.pilots;
    this.onPilots = options.onPilots;
    this.ownOperator = options.operator;
    this.onOperator = options.onOperator;
    this.onVerdict = options.onVerdict;
    if (options.worker)
      this.workers = new WorkerLink({
        trust: this.trust,
        id: this.baseId,
        key: this.key,
        registry: this.port,
        adapter: options.worker,
        offers: options.offers,
        onOffers: options.onOffers,
        log: this.log,
        address: (address) => {
          const { host, port } = endpoint(address);
          return `ws://${host}:${port}`;
        },
      });
  }
  private readonly channel: (() => ChannelState) | undefined;
  private readonly onChannel: ((baseId: string, channel: HeardChannel | null) => void) | undefined;
  private ownChannel() {
    try {
      return sanitizeChannel(this.channel?.());
    } catch {
      return undefined;
    }
  }
  private heardChannel(from: string, value: unknown) {
    const c = sanitizeChannel(value);
    this.onChannel?.(from, c ? { ...c, receivedAt: new Date().toISOString() } : null);
  }
  private readonly onVerdict: ((from: string, ask: VerdictAsk) => Promise<PeerVerdict | null>) | undefined;
  private readonly offers: (() => string[]) | undefined;
  private readonly onOffers: ((baseId: string, offers: string[]) => void) | undefined;
  private readonly pilotOffers: (() => PilotOffer[]) | undefined;
  private readonly onPilots: ((baseId: string, pilots: PilotOffer[]) => void) | undefined;
  private readonly ownOperator: (() => SignedOperatorEntry | undefined) | undefined;
  private readonly onOperator: ((baseId: string, entry: SignedOperatorEntry, bases: BaseEntry[]) => void) | undefined;
  private heardOperator(from: string, value: unknown, bases: BaseEntry[]) {
    if (value === undefined) return;
    const verified = verifyOperatorEntry(value, bases);
    if (verified && verified.body.baseId === from) this.onOperator?.(from, verified, bases);
  }
  private readonly onChat:
    ((from: string, message: string, conversation?: string) => Promise<DispatchedReply>) | undefined;
  private readonly onPendingApprovals: ((ids: string[]) => Promise<string[]>) | undefined;
  private readonly onRelay: ((from: string, relay: Relay) => Promise<boolean>) | undefined;
  private readonly onBackup: ((from: string, date: string, copy: Buffer) => Promise<'stored' | 'refused'>) | undefined;
  private readonly onDecide: ((approvalId: string, decision: 'approve' | 'reject') => Promise<string>) | undefined;
  private readonly onSortie:
    ((from: string, sortieId: string) => Promise<{ sortie: unknown; events: unknown[] } | null>) | undefined;
  private readonly health: (() => Promise<BaseHealth>) | undefined;
  private readonly onHealth: ((baseId: string, health: HeardHealth) => void) | undefined;
  /** This base's health for a heartbeat; a check that fails is itself a degraded reason. Omitted when no check is wired. */
  private async own(): Promise<BaseHealth | undefined> {
    if (!this.health) return undefined;
    try {
      return sanitizeHealth(await this.health()) ?? { state: 'degraded', reasons: ['health report invalid'] };
    } catch {
      return { state: 'degraded', reasons: ['health check failed'] };
    }
  }
  /** Offers are first-hand too: what a base says it lets the main base run there. */
  private heardOffers(from: string, value: unknown) {
    if (value === undefined) return;
    const o = sanitizeOffers(value);
    if (o) this.onOffers?.(from, o);
  }
  /** Pilots offered by a base in its heartbeat (F-045-T01): first-hand only, validated against PilotOffer schema. */
  private heardPilots(from: string, value: unknown) {
    if (value === undefined) return;
    const p = sanitizePilotOffers(value);
    if (p) this.onPilots?.(from, p);
  }
  /** Health is first-hand only: taken from the peer's own signed message, never relayed for a third base. */
  private heard(from: string, value: unknown) {
    const h = sanitizeHealth(value);
    if (h) this.onHealth?.(from, { ...h, at: new Date().toISOString() });
  }
  /** This base as the registry knows it (by its own public key), if enrolled and not revoked. */
  private async me(): Promise<BaseEntry | undefined> {
    return (await this.bases()).find((b) => b.publicKey === this.publicKey && b.status === 'enrolled');
  }
  async start(everyMs = HEARTBEAT_MS): Promise<void> {
    this.stopped = false;
    this.workers?.start();
    const tick = async () => {
      if (this.stopped || this.ticking) return;
      this.ticking = true;
      try {
        await this.listen();
        if (!this.stopped) await this.heartbeat();
      } catch (e) {
        this.log(`Kaji: ${e instanceof Error ? e.message : 'heartbeat failed'}.`);
      } finally {
        this.ticking = false;
      }
    };
    this.every = everyMs;
    await tick();
    if (!this.stopped)
      this.timer = setInterval(() => {
        void tick();
      }, everyMs);
  }
  /** Stops the heartbeat and the listener. Open connections are closed first: a server only finishes closing when none is
     left, and a peer's keep-alive connection could otherwise hold the stop (and a service shutdown) forever. A tick already
     under way when stop() runs (looking up this base's address) must not open a listener or set a timer afterwards:
     either would keep the process alive with nothing left to close it (B-001). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.workers?.stop();
    await this.closeServer();
    this.listening = undefined;
  }
  private async closeServer(): Promise<void> {
    this.workers?.dropIncoming();
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
  }
  /** Listens on the enrolled address only; retried on every tick (Tailscale may come up later, the address may change). */
  private async listen(): Promise<void> {
    const me = await this.me();
    if (this.stopped) return;
    if (!me) {
      if (!this.listening) this.log('Kaji: this base is not enrolled yet (kaji list); not listening.');
      return;
    }
    if (this.listening === me.address) return;
    await this.closeServer();
    const { host, port } = endpoint(me.address);
    const server = createServer((req, res) => {
      void this.serve(req, res.writeHead.bind(res), (body) => res.end(body), res.setHeader.bind(res));
    });
    this.workers?.attach(server);
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(port, host, () => {
        server.off('error', fail);
        done();
      });
    });
    if (this.stopped) {
      await new Promise<void>((done) => server.close(() => done()));
      return;
    }
    this.server = server;
    this.listening = me.address;
    this.log(`Kaji: listening on ${host}:${port} as ${this.baseId}.`);
  }
  private async serve(
    req: IncomingMessage,
    writeHead: (s: number, h?: Record<string, string>) => unknown,
    end: (b: string) => void,
    setHeader: (k: string, v: string) => unknown,
  ): Promise<void> {
    const reply = (status: number, value: unknown) => {
      const body = JSON.stringify(value);
      const h = signedHeaders(
        this.baseId,
        this.key,
        'res',
        req.method ?? '',
        req.url ?? '',
        body,
        undefined,
        this.trust?.required ? this.trust.root : undefined,
      );
      for (const [k, v] of Object.entries(h)) setHeader(k, v);
      writeHead(status, { 'content-type': 'application/json' });
      end(body);
    };
    try {
      let body = '';
      const limit = req.method === 'POST' && req.url === '/kaji/backup' ? MAX_BACKUP_BODY : MAX_BODY;
      for await (const chunk of req) {
        body += chunk;
        if (body.length > limit) throw new Error('too large');
      }
      const bases = await this.bases();
      const from = verifySigned(
        req.headers as Record<string, string>,
        'req',
        req.method ?? '',
        req.url ?? '',
        body,
        bases,
        this.nonces,
        undefined,
        this.trust,
      );
      if (req.method === 'POST' && req.url === '/kaji/heartbeat') {
        const hb = JSON.parse(body) as {
          seen?: Record<string, string>;
          health?: unknown;
          offers?: unknown;
          pilots?: unknown;
          channel?: unknown;
          operator?: unknown;
        };
        const now = new Date().toISOString();
        await this.port.seen({ ...sanitizeSeen(hb.seen, bases), [from]: now, [this.baseId]: now });
        this.heard(from, hb.health);
        this.heardOffers(from, hb.offers);
        this.heardPilots(from, hb.pilots);
        this.heardChannel(from, hb.channel);
        this.heardOperator(from, hb.operator, bases);
        const health = await this.own();
        const offers = this.offers?.();
        const pilots = this.pilotOffers?.();
        const channel = this.ownChannel();
        const operator = this.ownOperator?.();
        reply(200, {
          head: head(await this.port.records()),
          seen: await this.port.lastSeen(),
          ...(health ? { health } : {}),
          ...(offers ? { offers } : {}),
          ...(pilots ? { pilots } : {}),
          ...(channel ? { channel } : {}),
          ...(operator ? { operator } : {}),
        });
        return;
      }
      if (req.method === 'GET' && req.url === '/kaji/registry') {
        reply(200, { records: await this.port.records() });
        return;
      }
      // F-036 phase 2. Only the main base shows what the others relay; only a decision from the main base is applied here.
      // F-062-T06: an encrypted backup copy from an enrolled base. Stored only when this base accepts that sender.
      if (req.method === 'POST' && req.url === '/kaji/backup') {
        const b = JSON.parse(body) as { date?: unknown; copy?: unknown };
        if (typeof b.date !== 'string' || typeof b.copy !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.copy)) {
          reply(400, { error: 'invalid backup copy' });
          return;
        }
        const outcome = this.onBackup ? await this.onBackup(from, b.date, Buffer.from(b.copy, 'base64')) : 'refused';
        reply(outcome === 'stored' ? 200 : 403, outcome === 'stored' ? { stored: true } : { error: 'not accepted' });
        return;
      }
      if (req.method === 'POST' && req.url === '/kaji/relay') {
        const relay = sanitizeRelay(JSON.parse(body));
        if (!relay) {
          reply(400, { error: 'invalid relay' });
          return;
        }
        if ((await this.port.main?.()) !== this.baseId || !this.onRelay) {
          reply(409, { error: 'not the main base' });
          return;
        }
        reply(200, { delivered: await this.onRelay(from, relay) });
        return;
      }
      // F-036 dispatch: a request asked on another base, answered by the main base's Misato.
      if (req.method === 'POST' && req.url === '/kaji/chat') {
        const c = JSON.parse(body) as { message?: unknown; conversation?: unknown };
        if (
          typeof c.message !== 'string' ||
          !c.message.trim() ||
          c.message.length > 4000 ||
          (c.conversation !== undefined &&
            (typeof c.conversation !== 'string' || !/^[a-z]{1,20}$/.test(c.conversation)))
        ) {
          reply(400, { error: 'invalid request' });
          return;
        }
        if ((await this.port.main?.()) !== this.baseId || !this.onChat) {
          reply(409, { error: 'not the main base' });
          return;
        }
        reply(200, await this.onChat(from, c.message, c.conversation as string | undefined));
        return;
      }
      // F-036 phase 2: the main base asks this base's Casper for a vote on one of its actions (veto-only there).
      if (req.method === 'POST' && req.url === '/kaji/verdict') {
        const a = JSON.parse(body) as { request?: unknown; tool?: unknown; args?: unknown; effect?: unknown };
        if (
          typeof a.request !== 'string' ||
          a.request.length > 4000 ||
          typeof a.tool !== 'string' ||
          !/^[a-z]+\.[a-z]+$/.test(a.tool) ||
          !a.args ||
          typeof a.args !== 'object' ||
          Array.isArray(a.args) ||
          typeof a.effect !== 'string'
        ) {
          reply(400, { error: 'invalid ask' });
          return;
        }
        if ((await this.port.main?.()) !== from || !this.onVerdict) {
          reply(403, { error: 'only the main base asks for votes here' });
          return;
        }
        reply(200, {
          verdict: await this.onVerdict(from, {
            request: a.request,
            tool: a.tool,
            args: a.args as Record<string, unknown>,
            effect: a.effect,
          }),
        });
        return;
      }
      // F-036 slice 3b: one action the main base asks this base to run (only the main base may ask; this base's gate decides).
      if (req.method === 'POST' && req.url === '/kaji/run') {
        reply((await this.port.main?.()) === from ? 409 : 403, {
          error: 'Execution requires the negotiated worker protocol; nothing ran.',
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/kaji/approvals/pending') {
        const value = JSON.parse(body) as { ids?: unknown };
        if (
          !Array.isArray(value.ids) ||
          value.ids.length > 200 ||
          new Set(value.ids).size !== value.ids.length ||
          !value.ids.every((id) => typeof id === 'string' && UUID.test(id))
        ) {
          reply(400, { error: 'invalid approval IDs' });
          return;
        }
        if ((await this.port.main?.()) !== from || !this.onPendingApprovals) {
          reply(403, { error: 'only the main base checks cards here' });
          return;
        }
        reply(200, { ids: await this.onPendingApprovals(value.ids) });
        return;
      }
      if (req.method === 'POST' && req.url === '/kaji/decide') {
        const d = JSON.parse(body) as { approvalId?: unknown; decision?: unknown };
        if (
          typeof d.approvalId !== 'string' ||
          !UUID.test(d.approvalId) ||
          (d.decision !== 'approve' && d.decision !== 'reject')
        ) {
          reply(400, { error: 'invalid decision' });
          return;
        }
        if ((await this.port.main?.()) !== from || !this.onDecide) {
          reply(403, { error: 'only the main base decides here' });
          return;
        }
        reply(200, { outcome: await this.onDecide(d.approvalId, d.decision) });
        return;
      }
      if (req.method === 'POST' && req.url === '/kaji/sortie') {
        const s = JSON.parse(body) as { sortieId?: unknown };
        if (typeof s.sortieId !== 'string' || !UUID.test(s.sortieId)) {
          reply(400, { error: 'invalid sortie ID' });
          return;
        }
        if (!this.onSortie) {
          reply(503, { error: 'sortie inspection unavailable' });
          return;
        }
        const found = await this.onSortie(from, s.sortieId);
        if (!found) {
          reply(404, { error: 'No sortie with that ID.' });
          return;
        }
        reply(200, found);
        return;
      }
      reply(404, { error: 'unknown' });
    } catch (e) {
      this.log(`Kaji: refused a request (${e instanceof Error ? e.message : 'invalid'}).`);
      reply(403, { error: 'refused' });
    }
  }
  /** Signed request to one peer; the reply must be signed by that same peer. */
  private async call(
    peer: BaseEntry,
    method: 'GET' | 'POST',
    path: string,
    value?: unknown,
    timeoutMs = 8000,
  ): Promise<unknown> {
    const body = value === undefined ? '' : JSON.stringify(value);
    const { host, port } = endpoint(peer.address);
    const res = await send(
      host,
      port,
      method,
      path,
      {
        'content-type': 'application/json',
        ...signedHeaders(
          this.baseId,
          this.key,
          'req',
          method,
          path,
          body,
          undefined,
          this.trust?.required ? this.trust.root : undefined,
        ),
      },
      method === 'POST' ? body : undefined,
      timeoutMs,
    );
    const text = res.text;
    const headers = res.headers;
    const from = verifySigned(
      headers,
      'res',
      method,
      path,
      text,
      await this.bases(),
      this.nonces,
      undefined,
      this.trust,
    );
    if (from !== peer.baseId) throw new Error(`${peer.baseId} answered as ${from}`);
    if (!res.ok) throw new Error(`${peer.baseId} refused (${res.status})`);
    return JSON.parse(text);
  }
  /**
   * F-062-T06: sends an encrypted backup copy to an enrolled peer. Rejects with code EREFUSED (and the HTTP status) when
   * the peer answered no, or EUNREACHABLE when it could not be reached or did not answer.
   */
  async sendBackup(peerId: string, date: string, copy: Buffer): Promise<void> {
    const peer = (await this.bases()).find((b) => b.baseId === peerId && b.status === 'enrolled');
    if (!peer) throw Object.assign(new Error(`${peerId} is not an enrolled base`), { code: 'EREFUSED', status: 404 });
    try {
      const r = (await this.call(
        peer,
        'POST',
        '/kaji/backup',
        { date, copy: copy.toString('base64') },
        BACKUP_TIMEOUT_MS,
      )) as { stored?: unknown };
      if (r.stored !== true) throw Object.assign(new Error('not stored'), { code: 'EREFUSED', status: 200 });
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'EREFUSED') throw e;
      const status = e instanceof Error ? /refused \((\d+)\)$/.exec(e.message)?.[1] : undefined;
      throw Object.assign(new Error('backup copy not delivered'), {
        code: status ? 'EREFUSED' : 'EUNREACHABLE',
        ...(status ? { status: Number(status) } : {}),
      });
    }
  }
  /** Sends a relay to the main base (F-036 phase 2); false when there is none, it is this base, or it cannot be reached. */
  async relay(relay: Relay): Promise<boolean> {
    const main = await this.port.main?.();
    if (!main || main === this.baseId) return false;
    const peer = (await this.bases()).find((b) => b.baseId === main && b.status === 'enrolled');
    if (!peer) return false;
    try {
      return ((await this.call(peer, 'POST', '/kaji/relay', relay)) as { delivered?: boolean }).delivered === true;
    } catch (e) {
      this.log(`Kaji: relay to ${main} failed (${e instanceof Error ? e.message : 'error'}).`);
      return false;
    }
  }
  /** Sends a request to the main base's Misato (F-036 dispatch). undefined only when it was never sent (no main base, it is
     this base, or it cannot be reached), so the caller may answer locally; once sent, a slow or failed answer is reported,
     never run a second time here. */
  async chat(
    message: string,
    conversation: string | undefined,
    timeoutMs: number,
  ): Promise<DispatchedReply | undefined> {
    const main = await this.port.main?.();
    if (!main || main === this.baseId) return undefined;
    const peer = (await this.bases()).find((b) => b.baseId === main && b.status === 'enrolled');
    if (!peer) return undefined;
    try {
      const answer = (await this.call(
        peer,
        'POST',
        '/kaji/chat',
        { message, ...(conversation ? { conversation } : {}) },
        timeoutMs,
      )) as DispatchedReply;
      delete answer.refused;
      return answer;
    } catch (e) {
      const text = e instanceof Error ? e.message : 'error';
      // Never sent: the connection itself failed. Anything later (a reset, a timeout) may have reached Misato already.
      const code = (e as { cause?: { code?: string } }).cause?.code;
      if (
        code &&
        ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
      )
        return undefined;
      // B-021: a 400/401/403/409 is checked before /kaji/chat runs anything there: a definite refusal, not an unknown outcome.
      if (/refused \((400|401|403|409)\)/.test(text))
        return {
          sortieId: '',
          error: `${main} refused the request (${text}); nothing ran there.`,
          refused: true,
          steps: [],
          waiting: [],
        };
      return {
        sortieId: '',
        error: `${main} did not answer (${text}); it may still be working on it, so the request was not repeated here.`,
        steps: [],
        waiting: [],
      };
    }
  }
  /** Sends one action to a base (F-036 slice 3b). reached:false means it never got there (send again later, same id);
     refused carries that base's reason (it does not offer it, or it is not this base's to ask). */
  async run(
    baseId: string,
    item: RunItem,
    timeoutMs: number,
    dispatching: () => Promise<void> = async () => {},
  ): Promise<{ reached: boolean; result?: unknown; refused?: string }> {
    const peer = (await this.bases()).find((b) => b.baseId === baseId && b.status === 'enrolled');
    if (!peer) return { reached: true, refused: `${baseId} is not an enrolled base` };
    if (!this.workers?.connected(baseId) || !item.sequence)
      return { reached: false, refused: 'Waiting for a negotiated durable worker channel.' };
    try {
      await dispatching();
      const result = await this.workers.run(baseId, item, timeoutMs);
      return result && typeof result === 'object' && (result as { retry?: unknown }).retry === true
        ? { reached: false }
        : { reached: true, result };
    } catch (e) {
      const text = e instanceof Error ? e.message : 'error';
      const code = (e as { cause?: { code?: string } }).cause?.code;
      if (/refused \((400|403|409)\)/.test(text)) return { reached: true, refused: text };
      return { reached: false, ...(code ? { refused: code } : {}) };
    }
  }
  async cancel(baseId: string, id: string, reason: string): Promise<{ status: string; result?: unknown }> {
    if (!this.workers) throw new Error('No worker channel configured.');
    return this.workers.cancel(baseId, id, reason);
  }
  /** Asks one base's Casper for a vote; anything but a well-formed vote in time is an abstain, so a slow base never blocks. */
  async verdict(baseId: string, ask: VerdictAsk, timeoutMs: number): Promise<PeerVerdict> {
    const peer = (await this.bases()).find((b) => b.baseId === baseId && b.status === 'enrolled');
    if (!peer) return { vote: 'abstain', reason: 'not an enrolled base' };
    try {
      const v = sanitizeVerdict(
        ((await this.call(peer, 'POST', '/kaji/verdict', ask, timeoutMs)) as { verdict?: unknown }).verdict,
      );
      return v ?? { vote: 'abstain', reason: 'no verdict (no local model there, or an unreadable answer)' };
    } catch (e) {
      return {
        vote: 'abstain',
        reason:
          e instanceof Error && /timeout|aborted/i.test(e.message) ? 'did not answer in time' : 'could not be reached',
      };
    }
  }
  /** Authoritative status for relayed cards; an unavailable/older peer leaves cleanup pending. */
  async pendingApprovalIds(baseId: string, ids: string[]): Promise<string[]> {
    if (ids.length > 200 || new Set(ids).size !== ids.length || ids.some((id) => !UUID.test(id)))
      throw new Error('Invalid approval IDs.');
    const peer = (await this.bases()).find((b) => b.baseId === baseId && b.status === 'enrolled');
    if (!peer) throw new Error('Not an enrolled base.');
    const value = (await this.call(peer, 'POST', '/kaji/approvals/pending', { ids }, 2000)) as { ids?: unknown };
    if (
      !Array.isArray(value.ids) ||
      value.ids.length > ids.length ||
      !value.ids.every((id) => typeof id === 'string' && ids.includes(id))
    )
      throw new Error('Invalid approval status reply.');
    return value.ids;
  }
  /** Passes the owner's tap on a relayed card back to the base that owns the card; its outcome text comes back. */
  async decide(baseId: string, approvalId: string, decision: 'approve' | 'reject'): Promise<string> {
    const peer = (await this.bases()).find((b) => b.baseId === baseId && b.status === 'enrolled');
    if (!peer) throw new Error(`${baseId} is not an enrolled base.`);
    return (
      ((await this.call(peer, 'POST', '/kaji/decide', { approvalId, decision })) as { outcome?: string }).outcome ??
      'No outcome.'
    );
  }
  /** Inspects a sortie on an enrolled peer base over the signed Kaji link (F-051). */
  async inspectSortie(
    baseId: string,
    sortieId: string,
  ): Promise<{ base: { id: string; name: string }; sortie: unknown; events: unknown[] } | null> {
    if (!UUID.test(sortieId)) throw new Error('Invalid sortie ID.');
    const peer = (await this.bases()).find(
      (b) => b.baseId.toLowerCase() === baseId.toLowerCase() && b.status === 'enrolled',
    );
    if (!peer) throw new Error(`Base ${baseId} is not enrolled.`);
    if (peer.baseId === this.baseId) throw new Error('Use the local sortie endpoint for this base.');
    try {
      const data = (await this.call(peer, 'POST', '/kaji/sortie', { sortieId }, 5000)) as {
        sortie: unknown;
        events: unknown[];
      };
      return { base: { id: peer.baseId, name: peer.name }, sortie: data.sortie, events: data.events };
    } catch (e) {
      if (e instanceof Error && /refused \(404\)/.test(e.message)) return null;
      throw e;
    }
  }
  /** One round: greet every other enrolled base, merge what they have seen, catch up on the registry if behind. */
  async heartbeat(): Promise<void> {
    const me = await this.me();
    if (!me) return;
    const bases = await this.bases();
    await this.port.seen({ [this.baseId]: new Date().toISOString() });
    const health = await this.own();
    for (const peer of bases.filter((b) => b.status === 'enrolled' && b.publicKey !== this.publicKey)) {
      try {
        const offers = this.offers?.();
        const pilots = this.pilotOffers?.();
        const channel = this.ownChannel();
        const operator = this.ownOperator?.();
        const r = (await this.call(peer, 'POST', '/kaji/heartbeat', {
          seen: await this.port.lastSeen(),
          ...(health ? { health } : {}),
          ...(offers ? { offers } : {}),
          ...(pilots ? { pilots } : {}),
          ...(channel ? { channel } : {}),
          ...(operator ? { operator } : {}),
        })) as {
          head: { count: number; serial: number };
          seen?: Record<string, string>;
          health?: unknown;
          offers?: unknown;
          pilots?: unknown;
          channel?: unknown;
          operator?: unknown;
        };
        await this.port.seen({ ...sanitizeSeen(r.seen, bases), [peer.baseId]: new Date().toISOString() });
        this.mark(peer.baseId, true);
        this.heard(peer.baseId, r.health);
        this.heardOffers(peer.baseId, r.offers);
        this.heardPilots(peer.baseId, r.pilots);
        this.heardChannel(peer.baseId, r.channel);
        this.heardOperator(peer.baseId, r.operator, bases);
        const mine = head(await this.port.records());
        if (r.head.count > mine.count || r.head.serial > mine.serial) {
          const got = (await this.call(peer, 'GET', '/kaji/registry')) as { records: SignedRecord[] };
          const added = await this.port.add(got.records);
          if (added) this.log(`Kaji: ${added} new registry record(s) from ${peer.baseId}.`);
        }
      } catch (e) {
        this.mark(peer.baseId, false, e instanceof Error ? e.message : 'error');
      }
    }
  }
}
/**
 * One request to a peer with no connection pool (agent:false): the connection closes when the answer is in, so no idle
 * keep-alive socket is left to hold a process open (on Windows a test file never exited; a service stop could wait).
 * Errors keep fetch's shape: a connection that never opened is a TypeError whose cause has the code (ECONNREFUSED…),
 * a timeout is a TimeoutError, so callers can tell "never sent" from "may have arrived".
 */
function send(
  host: string,
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; headers: Record<string, string>; text: string }> {
  return new Promise((done, fail) => {
    const req = httpRequest(
      {
        host,
        port,
        method,
        path,
        agent: false,
        headers: { ...headers, ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) {
            req.destroy(new Error('answer too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          clearTimeout(timer);
          const h: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') h[k] = v;
          done({
            status: res.statusCode ?? 0,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            headers: h,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', (e) => {
          clearTimeout(timer);
          fail(e);
        });
      },
    );
    const timer = setTimeout(() => {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      req.destroy(e);
    }, timeoutMs);
    req.on('error', (e) => {
      clearTimeout(timer);
      fail(e.name === 'TimeoutError' ? e : Object.assign(new TypeError('fetch failed'), { cause: e }));
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}
/** Only enrolled base ids and valid, not-in-the-future times are merged from a peer's view. */
function sanitizeSeen(seen: unknown, bases: BaseEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!seen || typeof seen !== 'object') return out;
  const ids = new Set(bases.map((b) => b.baseId));
  for (const [id, at] of Object.entries(seen as Record<string, unknown>))
    if (
      ids.has(id) &&
      typeof at === 'string' &&
      Number.isFinite(Date.parse(at)) &&
      Date.parse(at) <= Date.now() + KAJI_CLOCK_SKEW_MS
    )
      out[id] = new Date(Date.parse(at)).toISOString();
  return out;
}
