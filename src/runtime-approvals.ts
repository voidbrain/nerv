import { gateCallTimeoutMs, type AgencySnapshot } from './executors.ts';
import { ItemLockManager, itemKeysForTool } from './item-locks.ts';
import type { Verdict } from './policy.ts';
import type { ProcessClient } from './process-client.ts';
import type { Effect, Pattern } from './policy.ts';
import { MODEL_TIMEOUT_MS, type RouteName } from './model.ts';
import { OWNER_EXPIRED_REASON, ownerRejectedReason, requestLanguage, type Step, type Turn } from './misato.ts';
import type { RouteHealth } from './route-health.ts';
import type { Method } from './rpc.ts';
import {
  matchesExtraSeat,
  runExtraSeat,
  type ActReply,
  type ChatReply,
  type ExtraSeatSpec,
  type OwnerAction,
  type PeerSeat,
} from './runtime-api.ts';
import type { BaseHealth, PeerVerdict, VerdictAsk } from './kaji-link.ts';
import type { SeatPool } from './seat-pool.ts';
import { finishPrintPart, isPendingRemotePrint, type PendingRemotePrint, type PrintPartReply } from './print-job.ts';
import type { ActResult } from './store.ts';
import type { WatchWork } from './watch.ts';
import type { WorkerLease } from './worker-jobs.ts';

export type RemoteConsultant = {
  name: string;
  advise: (input: {
    request: string;
    context?: Turn[];
    bases?: { id: string; name: string }[];
    tools?: { name: string; about: string }[];
  }) => Promise<{ advice: string | null; model?: string }>;
};

export interface RuntimeApprovalsHost {
  readonly nervous: ProcessClient;
  readonly itemLocks: ItemLockManager;
  readonly resumeListeners: ((reply: ChatReply) => void)[];
  readonly startedAt: Date;
  modelCall(method: Method, params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  bases(): Promise<
    Array<{
      baseId: string;
      name: string;
      status: string;
      self: boolean;
      main: boolean;
      online: boolean;
      lastSeen: string | null;
      health?: { state: string; reasons: string[] } | null;
      channel?: { mode: string } | null;
    }>
  >;
  baseNames(): Promise<{ id: string; name: string }[]>;
  baseHealth(): Promise<BaseHealth>;
  routes(): Promise<{ routes?: Record<RouteName, RouteHealth>; degraded: string[] }>;
  enqueueWatchWork(fn: () => Promise<ChatReply | null>): Promise<ChatReply | null>;
  record(sortieId: string, steps: Step[], step: Step, actionId?: string): Promise<void>;
  clarificationHistory(sortieId: string): Promise<{
    answer?: string;
    context: Turn[];
    advice?: string;
    conversation?: string;
  }>;
  loop(
    sortieId: string,
    request: string,
    steps: Step[],
    context: Turn[],
    opts?: { consult: boolean; advice?: string; conversation?: string; watch?: WatchWork },
  ): Promise<ChatReply>;
}

/**
 * Approval gating, extra/peer/pool seats, remote consultant, and sortie resume loop
 * extracted from Runtime (F-095-T03).
 */
export class RuntimeApprovals {
  private readonly host: RuntimeApprovalsHost;
  private extraSeatSpecs: ExtraSeatSpec[] = [];
  private remoteConsultant?: RemoteConsultant;
  private seatPool?: { pool: SeatPool; timeoutMs: number };
  private peerSeats?: (ask: VerdictAsk) => Promise<PeerSeat[]>;
  private resuming = new Set<string>();
  private resumer?: NodeJS.Timeout;
  private poll?: Promise<string[]>;
  private nextPoll?: Promise<string[]>;
  private remotePrint?: (pending: PendingRemotePrint) => Promise<PrintPartReply>;

  constructor(host: RuntimeApprovalsHost) {
    this.host = host;
  }

  stopTimers(): void {
    if (this.resumer) clearInterval(this.resumer);
  }

  sweepIfResuming(): void {
    if (this.resumer) void this.sweep();
  }

