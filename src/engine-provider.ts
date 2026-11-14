import type Anthropic from '@anthropic-ai/sdk';
import { tokenCount, type UsageObservation } from './model-usage.ts';
import { MAX_REPLY_BYTES, ModelError, type Ask, type Privacy, type Reply, type RouteName } from './model.ts';

/**
 * Engine/provider contract (F-005-T20 / T08c): decouples inference engines and endpoints
 * from a single hardcoded local/cloud pair so multiple local and remote instances can be
 * registered, probed, selected and invoked through one uniform adapter interface.
 * Ollama is one adapter implementing this contract.
 */

export type EngineLocality = 'local' | 'remote';
export type EngineKind = 'ollama' | 'openai-compatible' | 'anthropic' | (string & {});

export interface EngineInstance {
  id: string;
  provider: EngineKind;
  locality: EngineLocality;
  baseUrl: string;
  model: string;
  enabled?: boolean;
  label?: string;
  apiKey?: string;
}

export interface EngineModel {
  name: string;
  digest?: string;
  size?: number;
  parameters?: string;
}

export interface EngineProbeResult {
  id: string;
  provider: EngineKind;
  locality: EngineLocality;
  url: string;
  reachable: boolean;
  models: EngineModel[];
  error?: string;
}

export interface EngineProbeOptions {
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface EngineCompleteOptions {
  timeoutMs: number;
  fetch?: typeof fetch;
  apiKey?: string;
  observe?: (observation: UsageObservation) => void;
  routeLabel?: string;
  route?: RouteName;
}

export interface EngineProvider {
  readonly kind: EngineKind;
  readonly supportedLocalities: readonly EngineLocality[];
  validateInstance(instance: EngineInstance): EngineInstance;
  probe(instance: EngineInstance, options?: EngineProbeOptions): Promise<EngineProbeResult>;
  complete(ask: Ask, instance: EngineInstance, options: EngineCompleteOptions): Promise<Reply>;
}

const MAX_TOKENS = 4096;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ID_RE = /^[a-zA-Z0-9._-]+$/;

function boundText(text: string): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text);
  if (bytes.length <= MAX_REPLY_BYTES) return { text, truncated: false };
  return {
    text: bytes
      .subarray(0, MAX_REPLY_BYTES)
      .toString('utf8')
      .replace(/\uFFFD$/, ''),
    truncated: true,
  };
}

/** Validates an engine endpoint URL against its declared locality (loopback for local, HTTPS/explicit HTTP for remote). */
export function validateEngineUrl(rawUrl: string, locality: EngineLocality, allowInsecureRemote = false): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid engine baseUrl.');
  }
  if (url.username || url.password) throw new Error('Engine baseUrl must not embed credentials.');
  if (locality === 'local') {
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK_HOSTS.has(url.hostname))
      throw new Error('Local engine baseUrl must be a loopback address on this machine.');
  } else {
    const isHttpAllowed = allowInsecureRemote || LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !(isHttpAllowed && url.protocol === 'http:'))
      throw new Error('Remote engine baseUrl must use https://.');
  }
  return url.href.replace(/\/$/, '');
}

/** What one OpenAI-compatible reply carried, whether it came whole or as a stream of server-sent events. */
interface OpenAIReplyParts {
  model: unknown;
  text: string | null;
  finish: unknown;
  usage: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
}

const MAX_RAW_REPLY_BYTES = 1048576;

/**
 * Reads a streamed `/chat/completions` reply (B-054). `onData` fires on every event, so the caller can tell a route that
 * never answered from one still writing a long reply when the time limit comes.
 */
async function readEventStream(response: Response, label: string, onData: () => void): Promise<OpenAIReplyParts> {
  const parts: OpenAIReplyParts = { model: undefined, text: null, finish: undefined, usage: {} };
  if (!response.body) return parts;
  const decoder = new TextDecoder();
  let buffered = '';
  let bytes = 0;
  const take = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let event: {
      model?: unknown;
      usage?: OpenAIReplyParts['usage'] | null;
      choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
    };
    try {
      event = JSON.parse(data);
    } catch {
      throw new ModelError(`${label} returned invalid JSON.`);
    }
    onData();
    if (typeof event.model === 'string') parts.model = event.model;
    if (event.usage) parts.usage = event.usage;
    const choice = event.choices?.[0];
    if (typeof choice?.delta?.content === 'string') parts.text = (parts.text ?? '') + choice.delta.content;
    if (typeof choice?.finish_reason === 'string') parts.finish = choice.finish_reason;
  };
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    bytes += chunk.byteLength;
    if (bytes > MAX_RAW_REPLY_BYTES) throw new ModelError(`${label} response too large.`);
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    lines.forEach(take);
  }
  take(buffered + decoder.decode());
  return parts;
}

