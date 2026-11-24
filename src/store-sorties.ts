import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readConfig } from './config.ts';
import { execute, hasExecutor, type AgencyBaseSnapshot, type AgencySnapshot } from './executors.ts';
import type { InstrumentalityRuns } from './instrumentality-runs.ts';
import { Registry } from './kaji.ts';
import type { Decision, Ledger, Proposal } from './ledger.ts';
import { suggestSpellingFix } from './memory.ts';
import { finishPrintPart, isPendingRemotePrint } from './print-job.ts';
import { transaction } from './sqlite-transaction.ts';
import { OWNER_SOURCE, type ActResult, type Store } from './store.ts';
import type { Watch } from './watch.ts';
import type { WorkerJobs, WorkerLease } from './worker-jobs.ts';

export interface StoreSortiesHost {
  readonly store: Store;
  readonly db: DatabaseSync;
  readonly home?: string;
  readonly ledger: Ledger;
  readonly watch: Watch;
  readonly workerJobs: WorkerJobs;
  readonly instrumentality: InstrumentalityRuns;
  syncWatch(now?: Date): unknown;
  watchIsQuiet(now?: Date): boolean;
}

/**
 * Approval delivery, action gating/execution, worker lease fencing, expiry, and sortie/event queries
 * extracted from Store (F-095-T04).
 */
export class StoreSorties {
  private readonly host: StoreSortiesHost;
  private settledOnce = false;

  constructor(host: StoreSortiesHost) {
    this.host = host;
  }

  deliverApproval(approvalId: string, now = new Date()): void {
    const origin = this.host.db
      .prepare('SELECT x.sortie_id AS id FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?')
      .get(approvalId) as { id: string } | undefined;
    if (origin && this.host.watch.get(origin.id) && this.host.watchIsQuiet(now)) return;
    if (this.host.db.prepare('SELECT 1 FROM approval_deliveries WHERE approval_id=?').get(approvalId)) return;
    const row = this.host.db
      .prepare('SELECT x.created FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?')
      .get(approvalId) as { created: string };
    const id = randomUUID();
    // No tool arguments, recipients, fact text or grant handles belong in OS notification bodies.
    this.host.db
      .prepare("INSERT INTO deliveries(id,kind,message,created) VALUES(?,'approval',?,?)")
      .run(id, 'Approval needs review. Open NERV to check its current status.', row.created);
    this.host.db.prepare('INSERT INTO approval_deliveries VALUES(?,?)').run(approvalId, id);
  }

  agencyStatus(target?: string, live?: AgencySnapshot) {
    const pendingReminders = (
      this.host.db
        .prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL')
        .get() as { count: number }
    ).count;
    const instrumentality = this.host.instrumentality.latest();
    const health = {
      state: live?.health.state ?? ('online' as const),
      reasons: live?.health.reasons ?? [],
      pendingReminders,
      ...(live?.routes ? { routes: live.routes } : {}),
      ...(instrumentality ? { instrumentality } : {}),
    };
    const cfg = (() => {
      try {
        return this.host.home ? readConfig(this.host.home) : undefined;
      } catch {
        return undefined;
      }
    })();
    let bases: AgencyBaseSnapshot[] = live?.bases ? [...live.bases] : [];
    if (!bases.length) {
      const reg = new Registry(this.host.db, cfg?.kaji?.root);
      const enrolled = reg.bases();
      if (enrolled.length) {
        const seen = reg.lastSeen();
        const main = reg.main();
        const now = Date.now();
        bases = enrolled.map((b) => {
          const self = cfg?.base.id ? b.baseId === cfg.base.id : false;
          const online =
            b.status === 'enrolled' && (self || (!!seen[b.baseId] && now - Date.parse(seen[b.baseId]!) < 90_000));
          return {
            baseId: b.baseId,
            name: b.name,
            status: b.status,
            self,
            main: b.baseId === main,
            online,
            lastSeen: seen[b.baseId] ?? null,
            health: self ? { state: health.state, reasons: health.reasons } : null,
            channel: null,
          };
        });
      } else {
        const base = cfg?.base ?? { id: 'LOCAL', name: 'This base' };
        bases = [
          {
            baseId: base.id,
            name: base.name,
            status: 'enrolled',
            self: true,
            main: true,
            online: true,
            lastSeen: null,
            health: { state: health.state, reasons: health.reasons },
            channel: null,
          },
        ];
      }
    }
    const filtered = target
      ? bases.filter(
          (b) => b.baseId.toLowerCase() === target.toLowerCase() || b.name.toLowerCase() === target.toLowerCase(),
        )
      : bases;
    return {
      health,
      bases: filtered,
      ...(target && !filtered.length ? { notFound: target } : {}),
    };
  }

