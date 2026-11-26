import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { readCoordinatorFencingState } from './coordinator-authority.ts';
import { PROMOTION_MARKER_FILE } from './coordinator-promote.ts';
import { probeCoordinatorEpochs, pushCoordinatorEpoch } from './coordinator-epoch.ts';
import { STANDBY_DB_FILE, ranOrAckedCoordinatorEpoch } from './coordinator-relocation.ts';
import { COORDINATOR_STATE_SCHEMA } from './coordinator-snapshot.ts';
import { Registry, keyIdentity, type RegistryBody, type SignedRecord } from './kaji.ts';
import type { EpochPushReply } from './kaji-link.ts';

export type AdoptResult =
  | {
      readonly already: true;
      readonly epoch: number;
      readonly told: readonly string[];
      readonly notTold: readonly string[];
    }
  | {
      readonly adopted: true;
      readonly epoch: 1;
      readonly signed: boolean;
      readonly backup: string;
      /** The bases that took the epoch 1 record now, and those that get it with the next registry sync. */
      readonly told: readonly string[];
      readonly notTold: readonly string[];
    };

/**
 * B-170: a main named before F-016 (its main record has no `coordinatorEpoch`, read as 0) holds its store with no
 * `coordinator_state`; it acts as a legacy single host, and `kaji standby`, `kaji drain` and seeding refuse it.
 * Adopting makes that store the first coordinator, epoch 1 (`kaji main` names the first main at epoch 1 or less;
 * epoch 1 is the first a lease renewal accepts): active, no lease (an unarmed lease is authority at epoch 1, as the
 * legacy main had), so nothing about what it may do changes until a standby is named.
 *
 * Refused, before any write, wherever another coordinator could have run: this base is not the main the registry
 * names, the main record is at epoch 2 or later (that state comes only from `kaji promote`), this base holds a
 * standby store or acked another main's lease, a promotion is in progress, coordinator state already exists in
 * another mode, or another base answers the record-free epoch probe saying it ran or acked a coordinator lease.
 * A base that does not answer is not waited for: a later coordinator needs a standby store seeded from an active
 * one (none exists before this) and a promotion pushes its epoch to every unrevoked base, this one included.
 * After the write the registry goes to every other base over `/kaji/epoch-push`: a standby acks a lease only at the
 * epoch its own registry holds.
 *
 * Backup first (`VACUUM INTO` under `<home>/backups/`); the main record (when the registry's is at epoch 0) is signed
 * before the backup and stored after it; a run interrupted between the record and the state adopts at epoch 1 with
 * no new signature. Idempotent: an active state at the registry's epoch is reported and the registry pushed again; no state, record
 * or backup is written.
 */
export async function adoptLegacyCoordinator(input: {
  readonly db: DatabaseSync;
  readonly home: string;
  readonly rootPublicKey: string | undefined;
  readonly ownPublicKey: string;
  /** Signs a body with the root key (asks for the passphrase); called only when the main record is at epoch 0. */
  readonly sign: (body: RegistryBody) => Promise<SignedRecord>;
  /** `KajiLink.pushEpoch`: the record-free probe before, and the registry push after. */
  readonly push: (baseId: string, records: SignedRecord[]) => Promise<EpochPushReply>;
  readonly now?: Date;
}): Promise<AdoptResult> {
  const { db, home } = input;
  const registry = new Registry(db, input.rootPublicKey);
  const own = keyIdentity(input.ownPublicKey);
  const self = registry.bases().find((b) => b.status === 'enrolled' && keyIdentity(b.publicKey) === own);
  if (!input.rootPublicKey || !self) throw new Error('This base is not enrolled under a pinned root.');
  const main = registry.main();
  const epoch = registry.mainEpoch();
  const scope = { db, rootPublicKey: input.rootPublicKey, ownPublicKey: input.ownPublicKey };
  const state = readCoordinatorFencingState(db);
  if (state) {
    if (state.replicationMode === 'active' && main === self.baseId && state.coordinatorEpoch === epoch) {
      // A re-run reaches a base that missed the push; it writes no state, record or backup.
      const pushed = await pushCoordinatorEpoch({ ...scope, push: input.push });
      return { already: true, epoch, told: pushed.acked, notTold: pushed.missing };
    }
    throw new Error(
      `This base already holds coordinator state (${state.replicationMode} at epoch ${state.coordinatorEpoch}): kaji adopt is only for a main from before F-016 with none. Nothing was changed.`,
    );
  }
  if (existsSync(join(home, PROMOTION_MARKER_FILE)))
    throw new Error(
      'A coordinator promotion is in progress here: finish it with nerv kaji promote. Nothing was changed.',
    );
  if (main !== self.baseId)
    throw new Error(
      `The registry names ${main ?? 'no main base'}, not ${self.baseId}: only the main base adopts its store. Nothing was changed.`,
    );
  if (epoch >= 2)
    throw new Error(
      `The main record names ${self.baseId} at coordinator epoch ${epoch}: that state comes from kaji promote, never from adopting this store. Restore the store from before the move or ask for an owner-approved cold restore. Nothing was changed.`,
    );
  const standbyPath = join(home, STANDBY_DB_FILE);
  if (existsSync(standbyPath))
    throw new Error(
      'This base holds a standby store: another main seeded it, so this store is not the coordinator. Nothing was changed.',
    );
  const ran = ranOrAckedCoordinatorEpoch(db, standbyPath);
  if (ran > 0)
    throw new Error(
      `This base acked a coordinator lease at epoch ${ran}: another main ran, so this store is not the coordinator. Nothing was changed.`,
    );

  const probe = await probeCoordinatorEpochs({ ...scope, push: input.push });
  const others = [...probe.ranOrAcked].filter(([, e]) => e > 0).sort(([a], [b]) => a.localeCompare(b));
  if (others.length)
    throw new Error(
      `${others.map(([id, e]) => `${id} (epoch ${e})`).join(', ')} ran or acked a coordinator lease: another main ran, so this store is not the coordinator. Nothing was changed.`,
    );

  const now = input.now ?? new Date();
  const record =
    epoch === 0
      ? await input.sign({
          kind: 'main',
          serial: registry.nextSerial(),
          coordinatorEpoch: 1,
          baseId: self.baseId,
          issued: now.toISOString(),
        })
      : undefined;

  const dir = join(home, 'backups');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const backup = join(dir, `nerv-before-adopt-${now.toISOString().replace(/[:.]/g, '-')}.sqlite`);
  db.prepare('VACUUM INTO ?').run(backup);
  chmodSync(backup, 0o600);

  if (record) {
    const stored = new Registry(db, input.rootPublicKey);
    stored.add(record, now);
    if (stored.main() !== self.baseId || stored.mainEpoch() !== 1)
      throw new Error('The signed main record was not taken as the newest: no coordinator state was written.');
  }
  db.exec(COORDINATOR_STATE_SCHEMA);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (readCoordinatorFencingState(db)) throw new Error('Coordinator state appeared meanwhile: nothing was written.');
    db.prepare(
      `INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at)
       VALUES (1, 1, 1, 'active', 0, 0)`,
    ).run();
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
  const pushed = await pushCoordinatorEpoch({ ...scope, push: input.push });
  return { adopted: true, epoch: 1, signed: !!record, backup, told: pushed.acked, notTold: pushed.missing };
}