/** Reads a whole (non-streamed) `/chat/completions` reply: a server that ignores `stream` still answers this way. */
async function readWholeReply(response: Response, label: string): Promise<OpenAIReplyParts> {
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_RAW_REPLY_BYTES) throw new ModelError(`${label} response too large.`);
  let body: {
    model?: unknown;
    usage?: OpenAIReplyParts['usage'];
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ModelError(`${label} returned invalid JSON.`);
  }
  const choice = body.choices?.[0];
  return {
    model: body.model,
    text: typeof choice?.message?.content === 'string' ? choice.message.content : null,
    finish: choice?.finish_reason,
    usage: body.usage ?? {},
  };
}

/**
 * Shared OpenAI-compatible `/chat/completions` caller used by Ollama, generic OpenAI-compatible adapters and
 * `completeLocal`. The reply is streamed (B-054): at the time limit, a route that never answered has timed out (an
 * outage), while one still writing has given a reply too long for the limit, which says nothing about the route.
 */
export async function completeOpenAICompatible(
  ask: Ask,
  endpoint: { baseUrl: string; model: string; apiKey?: string },
  options: EngineCompleteOptions,
): Promise<Reply> {
  const route = options.route ?? 'local';
  const label = options.routeLabel ?? 'Local route (S²)';
  const messages = [
    ...(ask.system ? [{ role: 'system', content: ask.system }] : []),
    { role: 'user', content: ask.prompt },
  ];
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = options.apiKey ?? endpoint.apiKey;
  if (key) headers.authorization = `Bearer ${key}`;

  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), options.timeoutMs);
  let answering = false;
  const cutOff = () =>
    new ModelError(
      answering
        ? `${label} reply too long: still being written at the ${Math.round(options.timeoutMs / 1000)} s limit; ask for a shorter answer.`
        : `${label} timed out.`,
    );
  let parts: OpenAIReplyParts;
  try {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(endpoint.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: endpoint.model,
          messages,
          max_tokens: MAX_TOKENS,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: limit.signal,
        redirect: 'error',
      });
    } catch (e) {
      throw limit.signal.aborted || (e instanceof Error && e.name === 'TimeoutError')
        ? cutOff()
        : new ModelError(`${label} unreachable.`);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ModelError(`${label} failed with HTTP ${response.status}.`);
    }
    try {
      parts = /text\/event-stream/i.test(response.headers.get('content-type') ?? '')
        ? await readEventStream(response, label, () => {
            answering = true;
          })
        : await readWholeReply(response, label);
    } catch (e) {
      if (e instanceof ModelError) throw e;
      throw limit.signal.aborted || (e instanceof Error && e.name === 'TimeoutError')
        ? cutOff()
        : new ModelError(`${label} unreachable.`);
    }
  } finally {
    clearTimeout(timer);
  }
  const returnedModel = typeof parts.model === 'string' && parts.model.length <= 200 ? parts.model : null;
  options.observe?.({
    route,
    requestedModel: endpoint.model,
    returnedModel,
    inputTokens: tokenCount(parts.usage.prompt_tokens),
    outputTokens: tokenCount(parts.usage.completion_tokens),
    cacheReadTokens: tokenCount(parts.usage.prompt_tokens_details?.cached_tokens),
    cacheWriteTokens: 0,
    durationMs: 0,
    outcome: parts.text !== null ? 'success' : 'error',
  });
  if (parts.text === null) throw new ModelError(`${label} returned no text.`);
  return {
    ...boundText(parts.text),
    route,
    model: returnedModel ?? endpoint.model,
    stop: typeof parts.finish === 'string' ? parts.finish : 'unknown',
  };
}