  pendingApprovalIds(ids: string[]) {
    return this.host.ledger.pendingApprovalIds(ids);
  }

  expiredApprovals(since: string) {
    return this.host.ledger.expiredSince(since);
  }

  assertWorkerAuthority(owner: string, key: string, ownerKey: string): void {
    if (!this.host.home) throw new Error('Worker identity unavailable.');
    const config = readConfig(this.host.home),
      registry = new Registry(this.host.db, config.kaji?.root);
    if (
      registry.main() !== owner ||
      !registry.bases().some((b) => b.baseId === owner && b.status === 'enrolled' && b.publicKey === ownerKey) ||
      !registry.bases().some((b) => b.baseId === config.base.id && b.status === 'enrolled' && b.publicKey === key)
    )
      throw new Error('Worker authority or destination enrollment changed.');
  }

  releaseWorker(id: string, reason: string, confirmedStopped: boolean): void {
    transaction(this.host.db, () => {
      if (!confirmedStopped) throw new Error('Explicit owner confirmation required.');
      for (const pending of this.host.workerJobs.waitingApprovals())
        if (pending.lease.id === id && !pending.decision) {
          if (pending.hasApproval) this.decideCore(pending.id, 'reject', 'worker-release');
          this.host.workerJobs.persistApprovalDecision(pending.id, 'reject');
        }
      this.host.workerJobs.release(id, reason, confirmedStopped);
    });
  }

  private assertWorker(lease: WorkerLease) {
    this.assertWorkerAuthority(lease.owner, lease.key, lease.ownerKey);
    this.host.workerJobs.assertLease(lease);
  }

  decide(
    id: string,
    decision: Decision,
    source = 'api',
    options?: { useSuggestedFix?: boolean },
  ): { decision: string; result?: unknown; error?: string } {
    const lease = this.host.workerJobs.approval(id);
    if (!lease) return this.decideCore(id, decision, source, options);
    return transaction(this.host.db, () => {
      const row = this.host.db.prepare('SELECT decision FROM approvals WHERE id=?').get(id) as
        { decision: string | null } | undefined;
      if (row?.decision) return this.decideCore(id, decision, source, options);
      if (decision === 'approve')
        try {
          this.assertWorker(lease);
        } catch {
          const rejected = this.decideCore(id, 'reject', 'worker-fence');
          this.host.workerJobs.finish(lease, {
            outcome: 'reject',
            error: 'Worker lease or authority changed before approval; nothing ran.',
          });
          return { ...rejected, error: 'Worker lease or authority changed; nothing ran.' };
        }
      const result = this.decideCore(id, decision, source, options);
      this.host.workerJobs.finish(lease, {
        outcome: result.decision === 'approve' && !result.error ? 'grant' : 'reject',
        ...result,
      });
      return result;
    });
  }

  /**
   * F-021-T04: a worker-bound approval for an MCP tool another base asked for: rejected here, and the worker job ends with
   * the same refusal the main base hears (also on a resend). Nothing would make the call after an approval.
   */
  refuseWorkerApproval(id: string, reason: string): { refused: string } {
    return transaction(this.host.db, () => {
      const lease = this.host.workerJobs.approval(id);
      this.decideCore(id, 'reject', 'kaji-mcp');
      const refused = { refused: reason.slice(0, 500) };
      if (lease) this.host.workerJobs.finish(lease, refused);
      return refused;
    });
  }

