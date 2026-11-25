import type { ModelConcurrency } from './model.ts';

export const DEFAULT_MODEL_CONCURRENCY = 2;

export interface ModelLease {
  readonly model: string;
  release(): void;
}

export class ModelBudgetCancelledError extends Error {
  constructor(message = 'Model request cancelled while waiting for budget.') {
    super(message);
    this.name = 'ModelBudgetCancelledError';
  }
}

interface BudgetWaiter {
  resolve: (lease: ModelLease) => void;
  reject: (reason: unknown) => void;
  cleanup?: () => void;
}

/**
 * Per-model concurrency budget (F-048-T02): bounds simultaneous calls per model
 * and queues excess calls in FIFO order without overloading local engines.
 * Leases are idempotent and only release the single slot they acquired.
 */
export class ModelBudget {
  private defaultLimit: number;
  private perModel: Record<string, number>;
  private readonly active = new Map<string, number>();
  private readonly queues = new Map<string, BudgetWaiter[]>();

  constructor(concurrency?: ModelConcurrency) {
    this.defaultLimit = concurrency?.default ?? DEFAULT_MODEL_CONCURRENCY;
    this.perModel = { ...(concurrency?.perModel ?? {}) };
  }

  configure(concurrency?: ModelConcurrency): void {
    this.defaultLimit = concurrency?.default ?? DEFAULT_MODEL_CONCURRENCY;
    this.perModel = { ...(concurrency?.perModel ?? {}) };
    for (const model of this.queues.keys()) {
      this.drain(model);
    }
  }

  limitFor(model: string): number {
    return this.perModel[model] ?? this.defaultLimit;
  }

  acquire(model: string, signal?: AbortSignal): Promise<ModelLease> {
    if (signal?.aborted) {
      return Promise.reject(new ModelBudgetCancelledError());
    }
    const current = this.active.get(model) ?? 0;
    const limit = this.limitFor(model);
    if (current < limit) {
      this.active.set(model, current + 1);
      return Promise.resolve(this.createLease(model));
    }

    return new Promise<ModelLease>((resolve, reject) => {
      const queue = this.queues.get(model) ?? [];
      const waiter: BudgetWaiter = { resolve, reject };
      if (signal) {
        const onAbort = () => {
          const list = this.queues.get(model);
          if (list) {
            const idx = list.indexOf(waiter);
            if (idx !== -1) list.splice(idx, 1);
            if (!list.length) this.queues.delete(model);
          }
          reject(new ModelBudgetCancelledError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      queue.push(waiter);
      this.queues.set(model, queue);
    });
  }

  snapshot(): {
    defaultLimit: number;
    perModel: Record<string, number>;
    active: Record<string, number>;
    queued: Record<string, number>;
  } {
    const active: Record<string, number> = {};
    for (const [k, v] of this.active) {
      if (v > 0) active[k] = v;
    }
    const queued: Record<string, number> = {};
    for (const [k, v] of this.queues) {
      if (v.length > 0) queued[k] = v.length;
    }
    return {
      defaultLimit: this.defaultLimit,
      perModel: { ...this.perModel },
      active,
      queued,
    };
  }

  private createLease(model: string): ModelLease {
    let released = false;
    return {
      model,
      release: () => {
        if (released) return;
        released = true;
        const current = this.active.get(model) ?? 0;
        if (current <= 1) this.active.delete(model);
        else this.active.set(model, current - 1);
        this.drain(model);
      },
    };
  }

  private drain(model: string): void {
    const queue = this.queues.get(model);
    if (!queue?.length) return;
    const limit = this.limitFor(model);
    while (queue.length > 0 && (this.active.get(model) ?? 0) < limit) {
      const waiter = queue.shift();
      if (!waiter) break;
      waiter.cleanup?.();
      this.active.set(model, (this.active.get(model) ?? 0) + 1);
      waiter.resolve(this.createLease(model));
    }
    if (!queue.length) this.queues.delete(model);
  }
}
