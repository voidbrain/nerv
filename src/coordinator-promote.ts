import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readCoordinatorFencingState } from './coordinator-authority.ts';
import {
  RELOCATION_HORIZON_CONSERVATIVE_MS,
  RelocationRefusedError,
  STANDBY_DB_FILE,
  checkRelocationReadiness,
  checkStandbyCandidate,
  ranOrAckedCoordinatorEpoch,
  relocateCoordinator,
  standbyLastAckMs,
  verifyDrainReceipt,
  type RelocateCoordinatorInput,
  type RelocateCoordinatorResult,
  type RelocationLiveness,
  type SignedDrainReceipt,
} from './coordinator-relocation.ts';
import { databasePath, readConfig } from './config.ts';
import { Registry, canonical, keyIdentity, publicKeyFrom, type SignedRecord } from './kaji.ts';
import type { EpochPushReply } from './kaji-link.ts';
import {
  allUnrevokedAckedEpoch,
  basesAckedEpoch,
  probeCoordinatorEpochs,
  pushCoordinatorEpoch,
  standbyBasesAckedEpoch,
} from './coordinator-epoch.ts';
import { service } from './service.ts';
import { addRegistryRecords, stageRegistryRecords } from './coordinator-relocation-bundle.ts';
import { applyCoordinatorLease } from './coordinator-lease.ts';

/** While this file exists in the data home a promotion is unfinished and `serve` refuses to start. */
export const PROMOTION_MARKER_FILE = 'coordinator-promotion.json';

function registryIsEmpty(path: string): boolean {
  const db = new DatabaseSync(path);
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='registry'").get()) return true;
    return !db.prepare('SELECT 1 FROM registry LIMIT 1').get();
  } finally {
    db.close();
  }
}

/** The serve swap guard (F-016-T17): no coordinator loops run while a promotion swaps the stores. */
export function assertNoPromotionInProgress(home: string): void {
  if (existsSync(join(home, PROMOTION_MARKER_FILE)))
    throw new Error(
      'A coordinator promotion is in progress: finish it with nerv kaji promote before starting NERV Agency.',
    );
}

export interface PromotionServiceControl {
  stop(): void | Promise<void>;
  start(): void | Promise<void>;
}

export interface PromotionClock {
  wall(): number;
  mono(): bigint;
  sleep(ms: number): Promise<void>;
}