  getRemoteConsultant(): RemoteConsultant | undefined {
    return this.remoteConsultant;
  }

  useExtraSeat(spec: ExtraSeatSpec): () => void {
    this.extraSeatSpecs = this.extraSeatSpecs.filter((s) => s.seat !== spec.seat);
    this.extraSeatSpecs.push(spec);
    return () => {
      this.extraSeatSpecs = this.extraSeatSpecs.filter((s) => s !== spec);
    };
  }

  /** F-121-T04: sends a part to the slicing base over the Kaji line (serve wires it once the line is up). */
  useRemotePrint(send: ((pending: PendingRemotePrint) => Promise<PrintPartReply>) | undefined): void {
    this.remotePrint = send;
  }

  /** F-121-T04: a fleet.print left for the coordinator is sent to its slicing base, then finished in the ledger. */
  private async completeRemotePrint(sortieId: string, tool: string, result: ActResult): Promise<ActResult> {
    if (tool !== 'fleet.print' || !isPendingRemotePrint(result.result)) return result;
    const pending = result.result.remote;
    const t0 = performance.now();
    const final = await (
      this.remotePrint
        ? this.remotePrint(pending)
        : Promise.resolve(
            finishPrintPart(
              pending.prepared,
              new Error(`${pending.base} slices parts, and the Kaji line is not running here.`),
            ),
          )
    ).catch((e: unknown) =>
      finishPrintPart(
        pending.prepared,
        new Error(e instanceof Error ? e.message.slice(0, 300) : 'the slicing base did not answer'),
      ),
    );
    await this.host.nervous
      .call('actions.finished', {
        sortieId,
        actionId: result.actionId,
        tool,
        durationMs: Math.max(0, Math.round(performance.now() - t0)),
        text: JSON.stringify(final).slice(0, 8000),
      })
      .catch(() => undefined);
    return { ...result, result: final };
  }

  useRemoteConsultant(consultant: RemoteConsultant | undefined): void {
    this.remoteConsultant = consultant;
  }

  useSeatPool(pool: SeatPool, timeoutMs = MODEL_TIMEOUT_MS): void {
    this.seatPool = { pool, timeoutMs };
  }

  usePeerSeats(
    link: { verdict(baseId: string, ask: VerdictAsk, timeoutMs: number): Promise<PeerVerdict> },
    modes: () => Record<string, string>,
    timeoutMs = MODEL_TIMEOUT_MS,
  ): void {
    this.peerSeats = async (ask) => {
      const bases = await this.host.bases();
      const main = bases.find((b) => b.main);
      if (!main?.self) return [];
      const seats = modes();
      const peers = bases.filter((b) => !b.self && b.online && b.status === 'enrolled' && seats[b.baseId] !== 'off');
      return peers.map((b) => {
        const t0 = performance.now();
        return {
          seat: b.baseId,
          shadow: seats[b.baseId] !== 'veto',
          verdict: link.verdict(b.baseId, ask, timeoutMs).then(
            (v): PeerVerdict => {
              const transferMs = Math.max(0, Math.round(performance.now() - t0));
              return { ...v, transferMs, durationMs: v.durationMs ?? transferMs };
            },
            (): PeerVerdict => ({
              vote: 'abstain',
              reason: 'could not be reached',
              transferMs: Math.max(0, Math.round(performance.now() - t0)),
            }),
          ),
        };
      });
    };
  }

  async peerVerdict(ask: VerdictAsk): Promise<PeerVerdict | null> {
    const t0 = performance.now();
    const reply = (await this.host
      .modelCall(
        'casper.verdict',
        { request: ask.request, tool: ask.tool, args: ask.args, effect: ask.effect },
        MODEL_TIMEOUT_MS,
      )
      .catch(() => ({ verdict: null }))) as { verdict: Verdict | null };
    const durationMs = Math.max(0, Math.round(performance.now() - t0));
    return reply.verdict
      ? {
          vote: reply.verdict.vote,
          reason: reply.verdict.reason,
          ...(typeof reply.verdict.confidence === 'number' ? { confidence: reply.verdict.confidence } : {}),
          durationMs,
        }
      : null;
  }

