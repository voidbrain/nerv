import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { validateModels, type Models } from './model.ts';
/**
 * Model setup (F-038): find Ollama on this machine and the models it has, and change which model Misato and Casper use,
 * from the CLI, `init` and the dashboard. Every change goes through validateModels before it is written, so a bad choice
 * never reaches config.json. The cloud key is never handled here: it is typed at a terminal prompt (`models key`).
 */
export const OLLAMA_URL = 'http://127.0.0.1:11434';
export interface LocalModel {
  name: string;
  digest?: string;
  size?: number;
  parameters?: string;
}
export interface Detected {
  reachable: boolean;
  url: string;
  models: LocalModel[];
  error?: string;
}
/** Ollama's own list of installed models (`/api/tags`); nothing is pulled or loaded. */
export async function detectOllama(url = OLLAMA_URL, fetchFn: typeof fetch = fetch): Promise<Detected> {
  try {
    const res = await fetchFn(url.replace(/\/$/, '') + '/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { reachable: false, url, models: [], error: `Ollama answered HTTP ${res.status}.` };
    const body = (await res.json()) as {
      models?: { name?: unknown; digest?: unknown; size?: unknown; details?: { parameter_size?: unknown } }[];
    };
    const models = (body.models ?? [])
      .filter((m) => typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 200)
      .map((m) => ({
        name: m.name as string,
        ...(typeof m.digest === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/i.test(m.digest)
          ? { digest: m.digest.replace(/^sha256:/i, '').toLowerCase() }
          : {}),
        ...(typeof m.size === 'number' ? { size: m.size } : {}),
        ...(typeof m.details?.parameter_size === 'string' ? { parameters: m.details.parameter_size } : {}),
      }));
    return { reachable: true, url, models };
  } catch {
    return {
      reachable: false,
      url,
      models: [],
      error: `No Ollama at ${url}. Install it from https://ollama.com, start it, and pull a model (for example: ollama pull gemma4:12b).`,
    };
  }
}
/** The Ollama server a local route points at (its /v1 endpoint minus /v1), or the default one. */
export function ollamaUrlOf(models: Models): string {
  return models.local ? models.local.baseUrl.replace(/\/v1$/, '') : OLLAMA_URL;
}
/** The largest installed model, by size on disk: a sensible first choice for both roles until the owner picks. */
export function defaultModel(found: LocalModel[]): string | undefined {
  return [...found].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]?.name;
}
export interface ModelChange {
  misato?: { route: 'local' | 'cloud'; model?: string };
  casper?: { model: string };
  consultant?: { model: string } | null;
  cloud?: { enabled: boolean; model?: string };
  localUrl?: string;
}
/** The models settings after a change, validated; a role on a local model that Ollama does not have is refused. */
export function planModels(current: Models, change: ModelChange, installed?: string[]): Models {
  const next: Models = JSON.parse(JSON.stringify(current)) as Models;
  const localModel = (m: string) => {
    if (installed && !installed.includes(m))
      throw new Error(
        installed.length
          ? `Ollama has no model "${m}". Installed: ${installed.join(', ')}.`
          : `Ollama has no models yet. Pull one first, for example: ollama pull qwen2.5:1.5b (small, for a test) or ollama pull gemma4:12b; then: models set misato qwen2.5:1.5b`,
      );
    return m;
  };
  if (change.localUrl !== undefined || ((change.misato?.route === 'local' || change.casper) && !next.local)) {
    const model =
      change.misato?.route === 'local' && change.misato.model
        ? change.misato.model
        : (change.casper?.model ?? next.local?.model);
    if (!model) throw new Error('Pick a local model first.');
    next.local = {
      baseUrl:
        (change.localUrl ?? (next.local ? next.local.baseUrl.replace(/\/v1$/, '') : OLLAMA_URL)).replace(/\/$/, '') +
        '/v1',
      model: next.local?.model ?? localModel(model),
    };
  }
  const roles = { ...(next.roles ?? {}) };
  if (change.misato) {
    if (change.misato.route === 'cloud' && !(change.cloud?.enabled ?? next.cloud?.enabled))
      throw new Error('Turn the cloud route on first (models cloud on), with its key in place (models key).');
    roles.misato = {
      route: change.misato.route,
      ...(change.misato.model
        ? { model: change.misato.route === 'local' ? localModel(change.misato.model) : change.misato.model }
        : {}),
    };
  }
  if (change.casper) roles.casper = { model: localModel(change.casper.model) };
  if (change.consultant === null) delete roles.consultant;
  else if (change.consultant) {
    if (!next.local) throw new Error('The consultant runs on the local route: set a local model first.');
    roles.consultant = { model: localModel(change.consultant.model) };
  }
  if (Object.keys(roles).length) next.roles = roles;
  if (change.cloud)
    next.cloud = {
      provider: 'anthropic',
      enabled: change.cloud.enabled,
      model: change.cloud.model ?? next.cloud?.model ?? 'claude-opus-5-5',
    };
  if (next.roles?.misato?.route === 'cloud' && !next.cloud?.enabled)
    throw new Error('Misato is on the cloud route: move Misato to a local model before turning the cloud route off.');
  return validateModels(next);
}
/** Writes models into config.json, keeping every other setting; validated before anything is written. */
export function writeModels(home: string, models: Models): void {
  const valid = validateModels(models);
  const path = join(home, 'config.json');
  const current = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(path, JSON.stringify({ ...current, models: valid }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}
/** What the CLI and the dashboard show: the settings (never the key, only whether it is there) and what Ollama has. */
export interface ModelSetup {
  models: Models;
  cloudKey: boolean;
  ollama: Detected;
}
/** Which route and model each role really uses, after defaults: what the owner sees and picks from. */
export function effectiveRoles(m: Models): {
  misato: { route: 'local' | 'cloud'; model: string } | null;
  casper: { model: string } | null;
  consultant: { model: string } | null;
} {
  const route = m.roles?.misato?.route ?? (m.local ? 'local' : m.cloud?.enabled ? 'cloud' : undefined);
  const misatoModel = m.roles?.misato?.model ?? (route === 'cloud' ? m.cloud?.model : m.local?.model);
  const casperModel = m.local ? (m.roles?.casper?.model ?? m.local.model) : undefined;
  return {
    misato: route && misatoModel ? { route, model: misatoModel } : null,
    casper: casperModel ? { model: casperModel } : null,
    consultant: m.local && m.roles?.consultant ? { model: m.roles.consultant.model } : null,
  };
}
/** The `models` report: each role, each route, what Ollama has, and the commands to change them. */
export function modelsReport(m: Models, cloudKey: boolean, found: Detected): string {
  const r = effectiveRoles(m);
  return [
    `Misato (planner): ${r.misato ? `${r.misato.route} · ${r.misato.model}` : 'not set'}`,
    `Casper (intent seat, always local): ${r.casper ? r.casper.model : 'not set (no local route): the owner decides every non-Green action'}`,
    `Consultant (advice before Misato plans, local): ${r.consultant ? r.consultant.model : 'off'}`,
    `Local route (S²): ${m.local ? m.local.baseUrl : 'not configured'}`,
    `Cloud route (Umbilical): ${m.cloud?.enabled ? 'on' : 'off'} · ${m.cloud?.model ?? 'claude-opus-5-5'} · key ${cloudKey ? 'saved' : 'missing (models key)'}`,
    found.reachable
      ? `Ollama at ${found.url}: ${found.models.length ? found.models.map((x) => x.name + (x.parameters ? ` (${x.parameters})` : '')).join(', ') : 'no models yet (ollama pull gemma4:12b)'}`
      : `Ollama: ${found.error ?? 'not found'}`,
    '',
    'Change: models set misato MODEL | models set misato cloud [MODEL] | models set casper MODEL | models set consultant MODEL|off | models cloud on|off [MODEL] | models key',
  ].join('\n');
}
/** The model step of `init` (F-038): when nothing is set yet and Ollama is running, both roles start on its largest model. */
export async function setupAtInit(
  home: string,
  current: Models,
  url = OLLAMA_URL,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (current.local || current.cloud) return 'Model routes: already set (see them with: models).';
  const found = await detectOllama(url, fetchFn);
  if (!found.reachable) return `Model routes: none yet. ${found.error} Then run: models`;
  const pick = defaultModel(found.models);
  if (!pick)
    return `Ollama is running at ${found.url} but has no models yet: ollama pull gemma4:12b, then: models set misato gemma4:12b`;
  writeModels(
    home,
    planModels(
      current,
      { misato: { route: 'local', model: pick }, casper: { model: pick } },
      found.models.map((x) => x.name),
    ),
  );
  return `Model routes: Ollama at ${found.url} with ${found.models.length} model(s); Misato and Casper use ${pick}. Change with: models set misato MODEL, models set casper MODEL (or the dashboard's Models panel).`;
}
