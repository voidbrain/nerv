import { AsyncLocalStorage } from 'node:async_hooks';
import type { UsageObservation } from './model-usage.ts';
const accounting = new AsyncLocalStorage<{ observation: UsageObservation | null }>();
import { connect } from 'node:net';
import { dispatchRpc, MAX_FRAME_BYTES, READY, RpcFault } from './rpc.ts';
import { readConfig, readModelKey, readScrolls } from './config.ts';
import { resolvePilotInference, type Stage } from './pilots.ts';
import { defaultPolicy } from './policy.ts';
import {
  complete,
  describe,
  forRole,
  ModelError,
  MODEL_TIMEOUT_MS,
  selectRoute,
  type Ask,
  type Models,
  type Privacy,
  type Reply,
  type RouteName,
} from './model.ts';
import { RouteWatch, describeChange, type RouteChange } from './route-health.ts';
import { ModelBudget } from './model-budget.ts';
import { casperAsk, parseCasper, type CasperInput } from './casper.ts';
import {
  consultantAsk,
  parseConsult,
  misatoAsk,
  parseAdvice,
  parsePlan,
  remoteToolDoc,
  type ExistingReminder,
  type RemoteOffer,
  type Recalled,
  type Step,
  type ToolDoc,
  type Turn,
} from './misato.ts';
import { toolDocs } from './executors.ts';
import { digestAsk, factLimit, parseDigest, type Exchange } from './instrumentality.ts';
// Execution boundary: model routes, the Casper seat and Misato's planning step. It plans and reviews; it never executes a tool.
// The data home arrives as argv; the cloud key is read here from its private file, never passed in env or argv.
const home = process.argv[2];
let models: Models = {};
let key: string | undefined;
let timeZone = 'Europe/Rome';
let language: 'it' | 'en' = 'en';
let configError: string | undefined;
let loaded = false;
const modelBudget = new ModelBudget();
/** Reads the model settings and the cloud key. A failed reload keeps the settings that last worked, so a typo never takes the brain down. */
function load(): { error?: string; kept?: boolean } {
  if (!home) return {};
  try {
    const config = readConfig(home);
    const nextKey = readModelKey(home);
    models = config.models;
    modelBudget.configure(models.concurrency);
    timeZone = config.timeZone;
    language = config.language;
    key = nextKey;
    configError = undefined;
    loaded = true;
    return {};
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Invalid model configuration.';
    if (!loaded) configError = error;
    return { error, kept: loaded };
  }
}
// Dummy Plug (F-030): each route's state from real calls and a probe of the local route; changes go to the service log.
const watch = new RouteWatch();
const note = (c: RouteChange | undefined) => {
  const line = c && describeChange(c);
  if (line) console.error(line);
};
const configured = () =>
  watch.configure({ local: !!models.local, cloud: !!models.cloud?.enabled && !!key }).forEach(note);
/** complete() with the outcome recorded against the route it used; a configuration error (no route) is not an outage. */
async function run(ask: Ask, m: Models): Promise<Reply> {
  let route;
  try {
    route = selectRoute(ask, m, !!key);
  } catch {
    return complete(ask, m, key, {
      timeoutMs: MODEL_TIMEOUT_MS - 5000,
      observe: (o) => {
        const active = accounting.getStore();
        if (active) active.observation = o;
      },
    });
  }
  const modelName = route === 'local' ? m.local?.model : m.cloud?.model;
  const lease = modelName ? await modelBudget.acquire(modelName) : undefined;
  try {
    const reply = await complete(ask, m, key, {
      timeoutMs: MODEL_TIMEOUT_MS - 5000,
      observe: (o) => {
        const active = accounting.getStore();
        if (active) active.observation = o;
      },
    });
    note(watch.record(route, true));
    return reply;
  } catch (e) {
    if (e instanceof ModelError) note(watch.record(route, false, e.message));
    throw e;
  } finally {
    lease?.release();
  }
}
/** A cheap reachability check of the local route: a TCP connection opened and closed, no request and no model call.
 A reachable server that answers badly is caught by the next real call. */