  async gate(sortieId: string, action: OwnerAction, askCasper = true, worker?: WorkerLease): Promise<ActReply> {
    const { pattern, effect, intent, cloudAllowed } = (await this.host.nervous.call('actions.preview', {
      sortieId,
      tool: action.tool,
    })) as { pattern: Pattern; effect: Effect; intent?: boolean; cloudAllowed?: boolean };
    let casper: Verdict | undefined, casperError: string | undefined;
    let extras: Verdict[] = [];
    let late: PeerSeat[] = [];
    const askIntent = (intent ?? pattern !== 'green') && askCasper;
    const matchingExtras = askCasper
      ? this.extraSeatSpecs.filter((s) => matchesExtraSeat(s, { tool: action.tool, effect, pattern, intent }))
      : [];
    const poolExtras: ExtraSeatSpec[] =
      askCasper && this.seatPool
        ? this.seatPool.pool
            .pick({ tool: action.tool, effect, cloudAllowed: cloudAllowed === true })
            .picked.map((entry) => ({
              seat: entry.id,
              shadow: entry.shadow ?? true,
              timeoutMs: this.seatPool!.timeoutMs,
              ask: (ask, signal) => this.seatPool!.pool.ask(entry, ask, signal),
            }))
        : [];
    const allExtras = [...matchingExtras, ...poolExtras];
    // Casper (and the other bases' seats) for anything not Green, and for every removal even when Green (B-009).
    // Extra seats (F-025-T01) and cloud seat pool (F-025-T02) run on matching actions.
    if (askIntent || allExtras.length > 0) {
      // B-012: for an action on another base, Casper is told the bases by id and name.
      const bases = askIntent && action.tool === 'kaji.run' ? await this.host.baseNames() : [];
      // The other bases' Casper (F-036 phase 2) is asked at the same time: veto-only seats, shadow until the owner trusts them.
      // F-052: the gate waits for Casper and the veto seats only; a shadow vote not in by then is recorded when it comes.
      const casperT0 = performance.now();
      const asking = askIntent
        ? (this.host
            .modelCall(
              'casper.verdict',
              {
                request: action.request,
                tool: action.tool,
                args: action.args,
                effect,
                ...(bases.length ? { bases } : {}),
                ...(action.earlier?.length
                  ? {
                      earlier: action.earlier.slice(-3).map((t) => ({
                        request: t.request.slice(0, 600),
                        ...(t.reply ? { reply: t.reply.slice(0, 600) } : {}),
                      })),
                    }
                  : {}),
              },
              MODEL_TIMEOUT_MS,
            )
            .catch(() => ({ verdict: null, error: 'Brain unavailable.' })) as Promise<{
            verdict: Verdict | null;
            error?: string;
          }>)
        : Promise.resolve({ verdict: null } as { verdict: Verdict | null; error?: string });
      const verdictAsk: VerdictAsk = { request: action.request, tool: action.tool, args: action.args, effect };
      const seatT0 = performance.now();
      const peerList =
        askIntent && this.peerSeats ? await this.peerSeats(verdictAsk).catch(() => [] as PeerSeat[]) : [];
      const extraList = allExtras.map((s) => runExtraSeat(s, verdictAsk));
      const seats = [...peerList, ...extraList];
      const settled = new Map<string, PeerVerdict>();
      for (const s of seats)
        void s.verdict.then((v) => {
          settled.set(s.seat, {
            ...v,
            durationMs: v.durationMs ?? Math.max(0, Math.round(performance.now() - seatT0)),
          });
        });
      const [reply] = await Promise.all([asking, Promise.all(seats.filter((s) => !s.shadow).map((s) => s.verdict))]);
      const casperDurationMs = Math.max(0, Math.round(performance.now() - casperT0));
      if (askIntent) {
        if (reply.verdict) casper = { ...reply.verdict, durationMs: casperDurationMs };
        else casperError = reply.error ?? 'No verdict.';
      }
      extras = seats
        .filter((s) => settled.has(s.seat))
        .map((s) => ({ seat: s.seat, ...settled.get(s.seat)!, shadow: s.shadow }));
      late = seats.filter((s) => s.shadow && !settled.has(s.seat));
    }
    const agency: AgencySnapshot | undefined =
      action.tool === 'agency.status'
        ? await Promise.all([
            this.host.bases().catch(() => []),
            this.host.baseHealth().catch((): BaseHealth => ({ state: 'online', reasons: [] })),
            this.host.routes().catch((): { routes?: Record<RouteName, RouteHealth>; degraded: string[] } => ({
              degraded: [],
            })),
          ]).then(([bases, health, routes]) => ({
            health: { state: health.state, reasons: health.reasons },
            ...(routes.routes ? { routes: routes.routes as Record<string, unknown> } : {}),
            bases: bases.map((b) => ({
              baseId: b.baseId,
              name: b.name,
              status: b.status,
              self: b.self,
              main: b.main,
              online: b.online,
              lastSeen: b.lastSeen,
              health: b.health ? { state: b.health.state, reasons: b.health.reasons } : null,
              channel: b.channel ? { mode: b.channel.mode } : null,
            })),
          }))
        : undefined;
    const itemKeys = itemKeysForTool(action.tool, action.args);
    const acted = (await this.host.itemLocks.withLock(
      itemKeys,
      () =>
        this.host.nervous.call(
          'actions.act',
          {
            ...(worker ? { worker } : {}),
            sortieId,
            tool: action.tool,
            args: action.args,
            stage: action.stage ?? 'production',
            ...(casper ? { casper } : {}),
            ...(extras.length ? { extras } : {}),
            ...(agency ? { agency } : {}),
          },
          gateCallTimeoutMs(action.tool),
        ),
      { owner: sortieId },
    )) as ActResult;
    const result = await this.completeRemotePrint(sortieId, action.tool, acted);
    // A late shadow vote (F-052) is kept with the action when it arrives; it never changes the outcome.
    const lateT0 = performance.now();
    for (const s of late)
      void s.verdict
        .then((v) =>
          this.host.nervous.call('actions.shadowVote', {
            sortieId,
            actionId: result.actionId,
            seat: s.seat,
            vote: v.vote,
            reason: v.reason.slice(0, 500),
            ...(typeof v.confidence === 'number' ? { confidence: v.confidence } : {}),
            durationMs: v.durationMs ?? Math.max(0, Math.round(performance.now() - lateT0)),
            ...(typeof v.transferMs === 'number' ? { transferMs: v.transferMs } : {}),
          }),
        )
        .catch(() => {
          /* best effort */
        });
    return casperError ? { ...result, casperError } : result;
  }

