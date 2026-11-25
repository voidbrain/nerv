export interface UncertainEffectRecord {
  key: string;
  owner: string;
  expiredAt: string;
  note: string;
}

export class ItemLockUncertainError extends Error {
  readonly record: UncertainEffectRecord;
  constructor(record: UncertainEffectRecord) {
    super(
      `Item "${record.key}" has an unconfirmed external effect from an expired lock (${record.owner}); expiry alone does not establish that it stopped.`,
    );
    this.name = 'ItemLockUncertainError';
    this.record = record;
  }
}

export class ItemLockCancelledError extends Error {
  constructor(message = 'Cancelled while waiting for item lock.') {
    super(message);
    this.name = 'ItemLockCancelledError';
  }
}

export interface ItemLockLease {
  readonly keys: readonly string[];
  readonly owner: string;
  readonly expired: boolean;
  release(): void;
}

interface LockWaiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
  cleanup?: () => void;
}

interface SingleLockState {
  holder?: { owner: string; expired: boolean; timer?: NodeJS.Timeout };
  waiters: LockWaiter[];
}

export interface ItemLockOptions {
  owner?: string;
  leaseMs?: number;
  externalEffect?: boolean;
  signal?: AbortSignal;
}

/**
 * Per-item mutation ownership (F-048-T03): serializes mutations on the same item
 * (reminder, fact, etc.) in FIFO order so the second waits for the first and re-reads
 * committed state before executing. Multi-item locks are acquired in sorted key order
 * to avoid deadlocks. Lease expiry never assumes an external effect stopped.
 */
export class ItemLockManager {
  private readonly locks = new Map<string, SingleLockState>();
  private readonly uncertain = new Map<string, UncertainEffectRecord>();

  async acquire(keysInput: string | readonly string[], options: ItemLockOptions = {}): Promise<ItemLockLease> {
    const keys = [...new Set(typeof keysInput === 'string' ? [keysInput] : keysInput)].filter(Boolean).sort();
    const owner = options.owner ?? 'unknown';
    if (!keys.length) {
      return { keys: [], owner, expired: false, release: () => {} };
    }
    if (options.signal?.aborted) {
      throw new ItemLockCancelledError();
    }

    for (const key of keys) {
      const record = this.uncertain.get(key);
      if (record) throw new ItemLockUncertainError(record);
    }

    const acquired: string[] = [];
    let expired = false;
    const timers: NodeJS.Timeout[] = [];

    try {
      for (const key of keys) {
        await this.acquireSingle(key, owner, options.signal);
        const record = this.uncertain.get(key);
        if (record) {
          this.releaseSingle(key);
          throw new ItemLockUncertainError(record);
        }
        acquired.push(key);
        if (options.leaseMs && options.leaseMs > 0) {
          const state = this.locks.get(key);
          const timer = setTimeout(() => {
            expired = true;
            if (state?.holder) state.holder.expired = true;
            if (options.externalEffect) {
              this.uncertain.set(key, {
                key,
                owner,
                expiredAt: new Date().toISOString(),
                note: 'Lock lease expired; external effect is not assumed stopped.',
              });
            }
          }, options.leaseMs);
          timer.unref?.();
          if (state?.holder) state.holder.timer = timer;
          timers.push(timer);
        }
      }
    } catch (err) {
      for (const t of timers) clearTimeout(t);
      for (let i = acquired.length - 1; i >= 0; i--) {
        this.releaseSingle(acquired[i]!);
      }
      throw err;
    }

    let released = false;
    return {
      keys,
      owner,
      get expired() {
        return expired;
      },
      release: () => {
        if (released) return;
        released = true;
        for (const t of timers) clearTimeout(t);
        for (let i = acquired.length - 1; i >= 0; i--) {
          this.releaseSingle(acquired[i]!);
        }
      },
    };
  }

  async withLock<T>(
    keysInput: string | readonly string[],
    fn: (lease: ItemLockLease) => Promise<T> | T,
    options: ItemLockOptions = {},
  ): Promise<T> {
    const lease = await this.acquire(keysInput, options);
    try {
      return await fn(lease);
    } finally {
      lease.release();
    }
  }

  reconcile(key: string): boolean {
    return this.uncertain.delete(key);
  }

  status(key: string): { locked: boolean; owner?: string; uncertain?: UncertainEffectRecord } {
    const state = this.locks.get(key);
    const uncertain = this.uncertain.get(key);
    return {
      locked: Boolean(state?.holder),
      ...(state?.holder ? { owner: state.holder.owner } : {}),
      ...(uncertain ? { uncertain } : {}),
    };
  }

  private acquireSingle(key: string, owner: string, signal?: AbortSignal): Promise<void> {
    let state = this.locks.get(key);
    if (!state) {
      state = { waiters: [] };
      this.locks.set(key, state);
    }
    if (!state.holder) {
      state.holder = { owner, expired: false };
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: LockWaiter = { resolve, reject };
      if (signal) {
        const onAbort = () => {
          const idx = state.waiters.indexOf(waiter);
          if (idx !== -1) state.waiters.splice(idx, 1);
          if (!state.holder && !state.waiters.length) this.locks.delete(key);
          reject(new ItemLockCancelledError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      state.waiters.push(waiter);
    });
  }

  private releaseSingle(key: string): void {
    const state = this.locks.get(key);
    if (!state) return;
    if (state.holder?.timer) clearTimeout(state.holder.timer);
    state.holder = undefined;
    const next = state.waiters.shift();
    if (next) {
      next.cleanup?.();
      state.holder = { owner: 'queued', expired: false };
      next.resolve();
      return;
    }
    this.locks.delete(key);
  }
}

/** Canonical item lock keys for built-in mutating tools. */
export function itemKeysForTool(tool: string, args: Record<string, unknown>): string[] {
  if (tool === 'reminders.cancel' || tool === 'reminders.restore') {
    const keys: string[] = [];
    if (typeof args.id === 'string' && args.id) keys.push(`reminder:${args.id}`);
    if (Array.isArray(args.ids)) {
      for (const id of args.ids) {
        if (typeof id === 'string' && id) keys.push(`reminder:${id}`);
      }
    }
    return [...new Set(keys)].sort();
  }
  if (tool === 'reminders.update' && typeof args.id === 'string' && args.id) {
    return [`reminder:${args.id}`];
  }
  if (
    (tool === 'memory.forget' || tool === 'memory.edit' || tool === 'memory.share') &&
    typeof args.id === 'string' &&
    args.id
  ) {
    return [`fact:${args.id}`];
  }
  return [];
}
