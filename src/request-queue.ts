import { randomUUID } from 'node:crypto';

export type RequestChannel = 'telegram' | 'dashboard' | 'cli' | 'kaji' | 'other';

export interface QueuedRequestSnapshot {
  id: string;
  conversation: string;
  channel: RequestChannel;
  title: string;
  status: 'queued' | 'running';
  ahead: number;
  enqueuedAt: string;
  startedAt?: string;
  sortieId?: string;
}

export interface QueueSnapshot {
  maxConcurrent: number;
  maxQueued: number;
  running: QueuedRequestSnapshot[];
  queued: QueuedRequestSnapshot[];
}

export class QueueFullError extends Error {
  readonly maxQueued: number;
  constructor(maxQueued: number, message?: string) {
    super(message ?? `Request queue is full (${maxQueued} waiting). Try again later.`);
    this.name = 'QueueFullError';
    this.maxQueued = maxQueued;
  }
}

export class QueueCancelledError extends Error {
  constructor(message = 'Request cancelled while queued.') {
    super(message);
    this.name = 'QueueCancelledError';
  }
}

export function formatQueuedMessage(ahead: number, language: 'en' | 'it' = 'en'): string {
  return language === 'it' ? `In coda, ${ahead} davanti.` : `Queued, ${ahead} ahead.`;
}

export function formatQueueFullMessage(maxQueued: number, language: 'en' | 'it' = 'en'): string {
  return language === 'it'
    ? `Coda piena (${maxQueued} in attesa). Riprova più tardi.`
    : `Queue is full (${maxQueued} waiting). Try again later.`;
}

export function channelFromConversation(conversation: string): RequestChannel {
  if (conversation.startsWith('telegram:')) return 'telegram';
  if (conversation === 'dashboard') return 'dashboard';
  if (conversation === 'cli') return 'cli';
  if (conversation.startsWith('kaji:')) return 'kaji';
  return 'other';
}

interface PendingEntry<T> {
  id: string;
  conversation: string;
  channel: RequestChannel;
  title: string;
  enqueuedAt: string;
  sortieId?: string;
  ahead: number;
  controller: AbortController;
  onPositionChange?: (ahead: number) => void;
  run: (ctx: { id: string; signal: AbortSignal; setSortieId: (sortieId: string) => void }) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  cleanupAbort?: () => void;
}

interface RunningEntry {
  id: string;
  conversation: string;
  channel: RequestChannel;
  title: string;
  enqueuedAt: string;
  startedAt: string;
  sortieId?: string;
  controller: AbortController;
}

export interface RequestQueueOptions {
  maxConcurrent?: number;
  maxQueued?: number;
  onChange?: () => void;
}

export const DEFAULT_MAX_CONCURRENT_REQUESTS = 1;
export const DEFAULT_MAX_QUEUED_REQUESTS = 16;

/**
 * Bounded FIFO request scheduler with per-conversation ordering, live waiting position,
 * explicit cancellation, and shutdown cleanup.
 */
export class RequestQueue {
  private maxConcurrent: number;
  private maxQueued: number;
  private readonly onChange?: () => void;
  private readonly running = new Map<string, RunningEntry>();
  private readonly waiting: PendingEntry<unknown>[] = [];
  private closed = false;

