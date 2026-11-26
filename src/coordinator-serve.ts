import { randomUUID, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  CoordinatorLeaseKeeper,
  handleStandbyLeaseRenew,
  type LeaseRenewRequest,
  type LeaseRenewResult,
} from './coordinator-lease.ts';
import { STANDBY_DB_FILE, ranOrAckedCoordinatorEpoch, standbyAckedEpoch } from './coordinator-relocation.ts';
import { PROMOTION_MARKER_FILE } from './coordinator-promote.ts';
import {
  applyReplicationBatch,
  type ApplyReplicationBatchResult,
  type ReplicationBatch,
} from './coordinator-replication.ts';
import {
  ReplicationShipper,
  StandbySeedReceiver,
  replicationApplyFault,
  seedStandbyStore,
  type ReplicationShipperOptions,
  type SeedReply,
  type ShippingLink,
} from './coordinator-shipping.ts';
import { Registry, baseKey, keyIdentity, publicKeyFrom } from './kaji.ts';
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
  /** The monotonic clock the keeper reads (tests inject one; a host asleep stops it, F-016-T08). */
  readonly monoNow?: () => bigint;
  /** F-016-T20: the base key that signs a seed snapshot; read from the data home when not given. */
  readonly privateKey?: KeyObject;
}) {
  const db = new DatabaseSync(input.databasePath);
  db.exec('PRAGMA busy_timeout = 5000');
  const registry = () => new Registry(db, input.root);
  const processBootId = randomUUID();
  let keeper: CoordinatorLeaseKeeper | undefined;
  let shipper: ReplicationShipper | undefined;
  const standbyPath = join(input.home, STANDBY_DB_FILE);
  // F-016-T20: a seed is applied as the snapshot of the base the registry names main, at its epoch or later.
  const seeds = new StandbySeedReceiver((from, frames): SeedReply => {
    const reg = registry();
    const main = reg.bases().find((b) => b.baseId === from && b.status === 'enrolled');
    if (!input.root || !main || reg.main() !== from)
      return { ok: false, reason: 'not_main', error: 'Only the active main seeds this base.' };
    return seedStandbyStore({
      home: input.home,
      frames,
      publicKey: publicKeyFrom(main.publicKey),
      expectedRoot: input.root,
      expectedMainBaseId: from,
      minCoordinatorEpoch: reg.mainEpoch(),
      localMode: readCoordinatorFencingState(db)?.replicationMode,
    });
  });
  /**
   * #725 review: a newer main record can reach the standby before the old main's last batch (B-124: the drain
   * stores it with the fence and the heartbeat sync carries it on; an older NERV's relocate pushed it at once).
   * While this base is still a standby (not promoting) it keeps taking batches from the base named main at the
   * epoch its store holds, for that epoch only, and only if it acked no later lease.
   */
  const standbyFeedFrom = (from: string, coordinatorEpoch: number): boolean => {
    if (!existsSync(standbyPath) || existsSync(join(input.home, PROMOTION_MARKER_FILE))) return false;
    const reg = registry();
    if (!reg.bases().some((b) => b.baseId === from && b.status === 'enrolled')) return false;
    const named = reg
      .records()
      .some((r) => r.body.kind === 'main' && r.body.baseId === from && r.body.coordinatorEpoch === coordinatorEpoch);
    if (!named) return false;
    let standby: DatabaseSync | undefined;
    try {
      standby = new DatabaseSync(standbyPath);
      standby.exec('PRAGMA busy_timeout = 5000');
      const state = readCoordinatorFencingState(standby);
      return (
        state?.replicationMode === 'standby' &&
        state.coordinatorEpoch === coordinatorEpoch &&
        standbyAckedEpoch(standby) <= coordinatorEpoch
      );
    } catch {
      return false;
    } finally {
      standby?.close();
    }
  };
  return {
    /** F-016-T18: the newest coordinator epoch this base holds; older-epoch headers are refused. */
    mainEpoch: (): number => registry().mainEpoch(),
    /** B-121-T02: the newest coordinator epoch this base ran or acked a lease at (said in epoch-push replies). */
    ranOrAckedEpoch: (): number => ranOrAckedCoordinatorEpoch(db, join(input.home, STANDBY_DB_FILE)),
    /** Standby side of `POST /kaji/lease/renew`. */
    onLeaseRenew: async (_from: string, request: LeaseRenewRequest): Promise<LeaseRenewResult> => {
      // Only a base holding the standby store acks (F-016-T16 re-review): a worker or a drained old main never
      // does, so a partitioned old main cannot keep its lease through a base that would not promote.
      const path = join(input.home, STANDBY_DB_FILE);
      if (!existsSync(path))
        return { ok: false, reason: 'not_standby', error: 'This base holds no coordinator standby store.' };
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
    /**
     * F-016-T20: standby side of `POST /kaji/replicate`. KajiLink has checked the sender is the main, the epoch
     * header and the lease; the batch is applied to the standby store only in order, once, from the newest epoch.
     */
    onReplicate: async (from: string, batch: ReplicationBatch): Promise<ApplyReplicationBatchResult> => {
      if (!input.root || !existsSync(standbyPath)) return { ok: false, reason: 'not_standby', expectedSeq: 0 };
      const reg = registry();
      const fromMain = reg.main() === from;
      if (!fromMain && !standbyFeedFrom(from, batch.coordinatorEpoch))
        return { ok: false, reason: 'invalid_batch', expectedSeq: 0 };
      let standby: DatabaseSync | undefined;
      try {
        standby = new DatabaseSync(standbyPath);
        standby.exec('PRAGMA busy_timeout = 5000');
        return applyReplicationBatch(standby, batch, {
          expectedRoot: input.root,
          expectedMainBaseId: from,
          minCoordinatorEpoch: fromMain ? reg.mainEpoch() : batch.coordinatorEpoch,
        });
      } catch (err) {
        // #725 review: a store this NERV cannot apply to (unreadable, or an older schema) is seeded again by the
        // main rather than failing every second; the seed itself reports a store it cannot read. A locked store
        // (re-check) is only busy: the main sends the same batch again.
        return { ok: false, reason: replicationApplyFault(err), expectedSeq: 0 };
      } finally {
        standby?.close();
      }
    },
    standbyFeedFrom: (from: string, coordinatorEpoch: number): boolean => standbyFeedFrom(from, coordinatorEpoch),
    /** F-016-T20: standby side of `POST /kaji/standby/seed` (one frame of a signed snapshot). */
    onSeed: async (from: string, frame: string): Promise<SeedReply> => seeds.receive(from, frame),
    /**
     * The Kaji line's coordinator handlers as `serve` wires them (#721 review: one place, tested end to end): lease
     * acks, the newest epoch enforced on incoming headers, and what epoch-push replies say (a standby store held;
     * B-121-T02, the newest epoch this base ran or acked).
     */
    kajiOptions() {
      return {
        onLeaseRenew: this.onLeaseRenew,
        onReplicate: this.onReplicate,
        onSeed: this.onSeed,
        standbyFeedFrom: this.standbyFeedFrom,
        minCoordinatorEpoch: this.mainEpoch,
        holdsStandby: () => existsSync(join(input.home, STANDBY_DB_FILE)),
        ranOrAckedEpoch: this.ranOrAckedEpoch,
      };
    },
    /** The keeper with the Kaji line's signed renewal; `serve` starts it. */
    keeper(
      renew: (standbyBaseId: string, request: LeaseRenewRequest) => Promise<LeaseRenewResult>,
    ): CoordinatorLeaseKeeper {
      keeper = new CoordinatorLeaseKeeper({
        db,
        renew,
        hasOtherEnrolledBases: () => {
          const own = keyIdentity(input.ownPublicKey);
          return registry()
            .bases()
            .some((b) => b.status === 'enrolled' && keyIdentity(b.publicKey) !== own);
        },
        selfBaseId: input.baseId,
        registryMain: () => {
          const r = registry();
          return { baseId: r.main(), epoch: r.mainEpoch() };
        },
        onFenced: (detail) => console.error(`Coordinator fenced: ${detail}`),
        ...(input.monoNow ? { monoNow: input.monoNow } : {}),
      });
      return keeper;
    },
    /** F-016-T20: the replication shipper on this base (it ships only while this base is the active main). */
    shipper(
      link: ShippingLink,
      options: Pick<ReplicationShipperOptions, 'keepBatches' | 'maxBatchesPerTick' | 'log' | 'onReadCommitted'> = {},
    ): ReplicationShipper {
      shipper?.stop();
      shipper = new ReplicationShipper({
        db,
        baseId: input.baseId,
        root: input.root ?? '',
        privateKey: () => input.privateKey ?? baseKey(input.home).privateKey,
        link,
        ...options,
      });
      return shipper;
    },
    stop(): void {
      keeper?.stop();
      shipper?.stop();
      db.close();
    },
    async stopAsync(): Promise<void> {
      keeper?.stop();
      await shipper?.stopAsync();
      db.close();
    },
  };
}

/**
 * F-016-T19: whether this base may run the coordinator's Telegram channel now. Where `nerv.sqlite` holds a
 * coordinator state, only the active coordinator (mode, main base, epoch, lease) may; a base keeping a
 * standby store may not; a legacy host with neither keeps today's behaviour. A promotion swap happens with
 * the service stopped (`nerv kaji promote`), so the channel's connection never outlives the file it opened.
 */
export function coordinatorChannelAuthority(input: {
  readonly home: string;
  readonly databasePath: string;
  readonly baseId: string;
  readonly root: string | undefined;
}): (() => boolean) & { close(): void } {
  // One connection per channel; the registry is verified again only when the store changed (`data_version`,
  // which moves on every commit by another connection). The lease is checked against the clock on every call.
  // `close()` (the channel calls it when it stops) releases the connection for good: a closed check answers no,
  // so a stopped channel never reopens the store (Windows cannot remove or swap a file that is still open).
  let db: DatabaseSync | undefined;
  let closed = false;
  let cache: { version: number; mainBaseId: string | undefined; epoch: number } | undefined;
  const check = () => {
    if (closed) return false;
    if (!db) {
      db = new DatabaseSync(input.databasePath);
      db.exec('PRAGMA busy_timeout = 1000');
    }
    if (!readCoordinatorFencingState(db)) return !existsSync(join(input.home, STANDBY_DB_FILE));
    const version = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    if (cache?.version !== version) {
      const registry = new Registry(db, input.root);
      cache = { version, mainBaseId: registry.main(), epoch: registry.mainEpoch() };
    }
    return isActiveCoordinator({
      db,
      baseId: input.baseId,
      ...(cache.mainBaseId ? { mainBaseId: cache.mainBaseId } : {}),
      maxSeenCoordinatorEpoch: cache.epoch,
    }).ok;
  };
  return Object.assign(check, {
    close: () => {
      closed = true;
      db?.close();
      db = undefined;
    },
  });
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
