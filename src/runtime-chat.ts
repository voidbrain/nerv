import { channelIsFresh, type ChannelState } from './channel-state.ts';
import { helpText, readCommand, statusText, type StatusBase } from './chat-command.ts';
import { builtinPackRegistry, type PackRegistry } from './packs.ts';
import { ownerLanguage, readConfig } from './config.ts';
import type { SortieEvent } from './events.ts';
import { ONLINE_MS, type BaseHealth, type RegistryPort } from './kaji-link.ts';
import { requestLanguage, type Step, type Turn } from './misato.ts';
import { DEFAULT_OPERATOR_NAME, type OperatorDirectory, type OperatorResolution } from './operator-directory.ts';
import type { ProcessClient } from './process-client.ts';
import type { RequestQueue } from './request-queue.ts';
import type { ChatReply, LogVerbosity } from './runtime-api.ts';
import { askedWhy, explainRecord } from './why.ts';

export type ChatNoteKind =
  | 'misato.request'
  | 'misato.step'
  | 'misato.waiting'
  | 'misato.consult'
  | 'pilot.unmatched'
  | 'skill.applied'
  | 'skill.refused'
  | 'kaji.forwarded'
  | 'kaji.answered';

export interface RuntimeChatHost {
  readonly nervous: ProcessClient;
  readonly home?: string;
  readonly kaji: RegistryPort;
  readonly requestQueue: RequestQueue;
  readonly operatorDirectoryState: OperatorDirectory;
  getDispatch():
    | ((
        message: string,
        conversation: string | undefined,
        before: (base: { id: string; name: string }) => Promise<void>,
      ) => Promise<(ChatReply & { base?: { id: string; name: string }; refused?: boolean }) | undefined>)
    | undefined;
  bases(): Promise<StatusBase[]>;
  baseHealth(): Promise<BaseHealth>;
  channelState(): ChannelState;
  /** F-102-T02: "aspetta"/"wait" postpones an announced automatic update; undefined when nothing is scheduled. */
  updatePostpone?(text: string): { postponed: boolean; reply?: string } | undefined;
  /** Delivers a proactive notice line (e.g. an expired cooking timer) into the owner's inbox. */
  notice?(message: string): Promise<void>;
  packRegistry?: PackRegistry;
  resolveOperator(query: string, opts: { excludeSelf?: boolean }): Promise<OperatorResolution>;
  loop(
    sortieId: string,
    request: string,
    steps: Step[],
    context: Turn[],
    opts?: { answering?: boolean; consult: boolean; advice?: string; conversation?: string },
  ): Promise<ChatReply>;
}

/**
 * Chat entry point, command handling, clarification history, and sortie note/record helpers
 * extracted from Runtime (F-095-T03).
 */
export class RuntimeChat {
  private readonly host: RuntimeChatHost;
  /** F-056-T03: per-conversation trace verbosity set via /log. */
  private readonly logLevels = new Map<string, LogVerbosity>();

  constructor(host: RuntimeChatHost) {
    this.host = host;
  }

  logLevel(conversation?: string): LogVerbosity {
    return this.logLevels.get(conversation ?? 'cli') ?? 'conversation';
  }

