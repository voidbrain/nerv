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
