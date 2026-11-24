import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Registry, keyIdentity, verifyRecord, type SignedRecord } from './kaji.ts';

/**
 * B-124: what `nerv kaji relocate` writes instead of storing or pushing its records. A record held in any live
 * registry reaches every base through the heartbeat registry sync, and a base that holds a newer main record
 * stops the running main; so the signed re-target stays in this file until the target's `kaji promote
 * --relocation FILE` has passed its checks (or the old main's `kaji drain --relocation FILE` fences it).
 */
export interface RelocationBundle {
  readonly root: string;
  readonly rootBinding?: 1;
  /** The move this bundle signs; `kaji import` refuses a bundle that carries it. */
  readonly relocation: { readonly baseId: string; readonly coordinatorEpoch: number; readonly revoked?: string };
  /** Every record of the signing base's registry, then the new ones (a revoke, the main record). */
  readonly records: SignedRecord[];
}

/**
 * Reads a relocation bundle: signed by the pinned root, every record verified, and holding the main record it
 * names. Nothing is stored.
 */
export function readRelocationBundle(
  file: string,
  rootPublicKey: string | undefined,
): { readonly records: SignedRecord[]; readonly baseId: string; readonly coordinatorEpoch: number } {
  let bundle: Partial<RelocationBundle>;
  try {
    bundle = JSON.parse(readFileSync(file, 'utf8')) as Partial<RelocationBundle>;
  } catch {
    throw new Error(`${file} is not a relocation bundle (kaji relocate BASE-ID FILE writes one).`);
  }
  const reloc = bundle.relocation;
  if (!reloc || typeof reloc.baseId !== 'string' || !Number.isSafeInteger(reloc.coordinatorEpoch))
    throw new Error(`${file} is not a relocation bundle (kaji relocate BASE-ID FILE writes one).`);
  if (!rootPublicKey || typeof bundle.root !== 'string' || keyIdentity(bundle.root) !== keyIdentity(rootPublicKey))
    throw new Error('This relocation bundle is signed by a different root than the one pinned here.');
  const records = Array.isArray(bundle.records) ? bundle.records : [];
  if (!records.every((r) => verifyRecord(rootPublicKey, r)))
    throw new Error('A record in this relocation bundle is not signed by your Key of Nebuchadnezzar.');
  if (
    !records.some(
      (r) =>
        r.body.kind === 'main' && r.body.baseId === reloc.baseId && r.body.coordinatorEpoch === reloc.coordinatorEpoch,
    )
  )
    throw new Error('The relocation bundle does not hold the main record it names.');
  return { records, baseId: reloc.baseId, coordinatorEpoch: reloc.coordinatorEpoch };
}

/**
 * Shows `records` to this connection only, as if its registry held them: the registry tables are copied into
 * connection-private TEMP tables (which unqualified names resolve to first) and the records are verified and added
 * there. The store, and so the heartbeat sync and every other base, never sees them. Throws on a record the
 * registry would refuse (not signed by the root, or a main record that does not advance serial and epoch).
 */
export function stageRegistryRecords(
  db: DatabaseSync,
  rootPublicKey: string | undefined,
  records: readonly SignedRecord[],
): void {
  // #734 review: only TEMP tables are written, in a deferred transaction (Registry.add nests a savepoint in it), so
  // staging never takes the store's write lock and runs while the service writes.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('DROP TABLE IF EXISTS temp.registry; DROP TABLE IF EXISTS temp.registry_roots');
  db.exec('CREATE TEMP TABLE registry AS SELECT * FROM main.registry');
  const scoped = !!db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='registry_roots'").get();
  db.exec(
    scoped
      ? 'CREATE TEMP TABLE registry_roots AS SELECT * FROM main.registry_roots'
      : 'CREATE TEMP TABLE registry_roots(id TEXT, root TEXT)',
  );
  db.exec('BEGIN');
  try {
    addRegistryRecords(db, rootPublicKey, records);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Stores `records` in this registry (each verified; a record already held is skipped). */
export function addRegistryRecords(
  db: DatabaseSync,
  rootPublicKey: string | undefined,
  records: readonly SignedRecord[],
): number {
  const registry = new Registry(db, rootPublicKey);
  let added = 0;
  for (const r of records) if (registry.add(r) === 'added') added++;
  return added;
}
