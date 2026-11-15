import { channelIsFresh, type ChannelState } from './channel-state.ts';
import { readConfig, readModelKey } from './config.ts';
import { ONLINE_MS } from './kaji-link.ts';
import { MODEL_TIMEOUT_MS, type Ask, type Reply, type RouteName } from './model.ts';
import {
  detectOllama,
  ollamaUrlOf,
  planModels,
  writeModels,
  type ModelChange,
  type ModelSetup,
} from './model-setup.ts';
import type { ProcessClient } from './process-client.ts';
import { degradedReasons, type RouteHealth } from './route-health.ts';
import type { Method } from './rpc.ts';
import type { RuntimeInstrumentality } from './runtime-instrumentality.ts';

export interface RuntimeRoutesHost {
  readonly home?: string;
  readonly nervous: ProcessClient;
  readonly brain: ProcessClient;
  modelCall(method: Method, params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  scheduledHealth(): ReturnType<RuntimeInstrumentality['scheduledHealth']>;
  remoteEndpointDegraded(): string[];
  channelState(): ChannelState;
}

/**
 * Model setup/reloading, direct model ask, route health, and doctor diagnostics
 * extracted from Runtime (F-095-T03).
 */
export class RuntimeRoutes {
  private readonly host: RuntimeRoutesHost;

  constructor(host: RuntimeRoutesHost) {
    this.host = host;
  }

  async modelSetup(): Promise<ModelSetup> {
    if (!this.host.home) throw new Error('Model setup needs the data home.');
    const models = readConfig(this.host.home).models;
    let cloudKey: boolean;
    try {
      cloudKey = !!readModelKey(this.host.home);
    } catch {
      cloudKey = false;
    }
    return { models, cloudKey, ollama: await detectOllama(ollamaUrlOf(models)) };
  }

  async changeModels(change: ModelChange) {
    if (!this.host.home) throw new Error('Model setup needs the data home.');
    const current = readConfig(this.host.home).models;
    const ollama = await detectOllama(change.localUrl ?? ollamaUrlOf(current));
    writeModels(
      this.host.home,
      planModels(current, change, ollama.reachable ? ollama.models.map((m) => m.name) : undefined),
    );
    return this.reloadModels();
  }

  async reloadModels() {
    return (await this.host.brain.call('models.reload')) as { error?: string; kept?: boolean; models: unknown };
  }

  async ask(ask: Ask) {
    return (await this.host.modelCall('model.complete', { ...ask }, MODEL_TIMEOUT_MS)) as Reply;
  }

  /** The brain's view of the model routes (F-030); a brain that does not answer is itself the degraded reason. */
  async routes(): Promise<{ routes?: Record<RouteName, RouteHealth>; degraded: string[] }> {
    try {
      const p = (await this.host.brain.call('runtime.ping', {}, 2000)) as { routes?: Record<RouteName, RouteHealth> };
      return { ...(p.routes ? { routes: p.routes } : {}), degraded: p.routes ? degradedReasons(p.routes) : [] };
    } catch {
      return { degraded: ['brain process not answering: model-needing requests fail until it is back'] };
    }
  }

  async health() {
    await this.host.nervous.call('runtime.ping');
    const [r, s] = await Promise.all([this.routes(), this.host.scheduledHealth()]);
    return {
      integrityCheck: 'not-run',
      processes: {
        nervous: this.host.nervous.child.pid,
        brain: this.host.brain.child.pid,
        brainAlive: this.host.brain.child.connected,
      },
      ...r,
      ...s,
      degraded: [...r.degraded, ...s.degraded, ...this.host.remoteEndpointDegraded()],
    };
  }

  async doctor() {
    const channel = this.host.channelState();
    const [r, s] = await Promise.all([this.routes(), this.host.scheduledHealth()]);
    return {
      channel,
      channelFresh: channelIsFresh(channel, Date.now(), ONLINE_MS),
      ...((await this.host.nervous.call('runtime.doctor')) as object),
      processes: {
        nervous: this.host.nervous.child.pid,
        brain: this.host.brain.child.pid,
        brainAlive: this.host.brain.child.connected,
      },
      models: await this.host.brain.call('runtime.ping').then(
        (p) => (p as { models: unknown }).models,
        () => 'brain unavailable',
      ),
      ...r,
      ...s,
      degraded: [...r.degraded, ...s.degraded, ...this.host.remoteEndpointDegraded()],
      localModels: await this.localModels(),
      agentLoop: 'not implemented',
    };
  }

  /** F-037: the models this base can use on its local route (Ollama's list), for doctor; unknown without a data home. */
  private async localModels(): Promise<{ reachable: boolean; url: string; models: string[] } | undefined> {
    if (!this.host.home) return undefined;
    let url;
    try {
      url = ollamaUrlOf(readConfig(this.host.home).models);
    } catch {
      return undefined;
    }
    const found = await detectOllama(url);
    return { reachable: found.reachable, url: found.url, models: found.models.map((m) => m.name) };
  }
}
