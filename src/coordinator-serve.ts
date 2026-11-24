import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  CoordinatorLeaseKeeper,
  handleStandbyLeaseRenew,
  type LeaseRenewRequest,
  type LeaseRenewResult,
} from './coordinator-lease.ts';
import { STANDBY_DB_FILE } from './coordinator-relocation.ts';
import { Registry } from './kaji.ts';

/**
 * F-016-T16: the coordinator lease as `serve` runs it. On the active main, a keeper renews the lease through
 * the named standby and fences the base when renewals stop; on a standby base, `POST /kaji/lease/renew` acks
 * into its `coordinator-standby.sqlite`. Opens its own connection to `nerv.sqlite` (WAL, shared with the
 * nervous process).
 */
export function coordinatorLeaseService(input: {
  readonly home: string;
  readonly databasePath: string;
  readonly baseId: string;
  readonly root: string | undefined;
  readonly ownPublicKey: string;
}) {
  const db = new DatabaseSync(input.databasePath);
  db.exec('PRAGMA busy_timeout = 5000');
  const registry = () => new Registry(db, input.root);
  const processBootId = randomUUID();
  let keeper: CoordinatorLeaseKeeper | undefined;
  return {
    /** F-016-T18: the newest coordinator epoch this base holds; older-epoch headers are refused. */
    mainEpoch: (): number => registry().mainEpoch(),
    /** Standby side of `POST /kaji/lease/renew`. */
    onLeaseRenew: async (_from: string, request: LeaseRenewRequest): Promise<LeaseRenewResult> => {
      const path = join(input.home, STANDBY_DB_FILE);
      if (!existsSync(path)) throw new Error('This base holds no coordinator standby.');
      const standby = new DatabaseSync(path);
      try {
        standby.exec('PRAGMA busy_timeout = 5000');
        return handleStandbyLeaseRenew(standby, {
          standbyBaseId: input.baseId,
          request,
          maxSeenCoordinatorEpoch: registry().mainEpoch(),
          processBootId,
        });
      } finally {
        standby.close();
      }
    },
    /** The keeper with the Kaji line's signed renewal; `serve` starts it. */
    keeper(
      renew: (standbyBaseId: string, request: LeaseRenewRequest) => Promise<LeaseRenewResult>,
    ): CoordinatorLeaseKeeper {
      keeper = new CoordinatorLeaseKeeper({
        db,
        renew,
        hasOtherEnrolledBases: () =>
          registry()
            .bases()
            .some((b) => b.status === 'enrolled' && b.publicKey !== input.ownPublicKey),
        onFenced: (detail) => console.error(`Coordinator fenced: ${detail}`),
      });
      return keeper;
    },
    stop(): void {
      keeper?.stop();
      db.close();
    },
  };
}
