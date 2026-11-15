import type { Approval, Decision } from './ledger.ts';

export type PersonaRole = 'misato' | 'gendo';

export interface PersonaConfig {
  enabled: boolean;
  names: Record<PersonaRole, string>;
}

export const defaultPersonas: PersonaConfig = {
  enabled: true,
  names: { misato: 'Misato', gendo: 'Gendo' },
};

const validName = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= 40 && !/[\u0000-\u001f<>]/.test(value);

/** Validates this base's presentation-only persona settings. MAGI seats and policy roles are deliberately absent. */
export function validatePersonas(value: unknown): PersonaConfig {
  const raw = value as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid personas.');
  if (Object.keys(raw).some((key) => !['enabled', 'names'].includes(key)) || typeof raw.enabled !== 'boolean')
    throw new Error('Invalid personas: give enabled and optional names.');
  const names = raw.names as Record<string, unknown> | undefined;
  if (
    names !== undefined &&
    (!names ||
      typeof names !== 'object' ||
      Array.isArray(names) ||
      Object.keys(names).some((key) => !['misato', 'gendo'].includes(key)) ||
      Object.values(names).some((name) => !validName(name)))
  )
    throw new Error('Invalid persona names: misato and gendo are 1–40 printable characters.');
  return {
    enabled: raw.enabled,
    names: {
      misato: validName(names?.misato) ? names.misato.trim() : defaultPersonas.names.misato,
      gendo: validName(names?.gendo) ? names.gendo.trim() : defaultPersonas.names.gendo,
    },
  };
}

export interface HitlDecisionBackend {
  approvals(limit?: number): Approval[] | Promise<Approval[]>;
  decide(
    id: string,
    decision: Decision,
    source?: 'api' | 'dashboard' | 'cli' | 'telegram',
  ):
    | { decision: string; result?: unknown; error?: string }
    | Promise<{ decision: string; result?: unknown; error?: string }>;
}

export interface PersonaHitlDecisionResult {
  readonly speaker: string | null;
  readonly approvalId: string;
  readonly tool: string;
  readonly pattern: string;
  readonly decision: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly summary: string;
}

/** Formats pending HITL approvals grounded strictly in ledger state; neutral when personas are disabled. */
export function formatMisatoPendingHitl(approvals: Approval[], config: PersonaConfig = defaultPersonas): string {
  const speaker = config.enabled ? config.names.misato : null;
  const header = speaker ? `${speaker}: ` : '';
  if (approvals.length === 0) {
    return `${header}No pending approvals.`;
  }
  const lines = approvals.map(
    (a) =>
      `- ${a.id}: ${a.card.tool} (Pattern ${a.card.pattern.toUpperCase()}) — ${a.card.reason} [expires ${a.card.expires}]`,
  );
  return [`${header}${approvals.length} pending approval${approvals.length === 1 ? '' : 's'}:`, ...lines].join('\n');
}

/** Routes a Misato-surfaced HITL approve/reject strictly through the existing backend decision path with audit. */
export async function decideHitlThroughPersona(
  backend: HitlDecisionBackend,
  approvalId: string,
  decision: 'approve' | 'reject',
  options: { persona?: PersonaConfig; source?: 'api' | 'dashboard' | 'cli' | 'telegram' } = {},
): Promise<PersonaHitlDecisionResult> {
  const pending = await backend.approvals(20);
  const match = pending.find((a) => a.id === approvalId);
  if (!match) {
    throw new Error(`No pending HITL approval ${approvalId}.`);
  }
  const outcome = await backend.decide(approvalId, decision, options.source ?? 'api');
  const config = options.persona ?? defaultPersonas;
  const speaker = config.enabled ? config.names.misato : null;
  const prefix = speaker ? `${speaker}: ` : '';
  return {
    speaker,
    approvalId,
    tool: match.card.tool,
    pattern: match.card.pattern,
    decision: outcome.decision,
    ...(outcome.result !== undefined ? { result: outcome.result } : {}),
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    summary: `${prefix}${match.card.tool} (${approvalId}) -> ${outcome.decision}`,
  };
}
