import type { HistoryPage } from './history.ts';
import { sanitizeVerdict, type PeerVerdict, type VerdictAsk } from './kaji-link.ts';
import type { BaseEntry } from './kaji.ts';
import type { ActionDetail, Approval, Decision, SortieSummary } from './ledger.ts';
import type { SortieEvent } from './events.ts';
import { factKey, type Episode, type Fact } from './memory.ts';
import type { Recalled, Step } from './misato.ts';
import type { ModelChange, ModelSetup } from './model-setup.ts';
import type { UsageRecord } from './model-usage.ts';
import { MODEL_TIMEOUT_MS, type Ask, type Reply } from './model.ts';
import type { OperatorResolution, PublicOperatorInfo } from './operator-directory.ts';
import type { Pilot, PilotPatch } from './pilots.ts';
import type { Effect, Pattern, Stage } from './policy.ts';
import type { QueueSnapshot } from './request-queue.ts';
import type { ListItem, ListView, OwnerList } from './lists.ts';
import type { ActResult, InboxEntry, InboxPage, PushSubscriptionRecord, Reminder, ReminderInput } from './store.ts';
import type { RoleTimingStats } from './timing.ts';

/** Granted MCP tools as Misato sees them, and those suspended (F-021). */
export interface ExternalTools {
  docs: { name: string; effect: string; about: string; args: string; version: string; source: `mcp:${string}` }[];
  byName: Map<string, { server: string; tool: string; fingerprint: string; eva: string }>;
  suspended: { name: string; why: string }[];
}

/** B-094: Misato's reply after a kaji.run, with the results other bases already sent for that sortie; unchanged when none arrived. */
export function withRemoteResults(reply: string, results: string[]): string {
  return results.length ? `${reply}\n\n${results.join('\n')}` : reply;
}
/** What the owner reads when another base answered a kaji.run (F-036 slice 3b). */
export function remoteOutcomeText(
  base: string,
  tool: string,
  result: Record<string, unknown>,
  args: Record<string, unknown> = {},
): string {
  if (typeof result.refused === 'string') return `${base} did not run ${tool}: ${result.refused}.`;
  const o = result.outcome;
  // In plain words (B-011): the item's title or text, from the result or the action's arguments, never raw JSON.
  const r = result.result as Record<string, unknown> | undefined;
  const about = [r?.title, r?.text, args.title, args.text].find(
    (v): v is string => typeof v === 'string' && !!v.trim(),
  );
  if (o === 'grant')
    return typeof result.error === 'string'
      ? `${base} ran ${tool}, and it failed: ${result.error}`
      : `${base} ran ${tool}${about ? ` (“${about.slice(0, 120)}”)` : ''}.`;
  if (o === 'approval') return `${base} asks for your approval to run ${tool}: its card is waiting for you.`;
  if (o === 'uncertain')
    return `${base} could not confirm whether ${tool} finished; inspect its trace before retrying or releasing its resource.`;
  if (o === 'reject')
    return `${base} refused ${tool}: ${String(result.reason ?? 'its gate said no').replace(/[.!?]\s*$/, '')}.`;
  return `${base} answered for ${tool}: ${JSON.stringify(result).slice(0, 400)}`;
}

export interface ChatReply {
  proactive?: true;
  command?: boolean;
  sortieId: string;
  question?: { text: string; expires: string };
  reply?: string;
  error?: string;
  steps: Step[];
  waiting: { approvalId: string; tool: string; reason: string }[];
  /** Set when the main base handled the request (F-036 dispatch): its sortie, cards and memory are there. */
  base?: { id: string; name: string };
  /** Dispatch only: the main base turned the request away before running anything (B-021). */
  refused?: true;
}

/** One other base's seat for an action: its vote arrives when that base answers (F-052). */
export interface PeerSeat {
  seat: string;
  shadow: boolean;
  verdict: Promise<PeerVerdict>;
}