const systemClock: PromotionClock = {
  wall: () => Date.now(),
  mono: () => process.hrtime.bigint(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * The installed service (launchd, systemd or the Windows task); a NERV run by hand must be stopped first.
 * Idempotent (F-016-T17 review): a stop that fails while nothing answers counts as stopped, a start that fails
 * while NERV answers counts as started, and every run starts the service, a resumed one too.
 */
export function installedPromotionService(
  home: string,
  deps: {
    readonly service: (action: 'stop' | 'start', home: string) => void;
    readonly answering: () => Promise<boolean>;
    readonly sleep: (ms: number) => Promise<void>;
  } = {
    service,
    answering: async () => {
      try {
        await fetch(`http://127.0.0.1:${readConfig(home).port}/api/status`, { signal: AbortSignal.timeout(500) });
        return true;
      } catch {
        return false;
      }
    },
    sleep: systemClock.sleep,
  },
): PromotionServiceControl {
  const notInstalled = (err: unknown) => /not installed/.test((err as Error).message);
  return {
    async stop() {
      let failure: unknown;
      try {
        deps.service('stop', home);
      } catch (err) {
        if (!notInstalled(err)) failure = err;
      }
      for (let i = 0; i < 60 && (await deps.answering()); i++) await deps.sleep(250);
      if (await deps.answering()) {
        if (failure) throw failure;
        throw new Error('NERV Agency still answers on its port: stop it (Ctrl+C or service stop) and run again.');
      }
    },
    async start() {
      try {
        deps.service('start', home);
      } catch (err) {
        if (notInstalled(err) || (await deps.answering())) return;
        throw err;
      }
    },
  };
}

export interface PromoteCoordinatorInput {
  readonly home: string;
  readonly rootPublicKey: string | undefined;
  readonly ownPublicKey: string;
  /** Planned move: the signed receipt `nerv kaji drain` wrote on the old main. */
  readonly drainReceiptFile?: string;
  readonly service: PromotionServiceControl;
  readonly clock?: PromotionClock;
  readonly log?: (line: string) => void;
  /**
   * `KajiLink.pushEpoch`: before the readiness check the owner-signed records go to every enrolled, unrevoked
   * base (F-016-T18); the acks are recorded here and decide `allUnrevokedAckedNewEpoch`.
   */
  readonly pushEpoch?: (baseId: string, records: SignedRecord[]) => Promise<EpochPushReply>;
  /**
   * B-124: the records of a `kaji relocate` bundle (`--relocation FILE`). The checks read them as if held, on
   * connections of their own; they are stored here, and pushed, only once the local check and the probe passed.
   */
  readonly relocation?: readonly SignedRecord[];
  /** Test-only crash injection, passed to the promotion swap. */
  readonly failAfterStep?: RelocateCoordinatorInput['failAfterStep'];
}

export type PromoteCoordinatorResult =
  | RelocateCoordinatorResult
  | { readonly resumed: true; readonly newEpoch: number }
  | {
      /** B-124: the old main took its own coordinator state back at a new epoch (the way out of a refused move). */
      readonly reinstated: true;
      readonly newEpoch: number;
      readonly previousEpoch: number;
      readonly leaseExpiresAt: number;
    };

/**
 * B-124 way out: a base with no standby store whose own store holds coordinator state (active, draining or
 * fenced) at an epoch a main record named it for, now named again at a later epoch. Returns that epoch.
 */
function reinstateEpoch(
  db: DatabaseSync,
  registry: Registry,
  selfBaseId: string,
  newEpoch: number,
  standbyDbPath: string,
): number | undefined {
  if (existsSync(standbyDbPath) || registry.main() !== selfBaseId) return undefined;
  const state = readCoordinatorFencingState(db);
  if (!state || state.replicationMode === 'standby' || state.coordinatorEpoch >= newEpoch) return undefined;
  const ran = registry
    .records()
    .some(
      (r) =>
        r.body.kind === 'main' && r.body.baseId === selfBaseId && r.body.coordinatorEpoch === state.coordinatorEpoch,
    );
  return ran ? state.coordinatorEpoch : undefined;
}

/**
 * B-124 way out, after the probe found no base that ran or acked a later epoch than this base's own state and the
 * new records were pushed: the state moves to the new epoch, fenced with no lease, so the lease keeper re-arms it
 * only when its standby acks the new epoch (a sole coordinator arms its own lease here, as a promotion does).
 */
function reinstateCoordinator(
  mainDbPath: string,
  previousEpoch: number,
  newEpoch: number,
  sole: boolean,
  clock: PromotionClock,
): number {
  const db = new DatabaseSync(mainDbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('BEGIN IMMEDIATE');
    try {
      const state = readCoordinatorFencingState(db);
      if (!state || state.replicationMode === 'standby' || state.coordinatorEpoch !== previousEpoch)
        refuse('epoch_not_next', `This base's coordinator state is no longer at epoch ${previousEpoch}.`);
      db.prepare(
        `UPDATE coordinator_state SET coordinator_epoch = ?, coordinator_fence = coordinator_fence + 1,
           replication_mode = ?, lease_issued_at = NULL, lease_expires_at = 0 WHERE id = 1`,
      ).run(newEpoch, sole ? 'active' : 'fenced');
      const leaseExpiresAt = sole
        ? applyCoordinatorLease(db, {
            coordinatorEpoch: newEpoch,
            reqStartedWallMs: clock.wall(),
            reqStartedMonoNs: clock.mono(),
          }).leaseExpiresAt
        : 0;
      db.exec('COMMIT');
      return leaseExpiresAt;
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    db.close();
  }
}

type Derived =
  | { readonly alreadyActive: true; readonly newEpoch: number }
  | {
      readonly alreadyActive: false;
      readonly relocation: Omit<RelocateCoordinatorInput, 'liveness' | 'nowMs'>;
      readonly liveness: (nowMs: number, monoNowNs: bigint) => RelocationLiveness;
      readonly candidatePath: string;
    };

function refuse(reason: ConstructorParameters<typeof RelocationRefusedError>[0], detail: string): never {
  throw new RelocationRefusedError(reason, detail);
}

/**
 * Every safety input comes from records this base verified, never from the caller: this base and the new
 * main and epoch from the newest owner-signed main record; the previous main from the main record at the
 * standby's epoch; its key from its enrolment; a revoke of it from the registry; when this base first held
 * the new record from the registry's receipt time; the last lease ack from `standby_lease_state`.
 */
function derive(
  input: PromoteCoordinatorInput,
  mainDbPath: string,
  standbyDbPath: string,
  monoSinceNs: bigint,
): Derived {
  const db = new DatabaseSync(mainDbPath);
  try {
    const registry = new Registry(db, input.rootPublicKey);
    const records = registry.records();
    const bases = registry.bases();
    const own = keyIdentity(input.ownPublicKey);
    const self = bases.find((b) => b.status === 'enrolled' && keyIdentity(b.publicKey) === own);
    if (!self) refuse('not_named_main', 'This base is not enrolled under the pinned root.');
    const newEpoch = registry.mainEpoch();
    const current = readCoordinatorFencingState(db);
    if (
      registry.main() === self.baseId &&
      current?.replicationMode === 'active' &&
      current.coordinatorEpoch === newEpoch
    )
      return { alreadyActive: true, newEpoch };

    const candidatePath = existsSync(standbyDbPath) ? standbyDbPath : mainDbPath;
    const candidate = candidatePath === mainDbPath ? db : new DatabaseSync(candidatePath);
    let previousEpoch: number;
    try {
      const state = readCoordinatorFencingState(candidate);
      if (!state || state.replicationMode !== 'standby')
        refuse('context_only', 'No verified standby store on this base: seed one before promoting.');
      previousEpoch = state.coordinatorEpoch;
    } finally {
      if (candidate !== db) candidate.close();
    }
    const previousMain = records
      .filter((r) => r.body.kind === 'main' && (r.body.coordinatorEpoch ?? 0) === previousEpoch)
      .at(-1);
    if (!previousMain)
      refuse(
        'previous_main_unknown',
        `No owner-signed main record names the epoch ${previousEpoch} the standby holds.`,
      );
    const previousMainBaseId = previousMain.body.baseId;
    const enrolment = records
      .filter((r) => r.body.kind === 'enrol' && r.body.baseId === previousMainBaseId)
      .sort((a, b) => b.body.serial - a.body.serial)[0];
    const previousRevoked = bases.some((b) => b.baseId === previousMainBaseId && b.status === 'revoked');

    const newRecord = records.find(
      (r) => r.body.kind === 'main' && r.body.baseId === self.baseId && r.body.coordinatorEpoch === newEpoch,
    );
    const received = newRecord
      ? (
          db
            .prepare('SELECT received FROM registry WHERE body = ? AND signature = ?')
            .get(canonical(newRecord.body), newRecord.signature) as { received: string } | undefined
        )?.received
      : undefined;
    const epochSeenAtMs = received ? Date.parse(received) : NaN;

    const others = bases
      .filter((b) => b.status === 'enrolled' && b.baseId !== self.baseId)
      .map((b) => b.baseId)
      .sort();
    const acked = basesAckedEpoch(db, newEpoch);
    const standbyStores = standbyBasesAckedEpoch(db, newEpoch);
    const standbyBaseId = others.find((id) => standbyStores.has(id));
    let liveness: (nowMs: number, monoNowNs: bigint) => RelocationLiveness;
    if (input.drainReceiptFile) {
      if (!enrolment || previousRevoked)
        refuse('drain_receipt_invalid', `${previousMainBaseId} is revoked: its receipt is not trusted.`);
      const drain = JSON.parse(readFileSync(input.drainReceiptFile, 'utf8')) as SignedDrainReceipt;
      const oldMainPublicKey = publicKeyFrom(enrolment.body.publicKey!);
      liveness = () => ({ kind: 'planned', drain, oldMainPublicKey });
    } else {
      if (!Number.isFinite(epochSeenAtMs))
        refuse('not_named_main', 'The owner-signed main record for this base has no receipt time.');
      // Third review: the owner's word never bounds the old main (it may have moved its standby to another
      // standby-store base since this one acked it). Unplanned, the old main is revoked with the root key, or
      // every unrevoked base, the old main included, acked the new epoch.
      const oldHostDownConfirmed = previousRevoked;
      // Measured from the acks this base recorded for its own pushes (F-016-T18), never supplied by the caller.
      const allUnrevokedAckedNewEpoch = allUnrevokedAckedEpoch({
        db,
        rootPublicKey: input.rootPublicKey,
        ownPublicKey: input.ownPublicKey,
        epoch: newEpoch,
      });
      // Fourth review: a revoke stops the old main only where the base acking its lease holds that revoke, so every
      // unrevoked base must have acked the epoch push carrying it; an unreachable one keeps the move refused.
      const missing = others.filter((id) => !acked.has(id));
      if (missing.length)
        refuse(
          'old_host_unconfirmed',
          `Not every unrevoked base acked the new epoch and the revoke (not acked: ${missing.join(', ')}): one of them could still ack ${previousMainBaseId}'s lease. Reach them (or import the records there) and run kaji promote again.`,
        );
      liveness = (nowMs, monoNowNs) => ({
        kind: 'unplanned',
        epochSeenAtMs,
        allUnrevokedAckedNewEpoch,
        oldHostDownConfirmed,
        nowMs,
        monoSinceNs,
        monoNowNs,
      });
    }
    return {
      alreadyActive: false,
      candidatePath,
      liveness,
      relocation: {
        mainDbPath,
        standbyDbPath,
        selfBaseId: self.baseId,
        previousMainBaseId,
        registryMain: { baseId: registry.main(), coordinatorEpoch: newEpoch },
        soleCoordinator: others.length === 0,
        // Re-review BLOCKER: only a base holding a standby store may ack the lease. Named here only when a base
        // acked the new epoch and said it holds one (a false claim only leaves the lease unarmed); otherwise the
        // owner names one with `nerv kaji standby BASE-ID`, whose probe must be acked.
        ...(standbyBaseId ? { standbyBaseId } : {}),
        ...(input.failAfterStep ? { failAfterStep: input.failAfterStep } : {}),
      },
    };
  } finally {
    db.close();
  }
}

/**
 * #717 review: the refusals this base's own stores decide (not named, not a verified standby, a standby behind
 * an epoch it acked) come before the epoch push, so a move that cannot happen never tells another base the new
 * epoch (which would fence the main that is running). A base already active at the new epoch skips them
 * (undefined); otherwise the result is the epoch of the state the standby holds and, for a planned move, the
 * main records its drain receipt lists as skipped. #721 third check: the receipt's signature is verified here,
 * against the enrolment of the main at the standby's epoch, so a tampered receipt is refused before the probe and
 * the push (readiness verifies it again).
 */
function localPrecheck(
  input: PromoteCoordinatorInput,
  mainDbPath: string,
  standbyDbPath: string,
):
  | {
      readonly standbyEpoch: number;
      readonly skippedMains: readonly { readonly baseId: string }[];
      /**
       * Planned: the drained main that signed the receipt. `kaji drain` leaves its service running (fenced), so it
       * usually answers the probe; when it does not, its receipt (with the epochs it ran or acked) answers for it.
       */
      readonly drainedBy?: string;
      /** B-124 way out: this base takes back its own coordinator state (no standby store, no receipt). */
      readonly reinstate?: true;
    }
  | undefined {
  const db = new DatabaseSync(mainDbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (input.relocation) stageRegistryRecords(db, input.rootPublicKey, input.relocation);
    const registry = new Registry(db, input.rootPublicKey);
    const own = keyIdentity(input.ownPublicKey);
    const self = registry.bases().find((b) => b.status === 'enrolled' && keyIdentity(b.publicKey) === own);
    if (!self) refuse('not_named_main', 'This base is not enrolled under the pinned root.');
    const newEpoch = registry.mainEpoch();
    const current = readCoordinatorFencingState(db);
    if (
      registry.main() === self.baseId &&
      current?.replicationMode === 'active' &&
      current.coordinatorEpoch === newEpoch
    )
      return undefined;
    const ownEpoch = reinstateEpoch(db, registry, self.baseId, newEpoch, standbyDbPath);
    if (ownEpoch !== undefined) {
      if (input.drainReceiptFile)
        refuse('drain_receipt_invalid', 'This base takes back its own coordinator state: it takes no drain receipt.');
      // #734 review BLOCKER: a main named between this base's state and the new epoch may have run. An unrevoked one
      // must answer the probe at or below this state's epoch (as every unrevoked base must); a revoked one cannot be
      // asked, so its epoch may have run with effects this state lacks: only a verified standby or an owner-approved
      // cold restore may take over then, never this older state.
      const revoked = new Set(
        registry
          .bases()
          .filter((b) => b.status === 'revoked')
          .map((b) => b.baseId),
      );
      const between = registry
        .records()
        .filter(
          (r) =>
            r.body.kind === 'main' &&
            (r.body.coordinatorEpoch ?? 0) > ownEpoch &&
            (r.body.coordinatorEpoch ?? 0) < newEpoch &&
            r.body.baseId !== undefined &&
            revoked.has(r.body.baseId),
        )
        .map((r) => `${r.body.baseId} (epoch ${r.body.coordinatorEpoch})`);
      if (between.length)
        refuse(
          'standby_behind',
          `${between.join(', ')} was named main after the epoch ${ownEpoch} state this base holds and is revoked, so it cannot say whether it ran: taking this state back could undo what it did. Promote a verified standby of it, or run an owner-approved cold restore. No base was told the new epoch.`,
        );
      // This base's own stores (lease acks included) must not show a later epoch either.
      const ownRan = ranOrAckedCoordinatorEpoch(db, standbyDbPath);
      if (ownRan > ownEpoch)
        refuse(
          'standby_behind',
          `This base ran or acked a coordinator lease at epoch ${ownRan}, after the epoch ${ownEpoch} state it holds. No base was told the new epoch.`,
        );
      return { standbyEpoch: ownEpoch, skippedMains: [], reinstate: true };
    }
    const records = registry.records();
    const candidate = existsSync(standbyDbPath) ? new DatabaseSync(standbyDbPath) : db;
    let standby: ReturnType<typeof checkStandbyCandidate>;
    let ackedHere: boolean;
    try {
      standby = checkStandbyCandidate({
        candidateDb: candidate,
        selfBaseId: self.baseId,
        registryMain: { baseId: registry.main(), coordinatorEpoch: newEpoch },
      });
      ackedHere = standbyLastAckMs(candidate, standby.previousEpoch) !== undefined;
    } finally {
      if (candidate !== db) candidate.close();
    }
    const standbyEpoch = standby.previousEpoch;
    if (!input.drainReceiptFile) {
      // B-124: readiness refuses this after the push too; here it refuses before any base is told the new epoch.
      const previous = records
        .filter((r) => r.body.kind === 'main' && (r.body.coordinatorEpoch ?? 0) === standbyEpoch)
        .at(-1)?.body.baseId;
      const revoked = registry.bases().some((b) => b.baseId === previous && b.status === 'revoked');
      if (previous && !revoked && !ackedHere)
        refuse(
          'old_host_unconfirmed',
          `This standby never acked ${previous}'s lease at epoch ${standbyEpoch}, so the wait does not bound it: drain it (planned), or revoke it with the root key (kaji relocate BASE-ID --revoke ${previous} FILE). No base was told the new epoch.`,
        );
      return { standbyEpoch, skippedMains: [] };
    }
    const previousMain = records
      .filter((r) => r.body.kind === 'main' && (r.body.coordinatorEpoch ?? 0) === standbyEpoch)
      .at(-1);
    if (!previousMain)
      refuse('previous_main_unknown', `No owner-signed main record names the epoch ${standbyEpoch} the standby holds.`);
    const previousMainBaseId = previousMain.body.baseId;
    const enrolment = records
      .filter((r) => r.body.kind === 'enrol' && r.body.baseId === previousMainBaseId)
      .sort((a, b) => b.body.serial - a.body.serial)[0];
    if (!enrolment || registry.bases().some((b) => b.baseId === previousMainBaseId && b.status === 'revoked'))
      refuse('drain_receipt_invalid', `${previousMainBaseId} is revoked: its receipt is not trusted.`);
    let drain: SignedDrainReceipt;
    try {
      drain = JSON.parse(readFileSync(input.drainReceiptFile, 'utf8')) as SignedDrainReceipt;
    } catch {
      refuse('drain_receipt_invalid', 'The drain receipt cannot be read.');
    }
    if (!drain?.receipt || !verifyDrainReceipt(drain, publicKeyFrom(enrolment.body.publicKey!)))
      refuse('drain_receipt_invalid', `The drain receipt is not signed by ${previousMainBaseId}.`);
    // #721 fourth check: the receipt hands this epoch over to this base, from the standby's epoch (readiness checks
    // it again); and the drained base never ran or acked a later epoch than that state.
    const r = drain.receipt;
    if (r.coordinatorEpoch !== standbyEpoch || r.newMainBaseId !== self.baseId || r.newEpoch !== newEpoch)
      refuse(
        'drain_receipt_invalid',
        `The receipt hands epoch ${r.coordinatorEpoch} to ${r.newMainBaseId} at ${r.newEpoch}; this move takes epoch ${standbyEpoch} to ${self.baseId} at ${newEpoch}. No base was told the new epoch.`,
      );
    if (typeof r.ranOrAckedEpoch === 'number' && r.ranOrAckedEpoch > standbyEpoch)
      refuse(
        'standby_behind',
        `${previousMainBaseId} ran or acked a coordinator lease at epoch ${r.ranOrAckedEpoch}, after the epoch ${standbyEpoch} state this standby holds: re-seed it from the epoch ${r.ranOrAckedEpoch} coordinator first. No base was told the new epoch.`,
      );
    // B-124: readiness checks this after the push too; a standby that lacks the final batch is refused first.
    if (standby.headSeq !== r.finalSeq || standby.stateDigest !== r.stateDigest)
      refuse(
        'standby_behind',
        `The standby is at ${standby.headSeq}; the drained coordinator ended at ${r.finalSeq}. Replicate the final batch first. No base was told the new epoch.`,
      );
    const listed: unknown = drain.receipt.skippedMains;
    const skippedMains = (Array.isArray(listed) ? (listed as { baseId?: unknown }[]) : []).flatMap((m) =>
      typeof m?.baseId === 'string' ? [{ baseId: m.baseId }] : [],
    );
    return { standbyEpoch, skippedMains, drainedBy: previousMainBaseId };
  } finally {
    db.close();
  }
}

/**
 * B-121-T02: the same question asked of every other unrevoked base, before the epoch push. A base that ran, or
 * acked a lease at, a later epoch than the standby's state saw a coordinator run after that state (B-121: it may
 * have renewed through a base other than this one), so the move is refused (`standby_behind`). An unplanned move
 * also needs every such base to answer, and to answer with the field: an older NERV leaves it out, which says
 * nothing about the epochs it ran (`peer_epoch_unknown`). A planned move goes on without them: its drain receipt
 * binds the epoch that last ran. Nothing is committed on any base until this passes, so a refusal fences no main.
 */
async function remotePrecheck(
  input: PromoteCoordinatorInput & { readonly pushEpoch: NonNullable<PromoteCoordinatorInput['pushEpoch']> },
  mainDbPath: string,
  local: NonNullable<ReturnType<typeof localPrecheck>>,
): Promise<void> {
  const { standbyEpoch } = local;
  const db = new DatabaseSync(mainDbPath);
  let probe: Awaited<ReturnType<typeof probeCoordinatorEpochs>>;
  let newEpoch: number;
  let selfBaseId: string | undefined;
  let registryBetween: { baseId: string; coordinatorEpoch: number }[];
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (input.relocation) stageRegistryRecords(db, input.rootPublicKey, input.relocation);
    const registry = new Registry(db, input.rootPublicKey);
    newEpoch = registry.mainEpoch();
    const own = keyIdentity(input.ownPublicKey);
    selfBaseId = registry.bases().find((b) => b.status === 'enrolled' && keyIdentity(b.publicKey) === own)?.baseId;
    registryBetween = registry
      .records()
      .filter(
        (r) =>
          r.body.kind === 'main' &&
          r.body.baseId !== undefined &&
          (r.body.coordinatorEpoch ?? 0) > standbyEpoch &&
          (r.body.coordinatorEpoch ?? 0) < newEpoch,
      )
      .map((r) => ({ baseId: r.body.baseId!, coordinatorEpoch: r.body.coordinatorEpoch ?? 0 }));
    probe = await probeCoordinatorEpochs({
      db,
      rootPublicKey: input.rootPublicKey,
      ownPublicKey: input.ownPublicKey,
      push: input.pushEpoch,
    });
  } finally {
    db.close();
  }
  // B-125: an older NERV signs its reply without binding it to the request, so a captured reply could stand in for it.
  if (probe.unbound.length)
    refuse(
      'peer_epoch_unknown',
      `${probe.unbound.join(', ')} answered with a reply not bound to this request (reply_unbound: it runs an older NERV), so its answer cannot be trusted: update it (or revoke it with the root key) and run kaji promote again. No base was told the new epoch.`,
    );
  const ahead = [...probe.ranOrAcked]
    .filter(([, epoch]) => epoch > standbyEpoch)
    .sort(([a], [b]) => a.localeCompare(b));
  if (ahead.length) {
    const newest = Math.max(...ahead.map(([, epoch]) => epoch));
    refuse(
      'standby_behind',
      `${ahead.map(([id, epoch]) => `${id} (epoch ${epoch})`).join(', ')} ran or acked a coordinator lease after the epoch ${standbyEpoch} state this standby holds: re-seed it from the epoch ${newest} coordinator first. No base was told the new epoch.`,
    );
  }
  if (input.drainReceiptFile) {
    // #721 re-check and third check: a planned move goes on past a base that does not answer, unless a main was
    // signed between the standby's epoch and the new one (listed as skipped by the verified receipt, or held here),
    // revoked or not: it may have run, and revoking it does not undo its epoch, which any base may have acked as
    // its standby. Then, as unplanned, every unrevoked base must answer, with the field, at or below the standby's
    // epoch.
    const skipped = [...local.skippedMains, ...registryBetween].some((m) => m.baseId !== selfBaseId);
    // An unanswering drained main is exempt: its signed receipt says which epochs it ran or acked.
    const silent = skipped ? probe.unreachable.filter((id) => id !== local.drainedBy) : [];
    if (silent.length)
      refuse(
        'old_host_unconfirmed',
        `${silent.join(', ')} did not answer: a main was named after the epoch ${standbyEpoch} state this standby holds and may have run, and any unrevoked base may have acked it. Reach it and run kaji promote again. No base was told the new epoch.`,
      );
    // An older NERV says only the newest main record it holds, signed: one later than the standby's state (and
    // not the new one) may have run, and so may a listed base that cannot say.
    const unsure = probe.unknown.filter(
      (id) =>
        skipped ||
        ((probe.unknownMaxSeen.get(id) ?? 0) > standbyEpoch && (probe.unknownMaxSeen.get(id) ?? 0) < newEpoch),
    );
    if (unsure.length)
      refuse(
        'peer_epoch_unknown',
        `${unsure.join(', ')} run(s) an older NERV that holds a main record after the epoch ${standbyEpoch} state this standby holds and does not report the epochs it ran: update it (or revoke it with the root key) and run kaji promote again. No base was told the new epoch.`,
      );
    return;
  }
  if (probe.unreachable.length)
    refuse(
      'old_host_unconfirmed',
      `Not every unrevoked base answered (unreachable: ${probe.unreachable.join(', ')}): one of them may have run or acked a later epoch, or could still ack the old main's lease. Reach them (or import the records there) and run kaji promote again. No base was told the new epoch.`,
    );
  if (probe.unknown.length)
    refuse(
      'peer_epoch_unknown',
      `${probe.unknown.join(', ')} run(s) an older NERV that does not report the epochs it ran or acked, so an unplanned move cannot rule out a later coordinator: update it (or revoke it with the root key) and run kaji promote again. No base was told the new epoch.`,
    );
}

/**
 * `nerv kaji promote` (F-016-T17): checks readiness from verified records, stops the service (the marker
 * keeps `serve` from starting while the stores swap), waits out the old lease on both clocks, promotes,
 * and starts the service again. A re-run after a crash resumes: the swap recovers from any step, and a
 * base already active at the new epoch only finishes.
 */
export async function promoteCoordinator(input: PromoteCoordinatorInput): Promise<PromoteCoordinatorResult> {
  const clock = input.clock ?? systemClock;
  const monoSinceNs = clock.mono();
  const mainDbPath = databasePath(input.home);
  const standbyDbPath = join(input.home, STANDBY_DB_FILE);
  const marker = join(input.home, PROMOTION_MARKER_FILE);
  // Re-review fix 1: a crash between the two renames of swap step 4 leaves the archive and the standby store
  // but no nerv.sqlite: finish that rename before anything opens the store (opening would create an empty one).
  const archivePath = `${mainDbPath}.pre-standby`;
  // Third review: an empty store next to the archive and the standby store (opened by something after the crash)
  // counts as missing: a real nerv.sqlite always holds the registry.
  if (
    existsSync(marker) &&
    existsSync(archivePath) &&
    existsSync(standbyDbPath) &&
    existsSync(mainDbPath) &&
    registryIsEmpty(mainDbPath)
  )
    for (const suffix of ['', '-wal', '-shm']) rmSync(mainDbPath + suffix, { force: true });
  if (!existsSync(mainDbPath) && existsSync(archivePath) && existsSync(standbyDbPath))
    renameSync(standbyDbPath, mainDbPath);
  if (!existsSync(mainDbPath)) throw new Error(`No store at ${mainDbPath}: nothing to promote.`);
  const local = localPrecheck(input, mainDbPath, standbyDbPath);
  if (input.pushEpoch && local !== undefined)
    await remotePrecheck({ ...input, pushEpoch: input.pushEpoch }, mainDbPath, local);
  else if (local?.reinstate)
    refuse('old_host_unconfirmed', "Taking back this base's own state needs every other base asked: run kaji promote.");
  // B-124: the checks passed: the relocation's records are stored here (the heartbeat sync now carries them too).
  if (input.relocation) {
    const db = new DatabaseSync(mainDbPath);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      addRegistryRecords(db, input.rootPublicKey, input.relocation);
    } finally {
      db.close();
    }
  }
  let othersCount = 0;
  if (input.pushEpoch) {
    const db = new DatabaseSync(mainDbPath);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      const pushed = await pushCoordinatorEpoch({
        db,
        rootPublicKey: input.rootPublicKey,
        ownPublicKey: input.ownPublicKey,
        push: input.pushEpoch,
        nowMs: clock.wall(),
      });
      input.log?.(
        `Epoch ${pushed.epoch} acked by ${pushed.acked.join(', ') || 'no base'}` +
          (pushed.missing.length ? `; not acked: ${pushed.missing.join(', ')}.` : '.'),
      );
      othersCount = pushed.acked.length + pushed.missing.length;
    } finally {
      db.close();
    }
  }
  if (local?.reinstate) {
    const newEpoch = (() => {
      const db = new DatabaseSync(mainDbPath);
      try {
        return new Registry(db, input.rootPublicKey).mainEpoch();
      } finally {
        db.close();
      }
    })();
    const leaseExpiresAt = reinstateCoordinator(mainDbPath, local.standbyEpoch, newEpoch, othersCount === 0, clock);
    return { reinstated: true, newEpoch, previousEpoch: local.standbyEpoch, leaseExpiresAt };
  }
  const d = derive(input, mainDbPath, standbyDbPath, monoSinceNs);
  if (d.alreadyActive) {
    // F-016-T08: the marker goes first, or the service it starts refuses to run (serve checks the marker).
    // #717 review: with no marker, an earlier run failed or died between removing it and starting the service:
    // start it again (idempotent), so running kaji promote again always recovers.
    rmSync(marker, { force: true });
    await input.service.start();
    return { resumed: true, newEpoch: d.newEpoch };
  }

  // Refuse before touching the service, unless only the wait is left.
  const precheck = new DatabaseSync(d.candidatePath);
  try {
    checkRelocationReadiness({
      ...d.relocation,
      candidateDb: precheck,
      liveness: d.liveness(clock.wall(), clock.mono()),
    });
  } catch (err) {
    if (!(err instanceof RelocationRefusedError && err.reason === 'horizon_not_passed')) throw err;
    input.log?.('Waiting until the old lease cannot be live on either clock.');
  } finally {
    precheck.close();
  }

  // Re-review fix 2: a marker an earlier, crashed swap left is never removed by this run's refusals.
  const createdMarker = !existsSync(marker);
  if (createdMarker)
    writeFileSync(
      marker,
      JSON.stringify({ baseId: d.relocation.selfBaseId, newEpoch: d.relocation.registryMain.coordinatorEpoch }) + '\n',
      { mode: 0o600 },
    );
  try {
    await input.service.stop();
  } catch (err) {
    // Nothing was swapped by this run.
    if (createdMarker) rmSync(marker, { force: true });
    throw err;
  }
  for (;;) {
    try {
      const nowMs = clock.wall();
      const result = relocateCoordinator({ ...d.relocation, nowMs, liveness: d.liveness(nowMs, clock.mono()) });
      // The swap is done: remove the marker before the start, which serve would otherwise refuse (F-016-T08).
      rmSync(marker, { force: true });
      await input.service.start();
      return result;
    } catch (err) {
      if (!(err instanceof RelocationRefusedError)) throw err; // mid-swap: the marker keeps serve down until a re-run
      const waited = Number((clock.mono() - monoSinceNs) / 1_000_000n);
      if (err.reason === 'horizon_not_passed' && waited <= RELOCATION_HORIZON_CONSERVATIVE_MS + 60_000) {
        await clock.sleep(5_000);
        continue;
      }
      if (createdMarker) {
        rmSync(marker, { force: true });
        await input.service.start();
      }
      throw err;
    }
  }
}