function probe(): Promise<void> {
  const local = models.local;
  if (!local) return Promise.resolve();
  const url = new URL(local.baseUrl);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return new Promise((done) => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port });
    let settled = false;
    const end = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      note(watch.record('local', ok, error));
      done();
    };
    socket.setTimeout(3000, () => end(false, 'Local route (S²) timed out.'));
    socket.once('connect', () => end(true));
    socket.once('error', () => end(false, 'Local route (S²) unreachable.'));
  });
}
load();
configured();
void probe();
setInterval(() => {
  void probe();
}, 60_000).unref();
process.on('message', (value: unknown) => {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_FRAME_BYTES) return;
  void dispatchRpc(value, async (method, params) => {
    const tracked = [
      'model.complete',
      'misato.step',
      'casper.verdict',
      'consultant.advise',
      'instrumentality.digest',
    ].includes(method);
    const context: { observation: UsageObservation | null } = { observation: null };
    const execute = async () => {
      if (method === 'runtime.ping')
        return {
          role: 'brain',
          pid: process.pid,
          models: configError ? { error: configError } : describe(models, !!key),
          routes: watch.snapshot(),
          agentLoop: 'not implemented',
        };
      if (method === 'models.reload') {
        const result = load();
        configured();
        void probe();
        return { ...result, models: configError ? { error: configError } : describe(models, !!key) };
      }
      if (method === 'model.complete') {
        if (configError) throw new RpcFault(-32010, configError);
        try {
          return await run(params as unknown as Ask, models);
        } catch (e) {
          throw new RpcFault(-32010, e instanceof ModelError ? e.message : 'Model route failed.');
        }
      }
      if (method === 'misato.step') {
        // One planning turn. The route is the owner's choice for Misato; without one, local when configured.
        if (configError) return { error: configError };
        const proactive = params.watch as { readOnly: boolean; model?: string } | undefined;
        const route = proactive
          ? 'local'
          : (models.roles?.misato?.route ?? (models.local ? 'local' : models.cloud?.enabled ? 'cloud' : undefined));
        if (!route)
          return {
            error:
              'No model route for Misato: add models.local (or enable models.cloud) in config.json, then run nerv reload. See docs/INSTALL.md, section "Model routes".',
          };
        const remote = Array.isArray(params.remote) ? (params.remote as RemoteOffer[]) : [];
        const ask = misatoAsk(
          {
            ...(params.clarification === true ? { clarification: true } : {}),
            request: params.request as string,
            history: params.history as Step[],
            tools: [
              ...toolDocs.filter((t) => !proactive?.readOnly || t.effect === 'read'),
              ...((params.external as ToolDoc[] | undefined) ?? []),
              ...(remote.length ? [remoteToolDoc(remote)] : []),
            ],
            now: new Date().toISOString(),
            timeZone,
            ...(params.context ? { context: params.context as Turn[] } : {}),
            ...(params.memory ? { memory: params.memory as Recalled[] } : {}),
            ...(Array.isArray(params.reminders) ? { reminders: params.reminders as ExistingReminder[] } : {}),
            ...(Array.isArray(params.bases) ? { bases: params.bases as { id: string; name: string }[] } : {}),
            ...(typeof params.advice === 'string' ? { advice: params.advice } : {}),
            ...(params.language === 'it' || params.language === 'en' ? { language: params.language } : {}),
          },
          route,
        );
        try {
          const on =
            proactive && proactive.model && models.local
              ? { ...models, local: { ...models.local, model: proactive.model } }
              : forRole(models, 'misato');
          const reply = await run(ask, on);
          const plan = parsePlan(reply.text);
          return plan ? { plan, model: reply.model } : { invalid: true, model: reply.model };
        } catch (e) {
          return { error: e instanceof ModelError ? e.message : 'Model route failed.' };
        }
      }
      if (method === 'consultant.advise') {
        // F-025: advice before Misato plans, on the consultant's local model; none when no consultant is set.
        // F-045: a specialist pilot chosen by the coordinator advises on its own model; cloud/other-provider only when Scrolls and stage allow.
        const pilot = params.pilot as
          | {
              id?: string;
              name: string;
              domain: string;
              model: string;
              route?: RouteName;
              provider?: string;
              stage?: Stage;
            }
          | undefined;
        const pick = models.roles?.consultant;
        if (configError || (!pilot && (!models.local || !pick))) return { advice: null };
        let on: Models;
        let askRoute: RouteName = 'local';
        let askPrivacy: Privacy = 'local-only';
        if (pilot) {
          const policy = home ? readScrolls(home).policy : defaultPolicy;
          const trust = params.tainted ? 'tainted' : 'trusted';
          const privacy = (params.privacy as Privacy | undefined) ?? 'local-only';
          const resolved = resolvePilotInference(
            {
              id: pilot.id ?? 'specialist',
              stage: pilot.stage ?? 'prototype',
              model: pilot.model,
              ...(pilot.route ? { route: pilot.route } : {}),
              ...(pilot.provider ? { provider: pilot.provider } : {}),
            },
            models,
            policy,
            { trust, privacy, hasCloudKey: Boolean(key) },
          );
          if (!resolved.allowed || !resolved.models)
            return { advice: null, error: resolved.reason ?? 'Pilot route disallowed.' };
          on = resolved.models;
          askRoute = resolved.route;
          if (askRoute === 'cloud') askPrivacy = 'any';
        } else {
          on = forRole(models, 'consultant');
        }
        const baseAsk = consultantAsk(
          params.request as string,
          (params.context as Turn[] | undefined) ?? [],
          pilot,
          (params.bases as { id: string; name: string }[] | undefined) ?? [],
          (params.tools as { name: string; about: string }[] | undefined) ?? [],
          params.previousAdvice as string | undefined,
        );
        try {
          const reply = await run({ ...baseAsk, route: askRoute, privacy: askPrivacy }, on);
          if (pilot) {
            const advice = parseAdvice(reply.text);
            return advice ? { advice, model: reply.model } : { advice: null };
          }
          const c = parseConsult(reply.text);
          return {
            advice: c.advice ?? null,
            ...(c.advice ? { model: reply.model } : {}),
            ...(c.domain ? { domain: c.domain } : {}),
          };
        } catch (e) {
          return { advice: null, error: e instanceof ModelError ? e.message : 'Consultant failed.' };
        }
      }
      if (method === 'instrumentality.digest') {
        // Same route and model as Misato: the digest reads the owner's own conversations.
        if (configError) return { error: configError };
        const route =
          models.roles?.misato?.route ?? (models.local ? 'local' : models.cloud?.enabled ? 'cloud' : undefined);
        if (!route) return { error: "No model route for Instrumentality (it uses Misato's)." };
        try {
          const reply = await run(
            digestAsk(params.exchanges as Exchange[], language, route),
            forRole(models, 'misato'),
          );
          const digest = parseDigest(reply.text, factLimit((params.exchanges as Exchange[]).length));
          return digest ? { digest } : { error: 'The digest reply was not readable.' };
        } catch (e) {
          return { error: e instanceof ModelError ? e.message : 'Model route failed.' };
        }
      }
      if (method === 'casper.verdict') {
        // No verdict is a valid answer: the gate then asks the owner. The reason says why, for the approval card.
        if (configError) return { verdict: null, error: configError };
        try {
          const reply = await run(casperAsk(params as unknown as CasperInput), forRole(models, 'casper'));
          const verdict = parseCasper(reply.text);
          return verdict ? { verdict } : { verdict: null, error: 'Casper reply was not a readable verdict.' };
        } catch (e) {
          return { verdict: null, error: e instanceof ModelError ? e.message : 'Model route failed.' };
        }
      }
      throw new RpcFault(-32601, 'Method not found.');
    };
    if (!tracked) return execute();
    return accounting.run(context, async () => {
      try {
        return { value: await execute(), accounting: context.observation };
      } catch (e) {
        return { failure: e instanceof RpcFault ? e.message : 'Model route failed.', accounting: context.observation };
      }
    });
  }).then((reply) => {
    if (reply && process.connected) process.send?.(reply);
  });
});
function stop() {
  if (process.connected) process.disconnect();
}
process.on('disconnect', () => {
  process.exitCode = 0;
});
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.send?.(READY);
