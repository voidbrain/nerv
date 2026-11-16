import type { IncomingMessage } from 'node:http';
import { dataHome, readConfig, setUpdatePolicy } from './config.ts';
import { executeManualUpdate, type ManualUpdateResult } from './manual-update.ts';
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
  manualUpdate?: (input: { channel?: string; revision?: string }) => Promise<ManualUpdateResult>;
  updatePolicy?: AutoUpdatePolicy;
  saveUpdatePolicy?: (policy: AutoUpdatePolicy) => AutoUpdatePolicy | Promise<AutoUpdatePolicy>;
  checkSchemaSafety?: (revision?: string) => Promise<AutoUpdateSchemaCheck> | AutoUpdateSchemaCheck;
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
      updateInFlight = true;
      try {
        const evaluation = await evaluateAutoUpdate(
          {
            resolveUpdate,
            ...(options.lifecycleHost ? { lifecycleHost: options.lifecycleHost } : {}),
            ...(options.checkSchemaSafety ? { checkSchemaSafety: options.checkSchemaSafety } : {}),
            countActiveRuns: async () => (await store.sorties(50)).filter((s) => s.closed === null).length,
            countPendingApprovals: async () => (await store.approvals(50)).filter((a) => a.decision === null).length,
          },
          {
            policy: readPolicy(),
            target,
            ...(value.channel !== undefined ? { channel: value.channel } : {}),
            ...(value.revision !== undefined ? { revision: value.revision } : {}),
          },
        );
        lastAutoUpdate = evaluation;
        reply(200, evaluation);
      } finally {
        updateInFlight = false;
      }
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
