import { readConfig, readModelKey, readScrolls } from './config.ts';
import { ONLINE_MS, type RegistryPort, type RunItem } from './kaji-link.ts';
import { ModelBudget, ModelBudgetCancelledError } from './model-budget.ts';
import type { UsageObservation } from './model-usage.ts';
import {
  authorizeRemoteInferenceRequest,
  complete,
  MODEL_TIMEOUT_MS,
  ModelError,
  selectOrchestration,
  validateModels,
  validateWorkerInferRequest,
  verifyRemoteInferenceReply,
  type Ask,
  type EnrolledBaseCandidate,
  type Models,
  type OrchestratedProvenance,
  type OrchestrationRequest,
  type OrchestrationSelection,
  type Reply,
  type WorkerInferReply,
  type WorkerInferRequest,
} from './model.ts';
import { defaultPolicy } from './policy.ts';
import type { ActReply, OwnerAction } from './runtime-api.ts';
import type { WorkerLink } from './worker-link.ts';

export interface RuntimeDispatchHost {
  readonly home: string | undefined;
  readonly kaji: RegistryPort;
  readonly offersHeard: Map<string, { tools: string[]; at: number }>;
  bases(): Promise<Array<{ baseId: string; status?: string; address?: string; online: boolean }>>;
  ask(ask: Ask): Promise<Reply>;
  act(action: OwnerAction): Promise<ActReply>;
}

/**
 * Independent inference endpoint and worker selection, remote inference serving/calling,
 * and orchestrated job execution extracted from Runtime (F-095-T03).
 */
export class RuntimeDispatch {
  private readonly host: RuntimeDispatchHost;
  workerLink?: WorkerLink;
  private readonly orchestratedBudget = new ModelBudget();
  private readonly remoteEndpointErrors = new Map<string, string>();

  constructor(host: RuntimeDispatchHost) {
    this.host = host;
  }

  useWorkerLink(link: WorkerLink): void {
    this.workerLink = link;
  }

  async selectExecution(
    req: OrchestrationRequest,
    basesOverride?: readonly EnrolledBaseCandidate[],
  ): Promise<OrchestrationSelection> {
    const cfg = this.host.home ? readConfig(this.host.home) : undefined;
    const hasCloudKey = this.host.home ? !!readModelKey(this.host.home) : false;
    const policy = (() => {
      try {
        return this.host.home ? readScrolls(this.host.home).policy : defaultPolicy;
      } catch {
        return defaultPolicy;
      }
    })();
    const bases: readonly EnrolledBaseCandidate[] =
      basesOverride ??
      (await this.host.bases().catch(() => [])).map((b) => {
        const heard = this.host.offersHeard.get(b.baseId);
        const wsOffers = this.workerLink?.offersOf(b.baseId);
        const offers = wsOffers ?? (heard && Date.now() - heard.at < ONLINE_MS ? heard.tools : undefined);
        return {
          baseId: b.baseId,
          status: b.status ?? 'enrolled',
          address: b.address ?? '',
          online: b.status === 'enrolled' && (b.online || !!wsOffers),
          ...(offers ? { offers } : {}),
        };
      });
    return selectOrchestration(req, {
      selfBaseId: cfg?.base.id ?? 'LOCAL',
      models: cfg?.models ?? {},
      hasCloudKey,
      bases,
      policy,
    });
  }

