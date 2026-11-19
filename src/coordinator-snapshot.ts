import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonical } from './kaji.ts';
import { MAX_BACKUP_BODY } from './kaji-link.ts';

export const COORDINATOR_STATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS coordinator_state(
    id INTEGER PRIMARY KEY CHECK (id = 1),
    coordinator_epoch INTEGER NOT NULL DEFAULT 0,
    coordinator_fence INTEGER NOT NULL DEFAULT 0,
    replication_mode TEXT NOT NULL DEFAULT 'standby',
    head_seq INTEGER NOT NULL DEFAULT 0,
    state_digest TEXT,
    lease_issued_at INTEGER,
    lease_expires_at INTEGER,
    standby_base_id TEXT,
    telegram_offset INTEGER,
    telegram_inbox_seq INTEGER,
    telegram_inbox_id TEXT,
    telegram_cards_json TEXT,
    telegram_messages_json TEXT,
    telegram_brief_json TEXT
  );`;

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

export interface ImportStandbySnapshotInput {
  frames: readonly Buffer[];
  standbyDb: DatabaseSync;
  publicKey: KeyObject;
  expectedRoot: string;
  expectedMainBaseId: string;
  minCoordinatorEpoch?: number;
}

export interface ImportedStandbySnapshot {
  manifest: CoordinatorSnapshotManifest;
  replicationMode: 'standby';
  importedTables: number;
}

const VALID_TABLE_SET = new Set<string>(REPLICATED_COORDINATOR_TABLES);

/** Verifies the manifest signature, root, source base, epoch, digest, and table counts before any write. */
export function verifyCoordinatorSnapshot(
  payload: CoordinatorSnapshotPayload,
  options: {
    publicKey: KeyObject;
    expectedRoot: string;
    expectedMainBaseId: string;
    minCoordinatorEpoch?: number;
  },
): void {
  const ok = verify(
    null,
    Buffer.from(canonical(payload.manifest), 'utf8'),
    options.publicKey,
    Buffer.from(payload.signature, 'base64'),
  );
  if (!ok) {
    throw new Error('Coordinator snapshot signature verification failed.');
  }
  if (payload.manifest.root !== options.expectedRoot) {
    throw new Error('Coordinator snapshot root mismatch.');
  }
  if (payload.manifest.sourceBaseId !== options.expectedMainBaseId) {
    throw new Error(`Coordinator snapshot sourceBaseId "${payload.manifest.sourceBaseId}" is not active main.`);
  }
  if (options.minCoordinatorEpoch !== undefined && payload.manifest.coordinatorEpoch < options.minCoordinatorEpoch) {
    throw new Error('Coordinator snapshot epoch is stale.');
  }
  for (const name of Object.keys(payload.tables)) {
    if (!VALID_TABLE_SET.has(name)) {
      throw new Error(`Unexpected non-replicated table in snapshot: ${name}`);
    }
    const rows = payload.tables[name] ?? [];
    if (payload.manifest.tableCounts[name] !== rows.length) {
      throw new Error(`Snapshot table count mismatch for ${name}.`);
    }
  }
  const actualSha256 = sha256Hex(canonical(payload.tables));
  if (actualSha256 !== payload.manifest.sha256) {
    throw new Error('Coordinator snapshot digest mismatch.');
  }
}

/** Reassembles single-frame or chunked snapshot payloads and verifies integrity before returning. */
export function reassembleCoordinatorSnapshot(
  frames: readonly Buffer[],
  options: {
    publicKey: KeyObject;
    expectedRoot: string;
    expectedMainBaseId: string;
    minCoordinatorEpoch?: number;
  },
): CoordinatorSnapshotPayload {
  if (frames.length === 0) throw new Error('No snapshot frames provided.');
  let payload: CoordinatorSnapshotPayload;
  if (frames.length === 1) {
    const parsed = JSON.parse(frames[0]!.toString('utf8')) as CoordinatorSnapshotPayload | CoordinatorSnapshotChunk;
    payload =
      'dataBase64' in parsed
        ? (JSON.parse(Buffer.from(parsed.dataBase64, 'base64').toString('utf8')) as CoordinatorSnapshotPayload)
        : parsed;
  } else {
    const parsedChunks = frames.map((f) => JSON.parse(f.toString('utf8')) as CoordinatorSnapshotChunk);
    const total = parsedChunks[0]!.totalChunks;
    const expectedHash = parsedChunks[0]!.snapshotSha256;
    if (parsedChunks.length !== total) {
      throw new Error(`Expected ${total} snapshot chunks, received ${parsedChunks.length}.`);
    }
    const ordered = [...parsedChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const buffers: Buffer[] = [];
    for (let i = 0; i < total; i += 1) {
      const c = ordered[i]!;
      if (c.chunkIndex !== i || c.totalChunks !== total || c.snapshotSha256 !== expectedHash) {
        throw new Error(`Invalid snapshot chunk at index ${i}.`);
      }
      buffers.push(Buffer.from(c.dataBase64, 'base64'));
    }
    payload = JSON.parse(Buffer.concat(buffers).toString('utf8')) as CoordinatorSnapshotPayload;
    if (payload.manifest.sha256 !== expectedHash) {
      throw new Error('Chunked snapshot hash mismatch.');
    }
  }
  verifyCoordinatorSnapshot(payload, options);
  return payload;
}

function insertSnapshotRows(
  db: DatabaseSync,
  table: string,
  rows: readonly Record<string, unknown>[],
  preserveRowid: boolean,
): void {
  for (const row of rows) {
    const keys = Object.keys(row).filter((k) => preserveRowid || k !== '_rowid_');
    const cols = keys.map((k) => (k === '_rowid_' ? 'rowid' : `"${k.replace(/"/g, '""')}"`));
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => (row[k] ?? null) as string | number | Uint8Array | null);
    db.prepare(`INSERT INTO "${table}" (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
  }
}

/**
 * Verifies a signed coordinator snapshot before any write, then imports replicated tables
 * into `standbyDb` (`coordinator-standby.sqlite`), sets `replication_mode = 'standby'`,
 * preserves exact `deliveries.rowid`, and rebuilds FTS5 indexes locally (`F-016-T13`).
 */
export function importCoordinatorSnapshotToStandby(input: ImportStandbySnapshotInput): ImportedStandbySnapshot {
  const payload = reassembleCoordinatorSnapshot(input.frames, {
    publicKey: input.publicKey,
    expectedRoot: input.expectedRoot,
    expectedMainBaseId: input.expectedMainBaseId,
    ...(input.minCoordinatorEpoch !== undefined ? { minCoordinatorEpoch: input.minCoordinatorEpoch } : {}),
  });

  input.standbyDb.exec(COORDINATOR_STATE_SCHEMA);
  const present = existingTables(input.standbyDb);
  let importedTables = 0;

  input.standbyDb.exec('PRAGMA foreign_keys = OFF');
  input.standbyDb.exec('BEGIN IMMEDIATE');
  try {
    for (const table of REPLICATED_COORDINATOR_TABLES) {
      if (!present.has(table) || table === 'coordinator_state') continue;
      const rows = payload.tables[table] ?? [];
      if (table === 'registry') {
        // Monotonic serial-merge: preserve any higher-serial local trust records.
        const maxLocal =
          (input.standbyDb.prepare('SELECT COALESCE(MAX(serial), 0) AS m FROM registry').get() as { m: number }).m ?? 0;
        const newer = rows.filter((r) => Number(r.serial ?? 0) > maxLocal);
        insertSnapshotRows(input.standbyDb, table, newer, false);
      } else if (table === 'registry_roots') {
        const existingIds = new Set(
          (input.standbyDb.prepare('SELECT id FROM registry_roots').all() as Array<{ id: string }>).map((r) => r.id),
        );
        const missing = rows.filter((r) => !existingIds.has(String(r.id)));
        insertSnapshotRows(input.standbyDb, table, missing, false);
      } else {
        input.standbyDb.exec(`DELETE FROM "${table}"`);
        insertSnapshotRows(input.standbyDb, table, rows, table === 'deliveries');
      }
      importedTables += 1;
    }

    const coordRow = payload.tables.coordinator_state?.[0];
    input.standbyDb
      .prepare(
        `INSERT INTO coordinator_state(
           id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, state_digest,
           lease_issued_at, lease_expires_at, standby_base_id,
           telegram_offset, telegram_inbox_seq, telegram_inbox_id,
           telegram_cards_json, telegram_messages_json, telegram_brief_json
         ) VALUES (1, ?, ?, 'standby', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           coordinator_epoch = excluded.coordinator_epoch,
           coordinator_fence = excluded.coordinator_fence,
           replication_mode = 'standby',
           head_seq = excluded.head_seq,
           state_digest = excluded.state_digest,
           lease_issued_at = excluded.lease_issued_at,
           lease_expires_at = excluded.lease_expires_at,
           standby_base_id = excluded.standby_base_id,
           telegram_offset = excluded.telegram_offset,
           telegram_inbox_seq = excluded.telegram_inbox_seq,
           telegram_inbox_id = excluded.telegram_inbox_id,
           telegram_cards_json = excluded.telegram_cards_json,
           telegram_messages_json = excluded.telegram_messages_json,
           telegram_brief_json = excluded.telegram_brief_json`,
      )
      .run(
        payload.manifest.coordinatorEpoch,
        payload.manifest.coordinatorFence,
        payload.manifest.headSeq,
        payload.manifest.sha256,
        (coordRow?.lease_issued_at ?? null) as number | null,
        (coordRow?.lease_expires_at ?? null) as number | null,
        (coordRow?.standby_base_id ?? null) as string | null,
        (coordRow?.telegram_offset ?? null) as number | null,
        (coordRow?.telegram_inbox_seq ?? null) as number | null,
        (coordRow?.telegram_inbox_id ?? null) as string | null,
        (coordRow?.telegram_cards_json ?? null) as string | null,
        (coordRow?.telegram_messages_json ?? null) as string | null,
        (coordRow?.telegram_brief_json ?? null) as string | null,
      );

    if (present.has('facts_fts') && present.has('facts')) {
      input.standbyDb.exec('DELETE FROM facts_fts');
      input.standbyDb.exec('INSERT INTO facts_fts(text, fact_id) SELECT text, id FROM facts');
    }
    if (present.has('episodes_fts') && present.has('episodes')) {
      input.standbyDb.exec('DELETE FROM episodes_fts');
      input.standbyDb.exec(
        'INSERT INTO episodes_fts(summary, episode_id) SELECT substr(summary, 1, 1500), id FROM episodes',
      );
    }

    input.standbyDb.exec('COMMIT');
  } catch (err) {
    try {
      input.standbyDb.exec('ROLLBACK');
    } catch {
      // Ignore rollback error.
    }
    throw err;
  } finally {
    input.standbyDb.exec('PRAGMA foreign_keys = ON');
  }

  return {
    manifest: payload.manifest,
    replicationMode: 'standby',
    importedTables,
  };
}
