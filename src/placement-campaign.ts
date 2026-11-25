import { WORKER_MAX_INFER_PROMPT_BYTES, WORKER_MAX_INFER_SYSTEM_BYTES, type OrchestrationRequest } from './model.ts';

/** Room for a probe body with the largest prompt and system message under ordinary JSON escaping; a larger body is refused before parsing. */
export const PLACEMENT_PROBE_BODY_BYTES = 2 * (WORKER_MAX_INFER_PROMPT_BYTES + WORKER_MAX_INFER_SYSTEM_BYTES) + 4096;

/**
 * Tokens a chat template may add around the probe's messages (role markers, special tokens).
 * With the byte limits above, the largest probe's total budget is exactly the orchestration ceiling of 65,536.
 */
export const PLACEMENT_PROBE_TEMPLATE_TOKENS = 4096;

export type PlacementId = 'P2' | 'P3' | 'P4';

export interface PlacementProbe {
  placement: PlacementId;
  prompt: string;
  system?: string;
  endpoint?: string;
  waitBudgetMs?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export function placementProbe(value: unknown): {
  placement: PlacementId;
  orchestration: OrchestrationRequest;
  ask: { prompt: string; system?: string; maxTokens?: number; temperature: number };
  timeoutMs: number;
  /** How long the HTTP request may stay open: a concurrency lease and the inference are each bounded by timeoutMs, plus the endpoint wait and a margin. */
  requestBudgetMs: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a placement probe object.');
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (key) =>
        !['placement', 'prompt', 'system', 'endpoint', 'waitBudgetMs', 'timeoutMs', 'maxOutputTokens'].includes(key),
    )
  )
    throw new Error('Unknown placement probe field.');
  if (!['P2', 'P3', 'P4'].includes(String(v.placement))) throw new Error('placement must be P2, P3 or P4.');
  // The limits are the remote inference contract's, in UTF-8 bytes, so a probe that passes here also fits WorkerLink.
  if (
    typeof v.prompt !== 'string' ||
    !v.prompt.trim() ||
    Buffer.byteLength(v.prompt, 'utf8') > WORKER_MAX_INFER_PROMPT_BYTES
  )
    throw new Error(`prompt must be non-empty text of at most ${WORKER_MAX_INFER_PROMPT_BYTES} bytes.`);
  if (
    v.system !== undefined &&
    (typeof v.system !== 'string' ||
      !v.system.trim() ||
      Buffer.byteLength(v.system, 'utf8') > WORKER_MAX_INFER_SYSTEM_BYTES)
  )
    throw new Error(`system must be non-empty text of at most ${WORKER_MAX_INFER_SYSTEM_BYTES} bytes.`);
  const placement = v.placement as PlacementId;
  const integer = (
    name: 'waitBudgetMs' | 'timeoutMs' | 'maxOutputTokens',
    fallback: number,
    min: number,
    max: number,
  ) => {
    const candidate = v[name] ?? fallback;
    if (!Number.isSafeInteger(candidate) || (candidate as number) < min || (candidate as number) > max)
      throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    return candidate as number;
  };
  const maxOutputTokens = integer('maxOutputTokens', 512, 1, 4096);
  const timeoutMs = integer('timeoutMs', placement === 'P4' ? 20_000 : 120_000, 1_000, 120_000);
  const waitBudgetMs = integer('waitBudgetMs', placement === 'P4' ? 5_000 : 0, 0, 120_000);
  // B-131: the runtime counts input and output tokens against maxTotalTokens. Every model token encodes at least one
  // UTF-8 byte of text, so the probe's own bytes bound its input; the budget covers that input before anything is
  // sent, and a reply reporting more is still refused.
  const inputBound =
    Buffer.byteLength(v.prompt, 'utf8') +
    (v.system === undefined ? 0 : Buffer.byteLength(v.system as string, 'utf8')) +
    PLACEMENT_PROBE_TEMPLATE_TOKENS;
  const endpoint = v.endpoint ?? 'mac';
  if (placement !== 'P2' && (typeof endpoint !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(endpoint)))
    throw new Error('endpoint must be a configured endpoint name.');
  return {
    placement,
    orchestration: {
      privacy: placement === 'P2' ? 'local-only' : 'owner-bases',
      ...(placement === 'P2' ? { route: 'local' as const } : { endpoint: endpoint as string }),
      waitBudgetMs,
      maxAttempts: 1,
      maxOutputTokens,
      maxTotalTokens: inputBound + maxOutputTokens,
      maxDelegations: 1,
      delegationDepth: 0,
    },
    ask: {
      prompt: v.prompt,
      ...(v.system !== undefined ? { system: v.system as string } : {}),
      maxTokens: maxOutputTokens,
      temperature: 0,
    },
    timeoutMs,
    requestBudgetMs: 2 * timeoutMs + waitBudgetMs + 5_000,
  };
}
