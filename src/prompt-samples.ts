import type { DatabaseSync } from 'node:sqlite';
import type { ToolDoc } from './misato.ts';
import type { RouteName } from './model.ts';

export interface PromptMetrics {
  readonly route: RouteName;
  readonly promptTokens: number;
  readonly toolSchemaTokens: number;
  readonly toolSchemaShare: number;
}

export interface PromptSample extends PromptMetrics {
  readonly sampledAtMs: number;
}

export interface PromptSampleOptions {
  readonly minIntervalMs?: number;
  readonly maxSamples?: number;
  readonly maxAgeMs?: number;
}

export interface PromptSampleRouteSummary {
  readonly count: number;
  readonly medianPromptTokens: number;
  readonly maxPromptTokens: number;
  readonly medianToolSchemaShare: number;
  readonly maxToolSchemaShare: number;
}

export const PROMPT_SAMPLES_SCHEMA = `
CREATE TABLE IF NOT EXISTS prompt_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sampled_at_ms INTEGER NOT NULL,
  route TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  tool_schema_tokens INTEGER NOT NULL,
  tool_schema_share REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_samples_time ON prompt_samples (sampled_at_ms DESC);
`;

const DEFAULT_MIN_INTERVAL_MS = 1000;
const DEFAULT_MAX_SAMPLES = 2000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimates total prompt tokens and tool-schema share for a single Misato planning call.
 * Measures sizes only; never stores request, memory, or prompt text (F-106-T01).
 */
export function measureMisatoPrompt(
  ask: { readonly route?: RouteName; readonly prompt: string; readonly system?: string },
  tools: readonly ToolDoc[],
): PromptMetrics {
  const systemText = ask.system ?? '';
  const toolSchemaChars = tools.reduce(
    (sum, t) => sum + `- ${t.name} (${t.effect}): ${t.about} Arguments: ${t.args}`.length + 1,
    0,
  );
  const totalChars = systemText.length + ask.prompt.length;
  const promptTokens = Math.max(1, estimateTokens(systemText) + estimateTokens(ask.prompt));
  const toolSchemaTokens = Math.min(promptTokens, Math.ceil(toolSchemaChars / 4));
  const toolSchemaShare = totalChars > 0 ? Math.min(1, Math.round((toolSchemaChars / totalChars) * 10000) / 10000) : 0;
  return {
    route: ask.route ?? 'local',
    promptTokens,
    toolSchemaTokens,
    toolSchemaShare,
  };
}

function medianOf(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Local-only bounded store for Misato prompt size samples (route, estimated tokens, tool-schema share).
 * Enforces a minimum sampling interval per route and strict row/age retention caps (F-106-T01).
 */
export class PromptSampleStore {
  readonly minIntervalMs: number;
  readonly maxSamples: number;
  readonly maxAgeMs: number;
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync, options: PromptSampleOptions = {}) {
    this.db = db;
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
    this.maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
    this.maxAgeMs = Math.max(1000, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
    this.db.exec(PROMPT_SAMPLES_SCHEMA);
  }

  record(sample: PromptSample): { recorded: boolean; reason?: 'rate-limited' } {
    if (this.minIntervalMs > 0) {
      const latest = this.db
        .prepare('SELECT sampled_at_ms FROM prompt_samples WHERE route = ? ORDER BY sampled_at_ms DESC LIMIT 1')
        .get(sample.route) as { sampled_at_ms: number } | undefined;
      if (latest && sample.sampledAtMs - latest.sampled_at_ms < this.minIntervalMs) {
        return { recorded: false, reason: 'rate-limited' };
      }
    }

    this.db
      .prepare(
        `INSERT INTO prompt_samples (
          sampled_at_ms, route, prompt_tokens, tool_schema_tokens, tool_schema_share
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sample.sampledAtMs, sample.route, sample.promptTokens, sample.toolSchemaTokens, sample.toolSchemaShare);

    const cutoff = sample.sampledAtMs - this.maxAgeMs;
    this.db.prepare('DELETE FROM prompt_samples WHERE sampled_at_ms < ?').run(cutoff);
    this.db
      .prepare(
        `DELETE FROM prompt_samples WHERE id NOT IN (
          SELECT id FROM prompt_samples ORDER BY sampled_at_ms DESC, id DESC LIMIT ?
        )`,
      )
      .run(this.maxSamples);

    return { recorded: true };
  }

  list(limit = 50): PromptSample[] {
    const rows = this.db
      .prepare(
        `SELECT sampled_at_ms, route, prompt_tokens, tool_schema_tokens, tool_schema_share
         FROM prompt_samples ORDER BY sampled_at_ms DESC, id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      sampled_at_ms: number;
      route: RouteName;
      prompt_tokens: number;
      tool_schema_tokens: number;
      tool_schema_share: number;
    }>;
    return rows.map((r) => ({
      sampledAtMs: r.sampled_at_ms,
      route: r.route,
      promptTokens: r.prompt_tokens,
      toolSchemaTokens: r.tool_schema_tokens,
      toolSchemaShare: r.tool_schema_share,
    }));
  }

  /** Computes the last 24h median and maximum prompt tokens and tool-schema share per route. */
  summarizeLastDay(nowMs = Date.now()): Record<string, PromptSampleRouteSummary> {
    const since = nowMs - DAY_MS;
    const rows = this.db
      .prepare(
        `SELECT route, prompt_tokens, tool_schema_share
         FROM prompt_samples WHERE sampled_at_ms >= ? ORDER BY route, prompt_tokens`,
      )
      .all(since) as Array<{ route: string; prompt_tokens: number; tool_schema_share: number }>;

    const byRoute = new Map<string, { tokens: number[]; shares: number[] }>();
    for (const r of rows) {
      let bucket = byRoute.get(r.route);
      if (!bucket) {
        bucket = { tokens: [], shares: [] };
        byRoute.set(r.route, bucket);
      }
      bucket.tokens.push(r.prompt_tokens);
      bucket.shares.push(r.tool_schema_share);
    }

    const summary: Record<string, PromptSampleRouteSummary> = {};
    for (const [route, bucket] of byRoute) {
      bucket.tokens.sort((a, b) => a - b);
      bucket.shares.sort((a, b) => a - b);
      summary[route] = {
        count: bucket.tokens.length,
        medianPromptTokens: Math.round(medianOf(bucket.tokens)),
        maxPromptTokens: bucket.tokens[bucket.tokens.length - 1]!,
        medianToolSchemaShare: Math.round(medianOf(bucket.shares) * 10000) / 10000,
        maxToolSchemaShare: bucket.shares[bucket.shares.length - 1]!,
      };
    }
    return summary;
  }
}
