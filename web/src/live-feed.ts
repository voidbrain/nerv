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
import { RequestError, SW_BYPASS, type Session } from './session.ts';

/**
 * F-130-T01: the one live data service of the workspace dashboard. GET /api/dashboard/stream says that something
 * changed; the feed then re-reads its pages. While the stream is down it polls /api/dashboard/history and the pages on
 * a timer and retries the stream, waiting longer after each failure and nothing while the page is hidden. Every value is a signal that changes only when its content changed: lists are
 * keyed (unchanged rows keep their object, an unchanged list keeps its array), other values compare by structure, so
 * an unchanged poll notifies nothing and leaves the DOM in place (the live-view rule, docs/STYLE-GUIDE.md).
 * Sections (F-130-T02 to F-130-T12) add their pages here. Plain class (no decorator) so node tests construct it.
 */
export interface History {
  delivered: number;
  pending: number;
  brief: { message: string; created: string } | null;
}
export type FeedMode = 'idle' | 'paused' | 'stream' | 'poll';
/** Why the last read failed: the service was not reached, or it answered with an error and its message. */
export type FeedProblem = { kind: 'offline' } | { kind: 'server'; status: number; message: string };

export interface FeedTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** While the stream is open, a slow safety read; without it, the fallback poll. */
export const STREAM_SAFETY_MS = 30_000;
export const FALLBACK_POLL_MS = 5_000;
export const STREAM_RETRY_MS = 3_000;
/** Failed reads and stream connects wait twice as long each time, up to this. */
export const MAX_BACKOFF_MS = 60_000;

const backoff = (base: number, failures: number) => Math.min(base * 2 ** failures, MAX_BACKOFF_MS);

export class LiveFeed {
  readonly sorties = signal<readonly SortieRow[]>([]);
  readonly approvals = signal<readonly ApprovalRow[]>([]);
  readonly health = signal<HealthGlance>('unknown');
  readonly history = signal<History | null>(null, { equal: sameValue });
  readonly mode = signal<FeedMode>('idle');
  /** The service's configured language (doctor), for a page that has not settled one. */
  readonly language = signal<string | null>(null);
  /** The last read failed; the values shown are the last good ones. A 401 instead ends the session. */
  readonly problem = signal<FeedProblem | null>(null, { equal: sameValue });

  private readonly session: Session;
  private readonly fetcher: typeof fetch;
  private readonly timers: FeedTimers;
  private readonly since: string;
  private running = false;
  private paused = false;
  private reading: Promise<void> | null = null;
  private again = false;
  private stream: AbortController | null = null;
  private pollTimer: unknown = null;
  private retryTimer: unknown = null;
  private readFailures = 0;
  private streamFailures = 0;

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
    if (this.paused) return;
    void this.refresh();
    void this.watch();
  }

  stop(): void {
    this.running = false;
    this.halt();
    this.mode.set('idle');
  }

  /** The page is hidden: no reads, no stream, no timers until resume(). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.halt();
    if (this.running) this.mode.set('paused');
  }

  /** The page is visible again: read now and reconnect, with fresh backoff. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (!this.running) return;
    this.readFailures = 0;
    this.streamFailures = 0;
    void this.refresh();
    void this.watch();
  }

  /** Re-reads every page once; a refresh asked for while one runs runs once more after it. */
  refresh(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return this.reading;
    }
    this.reading = this.read().finally(() => {
      this.reading = null;
      if (this.again && this.active()) {
        this.again = false;
        void this.refresh();
      }
      this.schedule();
    });
    return this.reading;
  }

  private active() {
    return this.running && !this.paused;
  }

  private halt() {
    this.stream?.abort();
    this.stream = null;
    this.timers.clear(this.pollTimer);
    this.timers.clear(this.retryTimer);
    this.pollTimer = this.retryTimer = null;
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
      const language = (doctor as { language?: unknown } | null)?.language;
      if (typeof language === 'string') this.language.set(language);
      this.history.set({ delivered: history.delivered, pending: history.pending, brief: history.brief });
      this.problem.set(null);
      this.readFailures = 0;
    } catch (e) {
      const status = e instanceof RequestError ? e.status : 0;
      if (status === 401) {
        // The credential no longer works: back to the sign-in box.
        this.stop();
        this.session.end();
        return;
      }
      this.readFailures++;
      this.problem.set(
        status === 0
          ? { kind: 'offline' }
          : { kind: 'server', status, message: e instanceof Error ? e.message : 'Request failed' },
      );
    }
  }

  /** The next safety or fallback read, by whether the stream is open, later after each failure. */
  private schedule() {
    this.timers.clear(this.pollTimer);
    this.pollTimer = null;
    if (!this.active()) return;
    const base = this.mode() === 'stream' ? STREAM_SAFETY_MS : FALLBACK_POLL_MS;
    this.pollTimer = this.timers.set(() => void this.refresh(), backoff(base, this.readFailures));
  }

  private async watch(): Promise<void> {
    if (!this.active() || this.stream) return;
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
      this.streamFailures = 0;
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
      if (this.active()) {
        this.mode.set('poll');
        this.schedule();
        this.timers.clear(this.retryTimer);
        this.retryTimer = this.timers.set(() => void this.watch(), backoff(STREAM_RETRY_MS, this.streamFailures++));
      }
    }
  }
}
