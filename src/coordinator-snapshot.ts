import { createHash, sign, type KeyObject } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonical } from './kaji.ts';
import { MAX_BACKUP_BODY } from './kaji-link.ts';

/**
 * Replicated coordinator tables per `docs/decisions/coordinator-relocation.md` (F-016-T03).
 * Strictly excludes base-local tables (`worker_*`, `push_*`, `model_usage`, `registry_seen`,
 * `kaji_seen`, `standby_lease_state`, `root_migration*`) and any host-local secrets/files.
 */
export const REPLICATED_COORDINATOR_TABLES = [
  'reminders',
  'reminder_times',
  'deliveries',
  'daily_briefs',
  'approval_deliveries',
  'kaji_outbox',
  'kaji_outbox_pilots',
  'worker_legacy_outbox',
  'worker_outbox_cancels',
  'worker_outbox_attempts',
  'worker_outbox_reconciliations',
  'watch_runs',
  'watch_steps',
  'watch_notices',
  'watch_cursors',
  'instrumentality_runs',
  'sorties',
  'sortie_controls',
  'actions',
  'approvals',
  'events',
  'grants',
  'facts',
  'fact_history',
  'episodes',
  'provenance_migrations',
  'milestones',
  'coordinator_state',
  'registry',
  'registry_roots',
] as const;

export type ReplicatedCoordinatorTable = (typeof REPLICATED_COORDINATOR_TABLES)[number];

export interface CoordinatorSnapshotManifest {
  version: 1;
  root: string;
  sourceBaseId: string;
  coordinatorEpoch: number;
  coordinatorFence: number;
  headSeq: number;
  exportedAt: string;
  tableCounts: Record<string, number>;
  sha256: string;
}

export interface CoordinatorSnapshotPayload {
  manifest: CoordinatorSnapshotManifest;
  signature: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface CoordinatorSnapshotChunk {
  version: 1;
  snapshotSha256: string;
  chunkIndex: number;
  totalChunks: number;
  dataBase64: string;
}

export interface ExportCoordinatorSnapshotInput {
  db: DatabaseSync;
  root: string;
  sourceBaseId: string;
  coordinatorEpoch: number;
  coordinatorFence: number;
  headSeq: number;
  privateKey: KeyObject;
  exportedAt?: string;
  maxBodyBytes?: number;
}

export interface ExportedCoordinatorSnapshot {
  manifest: CoordinatorSnapshotManifest;
  signature: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  chunked: boolean;
  totalBytes: number;
  chunks: Buffer[];
}

function existingTables(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function chunkPayload(payloadBytes: Buffer, snapshotSha256: string, maxBodyBytes: number): Buffer[] {
  if (maxBodyBytes < 256) {
    throw new Error(`maxBodyBytes (${maxBodyBytes}) is too small to frame a snapshot chunk.`);
  }
  const envelopeOverhead = Buffer.byteLength(
    JSON.stringify({
      version: 1,
      snapshotSha256,
      chunkIndex: 999_999,
      totalChunks: 999_999,
      dataBase64: '',
    }),
    'utf8',
  );
  const maxRawBytes = Math.floor(((maxBodyBytes - envelopeOverhead) * 3) / 4);
  if (maxRawBytes < 1) {
    throw new Error(`maxBodyBytes (${maxBodyBytes}) leaves no room for snapshot chunk data.`);
  }
  const totalChunks = Math.ceil(payloadBytes.length / maxRawBytes);
  const chunks: Buffer[] = [];
  for (let i = 0; i < totalChunks; i += 1) {
    const slice = payloadBytes.subarray(i * maxRawBytes, (i + 1) * maxRawBytes);
    const frame: CoordinatorSnapshotChunk = {
      version: 1,
      snapshotSha256,
      chunkIndex: i,
      totalChunks,
      dataBase64: slice.toString('base64'),
    };
    const buf = Buffer.from(JSON.stringify(frame), 'utf8');
    if (buf.length > maxBodyBytes) {
      throw new Error(`Chunk ${i} exceeded maxBodyBytes (${buf.length} > ${maxBodyBytes}).`);
    }
    chunks.push(buf);
  }
  return chunks;
}

/**
 * Exports all replicated coordinator tables from `db` in one read transaction,
 * preserving exact `deliveries.rowid`, signed by `privateKey`, and sized or chunked
 * within `maxBodyBytes` (default `MAX_BACKUP_BODY`).
 */
export function exportCoordinatorSnapshot(input: ExportCoordinatorSnapshotInput): ExportedCoordinatorSnapshot {
  const maxBodyBytes = input.maxBodyBytes ?? MAX_BACKUP_BODY;
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const tableCounts: Record<string, number> = {};

  input.db.exec('BEGIN');
  try {
    const present = existingTables(input.db);
    for (const table of REPLICATED_COORDINATOR_TABLES) {
      if (!present.has(table)) {
        tables[table] = [];
        tableCounts[table] = 0;
        continue;
      }
      const sql =
        table === 'deliveries'
          ? 'SELECT rowid AS _rowid_, * FROM deliveries ORDER BY rowid ASC'
          : `SELECT * FROM ${table} ORDER BY rowid ASC`;
      const rows = input.db.prepare(sql).all() as Array<Record<string, unknown>>;
      tables[table] = rows;
      tableCounts[table] = rows.length;
    }
    input.db.exec('COMMIT');
  } catch (err) {
    try {
      input.db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failure on read transaction cleanup.
    }
    throw err;
  }

  const sha256 = sha256Hex(canonical(tables));
  const manifest: CoordinatorSnapshotManifest = {
    version: 1,
    root: input.root,
    sourceBaseId: input.sourceBaseId,
    coordinatorEpoch: input.coordinatorEpoch,
    coordinatorFence: input.coordinatorFence,
    headSeq: input.headSeq,
    exportedAt,
    tableCounts,
    sha256,
  };
  const signature = sign(null, Buffer.from(canonical(manifest), 'utf8'), input.privateKey).toString('base64');
  const fullPayload: CoordinatorSnapshotPayload = { manifest, signature, tables };
  const payloadBytes = Buffer.from(JSON.stringify(fullPayload), 'utf8');

  if (payloadBytes.length <= maxBodyBytes) {
    return {
      manifest,
      signature,
      tables,
      chunked: false,
      totalBytes: payloadBytes.length,
      chunks: [payloadBytes],
    };
  }

  const chunks = chunkPayload(payloadBytes, sha256, maxBodyBytes);
  return {
    manifest,
    signature,
    tables,
    chunked: true,
    totalBytes: payloadBytes.length,
    chunks,
  };
}