/** Shared Anthropic Messages caller used by `anthropicProvider` and `completeCloud`. */
export async function completeAnthropicCompatible(
  ask: Ask,
  endpoint: { model: string; baseUrl?: string },
  key: string,
  options: EngineCompleteOptions,
): Promise<Reply> {
  const label = options.routeLabel ?? 'Cloud route (Umbilical)';
  const { default: SDK } = await import('@anthropic-ai/sdk');
  const client = new SDK({
    apiKey: key,
    maxRetries: 0,
    timeout: options.timeoutMs,
    ...(endpoint.baseUrl ? { baseURL: endpoint.baseUrl } : {}),
  });
  let message: Anthropic.Beta.BetaMessage;
  try {
    // Server-side refusal fallback stays with the same provider; the reply names the model that answered.
    message = await client.beta.messages.create({
      model: endpoint.model,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      ...(ask.system ? { system: ask.system } : {}),
      messages: [{ role: 'user', content: ask.prompt }],
    });
  } catch (e) {
    if (e instanceof SDK.AuthenticationError) throw new ModelError(`${label} rejected the API key.`);
    if (e instanceof SDK.RateLimitError) throw new ModelError(`${label} is rate limited; try later.`);
    if (e instanceof SDK.APIConnectionTimeoutError) throw new ModelError(`${label} timed out.`);
    if (e instanceof SDK.APIConnectionError) throw new ModelError(`${label} unreachable.`);
    if (e instanceof SDK.APIError) throw new ModelError(`${label} failed with HTTP ${e.status ?? 'unknown'}.`);
    throw new ModelError(`${label} failed.`);
  }
  options.observe?.({
    route: options.route ?? 'cloud',
    requestedModel: endpoint.model,
    returnedModel: message.model.length <= 200 ? message.model : null,
    inputTokens: tokenCount(message.usage.input_tokens),
    outputTokens: tokenCount(message.usage.output_tokens),
    cacheReadTokens: tokenCount(message.usage.cache_read_input_tokens),
    cacheWriteTokens: tokenCount(message.usage.cache_creation_input_tokens),
    durationMs: 0,
    outcome: message.stop_reason === 'refusal' ? 'refused' : 'success',
  });
  if (message.stop_reason === 'refusal') throw new ModelError(`${label} declined the request.`);
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return {
    ...boundText(text),
    route: options.route ?? 'cloud',
    model: message.model,
    stop: message.stop_reason ?? 'unknown',
  };
}

function ollamaRootUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function ollamaOpenAiUrl(baseUrl: string): string {
  return `${ollamaRootUrl(baseUrl)}/v1`;
}

