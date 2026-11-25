import { readConfig, readScrolls } from './config.ts';
import { toolDocs } from './executors.ts';
import { TOOL_INDEX_READ, freeReadTurns } from './tool-index.ts';
import { builtinPackRegistry } from './packs.ts';
import { argsHash } from './ledger.ts';
import {
  MAX_REPLY_CHARS,
  MAX_STEPS,
  doneReply,
  filterConsultantInput,
  formatFleetChatReply,
  matchExistingReminders,
  ownerDeclined,
  declinedReply,
  parseAdvice,
  requestLanguage,
  waitingReply,
  validateFleetChatReply,
  validateReminderTitle,
  type Plan,
  type Recalled,
  type RemoteOffer,
  type Step,
  type Turn,
} from './misato.ts';
import { MODEL_TIMEOUT_MS } from './model.ts';
import { EvaSandboxUnavailableError } from './eva-runner.ts';
import { runScriptPlanInEva03 } from './script-plan.ts';
import { callGrantedMcp } from './runtime-tools.ts';
import type { OperatorResolution } from './operator-directory.ts';
import { canRunRemotePilot, chooseAdvisers, rankPilots, type Chosen, type Pilot, type PilotOffer } from './pilots.ts';
import { defaultPolicy } from './policy.ts';
import type { ProcessClient } from './process-client.ts';
import { reconcileReminderArgs } from './reminder-time.ts';
import { REFUSED_BEFORE_GATE, RpcFault, type Method } from './rpc.ts';
import {
  guardActionDuplicates,
  type ActReply,
  type ChatReply,
  type ExternalTools,
  type OwnerAction,
  withRemoteResults,
} from './runtime-api.ts';
import type { RemoteConsultant } from './runtime-approvals.ts';
import type { ChatNoteKind } from './runtime-chat.ts';
import type { Reminder } from './store.ts';
import type { WatchWork } from './watch.ts';
import { isAgencyQuestion } from './why.ts';
import type { WorkerLease } from './worker-jobs.ts';

export interface RuntimePlanningHost {
  readonly nervous: ProcessClient;
  readonly home?: string;
  modelCall(method: Method, params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  reminderPage(offset: number, limit: number): Promise<{ items: Reminder[] }>;
  note(sortieId: string, kind: ChatNoteKind, payload: object): Promise<unknown>;
  record(sortieId: string, steps: Step[], step: Step, actionId?: string, durationMs?: number): Promise<void>;
  baseNames(): Promise<{ id: string; name: string }[]>;
  /** Bases the owner revoked (B-094): named as revoked, never as offline. */
  revokedBases(): Promise<{ id: string; name: string }[]>;
  pilots(): Pilot[];
  externalTools(): Promise<ExternalTools>;
  getRemoteConsultant(): RemoteConsultant | undefined;
  proposePilot(domain: string): Promise<unknown>;
  remoteOffers(): Promise<RemoteOffer[]>;
  remotePilots(): Promise<{ base: string; name: string; pilots: PilotOffer[] }[]>;
  resolveOperator(query: string, opts: { excludeSelf?: boolean }): Promise<OperatorResolution>;
  spear(id: string, reason: string): Promise<unknown>;
  chatOnce(message: string, conversation?: string): Promise<ChatReply>;
  gate(sortieId: string, action: OwnerAction, askCasper?: boolean, worker?: WorkerLease): Promise<ActReply>;
  toolsProcess(): ProcessClient;
}

/**
 * Misato's planning, consultation, validation, and action-gating loop
 * extracted from Runtime (F-095-T03).
 */
export class RuntimePlanning {
  private readonly host: RuntimePlanningHost;

  constructor(host: RuntimePlanningHost) {
    this.host = host;
  }

