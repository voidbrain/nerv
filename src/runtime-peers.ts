import { builtinTools } from './executors.ts';
import { ONLINE_MS, type RunItem } from './kaji-link.ts';
import type { RemoteOffer } from './misato.ts';
import { canRunRemotePilot, type Pilot, type PilotOffer, type PilotRegistry, type RegisteredPilot } from './pilots.ts';
import type { ProcessClient } from './process-client.ts';
import {
  remoteOutcomeText,
  type ActReply,
  type ChatReply,
  type ExternalTools,
  type OwnerAction,
} from './runtime-api.ts';
import { WORKER_RESULT_BYTES, type WorkerClaim, type WorkerContext, type WorkerLease } from './worker-jobs.ts';

export interface RuntimePeersHost {
  readonly nervous: ProcessClient;
  readonly offersHeard: Map<string, { tools: string[]; at: number }>;
  readonly resumeListeners: ((reply: ChatReply) => void)[];
  getSelfKey(): string | undefined;
  bases(): Promise<
    Array<{ baseId: string; name: string; online: boolean; status?: string; operator?: { name: string } | null }>
  >;
  getPilotRegistry(): PilotRegistry;
  pilotRoster(): Pilot[];
  act(action: OwnerAction, worker?: WorkerLease): Promise<ActReply>;
  /** F-021-T04: the MCP tools granted on this base now (a changed or vanished tool is suspended, not listed). */
  externalTools(): Promise<ExternalTools>;
  toolsProcess(): ProcessClient;
}

/**
 * Peer offers/pilots discovery, Kaji outbox dispatch/cancellation, and incoming peer worker execution
 * extracted from Runtime (F-095-T03).
 */
export class RuntimePeers {
  private readonly host: RuntimePeersHost;
  private outboxTimer?: NodeJS.Timeout;
  private cancelRemote?: () => Promise<void>;

  constructor(host: RuntimePeersHost) {
    this.host = host;
  }

  stopTimers(): void {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
  }

  triggerCancelRemote(): void {
    void this.cancelRemote?.();
  }

  async remoteOffers(): Promise<RemoteOffer[]> {
    if (!this.host.offersHeard.size) return [];
    const bases = await this.host.bases().catch(() => []);
    return bases
      .filter((b) => !(b as { self?: boolean }).self && b.online && b.status === 'enrolled')
      .flatMap((b) => {
        const o = this.host.offersHeard.get(b.baseId);
        return o && o.tools.length && Date.now() - o.at < ONLINE_MS
          ? [{ base: b.baseId, name: b.name, ...(b.operator ? { operator: b.operator.name } : {}), tools: o.tools }]
          : [];
      });
  }

  async registeredPilots(now = Date.now()): Promise<RegisteredPilot[]> {
    const bases = await this.host.bases().catch(() => []);
    const onlineBases = new Set(
      bases.filter((b) => !(b as { self?: boolean }).self && b.online && b.status === 'enrolled').map((b) => b.baseId),
    );
    return this.host.getPilotRegistry().list({ now, maxAgeMs: ONLINE_MS, onlineBases });
  }

  async remotePilots(now = Date.now()): Promise<{ base: string; name: string; pilots: PilotOffer[] }[]> {
    const bases = await this.host.bases().catch(() => []);
    const reg = this.host.getPilotRegistry();
    return bases
      .filter((b) => !(b as { self?: boolean }).self && b.online && b.status === 'enrolled')
      .flatMap((b) => {
        const pilots = reg.forBase(b.baseId, { now, maxAgeMs: ONLINE_MS });
        return pilots.length
          ? [
              {
                base: b.baseId,
                name: b.name,
                pilots: pilots.map(({ baseId: _b, local: _l, receivedAt: _r, ...p }) => p),
              },
            ]
          : [];
      });
  }

