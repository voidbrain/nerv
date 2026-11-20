/** Declarative contract only: no HTML, scripts, attributes, styles or URLs accepted. */
export const REGISTERED_COMPONENTS = [
  'nerv-status-card',
  'nerv-notice-card',
  'nerv-checklist-card',
  'nerv-recipe-card',
] as const;
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

export interface ChecklistSurfaceItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ChecklistSurface {
  version: 1;
  component: 'nerv-checklist-card';
  props: { listId: string; name: string; items: ChecklistSurfaceItem[] };
}

export interface RecipePhoto {
  id: string;
  url: string;
  caption?: string;
  stepIndex?: number | null;
}

export interface RecipeSurface {
  version: 1;
  component: 'nerv-recipe-card';
  props: { title: string; category: string; body: string; working?: string; photos?: RecipePhoto[] };
}

export type Surface = StatusSurface | NoticeSurface | ChecklistSurface | RecipeSurface;

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

export const checklistSurfaceSchema = {
  type: 'object',
  required: ['version', 'component', 'props'],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    component: { const: 'nerv-checklist-card' },
    props: {
      type: 'object',
      required: ['listId', 'name', 'items'],
      additionalProperties: false,
      properties: {
        listId: { type: 'string', maxLength: 120 },
        name: { type: 'string', maxLength: 120 },
        items: {
          type: 'array',
          maxItems: 200,
          items: {
            type: 'object',
            required: ['id', 'text', 'done'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', maxLength: 120 },
              text: { type: 'string', maxLength: 500 },
              done: { type: 'boolean' },
            },
          },
        },
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

  if (comp === 'nerv-checklist-card') {
    if (propKeys.length !== 3 || propKeys.some((k) => !['listId', 'name', 'items'].includes(k))) {
      return {
        ok: false,
        reason: 'Invalid surface props: checklist card requires exactly [listId, name, items].',
      };
    }
    if (typeof p['listId'] !== 'string' || p['listId'].length === 0 || p['listId'].length > 120) {
      return { ok: false, reason: 'Invalid surface props: listId must be a non-empty string up to 120 characters.' };
    }
    if (typeof p['name'] !== 'string' || p['name'].length === 0 || p['name'].length > 120) {
      return { ok: false, reason: 'Invalid surface props: name must be a non-empty string up to 120 characters.' };
    }
    if (!Array.isArray(p['items']) || p['items'].length > 200) {
      return { ok: false, reason: 'Invalid surface props: items must be an array of at most 200 items.' };
    }
    const items: ChecklistSurfaceItem[] = [];
    for (const rawItem of p['items']) {
      if (!record(rawItem)) {
        return { ok: false, reason: 'Invalid surface props: each checklist item must be a plain object.' };
      }
      const itemKeys = Object.keys(rawItem);
      for (const k of itemKeys) {
        if (
          FORBIDDEN_SURFACE_KEYS.includes(k as (typeof FORBIDDEN_SURFACE_KEYS)[number]) ||
          k.startsWith('on') ||
          k.startsWith('data-')
        ) {
          return { ok: false, reason: `Forbidden item key: '${k}' is not permitted.` };
        }
      }
      if (itemKeys.length !== 3 || itemKeys.some((k) => !['id', 'text', 'done'].includes(k))) {
        return {
          ok: false,
          reason: 'Invalid surface props: each checklist item requires exactly [id, text, done].',
        };
      }
      if (typeof rawItem['id'] !== 'string' || rawItem['id'].length === 0 || rawItem['id'].length > 120) {
        return { ok: false, reason: 'Invalid surface props: item id must be a non-empty string up to 120 characters.' };
      }
      if (typeof rawItem['text'] !== 'string' || rawItem['text'].length === 0 || rawItem['text'].length > 500) {
        return { ok: false, reason: 'Invalid surface props: item text must be a non-empty string up to 500 characters.' };
      }
      if (typeof rawItem['done'] !== 'boolean') {
        return { ok: false, reason: 'Invalid surface props: item done must be a boolean.' };
      }
      items.push({ id: rawItem['id'], text: rawItem['text'], done: rawItem['done'] });
    }
    return {
      ok: true,
      surface: {
        version: 1,
        component: 'nerv-checklist-card',
        props: {
          listId: p['listId'],
          name: p['name'],
          items,
        },
      },
    };
  }

  if (comp === 'nerv-recipe-card') {
    const allowedKeys = ['title', 'category', 'body', 'working', 'photos'];
    if (
      propKeys.length < 3 ||
      propKeys.length > 5 ||
      propKeys.some((k) => !allowedKeys.includes(k)) ||
      !('title' in p) ||
      !('category' in p) ||
      !('body' in p)
    ) {
      return {
        ok: false,
        reason: 'Invalid surface props: recipe card requires [title, category, body] and optional [working, photos].',
      };
    }
    if (typeof p['title'] !== 'string' || p['title'].length === 0 || p['title'].length > 160) {
      return { ok: false, reason: 'Invalid surface props: title must be a non-empty string up to 160 characters.' };
    }
    if (typeof p['category'] !== 'string' || p['category'].length === 0 || p['category'].length > 60) {
      return { ok: false, reason: 'Invalid surface props: category must be a non-empty string up to 60 characters.' };
    }
    if (typeof p['body'] !== 'string' || p['body'].length === 0 || p['body'].length > 16_000) {
      return { ok: false, reason: 'Invalid surface props: body must be a non-empty string up to 16000 characters.' };
    }
    if ('working' in p && (typeof p['working'] !== 'string' || p['working'].length > 4000)) {
      return { ok: false, reason: 'Invalid surface props: working must be a string up to 4000 characters.' };
    }
    let photos: RecipePhoto[] | undefined;
    if ('photos' in p && p['photos'] !== undefined) {
      if (!Array.isArray(p['photos']) || p['photos'].length > 20) {
        return { ok: false, reason: 'Invalid surface props: photos must be an array of at most 20 items.' };
      }
      photos = [];
      for (const raw of p['photos']) {
        if (!record(raw) || typeof raw['id'] !== 'string' || typeof raw['url'] !== 'string') {
          return { ok: false, reason: 'Invalid surface props: photo requires string id and url.' };
        }
        if (!/^\/api\/photos\/[A-Za-z0-9-]+$/.test(raw['url'])) {
          return { ok: false, reason: 'Invalid surface props: photo url must be /api/photos/<id>.' };
        }
        if ('caption' in raw && raw['caption'] !== undefined && (typeof raw['caption'] !== 'string' || raw['caption'].length > 200)) {
          return { ok: false, reason: 'Invalid surface props: photo caption must be a string up to 200 characters.' };
        }
        if (
          'stepIndex' in raw &&
          raw['stepIndex'] !== undefined &&
          raw['stepIndex'] !== null &&
          (!Number.isInteger(raw['stepIndex']) || (raw['stepIndex'] as number) < 0)
        ) {
          return { ok: false, reason: 'Invalid surface props: photo stepIndex must be a non-negative integer or null.' };
        }
        photos.push({
          id: raw['id'],
          url: raw['url'],
          ...(typeof raw['caption'] === 'string' && raw['caption'].length > 0 ? { caption: raw['caption'] } : {}),
          ...(raw['stepIndex'] !== undefined ? { stepIndex: raw['stepIndex'] as number | null } : {}),
        });
      }
    }
    return {
      ok: true,
      surface: {
        version: 1,
        component: 'nerv-recipe-card',
        props: {
          title: p['title'],
          category: p['category'],
          body: p['body'],
          ...(typeof p['working'] === 'string' && p['working'].length > 0 ? { working: p['working'] } : {}),
          ...(photos && photos.length > 0 ? { photos } : {}),
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
