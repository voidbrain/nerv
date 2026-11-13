import { isIP } from 'node:net';
import type { UsageObservation } from './model-usage.ts';
import {
  completeAnthropicCompatible,
  completeOpenAICompatible,
  validateEngineInstances,
  type EngineInstance,
} from './engine-provider.ts';
/**
 * Model routes (F-003). S² is a local OpenAI-compatible endpoint on this machine (Ollama, LM Studio).
 * Umbilical is the Claude cloud route, off until the owner enables it. There is no automatic fallback
 * between routes: local-only text never leaves the machine, and a failed route reports failure.
 */
export type Privacy = 'local-only' | 'owner-bases' | 'any';
export type RouteName = 'local' | 'cloud';
export interface LocalRoute {
  baseUrl: string;
  model: string;
}
export interface CloudRoute {
  provider: 'anthropic';
  model: string;
  enabled: boolean;
}
export interface RemoteInferenceEndpoint {
  baseId: string;
  model: string;
}
export interface RemoteInferenceServe {
  enabled: boolean;
  bases: string[];
  models: string[];
}
export interface RemoteInferenceConfig {
  endpoints?: Record<string, RemoteInferenceEndpoint>;
  allowBases?: string[];
  serve?: RemoteInferenceServe;
}
/** Which route and model each role uses. Casper is local only: it sees the action's arguments, which may be private. */
export interface Roles {
  misato?: { route: RouteName; model?: string; privacy?: Privacy };
  casper?: { model?: string };
  /** F-025 consultants: advice for Misato before it plans, on the local route only; off unless set. */
  consultant?: { model: string };
}
export interface Models {
  local?: LocalRoute;
  cloud?: CloudRoute;
  roles?: Roles;
  engines?: EngineInstance[];
  remote?: RemoteInferenceConfig;
}
export interface Ask {
  prompt: string;
  system?: string;
  privacy: Privacy;
  route?: RouteName;
}
export interface Reply {
  text: string;
  route: RouteName;
  model: string;
  stop: string;
  truncated: boolean;
}
export const MAX_REPLY_BYTES = 16384;
/** Coordinator wait for a brain model call; the route itself gives up 5 s earlier so the brain can answer. */
export const MODEL_TIMEOUT_MS = 120000;
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const BASE_ID = /^[A-Z0-9][A-Z0-9-]{1,15}$/;
const ENDPOINT_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/i;
const PRIVACY_CLASSES: readonly Privacy[] = ['local-only', 'owner-bases', 'any'];
export class ModelError extends Error {}

function extractHost(address: string): string {
  const trimmed = address.trim();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end > 1) return trimmed.slice(1, end);
  }
  const firstColon = trimmed.indexOf(':');
  if (firstColon > 0 && trimmed.indexOf(':', firstColon + 1) === -1) {
    return trimmed.slice(0, firstColon);
  }
  return trimmed;
}

function parseIpv6Hextets(host: string): number[] | null {
  const bare = host.split('%')[0] ?? host;
  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right];
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(p)) return null;
    nums.push(parseInt(p, 16));
  }
  return nums.length === 8 ? nums : null;
}

/** True only for Tailscale CGNAT IPv4 (100.64.0.0/10) or Tailscale ULA IPv6 (fd7a:115c:a1e0::/48). */
export function isTailscaleAddress(address: string): boolean {
  const host = extractHost(address);
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split('.').map(Number);
    return octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
  }
  if (ipVersion === 6) {
    const hextets = parseIpv6Hextets(host);
    return hextets !== null && hextets[0] === 0xfd7a && hextets[1] === 0x115c && hextets[2] === 0xa1e0;
  }
  return false;
}

function validateBaseIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new Error(`Invalid ${label}: expected up to 32 enrolled base IDs.`);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !BASE_ID.test(item))
      throw new Error(`Invalid ${label}: "${String(item)}" is not a valid base ID.`);
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function validateRemoteInference(value: unknown): RemoteInferenceConfig {
  const r = value as Record<string, unknown>;
  if (
    !r ||
    typeof r !== 'object' ||
    Array.isArray(r) ||
    Object.keys(r).length === 0 ||
    Object.keys(r).some((k) => !['endpoints', 'allowBases', 'serve'].includes(k))
  )
    throw new Error('Invalid models.remote: configure endpoints, allowBases and/or serve.');
  const out: RemoteInferenceConfig = {};
  if (r.endpoints !== undefined) {
    const e = r.endpoints as Record<string, unknown>;
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).length > 20)
      throw new Error('Invalid models.remote.endpoints: map of endpoint name to { baseId, model }.');
    const endpoints: Record<string, RemoteInferenceEndpoint> = {};
    for (const [name, raw] of Object.entries(e)) {
      if (!ENDPOINT_NAME.test(name))
        throw new Error(`Invalid models.remote.endpoints.${name}: use letters, digits and dashes.`);
      const ep = raw as Record<string, unknown>;
      if (
        !ep ||
        typeof ep !== 'object' ||
        Array.isArray(ep) ||
        Object.keys(ep).some((k) => !['baseId', 'model'].includes(k)) ||
        typeof ep.baseId !== 'string' ||
        !BASE_ID.test(ep.baseId) ||
        typeof ep.model !== 'string' ||
        !ep.model ||
        ep.model.length > 200
      )
        throw new Error(
          `Invalid models.remote.endpoints.${name}: baseId (enrolled base ID, never a URL) and model are required.`,
        );
      endpoints[name] = { baseId: ep.baseId, model: ep.model };
    }
    out.endpoints = endpoints;
  }
  if (r.allowBases !== undefined) {
    out.allowBases = validateBaseIdList(r.allowBases, 'models.remote.allowBases');
  }
  if (r.serve !== undefined) {
    const s = r.serve as Record<string, unknown>;
    if (
      !s ||
      typeof s !== 'object' ||
      Array.isArray(s) ||
      Object.keys(s).some((k) => !['enabled', 'bases', 'models'].includes(k)) ||
      typeof s.enabled !== 'boolean'
    )
      throw new Error('Invalid models.remote.serve: enabled boolean is required.');
    const bases = s.bases !== undefined ? validateBaseIdList(s.bases, 'models.remote.serve.bases') : [];
    const models: string[] = [];
    if (s.models !== undefined) {
      if (!Array.isArray(s.models) || s.models.length > 32)
        throw new Error('Invalid models.remote.serve.models: expected up to 32 model names.');
      for (const m of s.models) {
        if (typeof m !== 'string' || !m || m.length > 200)
          throw new Error('Invalid models.remote.serve.models: non-empty model name up to 200 chars.');
        if (!models.includes(m)) models.push(m);
      }
    }
    out.serve = { enabled: s.enabled, bases, models };
  }
  return out;
}
export function validateModels(value: unknown): Models {
  if (value === undefined) return {};
  const v = value as Record<string, unknown>;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !['local', 'cloud', 'roles', 'engines', 'remote'].includes(k))
  )
    throw new Error('Invalid models: use local, cloud, roles, engines and remote.');
  const out: Models = {};
  if (v.local !== undefined) {
    const l = v.local as Record<string, unknown>;
    if (
      !l ||
      typeof l !== 'object' ||
      Object.keys(l).some((k) => !['baseUrl', 'model'].includes(k)) ||
      typeof l.baseUrl !== 'string' ||
      typeof l.model !== 'string' ||
      !l.model ||
      l.model.length > 200
    )
      throw new Error('Invalid models.local: baseUrl and model are required.');
    let url: URL;
    try {
      url = new URL(l.baseUrl);
    } catch {
      throw new Error('Invalid models.local.baseUrl.');
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !loopback.has(url.hostname) ||
      url.username ||
      url.password
    ) {
      if (isTailscaleAddress(url.hostname)) {
        throw new Error(
          'models.local.baseUrl must be a loopback address on this machine; use models.remote with an enrolled baseId for Tailscale bases.',
        );
      }
      throw new Error('models.local.baseUrl must be a loopback address on this machine.');
    }
    out.local = { baseUrl: url.href.replace(/\/$/, ''), model: l.model };
  }
  if (v.cloud !== undefined) {
    const c = v.cloud as Record<string, unknown>;
    if (
      !c ||
      typeof c !== 'object' ||
      Object.keys(c).some((k) => !['provider', 'model', 'enabled'].includes(k)) ||
      c.provider !== 'anthropic' ||
      typeof c.enabled !== 'boolean' ||
      (c.model !== undefined && (typeof c.model !== 'string' || !c.model || c.model.length > 200))
    )
      throw new Error('Invalid models.cloud: provider "anthropic" and enabled are required.');
    out.cloud = {
      provider: 'anthropic',
      model: (c.model as string | undefined) ?? 'claude-opus-5-5',
      enabled: c.enabled,
    };
  }
  if (v.roles !== undefined) {
    const r = v.roles as Record<string, unknown>;
    const model = (x: unknown) => x === undefined || (typeof x === 'string' && x.length > 0 && x.length <= 200);
    if (
      !r ||
      typeof r !== 'object' ||
      Array.isArray(r) ||
      Object.keys(r).some((k) => !['misato', 'casper', 'consultant'].includes(k))
    )
      throw new Error('Invalid models.roles: use misato, casper and/or consultant.');
    const roles: Roles = {};
    if (r.misato !== undefined) {
      const m = r.misato as Record<string, unknown>;
      if (
        !m ||
        typeof m !== 'object' ||
        Object.keys(m).some((k) => !['route', 'model', 'privacy'].includes(k)) ||
        !['local', 'cloud'].includes(m.route as string) ||
        !model(m.model) ||
        (m.privacy !== undefined && !PRIVACY_CLASSES.includes(m.privacy as Privacy))
      )
        throw new Error('Invalid models.roles.misato: route local or cloud, optional model and privacy.');
      roles.misato = {
        route: m.route as RouteName,
        ...(m.model ? { model: m.model as string } : {}),
        ...(m.privacy ? { privacy: m.privacy as Privacy } : {}),
      };
    }
    if (r.casper !== undefined) {
      const c = r.casper as Record<string, unknown>;
      if (!c || typeof c !== 'object' || Object.keys(c).some((k) => k !== 'model') || !model(c.model))
        throw new Error('Invalid models.roles.casper: only model, on the local route.');
      roles.casper = { ...(c.model ? { model: c.model as string } : {}) };
    }
    if (r.consultant !== undefined) {
      const c = r.consultant as Record<string, unknown>;
      if (
        !c ||
        typeof c !== 'object' ||
        Object.keys(c).some((k) => k !== 'model') ||
        typeof c.model !== 'string' ||
        !c.model ||
        c.model.length > 200
      )
        throw new Error('Invalid models.roles.consultant: a local model.');
      roles.consultant = { model: c.model };
    }
    out.roles = roles;
  }
  if (v.engines !== undefined) out.engines = validateEngineInstances(v.engines);
  if (v.remote !== undefined) out.remote = validateRemoteInference(v.remote);
  return out;
}
export type InferenceTarget =
  | { kind: 'local'; baseUrl: string; model: string }
  | { kind: 'cloud'; model: string }
  | { kind: 'remote'; endpoint: string; baseId: string; model: string };