  constructor(options: RequestQueueOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_REQUESTS);
    this.maxQueued = Math.max(1, options.maxQueued ?? DEFAULT_MAX_QUEUED_REQUESTS);
    this.onChange = options.onChange;
  }

  configure(options: { maxConcurrent?: number; maxQueued?: number }): void {
    if (options.maxConcurrent !== undefined) {
      this.maxConcurrent = Math.max(1, options.maxConcurrent);
    }
    if (options.maxQueued !== undefined) {
      this.maxQueued = Math.max(1, options.maxQueued);
    }
    this.drain();
  }

  enqueue<T>(options: {
    id?: string;
    conversation: string;
    title: string;
    signal?: AbortSignal;
    onQueued?: (ahead: number, id: string) => void;
    onPositionChange?: (ahead: number) => void;
    run: (ctx: { id: string; signal: AbortSignal; setSortieId: (sortieId: string) => void }) => Promise<T>;
  }): Promise<T> {
    if (this.closed) {
      return Promise.reject(new QueueCancelledError('Service is shutting down; request not queued.'));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new QueueCancelledError('Request cancelled before queueing.'));
    }

    const id = options.id ?? randomUUID();
    const channel = channelFromConversation(options.conversation);
    const controller = new AbortController();
    const onExternalAbort = () => {
      this.cancel(id);
    };
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const cleanupExternalAbort = () => {
      options.signal?.removeEventListener('abort', onExternalAbort);
    };

    if (this.canStartNow(options.conversation)) {
      const active: RunningEntry = {
        id,
        conversation: options.conversation,
        channel,
        title: options.title,
        enqueuedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        controller,
      };
      this.running.set(id, active);
      this.onChange?.();
      return this.execute(active, options.run, cleanupExternalAbort);
    }

    if (this.waiting.length >= this.maxQueued) {
      cleanupExternalAbort();
      return Promise.reject(new QueueFullError(this.maxQueued));
    }

    return new Promise<T>((resolve, reject) => {
      const ahead = this.waiting.length + 1;
      const entry: PendingEntry<T> = {
        id,
        conversation: options.conversation,
        channel,
        title: options.title,
        enqueuedAt: new Date().toISOString(),
        ahead,
        controller,
        onPositionChange: options.onPositionChange,
        run: options.run,
        resolve,
        reject,
        cleanupAbort: cleanupExternalAbort,
      };
      this.waiting.push(entry as PendingEntry<unknown>);
      this.onChange?.();
      try {
        options.onQueued?.(ahead, id);
      } catch {
        /* Observer notifications must not break scheduling. */
      }
    });
  }

  cancel(id: string): boolean {
    const idx = this.waiting.findIndex((entry) => entry.id === id);
    if (idx !== -1) {
      const [removed] = this.waiting.splice(idx, 1);
      if (removed) {
        removed.cleanupAbort?.();
        removed.controller.abort();
        removed.reject(new QueueCancelledError());
        this.notifyPositions();
        this.onChange?.();
      }
      return true;
    }
    const active = this.running.get(id);
    if (active) {
      active.controller.abort();
      return true;
    }
    return false;
  }

  snapshot(): QueueSnapshot {
    return {
      maxConcurrent: this.maxConcurrent,
      maxQueued: this.maxQueued,
      running: [...this.running.values()].map((r) => ({
        id: r.id,
        conversation: r.conversation,
        channel: r.channel,
        title: r.title,
        status: 'running',
        ahead: 0,
        enqueuedAt: r.enqueuedAt,
        startedAt: r.startedAt,
        ...(r.sortieId ? { sortieId: r.sortieId } : {}),
      })),
      queued: this.waiting.map((w, index) => ({
        id: w.id,
        conversation: w.conversation,
        channel: w.channel,
        title: w.title,
        status: 'queued',
        ahead: index + 1,
        enqueuedAt: w.enqueuedAt,
        ...(w.sortieId ? { sortieId: w.sortieId } : {}),
      })),
    };
  }

  close(reason = 'Service shutting down; queued request cancelled.'): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiting.length) {
      const entry = this.waiting.shift();
      if (!entry) continue;
      entry.cleanupAbort?.();
      entry.controller.abort();
      entry.reject(new QueueCancelledError(reason));
    }
    for (const active of this.running.values()) {
      active.controller.abort();
    }
    this.onChange?.();
  }

  private canStartNow(conversation: string): boolean {
    if (this.running.size >= this.maxConcurrent) return false;
    for (const active of this.running.values()) {
      if (active.conversation === conversation) return false;
    }
    return true;
  }

  private execute<T>(
    active: RunningEntry,
    run: (ctx: { id: string; signal: AbortSignal; setSortieId: (sortieId: string) => void }) => Promise<T>,
    cleanupExternalAbort?: () => void,
  ): Promise<T> {
    const setSortieId = (sortieId: string) => {
      active.sortieId = sortieId;
      this.onChange?.();
    };
    return Promise.resolve()
      .then(() => run({ id: active.id, signal: active.controller.signal, setSortieId }))
      .finally(() => {
        cleanupExternalAbort?.();
        this.running.delete(active.id);
        this.drain();
        this.onChange?.();
      });
  }

  private drain(): void {
    if (this.closed) return;
    while (this.running.size < this.maxConcurrent && this.waiting.length > 0) {
      const nextIndex = this.waiting.findIndex((entry) => this.canStartNow(entry.conversation));
      if (nextIndex === -1) break;
      const [entry] = this.waiting.splice(nextIndex, 1);
      if (!entry) break;
      if (entry.controller.signal.aborted) {
        entry.cleanupAbort?.();
        entry.reject(new QueueCancelledError());
        continue;
      }
      const active: RunningEntry = {
        id: entry.id,
        conversation: entry.conversation,
        channel: entry.channel,
        title: entry.title,
        enqueuedAt: entry.enqueuedAt,
        startedAt: new Date().toISOString(),
        ...(entry.sortieId ? { sortieId: entry.sortieId } : {}),
        controller: entry.controller,
      };
      this.running.set(active.id, active);
      this.notifyPositions();
      this.onChange?.();
      this.execute(active, entry.run, entry.cleanupAbort).then(entry.resolve, entry.reject);
    }
  }

  private notifyPositions(): void {
    for (let i = 0; i < this.waiting.length; i++) {
      const entry = this.waiting[i]!;
      const nextAhead = i + 1;
      if (entry.ahead !== nextAhead) {
        entry.ahead = nextAhead;
        try {
          entry.onPositionChange?.(nextAhead);
        } catch {
          /* Observer notifications must not break scheduling. */
        }
      }
    }
  }
}