  async sweep(): Promise<void> {
    const ids = await this.resumable();
    for (const id of ids) {
      if (this.resuming.has(id)) continue;
      this.resuming.add(id);
      try {
        const reply = await this.resume(id);
        if (reply && !reply.proactive) for (const l of this.host.resumeListeners) l(reply);
      } catch {
        /* the next sweep will not retry a claimed sortie; its events show where it stopped */
      } finally {
        this.resuming.delete(id);
      }
    }
  }

  /**
   * B-043: at most one resumable-sorties poll is with the nervous process at a time. A sweep asked for while one is out
   * (a resumer tick, a decision) waits for one fresh poll after it, shared by every such ask, so a decision made during
   * the poll is still seen and a slow child never collects one poll per tick against the process queue bound.
   */
  private resumable(): Promise<string[]> {
    if (!this.poll) {
      const poll: Promise<string[]> = this.host.nervous
        .call('misato.resumable')
        .then(
          (ids) => ids as string[],
          () => [],
        )
        .finally(() => {
          if (this.poll === poll) this.poll = undefined;
        });
      this.poll = poll;
      return poll;
    }
    this.nextPoll ??= this.poll.then(() => {
      this.nextPoll = undefined;
      return this.resumable();
    });
    return this.nextPoll;
  }

  /** Decisions can come from anywhere (CLI approve, expiry): a periodic sweep catches those the coordinator did not see. */
  startResumer(everyMs = 2000): void {
    if (!this.resumer)
      this.resumer = setInterval(() => {
        // A tick while a poll is still out adds nothing: the next tick polls afresh (B-043).
        if (!this.poll) void this.sweep();
      }, everyMs);
  }

