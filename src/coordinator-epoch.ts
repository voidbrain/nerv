import type { DatabaseSync } from 'node:sqlite';
import type { RegistryPort } from './kaji-link.ts';
import { Registry, keyIdentity, type SignedRecord } from './kaji.ts';

/** Base-local: which base acknowledged which coordinator epoch, as measured by this base's own pushes (F-016-T18). */
const EPOCH_ACKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS coordinator_epoch_acks (
  base_id TEXT PRIMARY KEY,
  coordinator_epoch INTEGER NOT NULL,
  acked_at INTEGER NOT NULL,
  standby INTEGER NOT NULL DEFAULT 0
);`;

/** A registry port over a local store, for a command that talks on the Kaji line without the service. */
export function registryPort(registry: Registry): RegistryPort {
  return {
    bases: async () => registry.bases(),
    records: async () => registry.records(),
    add: async (records) => {
      let added = 0;
      for (const r of records) {
        try {
          if (registry.add(r) === 'added') added++;
        } catch {
          // A record not signed by the pinned root is dropped.
        }
      }
      return added;
    },
    seen: async () => {},
    lastSeen: async () => ({}),
    main: async () => registry.main(),
  };
}

interface EpochScope {
  readonly db: DatabaseSync;
  readonly rootPublicKey: string | undefined;
  readonly ownPublicKey: string;
}

/** Every enrolled, unrevoked base other than this one: the bases that must hold the new epoch. */
function otherBases(scope: EpochScope): { registry: Registry; others: string[] } {
  const registry = new Registry(scope.db, scope.rootPublicKey);
  const own = keyIdentity(scope.ownPublicKey);
  const others = registry
    .bases()
    .filter((b) => b.status === 'enrolled' && keyIdentity(b.publicKey) !== own)
    .map((b) => b.baseId);
  return { registry, others };
}

/**
 * Pushes this base's verified registry records (the owner-signed main record and any revoke) to every
 * enrolled, unrevoked base over `/kaji/epoch-push` and records each base whose reply holds the newest epoch.
 * An unreachable base, or one that answers with an older epoch, is not acked.
 */
export async function pushCoordinatorEpoch(
  input: EpochScope & {
    readonly push: (
      baseId: string,
      records: SignedRecord[],
    ) => Promise<{ maxSeenCoordinatorEpoch: number; standby?: boolean }>;
    readonly nowMs?: number;
  },
): Promise<{ epoch: number; acked: string[]; missing: string[] }> {
  const { registry, others } = otherBases(input);
  const epoch = registry.mainEpoch();
  const records = registry.records();
  input.db.exec(EPOCH_ACKS_SCHEMA);
  const acked: string[] = [];
  const missing: string[] = [];
  await Promise.all(
    others.map(async (baseId) => {
      try {
        const reply = await input.push(baseId, records);
        if (reply.maxSeenCoordinatorEpoch < epoch) throw new Error('older epoch');
        input.db
          .prepare(
            `INSERT INTO coordinator_epoch_acks(base_id, coordinator_epoch, acked_at, standby) VALUES (?, ?, ?, ?)
             ON CONFLICT(base_id) DO UPDATE SET coordinator_epoch = excluded.coordinator_epoch,
               acked_at = excluded.acked_at, standby = excluded.standby
             WHERE excluded.coordinator_epoch >= coordinator_epoch_acks.coordinator_epoch`,
          )
          .run(baseId, reply.maxSeenCoordinatorEpoch, input.nowMs ?? Date.now(), reply.standby === true ? 1 : 0);
        acked.push(baseId);
      } catch {
        missing.push(baseId);
      }
    }),
  );
  return { epoch, acked: acked.sort(), missing: missing.sort() };
}

/** Every enrolled, unrevoked base other than this one acked `epoch` or later, from this base's recorded acks. */
export function allUnrevokedAckedEpoch(input: EpochScope & { readonly epoch: number }): boolean {
  const { others } = otherBases(input);
  input.db.exec(EPOCH_ACKS_SCHEMA);
  const ack = input.db.prepare('SELECT coordinator_epoch FROM coordinator_epoch_acks WHERE base_id = ?');
  return others.every(
    (id) => ((ack.get(id) as { coordinator_epoch: number } | undefined)?.coordinator_epoch ?? 0) >= input.epoch,
  );
}

/** The bases this base recorded as holding `epoch` or later. */
export function basesAckedEpoch(db: DatabaseSync, epoch: number): Set<string> {
  db.exec(EPOCH_ACKS_SCHEMA);
  return new Set(
    (
      db.prepare('SELECT base_id FROM coordinator_epoch_acks WHERE coordinator_epoch >= ?').all(epoch) as {
        base_id: string;
      }[]
    ).map((r) => r.base_id),
  );
}

/** The bases that acked `epoch` or later and said they hold a standby store (the only ones that can ack a lease). */
export function standbyBasesAckedEpoch(db: DatabaseSync, epoch: number): Set<string> {
  db.exec(EPOCH_ACKS_SCHEMA);
  return new Set(
    (
      db
        .prepare('SELECT base_id FROM coordinator_epoch_acks WHERE coordinator_epoch >= ? AND standby = 1')
        .all(epoch) as {
        base_id: string;
      }[]
    ).map((r) => r.base_id),
  );
}
