import type { IncomingMessage } from 'node:http';
import { dataHome, readConfig, setUpdatePolicy } from './config.ts';
import { executeManualUpdate, type ManualUpdateDeps, type ManualUpdateResult } from './manual-update.ts';
import type { ServiceHost } from './node-lifecycle-execution.ts';
import type { StoreApi } from './runtime.ts';
import {
  checkUpdateAvailability,
  parseUpdateChannel,
  validateUpdateAvailability,
  type UpdateAvailability,
} from './update-availability.ts';
import {
  defaultAutoUpdatePolicy,
  evaluateAutoUpdate,
  validateAutoUpdatePolicy,
  type AutoUpdateEvaluation,
  type AutoUpdatePolicy,
  type AutoUpdateSchemaCheck,
} from './update-policy.ts';

export interface ServerUpdateOptions {
  base?: { id: string; name: string };
  updateCheck?: (options: { channel: string; refresh: boolean }) => Promise<UpdateAvailability>;
  lifecycleHost?: () => ServiceHost;
  /** B-108: starts the updater as its own OS job; the server runs inside the service it would update. */
  startUpdater?: ManualUpdateDeps['startUpdater'];
  manualUpdate?: (input: { channel?: string; revision?: string }) => Promise<ManualUpdateResult>;
  updatePolicy?: AutoUpdatePolicy;
  saveUpdatePolicy?: (policy: AutoUpdatePolicy) => AutoUpdatePolicy | Promise<AutoUpdatePolicy>;
  checkSchemaSafety?: (revision?: string) => Promise<AutoUpdateSchemaCheck> | AutoUpdateSchemaCheck;
  /** Re-read the saved policy on every use, so `nerv update-policy`, the dashboard and the scheduler agree. */
  readUpdatePolicy?: () => AutoUpdatePolicy;
  /** F-102-T02: hands the scheduler the same cache and in-flight guard the routes use. */
  exposeUpdateControl?: (control: UpdateControl) => void;
}

/** What the scheduled automatic update (F-102-T02) may do, sharing the routes' state. */
export interface UpdateControl {
  readPolicy(): AutoUpdatePolicy;
  check(channel: string): Promise<UpdateAvailability>;
  evaluate(input: { target: string; channel?: string; revision?: string }): Promise<AutoUpdateEvaluation>;
}

