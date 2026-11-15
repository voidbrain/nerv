import { briefDue, composeBrief, gatherBrief, localClock } from './brief.ts';
import { readConfig } from './config.ts';
import type { Digest, Exchange } from './instrumentality.ts';
import { runFailure, runMessage, type InstrumentalityRun } from './instrumentality-runs.ts';
import type { Step } from './misato.ts';
import { MODEL_TIMEOUT_MS } from './model.ts';
import type { ProcessClient } from './process-client.ts';
import type { RouteHealth } from './route-health.ts';
import type { ChatReply, OwnerAction, StoreApi } from './runtime-api.ts';
import type { WatchWork } from './watch.ts';

export interface RuntimeInstrumentalityHost {
  readonly home: string | undefined;
  readonly nervous: ProcessClient;
  readonly storeApi: StoreApi;
  modelCall(method: 'instrumentality.digest', params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  gate(sortieId: string, action: OwnerAction, intent?: boolean): Promise<unknown>;
  note(sortieId: string, kind: 'misato.request', payload: Record<string, unknown>): Promise<unknown>;
  loop(
    sortieId: string,
    request: string,
    steps: Step[],
    earlier: { request: string; reply?: string }[],
    options: { consult: boolean; advice?: string; conversation?: string; watch?: WatchWork },
  ): Promise<ChatReply>;
  routes(): Promise<{ routes?: { local: RouteHealth; cloud: RouteHealth } }>;
}

/**
 * Daily consolidation (Instrumentality), Hyuga's brief, proactive watch ticks, and route logging
 * extracted from Runtime (F-095-T03).
 */
export class RuntimeInstrumentality {
  private readonly host: RuntimeInstrumentalityHost;
  private instrumentality?: NodeJS.Timeout;
  private briefTimer?: NodeJS.Timeout;
  private watchTimer?: NodeJS.Timeout;
  private routeLogTimer?: NodeJS.Timeout;
  private watchRecovered = false;
  private watchWork?: Promise<ChatReply | null>;
  private instrumentalitySchedule?: () => { mode?: { at: string } | { when: 'idle' }; timeZone: string };

  constructor(host: RuntimeInstrumentalityHost) {
    this.host = host;
  }

  stopTimers(): void {
    if (this.instrumentality) clearInterval(this.instrumentality);
    if (this.briefTimer) clearInterval(this.briefTimer);
    if (this.watchTimer) clearInterval(this.watchTimer);
    if (this.routeLogTimer) clearInterval(this.routeLogTimer);
  }

  async consolidate(
    now = new Date(),
    runId?: string,
  ): Promise<{ summary?: string; exchanges: number; proposed: number; skipped: number; error?: string }> {
    const last = ((await this.host.nervous.call('memory.episodes', { limit: 1 })) as { until: string }[])[0];
    const since = last?.until ?? new Date(now.getTime() - 86_400_000).toISOString();
    const until = now.toISOString();
    const exchanges = (await this.host.nervous.call('memory.exchanges', { since, until })) as Exchange[];
    if (!exchanges.length) {
      await this.host.nervous.call('memory.saveEpisode', {
        since,
        until,
        summary: '',
        exchanges: 0,
        proposed: 0,
        ...(runId ? { runId } : {}),
      });
      return { exchanges: 0, proposed: 0, skipped: 0 };
    }
    const ask = () =>
      this.host.modelCall('instrumentality.digest', { exchanges }, MODEL_TIMEOUT_MS).catch(() => ({
        error: 'Brain unavailable.',
      })) as Promise<{ digest?: Digest; error?: string }>;
    let out = await ask();
    if (!out.digest && out.error === 'The digest reply was not readable.') out = await ask();
    if (!out.digest) return { exchanges: exchanges.length, proposed: 0, skipped: 0, error: out.error ?? 'No digest.' };
    const tainted = exchanges.some((e) => e.tainted !== false);
    const known = new Set((await this.host.nervous.call('memory.known', { texts: out.digest.facts })) as string[]);
    const fresh = out.digest.facts.filter((f) => !known.has(f));
    if (fresh.length) {
      const sortieId = (await this.host.nervous.call('sorties.open', {
        title: `Instrumentality: ${fresh.length} fact(s) to confirm`,
        source: 'instrumentality',
      })) as string;
      if (tainted)
        await this.host.nervous.call('context.intake', { sortieId, source: 'instrumentality', trust: 'tainted' });
      for (const text of fresh)
        await this.host.gate(
          sortieId,
          {
            request: 'Instrumentality: a fact the owner stated, to confirm before it is remembered.',
            tool: 'memory.remember',
            args: { text },
          },
          false,
        );
    }
    await this.host.nervous.call('memory.saveEpisode', {
      since,
      until,
      summary: out.digest.summary,
      tainted,
      exchanges: exchanges.length,
      proposed: fresh.length,
      ...(runId ? { runId } : {}),
    });
    return {
      summary: out.digest.summary,
      exchanges: exchanges.length,
      proposed: fresh.length,
      skipped: out.digest.facts.length - fresh.length,
    };
  }