/** Ollama engine adapter: probes `/api/tags` and serves OpenAI-compatible completions at `/v1/chat/completions`. */
export const ollamaProvider: EngineProvider = {
  kind: 'ollama',
  supportedLocalities: ['local', 'remote'],
  validateInstance(instance) {
    return {
      ...instance,
      baseUrl: validateEngineUrl(instance.baseUrl, instance.locality),
    };
  },
  async probe(instance, options = {}) {
    const root = ollamaRootUrl(instance.baseUrl);
    const fetchFn = options.fetch ?? fetch;
    const timeoutMs = options.timeoutMs ?? 3000;
    try {
      const response = await fetchFn(`${root}/api/tags`, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      if (!response.ok) {
        return {
          id: instance.id,
          provider: 'ollama',
          locality: instance.locality,
          url: root,
          reachable: false,
          models: [],
          error: `Ollama answered HTTP ${response.status}.`,
        };
      }
      const body = (await response.json()) as {
        models?: { name?: unknown; digest?: unknown; size?: unknown; details?: { parameter_size?: unknown } }[];
      };
      const models: EngineModel[] = (body.models ?? [])
        .filter(
          (m): m is { name: string; digest?: unknown; size?: unknown; details?: { parameter_size?: unknown } } =>
            typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 200,
        )
        .map((m) => ({
          name: m.name,
          ...(typeof m.digest === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/i.test(m.digest)
            ? { digest: m.digest.replace(/^sha256:/i, '').toLowerCase() }
            : {}),
          ...(typeof m.size === 'number' ? { size: m.size } : {}),
          ...(typeof m.details?.parameter_size === 'string' ? { parameters: m.details.parameter_size } : {}),
        }));
      return { id: instance.id, provider: 'ollama', locality: instance.locality, url: root, reachable: true, models };
    } catch {
      return {
        id: instance.id,
        provider: 'ollama',
        locality: instance.locality,
        url: root,
        reachable: false,
        models: [],
        error: `No Ollama at ${root}. Install it from https://ollama.com, start it, and pull a model (for example: ollama pull gemma4:12b).`,
      };
    }
  },
  complete(ask, instance, options) {
    return completeOpenAICompatible(
      ask,
      { baseUrl: ollamaOpenAiUrl(instance.baseUrl), model: instance.model, apiKey: instance.apiKey },
      {
        ...options,
        route: options.route ?? (instance.locality === 'local' ? 'local' : 'cloud'),
        routeLabel: options.routeLabel ?? `Ollama (${instance.label ?? instance.id})`,
      },
    );
  },
};

/** Generic OpenAI-compatible engine adapter (LM Studio, vLLM, llama.cpp server, remote gateways). */
export const openaiCompatibleProvider: EngineProvider = {
  kind: 'openai-compatible',
  supportedLocalities: ['local', 'remote'],
  validateInstance(instance) {
    return {
      ...instance,
      baseUrl: validateEngineUrl(instance.baseUrl, instance.locality),
    };
  },
  async probe(instance, options = {}) {
    const base = instance.baseUrl.replace(/\/+$/, '');
    const fetchFn = options.fetch ?? fetch;
    const timeoutMs = options.timeoutMs ?? 1500;
    const headers: Record<string, string> = {};
    if (instance.apiKey) headers.authorization = `Bearer ${instance.apiKey}`;
    try {
      const response = await fetchFn(`${base}/models`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      if (!response.ok) {
        return {
          id: instance.id,
          provider: 'openai-compatible',
          locality: instance.locality,
          url: base,
          reachable: false,
          models: [],
          error: `Endpoint ${base} returned HTTP ${response.status}.`,
        };
      }
      const body = (await response.json()) as { data?: { id?: unknown }[] };
      const models = (body.data ?? [])
        .filter((m): m is { id: string } => typeof m.id === 'string' && !!m.id)
        .map((m) => ({ name: m.id }));
      return {
        id: instance.id,
        provider: 'openai-compatible',
        locality: instance.locality,
        url: base,
        reachable: true,
        models,
      };
    } catch {
      return {
        id: instance.id,
        provider: 'openai-compatible',
        locality: instance.locality,
        url: base,
        reachable: false,
        models: [],
        error: `Endpoint ${base} is not reachable.`,
      };
    }
  },
  complete(ask, instance, options) {
    return completeOpenAICompatible(
      ask,
      { baseUrl: instance.baseUrl, model: instance.model, apiKey: instance.apiKey },
      {
        ...options,
        route: options.route ?? (instance.locality === 'local' ? 'local' : 'cloud'),
        routeLabel: options.routeLabel ?? `OpenAI-compatible (${instance.label ?? instance.id})`,
      },
    );
  },
};

/** Anthropic remote engine adapter. */
export const anthropicProvider: EngineProvider = {
  kind: 'anthropic',
  supportedLocalities: ['remote'],
  validateInstance(instance) {
    return {
      ...instance,
      baseUrl: validateEngineUrl(instance.baseUrl || 'https://api.anthropic.com', 'remote'),
    };
  },
  async probe(instance) {
    const base = instance.baseUrl || 'https://api.anthropic.com';
    const hasKey = Boolean(instance.apiKey);
    return {
      id: instance.id,
      provider: 'anthropic',
      locality: 'remote',
      url: base,
      reachable: hasKey,
      models: instance.model ? [{ name: instance.model }] : [],
      ...(!hasKey ? { error: 'Anthropic API key is missing.' } : {}),
    };
  },
  complete(ask, instance, options) {
    const key = options.apiKey ?? instance.apiKey;
    if (!key) throw new ModelError(`Anthropic (${instance.label ?? instance.id}) has no API key.`);
    return completeAnthropicCompatible(
      ask,
      { model: instance.model, ...(instance.baseUrl ? { baseUrl: instance.baseUrl } : {}) },
      key,
      {
        ...options,
        route: options.route ?? 'cloud',
        routeLabel: options.routeLabel ?? `Anthropic (${instance.label ?? instance.id})`,
      },
    );
  },
};

export interface EngineSelectionCriteria {
  id?: string;
  locality?: EngineLocality;
  provider?: EngineKind;
  privacy?: Privacy;
}

/** Registry of inference engine adapters, supporting multiple local and remote instances. */
export class EngineRegistry {
  private readonly providers = new Map<string, EngineProvider>();

  constructor(initial: readonly EngineProvider[] = []) {
    for (const provider of initial) this.register(provider);
  }

  register(provider: EngineProvider): void {
    if (!provider.kind || this.providers.has(provider.kind))
      throw new Error(`Engine provider "${provider.kind}" is already registered or invalid.`);
    this.providers.set(provider.kind, provider);
  }

  get(kind: string): EngineProvider | undefined {
    return this.providers.get(kind);
  }

  require(kind: string): EngineProvider {
    const provider = this.providers.get(kind);
    if (!provider) throw new ModelError(`Unknown engine provider "${kind}".`);
    return provider;
  }

  list(): readonly EngineProvider[] {
    return [...this.providers.values()];
  }

  async probeAll(instances: readonly EngineInstance[], options?: EngineProbeOptions): Promise<EngineProbeResult[]> {
    return Promise.all(
      instances.map((instance) => {
        const provider = this.get(instance.provider);
        if (!provider) {
          return Promise.resolve({
            id: instance.id,
            provider: instance.provider,
            locality: instance.locality,
            url: instance.baseUrl,
            reachable: false,
            models: [],
            error: `Unknown engine provider "${instance.provider}".`,
          });
        }
        return provider.probe(instance, options);
      }),
    );
  }

  selectInstance(instances: readonly EngineInstance[], criteria: EngineSelectionCriteria = {}): EngineInstance {
    const enabled = instances.filter((i) => i.enabled !== false);
    if (criteria.privacy === 'local-only' && criteria.locality === 'remote')
      throw new ModelError('Local-only input never goes to a remote engine.');
    const candidates = enabled.filter((i) => {
      if (criteria.id && i.id !== criteria.id) return false;
      if (criteria.provider && i.provider !== criteria.provider) return false;
      if (criteria.locality && i.locality !== criteria.locality) return false;
      if (criteria.privacy === 'local-only' && i.locality !== 'local') return false;
      return true;
    });
    const picked = candidates[0];
    if (!picked) {
      if (criteria.id) {
        const byId = enabled.find((i) => i.id === criteria.id);
        if (byId && criteria.privacy === 'local-only' && byId.locality === 'remote')
          throw new ModelError('Local-only input never goes to a remote engine.');
      }
      throw new ModelError('No matching enabled engine instance is configured.');
    }
    return picked;
  }

  async complete(ask: Ask, instance: EngineInstance, options: EngineCompleteOptions): Promise<Reply> {
    if (instance.enabled === false) throw new ModelError(`Engine instance "${instance.id}" is disabled.`);
    if (ask.privacy === 'local-only' && instance.locality === 'remote')
      throw new ModelError('Local-only input never goes to a remote engine.');
    return this.require(instance.provider).complete(ask, instance, options);
  }
}

export const defaultEngineRegistry = new EngineRegistry([ollamaProvider, openaiCompatibleProvider, anthropicProvider]);

/** Validates one engine instance against its registered provider adapter. */
export function validateEngineInstance(raw: unknown, registry: EngineRegistry = defaultEngineRegistry): EngineInstance {
  const v = raw as Record<string, unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid engine instance.');
  const allowed = new Set(['id', 'provider', 'locality', 'baseUrl', 'model', 'enabled', 'label', 'apiKey']);
  if (Object.keys(v).some((k) => !allowed.has(k))) throw new Error('Invalid engine instance fields.');
  if (typeof v.id !== 'string' || !v.id || v.id.length > 100 || !ID_RE.test(v.id))
    throw new Error('Invalid engine instance id.');
  if (typeof v.provider !== 'string' || !v.provider) throw new Error('Invalid engine instance provider.');
  const adapter = registry.get(v.provider);
  if (!adapter) throw new Error(`Unknown engine provider "${v.provider}".`);
  if (v.locality !== 'local' && v.locality !== 'remote')
    throw new Error('Invalid engine instance locality: use "local" or "remote".');
  if (!adapter.supportedLocalities.includes(v.locality))
    throw new Error(`Engine provider "${v.provider}" does not support "${v.locality}" locality.`);
  if (typeof v.baseUrl !== 'string' || !v.baseUrl) throw new Error('Invalid engine instance baseUrl.');
  if (typeof v.model !== 'string' || !v.model || v.model.length > 200)
    throw new Error('Invalid engine instance model.');
  if (v.enabled !== undefined && typeof v.enabled !== 'boolean')
    throw new Error('Invalid engine instance enabled flag.');
  if (v.label !== undefined && (typeof v.label !== 'string' || v.label.length > 120))
    throw new Error('Invalid engine instance label.');
  if (v.apiKey !== undefined && typeof v.apiKey !== 'string') throw new Error('Invalid engine instance apiKey.');

  return adapter.validateInstance({
    id: v.id,
    provider: v.provider,
    locality: v.locality,
    baseUrl: v.baseUrl,
    model: v.model,
    enabled: v.enabled ?? true,
    ...(v.label !== undefined ? { label: v.label } : {}),
    ...(v.apiKey !== undefined ? { apiKey: v.apiKey } : {}),
  });
}

/** Validates an array of engine instances and rejects duplicate instance ids. */
export function validateEngineInstances(
  raw: unknown,
  registry: EngineRegistry = defaultEngineRegistry,
): EngineInstance[] {
  if (!Array.isArray(raw)) throw new Error('Invalid engine instances: expected an array.');
  const seen = new Set<string>();
  return raw.map((item) => {
    const validated = validateEngineInstance(item, registry);
    if (seen.has(validated.id)) throw new Error(`Duplicate engine instance id "${validated.id}".`);
    seen.add(validated.id);
    return validated;
  });
}