  async loop(
    sortieId: string,
    message: string,
    steps: Step[],
    context: Turn[] = [],
    followup?: {
      consult: boolean;
      advice?: string;
      conversation?: string;
      answering?: boolean;
      watch?: WatchWork;
      askBoth?: boolean;
    },
  ): Promise<ChatReply> {
    const waiting: ChatReply['waiting'] = [];
    const proactive = followup?.watch;
    // B-143: relative times ("in 2 minutes") count from when the owner asked: the sortie opens with the request
    // (an answer to Misato's question arrives now), never from the model step that writes the call minutes later.
    const requestedAt = followup?.answering
      ? new Date().toISOString()
      : await this.host.nervous
          .call('sorties.get', { id: sortieId })
          .then((s) => (s as { created?: unknown } | null)?.created)
          .then((c) => (typeof c === 'string' && Number.isFinite(Date.parse(c)) ? c : new Date().toISOString()))
          .catch(() => new Date().toISOString());
    const queryText = [message, ...context.map((t) => t.request)].join(' ').slice(0, 8000);
    // LCL fill: Lilith's facts and matching pending reminders for this request and its recent conversation.
    const memory = (await this.host.nervous.call('memory.recall', { text: queryText }).catch(() => [])) as Recalled[];
    const pendingReminders = (await this.host.reminderPage(0, 50).catch(() => ({ items: [] as Reminder[] }))).items;
    const matchedReminders = matchExistingReminders(queryText, pendingReminders, 5).map((r) => ({
      id: r.id,
      title: r.title,
      due: r.due,
      ...(r.kind !== 'at' ? { kind: r.kind } : {}),
      ...(r.end ? { end: r.end } : {}),
    }));
    for (const t of context)
      await this.host.nervous.call('context.intake', {
        sortieId,
        source: ('conversation:' + (t.source ?? 'legacy')).slice(0, 100),
        trust: t.tainted ? 'tainted' : 'trusted',
      });
    for (const m of memory.slice(0, 10))
      await this.host.nervous.call('context.intake', {
        sortieId,
        source: ('memory:' + m.id).slice(0, 100),
        trust: m.tainted ? 'tainted' : 'trusted',
      });
    const finish = async (
      status: 'done' | 'failed',
      reply?: string,
      error?: string,
      durationMs?: number,
    ): Promise<ChatReply> => {
      // B-094: a worker can answer a kaji.run while Misato is still writing; her reply then carries that result.
      if (reply && !waiting.length && steps.some((s) => s.tool === 'kaji.run' && s.outcome === 'grant' && !s.error))
        reply = withRemoteResults(
          reply,
          (await this.host.nervous.call('sorties.remoteResults', { sortieId }).catch(() => [])) as string[],
        ).slice(0, 4000);
      if (waiting.length && reply) {
        // Not finished: the reply is recorded, the sortie waits for the owner's decisions and then resumes.
        await this.host.nervous.call('sorties.finish', { sortieId, reply });
        await this.host.note(sortieId, 'misato.waiting', { approvalIds: waiting.map((w) => w.approvalId) });
      } else if (proactive) {
        const summary =
          reply ??
          (lang() === 'it'
            ? 'Il controllo automatico non è terminato. Apri NERV per verificare lo stato.'
            : 'The automatic check did not finish. Open NERV to inspect its status.');
        const recorded = await this.host.nervous
          .call('watch.finish', { sortieId, status, reply: summary })
          .catch(() => false);
        if (!recorded)
          return { proactive: true, sortieId, error: 'Watch state changed; inspect its trace.', steps, waiting };
      } else
        await this.host.nervous.call('sorties.finish', {
          sortieId,
          status,
          ...(reply ? { reply } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
      const surfaceStep = [...steps]
        .reverse()
        .find((s) => s.outcome === 'grant' && s.result && typeof s.result === 'object' && 'surface' in s.result);
      const surface = surfaceStep ? (surfaceStep.result as { surface?: unknown }).surface : undefined;
      return {
        ...(proactive ? { proactive: true as const } : {}),
        sortieId,
        ...(reply ? { reply } : {}),
        ...(surface !== undefined ? { surface } : {}),
        ...(error ? { error } : {}),
        steps,
        waiting,
      };
    };
    const lang = () =>
      requestLanguage(
        message,
        context.map((t) => t.request),
      );
    const ranSteps = () =>
      steps
        .filter((s) => s.outcome === 'grant' && !s.error && s.tool && s.tool !== TOOL_INDEX_READ)
        .map((s) => ({ tool: s.tool!, args: s.args ?? {} }));
    // F-025: a consultant's advice, once per request before the first step (not again on a resume); no vote, no action.
    // F-042: the consultant is not asked for questions about the agency itself; pilots, consultant, and Misato get enrolled base names as data (B-012).
    // F-045: the specialist pilot whose keywords fit the request advises; none fits, the generic pilot (roles.consultant).
    const named = await this.host.baseNames();
    const consult = (followup?.consult ?? steps.length === 0) && !isAgencyQuestion(message, named);
    const roster = consult ? this.host.pilots() : [];
    const ranked = !consult
      ? []
      : (() => {
          try {
            return rankPilots(message, roster);
          } catch {
            return [];
          }
        })();
    const advisers = !consult ? [] : chooseAdvisers(message, roster, { askBoth: followup?.askBoth });
    // B-024: the consultant is told what Misato can do, so it never advises against a tool she has.
    const scrolls = (() => {
      try {
        return this.host.home ? readScrolls(this.host.home).policy : defaultPolicy;
      } catch {
        return defaultPolicy;
      }
    })();
    const rawOffered = !consult
      ? []
      : [...toolDocs, ...(await this.host.externalTools()).docs].map((t) => ({
          name: t.name,
          about: t.about.slice(0, 200),
        }));
    const localFiltered = filterConsultantInput(
      {
        request: message.slice(0, 4000),
        previousAdvice: followup?.advice,
        context: context.slice(-3),
        tools: rawOffered,
      },
      scrolls,
      false,
    );
    const offered = localFiltered.tools;
    let unmatched: string | undefined;
    const sortieTainted = context.some((t) => t.tainted) || memory.some((m) => m.tainted);
    const askAdviser = async (pilot: Chosen | undefined): Promise<string | undefined> => {
      const fullPilot = pilot ? this.host.pilots().find((p) => p.id === pilot.id) : undefined;
      const t0 = performance.now();
      return this.host
        .modelCall(
          'consultant.advise',
          {
            request: localFiltered.request,
            ...(localFiltered.previousAdvice ? { previousAdvice: localFiltered.previousAdvice } : {}),
            ...(localFiltered.context.length ? { context: localFiltered.context } : {}),
            ...(pilot
              ? {
                  pilot: {
                    id: pilot.id,
                    name: pilot.name,
                    domain: pilot.domain,
                    model: pilot.model,
                    ...(fullPilot?.route ? { route: fullPilot.route } : {}),
                    ...(fullPilot?.provider ? { provider: fullPilot.provider } : {}),
                    ...(fullPilot?.stage ? { stage: fullPilot.stage } : {}),
                  },
                  ...(fullPilot?.route === 'cloud' || fullPilot?.provider
                    ? { tainted: sortieTainted, privacy: sortieTainted ? 'local-only' : 'any' }
                    : {}),
                }
              : {}),
            ...(named.length ? { bases: named } : {}),
            ...(offered.length ? { tools: offered } : {}),
          },
          MODEL_TIMEOUT_MS,
        )
        .then(
          (r) => r as { advice: string | null; model?: string; domain?: string },
          (): { advice: string | null; model?: string; domain?: string } => ({ advice: null }),
        )
        .then(async (r) => {
          const durationMs = Math.max(0, Math.round(performance.now() - t0));
          if (!pilot && r.domain) {
            unmatched = r.domain;
            await this.host.note(sortieId, 'pilot.unmatched', { domain: r.domain, durationMs });
          }
          if (!r.advice) return undefined;
          await this.host.note(sortieId, 'misato.consult', {
            advice: r.advice,
            model: r.model ?? '',
            ...(pilot ? { pilot: { id: pilot.id, name: pilot.name, why: pilot.why } } : {}),
            durationMs,
          });
          return r.advice;
        });
    };
    let advice = !consult
      ? followup?.advice
      : followup?.askBoth && advisers.length > 1
        ? (await Promise.all(advisers.map((p) => askAdviser(p)))).filter(Boolean).join('\n\n') || undefined
        : ((await askAdviser(advisers[0])) ?? (ranked[1] ? await askAdviser(ranked[1]) : undefined));
    const remoteConsultant = this.host.getRemoteConsultant();
    if (consult && !advice && remoteConsultant) {
      const remoteIn = filterConsultantInput(
        {
          request: message.slice(0, 4000),
          tainted: sortieTainted,
          context: context.slice(-3),
          tools: rawOffered,
        },
        scrolls,
        true,
      );
      if (remoteIn.allowed) {
        const t0 = performance.now();
        const remoteReply = await remoteConsultant
          .advise({
            request: remoteIn.request,
            ...(remoteIn.context.length ? { context: remoteIn.context } : {}),
            ...(named.length ? { bases: named } : {}),
            ...(remoteIn.tools.length ? { tools: remoteIn.tools } : {}),
          })
          .catch((): { advice: string | null; model?: string } => ({ advice: null }));
        const durationMs = Math.max(0, Math.round(performance.now() - t0));
        const clean = parseAdvice(remoteReply.advice ?? '');
        if (clean) {
          advice = clean;
          await this.host.note(sortieId, 'misato.consult', {
            advice: clean,
            model: remoteReply.model ?? remoteConsultant.name,
            durationMs,
          });
        }
      }
    }
    // F-045: enough requests in one domain without a specialist → a pilot is proposed (a card), in the background.
    if (unmatched)
      void this.host.proposePilot(unmatched).catch(() => {
        /* best effort */
      });
    // F-113-T02: reading a subject's tool docs costs no action step, up to MAX_FREE_SUBJECT_READS per request.
    for (let turn = 0; turn < MAX_STEPS + freeReadTurns(steps); turn++) {
      if (proactive && !(await this.host.nervous.call('watch.plan', { sortieId }).catch(() => false))) break;
      const remote = proactive?.readOnly ? [] : await this.host.remoteOffers();
      const ext = proactive?.readOnly
        ? { docs: [], byName: new Map(), suspended: [] }
        : await this.host.externalTools();
      const stepT0 = performance.now();
      const out = (await this.host
        .modelCall(
          'misato.step',
          {
            ...(proactive
              ? { watch: { readOnly: proactive.readOnly, ...(proactive.model ? { model: proactive.model } : {}) } }
              : {}),
            ...(followup?.answering && turn === 0 ? { clarification: true } : {}),
            request: message,
            requestedAt,
            history: steps.slice(-12),
            ...(named.length ? { bases: named } : {}),
            ...(remote.length ? { remote } : {}),
            ...(ext.docs.length ? { external: ext.docs } : {}),
            ...(advice ? { advice } : {}),
            language: lang(),
            ...(context.length ? { context } : {}),
            ...(memory.length ? { memory: memory.slice(0, 10) } : {}),
            ...(matchedReminders.length ? { reminders: matchedReminders } : {}),
          },
          MODEL_TIMEOUT_MS,
        )
        .catch(() => ({ error: 'Brain unavailable.' }))) as { plan?: Plan; invalid?: boolean; error?: string };
      const stepDurationMs = Math.max(0, Math.round(performance.now() - stepT0));
      if (out.error) return finish('failed', undefined, out.error, stepDurationMs);
      if (!out.plan) {
        await this.host.record(
          sortieId,
          steps,
          {
            outcome: 'invalid',
            error: 'Reply was not one JSON action, question or reply.',
          },
          undefined,
          stepDurationMs,
        );
        continue;
      }
      if ('newRequest' in out.plan) {
        if (!followup?.answering || turn !== 0) {
          await this.host.record(
            sortieId,
            steps,
            {
              outcome: 'invalid',
              error: 'Topic changes are allowed only for the first response to a pending question.',
            },
            undefined,
            stepDurationMs,
          );
          continue;
        }
        await this.host.spear(sortieId, 'Owner changed topic; the pending clarification is cancelled.');
        return this.host.chatOnce(message, followup.conversation);
      }
      if ('ask' in out.plan && proactive) {
        const prefix =
          lang() === 'it'
            ? 'Il controllo automatico richiede altri dettagli. Aggiorna la richiesta: '
            : 'This automatic check needs more detail. Update its request: ';
        return finish(
          'failed',
          prefix + out.plan.ask.slice(0, MAX_REPLY_CHARS - prefix.length),
          undefined,
          stepDurationMs,
        );
      }
      if ('ask' in out.plan) {
        const question = (await this.host.nervous.call('misato.ask', {
          sortieId,
          text: out.plan.ask,
          conversation: followup?.conversation ?? 'cli',
          durationMs: stepDurationMs,
        })) as { text: string; expires: string };
        return { sortieId, reply: question.text, question, steps, waiting };
      }
      if ('reply' in out.plan) {
        const ungroundedFleet = !proactive ? validateFleetChatReply(out.plan.reply, steps) : undefined;
        if (ungroundedFleet) {
          const alreadyRejected = steps.some(
            (s) =>
              s.outcome === 'invalid' &&
              typeof s.error === 'string' &&
              s.error.startsWith('Your reply ignored the granted fleet.chat result'),
          );
          await this.host.record(
            sortieId,
            steps,
            { outcome: 'invalid', error: ungroundedFleet.error },
            undefined,
            stepDurationMs,
          );
          if (alreadyRejected) {
            const fallback = formatFleetChatReply(lang(), ungroundedFleet.result);
            if (fallback) return finish('done', fallback, undefined, stepDurationMs);
          }
          continue;
        }
        return finish('done', out.plan.reply, undefined, stepDurationMs);
      }
      if ('script' in out.plan) {
        try {
          const pendingGateReplies = new Map<string, ActReply>();
          const waitingApprovals: Array<{ approvalId: string; tool: string; reason?: string }> = [];
          const loadAllowedReadTools = async () => {
            const packs = this.host.home ? readConfig(this.host.home).packs : undefined;
            const ext = await this.host.externalTools();
            return [...builtinPackRegistry.filterToolDocs(toolDocs, packs), ...ext.docs]
              .filter((t) => ext.byName.get(t.name)?.eva !== '03')
              .map((t) => ({
                name: t.name,
                effect: t.effect,
                fingerprint: `${t.name}:${t.effect}:${t.version ?? '1'}`,
              }));
          };
          const scriptRes = await runScriptPlanInEva03({
            jobId: `${sortieId}-script-${steps.length}`,
            source: out.plan.script,
            tools: loadAllowedReadTools,
            gate: async (t, a) => {
              const g = await this.host
                .gate(sortieId, {
                  request: message,
                  tool: t,
                  args: a,
                  ...(context.length ? { earlier: context.slice(-3) } : {}),
                })
                .catch(() => ({ outcome: 'reject' as const, reason: 'Gate error' }));
              if (g.outcome === 'grant') {
                const gid = g.actionId ?? `${sortieId}-${pendingGateReplies.size + 1}`;
                pendingGateReplies.set(gid, g);
                return { outcome: 'grant', grantId: gid };
              }
              if (g.outcome === 'approval') {
                if ('approvalId' in g && g.approvalId) {
                  waitingApprovals.push({ approvalId: g.approvalId, tool: t, reason: g.reason });
                }
                return { outcome: 'approval', reason: g.reason ?? 'Approval required' };
              }
              return { outcome: 'reject', reason: g.reason };
            },
            execute: async (t, a, grantId) => {
              const g = grantId ? pendingGateReplies.get(grantId) : undefined;
              if (grantId) pendingGateReplies.delete(grantId);
              const ext = await this.host.externalTools();
              const granted = ext.byName.get(t);
              if (granted && g && 'external' in g && g.external) {
                const outExt = await callGrantedMcp({
                  nervous: this.host.nervous,
                  toolsProcess: () => this.host.toolsProcess(),
                  sortieId,
                  actionId: g.actionId,
                  tool: t,
                  granted,
                  args: a,
                });
                if (outExt.error) throw new Error(outExt.error);
                return outExt.text ?? '';
              }
              return g && 'result' in g ? g.result : undefined;
            },
          });
          for (const rec of scriptRes.receipts) {
            await this.host.record(sortieId, steps, {
              tool: rec.tool,
              args: { digest: rec.argsDigest },
              outcome: rec.outcome === 'grant' ? 'grant' : rec.outcome === 'approval' ? 'approval' : 'invalid',
              ...(rec.reason ? { error: rec.reason } : {}),
            });
          }
          await this.host.record(
            sortieId,
            steps,
            {
              tool: 'script.plan',
              args: { calls: scriptRes.calls },
              outcome: scriptRes.status === 'completed' ? 'grant' : 'invalid',
              ...(scriptRes.status === 'completed'
                ? { result: scriptRes.result, tainted: true }
                : { error: scriptRes.reason ?? 'Script plan terminated' }),
            },
            undefined,
            stepDurationMs,
          );
          if (waitingApprovals.length) {
            for (const w of waitingApprovals) {
              waiting.push({ approvalId: w.approvalId, tool: w.tool, reason: w.reason ?? 'Approval required' });
            }
            const msg = waitingReply(lang(), waitingApprovals[0]!.tool, {});
            await this.host.nervous.call('sorties.finish', { sortieId, reply: msg });
            await this.host.note(sortieId, 'misato.waiting', { approvalIds: waiting.map((w) => w.approvalId) });
            return { sortieId, reply: msg, steps, waiting };
          }
        } catch (err) {
          const msg =
            err instanceof EvaSandboxUnavailableError
              ? 'EVA-03 isolation unavailable; use individual read tool calls.'
              : err instanceof Error
                ? err.message
                : String(err);
          await this.host.record(sortieId, steps, { tool: 'script.plan', args: {}, outcome: 'invalid', error: msg });
        }
        continue;
      }
      const { tool } = out.plan.action;
      const shouldReconcile =
        tool === 'reminders.add' || (tool === 'reminders.update' && typeof out.plan.action.args.due === 'string');
      const cfg = shouldReconcile && this.host.home ? readConfig(this.host.home) : undefined;
      let args = shouldReconcile
        ? reconcileReminderArgs(message, out.plan.action.args, {
            now: new Date(requestedAt),
            timeZone: cfg?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            briefAt: cfg?.brief?.at ?? '08:00',
          })
        : out.plan.action.args;
      // A tool Misato was not offered (often a misspelling) has no executor: it goes back to Misato, never to the owner as a card.
      // kaji.run (F-036 slice 3b): only to a base online now, for an action it offers; anything else goes back to Misato.
      if (tool === 'kaji.run') {
        const a = args as { base?: unknown; tool?: unknown; pilot?: unknown };
        const offer = remote.find((r) => r.base === a.base);
        if (!offer || typeof a.tool !== 'string' || !offer.tools.includes(a.tool)) {
          const opHint =
            !offer && typeof a.base === 'string' && a.base.trim()
              ? await this.host.resolveOperator(a.base, { excludeSelf: true }).catch(() => undefined)
              : undefined;
          const wanted = typeof a.base === 'string' ? a.base.trim().toLowerCase() : '';
          const revoked =
            !offer && wanted
              ? (await this.host.revokedBases().catch(() => [])).find(
                  (b) => b.id.toLowerCase() === wanted || b.name.toLowerCase() === wanted,
                )
              : undefined;
          await this.host.record(sortieId, steps, {
            tool,
            args,
            outcome: 'invalid',
            error: offer
              ? `${offer.name} does not offer "${String(a.tool)}". It offers: ${offer.tools.join(', ')}.`
              : revoked
                ? `${revoked.id} (${revoked.name}) is revoked: it is no longer one of your bases and runs nothing.`
                : opHint && (opHint.status === 'ambiguous' || opHint.status === 'stale')
                  ? opHint.message
                  : `No base by that id is online and offering actions. Online: ${remote.map((r) => r.base).join(', ') || 'none'}.`,
          });
          continue;
        }
        if (a.pilot !== undefined) {
          const remoteBase =
            typeof a.pilot === 'string'
              ? (await this.host.remotePilots()).find((b) => b.base === offer.base)
              : undefined;
          const offeredPilot = remoteBase?.pilots.find((p) => p.id === a.pilot);
          const grant = offeredPilot
            ? canRunRemotePilot({ id: offeredPilot.id, retired: false, tools: offeredPilot.tools }, offer.tools, a.tool)
            : { allowed: false, reason: `${offer.name} does not offer pilot "${String(a.pilot)}".` };
          if (!grant.allowed) {
            await this.host.record(sortieId, steps, {
              tool,
              args,
              outcome: 'invalid',
              error: grant.reason,
            });
            continue;
          }
        }
      } else if (
        (!toolDocs.some((t) => t.name === tool) && !ext.byName.has(tool)) ||
        !builtinPackRegistry.isToolEnabled(tool, this.host.home ? readConfig(this.host.home).packs : undefined)
      ) {
        const packs = this.host.home ? readConfig(this.host.home).packs : undefined;
        const enabledDocs = builtinPackRegistry.filterToolDocs(toolDocs, packs);
        await this.host.record(sortieId, steps, {
          tool,
          args,
          outcome: 'invalid',
          error: `Unknown tool "${tool}". Use exactly one of: ${[...enabledDocs.map((t) => t.name), ...ext.byName.keys()].join(', ')}.`,
        });
        continue;
      }
      // F-021: a tool granted for EVA-03 (quarantine) needs a real sandbox, which does not exist yet (F-049): never run unprotected.
      else if (ext.byName.get(tool)?.eva === '03') {
        await this.host.record(sortieId, steps, {
          tool,
          args,
          outcome: 'invalid',
          error: `${tool} is granted for EVA-03 (quarantine), which needs a sandbox NERV does not have yet: it does not run.`,
        });
        continue;
      }
      // B-049: reject missing, generic, or invented reminder titles back to Misato so she asks the owner instead.
      if (tool === 'reminders.add' && !proactive) {
        const titleError = validateReminderTitle(args.title, { request: message, context, memory, steps });
        if (titleError) {
          await this.host.record(
            sortieId,
            steps,
            { tool, args, outcome: 'invalid', error: titleError },
            undefined,
            stepDurationMs,
          );
          continue;
        }
      }
      // F-113-T02: a subject read twice is not a finished job; its docs are already in the planner's instructions.
      if (
        tool === TOOL_INDEX_READ &&
        steps.some(
          (s) => s.tool === tool && s.outcome === 'grant' && !s.error && argsHash(s.args ?? {}) === argsHash(args),
        )
      ) {
        await this.host.record(sortieId, steps, {
          tool,
          args,
          outcome: 'invalid',
          error: 'You already read this subject: its tools are listed in full in your instructions. Use them now.',
        });
        continue;
      }
      // The same action already ran in this sortie: running it again is never the owner's wish (a small model loops here).
      if (
        steps.some(
          (s) => s.tool === tool && s.outcome === 'grant' && !s.error && argsHash(s.args ?? {}) === argsHash(args),
        )
      )
        return finish('done', doneReply(lang(), ranSteps()));
      // B-069: the owner already declined this tool in this request, or let its card expire: it is never asked again.
      // The sortie closes with a reply instead of a new card after every expiry (a card every hour, all night).
      const declined = steps.find((s) => s.tool === tool && ownerDeclined(s));
      if (declined) return finish('done', declinedReply(lang() === 'it', tool, ownerDeclined(declined)!));
      const dupGuard = guardActionDuplicates(tool, args, memory, steps, pendingReminders);
      if ('error' in dupGuard) {
        await this.host.record(sortieId, steps, {
          tool,
          args,
          outcome: 'invalid',
          error: dupGuard.error,
        });
        continue;
      }
      args = dupGuard.args;
      // An action the ledger refuses outright (malformed, oversized) never reached a ballot: Misato sees it as invalid.
      let r: ActReply | { outcome: 'invalid'; reason: string } = await this.host
        .gate(sortieId, {
          request: message,
          tool,
          args,
          ...(context.length ? { earlier: context.slice(-3) } : {}),
        })
        .catch((e: unknown) => ({
          outcome: 'invalid' as const,
          // F-089-T06: a browser click the nervous process could not bind says why (wrong page, no allowlist).
          reason:
            e instanceof RpcFault && e.code === REFUSED_BEFORE_GATE
              ? e.message
              : 'The gate refused this action as malformed (unknown shape or too large).',
        }));
      // F-021: granted and gated: the tools process makes the call; the result is recorded on the action like any other.
      const granted = ext.byName.get(tool);
      if (granted && 'external' in r && r.external) {
        const out = await callGrantedMcp({
          nervous: this.host.nervous,
          toolsProcess: () => this.host.toolsProcess(),
          sortieId,
          actionId: r.actionId,
          tool,
          granted,
          args,
        });
        r = out.error ? { ...r, error: out.error } : { ...r, result: { text: out.text ?? '' } };
      }
      // Spelled out for the planner when it resumes: an action waiting for the owner has not happened.
      const reason =
        r.outcome === 'approval'
          ? `Waiting for the owner's approval; NOT done yet. ${r.reason ?? ''}`.trim()
          : r.reason;
      await this.host.record(
        sortieId,
        steps,
        {
          tool,
          args,
          ...(granted ? { source: 'mcp:' + tool, tainted: true } : {}),
          outcome: r.outcome,
          ...(reason ? { reason } : {}),
          ...('result' in r && r.result !== undefined ? { result: r.result } : {}),
          ...('error' in r && r.error ? { error: r.error } : {}),
        },
        'actionId' in r ? r.actionId : undefined,
        stepDurationMs,
      );
      // A card ends the turn: the reply is the service's, and Misato carries on after the owner decides (F-033 resume),
      // so the model is never asked to describe an action that is only waiting.
      if ('approvalId' in r && r.approvalId) {
        const approvalIds = 'approvalIds' in r && Array.isArray(r.approvalIds) ? r.approvalIds : [r.approvalId];
        waiting.push(...approvalIds.map((approvalId) => ({ approvalId, tool, reason: r.reason })));
        return finish(
          'done',
          waitingReply(
            requestLanguage(
              message,
              context.map((t) => t.request),
            ),
            tool,
            args,
          ),
        );
      }
    }
    // At the step limit, what did run is reported as done rather than "could not finish".
    if (ranSteps().length) return finish('done', doneReply(lang(), ranSteps()));
    return finish('failed', undefined, `Step limit (${MAX_STEPS}) reached.`);
  }
}