export type WorkerTarget = { kind: 'local'; baseId: string } | { kind: 'remote'; baseId: string; tool?: string };
export interface EnrolledBaseCandidate {
  baseId: string;
  status: string;
  address: string;
  online: boolean;
  offers?: readonly string[];
}
export interface OrchestrationRequest {
  privacy: Privacy;
  route?: RouteName;
  endpoint?: string;
  workerBaseId?: string;
  tool?: string;
}
export interface OrchestrationContext {
  selfBaseId: string;
  models: Models;
  hasCloudKey: boolean;
  bases: readonly EnrolledBaseCandidate[];
  localTools?: readonly string[];
}
export interface OrchestrationSelection {
  inference: InferenceTarget;
  worker: WorkerTarget;
}
/**
 * Picks the inference endpoint without side effects (F-006-T02).
 * Never substitutes one route/endpoint for another when the selected target is unavailable or disallowed.
 */
export function selectInferenceTarget(
  req: Pick<OrchestrationRequest, 'privacy' | 'route' | 'endpoint'>,
  ctx: Pick<OrchestrationContext, 'models' | 'hasCloudKey' | 'bases'>,
): InferenceTarget {
  if (req.endpoint !== undefined) {
    if (req.route !== undefined) throw new ModelError('Specify either route or remote endpoint, not both.');
    if (req.privacy === 'local-only') {
      throw new ModelError('Local-only input never goes to a remote inference endpoint.');
    }
    const ep = ctx.models.remote?.endpoints?.[req.endpoint];
    if (!ep) throw new ModelError(`Remote inference endpoint "${req.endpoint}" is not configured.`);
    if (!ctx.models.remote?.allowBases?.includes(ep.baseId)) {
      throw new ModelError(`Base ${ep.baseId} is not granted for remote inference in models.remote.allowBases.`);
    }
    const base = ctx.bases.find((b) => b.baseId === ep.baseId && b.status === 'enrolled');
    if (!base) throw new ModelError(`Remote inference base ${ep.baseId} is not enrolled.`);
    if (!isTailscaleAddress(base.address)) {
      throw new ModelError(`Remote inference base ${ep.baseId} address is not in a Tailscale range.`);
    }
    return { kind: 'remote', endpoint: req.endpoint, baseId: ep.baseId, model: ep.model };
  }
  const cloudReady = !!ctx.models.cloud?.enabled && ctx.hasCloudKey;
  const wanted = req.route ?? (ctx.models.local || req.privacy !== 'any' ? 'local' : 'cloud');
  if (wanted === 'cloud') {
    if (req.privacy === 'local-only') throw new ModelError('Local-only input never goes to the cloud route.');
    if (req.privacy === 'owner-bases') throw new ModelError('Owner-bases input never goes to the cloud route.');
    if (!ctx.models.cloud?.enabled) throw new ModelError('Cloud route (Umbilical) is disabled.');
    if (!cloudReady) throw new ModelError('Cloud route (Umbilical) has no API key.');
    return { kind: 'cloud', model: ctx.models.cloud.model };
  }
  if (!ctx.models.local) throw new ModelError('Local route (S²) is not configured.');
  return { kind: 'local', baseUrl: ctx.models.local.baseUrl, model: ctx.models.local.model };
}
/**
 * Picks the execution worker independently of the inference endpoint (F-006-T02).
 * Never falls back to the local base or another base if the requested worker or capability is unavailable.
 */
