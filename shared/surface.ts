/** Declarative contract only: no HTML, scripts, attributes, styles or URLs accepted. */
export const REGISTERED_COMPONENTS = ['nerv-status-card', 'nerv-notice-card'] as const;
export type RegisteredComponent = (typeof REGISTERED_COMPONENTS)[number];

export interface StatusSurface {
  version: 1;
  component: 'nerv-status-card';
  props: { title: string; detail: string; status: 'ok' | 'waiting' | 'error' };
}

export interface NoticeSurface {
  version: 1;
  component: 'nerv-notice-card';
  props: { topic: string; message: string; tone: 'info' | 'warn' | 'success' };
}

export type Surface = StatusSurface | NoticeSurface;

export const statusSurfaceSchema = {
  type: 'object',
  required: ['version', 'component', 'props'],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    component: { const: 'nerv-status-card' },
    props: {
      type: 'object',
      required: ['title', 'detail', 'status'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', maxLength: 120 },
        detail: { type: 'string', maxLength: 500 },
        status: { enum: ['ok', 'waiting', 'error'] },
      },
    },
  },
} as const;

export const noticeSurfaceSchema = {
  type: 'object',
  required: ['version', 'component', 'props'],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    component: { const: 'nerv-notice-card' },
    props: {
      type: 'object',
      required: ['topic', 'message', 'tone'],
      additionalProperties: false,
      properties: {
        topic: { type: 'string', maxLength: 120 },
        message: { type: 'string', maxLength: 500 },
        tone: { enum: ['info', 'warn', 'success'] },
      },
    },
  },
} as const;

export const FORBIDDEN_SURFACE_KEYS = [
  'script',
  'code',
  'action',
  'actions',
  'execute',
  'eval',
  'html',
  'onclick',
  'onload',
  'onerror',
  'href',
  'src',
  'data',
  'handler',
  'javascript',
] as const;

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export type SurfaceValidationResult = { ok: true; surface: Surface } | { ok: false; reason: string };

export function validateSurfaceResult(value: unknown): SurfaceValidationResult {
  if (!record(value)) {
    return { ok: false, reason: 'Surface payload must be a non-null plain object.' };
  }

  // Reject forbidden root keys and executable action/code payloads
  const topKeys = Object.keys(value);
  for (const k of topKeys) {
    if (
      FORBIDDEN_SURFACE_KEYS.includes(k as (typeof FORBIDDEN_SURFACE_KEYS)[number]) ||
      k.startsWith('on') ||
      k.startsWith('data-')
    ) {
      return { ok: false, reason: `Forbidden key or action payload: '${k}' is not permitted.` };
    }
  }

  if (topKeys.length !== 3 || topKeys.some((k) => !['version', 'component', 'props'].includes(k))) {
    return { ok: false, reason: 'Surface must contain exactly [version, component, props] keys.' };
  }

  if (value['version'] !== 1) {
    return { ok: false, reason: `Unsupported surface version: ${String(value['version'])}. Only version 1 is supported.` };
  }

  const comp = value['component'];
  if (typeof comp !== 'string' || !REGISTERED_COMPONENTS.includes(comp as RegisteredComponent)) {
    return { ok: false, reason: `Unregistered component: '${String(comp)}' is not in the allowed catalog.` };
  }

  const p = value['props'];
  if (!record(p)) {
    return { ok: false, reason: 'Surface props must be a plain object.' };
  }

  // Reject forbidden keys inside props
  const propKeys = Object.keys(p);
  for (const k of propKeys) {
    if (
      FORBIDDEN_SURFACE_KEYS.includes(k as (typeof FORBIDDEN_SURFACE_KEYS)[number]) ||
      k.startsWith('on') ||
      k.startsWith('data-')
    ) {
      return { ok: false, reason: `Forbidden prop key: '${k}' is not permitted.` };
    }
  }

  if (comp === 'nerv-status-card') {
    if (propKeys.length !== 3 || propKeys.some((k) => !['title', 'detail', 'status'].includes(k))) {
      return { ok: false, reason: 'Invalid surface props: status card requires exactly [title, detail, status].' };
    }
    if (typeof p['title'] !== 'string' || p['title'].length > 120) {
      return { ok: false, reason: 'Invalid surface props: title must be a string up to 120 characters.' };
    }
    if (typeof p['detail'] !== 'string' || p['detail'].length > 500) {
      return { ok: false, reason: 'Invalid surface props: detail must be a string up to 500 characters.' };
    }
    if (!['ok', 'waiting', 'error'].includes(p['status'] as string)) {
      return { ok: false, reason: "Invalid surface props: status must be one of ['ok', 'waiting', 'error']." };
    }
    return {
      ok: true,
      surface: {
        version: 1,
        component: 'nerv-status-card',
        props: {
          title: p['title'],
          detail: p['detail'],
          status: p['status'] as StatusSurface['props']['status'],
        },
      },
    };
  }

  if (comp === 'nerv-notice-card') {
    if (propKeys.length !== 3 || propKeys.some((k) => !['topic', 'message', 'tone'].includes(k))) {
      return { ok: false, reason: 'Invalid surface props: notice card requires exactly [topic, message, tone].' };
    }
    if (typeof p['topic'] !== 'string' || p['topic'].length > 120) {
      return { ok: false, reason: 'Invalid surface props: topic must be a string up to 120 characters.' };
    }
    if (typeof p['message'] !== 'string' || p['message'].length > 500) {
      return { ok: false, reason: 'Invalid surface props: message must be a string up to 500 characters.' };
    }
    if (!['info', 'warn', 'success'].includes(p['tone'] as string)) {
      return { ok: false, reason: "Invalid surface props: tone must be one of ['info', 'warn', 'success']." };
    }
    return {
      ok: true,
      surface: {
        version: 1,
        component: 'nerv-notice-card',
        props: {
          topic: p['topic'],
          message: p['message'],
          tone: p['tone'] as NoticeSurface['props']['tone'],
        },
      },
    };
  }

  return { ok: false, reason: `Unknown component: ${String(comp)}.` };
}

export function validateSurface(value: unknown): Surface {
  const result = validateSurfaceResult(value);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.surface;
}

export interface SurfaceRejectionEntry {
  timestamp: string;
  reason: string;
  raw: unknown;
}

export const surfaceRejectionLog: SurfaceRejectionEntry[] = [];

export function clearSurfaceRejectionLog(): void {
  surfaceRejectionLog.length = 0;
  if (typeof globalThis !== 'undefined') {
    (globalThis as unknown as { __nervSurfaceRejections?: SurfaceRejectionEntry[] }).__nervSurfaceRejections =
      surfaceRejectionLog;
  }
}

export function logSurfaceRejection(reason: string, raw: unknown): void {
  const entry: SurfaceRejectionEntry = {
    timestamp: new Date().toISOString(),
    reason,
    raw,
  };
  surfaceRejectionLog.push(entry);
  if (typeof globalThis !== 'undefined') {
    (globalThis as unknown as { __nervSurfaceRejections?: SurfaceRejectionEntry[] }).__nervSurfaceRejections =
      surfaceRejectionLog;
  }
  console.warn(`[GenUI:Security] Rejected unauthorized surface payload: ${reason}`, raw);
}
