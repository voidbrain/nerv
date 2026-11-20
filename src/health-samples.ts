import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';
import type { BaseLinkMetrics } from './link-load.ts';

export interface HealthSample {
  readonly sampledAtMs: number;
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly cpuUserUs: number;
  readonly cpuSystemUs: number;
  readonly eventLoopDelayMs: number;
  readonly pollCount: number;
}

export interface HealthSampleOptions {
  readonly minIntervalMs?: number;
  readonly maxSamples?: number;
  readonly maxAgeMs?: number;
}

export const HEALTH_SAMPLES_SCHEMA = `
CREATE TABLE IF NOT EXISTS health_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sampled_at_ms INTEGER NOT NULL,
  rss_bytes INTEGER NOT NULL,
  heap_used_bytes INTEGER NOT NULL,
  cpu_user_us INTEGER NOT NULL,
  cpu_system_us INTEGER NOT NULL,
  event_loop_delay_ms REAL NOT NULL,
  poll_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_samples_time ON health_samples (sampled_at_ms DESC);
`;

const DEFAULT_MIN_INTERVAL_MS = 60_000;
const DEFAULT_MAX_SAMPLES = 1440;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Local-only bounded store for process health samples (memory, CPU, event-loop delay, poll counts).
 * Enforces a minimum sampling interval and a strict row/age retention cap (F-103-T01).
 */