  startBrief(
    schedule: () => { at: string; timeZone: string; language: 'it' | 'en'; base?: string } | undefined,
    initial?: string,
    everyMs = 60_000,
  ) {
    let attempted: string | undefined,
      busy = false,
      lastIssue: string | undefined;
    const issue = (reason: string | undefined) => {
      if (reason !== lastIssue && reason) console.error(`Hyuga: daily brief deferred or incomplete (${reason}).`);
      lastIssue = reason;
    };
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const b = schedule();
        if (!b) return;
        const now = new Date();
        let last: string | null;
        try {
          last = ((await this.host.nervous.call('inbox.lastBrief')) as string | null) ?? initial ?? null;
        } catch {
          issue('checkpoint unavailable');
          return;
        }
        const date = briefDue(now, b.timeZone, b.at, last ? localClock(new Date(last), b.timeZone).date : undefined);
        if (!date || attempted === date) return;
        const facts = await gatherBrief(
          this.host.storeApi,
          last ? new Date(last) : new Date(now.getTime() - 86_400_000),
        );
        if (
          ['approvals', 'reminders', 'sorties', 'health'].every((source) =>
            facts.unavailable?.includes(source as 'approvals' | 'reminders' | 'sorties' | 'health'),
          )
        ) {
          issue('all core sources unavailable');
          return;
        }
        await this.host.nervous.call('inbox.brief', {
          message: composeBrief({
            now,
            timeZone: b.timeZone,
            language: b.language,
            ...(b.base ? { base: b.base } : {}),
            ...facts,
          }),
          day: date,
        });
        attempted = date;
        issue(
          facts.unavailable?.length ? 'sources unavailable: ' + [...facts.unavailable].sort().join(', ') : undefined,
        );
      } catch {
        issue('storage or composition unavailable');
      } finally {
        busy = false;
      }
    };