  /**
   * B-013: sorties a previous run of the service left half done (cut off by a restart, not waiting for the owner) are
   * closed as interrupted, and the owner is told what had run. Not resumed: an action cut off mid-way may or may not have
   * happened, so the owner decides whether to ask again.
   */
  async closeInterrupted(): Promise<number> {
    const open = (await this.host.nervous
      .call('misato.interrupted', { before: this.host.startedAt.toISOString() })
      .catch(() => [])) as { id: string; title: string; ran: string[] }[];
    let n = 0;
    for (const s of open) {
      const it = requestLanguage(s.title) === 'it';
      const title = s.title.slice(0, 120);
      const ran = s.ran.length
        ? it
          ? ` Prima si era fatto: ${s.ran.join(', ')}.`
          : ` It had done: ${s.ran.join(', ')}.`
        : it
          ? ' Non si era fatto ancora nulla.'
          : ' Nothing had run yet.';
      const reply =
        (it
          ? `Interrotto da un riavvio mentre lavoravo a “${title}”.`
          : `Interrupted by a restart while working on “${title}”.`) +
        ran +
        (it
          ? ' Non continuo da solo: chiedimelo di nuovo se serve.'
          : ' I will not carry on by myself: ask again if you still want it.');
      if (await this.host.nervous.call('misato.closeInterrupted', { sortieId: s.id, reply }).catch(() => false)) {
        n++;
        for (const l of this.host.resumeListeners) l({ sortieId: s.id, reply, steps: [], waiting: [] });
      }
    }
    return n;
  }

  private async resume(sortieId: string): Promise<ChatReply | null> {
    const proactive = (await this.host.nervous.call('watch.get', { sortieId })) as WatchWork | null;
    if (!proactive) return this.resumeCore(sortieId);
    return this.host.enqueueWatchWork(() => this.resumeCore(sortieId, proactive));
  }

  private async resumeCore(sortieId: string, proactive?: WatchWork): Promise<ChatReply | null> {
    const claim = (await this.host.nervous.call('misato.claim', { sortieId })) as {
      request: string;
      steps: { step: Step }[];
      decisions: {
        actionId: string;
        tool: string;
        args: Record<string, unknown>;
        decision: string;
        result?: unknown;
        error?: string;
      }[];
    } | null;
    if (!claim) return null;
    const steps = claim.steps.map((s) => s.step);
    for (const d of claim.decisions) {
      const step: Step =
        d.decision === 'approve'
          ? {
              tool: d.tool,
              args: d.args,
              outcome: 'grant',
              reason: d.error ? 'The owner approved it; it ran and failed.' : 'The owner approved it; it ran.',
              ...(d.result !== undefined ? { result: d.result } : {}),
              ...(d.error ? { error: d.error } : {}),
            }
          : {
              tool: d.tool,
              args: d.args,
              outcome: 'reject',
              reason: d.decision === 'expired' ? OWNER_EXPIRED_REASON : ownerRejectedReason(d.decision),
            };
      await this.host.record(sortieId, steps, step, d.actionId);
    }
    const history = await this.host.clarificationHistory(sortieId);
    return this.host.loop(sortieId, history.answer ?? claim.request, steps, history.context, {
      consult: false,
      advice: history.advice,
      conversation: history.conversation ?? 'cli',
      ...(proactive ? { watch: proactive } : {}),
    });
  }
}