  private async waitForRemoteEndpoint(targetBaseId: string, waitBudgetMs: number): Promise<number> {
    if (!this.workerLink) throw new ModelError('Remote inference requires an active WorkerLink.');
    const isReady = () =>
      this.workerLink!.connected(targetBaseId) &&
      (this.workerLink!.offersOf(targetBaseId)?.includes('model.infer') ?? false);
    if (isReady()) return 0;
    if (waitBudgetMs <= 0) {
      return 0;
    }
    const started = Date.now();
    const deadline = started + Math.min(MODEL_TIMEOUT_MS, waitBudgetMs);
    const stepMs = Math.min(25, Math.max(5, Math.floor(waitBudgetMs / 10)));
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(stepMs, Math.max(1, deadline - Date.now()))));
      if (isReady()) {
        return Math.max(1, Date.now() - started);
      }
    }
    const reason = `Remote inference endpoint on ${targetBaseId} expired after waiting ${waitBudgetMs} ms: endpoint unavailable.`;
    this.remoteEndpointErrors.set(targetBaseId, reason);
    throw new ModelError(reason);
  }

  remoteEndpointDegraded(): string[] {
    const out: string[] = [];
    for (const reason of this.remoteEndpointErrors.values()) {
      if (!out.includes(reason)) out.push(reason);
    }
    if (this.host.home && this.workerLink) {
      try {
        const cfg = readConfig(this.host.home);
        const endpoints = cfg.models?.remote?.endpoints ?? {};
        for (const [name, ep] of Object.entries(endpoints)) {
          if (ep.baseId === cfg.base.id) continue;
          const online =
            this.workerLink.connected(ep.baseId) &&
            (this.workerLink.offersOf(ep.baseId)?.includes('model.infer') ?? false);
          if (!online) {
            const msg = `Remote inference endpoint "${name}" (${ep.baseId}) is unavailable.`;
            if (!out.includes(msg)) out.push(msg);
          }
        }
      } catch {
        /* best effort health diagnostics */
      }
    }
    return out;
  }

  private async runLoopbackModel(
    baseUrl: string,
    model: string,
    ask: { prompt: string; system?: string },
    timeoutMs: number,
  ): Promise<WorkerInferReply> {
    let localModels: Models;
    try {
      localModels = validateModels({ local: { baseUrl, model } });
    } catch (err) {
      throw new ModelError(err instanceof Error ? err.message : 'Local loopback S² configuration is invalid.');
    }
    const started = Date.now();
    let obs: UsageObservation | undefined;
    const reply = await complete(
      {
        prompt: ask.prompt,
        ...(ask.system !== undefined ? { system: ask.system } : {}),
        privacy: 'local-only',
        route: 'local',
      },
      localModels,
      undefined,
      {
        timeoutMs: Math.max(1000, Math.min(MODEL_TIMEOUT_MS, timeoutMs)),
        observe: (o) => {
          obs = o;
        },
      },
    );
    const candidate = {
      model: obs?.returnedModel ?? '',
      text: reply.text,
      stop: reply.stop,
      truncated: reply.truncated,
      usage: { inputTokens: obs?.inputTokens ?? null, outputTokens: obs?.outputTokens ?? null },
      durationMs: obs?.durationMs ?? Math.max(0, Date.now() - started),
    };
    return verifyRemoteInferenceReply(model, candidate);
  }

  async serveRemoteInference(callerBaseId: string, req: WorkerInferRequest): Promise<WorkerInferReply> {
    if (!this.host.home) throw new ModelError('Remote inference requires configured runtime home.');
    const cfg = readConfig(this.host.home);
    const validated = validateWorkerInferRequest({ ...req, callerBaseId });
    if (!cfg.models?.local) {
      throw new ModelError(`Local inference server is not configured on ${cfg.base.id}.`);
    }
    const bases = await this.host.kaji.bases();
    authorizeRemoteInferenceRequest(validated, {
      selfBaseId: cfg.base.id,
      remote: cfg.models.remote,
      offers: cfg.kaji?.offers ?? [],
      bases: bases.map((b) => ({
        baseId: b.baseId,
        status: b.status,
        address: b.address,
        online: true,
      })),
    });
    return this.runLoopbackModel(
      cfg.models.local.baseUrl,
      validated.model,
      {
        prompt: validated.prompt,
        ...(validated.system !== undefined ? { system: validated.system } : {}),
      },
      validated.timeoutMs ?? MODEL_TIMEOUT_MS,
    );
  }

  async inferRemote(
    targetBaseId: string,
    req: Omit<WorkerInferRequest, 'callerBaseId' | 'targetBaseId'>,
    timeoutMs = MODEL_TIMEOUT_MS,
  ): Promise<WorkerInferReply> {
    if (!this.workerLink) throw new ModelError('Remote inference requires an active WorkerLink.');
    try {
      const reply = await this.workerLink.infer(targetBaseId, req, req.timeoutMs ?? timeoutMs);
      this.remoteEndpointErrors.delete(targetBaseId);
      return reply;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.remoteEndpointErrors.set(targetBaseId, `Remote inference endpoint on ${targetBaseId} failed: ${msg}`);
      throw err;
    }
  }

  async runOrchestratedJob(input: {
    orchestration: OrchestrationRequest;
    ask: { prompt: string; system?: string; maxTokens?: number; temperature?: number };
    execute?: (
      inference: WorkerInferReply,
      selection: OrchestrationSelection,
      provenance: OrchestratedProvenance,
    ) => Promise<unknown>;
    cloudTransport?: (req: {
      model: string;
      prompt: string;
      system?: string;
      maxTokens?: number;
      temperature?: number;
    }) => Promise<WorkerInferReply>;
    item?: Omit<RunItem, 'request'> & { request?: string };
    timeoutMs?: number;
    basesOverride?: readonly EnrolledBaseCandidate[];
  }): Promise<{
    selection: OrchestrationSelection;
    inference: WorkerInferReply;
    execution?: unknown;
    provenance: OrchestratedProvenance;
  }> {
    if (input.item?.tool === 'kaji.run') {
      throw new ModelError('Recursive kaji.run delegation is not allowed.');
    }
    const effectiveOrchestration: OrchestrationRequest = {
      ...input.orchestration,
      ...(input.orchestration.tool === undefined && input.item?.tool !== undefined ? { tool: input.item.tool } : {}),
    };
    const selection = await this.selectExecution(effectiveOrchestration, input.basesOverride);
    const cfg = this.host.home ? readConfig(this.host.home) : undefined;
    const selfBaseId = cfg?.base.id ?? 'LOCAL';
    const timeoutMs = Math.max(1, Math.min(MODEL_TIMEOUT_MS, input.timeoutMs ?? MODEL_TIMEOUT_MS));
    const maxOutputTokens = effectiveOrchestration.maxOutputTokens;
    const maxTotalTokens = effectiveOrchestration.maxTotalTokens;
    if (maxOutputTokens !== undefined && input.ask.maxTokens !== undefined && input.ask.maxTokens > maxOutputTokens) {
      throw new ModelError(
        `Requested maxTokens ${input.ask.maxTokens} exceeds orchestration maxOutputTokens budget ${maxOutputTokens}.`,
      );
    }
    const effectiveMaxTokens =
      maxOutputTokens !== undefined
        ? Math.min(input.ask.maxTokens ?? maxOutputTokens, maxOutputTokens)
        : input.ask.maxTokens;

    if (cfg?.models?.concurrency) {
      this.orchestratedBudget.configure(cfg.models.concurrency);
    }
    let lease;
    try {
      lease = await this.orchestratedBudget.acquire(selection.inference.model, AbortSignal.timeout(timeoutMs));
    } catch (err) {
      if (err instanceof ModelBudgetCancelledError) {
        throw new ModelError(
          `Concurrency budget for model "${selection.inference.model}" expired after ${timeoutMs} ms.`,
        );
      }
      throw err;
    }

    let inference: WorkerInferReply | undefined;
    let attempts = 0;
    let waitedMs = 0;
    let usedTokens = 0;
    try {
      if (selection.inference.kind === 'remote') {
        if (selection.inference.baseId === selfBaseId) {
          if (!cfg?.models?.local) {
            throw new ModelError(`Local inference server is not configured on ${selfBaseId}.`);
          }
          attempts = 1;
          inference = await this.runLoopbackModel(
            cfg.models.local.baseUrl,
            selection.inference.model,
            { prompt: input.ask.prompt, ...(input.ask.system !== undefined ? { system: input.ask.system } : {}) },
            timeoutMs,
          );
        } else {
          if (effectiveOrchestration.privacy === 'local-only') {
            throw new ModelError("Remote inference refuses 'local-only' privacy.");
          }
          const maxAttempts = effectiveOrchestration.maxAttempts ?? 1;
          const waitBudgetMs = effectiveOrchestration.waitBudgetMs ?? 0;
          const startedAt = Date.now();
          let lastErr: unknown;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            attempts = attempt;
            const elapsed = Date.now() - startedAt;
            const remainingWait = Math.max(0, waitBudgetMs - waitedMs);
            if (waitBudgetMs > 0) {
              waitedMs += await this.waitForRemoteEndpoint(selection.inference.baseId, remainingWait);
            }
            const remainingTimeout = Math.max(1000, timeoutMs - Math.max(0, Date.now() - startedAt));
            if (elapsed >= timeoutMs && attempt > 1) {
              throw new ModelError(
                `Remote inference retry budget on ${selection.inference.baseId} expired after ${timeoutMs} ms: endpoint unavailable.`,
              );
            }
            try {
              const reply = await this.inferRemote(
                selection.inference.baseId,
                {
                  endpoint: selection.inference.endpoint,
                  model: selection.inference.model,
                  privacy: effectiveOrchestration.privacy,
                  prompt: input.ask.prompt,
                  ...(input.ask.system !== undefined ? { system: input.ask.system } : {}),
                  ...(effectiveMaxTokens !== undefined ? { maxTokens: effectiveMaxTokens } : {}),
                  ...(input.ask.temperature !== undefined ? { temperature: input.ask.temperature } : {}),
                  ...(input.timeoutMs !== undefined
                    ? { timeoutMs: Math.max(1000, Math.min(input.timeoutMs, remainingTimeout)) }
                    : {}),
                },
                remainingTimeout,
              );
              usedTokens += (reply.usage.inputTokens ?? 0) + (reply.usage.outputTokens ?? 0);
              if (maxOutputTokens !== undefined && (reply.usage.outputTokens ?? 0) > maxOutputTokens) {
                throw new ModelError(
                  `Remote inference output tokens ${reply.usage.outputTokens} exceeded maxOutputTokens budget ${maxOutputTokens}.`,
                );
              }
              if (maxTotalTokens !== undefined && usedTokens > maxTotalTokens) {
                throw new ModelError(`Orchestrated token budget exhausted (${usedTokens} > ${maxTotalTokens}).`);
              }
              inference = reply;
              break;
            } catch (err) {
              lastErr = err;
              const msg = err instanceof Error ? err.message : String(err);
              const nonRetryable =
                /not granted|not offered|not enrolled|Tailscale|privacy|mismatch|exceeds|exhausted|disabled|localOnly|denies|tainted/i.test(
                  msg,
                );
              if (nonRetryable || attempt >= maxAttempts) {
                throw err;
              }
              if (maxTotalTokens !== undefined && usedTokens >= maxTotalTokens) {
                throw new ModelError(
                  `Orchestrated token budget exhausted before retry (${usedTokens} >= ${maxTotalTokens}).`,
                );
              }
            }
          }
          if (!inference) {
            throw lastErr instanceof Error
              ? lastErr
              : new ModelError(`Remote inference endpoint on ${selection.inference.baseId} unavailable.`);
          }
        }
      } else if (selection.inference.kind === 'cloud' && input.cloudTransport) {
        attempts = 1;
        inference = await input.cloudTransport({
          model: selection.inference.model,
          prompt: input.ask.prompt,
          ...(input.ask.system !== undefined ? { system: input.ask.system } : {}),
          ...(effectiveMaxTokens !== undefined ? { maxTokens: effectiveMaxTokens } : {}),
          ...(input.ask.temperature !== undefined ? { temperature: input.ask.temperature } : {}),
        });
      } else {
        attempts = 1;
        const started = Date.now();
        const reply = await this.host.ask({
          prompt: input.ask.prompt,
          ...(input.ask.system !== undefined ? { system: input.ask.system } : {}),
          privacy: effectiveOrchestration.privacy,
          route: selection.inference.kind,
        });
        inference = {
          model: reply.model,
          text: reply.text,
          stop: reply.stop,
          truncated: reply.truncated,
          usage: { inputTokens: null, outputTokens: null },
          durationMs: Math.max(0, Date.now() - started),
        };
      }

      if (maxOutputTokens !== undefined && (inference.usage.outputTokens ?? 0) > maxOutputTokens) {
        throw new ModelError(
          `Inference output tokens ${inference.usage.outputTokens} exceeded maxOutputTokens budget ${maxOutputTokens}.`,
        );
      }
      const totalTokens = usedTokens || (inference.usage.inputTokens ?? 0) + (inference.usage.outputTokens ?? 0);
      if (maxTotalTokens !== undefined && totalTokens > maxTotalTokens) {
        throw new ModelError(`Orchestrated token budget exhausted (${totalTokens} > ${maxTotalTokens}).`);
      }
    } finally {
      lease.release();
    }
    const provenance: OrchestratedProvenance = {
      executionBaseId: selection.worker.baseId,
      executionKind: selection.worker.kind,
      inferenceBaseId:
        selection.inference.kind === 'remote'
          ? selection.inference.baseId
          : selection.inference.kind === 'local'
            ? selfBaseId
            : 'cloud',
      inferenceKind: selection.inference.kind,
      inferenceModel: inference.model,
      ...(selection.inference.kind === 'remote' ? { endpoint: selection.inference.endpoint } : {}),
      privacy: effectiveOrchestration.privacy,
      ...(attempts > 1 ? { attempts } : {}),
      ...(waitedMs > 0 ? { waitedMs } : {}),
    };
    let execution: unknown;
    if (input.execute) {
      execution = await input.execute(inference, selection, provenance);
    } else if (input.item) {
      if (selection.worker.kind === 'remote' && selection.worker.tool && input.item.tool !== selection.worker.tool) {
        throw new ModelError(
          `Execution item tool "${input.item.tool}" does not match selected capability "${selection.worker.tool}".`,
        );
      }
      const fullItem: RunItem = {
        ...input.item,
        request: input.item.request ?? inference.text,
      };
      if (selection.worker.kind === 'remote') {
        if (!this.workerLink) throw new ModelError('Remote execution requires an active WorkerLink.');
        execution = await this.workerLink.run(selection.worker.baseId, fullItem, timeoutMs);
      } else {
        execution = await this.host.act({
          request: fullItem.request,
          tool: fullItem.tool,
          args: fullItem.args,
        });
      }
    }
    return { selection, inference, ...(execution !== undefined ? { execution } : {}), provenance };
  }
}
