import type { OrchestrationRequest } from './model.ts';

export type PlacementId = 'P2' | 'P3' | 'P4';

export interface PlacementProbe {
  placement: PlacementId;
  prompt: string;
  endpoint?: string;
  waitBudgetMs?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export function placementProbe(value: unknown): {
  placement: PlacementId;
  orchestration: OrchestrationRequest;
  ask: { prompt: string; maxTokens?: number; temperature: number };
  timeoutMs: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a placement probe object.');
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (key) => !['placement', 'prompt', 'endpoint', 'waitBudgetMs', 'timeoutMs', 'maxOutputTokens'].includes(key),
    )
  )
    throw new Error('Unknown placement probe field.');
  if (!['P2', 'P3', 'P4'].includes(String(v.placement))) throw new Error('placement must be P2, P3 or P4.');
  if (typeof v.prompt !== 'string' || !v.prompt.trim() || v.prompt.length > 8_192)
    throw new Error('prompt must contain 1–8192 characters.');
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
      maxTotalTokens: maxOutputTokens * 2,
      maxDelegations: 1,
      delegationDepth: 0,
    },
    ask: { prompt: v.prompt, maxTokens: maxOutputTokens, temperature: 0 },
    timeoutMs,
  };
}
