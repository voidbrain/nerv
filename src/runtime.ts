import type { WatchWork } from './watch.ts';
import type { SeatPool } from './seat-pool.ts';
import type { WorkerContext, WorkerLease } from './worker-jobs.ts';
import type { InstrumentalityRun } from './instrumentality-runs.ts';
import type { KeyObject } from 'node:crypto';
import { type UsageRecord } from './model-usage.ts';
import { type Method } from './rpc.ts';
import type { HistoryPage } from './history.ts';
import type { ChannelState, HeardChannel } from './channel-state.ts';
import { ProcessClient } from './process-client.ts';
import { RequestQueue, type QueueSnapshot } from './request-queue.ts';
import { ItemLockManager, itemKeysForTool } from './item-locks.ts';
import type { Reminder, ReminderInput, InboxEntry, InboxPage } from './store.ts';
import type { RouteHealth } from './route-health.ts';
import type { ModelChange, ModelSetup } from './model-setup.ts';
import { readConfig } from './config.ts';
import type { ActionDetail, Approval, Decision, SortieSummary } from './ledger.ts';
import type { SortieEvent } from './events.ts';
import type { WorkerLink } from './worker-link.ts';
import {
  MODEL_TIMEOUT_MS,
  type Ask,
  type EnrolledBaseCandidate,
  type OrchestratedProvenance,
  type OrchestrationRequest,
  type OrchestrationSelection,
  type RouteName,
  type WorkerInferReply,
  type WorkerInferRequest,
} from './model.ts';
import type { Effect, Stage } from './policy.ts';
import type { RoleTimingStats, SortieTiming } from './timing.ts';
import type {
  PilotRegistry,
  CombinationEvidenceRef,
  ExecutionChoice,
  Pilot,
  PilotCandidate,
  PilotOffer,
  PilotPatch,
  PilotRecord,
  PlacementAssessment,
  PromotionAuthorityInput,
  QualificationEvidence,
  SubdomainSortie,
  RegisteredPilot,
} from './pilots.ts';
import { callModelWithUsage, loadExternalTools } from './runtime-tools.ts';
import {
  remoteOutcomeText,
  type ActReply,
  type ChatReply,
  type ExtraSeatSpec,
  type ExternalTools,
  type OwnerAction,
  type StoreApi,
} from './runtime-api.ts';
export { remoteOutcomeText };
export type {
  ActReply,
  ChatReply,
  ExtraSeatSpec,
  ExternalTools,
  OwnerAction,
  PeerSeat,
  StoreApi,
} from './runtime-api.ts';
import { RuntimePilots } from './runtime-pilots.ts';
import { RuntimeInstrumentality } from './runtime-instrumentality.ts';
import { RuntimeDispatch } from './runtime-dispatch.ts';
import { RuntimePeers } from './runtime-peers.ts';
import { RuntimeApprovals, type RemoteConsultant } from './runtime-approvals.ts';
import { RuntimeChat, type ChatNoteKind } from './runtime-chat.ts';
import { RuntimePlanning } from './runtime-planning.ts';
import { RuntimeBases, type RemoteSortieLoader } from './runtime-bases.ts';
import { RuntimeRoutes } from './runtime-routes.ts';
import type { RemoteOffer, Step, Turn } from './misato.ts';
import type { Episode, Fact } from './memory.ts';
import type { BaseEntry, SignedRecord } from './kaji.ts';
import type { OperatorResolution, PublicOperatorInfo, SignedOperatorEntry } from './operator-directory.ts';
import type { PeerVerdict, RunItem, VerdictAsk, BaseHealth, HeardHealth, RegistryPort } from './kaji-link.ts';
export class Runtime implements StoreApi {
  readonly nervous: ProcessClient;
  readonly brain: ProcessClient;
  readonly requestQueue = new RequestQueue();
  private readonly itemLocks = new ItemLockManager();
  private readonly home: string | undefined;
  constructor(database: string, brainEntry = new URL('./brain-process.ts', import.meta.url), home?: string) {
    this.home = home;
    this.nervous = new ProcessClient(
      new URL('./nervous-process.ts', import.meta.url),
      home ? [database, home] : [database],
      'nervous',
    );
    this.brain = new ProcessClient(brainEntry, home ? [home] : [], 'brain', 1500);
  }
  /** Persist before dispatch. Missing/late brain replies keep a durable unknown record. */
  private async modelCall(method: Method, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    return callModelWithUsage({ home: this.home, nervous: this.nervous, brain: this.brain, method, params, timeoutMs });
  }
  async modelUsage(before?: number, limit?: number) {
    return (await this.nervous.call('usage.page', {
      ...(before === undefined ? {} : { before }),
      ...(limit === undefined ? {} : { limit }),
    })) as { items: (UsageRecord & { sequence: number })[]; next: number | null };
  }
  async dashboardRevision() {
    return (await this.nervous.call('dashboard.revision')) as string;
  }
  async ready() {
    await this.nervous.call('runtime.ping');
  }
  async reminderPage(before = 0, limit = 20) {
    return (await this.nervous.call('reminders.page', { before, limit })) as HistoryPage<
      Reminder & { sequence: number }
    >;
  }
  async inboxHistory(before = 0, limit = 20) {
    return (await this.nervous.call('inbox.history', { before, limit })) as HistoryPage<InboxEntry>;
  }
  async dashboardHistory(since: string) {
    return this.nervous.call('dashboard.history', { since });
  }
  /** Internal brief reads yield between bounded pages; HTTP callers use reminderPage directly. */
  async list() {
    const items: Reminder[] = [];
    let before = 0;
    do {
      const p = await this.reminderPage(before, 50);
      items.push(...p.items);
      before = p.next ?? 0;
    } while (before);
    return items.sort((a, b) => a.due.localeCompare(b.due));
  }
  async pendingReminders() {
    return (await this.nervous.call('reminders.pending')) as Reminder[];
  }
  async inboxPage(after = 0, limit = 5, afterId?: string) {
    return (await this.nervous.call('inbox.page', { after, limit, ...(afterId ? { afterId } : {}) })) as InboxPage;
  }
  async add(title: string, due: string, _now?: Date, options?: ReminderInput) {
    return (await this.nervous.call('reminders.add', {
      title,
      due,
      ...(options?.kind !== undefined ? { kind: options.kind } : {}),
      ...(options?.end !== undefined ? { end: options.end } : {}),
    })) as Reminder & { existing?: true };
  }
  async update(id: string, patch: { title?: string; due?: string; kind?: string; end?: string | null }) {
    return this.itemLocks.withLock(`reminder:${id}`, () =>
      this.nervous.call('reminders.update', { id, ...patch }),
    ) as Promise<Reminder | null>;
  }
  async cancel(id: string) {
    return this.itemLocks.withLock(`reminder:${id}`, () =>
      this.nervous.call('reminders.cancel', { id }),
    ) as Promise<boolean>;
  }
  async showList(name: string) {
    return (await this.nervous.call('lists.show', { list: name })) as ReturnType<
      import('./lists.ts').ListStore['show']
    >;
  }
  async toggleListItem(itemId: string) {
    return (await this.nervous.call('lists.toggle', { itemId })) as ReturnType<
      import('./lists.ts').ListStore['toggleItemById']
    >;
  }
  async pushPublicKey() {
    return (await this.nervous.call('push.key')) as string;
  }
  async savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string }) {
    await this.nervous.call('push.subscribe', sub);
  }
  async deletePushSubscription(endpoint: string) {
    const res = (await this.nervous.call('push.unsubscribe', { endpoint })) as { ok: boolean };
    return res.ok;
  }
  async pushStatus() {
    return (await this.nervous.call('push.status')) as { subscribed: boolean; count: number };
  }
  async inbox() {
    return this.nervous.call('inbox.list');
  }
  async expiredApprovals(since: string) {
    return (await this.nervous.call('approvals.expired', { since })) as {
      tool: string;
      sortieId: string;
      title: string;
      expired: string;
    }[];
  }
  async pendingApprovalIds(ids: string[]) {
    return (await this.nervous.call('approvals.pendingIds', { ids })) as string[];
  }
  async approvals(limit = 5) {
    return (await this.nervous.call('approvals.pending', { limit })) as Approval[];
  }
  async batteryCards() {
    return (await this.nervous.call('batteries.cards', {})) as ReturnType<import('./store.ts').Store['batteryCards']>;
  }
  async decide(
    id: string,
    decision: Decision,
    source: 'api' | 'dashboard' | 'cli' | 'telegram' = 'api',
    options?: { useSuggestedFix?: boolean },
  ) {
    const pending = await this.approvals(50).catch(() => []);
    const match = pending.find((a) => a.id === id);
    const keys = match ? itemKeysForTool(match.card.tool, match.card.args) : [];
    const result = (await this.itemLocks.withLock(keys, () =>
      this.nervous.call('approvals.decide', {
        id,
        decision,
        source,
        ...(options?.useSuggestedFix ? { useSuggestedFix: true } : {}),
      }),
    )) as {
      decision: string;
      result?: unknown;
      error?: string;
    };
    this.approvalsController.sweepIfResuming();
    return result;
  }
  /** Spear of Longinus for one sortie: revoke its unused grants, stand down its cards, close it; executed effects are reported. */
  async spear(id: string, reason: string) {
    if (!(await this.sortie(id))) return null;
    const result = (await this.nervous.call('sorties.spear', { id, reason })) as {
      remotePending: number;
      revoked: number;
      stoodDown: number;
      happened: { actionId: string; tool: string; inverse: string | null }[];
    };
    if (result.remotePending) this.peersController.triggerCancelRemote();
    const evs = await this.events(id).catch(() => []);
    for (const e of evs) {
      if (e.kind === 'misato.consult') {
        const pid = (e.payload as { pilot?: { id?: string } }).pilot?.id;
        if (pid) this.demotePilotOnSignal(pid, { spear: true });
      }
    }
    return result;
  }
  async closedSince(since: string) {
    return (await this.nervous.call('sorties.closedSince', { since })) as {
      done: number;
      failed: number;
      failures: { id: string; title: string; closed: string }[];
    };
  }
  async timingSummary(since: string) {
    return (await this.nervous.call('sorties.timings', { since })) as RoleTimingStats[];
  }
  async sorties(limit = 20, before?: string, q?: string) {
    return (await this.nervous.call('sorties.list', {
      limit,
      ...(before ? { before } : {}),
      ...(q ? { q } : {}),
    })) as SortieSummary[];
  }
  async sortie(id: string) {
    return (await this.nervous.call('sorties.get', { id })) as
      (SortieSummary & { detail: ActionDetail[]; timings?: SortieTiming[] }) | null;
  }
  async events(sortieId: string, after = 0, limit = 50) {
    return (await this.nervous.call('events.page', { sortieId, after, limit })) as SortieEvent[];
  }
  /** Coordinator side of the gate: open the sortie, ask Casper only for Orange/Blue, then ballot and (on a grant) run in the scheduler process. */
  async act(action: OwnerAction, worker?: WorkerLease): Promise<ActReply> {
    const sortieId = (await this.nervous.call('sorties.open', { title: action.request.slice(0, 500) })) as string;
    return this.gate(sortieId, action, true, worker);
  }
  /** Veto-only extra seats attached by action class (F-025-T01); new seats start in shadow unless `shadow: false`. */
  private readonly startedAt = new Date();
  private _approvalsController?: RuntimeApprovals;
  private get approvalsController(): RuntimeApprovals {
    return (this._approvalsController ??= new RuntimeApprovals({
      nervous: this.nervous,
      itemLocks: this.itemLocks,
      resumeListeners: this.resumeListeners,
      startedAt: this.startedAt,
      modelCall: (method, params, timeoutMs) => this.modelCall(method, params, timeoutMs),
      bases: () => this.bases(),
      baseNames: () => this.baseNames(),
      baseHealth: () => this.baseHealth(),
      routes: () => this.routes(),
      enqueueWatchWork: (fn) => this.instrumentalityController.enqueueWatchWork(fn),
      record: (sortieId, steps, step, actionId) => this.record(sortieId, steps, step, actionId),
      clarificationHistory: (sortieId) => this.clarificationHistory(sortieId),
      loop: (sortieId, request, steps, context, opts) => this.loop(sortieId, request, steps, context, opts),
    }));
  }
  useExtraSeat(spec: ExtraSeatSpec): () => void {
    return this.approvalsController.useExtraSeat(spec);
  }
  /** External/remote consultant without a vote (F-025-T03): receives only Scrolls-allowed data. */
  useRemoteConsultant(consultant: RemoteConsultant | undefined): void {
    this.approvalsController.useRemoteConsultant(consultant);
  }
  /** Free/external API seat pool (F-025-T02): rotates across actions, skips limited/unavailable seats, respects Scrolls. */
  useSeatPool(pool: SeatPool, timeoutMs = MODEL_TIMEOUT_MS): void {
    this.approvalsController.useSeatPool(pool, timeoutMs);
  }
  /**
   * The other bases' seats (F-036 phase 2), on the main base: every online enrolled base not set off, shadow unless set
   * veto. Each vote is a pending promise, so the gate waits only for the seats that count (F-052): serve and tests wire it here.
   */
  usePeerSeats(
    link: { verdict(baseId: string, ask: VerdictAsk, timeoutMs: number): Promise<PeerVerdict> },
    modes: () => Record<string, string>,
    timeoutMs = MODEL_TIMEOUT_MS,
  ) {
    this.approvalsController.usePeerSeats(link, modes, timeoutMs);
  }
  /** On the base asked: this base's Casper votes on the main base's action; no local model means no verdict (abstain). */
  async peerVerdict(ask: VerdictAsk): Promise<PeerVerdict | null> {
    return this.approvalsController.peerVerdict(ask);
  }
  private async gate(sortieId: string, action: OwnerAction, askCasper = true, worker?: WorkerLease): Promise<ActReply> {
    return this.approvalsController.gate(sortieId, action, askCasper, worker);
  }
  /** A new request to Misato (F-003): its text and every step go to the ledger, so the loop can resume later. */
  /** F-036 dispatch: while another base is the main one and online, requests go to its Misato; undefined means answer here. */
  private dispatch?: (
    message: string,
    conversation: string | undefined,
    forwarding: (base: { id: string; name: string }) => Promise<void>,
  ) => Promise<ChatReply | undefined>;
  /** Forwarding to the main base (F-036); `forwarding(base)` is called just before the request goes, so this base records it (F-051). */
  setDispatch(
    fn: (
      message: string,
      conversation: string | undefined,
      forwarding: (base: { id: string; name: string }) => Promise<void>,
    ) => Promise<ChatReply | undefined>,
  ) {
    this.dispatch = fn;
  }
  private pilots?: () => Pilot[];
  /** The pilot roster (F-045), read on every request so a change applies without a restart. */
  setPilots(fn: () => Pilot[]) {
    this.pilots = fn;
  }
  pilotRoster(): Pilot[] {
    try {
      return this.pilots?.() ?? [];
    } catch {
      return [];
    }
  }
  queueStatus(): QueueSnapshot {
    return this.requestQueue.snapshot();
  }
  cancelQueued(id: string): boolean {
    return this.requestQueue.cancel(id);
  }
  private _chatController?: RuntimeChat;
  private get chatController(): RuntimeChat {
    return (this._chatController ??= new RuntimeChat({
      nervous: this.nervous,
      home: this.home,
      kaji: this.kaji,
      requestQueue: this.requestQueue,
      operatorDirectoryState: this.basesController.operatorDirectoryState,
      getDispatch: () => this.dispatch,
      bases: () => this.bases(),
      baseHealth: () => this.baseHealth(),
      channelState: () => this.channelState(),
      updatePostpone: (text) => this.updatePostpone?.(text),
      resolveOperator: (query, opts) => this.resolveOperator(query, opts),
      loop: (sortieId, request, steps, context, opts) => this.loop(sortieId, request, steps, context, opts),
    }));
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
    return this.chatController.chat(message, conversation, options);
  }
  /** Restore through bounded event pages, keeping the original request and the latest clarification context. */
  private async clarificationHistory(sortieId: string) {
    return this.chatController.clarificationHistory(sortieId);
  }
  private note(sortieId: string, kind: ChatNoteKind, payload: object) {
    return this.chatController.note(sortieId, kind, payload);
  }
  /** Records a step, cutting an oversized result so the event stays within its bound. */
  private async record(sortieId: string, steps: Step[], step: Step, actionId?: string, durationMs?: number) {
    return this.chatController.record(sortieId, steps, step, actionId, durationMs);
  }
  /**
   * Misato's loop: plan one action, gate it, show Misato the outcome, repeat until Misato replies or the step limit is
   * reached. When actions wait for the owner, the sortie stays open and resumes once they are decided (F-033).
   */
  private _planningController?: RuntimePlanning;
  private get planningController(): RuntimePlanning {
    return (this._planningController ??= new RuntimePlanning({
      nervous: this.nervous,
      home: this.home,
      modelCall: (method, params, timeoutMs) => this.modelCall(method, params, timeoutMs),
      reminderPage: (offset, limit) => this.reminderPage(offset, limit),
      note: (sortieId, kind, payload) => this.note(sortieId, kind, payload),
      record: (sortieId, steps, step, actionId, durationMs) => this.record(sortieId, steps, step, actionId, durationMs),
      baseNames: () => this.baseNames(),
      revokedBases: () => this.revokedBases(),
      pilots: () => this.pilots?.() ?? [],
      externalTools: () => this.externalTools(),
      getRemoteConsultant: () => this.approvalsController.getRemoteConsultant(),
      proposePilot: (domain) => this.proposePilot(domain),
      remoteOffers: () => this.remoteOffers(),
      remotePilots: () => this.remotePilots(),
      resolveOperator: (query, opts) => this.resolveOperator(query, opts),
      spear: (id, reason) => this.spear(id, reason),
      chatOnce: (message, conversation) => this.chatController.chatOnce(message, conversation),
      gate: (sortieId, action, askCasper, worker) => this.gate(sortieId, action, askCasper, worker),
      toolsProcess: () => this.toolsProcess(),
    }));
  }
  private async loop(
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
    return this.planningController.loop(sortieId, message, steps, context, followup);
  }
  private resumeListeners: ((reply: ChatReply) => void)[] = [];
  /** Called with Misato's follow-up after a resume (Aoba sends it to the owner). */
  onResumed(listener: (reply: ChatReply) => void) {
    this.resumeListeners.push(listener);
  }
  /** What each other base said it lets the main base run there (F-036 slice 3b), from its own heartbeat. */
  private readonly offersHeard = new Map<string, { tools: string[]; at: number }>();
  notePeerOffers(baseId: string, tools: string[]) {
    this.offersHeard.set(baseId, { tools, at: Date.now() });
  }
  private _pilotsController?: RuntimePilots;
  private get pilotsController(): RuntimePilots {
    if (!this._pilotsController) {
      this._pilotsController = new RuntimePilots({
        home: this.home,
        nervous: this.nervous,
        pilotRoster: () => this.pilotRoster(),
        getPilots: () => this.pilots?.() ?? [],
        gate: (sortieId, action, intent) => this.gate(sortieId, action, intent),
        registeredPilots: (now) => this.registeredPilots(now),
        remoteOffers: () => this.remoteOffers(),
      });
    }
    return this._pilotsController;
  }
  private getPilotRegistry(): PilotRegistry {
    return this.pilotsController.getPilotRegistry();
  }
  /** Active local pilots offered to peers in Kaji heartbeats (F-045-T01). */
  offeredPilots(): PilotOffer[] {
    return this.pilotsController.offeredPilots();
  }
  /** Records pilots offered by an enrolled peer in its Kaji heartbeat (F-045-T01). */
  notePeerPilots(baseId: string, pilots: PilotOffer[], now = Date.now()): void {
    this.pilotsController.notePeerPilots(baseId, pilots, now);
  }
  /** Bases online now with something on offer: what Misato may send with kaji.run. */
  /**
   * F-045 detection: after PILOT_THRESHOLD requests in one domain within 30 days that no pilot fitted, NERV proposes a
   * pilot for it on a card (owner-only pilots.create). Not again while that card waits, nor for 30 days after a no.
   */
  proposePilot(domain: string, now = new Date()): Promise<boolean> {
    return this.pilotsController.proposePilot(domain, now);
  }
  private toolsClient?: ProcessClient;
  /** The tools process, started the first time a granted MCP tool is needed (F-021). */
  private toolsProcess(): ProcessClient {
    if (!this.toolsClient)
      this.toolsClient = new ProcessClient(
        new URL('./tools-process.ts', import.meta.url),
        this.home ? [this.home] : [],
        'tools',
        30_000,
      );
    return this.toolsClient;
  }
  private externalCache?: { at: number; value: ExternalTools };
  /**
   * Granted MCP tools Misato may use now (F-021): only those whose description still has the fingerprint they were
   * granted with; a changed or missing one is left out, with the reason, for `nerv tools` and the dashboard.
   */
  async externalTools(force = false): Promise<ExternalTools> {
    const res = await loadExternalTools({
      home: this.home,
      force,
      cache: this.externalCache,
      toolsProcess: () => this.toolsProcess(),
    });
    this.externalCache = res.cache;
    return res.value;
  }
  /** Every enrolled base by id and name (this one included), for Casper and the consultant (B-012); none without the Kaji line. */
  async revokedBases(): Promise<{ id: string; name: string }[]> {
    try {
      return (await this.bases())
        .filter((b) => b.status === 'revoked')
        .slice(0, 20)
        .map((b) => ({ id: b.baseId.slice(0, 16), name: b.name.slice(0, 60) }));
    } catch {
      return [];
    }
  }
  async baseNames(): Promise<{ id: string; name: string }[]> {
    try {
      return (await this.bases())
        .filter((b) => b.status === 'enrolled')
        .slice(0, 20)
        .map((b) => ({ id: b.baseId.slice(0, 16), name: b.name.slice(0, 60) }));
    } catch {
      return [];
    }
  }
  private _dispatchController?: RuntimeDispatch;
  private get dispatchController(): RuntimeDispatch {
    if (!this._dispatchController) {
      this._dispatchController = new RuntimeDispatch({
        home: this.home,
        kaji: this.kaji,
        offersHeard: this.offersHeard,
        bases: () => this.bases(),
        ask: (ask) => this.ask(ask),
        act: (action) => this.act(action),
      });
    }
    return this._dispatchController;
  }
  /** Attaches the negotiated WorkerLink so selection sees peer offers and orchestrated jobs can invoke worker.infer/run. */
  useWorkerLink(link: WorkerLink): void {
    this.dispatchController.useWorkerLink(link);
  }
  /** Independent inference endpoint and execution worker selection (F-006-T02, F-006-T08). */
  async selectExecution(
    req: OrchestrationRequest,
    basesOverride?: readonly EnrolledBaseCandidate[],
  ): Promise<OrchestrationSelection> {
    return this.dispatchController.selectExecution(req, basesOverride);
  }
  private remoteEndpointDegraded(): string[] {
    return this.dispatchController.remoteEndpointDegraded();
  }
  /** Serves a signed worker.infer request through this base's own loopback S² server after strict authorization. */
  async serveRemoteInference(callerBaseId: string, req: WorkerInferRequest): Promise<WorkerInferReply> {
    return this.dispatchController.serveRemoteInference(callerBaseId, req);
  }
  /** Calls an enrolled Tailscale remote inference endpoint over WorkerLink with no silent fallback. */
  async inferRemote(
    targetBaseId: string,
    req: Omit<WorkerInferRequest, 'callerBaseId' | 'targetBaseId'>,
    timeoutMs = MODEL_TIMEOUT_MS,
  ): Promise<WorkerInferReply> {
    return this.dispatchController.inferRemote(targetBaseId, req, timeoutMs);
  }
  /** Joins independent inference and worker selection at execution time with structured provenance and zero fallback. */
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
    return this.dispatchController.runOrchestratedJob(input);
  }
  private _peersController?: RuntimePeers;
  private get peersController(): RuntimePeers {
    if (!this._peersController) {
      this._peersController = new RuntimePeers({
        nervous: this.nervous,
        offersHeard: this.offersHeard,
        resumeListeners: this.resumeListeners,
        getSelfKey: () => this.selfKey,
        bases: () => this.bases(),
        getPilotRegistry: () => this.getPilotRegistry(),
        pilotRoster: () => this.pilotRoster(),
        act: (action, worker) => this.act(action, worker),
        externalTools: () => this.externalTools(),
        toolsProcess: () => this.toolsProcess(),
      });
    }
    return this._peersController;
  }
  async remoteOffers(): Promise<RemoteOffer[]> {
    return this.peersController.remoteOffers();
  }
  /** Pilots registered across this base and online enrolled peer bases (F-045-T01). */
  async registeredPilots(now = Date.now()): Promise<RegisteredPilot[]> {
    return this.peersController.registeredPilots(now);
  }
  /** Pilots offered by online enrolled peer bases (F-045-T01). */
  async remotePilots(now = Date.now()): Promise<{ base: string; name: string; pilots: PilotOffer[] }[]> {
    return this.peersController.remotePilots(now);
  }
  /**
   * Sends the actions queued by kaji.run (F-036 slice 3b), oldest first, each with the same id every time until it reached
   * the base (which runs it once through its own gate and remembers the id). The result reaches the owner as a follow-up.
   */
  startOutbox(
    send: (
      base: string,
      item: RunItem,
      dispatching: () => Promise<void>,
    ) => Promise<{ reached: boolean; result?: unknown; refused?: string }>,
    everyMs = 3000,
    cancel?: (base: string, id: string, reason: string) => Promise<{ status: string; result?: unknown }>,
  ) {
    this.peersController.startOutbox(send, everyMs, cancel);
  }
  /** On the base asked (F-036 slice 3b): an action the main base sent, run once per id, only if this base offers it, and
     always through this base's own gate (it may run, ask the owner with a card, or refuse). */
  readonly worker = {
    cancel: async (owner: string, id: string, reason: string, ownerKey: string) =>
      (await this.nervous.call('worker.cancel', { owner, id, reason, key: this.selfKey, ownerKey })) as {
        status: string;
        result?: unknown;
      },
    open: async (owner: string, session: string, key: string, ownerKey: string) => {
      if (this.selfKey && this.selfKey !== key) throw new Error('Worker key differs.');
      this.selfKey = key;
      return (await this.nervous.call('worker.open', { owner, session, key, ownerKey })) as {
        epoch: number;
        cursor: number;
      };
    },
    close: async (owner: string, session: string) => {
      await this.nervous.call('worker.close', { owner, session });
    },
    run: (owner: string, item: RunItem, context: WorkerContext) =>
      this.runFromPeer(owner, item, this.home ? (readConfig(this.home).kaji?.offers ?? []) : [], context),
    infer: (owner: string, req: WorkerInferRequest) => this.serveRemoteInference(owner, req),
  };
  async runFromPeer(from: string, item: RunItem, offered: string[], context: WorkerContext): Promise<unknown> {
    return this.peersController.runFromPeer(from, item, offered, context);
  }

  /** Resumes every Misato sortie whose wait is over; each is claimed once in the ledger, so two sweeps never resume twice. */
  async sweep(): Promise<void> {
    return this.approvalsController.sweep();
  }
  /** Decisions can come from anywhere (CLI approve, expiry): a periodic sweep catches those the coordinator did not see. */
  startResumer(everyMs = 2000) {
    this.approvalsController.startResumer(everyMs);
  }
  /**
   * B-013: sorties a previous run of the service left half done (cut off by a restart, not waiting for the owner) are
   * closed as interrupted, and the owner is told what had run. Not resumed: an action cut off mid-way may or may not have
   * happened, so the owner decides whether to ask again.
   */
  async closeInterrupted(): Promise<number> {
    return this.approvalsController.closeInterrupted();
  }
  private _instrumentalityController?: RuntimeInstrumentality;
  private get instrumentalityController(): RuntimeInstrumentality {
    if (!this._instrumentalityController) {
      this._instrumentalityController = new RuntimeInstrumentality({
        home: this.home,
        nervous: this.nervous,
        storeApi: this,
        modelCall: (method, params, timeoutMs) => this.modelCall(method, params, timeoutMs),
        gate: (sortieId, action, intent) => this.gate(sortieId, action, intent),
        note: (sortieId, kind, payload) => this.note(sortieId, kind, payload),
        loop: (sortieId, request, steps, earlier, options) => this.loop(sortieId, request, steps, earlier, options),
        routes: () => this.routes(),
      });
    }
    return this._instrumentalityController;
  }
  /**
   * Instrumentality (F-022): Misato's exchanges since the last episode → a summary (kept) and candidate facts, each
   * proposed as a memory.remember card. Facts already known are skipped. The ledger is never changed.
   */
  async consolidate(
    now = new Date(),
    runId?: string,
  ): Promise<{ summary?: string; exchanges: number; proposed: number; skipped: number; error?: string }> {
    return this.instrumentalityController.consolidate(now, runId);
  }
  private readonly kajiListeners = new Set<() => void | Promise<void>>();
  /** The scheduler-process side of the Kaji link's registry. */
  readonly kaji: RegistryPort = {
    bases: async () => (await this.nervous.call('kaji.bases')) as BaseEntry[],
    records: async () => (await this.nervous.call('kaji.records')) as SignedRecord[],
    add: async (records) => {
      const added = (await this.nervous.call('kaji.add', { records })) as number;
      if (added > 0) await Promise.all([...this.kajiListeners].map((fn) => fn()));
      return added;
    },
    seen: async (updates) => {
      await this.nervous.call('kaji.seen', { updates });
    },
    lastSeen: async () => (await this.nervous.call('kaji.lastSeen')) as Record<string, string>,
    main: async () => ((await this.nervous.call('kaji.main')) as string | null) ?? undefined,
    reachability: async (baseId, ok, at) => {
      await this.nervous.call('milestones.health', { scope: 'base', subject: baseId, ok, at });
    },
    onChange: (listener) => {
      this.kajiListeners.add(listener);
      return () => {
        this.kajiListeners.delete(listener);
      };
    },
  };
  private selfKey?: string;
  private _basesController?: RuntimeBases;
  private get basesController(): RuntimeBases {
    return (this._basesController ??= new RuntimeBases({
      home: this.home,
      kaji: this.kaji,
      getSelfKey: () => this.selfKey,
      setSelfKey: (publicKey) => {
        this.selfKey = publicKey;
      },
      health: () => this.health(),
    }));
  }
  /** Marks which entry is this base (by its public key) for the dashboard, and optionally holds its signing key. */
  setBaseKey(publicKey: string, privateKey?: KeyObject) {
    this.basesController.setBaseKey(publicKey, privateKey);
  }
  ownOperatorEntry(): SignedOperatorEntry | undefined {
    return this.basesController.ownOperatorEntry();
  }
  notePeerOperator(baseId: string, entry: SignedOperatorEntry, bases?: BaseEntry[]): void {
    this.basesController.notePeerOperator(baseId, entry, bases);
  }
  async operators(): Promise<PublicOperatorInfo[]> {
    return this.basesController.operators();
  }
  async resolveOperator(query: string, options?: { excludeSelf?: boolean }): Promise<OperatorResolution> {
    return this.basesController.resolveOperator(query, options);
  }
  setChannelState(read: () => ChannelState) {
    this.basesController.setChannelState(read);
  }
  private updatePostpone?: (text: string) => { postponed: boolean; reply?: string } | undefined;
  /** F-102-T02: "aspetta"/"wait" in chat postpones an announced automatic update, answered before planning. */
  setUpdatePostpone(fn: (text: string) => { postponed: boolean; reply?: string } | undefined) {
    this.updatePostpone = fn;
  }
  /** An owner notice into the inbox: every channel (Telegram, web push, dashboard) delivers it from there, once. */
  async notice(message: string): Promise<void> {
    await this.nervous.call('inbox.brief', { message });
  }
  channelState(): ChannelState {
    return this.basesController.channelState();
  }
  notePeerChannel(baseId: string, channel: HeardChannel | null) {
    this.basesController.notePeerChannel(baseId, channel);
  }
  notePeerHealth(baseId: string, health: HeardHealth) {
    this.basesController.notePeerHealth(baseId, health);
  }
  /** This base's health as it reports it to its peers: degraded with the reasons doctor and status give. */
  async baseHealth(): Promise<BaseHealth> {
    return this.basesController.baseHealth();
  }
  async bases() {
    return this.basesController.bases();
  }
  /** The owner's main base as this base sees it (F-036 phase 2): whether it is this base and whether it is online now. */
  async mainBase(): Promise<{ baseId: string; self: boolean; online: boolean } | undefined> {
    return this.basesController.mainBase();
  }
  setRemoteSortie(loader: RemoteSortieLoader): void {
    this.basesController.setRemoteSortie(loader);
  }
  async remoteSortie(baseId: string, sortieId: string) {
    return this.basesController.remoteSortie(baseId, sortieId);
  }
  readonly lilith = {
    list: async () => (await this.nervous.call('memory.list', { limit: 200 })) as Fact[],
    episodes: async () => (await this.nervous.call('memory.episodes', { limit: 10 })) as Episode[],
    add: async (text: string) => (await this.nervous.call('memory.add', { text })) as Fact,
    edit: async (id: string, text: string) =>
      (await this.itemLocks.withLock(`fact:${id}`, () =>
        this.nervous.call('memory.edit', { id, text }),
      )) as Fact | null,
    forget: async (id: string) =>
      (await this.itemLocks.withLock(`fact:${id}`, () => this.nervous.call('memory.forget', { id }))) as boolean,
    share: async (id: string, shareable: boolean) =>
      (await this.itemLocks.withLock(`fact:${id}`, () =>
        this.nervous.call('memory.share', { id, shareable }),
      )) as Fact | null,
    history: async (id: string) => (await this.nervous.call('memory.history', { id })) as unknown[],
  };
  /**
   * Hyuga's brief (F-003, F-028), written into the inbox once a local day at its time, so every channel delivers it from
   * there (Telegram, the menu-bar app, the dashboard) and none sends it twice. The schedule is read on every tick, so a
   * change by chat applies within a minute. `initial` is the last brief sent before briefs lived in the inbox.
   */
  startBrief(
    schedule: () => { at: string; timeZone: string; language: 'it' | 'en'; base?: string } | undefined,
    initial?: string,
    everyMs = 60_000,
  ) {
    this.instrumentalityController.startBrief(schedule, initial, everyMs);
  }
  /** One serial proactive attempt; admission, claim and planner reservations are durable in A. */
  checkWatch(): Promise<ChatReply | null> {
    return this.instrumentalityController.checkWatch();
  }
  /**
   * F-054-T04: the model routes' outages and recoveries for the chronicle. The brain keeps route health in memory; once a
   * minute its view is read and a route down, or back after being down, is recorded with the time it changed. A flap
   * shorter than the poll is not recorded.
   */
  async logRoutes(): Promise<void> {
    return this.instrumentalityController.logRoutes();
  }
  startRouteLog(everyMs = 60_000) {
    this.instrumentalityController.startRouteLog(everyMs);
  }
  startWatch(everyMs = 60_000) {
    this.instrumentalityController.startWatch(everyMs);
  }
  /** Durable claims survive restart; episode checkpoints and scheduled success commit together in A. */
  startInstrumentality(
    schedule: () => { mode?: { at: string } | { when: 'idle' }; timeZone: string },
    everyMs = 60_000,
    clock: () => Date = () => new Date(),
  ) {
    this.instrumentalityController.startInstrumentality(schedule, everyMs, clock);
  }
  private async scheduledHealth(): Promise<{ instrumentality?: InstrumentalityRun | null; degraded: string[] }> {
    return this.instrumentalityController.scheduledHealth();
  }
  /** Re-reads config.json and the cloud key in the brain, without restarting the service. */
  /** F-038: the model settings (never the key), whether the key is there, and what Ollama has. */
  private _routesController?: RuntimeRoutes;
  private get routesController(): RuntimeRoutes {
    return (this._routesController ??= new RuntimeRoutes({
      home: this.home,
      nervous: this.nervous,
      brain: this.brain,
      modelCall: (method, params, timeoutMs) => this.modelCall(method, params, timeoutMs),
      scheduledHealth: () => this.scheduledHealth(),
      remoteEndpointDegraded: () => this.remoteEndpointDegraded(),
      channelState: () => this.channelState(),
    }));
  }
  async modelSetup(): Promise<ModelSetup> {
    return this.routesController.modelSetup();
  }
  /** The base's generic pilot in the most restrictive EVA its stage allows (F-045-T02). */
  genericPilot(): Pilot {
    return this.pilotsController.genericPilot();
  }
  /** F-045-T04: selects a pilot for execution mode by domain and evidence, defaulting to suggest-only. */
  selectPilotForExecution(
    request: string,
    candidates?: readonly (Pilot | RegisteredPilot | PilotCandidate)[],
    opts?: { suggestOnly?: boolean },
  ): ExecutionChoice {
    return this.pilotsController.selectPilotForExecution(request, candidates, opts);
  }
  /** F-045-T05: selects across local and online enrolled peer pilots and verifies remote grant rules. */
  async selectRemotePilotForExecution(
    request: string,
    tool?: string,
    opts?: { suggestOnly?: boolean },
  ): Promise<{ choice: ExecutionChoice; remote: boolean; allowed: boolean; reason?: string }> {
    return this.pilotsController.selectRemotePilotForExecution(request, tool, opts);
  }
  /** F-045-T04: evaluates owner-approved promotion eligibility (never automatic). */
  evaluatePilotPromotion(id: string, record: PilotRecord & { daysInStage?: number }) {
    return this.pilotsController.evaluatePilotPromotion(id, record);
  }
  /** F-006-T10: rechecks candidate artifact identity, protected grader hash, and current NERV authority before promotion. */
  verifyPilotPromotionAuthority(
    id: string,
    input: Omit<PromotionAuthorityInput, 'pilot' | 'policy'> & {
      evidence: CombinationEvidenceRef;
      policy?: PromotionAuthorityInput['policy'];
    },
  ) {
    return this.pilotsController.verifyPilotPromotionAuthority(id, input);
  }
  /** F-025-T04: automatic watermelon trust demotion on failure, override spike, or Spear revocation. */
  demotePilotOnSignal(
    id: string,
    signals: { failure?: boolean; spear?: boolean; overrides?: number; maxOverrides?: number },
  ): { demoted: boolean; from?: Stage; to?: Stage; reason?: string } {
    return this.pilotsController.demotePilotOnSignal(id, signals);
  }
  /** F-045-T06: assesses F-006-T03/T04 individual, combination, and placement evidence without auto-promoting. */
  assessPilotPlacement(
    id: string,
    evidence: readonly QualificationEvidence[],
    opts?: { baseId?: string; partnerPilotIds?: readonly string[] },
  ): PlacementAssessment {
    return this.pilotsController.assessPilotPlacement(id, evidence, opts);
  }
  /** F-045-T06: selects an execution pilot together with its qualification placement assessment (suggest-only). */
  selectQualifiedPilotForExecution(
    request: string,
    evidence: readonly QualificationEvidence[],
    opts?: { partnerPilotIds?: readonly string[]; candidates?: readonly (Pilot | RegisteredPilot | PilotCandidate)[] },
  ) {
    return this.pilotsController.selectQualifiedPilotForExecution(request, evidence, opts);
  }
  /** F-045-T07: resolves a pilot's cloud/other-provider route against configured Models, Scrolls, and trust stage. */
  selectPilotInference(
    id: string,
    input: {
      trust: 'trusted' | 'tainted';
      privacy: 'local-only' | 'owner-bases' | 'any';
      tool?: string;
      effect?: Effect;
    },
  ) {
    return this.pilotsController.selectPilotInference(id, input);
  }
  /** F-045-T08: proposes an owner-approved pilot split when sorties cluster in a higher-scoring subdomain. */
  async proposePilotSplit(parentId: string, sorties: readonly SubdomainSortie[]) {
    return this.pilotsController.proposePilotSplit(parentId, sorties);
  }
  /** F-045-T08: proposes an owner-approved pilot merge when two active pilots overlap with equivalent evidence. */
  async proposePilotMerge(records?: ReadonlyMap<string, PilotRecord & { score?: number }>) {
    return this.pilotsController.proposePilotMerge(records);
  }
  /** F-045-T09: proposes owner-approved tool acquisition or discard for a pilot from missing/unused tool evidence. */
  async proposePilotTools(
    pilotId: string,
    evidence: {
      missingTools?: readonly { tool: string; count: number }[];
      unusedTools?: readonly { tool: string; daysUnused: number; uses?: number }[];
    },
  ) {
    return this.pilotsController.proposePilotTools(pilotId, evidence);
  }
  /** F-045: change one specialist's local model; re-read the roster after discovery so concurrent changes survive. */
  async changePilotModel(id: string, model: string): Promise<Pilot[]> {
    return this.pilotsController.changePilotModel(id, model);
  }
  /** F-045-T02: add a specialist pilot to the local roster. */
  async addPilot(entry: Pilot): Promise<Pilot[]> {
    return this.pilotsController.addPilot(entry);
  }
  /** F-045-T02: rename or update a specialist pilot in the local roster. */
  async updatePilot(id: string, patch: PilotPatch): Promise<Pilot[]> {
    return this.pilotsController.updatePilot(id, patch);
  }
  /** F-045-T02: pin/unpin or retire/restore a specialist pilot in the local roster. */
  async setPilotFlag(id: string, flag: 'pinned' | 'retired', on: boolean): Promise<Pilot[]> {
    return this.pilotsController.setPilotFlag(id, flag, on);
  }
  /** Applies a change (validated, checked against Ollama's models), writes config.json and reloads the brain in place. */
  async changeModels(change: ModelChange) {
    return this.routesController.changeModels(change);
  }
  async reloadModels() {
    return this.routesController.reloadModels();
  }
  async ask(ask: Ask) {
    return this.routesController.ask(ask);
  }
  /** The brain's view of the model routes (F-030); a brain that does not answer is itself the degraded reason. */
  private async routes(): Promise<{ routes?: Record<RouteName, RouteHealth>; degraded: string[] }> {
    return this.routesController.routes();
  }
  async health() {
    return this.routesController.health();
  }
  async doctor() {
    return this.routesController.doctor();
  }
  async close() {
    this.requestQueue.close();
    this.instrumentalityController.stopTimers();
    this.peersController.stopTimers();
    if (this.toolsClient) await this.toolsClient.close();
    this.approvalsController.stopTimers();
    await Promise.allSettled([this.nervous.close(), this.brain.close()]);
  }
}
