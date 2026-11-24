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
import { isActiveCoordinator, readCoordinatorFencingState } from './coordinator-authority.ts';
import type { State, TelegramContinuity } from './telegram.ts';

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

/**
 * F-016-T19: whether this base may run the coordinator's Telegram channel now. Where `nerv.sqlite` holds a
 * coordinator state, only the active coordinator (mode, main base, epoch, lease) may; a base keeping a
 * standby store may not; a legacy host with neither keeps today's behaviour. Opens the store per check,
 * so a promotion swap is always read from the current file.
 */
export function coordinatorChannelAuthority(input: {
  readonly home: string;
  readonly databasePath: string;
  readonly baseId: string;
  readonly root: string | undefined;
}): () => boolean {
  return () => {
    const db = new DatabaseSync(input.databasePath);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      if (!readCoordinatorFencingState(db)) return !existsSync(join(input.home, STANDBY_DB_FILE));
      const registry = new Registry(db, input.root);
      const mainBaseId = registry.main();
      return isActiveCoordinator({
        db,
        baseId: input.baseId,
        ...(mainBaseId ? { mainBaseId } : {}),
        maxSeenCoordinatorEpoch: registry.mainEpoch(),
      }).ok;
    } finally {
      db.close();
    }
  };
}

/** F-016-T19: the Telegram state in `coordinator_state`, replicated to the standby and hydrated on activation. */
export function coordinatorTelegramContinuity(databasePath: string): TelegramContinuity {
  const withDb = <T>(fn: (db: DatabaseSync) => T): T | undefined => {
    const db = new DatabaseSync(databasePath);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      return readCoordinatorFencingState(db) ? fn(db) : undefined;
    } finally {
      db.close();
    }
  };
  const parse = <T>(text: string | null): T | undefined => {
    if (!text) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  };
  return {
    load: () =>
      withDb((db) => {
        const row = db
          .prepare(
            `SELECT telegram_offset, telegram_inbox_seq, telegram_inbox_id, telegram_cards_json, telegram_messages_json,
                    telegram_brief_json FROM coordinator_state WHERE id = 1`,
          )
          .get() as
          | {
              telegram_offset: number | null;
              telegram_inbox_seq: number | null;
              telegram_inbox_id: string | null;
              telegram_cards_json: string | null;
              telegram_messages_json: string | null;
              telegram_brief_json: string | null;
            }
          | undefined;
        if (!row) return undefined;
        const cards = parse<string[]>(row.telegram_cards_json);
        const messages = parse<State['messages']>(row.telegram_messages_json);
        const brief = parse<State['brief']>(row.telegram_brief_json);
        return {
          ...(row.telegram_offset !== null ? { offset: row.telegram_offset } : {}),
          ...(row.telegram_inbox_seq !== null
            ? {
                inbox: {
                  sequence: row.telegram_inbox_seq,
                  ...(row.telegram_inbox_id !== null ? { id: row.telegram_inbox_id } : {}),
                },
              }
            : {}),
          ...(Array.isArray(cards) ? { cards } : {}),
          ...(Array.isArray(messages) ? { messages } : {}),
          ...(brief ? { brief } : {}),
        };
      }),
    save: (state) => {
      withDb((db) =>
        db
          .prepare(
            `UPDATE coordinator_state SET telegram_offset = ?, telegram_inbox_seq = ?, telegram_inbox_id = ?,
               telegram_cards_json = ?, telegram_messages_json = ?, telegram_brief_json = ?
             WHERE id = 1 AND replication_mode = 'active'`,
          )
          .run(
            state.offset ?? null,
            state.inbox?.sequence ?? null,
            state.inbox?.id ?? null,
            JSON.stringify(state.cards),
            state.messages ? JSON.stringify(state.messages) : null,
            state.brief ? JSON.stringify(state.brief) : null,
          ),
      );
    },
  };
}
