import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readCoordinatorFencingState } from './coordinator-authority.ts';
import {
  RELOCATION_HORIZON_CONSERVATIVE_MS,
  RelocationRefusedError,
  STANDBY_DB_FILE,
  checkRelocationReadiness,
  relocateCoordinator,
  type RelocateCoordinatorInput,
  type RelocateCoordinatorResult,
  type RelocationLiveness,
  type SignedDrainReceipt,
} from './coordinator-relocation.ts';
import { databasePath, readConfig } from './config.ts';
import { Registry, canonical, keyIdentity, publicKeyFrom, type SignedRecord } from './kaji.ts';
import { allUnrevokedAckedEpoch, pushCoordinatorEpoch, standbyBasesAckedEpoch } from './coordinator-epoch.ts';
import { service } from './service.ts';

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
  readonly pushEpoch?: (
    baseId: string,
    records: SignedRecord[],
  ) => Promise<{ maxSeenCoordinatorEpoch: number; standby?: boolean }>;
  /** Test-only crash injection, passed to the promotion swap. */
  readonly failAfterStep?: RelocateCoordinatorInput['failAfterStep'];
}

export type PromoteCoordinatorResult =
  RelocateCoordinatorResult | { readonly resumed: true; readonly newEpoch: number };

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
    } finally {
      db.close();
    }
  }
  const d = derive(input, mainDbPath, standbyDbPath, monoSinceNs);
  if (d.alreadyActive) {
    if (!existsSync(marker)) throw new Error(`This base is already the active coordinator at epoch ${d.newEpoch}.`);
    await input.service.start();
    rmSync(marker, { force: true });
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
      await input.service.start();
      rmSync(marker, { force: true });
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