    if (!this.briefTimer)
      this.briefTimer = setInterval(() => {
        void tick();
      }, everyMs);
    void tick();
  }

  checkWatch(): Promise<ChatReply | null> {
    if (this.watchWork) return this.watchWork;
    return this.trackWatch(this.runWatch());
  }

  enqueueWatchWork(fn: () => Promise<ChatReply | null>): Promise<ChatReply | null> {
    const prior = this.watchWork;
    const work = (prior ? prior.catch(() => null) : Promise.resolve(null)).then(fn);
    return this.trackWatch(work);
  }

  private trackWatch(work: Promise<ChatReply | null>): Promise<ChatReply | null> {
    this.watchWork = work;
    void work
      .finally(() => {
        if (this.watchWork === work) this.watchWork = undefined;
      })
      .catch(() => {});
    return work;
  }

  private async runWatch(): Promise<ChatReply | null> {
    if (!this.watchRecovered) {
      await this.host.nervous.call('watch.recover');
      this.watchRecovered = true;
    }
    await this.host.nervous.call('watch.poll');
    const run = (await this.host.nervous.call('watch.claim')) as WatchWork | null;
    if (!run) return null;
    await this.host.note(run.sortieId, 'misato.request', { text: run.request });
    return this.host.loop(run.sortieId, run.request, [], [], { consult: false, watch: run });
  }

  async logRoutes(): Promise<void> {
    const { routes } = await this.host.routes();
    if (!routes) return;
    for (const route of ['local', 'cloud'] as const) {
      const h = routes[route];
      if ((h.state !== 'down' && h.state !== 'ok') || !h.since) continue;
      await this.host.nervous.call('milestones.health', {
        scope: 'route',
        subject: route,
        ok: h.state === 'ok',
        at: h.since,
      });
    }
  }

  startRouteLog(everyMs = 60_000) {
    const tick = () => {
      void this.logRoutes().catch(() => {});
    };
    if (!this.routeLogTimer) this.routeLogTimer = setInterval(tick, everyMs);
    tick();
  }

  startWatch(everyMs = 60_000) {
    const tick = () => {
      void this.checkWatch().catch(() => {
        console.error('Hyuga: proactive watch unavailable; no attempt was retried.');
      });
    };
    if (!this.watchTimer) this.watchTimer = setInterval(tick, everyMs);
    tick();
  }

  startInstrumentality(
    schedule: () => { mode?: { at: string } | { when: 'idle' }; timeZone: string },
    everyMs = 60_000,
    clock: () => Date = () => new Date(),
  ) {
    this.instrumentalitySchedule = schedule;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const { mode, timeZone } = schedule();
        if (!mode) return;
        const now = clock();
        const last = (
          (await this.host.nervous.call('memory.episodes', { limit: 1 })) as { created: string; until: string }[]
        )[0];
        const day = localClock(now, timeZone).date;
        if ('at' in mode) {
          if (!briefDue(now, timeZone, mode.at, undefined)) return;
          if (last && localClock(new Date(last.created), timeZone).date === day) return;
        } else {
          const activity = (await this.host.nervous.call('memory.lastRequest')) as string | null;
          if (
            !activity ||
            (last && activity <= last.until) ||
            now.getTime() - Date.parse(activity) < 3_600_000 ||
            (last && now.getTime() - Date.parse(last.until) < 20 * 3_600_000)
          )
            return;
        }
        const claim = (await this.host.nervous.call('instrumentality.claim', {
          slot: ('at' in mode ? 'at:' : 'idle:') + day,
          now: now.toISOString(),
        })) as InstrumentalityRun | null;
        if (!claim) return;
        const result = await this.consolidate(now, claim.id).catch(() => ({
          exchanges: 0,
          proposed: 0,
          skipped: 0,
          error: 'Consolidation unavailable.',
        }));
        if (result.error)
          await this.host.nervous.call('instrumentality.finish', {
            id: claim.id,
            status: 'failed',
            reason: runFailure(result.error),
            now: clock().toISOString(),
          });
      } catch {
        /* A durable pending claim remains unknown and is eligible for the one later attempt. */
      } finally {
        busy = false;
      }
    };
    if (!this.instrumentality)
      this.instrumentality = setInterval(() => {
        void tick();
      }, everyMs);
    void tick();
  }

  async scheduledHealth(): Promise<{ instrumentality?: InstrumentalityRun | null; degraded: string[] }> {
    try {
      const mode = this.instrumentalitySchedule
        ? this.instrumentalitySchedule().mode
        : this.host.home
          ? readConfig(this.host.home).instrumentality
          : undefined;
      if (!mode) return { degraded: [] };
      const run = (await this.host.nervous.call('instrumentality.latest')) as InstrumentalityRun | null;
      return {
        instrumentality: run,
        degraded:
          run &&
          (run.status === 'failed' ||
            (run.status === 'pending' && Date.now() - Date.parse(run.started) > 3 * MODEL_TIMEOUT_MS))
            ? [runMessage(run)]
            : [],
      };
    } catch {
      return { degraded: ['Instrumentality status unavailable.'] };
    }
  }
}
