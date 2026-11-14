export type PersonaRole = 'misato' | 'gendo';

export interface PersonaConfig {
  enabled: boolean;
  names: Record<PersonaRole, string>;
}

export interface PersonaReply {
  role: PersonaRole;
  name: string;
  text: string;
  sources: readonly string[];
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

/**
 * Adds a conversational face to an already-authoritative, record-grounded answer.
 * The result contains no decision, pattern, capability or tool fields: callers must obtain those from the gate and
 * ledger, and must never feed a PersonaReply back into authorization.
 */
export function personaReply(
  config: PersonaConfig,
  role: PersonaRole,
  grounded: { text: string; sources: readonly string[] },
): PersonaReply | undefined {
  if (!config.enabled) return undefined;
  if (!grounded.text.trim() || grounded.sources.length === 0 || grounded.sources.some((source) => !source.trim()))
    throw new Error('Persona replies require text grounded in at least one record source.');
  return { role, name: config.names[role], text: grounded.text, sources: [...grounded.sources] };
}