  startOutbox(
    send: (
      base: string,
      item: RunItem,
      dispatching: () => Promise<void>,
    ) => Promise<{ reached: boolean; result?: unknown; refused?: string }>,
    everyMs = 3000,
    cancel?: (base: string, id: string, reason: string) => Promise<{ status: string; result?: unknown }>,
  ) {
    let cancelling = false;
    const cancelTick = async () => {
      if (cancelling) return;
      cancelling = true;
      try {
        for (const q of (await this.host.nervous.call('kaji.outboxCancels')) as {
          sortieId: string;
          id: string;
          base: string;
          tool: string;
          reason: string;
          attempted: boolean;
          legacy: boolean;
        }[]) {
          let result: Record<string, unknown>;
          if (!q.attempted && !q.legacy)
            result = { outcome: 'reject', reason: 'Cancelled before dispatch; nothing was sent.' };
          else {
            let reply: { status: string; result?: unknown } | undefined;
            try {
              if (cancel && !q.legacy) reply = await cancel(q.base, q.id, q.reason);
            } catch {
              /* Unknown remote cancellation remains explicit. */
            }
            result =
              reply &&
              (reply.status === 'completed' || reply.status === 'cancelled') &&
              reply.result &&
              typeof reply.result === 'object'
                ? (reply.result as Record<string, unknown>)
                : {
                    outcome: 'uncertain',
                    error:
                      'Cancellation requested; remote work may have started. Inspect its receipt before releasing or repeating it.',
                  };
          }
          const text = remoteOutcomeText(q.base, q.tool, result);
          const changed = await this.host.nervous.call('kaji.outboxDone', {
            id: q.id,
            result,
            said: { base: q.base, text },
          });
          if (changed && !(await this.host.nervous.call('watch.get', { sortieId: q.sortieId }).catch(() => true)))
            for (const listener of this.host.resumeListeners)
              listener({ sortieId: q.sortieId, reply: text, steps: [], waiting: [] });
        }
      } catch {
        /* Durable cancellation markers remain for the next tick. */
      } finally {
        cancelling = false;
      }
    };
    this.cancelRemote = cancelTick;
    let busy = false,
      checkedUpgrade = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!checkedUpgrade) {
          const held = (await this.host.nervous.call('kaji.outboxHeld')) as unknown[];
          checkedUpgrade = true;
          if (held.length)
            console.error(
              'Worker upgrade: legacy requests are held for reconciliation (workers held); no automatic replay.',
            );
        }
        for (const q of (await this.host.nervous.call('kaji.outbox')) as {
          attempted: boolean;
          deadline: number;
          sequence: number;
          id: string;
          sortieId: string;
          base: string;
          tool: string;
          args: Record<string, unknown>;
          request: string;
          pilot?: string;
        }[]) {
          const r =
            q.deadline <= Date.now()
              ? {
                  reached: true,
                  result: q.attempted
                    ? {
                        outcome: 'uncertain',
                        error:
                          'Worker request expired after a dispatch attempt; inspect its destination receipt before any new request.',
                      }
                    : { outcome: 'reject', reason: 'Queued worker request expired before dispatch; nothing was sent.' },
                }
              : await send(
                  q.base,
                  {
                    id: q.id,
                    sequence: q.sequence,
                    deadline: q.deadline,
                    request: q.request,
                    tool: q.tool,
                    args: q.args,
                    ...(q.pilot ? { pilot: q.pilot } : {}),
                  },
                  async () => {
                    await this.host.nervous.call('kaji.outboxAttempt', { id: q.id });
                  },
                );
          if (!r.reached) continue;
          let result = (r.refused ? { refused: r.refused } : (r.result ?? {})) as Record<string, unknown>;
          if (Buffer.byteLength(JSON.stringify(result)) > WORKER_RESULT_BYTES)
            result = {
              outcome: 'uncertain',
              error: 'Remote result exceeded its bound; inspect the destination trace.',
            };
          const name = (await this.host.bases().catch(() => [])).find((b) => b.baseId === q.base)?.name ?? q.base;
          const reply = remoteOutcomeText(name, q.tool, result, q.args);
          const changed = await this.host.nervous.call(
            result.outcome === 'approval' ? 'kaji.outboxProgress' : 'kaji.outboxDone',
            { id: q.id, result, said: { base: name, text: reply } },
          );
          if (!changed) continue;
          if (!(await this.host.nervous.call('watch.get', { sortieId: q.sortieId }).catch(() => true)))
            for (const l of this.host.resumeListeners) l({ sortieId: q.sortieId, reply, steps: [], waiting: [] });
        }
      } catch {
        /* the next tick tries again */
      } finally {
        busy = false;
      }
    };
    if (!this.outboxTimer)
      this.outboxTimer = setInterval(() => {
        void cancelTick();
        void tick();
      }, everyMs);
    void cancelTick();
    void tick();
  }

  /**
   * F-021-T04: an MCP tool this base's gate granted for another base: the tools process makes the call, as for Misato
   * here. One the gate sends to the owner here is refused instead: nothing would make the call after an approval.
   */
  private async callGranted(
    r: ActReply | { outcome: string; error: string },
    item: RunItem,
    granted: { server: string; tool: string; fingerprint: string },
  ): Promise<unknown> {
    if ('approvalId' in r && r.approvalId) {
      await this.host.nervous
        .call('approvals.decide', { id: r.approvalId, decision: 'reject', source: 'kaji-mcp' })
        .catch(() => undefined);
      return {
        refused: `${item.tool} needs the owner's approval on this base; MCP tools asked for by another base run only when this base's gate grants them`,
        settled: true,
      };
    }
    if (!('external' in r) || !r.external || r.outcome !== 'grant') return r;
    const out = (await this.host
      .toolsProcess()
      .call(
        'tools.call',
        { server: granted.server, tool: granted.tool, args: item.args, fingerprint: granted.fingerprint },
        120_000,
      )
      .catch((e) => ({ error: e instanceof Error ? e.message : 'The tools process did not answer.' }))) as {
      text?: string;
      error?: string;
    };
    await this.host.nervous
      .call('actions.finished', {
        sortieId: r.sortieId,
        actionId: r.actionId,
        tool: item.tool,
        ...(out.error ? { error: out.error.slice(0, 1000) } : { text: (out.text ?? '').slice(0, 8000) }),
      })
      .catch(() => undefined);
    return out.error
      ? { ...r, error: out.error.slice(0, 1000) }
      : { ...r, result: { text: (out.text ?? '').slice(0, WORKER_RESULT_BYTES / 2) } };
  }

  async runFromPeer(from: string, item: RunItem, offered: string[], context: WorkerContext): Promise<unknown> {
    if (!context.ownerKey) throw new Error('Negotiated worker authority required.');
    const ownerKey = context.ownerKey;
    const wireContext = { session: context.session, epoch: context.epoch, expires: context.expires };
    const claim = (await this.host.nervous.call('worker.claim', {
      owner: from,
      ownerKey,
      key: this.host.getSelfKey(),
      item,
      ...(wireContext ? { context: wireContext } : {}),
    })) as WorkerClaim;
    if (claim.state === 'busy') return { retry: true, error: 'Worker resource is held by an unfinished request.' };
    if (claim.state !== 'claimed') return claim.result;
    const lease = claim.lease!;
    let pilotRefusal: string | undefined;
    if (item.pilot !== undefined) {
      const targetPilot = this.host.pilotRoster().find((p) => p.id === item.pilot);
      if (!targetPilot) pilotRefusal = `this base does not have pilot ${item.pilot}`;
      else {
        const grant = canRunRemotePilot(targetPilot, offered, item.tool);
        if (!grant.allowed) pilotRefusal = grant.reason;
      }
    }
    // F-021-T04: an offered MCP tool runs only while it is granted here and its description still matches the grant.
    const builtin = builtinTools.some((t) => t.name === item.tool);
    const granted =
      builtin || !offered.includes(item.tool)
        ? undefined
        : (await this.host.externalTools().catch(() => undefined))?.byName.get(item.tool);
    const mcpRefusal =
      builtin || !offered.includes(item.tool)
        ? undefined
        : !granted
          ? `${item.tool} is not granted on this base now (a changed or removed tool is suspended; on it: grant it again)`
          : granted.eva === '03'
            ? `${item.tool} is granted for EVA-03 (quarantine), which does not run tools yet`
            : undefined;
    const result = pilotRefusal
      ? { refused: pilotRefusal }
      : mcpRefusal
        ? { refused: mcpRefusal }
        : !offered.includes(item.tool) || item.tool === 'kaji.run' || (!builtin && !granted)
          ? { refused: `this base does not offer ${item.tool} (on it: kaji offer)` }
          : await this.host
              .act(
                {
                  request:
                    `From ${from}${item.pilot ? ` (pilot ${item.pilot})` : ''}: ${item.request || item.tool}`.slice(
                      0,
                      4000,
                    ),
                  tool: item.tool,
                  args: item.args,
                },
                lease,
              )
              .catch(() => ({
                outcome: 'invalid',
                error: 'Worker action failed or its lease/authority changed; inspect the local trace.',
              }))
              .then((r) => (granted ? this.callGranted(r, item, granted) : r) as Promise<Record<string, unknown>>);
    // Rejecting the approval card already settled this job's receipt: report the refusal, record nothing twice.
    if ('settled' in result) return { refused: result.refused };
    if ('approvalId' in result && result.approvalId) return result;
    try {
      await this.host.nervous.call('worker.finish', { lease, result: result as Record<string, unknown> });
    } catch {
      const uncertain = {
        outcome: 'uncertain',
        error:
          'The action returned but its result could not be recorded within the response bound; inspect the local trace.',
      };
      await this.host.nervous.call('worker.finish', { lease, result: uncertain });
      return uncertain;
    }
    return result;
  }
}
