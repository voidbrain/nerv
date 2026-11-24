import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { Registry, canonical, keyIdentity, publicKeyFrom } from './kaji.ts';
import { service } from './service.ts';

/** While this file exists in the data home a promotion is unfinished and `serve` refuses to start. */
export const PROMOTION_MARKER_FILE = 'coordinator-promotion.json';

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

/** The installed service (launchd, systemd or the Windows task); a NERV run by hand must be stopped first. */
export function installedPromotionService(home: string): PromotionServiceControl {
  let stopped = false;
  const answering = async () => {
    try {
      await fetch(`http://127.0.0.1:${readConfig(home).port}/api/status`, { signal: AbortSignal.timeout(500) });
      return true;
    } catch {
      return false;
    }
  };
  return {
    async stop() {
      try {
        service('stop', home);
        stopped = true;
      } catch (err) {
        if (!/not installed/.test((err as Error).message)) throw err;
      }
      for (let i = 0; i < 60 && (await answering()); i++) await systemClock.sleep(250);
      if (await answering())
        throw new Error('NERV Agency still answers on its port: stop it (Ctrl+C or service stop) and run again.');
    },
    start() {
      if (stopped) service('start', home);
    },
  };
}

export interface PromoteCoordinatorInput {
  readonly home: string;
  readonly rootPublicKey: string | undefined;
  readonly ownPublicKey: string;
  /** Planned move: the signed receipt `nerv kaji drain` wrote on the old main. */
  readonly drainReceiptFile?: string;
  /** Unplanned move: the owner confirms the old host is down (a root-signed revoke of it counts too). */
  readonly confirmOldHostDown: boolean;
  readonly service: PromotionServiceControl;
  readonly clock?: PromotionClock;
  readonly log?: (line: string) => void;
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
      const oldHostDownConfirmed = input.confirmOldHostDown || previousRevoked;
      liveness = (nowMs, monoNowNs) => ({
        kind: 'unplanned',
        epochSeenAtMs,
        // Measured by F-016-T18; until then never assumed.
        allUnrevokedAckedNewEpoch: false,
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
        soleCoordinator: !bases.some((b) => b.status === 'enrolled' && b.baseId !== self.baseId),
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

  if (!existsSync(marker))
    writeFileSync(
      marker,
      JSON.stringify({ baseId: d.relocation.selfBaseId, newEpoch: d.relocation.registryMain.coordinatorEpoch }) + '\n',
      { mode: 0o600 },
    );
  await input.service.stop();
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
      rmSync(marker, { force: true });
      await input.service.start();
      throw err;
    }
  }
}
