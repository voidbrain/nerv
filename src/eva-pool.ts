import { availableParallelism, totalmem } from 'node:os';
import { EVA_CLASS_SPECS } from './eva-classes.ts';
import type { EvaClass } from './pilots.ts';

/**
 * F-049-T06: how much one machine runs at once. Every EVA instance counts against `instances` and reserves its class's
 * memory cap against `memoryMb`; a job that needs a local model also takes one of `modelSlots`.
 */
export interface EvaLimits {
  readonly instances: number;
  readonly memoryMb: number;
  readonly modelSlots: number;
}

/** Defaults when config.json names none: one core left free, half the memory, one model at a time. */
export function defaultEvaLimits(cores = availableParallelism(), memoryBytes = totalmem()): EvaLimits {
  return {
    instances: Math.max(1, cores - 1),
    memoryMb: Math.max(256, Math.floor(memoryBytes / 1024 / 1024 / 2)),
    modelSlots: 1,
  };
}

/** Validates config.json's `eva.limits`; a missing field keeps its default. */
export function validateEvaLimits(raw: unknown, defaults: EvaLimits = defaultEvaLimits()): EvaLimits {
  if (raw === undefined) return defaults;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid eva.limits: {"instances": n, "memoryMb": n, "modelSlots": n}.');
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r))
    if (!['instances', 'memoryMb', 'modelSlots'].includes(k)) throw new Error(`Invalid eva.limits: unknown "${k}".`);
  const count = (k: 'instances' | 'memoryMb' | 'modelSlots', min: number, max: number) => {
    const v = r[k];
    if (v === undefined) return defaults[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      throw new Error(`Invalid eva.limits.${k}: a whole number from ${min} to ${max}.`);
    return v;
  };
  return {
    instances: count('instances', 1, 64),
    memoryMb: count('memoryMb', 64, 1_048_576),
    modelSlots: count('modelSlots', 0, 16),
  };
}

/** What a job asks of the machine: its class (for the memory cap) and whether it runs a local model. */
export interface EvaSlotRequest {
  readonly jobId: string;
  readonly evaClass: EvaClass;
  readonly pilot?: string;
  readonly sortieId?: string;
  readonly needsModel?: boolean;
  readonly signal?: AbortSignal;
}

export type EvaInstanceState = 'running' | 'waiting' | 'uncertain';

export interface EvaInstanceInfo {
  readonly jobId: string;
  readonly evaClass: EvaClass;
  readonly pilot: string | null;
  readonly state: EvaInstanceState;
  readonly sortieId?: string | null;
  readonly started?: string;
}

export interface EvaMachineInstances {
  readonly machineId: string;
  readonly machineName: string;
  readonly self: boolean;
  readonly online: boolean;
  readonly reported: boolean;
  readonly limits?: EvaLimits;
  readonly instances: readonly EvaInstanceInfo[];
}

export interface EvaInstancesSnapshot {
  readonly machines: readonly EvaMachineInstances[];
}

/** A job that can never fit these limits, whatever finishes: refused with its reason, never left waiting. */
export class EvaLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaLimitError';
  }
}

interface Waiting {
  readonly request: EvaSlotRequest;
  readonly memoryMb: number;
  readonly start: () => void;
}

/**
 * F-049-T06: runs EVA jobs within one machine's limits. A job over a limit waits in order (first in, first out) until
 * enough has finished; one that could never fit is refused with the reason; a waiting job can be cancelled.
 */
export class EvaPool {
  readonly limits: EvaLimits;
  private running = 0;
  private memoryMb = 0;
  private modelSlots = 0;
  private readonly active = new Map<string, EvaInstanceInfo>();
  private readonly queue: Waiting[] = [];
  constructor(limits: EvaLimits) {
    this.limits = limits;
  }

  /** Instances running and waiting now, for the dashboard and tests. */
  status(): { running: number; waiting: number; memoryMb: number; modelSlots: number } {
    return { running: this.running, waiting: this.queue.length, memoryMb: this.memoryMb, modelSlots: this.modelSlots };
  }

  /** Live running and waiting instances with class, pilot, job and state (F-049-T09). */
  instances(): EvaInstanceInfo[] {
    return [
      ...this.active.values(),
      ...this.queue.map((w) => ({
        jobId: w.request.jobId,
        evaClass: w.request.evaClass,
        pilot: w.request.pilot ?? null,
        state: 'waiting' as const,
        ...(w.request.sortieId !== undefined ? { sortieId: w.request.sortieId } : {}),
      })),
    ];
  }

  /** Waits for room, runs `job` in it and frees the room afterwards, whether the job succeeded or not. */
  async run<T>(request: EvaSlotRequest, job: () => Promise<T>): Promise<T> {
    const memoryMb = EVA_CLASS_SPECS[request.evaClass].resources.maxMemoryMb;
    if (memoryMb > this.limits.memoryMb)
      throw new EvaLimitError(
        `${request.jobId} needs ${memoryMb} MB (${request.evaClass}); this machine allows ${this.limits.memoryMb} MB for EVA jobs.`,
      );
    if (request.needsModel && this.limits.modelSlots === 0)
      throw new EvaLimitError(`${request.jobId} needs a local model; this machine allows no model slot for EVA jobs.`);
    await this.admit(request, memoryMb);
    try {
      return await job();
    } finally {
      this.active.delete(request.jobId);
      this.running--;
      this.memoryMb -= memoryMb;
      if (request.needsModel) this.modelSlots--;
      this.drain();
    }
  }

  private fits(request: EvaSlotRequest, memoryMb: number): boolean {
    return (
      this.running < this.limits.instances &&
      this.memoryMb + memoryMb <= this.limits.memoryMb &&
      (!request.needsModel || this.modelSlots < this.limits.modelSlots)
    );
  }

  private take(request: EvaSlotRequest, memoryMb: number): void {
    this.running++;
    this.memoryMb += memoryMb;
    if (request.needsModel) this.modelSlots++;
    this.active.set(request.jobId, {
      jobId: request.jobId,
      evaClass: request.evaClass,
      pilot: request.pilot ?? null,
      state: 'running',
      ...(request.sortieId !== undefined ? { sortieId: request.sortieId } : {}),
      started: new Date().toISOString(),
    });
  }

  private admit(request: EvaSlotRequest, memoryMb: number): Promise<void> {
    request.signal?.throwIfAborted();
    // Nobody jumps the queue: a job that fits still waits behind earlier ones.
    if (!this.queue.length && this.fits(request, memoryMb)) {
      this.take(request, memoryMb);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry: Waiting = { request, memoryMb, start: resolve };
      this.queue.push(entry);
      request.signal?.addEventListener(
        'abort',
        () => {
          const at = this.queue.indexOf(entry);
          if (at < 0) return;
          this.queue.splice(at, 1);
          reject(request.signal!.reason);
          this.drain();
        },
        { once: true },
      );
    });
  }

  private drain(): void {
    while (this.queue.length && this.fits(this.queue[0]!.request, this.queue[0]!.memoryMb)) {
      const next = this.queue.shift()!;
      this.take(next.request, next.memoryMb);
      next.start();
    }
  }
}
