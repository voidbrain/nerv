import { signal } from '@angular/core';
import {
  healthGlance,
  keyed,
  readStream,
  sameValue,
  toApproval,
  toSortie,
  type ApprovalRow,
  type FeedApproval,
  type FeedSortie,
  type HealthGlance,
  type SortieRow,
} from '../../src/dashboard-view.ts';
import { SW_BYPASS, type Session } from './session.ts';

/**
 * F-130-T01: the one live data service of the workspace dashboard. GET /api/dashboard/stream says that something
 * changed; the feed then re-reads its pages. While the stream is down it polls /api/dashboard/history and the pages on
 * a timer and retries the stream. Every value is a signal that changes only when its content changed: lists are
 * keyed (unchanged rows keep their object, an unchanged list keeps its array), other values compare by structure, so
 * an unchanged poll notifies nothing and leaves the DOM in place (the live-view rule, docs/STYLE-GUIDE.md).
 * Sections (F-130-T02 to F-130-T12) add their pages here. Plain class (no decorator) so node tests construct it.
 */
export interface History {
  delivered: number;
  pending: number;
  brief: { message: string; created: string } | null;
}
export type FeedMode = 'idle' | 'stream' | 'poll';

export interface FeedTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** While the stream is open, a slow safety read; without it, the fallback poll. */
export const STREAM_SAFETY_MS = 30_000;
export const FALLBACK_POLL_MS = 5_000;
export const STREAM_RETRY_MS = 3_000;

export class LiveFeed {
  readonly sorties = signal<readonly SortieRow[]>([]);
  readonly approvals = signal<readonly ApprovalRow[]>([]);
  readonly health = signal<HealthGlance>('unknown');
  readonly history = signal<History | null>(null, { equal: sameValue });
  readonly mode = signal<FeedMode>('idle');
  /** The last read failed (not reached, or refused); the values shown are the last good ones. */
  readonly stale = signal(false);

  private readonly session: Session;
  private readonly fetcher: typeof fetch;
  private readonly timers: FeedTimers;
  private readonly since: string;
  private running = false;
  private reading: Promise<void> | null = null;
  private again = false;
  private stream: AbortController | null = null;
  private pollTimer: unknown = null;
  private retryTimer: unknown = null;

  constructor(session: Session, fetcher: typeof fetch, timers: FeedTimers, since: string) {
    this.session = session;
    this.fetcher = fetcher;
    this.timers = timers;
    this.since = since;
  }

  /** Starts reading: one read now, then the stream with the fallback poll. Calling it again does nothing. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refresh();
    void this.watch();
  }

  stop(): void {
    this.running = false;
    this.stream?.abort();
    this.stream = null;
    this.timers.clear(this.pollTimer);
    this.timers.clear(this.retryTimer);
    this.mode.set('idle');
  }

  /** Re-reads every page once; a refresh asked for while one runs runs once more after it. */
  refresh(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return this.reading;
    }
    this.reading = this.read().finally(() => {
      this.reading = null;
      if (this.again && this.running) {
        this.again = false;
        void this.refresh();
      }
      this.schedule();
    });
    return this.reading;
  }

  private async read(): Promise<void> {
    if (!this.session.token()) return;
    try {
      const [sorties, approvals, doctor, history] = await Promise.all([
        this.session.request('sorties?limit=20') as Promise<FeedSortie[]>,
        this.session.request('approvals?limit=20') as Promise<FeedApproval[]>,
        this.session.request('doctor'),
        this.session.request('dashboard/history?since=' + encodeURIComponent(this.since)) as Promise<History>,
      ]);
      this.sorties.set(keyed(this.sorties(), sorties.map(toSortie), (s) => s.realId));
      this.approvals.set(keyed(this.approvals(), approvals.map(toApproval), (a) => a.id));
      this.health.set(healthGlance(doctor));
      this.history.set({ delivered: history.delivered, pending: history.pending, brief: history.brief });
      this.stale.set(false);
    } catch (e) {
      this.stale.set(true);
      if ((e as { status?: number }).status === 401) this.stop();
    }
  }

  /** The next safety or fallback read, by whether the stream is open. */
  private schedule() {
    this.timers.clear(this.pollTimer);
    if (!this.running) return;
    this.pollTimer = this.timers.set(
      () => void this.refresh(),
      this.mode() === 'stream' ? STREAM_SAFETY_MS : FALLBACK_POLL_MS,
    );
  }

  private async watch(): Promise<void> {
    if (!this.running || this.stream) return;
    const token = this.session.token();
    if (!token) return;
    const controller = new AbortController();
    this.stream = controller;
    try {
      const response = await this.fetcher('/api/dashboard/stream', {
        headers: { Authorization: 'Bearer ' + token, ...SW_BYPASS },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return;
      this.mode.set('stream');
      this.schedule();
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let pending = '';
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          const read = readStream(pending, decoder.decode(next.value, { stream: true }));
          pending = read.pending;
          if (read.refresh) void this.refresh();
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch {
      /* the fallback poll keeps the values current while the stream is down */
    } finally {
      if (this.stream === controller) this.stream = null;
      if (this.running) {
        this.mode.set('poll');
        this.schedule();
        this.retryTimer = this.timers.set(() => void this.watch(), STREAM_RETRY_MS);
      }
    }
  }
}
