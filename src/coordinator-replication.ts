import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  COORDINATOR_STATE_SCHEMA,
  REPLICATED_COORDINATOR_TABLES,
  type ReplicatedCoordinatorTable,
} from './coordinator-snapshot.ts';
import { canonical } from './kaji.ts';

export const COORDINATOR_REPLICATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS coordinator_replication_log(
    coordinator_epoch INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    prev_digest TEXT NOT NULL,
    batch_digest TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(coordinator_epoch, seq)
  );`;

export type ReplicationMutation =
  | {
      op: 'upsert';
      table: ReplicatedCoordinatorTable;
      row: Record<string, unknown>;
    }
  | {
      op: 'delete';
      table: ReplicatedCoordinatorTable;
      where: Record<string, string | number>;
    };

export interface ReplicationTelegramCheckpoint {
  offset?: number | null;
  inboxSeq?: number | null;
  inboxId?: string | null;
  cardsJson?: string | null;
  messagesJson?: string | null;
  briefJson?: string | null;
}

export interface ReplicationBatch {
  version: 1;
  root: string;
  sourceBaseId: string;
  coordinatorEpoch: number;
  coordinatorFence: number;
  seq: number;
  prevDigest: string;
  batchDigest: string;
  createdAt: string;
  changes: ReplicationMutation[];
  telegram?: ReplicationTelegramCheckpoint;
}

export interface AppendReplicationBatchInput {
  root: string;
  sourceBaseId: string;
  changes: ReplicationMutation[];
  telegram?: ReplicationTelegramCheckpoint;
  createdAt?: string;
}

export interface ApplyReplicationBatchOptions {
  expectedRoot: string;
  expectedMainBaseId: string;
  minCoordinatorEpoch?: number;
}

export type ApplyReplicationBatchResult =
  | { ok: true; duplicate?: boolean; headSeq: number; stateDigest: string }
  | {
      ok: false;
      /** `busy`: the standby store was locked (F-016-T20 re-check): the same batch is sent again. */
      reason: 'need_resync' | 'invalid_batch' | 'not_standby' | 'busy';
      expectedSeq: number;
      /** F-016-T20: the epoch the standby holds, so the main tells a gap from an epoch change. */
      coordinatorEpoch?: number;
    };

const ALLOWED_REPLICATION_TABLES = new Set<string>(
  REPLICATED_COORDINATOR_TABLES.filter((t) => t !== 'registry' && t !== 'registry_roots' && t !== 'coordinator_state'),
);

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function computeBatchDigest(
  coordinatorEpoch: number,
  seq: number,
  prevDigest: string,
  changes: readonly ReplicationMutation[],
  telegram?: ReplicationTelegramCheckpoint,
): string {
  return sha256Hex(canonical({ coordinatorEpoch, seq, prevDigest, changes, ...(telegram ? { telegram } : {}) }));
}

function validateMutations(changes: readonly ReplicationMutation[]): boolean {
  for (const m of changes) {
    if (!ALLOWED_REPLICATION_TABLES.has(m.table)) return false;
    if (m.op === 'upsert') {
      if (!m.row || typeof m.row !== 'object' || Array.isArray(m.row) || Object.keys(m.row).length === 0) return false;
    } else if (m.op === 'delete') {
      if (!m.where || typeof m.where !== 'object' || Array.isArray(m.where) || Object.keys(m.where).length === 0)
        return false;
    } else {
      return false;
    }
  }
  return true;
}

/** Modes that append: the active main, and a draining one flushing its final batch (F-016-T20). */
const APPENDING_MODES = new Set(['active', 'draining']);

/**
 * Appends one batch inside the caller's write transaction (F-016-T20: the capture and the seed hold one).
 * Advances `coordinator_state.head_seq` and `state_digest`.
 */
export function appendReplicationBatchInTransaction(
  db: DatabaseSync,
  input: AppendReplicationBatchInput,
): ReplicationBatch {
  if (!validateMutations(input.changes)) {
    throw new Error('Replication batch contains non-replicated or invalid table mutation.');
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  const state = db
    .prepare(
      'SELECT coordinator_epoch, coordinator_fence, replication_mode, head_seq, state_digest FROM coordinator_state WHERE id = 1',
    )
    .get() as
    | {
        coordinator_epoch: number;
        coordinator_fence: number;
        replication_mode: string;
        head_seq: number;
        state_digest: string | null;
      }
    | undefined;
  if (!state || !APPENDING_MODES.has(state.replication_mode)) {
    throw new Error('Cannot append replication batch when coordinator is not active.');
  }

  const seq = Number(state.head_seq) + 1;
  const prevDigest = state.state_digest ?? '';
  const batchDigest = computeBatchDigest(state.coordinator_epoch, seq, prevDigest, input.changes, input.telegram);

  db.prepare(
    'INSERT INTO coordinator_replication_log(coordinator_epoch, seq, prev_digest, batch_digest, changes_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    state.coordinator_epoch,
    seq,
    prevDigest,
    batchDigest,
    // F-016-T20: the whole batch, so the shipper sends it again unchanged (the same id after a lost reply).
    JSON.stringify({
      root: input.root,
      sourceBaseId: input.sourceBaseId,
      coordinatorFence: state.coordinator_fence,
      changes: input.changes,
      ...(input.telegram ? { telegram: input.telegram } : {}),
    }),
    createdAt,
  );

  db.prepare(
    `UPDATE coordinator_state SET
       head_seq = ?,
       state_digest = ?,
       telegram_offset = COALESCE(?, telegram_offset),
       telegram_inbox_seq = COALESCE(?, telegram_inbox_seq),
       telegram_inbox_id = COALESCE(?, telegram_inbox_id),
       telegram_cards_json = COALESCE(?, telegram_cards_json),
       telegram_messages_json = COALESCE(?, telegram_messages_json),
       telegram_brief_json = COALESCE(?, telegram_brief_json)
     WHERE id = 1`,
  ).run(
    seq,
    batchDigest,
    input.telegram?.offset ?? null,
    input.telegram?.inboxSeq ?? null,
    input.telegram?.inboxId ?? null,
    input.telegram?.cardsJson ?? null,
    input.telegram?.messagesJson ?? null,
    input.telegram?.briefJson ?? null,
  );

  return {
    version: 1,
    root: input.root,
    sourceBaseId: input.sourceBaseId,
    coordinatorEpoch: state.coordinator_epoch,
    coordinatorFence: state.coordinator_fence,
    seq,
    prevDigest,
    batchDigest,
    createdAt,
    changes: input.changes,
    ...(input.telegram ? { telegram: input.telegram } : {}),
  };
}

/**
 * Appends an ordered `(coordinatorEpoch, seq)` replication batch on the active coordinator
 * and advances `coordinator_state.head_seq` and `state_digest` (`F-016-T04`).
 */
export function appendReplicationBatch(db: DatabaseSync, input: AppendReplicationBatchInput): ReplicationBatch {
  db.exec(COORDINATOR_STATE_SCHEMA);
  db.exec(COORDINATOR_REPLICATION_SCHEMA);
  db.exec('BEGIN IMMEDIATE');
  try {
    const batch = appendReplicationBatchInTransaction(db, input);
    db.exec('COMMIT');
    return batch;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback error.
    }
    throw err;
  }
}

/**
 * Verifies and applies an ordered `(coordinatorEpoch, seq)` replication batch to `coordinator-standby.sqlite`.
 * Returns `need_resync` (`expectedSeq`) on sequence gaps or `prevDigest` mismatches without mutating standby (`F-016-T04`).
 */
export function applyReplicationBatch(
  standbyDb: DatabaseSync,
  batch: ReplicationBatch,
  options: ApplyReplicationBatchOptions,
): ApplyReplicationBatchResult {
  if (
    !batch ||
    batch.version !== 1 ||
    batch.root !== options.expectedRoot ||
    batch.sourceBaseId !== options.expectedMainBaseId ||
    !Array.isArray(batch.changes) ||
    !validateMutations(batch.changes)
  ) {
    return { ok: false, reason: 'invalid_batch', expectedSeq: 0 };
  }
  if (options.minCoordinatorEpoch !== undefined && batch.coordinatorEpoch < options.minCoordinatorEpoch) {
    return { ok: false, reason: 'invalid_batch', expectedSeq: 0 };
  }
  const expectedDigest = computeBatchDigest(
    batch.coordinatorEpoch,
    batch.seq,
    batch.prevDigest,
    batch.changes,
    batch.telegram,
  );
  if (expectedDigest !== batch.batchDigest) {
    return { ok: false, reason: 'invalid_batch', expectedSeq: 0 };
  }

  standbyDb.exec(COORDINATOR_STATE_SCHEMA);
  const state = standbyDb
    .prepare('SELECT coordinator_epoch, replication_mode, head_seq, state_digest FROM coordinator_state WHERE id = 1')
    .get() as
    | {
        coordinator_epoch: number;
        replication_mode: string;
        head_seq: number;
        state_digest: string | null;
      }
    | undefined;
  if (!state || state.replication_mode !== 'standby') {
    return { ok: false, reason: 'not_standby', expectedSeq: 0 };
  }

  const expectedSeq = Number(state.head_seq) + 1;
  const resync = { ok: false, reason: 'need_resync', expectedSeq, coordinatorEpoch: state.coordinator_epoch } as const;
  if (batch.coordinatorEpoch !== state.coordinator_epoch) return resync;
  if (batch.seq <= state.head_seq) {
    if (batch.seq === state.head_seq && batch.batchDigest === state.state_digest) {
      return { ok: true, duplicate: true, headSeq: state.head_seq, stateDigest: state.state_digest };
    }
    return resync;
  }
  if (batch.seq !== expectedSeq || batch.prevDigest !== (state.state_digest ?? '')) return resync;

  const primaryKeys = new Map<string, string[]>();
  const primaryKeyOf = (table: string): string[] => {
    let pk = primaryKeys.get(table);
    if (!pk) {
      pk = (standbyDb.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; pk: number }[])
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      primaryKeys.set(table, pk);
    }
    return pk;
  };
  let touchedFacts = false;
  let touchedEpisodes = false;
  standbyDb.exec('PRAGMA foreign_keys = OFF');
  standbyDb.exec('BEGIN IMMEDIATE');
  try {
    for (const m of batch.changes) {
      if (m.table === 'facts') touchedFacts = true;
      if (m.table === 'episodes') touchedEpisodes = true;
      if (m.op === 'upsert') {
        const keys = Object.keys(m.row).filter((k) => m.table === 'deliveries' || k !== '_rowid_');
        const cols = keys.map((k) => (k === '_rowid_' ? 'rowid' : `"${k.replace(/"/g, '""')}"`));
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map((k) => (m.row[k] ?? null) as string | number | Uint8Array | null);
        // #725 review: an updated row keeps its rowid (reminder history, keyset cursors and watch notices
        // order by it): an upsert on the primary key, never a delete and re-insert. `deliveries` carries its
        // exact rowid.
        const pk = m.table === 'deliveries' ? [] : primaryKeyOf(m.table);
        const update = keys
          .filter((k) => !pk.includes(k))
          .map((k) => `"${k.replace(/"/g, '""')}" = excluded."${k.replace(/"/g, '""')}"`);
        const conflict =
          m.table === 'deliveries'
            ? ''
            : pk.length
              ? ` ON CONFLICT(${pk.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ')}) DO ${update.length ? `UPDATE SET ${update.join(', ')}` : 'NOTHING'}`
              : '';
        standbyDb
          .prepare(
            `INSERT ${m.table === 'deliveries' ? 'OR REPLACE ' : ''}INTO "${m.table}" (${cols.join(', ')}) VALUES (${placeholders})${conflict}`,
          )
          .run(...values);
      } else {
        const keys = Object.keys(m.where);
        const clauses = keys.map((k) => `"${k.replace(/"/g, '""')}" = ?`).join(' AND ');
        const values = keys.map((k) => m.where[k]!);
        standbyDb.prepare(`DELETE FROM "${m.table}" WHERE ${clauses}`).run(...values);
      }
    }

    if (touchedFacts) {
      standbyDb.exec('DELETE FROM facts_fts');
      standbyDb.exec('INSERT INTO facts_fts(text, fact_id) SELECT text, id FROM facts');
    }
    if (touchedEpisodes) {
      standbyDb.exec('DELETE FROM episodes_fts');
      standbyDb.exec('INSERT INTO episodes_fts(summary, episode_id) SELECT substr(summary, 1, 1500), id FROM episodes');
    }

    standbyDb
      .prepare(
        `UPDATE coordinator_state SET
           coordinator_fence = ?,
           head_seq = ?,
           state_digest = ?,
           telegram_offset = COALESCE(?, telegram_offset),
           telegram_inbox_seq = COALESCE(?, telegram_inbox_seq),
           telegram_inbox_id = COALESCE(?, telegram_inbox_id),
           telegram_cards_json = COALESCE(?, telegram_cards_json),
           telegram_messages_json = COALESCE(?, telegram_messages_json),
           telegram_brief_json = COALESCE(?, telegram_brief_json)
         WHERE id = 1`,
      )
      .run(
        batch.coordinatorFence,
        batch.seq,
        batch.batchDigest,
        batch.telegram?.offset ?? null,
        batch.telegram?.inboxSeq ?? null,
        batch.telegram?.inboxId ?? null,
        batch.telegram?.cardsJson ?? null,
        batch.telegram?.messagesJson ?? null,
        batch.telegram?.briefJson ?? null,
      );

    standbyDb.exec('COMMIT');
  } catch (err) {
    try {
      standbyDb.exec('ROLLBACK');
    } catch {
      // Ignore rollback error.
    }
    throw err;
  } finally {
    standbyDb.exec('PRAGMA foreign_keys = ON');
  }

  return { ok: true, headSeq: batch.seq, stateDigest: batch.batchDigest };
}