export class HealthSampleStore {
  readonly minIntervalMs: number;
  readonly maxSamples: number;
  readonly maxAgeMs: number;
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync, options: HealthSampleOptions = {}) {
    this.db = db;
    this.minIntervalMs = Math.max(100, options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
    this.maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
    this.maxAgeMs = Math.max(1000, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
    this.db.exec(HEALTH_SAMPLES_SCHEMA);
  }

  record(sample: HealthSample): { recorded: boolean; reason?: 'rate-limited' } {
    const latest = this.db
      .prepare('SELECT sampled_at_ms FROM health_samples ORDER BY sampled_at_ms DESC LIMIT 1')
      .get() as { sampled_at_ms: number } | undefined;

    if (latest && sample.sampledAtMs - latest.sampled_at_ms < this.minIntervalMs) {
      return { recorded: false, reason: 'rate-limited' };
    }

    this.db
      .prepare(
        `INSERT INTO health_samples (
          sampled_at_ms, rss_bytes, heap_used_bytes, cpu_user_us, cpu_system_us, event_loop_delay_ms, poll_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sample.sampledAtMs,
        sample.rssBytes,
        sample.heapUsedBytes,
        sample.cpuUserUs,
        sample.cpuSystemUs,
        sample.eventLoopDelayMs,
        sample.pollCount,
      );

    // Enforce age ceiling and row-count retention cap
    const cutoff = sample.sampledAtMs - this.maxAgeMs;
    this.db.prepare('DELETE FROM health_samples WHERE sampled_at_ms < ?').run(cutoff);
    this.db
      .prepare(
        `DELETE FROM health_samples WHERE id NOT IN (
          SELECT id FROM health_samples ORDER BY sampled_at_ms DESC, id DESC LIMIT ?
        )`,
      )
      .run(this.maxSamples);

    return { recorded: true };
  }

  list(limit = 100): HealthSample[] {
    const bounded = Math.max(1, Math.min(limit, this.maxSamples));
    const rows = this.db
      .prepare(
        `SELECT sampled_at_ms, rss_bytes, heap_used_bytes, cpu_user_us, cpu_system_us, event_loop_delay_ms, poll_count
         FROM health_samples ORDER BY sampled_at_ms DESC, id DESC LIMIT ?`,
      )
      .all(bounded) as Array<{
      sampled_at_ms: number;
      rss_bytes: number;
      heap_used_bytes: number;
      cpu_user_us: number;
      cpu_system_us: number;
      event_loop_delay_ms: number;
      poll_count: number;
    }>;
    return rows.map((r) => ({
      sampledAtMs: r.sampled_at_ms,
      rssBytes: r.rss_bytes,
      heapUsedBytes: r.heap_used_bytes,
      cpuUserUs: r.cpu_user_us,
      cpuSystemUs: r.cpu_system_us,
      eventLoopDelayMs: r.event_loop_delay_ms,
      pollCount: r.poll_count,
    }));
  }
}

/**
 * Starts a local-only, unref'd periodic sampler for `serve` (F-103-T01).
 */
export function startLocalHealthSampler(
  store: HealthSampleStore,
  getPollCount: () => number,
  intervalMs = 60_000,
): { stop: () => void; sampleNow: (nowMs?: number) => { recorded: boolean; reason?: 'rate-limited' } } {
  const histogram: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let lastCpu = process.cpuUsage();

  const sampleNow = (nowMs = Date.now()) => {
    const mem = process.memoryUsage();
    const cpuDelta = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    const delayMs = Number((histogram.mean / 1e6).toFixed(2));
    histogram.reset();
    return store.record({
      sampledAtMs: nowMs,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      cpuUserUs: cpuDelta.user,
      cpuSystemUs: cpuDelta.system,
      eventLoopDelayMs: Number.isFinite(delayMs) ? delayMs : 0,
      pollCount: getPollCount(),
    });
  };

  const timer = setInterval(
    () => {
      sampleNow();
    },
    Math.max(100, intervalMs),
  );
  timer.unref();

  return {
    sampleNow,
    stop: () => {
      clearInterval(timer);
      histogram.disable();
    },
  };
}

export interface HealthThresholds {
  readonly rssMb: number;
  readonly eventLoopDelayMs: number;
  readonly linkLatencyMs: number;
  readonly inFlight: number;
  readonly reconnects: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  rssMb: 512,
  eventLoopDelayMs: 100,
  linkLatencyMs: 500,
  inFlight: 10,
  reconnects: 5,
};

export interface HealthWarning {
  readonly key: string;
  readonly kind: 'sample' | 'link';
  readonly metric: keyof HealthThresholds;
  readonly peerId?: string;
  readonly actual: number;
  readonly threshold: number;
  readonly message: string;
}

export interface HealthMetricsSnapshot {
  readonly latestSample: HealthSample | null;
  readonly recentSamples: readonly HealthSample[];
  readonly links: readonly BaseLinkMetrics[];
  readonly thresholds: HealthThresholds;
  readonly warnings: readonly HealthWarning[];
}

const THRESHOLD_LIMITS: Record<keyof HealthThresholds, { min: number; max: number; integer: boolean }> = {
  rssMb: { min: 16, max: 65536, integer: true },
  eventLoopDelayMs: { min: 1, max: 60000, integer: false },
  linkLatencyMs: { min: 1, max: 60000, integer: false },
  inFlight: { min: 1, max: 1000, integer: true },
  reconnects: { min: 1, max: 1000, integer: true },
};

export function validateHealthThresholds(raw: unknown): HealthThresholds {
  if (raw === undefined) return { ...DEFAULT_HEALTH_THRESHOLDS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid health thresholds: expected an object.');
  }
  const rec = raw as Record<string, unknown>;
  const unknown = Object.keys(rec).filter((k) => !(k in THRESHOLD_LIMITS));
  if (unknown.length) throw new Error(`Unknown health threshold(s): ${unknown.join(', ')}.`);
  const out: Record<keyof HealthThresholds, number> = { ...DEFAULT_HEALTH_THRESHOLDS };
  for (const key of Object.keys(THRESHOLD_LIMITS) as (keyof HealthThresholds)[]) {
    if (rec[key] === undefined) continue;
    const val = Number(rec[key]);
    const spec = THRESHOLD_LIMITS[key];
    if (!Number.isFinite(val) || (spec.integer && !Number.isInteger(val)) || val < spec.min || val > spec.max) {
      throw new Error(`Invalid health threshold ${key}: expected ${spec.min}–${spec.max}.`);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Evaluates current service samples and peer link metrics against thresholds,
 * returning one deduplicated warning per crossed metric (and per peer for link metrics).
 */
export function evaluateHealthWarnings(
  sample: HealthSample | null | undefined,
  links: readonly BaseLinkMetrics[],
  thresholds: HealthThresholds,
): HealthWarning[] {
  const warnings = new Map<string, HealthWarning>();
  if (sample) {
    const rssMb = Math.round((sample.rssBytes / (1024 * 1024)) * 10) / 10;
    if (rssMb > thresholds.rssMb) {
      warnings.set('sample:rssMb', {
        key: 'sample:rssMb',
        kind: 'sample',
        metric: 'rssMb',
        actual: rssMb,
        threshold: thresholds.rssMb,
        message: `Memory RSS ${rssMb} MB exceeds ${thresholds.rssMb} MB`,
      });
    }
    if (sample.eventLoopDelayMs > thresholds.eventLoopDelayMs) {
      warnings.set('sample:eventLoopDelayMs', {
        key: 'sample:eventLoopDelayMs',
        kind: 'sample',
        metric: 'eventLoopDelayMs',
        actual: sample.eventLoopDelayMs,
        threshold: thresholds.eventLoopDelayMs,
        message: `Event-loop delay ${sample.eventLoopDelayMs} ms exceeds ${thresholds.eventLoopDelayMs} ms`,
      });
    }
  }
  for (const link of links) {
    const latency = link.lastLatencyMs ?? link.avgLatencyMs;
    if (latency !== null && latency > thresholds.linkLatencyMs) {
      const key = `link:${link.peerId}:linkLatencyMs`;
      if (!warnings.has(key)) {
        warnings.set(key, {
          key,
          kind: 'link',
          metric: 'linkLatencyMs',
          peerId: link.peerId,
          actual: latency,
          threshold: thresholds.linkLatencyMs,
          message: `Link ${link.peerId} latency ${latency} ms exceeds ${thresholds.linkLatencyMs} ms`,
        });
      }
    }
    if (link.inFlight > thresholds.inFlight) {
      const key = `link:${link.peerId}:inFlight`;
      if (!warnings.has(key)) {
        warnings.set(key, {
          key,
          kind: 'link',
          metric: 'inFlight',
          peerId: link.peerId,
          actual: link.inFlight,
          threshold: thresholds.inFlight,
          message: `Link ${link.peerId} has ${link.inFlight} in-flight calls (threshold ${thresholds.inFlight})`,
        });
      }
    }
    if (link.reconnects > thresholds.reconnects) {
      const key = `link:${link.peerId}:reconnects`;
      if (!warnings.has(key)) {
        warnings.set(key, {
          key,
          kind: 'link',
          metric: 'reconnects',
          peerId: link.peerId,
          actual: link.reconnects,
          threshold: thresholds.reconnects,
          message: `Link ${link.peerId} recorded ${link.reconnects} reconnects (threshold ${thresholds.reconnects})`,
        });
      }
    }
  }
  return [...warnings.values()];
}