export function selectExecutionWorker(
  req: Pick<OrchestrationRequest, 'workerBaseId' | 'tool'>,
  ctx: Pick<OrchestrationContext, 'selfBaseId' | 'bases' | 'localTools'>,
): WorkerTarget {
  if (!req.workerBaseId || req.workerBaseId === ctx.selfBaseId) {
    if (req.tool && ctx.localTools && !ctx.localTools.includes(req.tool)) {
      throw new ModelError(`Local base ${ctx.selfBaseId} does not offer capability "${req.tool}".`);
    }
    return { kind: 'local', baseId: ctx.selfBaseId };
  }
  const base = ctx.bases.find((b) => b.baseId === req.workerBaseId && b.status === 'enrolled');
  if (!base) throw new ModelError(`Execution worker ${req.workerBaseId} is not enrolled.`);
  if (req.tool && !base.offers?.includes(req.tool)) {
    throw new ModelError(`Execution worker ${req.workerBaseId} does not offer capability "${req.tool}".`);
  }
  return { kind: 'remote', baseId: base.baseId, ...(req.tool ? { tool: req.tool } : {}) };
}
/** Selects inference endpoint and execution worker independently; neither falls back. */
export function selectOrchestration(req: OrchestrationRequest, ctx: OrchestrationContext): OrchestrationSelection {
  return {
    inference: selectInferenceTarget(req, ctx),
    worker: selectExecutionWorker(req, ctx),
  };
}
/** Picks the route without side effects. Never substitutes one route for another. */
export function selectRoute(ask: Ask, models: Models, hasKey: boolean): RouteName {
  const picked = selectInferenceTarget(
    { privacy: ask.privacy, ...(ask.route ? { route: ask.route } : {}) },
    { models, hasCloudKey: hasKey, bases: [] },
  );
  return picked.kind === 'cloud' ? 'cloud' : 'local';
}
export interface RouteOptions {
  timeoutMs: number;
  fetch?: typeof fetch;
  cloudBaseUrl?: string;
  observe?: (observation: UsageObservation) => void;
}
export async function complete(
  ask: Ask,
  models: Models,
  key: string | undefined,
  options: RouteOptions,
): Promise<Reply> {
  const route = selectRoute(ask, models, !!key);
  const started = performance.now();
  let observation: UsageObservation = {
    route,
    requestedModel: route === 'local' ? models.local!.model : models.cloud!.model,
    returnedModel: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    durationMs: 0,
    outcome: 'error',
  };
  const observed = {
    ...options,
    observe: (o: UsageObservation) => {
      observation = o;
    },
  };
  try {
    return await (route === 'local'
      ? completeOpenAICompatible(ask, models.local!, { ...observed, route: 'local', routeLabel: 'Local route (S²)' })
      : completeAnthropicCompatible(
          ask,
          { model: models.cloud!.model, ...(options.cloudBaseUrl ? { baseUrl: options.cloudBaseUrl } : {}) },
          key!,
          { ...observed, route: 'cloud', routeLabel: 'Cloud route (Umbilical)' },
        ));
  } finally {
    options.observe?.({ ...observation, durationMs: Math.max(0, Math.round(performance.now() - started)) });
  }
}
/** The routes as one role sees them: its model replaces the route's default model. */
export function forRole(models: Models, role: keyof Roles): Models {
  const pick = models.roles?.[role];
  const route = role === 'misato' ? models.roles?.misato?.route : 'local';
  if (!pick?.model) return models;
  return route === 'cloud'
    ? { ...models, ...(models.cloud ? { cloud: { ...models.cloud, model: pick.model } } : {}) }
    : { ...models, ...(models.local ? { local: { ...models.local, model: pick.model } } : {}) };
}
export function describe(
  models: Models,
  hasKey: boolean,
): Record<RouteName, string> & { roles: Record<keyof Roles, string> } {
  const misato = models.roles?.misato;
  const casperModel = models.roles?.casper?.model ?? models.local?.model;
  return {
    roles: {
      misato: misato
        ? `${misato.route} (${misato.model ?? (misato.route === 'cloud' ? models.cloud?.model : models.local?.model) ?? 'route not configured'})`
        : 'not set',
      casper: models.local
        ? `local (${casperModel})`
        : 'local route not configured: the owner decides every non-Green action',
      consultant: models.roles?.consultant && models.local ? `local (${models.roles.consultant.model})` : 'off',
    },
    local: models.local ? `configured (${models.local.model})` : 'not configured',
    cloud: !models.cloud
      ? 'not configured'
      : !models.cloud.enabled
        ? 'disabled'
        : hasKey
          ? `enabled (${models.cloud.model})`
          : 'enabled, API key missing',
  };
}
