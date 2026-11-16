import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';

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