  decideCore(
    id: string,
    decision: Decision,
    source = 'api',
    options?: { useSuggestedFix?: boolean },
  ): { decision: string; result?: unknown; error?: string } {
    const proactive = this.host.db
      .prepare(
        'SELECT x.sortie_id AS id FROM approvals a JOIN actions x ON x.id=a.action_id JOIN watch_runs w ON w.sortie_id=x.sortie_id WHERE a.id=?',
      )
      .get(id) as { id: string } | undefined;
    if (proactive) this.host.syncWatch();
    if (decision === 'approve' && options?.useSuggestedFix) {
      const row = this.host.db
        .prepare(
          'SELECT a.decision, x.id AS action_id, x.tool, x.args FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?',
        )
        .get(id) as { decision: string | null; action_id: string; tool: string; args: string } | undefined;
      if (row && !row.decision && row.tool === 'memory.remember') {
        const parsed = JSON.parse(row.args) as { text?: unknown; suggestedText?: unknown };
        if (
          typeof parsed.suggestedText === 'string' &&
          parsed.suggestedText.trim() &&
          parsed.suggestedText !== parsed.text
        ) {
          this.host.db
            .prepare('UPDATE actions SET args=? WHERE id=?')
            .run(JSON.stringify({ text: parsed.suggestedText.trim(), originalText: parsed.text }), row.action_id);
        }
      }
    }
    const applied = this.host.ledger.decide(id, decision, source);
    const action = applied.grantId ? this.host.ledger.grantAction(applied.grantId) : undefined;
    if (applied.grantId && action && !action.used && hasExecutor(action.tool)) {
      const outcome = this.run(action.sortieId, action.actionId, applied.grantId, action.tool, action.args);
      this.settle(action.sortieId, 'error' in outcome ? 'failed' : 'done');
      return { decision: applied.decision, ...outcome };
    }
    const sortie = this.host.db
      .prepare('SELECT x.sortie_id AS id FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?')
      .get(id) as { id: string } | undefined;
    if (sortie && applied.decision !== 'approve') this.settle(sortie.id, 'failed');
    return { decision: applied.decision };
  }

  /** One owner action through the gate (F-017): ballot, then on a grant the executor runs at once; otherwise it waits for the owner or stops. */
  runAction(sortieId: string, proposal: Proposal, worker?: WorkerLease, agency?: AgencySnapshot): ActResult {
    if (this.host.watch.get(sortieId)) this.host.syncWatch();
    if (!worker) return this.runActionCore(sortieId, proposal, undefined, agency);
    return transaction(this.host.db, () => {
      this.assertWorker(worker);
      const result = this.runActionCore(sortieId, proposal, worker.expires, agency);
      if (result.approvalId) this.host.workerJobs.bindApproval(worker, result.approvalId, result);
      return result;
    });
  }