export function createUpdateHandlers(params: {
  store: StoreApi;
  commit: string | null;
  options: ServerUpdateOptions;
  readBody: (req: IncomingMessage, limit?: number) => Promise<Record<string, unknown>>;
}) {
  const { store, commit, options, readBody } = params;
  let updateInFlight = false;
  let configuredPolicy = options.updatePolicy ? validateAutoUpdatePolicy(options.updatePolicy) : undefined;
  let lastAutoUpdate: AutoUpdateEvaluation | undefined;
  const readPolicy = (): AutoUpdatePolicy => {
    if (options.readUpdatePolicy) return options.readUpdatePolicy();
    if (configuredPolicy) return configuredPolicy;
    try {
      return readConfig(dataHome()).updatePolicy ?? defaultAutoUpdatePolicy();
    } catch {
      return defaultAutoUpdatePolicy();
    }
  };
  let cachedUpdate: { at: number; channel: string; value: UpdateAvailability } | undefined;
  const UPDATE_CHECK_TTL_MS = 5 * 60_000;
  const resolveUpdate = async (
    channel = parseUpdateChannel(undefined),
    refresh = false,
  ): Promise<UpdateAvailability> => {
    const now = Date.now();
    if (refresh || !cachedUpdate || cachedUpdate.channel !== channel || now - cachedUpdate.at >= UPDATE_CHECK_TTL_MS) {
      const value = validateUpdateAvailability(
        options.updateCheck
          ? await options.updateCheck({ channel, refresh })
          : await checkUpdateAvailability({ channel, runningRevision: commit }),
      );
      cachedUpdate = { at: now, channel, value };
    }
    return cachedUpdate.value;
  };
  const statusUpdate = async (): Promise<UpdateAvailability> => {
    if (cachedUpdate && Date.now() - cachedUpdate.at < UPDATE_CHECK_TTL_MS) return cachedUpdate.value;
    if (options.updateCheck) return resolveUpdate('main', false);
    return checkUpdateAvailability({ runningRevision: commit, offline: true });
  };
  /** One automatic evaluation at a time, for the route and the scheduler alike. */
  const runAutoUpdate = async (input: {
    target: string;
    channel?: string;
    revision?: string;
  }): Promise<AutoUpdateEvaluation> => {
    if (updateInFlight) throw new Error('An update is already in progress.');
    updateInFlight = true;
    try {
      const evaluation = await evaluateAutoUpdate(
        {
          resolveUpdate,
          ...(options.lifecycleHost ? { lifecycleHost: options.lifecycleHost } : {}),
          inService: true,
          ...(options.startUpdater ? { startUpdater: options.startUpdater } : {}),
          ...(options.checkSchemaSafety ? { checkSchemaSafety: options.checkSchemaSafety } : {}),
          countActiveRuns: async () => (await store.sorties(50)).filter((s) => s.closed === null).length,
          countPendingApprovals: async () => (await store.approvals(20)).filter((a) => a.decision === null).length,
        },
        {
          policy: readPolicy(),
          target: input.target,
          ...(input.channel !== undefined ? { channel: input.channel } : {}),
          ...(input.revision !== undefined ? { revision: input.revision } : {}),
        },
      );
      lastAutoUpdate = evaluation;
      return evaluation;
    } finally {
      updateInFlight = false;
    }
  };
  options.exposeUpdateControl?.({
    readPolicy,
    check: (channel) => resolveUpdate(parseUpdateChannel(channel), true),
    evaluate: runAutoUpdate,
  });

  const handleUpdateRoute = async (
    req: IncomingMessage,
    path: string,
    url: URL,
    reply: (status: number, value: unknown) => void,
  ): Promise<boolean> => {
    if (req.method === 'GET' && path === '/api/update') {
      const channel = parseUpdateChannel(url.searchParams.get('channel') ?? undefined);
      const refresh = url.searchParams.get('refresh') === '1';
      reply(200, await resolveUpdate(channel, refresh));
      return true;
    }
    if (req.method === 'GET' && path === '/api/update/policy') {
      reply(200, { policy: readPolicy(), ...(lastAutoUpdate ? { lastAttempt: lastAutoUpdate } : {}) });
      return true;
    }
    if (req.method === 'POST' && path === '/api/update/policy') {
      const value = await readBody(req);
      // An empty selection when enabling means this base on the main channel (the dashboard switch, F-102-T02).
      if (value.enabled === true && Array.isArray(value.channels) && value.channels.length === 0)
        value.channels = ['main'];
      if (value.enabled === true && Array.isArray(value.targets) && value.targets.length === 0)
        value.targets = [options.base?.id ?? 'local'];
      // F-110-T02: a body without a schedule (the dashboard switch) keeps the saved one.
      if (value.schedule === undefined) {
        const saved = readPolicy().schedule;
        if (saved) value.schedule = saved;
      }
      const validated = validateAutoUpdatePolicy(value);
      const nextPolicy: AutoUpdatePolicy =
        validated.enabled && !validated.acceptedAt ? { ...validated, acceptedAt: new Date().toISOString() } : validated;
      if (options.saveUpdatePolicy) {
        configuredPolicy = await options.saveUpdatePolicy(nextPolicy);
      } else if (options.updatePolicy) {
        configuredPolicy = nextPolicy;
      } else {
        configuredPolicy = setUpdatePolicy(dataHome(), nextPolicy);
      }
      reply(200, { policy: configuredPolicy });
      return true;
    }
    if (req.method === 'POST' && path === '/api/update/auto') {
      if (updateInFlight) {
        reply(409, { error: 'An update is already in progress.' });
        return true;
      }
      const value = await readBody(req);
      for (const k of Object.keys(value))
        if (k !== 'target' && k !== 'channel' && k !== 'revision')
          throw new Error(`Unsupported automatic update parameter: ${k}`);
      if (value.target !== undefined && typeof value.target !== 'string')
        throw new Error('Invalid automatic update target.');
      if (value.channel !== undefined && typeof value.channel !== 'string') throw new Error('Invalid update channel.');
      if (value.revision !== undefined && typeof value.revision !== 'string')
        throw new Error('Invalid update revision.');
      const target = value.target ?? options.base?.id ?? 'local';
      reply(
        200,
        await runAutoUpdate({
          target,
          ...(value.channel !== undefined ? { channel: value.channel } : {}),
          ...(value.revision !== undefined ? { revision: value.revision } : {}),
        }),
      );
      return true;
    }
    if (req.method === 'POST' && path === '/api/update/apply') {
      if (updateInFlight) {
        reply(409, { error: 'A manual update is already in progress.' });
        return true;
      }
      const value = await readBody(req);
      for (const k of Object.keys(value))
        if (k !== 'channel' && k !== 'revision') throw new Error(`Unsupported update parameter: ${k}`);
      if (value.channel !== undefined && typeof value.channel !== 'string') throw new Error('Invalid update channel.');
      if (value.revision !== undefined && typeof value.revision !== 'string')
        throw new Error('Invalid update revision.');
      const input = {
        ...(value.channel !== undefined ? { channel: value.channel } : {}),
        ...(value.revision !== undefined ? { revision: value.revision } : {}),
      };
      updateInFlight = true;
      try {
        const result = options.manualUpdate
          ? await options.manualUpdate(input)
          : await executeManualUpdate(
              {
                resolveUpdate,
                ...(options.lifecycleHost ? { lifecycleHost: options.lifecycleHost } : {}),
                inService: true,
                ...(options.startUpdater ? { startUpdater: options.startUpdater } : {}),
              },
              input,
            );
        reply(200, result);
      } finally {
        updateInFlight = false;
      }
      return true;
    }
    return false;
  };

  return { statusUpdate, handleUpdateRoute };
}