/** A veto-only extra MAGI seat attached by action class (F-025-T01); starts in shadow by default. */
export interface ExtraSeatSpec {
  seat: string;
  effects?: Effect[];
  tools?: string[];
  patterns?: Pattern[];
  shadow?: boolean;
  timeoutMs?: number;
  ask: (ask: VerdictAsk, signal: AbortSignal) => Promise<PeerVerdict>;
}

export function matchesExtraSeat(
  spec: ExtraSeatSpec,
  action: { tool: string; effect: Effect; pattern: Pattern; intent?: boolean },
): boolean {
  const hasFilter = !!(spec.effects?.length || spec.tools?.length || spec.patterns?.length);
  if (!hasFilter) return action.intent ?? action.pattern !== 'green';
  if (spec.effects?.length && !spec.effects.includes(action.effect)) return false;
  if (spec.tools?.length && !spec.tools.includes(action.tool)) return false;
  if (spec.patterns?.length && !spec.patterns.includes(action.pattern)) return false;
  return true;
}

export function runExtraSeat(spec: ExtraSeatSpec, ask: VerdictAsk): PeerSeat {
  const shadow = spec.shadow ?? true;
  const timeoutMs = spec.timeoutMs ?? MODEL_TIMEOUT_MS;
  const controller = new AbortController();
  const t0 = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PeerVerdict>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ vote: 'abstain', reason: 'timed out', durationMs: Math.max(0, Math.round(performance.now() - t0)) });
    }, timeoutMs);
  });
  const asked = Promise.resolve()
    .then(() => spec.ask(ask, controller.signal))
    .then(
      (v) =>
        sanitizeVerdict(v) ?? {
          vote: 'abstain' as const,
          reason: 'invalid verdict',
        },
    )
    .catch((err: unknown): PeerVerdict => ({
      vote: 'abstain',
      reason:
        err instanceof Error && err.message
          ? err.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200)
          : 'seat unavailable',
    }))
    .then((v) => ({
      ...v,
      durationMs: v.durationMs ?? Math.max(0, Math.round(performance.now() - t0)),
    }))
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
  return { seat: spec.seat, shadow, verdict: Promise.race([asked, timedOut]) };
}

/** An action the owner asks for directly: the request is what Casper checks the action against. */
/** `earlier`: the conversation's previous exchanges, for Casper's intent check (B-010). */
export interface OwnerAction {
  request: string;
  tool: string;
  args: Record<string, unknown>;
  stage?: Stage;
  earlier?: { request: string; reply?: string }[];
}

export type ActReply = ActResult & { casperError?: string };