  private runActionCore(
    sortieId: string,
    proposal: Proposal,
    approvalUntil?: number,
    agency?: AgencySnapshot,
  ): ActResult {
    if (proposal.tool === 'memory.remember' && Array.isArray(proposal.args.texts)) {
      const texts = proposal.args.texts;
      const suggestedTexts = Array.isArray(proposal.args.suggestedTexts) ? proposal.args.suggestedTexts : [];
      if (
        texts.length < 2 ||
        texts.length > 10 ||
        texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > 500)
      )
        throw new Error('texts must contain 2 to 10 facts of up to 500 characters each.');
      const unique = new Set(texts.map((text) => text.trim()));
      if (unique.size !== texts.length) throw new Error('Each proposed fact must be distinct.');
      const proposed = transaction(this.host.db, () =>
        texts.map((text, index) => {
          const cleanText = text.trim();
          const explicitFix = typeof suggestedTexts[index] === 'string' ? suggestedTexts[index].trim() : null;
          const suggested = explicitFix && explicitFix !== cleanText ? explicitFix : suggestSpellingFix(cleanText);
          const item = this.host.ledger.propose(
            sortieId,
            {
              ...proposal,
              args: {
                text: cleanText,
                ...(suggested && suggested !== cleanText ? { suggestedText: suggested } : {}),
              },
            },
            new Date(),
            approvalUntil,
          );
          if (!item.approvalId) throw new Error('Every memory fact must reach owner approval.');
          this.deliverApproval(item.approvalId);
          return item;
        }),
      );
      const first = proposed[0]!;
      const approvalIds = proposed.map((item) => item.approvalId!);
      return {
        sortieId,
        actionId: first.actionId,
        outcome: first.ballot.outcome,
        pattern: first.ballot.pattern,
        reason: first.ballot.reason,
        sync: first.ballot.sync,
        approvalId: approvalIds[0],
        approvalIds,
      };
    }
    const normalizedProposal =
      proposal.tool === 'memory.remember' && typeof proposal.args.text === 'string'
        ? (() => {
            const cleanText = proposal.args.text.trim();
            const explicitFix =
              typeof proposal.args.suggestedText === 'string' ? proposal.args.suggestedText.trim() : null;
            const suggested = explicitFix && explicitFix !== cleanText ? explicitFix : suggestSpellingFix(cleanText);
            return suggested && suggested !== cleanText
              ? { ...proposal, args: { ...proposal.args, text: cleanText, suggestedText: suggested } }
              : proposal;
          })()
        : proposal;
    const p = transaction(this.host.db, () => {
      const proposed = this.host.ledger.propose(sortieId, normalizedProposal, new Date(), approvalUntil);
      if (proposed.approvalId) this.deliverApproval(proposed.approvalId);
      return proposed;
    });
    const base: ActResult = {
      sortieId,
      actionId: p.actionId,
      outcome: p.ballot.outcome,
      pattern: p.ballot.pattern,
      reason: p.ballot.reason,
      sync: p.ballot.sync,
      ...(p.approvalId ? { approvalId: p.approvalId } : {}),
    };
    if (p.grantId && hasExecutor(proposal.tool)) {
      const outcome = this.run(sortieId, p.actionId, p.grantId, proposal.tool, proposal.args, agency, true);
      // F-121-T04: a part sent to the slicing base finishes in the coordinator (actions.finished), like an MCP call.
      if ('result' in outcome && isPendingRemotePrint(outcome.result)) return { ...base, ...outcome };
      this.settle(sortieId, 'error' in outcome ? 'failed' : 'done');
      return { ...base, ...outcome };
    }
    // F-021: a granted MCP tool: the single-use grant is used here, the call is made by the tools process.
    if (p.grantId && this.host.ledger.isExternal(proposal.tool)) {
      this.host.ledger.authorize(p.grantId, proposal.tool, proposal.args);
      this.host.ledger.intake(sortieId, 'mcp:' + proposal.tool, 'tainted');
      return { ...base, external: true };
    }
    if (p.ballot.outcome === 'reject') this.settle(sortieId, 'failed');
    return base;
  }

  private run(
    sortieId: string,
    actionId: string,
    grantId: string,
    tool: string,
    args: Record<string, unknown>,
    agency?: AgencySnapshot,
    /** Only the gate's own call (actions.act) leaves a remote slice for the coordinator to send. */
    deferRemote = false,
  ): { result: unknown } | { error: string } {
    this.host.ledger.authorize(grantId, tool, args);
    let outcome: { result: unknown } | { error: string };
    const execT0 = performance.now();
    try {
      outcome = {
        result: execute(this.host.store, tool, args, {
          sortieId,
          tainted: this.host.ledger.trust(sortieId) === 'tainted',
          ...(agency ? { agency } : {}),
        }),
      };
    } catch (e) {
      outcome = { error: e instanceof Error ? e.message : 'Executor failed.' };
    }
    const durationMs = Math.max(0, Math.round(performance.now() - execT0));
    if ('result' in outcome && tool === 'memory.recall') {
      const facts = outcome.result as { tainted: boolean }[];
      this.host.ledger.intake(sortieId, 'tool:' + tool, facts.some((f) => f.tainted) ? 'tainted' : 'trusted');
    }
    // Reminder text predates per-item provenance; treat recalled stored text conservatively.
    if ('result' in outcome && tool === 'reminders.list') this.host.ledger.intake(sortieId, 'tool:' + tool, 'tainted');
    if ('result' in outcome && tool === 'sorties.explain') {
      const res = outcome.result as { id?: string } | { id: string }[];
      const ids = Array.isArray(res) ? res.map((s) => s.id) : res.id ? [res.id] : [];
      this.host.ledger.intake(
        sortieId,
        'tool:' + tool,
        ids.some((id) => this.host.ledger.trust(id) === 'tainted') ? 'tainted' : 'trusted',
      );
    }
    if ('result' in outcome && tool === 'approvals.list') {
      const res = outcome.result as { approvals: { sortieId: string }[]; questions: { sortieId: string }[] };
      const ids = [...res.approvals.map((a) => a.sortieId), ...res.questions.map((q) => q.sortieId)];
      this.host.ledger.intake(
        sortieId,
        'tool:' + tool,
        ids.some((id) => this.host.ledger.trust(id) === 'tainted') ? 'tainted' : 'trusted',
      );
    }
    if ('result' in outcome && tool === 'agency.status') this.host.ledger.intake(sortieId, 'tool:' + tool, 'trusted');
    if ('result' in outcome && isPendingRemotePrint(outcome.result)) {
      if (deferRemote) return outcome;
      // Approved on a card: no coordinator is waiting to send the part, so nothing is sent or half done.
      const { base, prepared } = outcome.result.remote;
      outcome = {
        result: finishPrintPart(prepared, new Error(`approved after the request; ask again to send it to ${base}.`)),
      };
    }
    this.host.ledger.finished(sortieId, actionId, tool, outcome, new Date(), durationMs);
    return outcome;
  }

  private settle(sortieId: string, status: 'done' | 'failed') {
    const sortie = this.host.db.prepare('SELECT source FROM sorties WHERE id=?').get(sortieId) as
      { source: string } | undefined;
    if (sortie?.source === OWNER_SOURCE) this.host.ledger.close(sortieId, status);
    // Proposals (Instrumentality; Marduk Institute pilots, B-026): the sortie is done once the owner has decided every
    // card, whatever the decisions: nothing resumes after them.
    if (
      (sortie?.source === 'instrumentality' || sortie?.source === 'marduk') &&
      !this.host.db
        .prepare(
          'SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=? AND a.decision IS NULL',
        )
        .get(sortieId)
    )
      this.host.ledger.close(sortieId, 'done');
  }

  /**
   * Scheduler tick: stands down approvals past their TTL, then closes the sorties nothing will finish any more (B-026):
   * an owner action or a proposal whose every card is decided (an expired card included). Misato's sorties resume
   * instead. The first tick also closes those left open by an earlier version.
   */
  expire(now = new Date()): number {
    const n = this.host.ledger.expire(now);
    for (const pending of this.host.workerJobs.waitingApprovals())
      transaction(this.host.db, () => {
        // An already issued grant without a terminal receipt is uncertain, never proof that nothing ran.
        if (pending.decision === 'approve') return;
        let invalid = !!pending.decision;
        try {
          this.assertWorkerAuthority(pending.lease.owner, pending.lease.key, pending.lease.ownerKey);
          this.host.workerJobs.assertLease(pending.lease, now.getTime());
        } catch {
          invalid = true;
        }
        if (invalid) {
          if (!pending.decision) {
            if (pending.hasApproval) this.decideCore(pending.id, 'reject', 'worker-fence');
            this.host.workerJobs.persistApprovalDecision(pending.id, 'reject');
          }
          this.host.workerJobs.finish(pending.lease, {
            outcome: 'reject',
            error: 'Worker approval expired or its lease/authority ended; nothing ran.',
          });
        }
      });
    if (n || !this.settledOnce) {
      this.settledOnce = true;
      const stuck = this.host.db
        .prepare(
          `SELECT s.id,s.source FROM sorties s WHERE s.status='open' AND s.source IN (?,'instrumentality','marduk')
     AND EXISTS (SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=s.id)
     AND NOT EXISTS (SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=s.id AND a.decision IS NULL)`,
        )
        .all(OWNER_SOURCE) as { id: string; source: string }[];
      for (const s of stuck) {
        // An owner action whose card expired or was refused did not happen; a proposal is settled whatever was decided.
        const ran = this.host.db.prepare("SELECT 1 FROM events WHERE sortie_id=? AND kind='action.done'").get(s.id);
        this.host.ledger.close(s.id, s.source === OWNER_SOURCE && !ran ? 'failed' : 'done', now);
      }
    }
    return n;
  }

  events(sortieId: string, after = 0, limit = 50) {
    return this.host.ledger.events(sortieId, after, limit);
  }

  sorties(limit = 20, before?: string, q?: string) {
    return this.host.ledger.sorties(limit, before, q);
  }

  sortie(id: string) {
    return this.host.ledger.sortie(id) ?? null;
  }

  closedSince(since: string) {
    return this.host.ledger.closedSince(since);
  }

  timingSummary(since: string) {
    return this.host.ledger.timingSummary(since);
  }

  /** F-021: what an external tool returned, recorded on its action like a built-in tool's result. */
  finishedExternal(
    sortieId: string,
    actionId: string,
    tool: string,
    outcome: { text: string } | { error: string },
    durationMs?: number,
  ) {
    this.host.ledger.finished(
      sortieId,
      actionId,
      tool,
      'error' in outcome ? { error: outcome.error } : { result: { text: outcome.text } },
      new Date(),
      durationMs,
    );
    return true;
  }

  unmatched(domain: string, since: string) {
    return this.host.ledger.unmatched(domain, since);
  }

  shadowVote(
    sortieId: string,
    actionId: string,
    vote: { seat: string; vote: 'approve' | 'reject' | 'abstain'; reason: string; confidence?: number },
  ) {
    this.host.ledger.shadowVote(sortieId, actionId, vote);
    return true;
  }

  explain(ref: string) {
    return this.host.ledger.explain(ref);
  }
}