  chat(
    message: string,
    conversation?: string,
    options?: {
      requestId?: string;
      signal?: AbortSignal;
      onQueued?: (ahead: number, id: string) => void;
      onPositionChange?: (ahead: number) => void;
    },
  ): Promise<ChatReply> {
    if (readCommand(message)) return this.chatOnce(message, conversation);
    const key = conversation ?? 'cli';
    return this.host.requestQueue.enqueue({
      ...(options?.requestId ? { id: options.requestId } : {}),
      conversation: key,
      title: message.slice(0, 500),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.onQueued ? { onQueued: options.onQueued } : {}),
      ...(options?.onPositionChange ? { onPositionChange: options.onPositionChange } : {}),
      run: () => this.chatOnce(message, conversation),
    });
  }

  async chatOnce(message: string, conversation?: string): Promise<ChatReply> {
    // The owner's "aspetta"/"wait" for an announced update is answered here; with nothing scheduled it is ordinary chat.
    const postponed = this.host.updatePostpone?.(message);
    if (postponed?.postponed && postponed.reply)
      return { command: true, sortieId: '', reply: postponed.reply, steps: [], waiting: [] };
    const command = readCommand(message);
    if (command) {
      const it = requestLanguage(message, [], ownerLanguage(this.host.home)) === 'it';
      const lang: 'en' | 'it' = it ? 'it' : 'en';
      let reply: string;
      if (command.name === 'status') {
        let bases: StatusBase[] = await this.host.bases();
        if (!bases.length) {
          const base = this.host.home ? readConfig(this.host.home).base : { id: 'LOCAL', name: 'This base' };
          const health = await this.host.baseHealth();
          const channel = this.host.channelState();
          bases = [
            {
              baseId: base.id,
              name: base.name,
              self: true,
              online: true,
              health,
              channel,
              channelFresh: channelIsFresh(channel, Date.now(), ONLINE_MS),
            },
          ];
        }
        reply = statusText(bases, command.target, lang);
      } else if (command.name === 'bases') {
        const bases = await this.host.bases();
        reply = bases.length
          ? bases
              .map((b) => `${b.baseId} · ${b.name} (${b.online ? 'online' : 'offline'}${b.self ? ', self' : ''})`)
              .join('\n')
          : it
            ? 'Nessuna base registrata.'
            : 'No enrolled bases.';
      } else if (command.name === 'cards') {
        const pending = (await this.host.nervous.call('approvals.pending', { limit: 10 })) as {
          id: string;
          card: { tool: string; pattern: string };
        }[];
        reply = pending.length
          ? pending.map((a) => `${a.id.slice(0, 8)} · ${a.card.tool} (${a.card.pattern})`).join('\n')
          : it
            ? 'Nessuna scheda in attesa.'
            : 'No pending approval cards.';
      } else if (command.name === 'reminders') {
        const list = (await this.host.nervous.call('reminders.pending')) as {
          title: string;
          due: string;
          dueLocal?: string;
        }[];
        reply = list.length
          ? list.map((r) => `${r.dueLocal ?? r.due} · ${r.title}`).join('\n')
          : it
            ? 'Nessun promemoria in attesa.'
            : 'No pending reminders.';
      } else if (command.name === 'why') {
        const ref = command.target
          ? (askedWhy('why ' + command.target) ??
            (/^[0-9a-f]{4,36}$/i.test(command.target) ? command.target.toLowerCase() : undefined))
          : undefined;
        if (!ref) {
          reply = it ? 'Specifica un riferimento, es. /why S-1A2B.' : 'Specify a reference, e.g. /why S-1A2B.';
        } else {
          const found = (await this.host.nervous.call('sorties.explain', { ref })) as Parameters<
            typeof explainRecord
          >[0];
          reply = explainRecord(
            found,
            ref,
            lang,
            this.host.home ? readConfig(this.host.home).timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone,
          );
        }
      } else if (command.name === 'brief') {
        const cfg = this.host.home ? readConfig(this.host.home) : undefined;
        const at = cfg?.brief?.at ?? '08:00';
        const tz = cfg?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const history = (await this.host.nervous
          .call('dashboard.history', { since: new Date(0).toISOString() })
          .catch(() => null)) as { brief?: { message: string; created: string } | null } | null;
        const scheduleLine = it ? `Brief programmato alle ${at} (${tz}).` : `Brief scheduled at ${at} (${tz}).`;
        reply = history?.brief?.message
          ? `${scheduleLine}\n\n${history.brief.message}`
          : `${scheduleLine} ${it ? 'Nessun brief recente.' : 'No recent brief.'}`;
      } else if (command.name === 'pilots') {
        const pilots = this.host.home ? (readConfig(this.host.home).pilots ?? []) : [];
        reply = pilots.length
          ? pilots.map((p) => `${p.id} · ${p.name} (${p.stage})`).join('\n')
          : it
            ? 'Nessun pilota specialistico configurato.'
            : 'No specialist pilots configured.';
      } else if (command.name === 'spear') {
        const list = ((await this.host.nervous.call('sorties.list', { limit: 20 }).catch(() => [])) ?? []) as {
          id: string;
          title: string;
          status: string;
        }[];
        const active = list.filter((s) => s.status === 'open' || s.status === 'waiting');
        const wanted = command.target?.trim().replace(/^s-/i, '').toLowerCase();
        const target = wanted
          ? active.find((s) => s.id.toLowerCase() === wanted || s.id.toLowerCase().startsWith(wanted))
          : active[0];
        if (!target) {
          reply = it ? 'Nessuna sortita attiva o in attesa da fermare.' : 'No active or waiting sortie to stop.';
        } else {
          const ref = `S-${target.id.slice(0, 4).toUpperCase()}`;
          reply = it ? `Conferma Spear per ${ref} (${target.title}).` : `Confirm Spear for ${ref} (${target.title}).`;
          return {
            command: true,
            sortieId: '',
            reply,
            confirmSpear: { sortieId: target.id, ref, goal: target.title },
            steps: [],
            waiting: [],
          };
        }
      } else if (command.name === 'log') {
        const level = command.target?.toLowerCase();
        if (level === 'conversation' || level === 'steps' || level === 'all') {
          const key = conversation ?? 'cli';
          this.logLevels.set(key, level);
          await this.host.nervous
            .call('sorties.open', {
              source: 'owner',
              title: `Log verbosity set to ${level} (${key})`,
            })
            .then((id) =>
              this.host.nervous.call('sorties.finish', {
                sortieId: id,
                status: 'done',
                reply: `Log verbosity set to ${level}.`,
              }),
            )
            .catch(() => {});
          reply = it ? `Dettaglio log impostato su: ${level}.` : `Log verbosity set to: ${level}.`;
          return { command: true, sortieId: '', reply, logLevel: level, steps: [], waiting: [] };
        } else {
          reply = it ? 'Usa /log conversation|steps|all.' : 'Usage: /log conversation|steps|all.';
        }
      } else {
        reply =
          (command.name === 'unknown' ? (it ? 'Comando non supportato.\n' : 'Unknown command.\n') : '') +
          helpText(lang);
      }
      return { command: true, sortieId: '', reply, steps: [], waiting: [] };
    }
    // F-083-T06 / F-083-T07: a cooking session answers from the saved recipe and manages session timers; with no session or no such recipe, it is chat.
    const packsConfig = this.host.home ? readConfig(this.host.home).packs : undefined;
    const phraseMatch = (this.host.packRegistry ?? builtinPackRegistry).resolveChatPhrase(message, packsConfig);
    if (phraseMatch && 'ambiguous' in phraseMatch) {
      const it = requestLanguage(message, [], ownerLanguage(this.host.home)) === 'it';
      const names = phraseMatch.ambiguous.join(', ');
      const reply = it
        ? `Più pacchetti corrispondono a questo messaggio (${names}). Quale vuoi usare?`
        : `Multiple packs match this message (${names}). Which one did you mean?`;
      return { command: true, sortieId: '', reply, steps: [], waiting: [] };
    }
    const packReply = await (this.host.packRegistry ?? builtinPackRegistry).handleChatMessage(
      message,
      conversation ?? 'cli',
      {
        findDocument: (query) => this.host.nervous.call('documents.find', { query }).catch(() => null),
        notice: this.host.notice,
      },
      packsConfig,
    );
    if (packReply) return { command: true, sortieId: '', reply: packReply, steps: [], waiting: [] };
    const key = conversation ?? 'cli';
    const addressed =
      /^(?:tell|ask)\s+([A-Za-z0-9][A-Za-z0-9._-]{0,31})(?:\s+on\s+(another\s+base|[A-Za-z0-9][A-Za-z0-9._-]{0,39}))?\b/i.exec(
        message.trim(),
      );
    if (addressed) {
      const opQuery = addressed[1]!;
      const targetBase = addressed[2];
      const excludeSelf = !!targetBase && /^another\s+base$/i.test(targetBase);
      if (
        excludeSelf ||
        opQuery.toLowerCase() === DEFAULT_OPERATOR_NAME.toLowerCase() ||
        this.host.operatorDirectoryState.hasKnownOrRetiredAlias(opQuery)
      ) {
        if (!targetBase || excludeSelf) {
          const resolution = await this.host.resolveOperator(opQuery, { excludeSelf });
          if (resolution.status !== 'resolved') {
            return { sortieId: '', reply: resolution.message, steps: [], waiting: [] };
          }
        }
      }
    }
    const question = (await this.host.nervous.call('misato.question', { conversation: key })) as {
      sortieId: string;
      sequence: number;
      text: string;
      expires: string;
      forwarded?: { id: string; name: string };
    } | null;
    if (question && !question.forwarded) {
      const claimed = await this.host.nervous.call('misato.answer', {
        conversation: key,
        sequence: question.sequence,
        text: message,
      });
      if (!claimed)
        return {
          sortieId: question.sortieId,
          error: 'The question no longer waits for an answer.',
          steps: [],
          waiting: [],
        };
      const history = await this.clarificationHistory(question.sortieId);
      return this.host.loop(question.sortieId, message, history.steps, history.context, {
        answering: true,
        consult: message.trim().split(/\s+/u).length > 8,
        advice: history.advice,
        conversation: key,
      });
    }
    if (question?.forwarded && (await this.host.kaji.main?.()) !== question.forwarded.id)
      return {
        sortieId: question.sortieId,
        error:
          'The answering base is no longer the main base. The question stays waiting; this answer was not run locally.',
        steps: [],
        waiting: [],
      };
    // Earlier exchanges of the same conversation (read before this request is recorded), so "yes" has its question.
    const context = conversation
      ? ((await this.host.nervous.call('misato.context', { conversation }).catch(() => [])) as Turn[])
      : [];
    // F-051: a request going to the main base is a sortie here too: opened when it leaves, closed with the answer.
    let forwarded: string | undefined;
    let forwardedAt = 0;
    const dispatch = this.host.getDispatch();
    const far = dispatch
      ? await dispatch(message, conversation, async (base) => {
          forwardedAt = performance.now();
          forwarded =
            question?.sortieId ??
            ((await this.host.nervous.call('sorties.open', {
              title: message.slice(0, 500),
              source: 'misato',
            })) as string);
          if (!question)
            await this.note(forwarded, 'misato.request', {
              text: message,
              ...(conversation ? { conversation } : {}),
            });
          await this.note(forwarded, 'kaji.forwarded', { base });
        }).catch(() => undefined)
      : undefined;
    if (far) {
      if (!forwarded) return far;
      const transferMs = forwardedAt ? Math.max(0, Math.round(performance.now() - forwardedAt)) : undefined;
      await this.note(forwarded, 'kaji.answered', {
        base: far.base ?? { id: '', name: '' },
        sortieId: far.sortieId,
        ...(transferMs !== undefined ? { transferMs } : {}),
      });
      // B-021: an answer the main base turned away outright never reached its Misato: the question still waits here.
      if (question && far.refused) return { ...far, sortieId: forwarded };
      // B-021: once sent, the answer is the main base's. A late or failed reply (it may have taken the answer and moved
      // on) closes this copy like any forwarded request, so a later message is never taken as a second answer here.
      if (question)
        await this.host.nervous.call('misato.answer', {
          conversation: key,
          sequence: question.sequence,
          text: message,
        });
      if (far.question && far.reply)
        await this.host.nervous.call('misato.ask', {
          sortieId: forwarded,
          text: far.reply,
          conversation: key,
          forwarded: far.base ?? question?.forwarded,
        });
      else
        await this.host.nervous.call('sorties.finish', {
          sortieId: forwarded,
          status: far.reply ? 'done' : 'failed',
          ...(far.reply ? { reply: far.reply } : {}),
        });
      return { ...far, sortieId: forwarded };
    }
    if (question)
      return {
        sortieId: question.sortieId,
        error: 'The answering base is unavailable. The question stays waiting; this answer was not run locally.',
        steps: [],
        waiting: [],
      };
    // Not forwarded, or the main base dropped out: answered here, in the sortie already opened if there is one.
    const sortieId =
      forwarded ??
      ((await this.host.nervous.call('sorties.open', { title: message.slice(0, 500), source: 'misato' })) as string);
    if (!forwarded)
      await this.note(sortieId, 'misato.request', { text: message, ...(conversation ? { conversation } : {}) });
    // B-004: "why S-1A2B …?" is answered from the ledger, never by the model (which has no tool to read it and guessed).
    const ref = askedWhy(message);
    if (ref) {
      const found = (await this.host.nervous.call('sorties.explain', { ref })) as Parameters<typeof explainRecord>[0];
      const reply = explainRecord(
        found,
        ref,
        requestLanguage(
          message,
          context.map((t) => t.request),
          ownerLanguage(this.host.home),
        ),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      await this.host.nervous.call('sorties.finish', { sortieId, status: 'done', reply });
      return { sortieId, reply, steps: [], waiting: [] };
    }
    return this.host.loop(sortieId, message, [], context, { consult: true, conversation: key });
  }

  /** Restore through bounded event pages, keeping the original request and the latest clarification context. */
  async clarificationHistory(sortieId: string) {
    const events: SortieEvent[] = [];
    let after = 0;
    for (;;) {
      const page = (await this.host.nervous.call('events.page', { sortieId, after, limit: 50 })) as SortieEvent[];
      if (!page.length) break;
      events.push(...page);
      after = page.at(-1)!.sequence;
    }
    const request = events.find((e) => e.kind === 'misato.request');
    const original = request?.kind === 'misato.request' ? request.payload.text : '';
    const context: Turn[] = [];
    for (const e of events) {
      if (e.kind === 'misato.asked')
        context.push({ request: context.length ? context.at(-1)!.request : original, reply: e.payload.text });
      if (e.kind === 'misato.answered') context.push({ request: e.payload.text });
    }
    // The current answer is the request, not an earlier exchange. Always retain the original intent.
    context.pop();
    const earlier = context.slice(-2);
    if (earlier[0]?.request !== original) earlier.unshift({ request: original });
    const advice = events.find((e) => e.kind === 'misato.consult');
    const answer = events.filter((e) => e.kind === 'misato.answered').at(-1);
    return {
      answer: answer?.kind === 'misato.answered' ? answer.payload.text : undefined,
      steps: events.flatMap((e) => (e.kind === 'misato.step' ? [e.payload.step] : [])),
      context: earlier.map((t) => ({
        request: t.request.slice(0, 1000),
        ...(t.reply ? { reply: t.reply.slice(0, 1000) } : {}),
      })),
      advice: advice?.kind === 'misato.consult' ? advice.payload.advice : undefined,
      conversation: request?.kind === 'misato.request' ? request.payload.conversation : undefined,
    };
  }

  note(sortieId: string, kind: ChatNoteKind, payload: object) {
    return this.host.nervous.call('misato.note', { sortieId, kind, payload });
  }

  /** Records a step, cutting an oversized result so the event stays within its bound. */
  async record(sortieId: string, steps: Step[], step: Step, actionId?: string, durationMs?: number) {
    const fitted = JSON.stringify(step).length > 12000 ? { ...step, result: { truncated: true } } : step;
    steps.push(fitted);
    await this.note(sortieId, 'misato.step', {
      step: fitted,
      ...(actionId ? { actionId } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }
}