export interface StoreApi {
  dashboardRevision?(): string | Promise<string>;
  modelUsage?(
    before?: number,
    limit?: number,
  ): Promise<{ items: (UsageRecord & { sequence: number })[]; next: number | null }>;
  reminderPage(
    before?: number,
    limit?: number,
  ): HistoryPage<Reminder & { sequence: number }> | Promise<HistoryPage<Reminder & { sequence: number }>>;
  inboxHistory(before?: number, limit?: number): HistoryPage<InboxEntry> | Promise<HistoryPage<InboxEntry>>;
  dashboardHistory(since: string): unknown | Promise<unknown>;
  list(): Reminder[] | Promise<Reminder[]>;
  pendingReminders(): Reminder[] | Promise<Reminder[]>;
  inboxPage(after?: number, limit?: number, afterId?: string): InboxPage | Promise<InboxPage>;
  add(
    title: string,
    due: string,
    now?: Date,
    options?: ReminderInput,
  ): (Reminder & { existing?: true }) | Promise<Reminder & { existing?: true }>;
  update(
    id: string,
    patch: { title?: string; due?: string; kind?: string; end?: string | null },
  ): Reminder | undefined | null | Promise<Reminder | undefined | null>;
  cancel(id: string): boolean | Promise<boolean>;
  showList?(name: string): ListView | null | Promise<ListView | null>;
  toggleListItem?(
    itemId: string,
  ):
    | { list: OwnerList; items: ListItem[]; item: ListItem }
    | null
    | Promise<{ list: OwnerList; items: ListItem[]; item: ListItem } | null>;
  listsShow?(name: string): ListView | null | Promise<ListView | null>;
  listsToggle?(
    itemId: string,
    done?: boolean,
  ):
    | { list: OwnerList; item: ListItem; view: ListView }
    | null
    | Promise<{ list: OwnerList; item: ListItem; view: ListView } | null>;
  pushPublicKey?(): Promise<string> | string;
  savePushSubscription?(sub: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }): Promise<void> | void;
  deletePushSubscription?(endpoint: string): Promise<boolean> | boolean;
  listPushSubscriptions?(): Promise<PushSubscriptionRecord[]> | PushSubscriptionRecord[];
  pushStatus?(): Promise<{ subscribed: boolean; count: number }> | { subscribed: boolean; count: number };
  inbox(): unknown | Promise<unknown>;
  doctor(): object | Promise<object>;
  health(): object | Promise<object>;
  pendingApprovalIds(ids: string[]): string[] | Promise<string[]>;
  approvals(limit?: number): Approval[] | Promise<Approval[]>;
  expiredApprovals?(
    since: string,
  ):
    | { tool: string; sortieId: string; title: string; expired: string }[]
    | Promise<{ tool: string; sortieId: string; title: string; expired: string }[]>;
  decide(
    id: string,
    decision: Decision,
    source?: 'api' | 'dashboard' | 'cli' | 'telegram',
    options?: { useSuggestedFix?: boolean },
  ):
    | { decision: string; result?: unknown; error?: string }
    | Promise<{ decision: string; result?: unknown; error?: string }>;
  act?(action: OwnerAction): Promise<ActReply>;
  chat?(
    message: string,
    conversation?: string,
    options?: {
      requestId?: string;
      signal?: AbortSignal;
      onQueued?: (ahead: number, id: string) => void;
      onPositionChange?: (ahead: number) => void;
    },
  ): Promise<ChatReply>;
  queueStatus?(): QueueSnapshot;
  listsShow?(name: string): Promise<ListView | null> | ListView | null;
  listsToggle?(
    itemId: string,
    done?: boolean,
  ):
    | Promise<{ list: OwnerList; item: ListItem; view: ListView } | null>
    | { list: OwnerList; item: ListItem; view: ListView }
    | null;
  cancelQueued?(id: string): boolean;
  onResumed?(listener: (reply: ChatReply) => void): void;
  reloadModels?(): Promise<{ error?: string; kept?: boolean; models: unknown }>;
  modelSetup?(): Promise<ModelSetup>;
  /** F-045/F-051: the pilot roster for the dashboard (config.json pilots, read now). */
  pilotRoster?(): Pilot[] | Promise<Pilot[]>;
  genericPilot?(): Pilot | Promise<Pilot>;
  changePilotModel?(id: string, model: string): Promise<Pilot[]>;
  addPilot?(entry: Pilot): Promise<Pilot[]>;
  updatePilot?(id: string, patch: PilotPatch): Promise<Pilot[]>;
  setPilotFlag?(id: string, flag: 'pinned' | 'retired', on: boolean): Promise<Pilot[]>;
  changeModels?(change: ModelChange): Promise<{ error?: string; kept?: boolean; models: unknown }>;
  /** Kaji bases with their live status (F-036): online when heard from within the last 90 s. */
  bases?(): Promise<(BaseEntry & { lastSeen: string | null; online: boolean; self: boolean })[]>;
  /** F-070: authenticated public operator directory (no private channel IDs). */
  operators?(): Promise<PublicOperatorInfo[]>;
  resolveOperator?(query: string): Promise<OperatorResolution>;
  /** Lilith for the owner (dashboard): admin-only over REST, never on the read-only socket. */
  lilith?: {
    list(): Promise<Fact[]>;
    episodes(): Promise<Episode[]>;
    add(text: string): Promise<Fact>;
    edit(id: string, text: string): Promise<Fact | null>;
    forget(id: string): Promise<boolean>;
    share(id: string, shareable: boolean): Promise<Fact | null>;
    history(id: string): Promise<unknown[]>;
  };
  consolidate?(): Promise<{ summary?: string; exchanges: number; proposed: number; skipped: number; error?: string }>;
  spear?(
    id: string,
    reason: string,
  ):
    | { revoked: number; stoodDown: number; happened: { actionId: string; tool: string; inverse: string | null }[] }
    | null
    | Promise<{
        revoked: number;
        stoodDown: number;
        happened: { actionId: string; tool: string; inverse: string | null }[];
      } | null>;
  events(sortieId: string, after?: number, limit?: number): SortieEvent[] | Promise<SortieEvent[]>;
  sorties(limit?: number, before?: string, q?: string): SortieSummary[] | Promise<SortieSummary[]>;
  closedSince?(
    since: string,
  ):
    | { done: number; failed: number; failures: { id: string; title: string; closed: string }[] }
    | Promise<{ done: number; failed: number; failures: { id: string; title: string; closed: string }[] }>;
  timingSummary?(since: string): RoleTimingStats[] | Promise<RoleTimingStats[]>;
  sortie(
    id: string,
  ): (SortieSummary & { detail: ActionDetail[] }) | null | Promise<(SortieSummary & { detail: ActionDetail[] }) | null>;
  remoteSortie?(
    baseId: string,
    sortieId: string,
  ): Promise<{
    base: { id: string; name: string };
    sortie: SortieSummary & { detail: ActionDetail[] };
    events: SortieEvent[];
  } | null>;
  ask?(ask: Ask): Promise<Reply>;
}

/**
 * F-046: guard against exact-duplicate memory/reminder adds and enrich memory.edit with oldText.
 */
export function guardActionDuplicates(
  tool: string,
  args: Record<string, unknown>,
  memory: readonly Recalled[],
  steps: readonly Step[],
  pendingReminders: readonly Reminder[],
): { error: string } | { args: Record<string, unknown> } {
  const knownFacts = [
    ...memory.map((m) => ({ id: m.id, text: m.text })),
    ...steps.flatMap((s) =>
      s.tool === 'memory.recall' && Array.isArray(s.result)
        ? (s.result as { id?: unknown; text?: unknown }[]).flatMap((f) =>
            typeof f?.id === 'string' && typeof f?.text === 'string' ? [{ id: f.id, text: f.text }] : [],
          )
        : [],
    ),
  ];
  if (tool === 'memory.remember' && typeof args.text === 'string') {
    const dup = knownFacts.find((f) => factKey(f.text) === factKey(args.text as string));
    if (dup) {
      return {
        error: `Already exists in memory (id ${dup.id}: "${dup.text}"). Do not propose memory.remember; reply to the owner that it already exists.`,
      };
    }
  }
  let nextArgs = args;
  if (tool === 'memory.edit' && typeof args.id === 'string' && typeof args.text === 'string') {
    const existing = knownFacts.find((f) => f.id === args.id);
    if (existing) {
      if (factKey(existing.text) === factKey(args.text)) {
        return {
          error: `Fact ${existing.id} already has that text ("${existing.text}"). Do not propose memory.edit; reply to the owner that it already exists.`,
        };
      }
      if (args.oldText === undefined) nextArgs = { ...args, oldText: existing.text };
    }
  }
  if (tool === 'reminders.add' && typeof args.title === 'string' && typeof args.due === 'string') {
    const normTitle = args.title.trim().replace(/\s+/g, ' ').toLowerCase();
    const targetKind = typeof args.kind === 'string' ? args.kind : 'at';
    const targetDueMs = Date.parse(args.due);
    const dup = pendingReminders.find((r) => {
      if (r.title.trim().replace(/\s+/g, ' ').toLowerCase() !== normTitle) return false;
      if (r.kind !== targetKind) return false;
      if (targetKind === 'all-day') return r.due.slice(0, 10) === (args.due as string).slice(0, 10);
      return Number.isFinite(targetDueMs) && Math.abs(Date.parse(r.due) - targetDueMs) < 60_000;
    });
    if (dup) {
      return {
        error: `This reminder already exists (id ${dup.id}: "${dup.title}", due ${dup.due}). Do not propose reminders.add; reply to the owner that it already exists.`,
      };
    }
  }
  return { args: nextArgs };
}
