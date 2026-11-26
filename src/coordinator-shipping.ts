import type { KeyObject } from 'node:crypto';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readCoordinatorFencingState } from './coordinator-authority.ts';
import { STANDBY_LEASE_SCHEMA } from './coordinator-lease.ts';
import { PROMOTION_MARKER_FILE } from './coordinator-promote.ts';
import { STANDBY_DB_FILE } from './coordinator-relocation.ts';
import {
  COORDINATOR_REPLICATION_SCHEMA,
  appendReplicationBatchInTransaction,
  type ApplyReplicationBatchResult,
  type ReplicationBatch,
  type ReplicationMutation,
  type ReplicationTelegramCheckpoint,
} from './coordinator-replication.ts';
import {
  COORDINATOR_STATE_SCHEMA,
  REPLICATED_COORDINATOR_TABLES,
  exportCoordinatorSnapshot,
  importCoordinatorSnapshotToStandby,
  type CoordinatorSnapshotChunk,
  type ExportedCoordinatorSnapshot,
} from './coordinator-snapshot.ts';
import { MAX_BACKUP_BODY } from './kaji-link.ts';
import { Store } from './store.ts';

/*
 * F-016-T20: the standby store kept current while serve runs.
 *
 * Capture: triggers on every replicated table of the active main's `nerv.sqlite` note the key of each row a
 * commit touched (whichever process or connection wrote it), and a Telegram checkpoint when the channel's
 * saved state moves. The shipper turns what was noted into ordered `(coordinatorEpoch, seq)` batches with the
 * row as it now is (an upsert, or a delete when it is gone), so a batch reflects committed state only.
 *
 * Seed: in one write transaction the main turns everything noted into batches, then exports the signed
 * snapshot at that head with its chain digest; the next batch chains onto it. The standby verifies the
 * snapshot (root, main base, epoch, signature, digest), imports it into a fresh file and swaps it in.
 *
 * Shipping: one batch in flight to the named standby; a lost reply sends the same batch again (the standby
 * applies a batch once: the same seq and digest is a duplicate). A gap or another epoch is answered with
 * `need_resync`: the shipper resumes from the kept log, or seeds again. An unreachable standby only lags.
 */

/** Batches kept on the main for a standby that falls behind; one further behind is seeded again. */
export const KEEP_REPLICATION_BATCHES = 1000;
/** Pending row changes per batch, and a soft byte bound for one batch. */
const MAX_CHANGES_PER_BATCH = 200;
const MAX_BATCH_BYTES = 1024 * 1024;
/** A seed frame stays under the Kaji line's body limit for `/kaji/standby/seed`. */
const SEED_FRAME_BYTES = MAX_BACKUP_BODY - 64 * 1024;
const MAX_SEED_CHUNKS = 16;
/**
 * After a seed that failed, wait before the next one: from 10 s (it did not arrive) or 60 s (the standby
 * refused), doubling with each failure in a row, at most 10 minutes (#725 review: each one is a full export).
 */
const SEED_REFUSED_BACKOFF_MS = 60_000;
const SEED_UNREACHABLE_BACKOFF_MS = 10_000;
const SEED_MAX_BACKOFF_MS = 10 * 60_000;

const CAPTURE_PREFIX = 'nerv_repl1_';
const APPENDING = "('active', 'draining')";

export const REPLICATION_CAPTURE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS coordinator_replication_pending(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tbl TEXT NOT NULL,
    key_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coordinator_replication_peer(
    base_id TEXT PRIMARY KEY,
    coordinator_epoch INTEGER NOT NULL,
    acked_seq INTEGER NOT NULL,
    seeded_seq INTEGER,
    seeded_at TEXT,
    acked_at TEXT,
    last_error TEXT,
    last_error_at TEXT
  );`;

/** Tables shipped as row changes: the replicated set less the serial-merged registry and the state row. */
const CAPTURED_TABLES = REPLICATED_COORDINATOR_TABLES.filter(
  (t) => t !== 'registry' && t !== 'registry_roots' && t !== 'coordinator_state',
);

const TELEGRAM_COLUMNS = [
  'telegram_offset',
  'telegram_inbox_seq',
  'telegram_inbox_id',
  'telegram_cards_json',
  'telegram_messages_json',
  'telegram_brief_json',
] as const;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function primaryKey(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string; pk: number }[])
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

/**
 * Installs the capture triggers (idempotent). They note keys only while this base's coordinator state is
 * active or draining, so a fenced old main or a standby never accumulates changes.
 */
export function installReplicationCapture(db: DatabaseSync): void {
  const objects = new Set(
    (
      db.prepare("SELECT type || ':' || name AS k FROM sqlite_master WHERE type IN ('table', 'trigger')").all() as {
        k: string;
      }[]
    ).map((r) => r.k),
  );
  if (
    !objects.has('table:coordinator_state') ||
    !objects.has('table:coordinator_replication_log') ||
    !objects.has('table:coordinator_replication_pending') ||
    !objects.has('table:coordinator_replication_peer')
  ) {
    db.exec(COORDINATOR_STATE_SCHEMA);
    db.exec(COORDINATOR_REPLICATION_SCHEMA);
    db.exec(REPLICATION_CAPTURE_SCHEMA);
  }
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
  );
  const when = `WHEN (SELECT replication_mode FROM coordinator_state WHERE id = 1) IN ${APPENDING}`;
  const statements: string[] = [];
  const neededTriggers: string[] = [`${CAPTURE_PREFIX}telegram`];
  for (const table of CAPTURED_TABLES) {
    if (!present.has(table)) continue;
    const pk = primaryKey(db, table);
    // A table without a primary key (an append-only log) is captured by rowid, on insert only.
    const key = (row: 'NEW' | 'OLD') =>
      pk.length
        ? `json_object(${pk.map((c) => `'${c}', ${row}.${quote(c)}`).join(', ')})`
        : `json_object('rowid', ${row}.rowid)`;
    const note = (row: 'NEW' | 'OLD') =>
      `INSERT INTO coordinator_replication_pending(tbl, key_json) VALUES ('${table}', ${key(row)});`;
    const name = (op: string) => {
      const raw = `${CAPTURE_PREFIX}${table}_${op}`;
      neededTriggers.push(raw);
      return quote(raw);
    };
    statements.push(`CREATE TRIGGER IF NOT EXISTS ${name('ins')} AFTER INSERT ON ${quote(table)} ${when}
      BEGIN ${note('NEW')} END;`);
    if (pk.length) {
      statements.push(`CREATE TRIGGER IF NOT EXISTS ${name('upd')} AFTER UPDATE ON ${quote(table)} ${when}
        BEGIN ${note('OLD')} ${note('NEW')} END;`);
      statements.push(`CREATE TRIGGER IF NOT EXISTS ${name('del')} AFTER DELETE ON ${quote(table)} ${when}
        BEGIN ${note('OLD')} END;`);
    }
  }
  if (neededTriggers.every((t) => objects.has(`trigger:${t}`))) return;
  // The Telegram channel's checkpoint (TelegramChannel.save writes these columns): a change is noted, not a
  // rewrite of the same values (the batch append rewrites them with COALESCE).
  const moved = TELEGRAM_COLUMNS.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');
  statements.push(`CREATE TRIGGER IF NOT EXISTS ${quote(`${CAPTURE_PREFIX}telegram`)} AFTER UPDATE ON coordinator_state
    WHEN NEW.replication_mode IN ${APPENDING} AND (${moved})
    BEGIN INSERT INTO coordinator_replication_pending(tbl, key_json) VALUES ('coordinator_state', '{"telegram":1}'); END;`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of statements) db.exec(sql);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function telegramCheckpoint(db: DatabaseSync): ReplicationTelegramCheckpoint {
  const row = db.prepare(`SELECT ${TELEGRAM_COLUMNS.join(', ')} FROM coordinator_state WHERE id = 1`).get() as Record<
    (typeof TELEGRAM_COLUMNS)[number],
    string | number | null
  >;
  return {
    offset: row.telegram_offset as number | null,
    inboxSeq: row.telegram_inbox_seq as number | null,
    inboxId: row.telegram_inbox_id as string | null,
    cardsJson: row.telegram_cards_json as string | null,
    messagesJson: row.telegram_messages_json as string | null,
    briefJson: row.telegram_brief_json as string | null,
  };
}

interface Source {
  readonly root: string;
  readonly sourceBaseId: string;
}

/** Turns up to one batch of noted changes into a log batch, inside the caller's write transaction. */
function captureInTransaction(db: DatabaseSync, source: Source): ReplicationBatch | undefined {
  const pending = db
    .prepare('SELECT id, tbl, key_json FROM coordinator_replication_pending ORDER BY id LIMIT ?')
    .all(MAX_CHANGES_PER_BATCH) as { id: number; tbl: string; key_json: string }[];
  if (!pending.length) return undefined;
  const changes: ReplicationMutation[] = [];
  const seen = new Set<string>();
  let telegram: ReplicationTelegramCheckpoint | undefined;
  let bytes = 0;
  let lastId = 0;
  for (const p of pending) {
    lastId = p.id;
    if (p.tbl === 'coordinator_state') {
      telegram = telegramCheckpoint(db);
      continue;
    }
    const id = `${p.tbl}\0${p.key_json}`;
    if (seen.has(id) || !(CAPTURED_TABLES as readonly string[]).includes(p.tbl)) continue;
    seen.add(id);
    const table = p.tbl as ReplicationMutation['table'];
    const key = JSON.parse(p.key_json) as Record<string, string | number>;
    const cols = Object.keys(key);
    const select = table === 'deliveries' ? 'SELECT rowid AS _rowid_, *' : 'SELECT *';
    const where = cols.map((c) => `${c === 'rowid' ? 'rowid' : quote(c)} = ?`).join(' AND ');
    const row = db.prepare(`${select} FROM ${quote(table)} WHERE ${where}`).get(...cols.map((c) => key[c]!)) as
      Record<string, unknown> | undefined;
    let change: ReplicationMutation | undefined;
    if (row) change = { op: 'upsert', table, row };
    else if (!(cols.length === 1 && cols[0] === 'rowid')) change = { op: 'delete', table, where: key };
    if (!change) continue;
    changes.push(change);
    bytes += JSON.stringify(change).length;
    if (bytes >= MAX_BATCH_BYTES) break;
  }
  // #725 review: a cut batch is not a state the main had. The Telegram offset (saved before the update is
  // handled) goes only with the batch that holds every change noted before it, else it moves to the end of the
  // queue: a promoted main never holds an offset ahead of the rows its updates wrote.
  const deferTelegram =
    telegram !== undefined && !!db.prepare('SELECT 1 FROM coordinator_replication_pending WHERE id > ?').get(lastId);
  const batch = appendReplicationBatchInTransaction(db, {
    ...source,
    changes,
    ...(telegram && !deferTelegram ? { telegram } : {}),
  });
  db.prepare('DELETE FROM coordinator_replication_pending WHERE id <= ?').run(lastId);
  if (deferTelegram)
    db.prepare(
      `INSERT INTO coordinator_replication_pending(tbl, key_json) VALUES ('coordinator_state', '{"telegram":1}')`,
    ).run();
  return batch;
}

function inWriteTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback error.
    }
    throw err;
  }
}

/** One batch of noted changes on the active (or draining) main; undefined when nothing is noted. */
export function captureReplicationBatch(db: DatabaseSync, source: Source): ReplicationBatch | undefined {
  // Nothing noted: no write lock taken (serve calls this every second).
  if (!db.prepare('SELECT 1 FROM coordinator_replication_pending LIMIT 1').get()) return undefined;
  return inWriteTransaction(db, () => {
    const mode = readCoordinatorFencingState(db)?.replicationMode;
    if (mode !== 'active' && mode !== 'draining') return undefined;
    return captureInTransaction(db, source);
  });
}

/** A batch from the main's kept log, as it was first sent (the same id and digest). */
export function replicationBatchAt(
  db: DatabaseSync,
  coordinatorEpoch: number,
  seq: number,
  fallback: Partial<Source> = {},
): ReplicationBatch | undefined {
  const row = db
    .prepare(
      'SELECT prev_digest, batch_digest, changes_json, created_at FROM coordinator_replication_log WHERE coordinator_epoch = ? AND seq = ?',
    )
    .get(coordinatorEpoch, seq) as
    { prev_digest: string; batch_digest: string; changes_json: string; created_at: string } | undefined;
  if (!row) return undefined;
  const stored = JSON.parse(row.changes_json) as
    | ReplicationMutation[]
    | (Source & {
        coordinatorFence: number;
        changes: ReplicationMutation[];
        telegram?: ReplicationTelegramCheckpoint;
      });
  // A batch logged before F-016-T20 holds its changes only.
  const full = Array.isArray(stored) ? undefined : stored;
  const fence = (
    db.prepare('SELECT coordinator_fence FROM coordinator_state WHERE id = 1').get() as
      { coordinator_fence: number } | undefined
  )?.coordinator_fence;
  return {
    version: 1,
    root: full?.root ?? fallback.root ?? '',
    sourceBaseId: full?.sourceBaseId ?? fallback.sourceBaseId ?? '',
    coordinatorEpoch,
    coordinatorFence: full?.coordinatorFence ?? fence ?? 0,
    seq,
    prevDigest: row.prev_digest,
    batchDigest: row.batch_digest,
    createdAt: row.created_at,
    changes: full ? full.changes : (stored as ReplicationMutation[]),
    ...(full?.telegram ? { telegram: full.telegram } : {}),
  };
}

/**
 * The signed seed snapshot of the active main. Every noted change first becomes a batch (a short write
 * transaction); then the tables, the head and the digest are read in one read transaction that finds nothing
 * noted, so no change is both in the snapshot and in a later batch. Serialising and signing run after that
 * transaction ends (#725 review: writers and the lease keeper are not held up by a large export).
 */
export function exportSeedSnapshot(
  db: DatabaseSync,
  input: Source & { readonly privateKey: KeyObject; readonly maxBodyBytes?: number; readonly omitTables?: boolean },
): ExportedCoordinatorSnapshot {
  installReplicationCapture(db);
  const flush = () =>
    inWriteTransaction(db, () => {
      if (readCoordinatorFencingState(db)?.replicationMode !== 'active')
        throw new Error('This base is not the active main: only the active main seeds a standby.');
      while (captureInTransaction(db, input));
      const digest = (
        db.prepare('SELECT state_digest FROM coordinator_state WHERE id = 1').get() as { state_digest: string | null }
      ).state_digest;
      // A chain starts with a batch: a main that never appended one gives the standby a digest to chain onto.
      if (!digest) appendReplicationBatchInTransaction(db, { ...input, changes: [] });
    });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    flush();
    db.exec('BEGIN');
    let state:
      | {
          coordinator_epoch: number;
          coordinator_fence: number;
          replication_mode: string;
          head_seq: number;
          state_digest: string;
        }
      | undefined;
    try {
      const noted = db.prepare('SELECT 1 FROM coordinator_replication_pending LIMIT 1').get();
      state = noted
        ? undefined
        : (db
            .prepare(
              'SELECT coordinator_epoch, coordinator_fence, replication_mode, head_seq, state_digest FROM coordinator_state WHERE id = 1',
            )
            .get() as typeof state);
      if (state && state.replication_mode !== 'active') {
        db.exec('ROLLBACK');
        throw new Error('This base is not the active main: only the active main seeds a standby.');
      }
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Already rolled back.
      }
      throw err;
    }
    if (!state) {
      // A write landed between the two transactions: batch it and read again.
      db.exec('COMMIT');
      continue;
    }
    return exportCoordinatorSnapshot({
      db,
      root: input.root,
      sourceBaseId: input.sourceBaseId,
      coordinatorEpoch: state.coordinator_epoch,
      coordinatorFence: state.coordinator_fence,
      headSeq: state.head_seq,
      headDigest: state.state_digest,
      privateKey: input.privateKey,
      maxBodyBytes: input.maxBodyBytes ?? SEED_FRAME_BYTES,
      inTransaction: true,
      commitAfterRead: true,
      ...(input.omitTables ? { omitTables: true } : {}),
    });
  }
  throw new Error('The main kept writing while the seed was read; it is tried again.');
}

interface SeedWorkerInput extends Source {
  readonly nervSeedWorker: true;
  readonly databasePath: string;
  readonly privateKey: KeyObject;
  readonly maxBodyBytes: number;
}

type SeedWorkerReply =
  | {
      readonly ok: true;
      readonly manifest: ExportedCoordinatorSnapshot['manifest'];
      readonly signature: string;
      readonly chunked: boolean;
      readonly totalBytes: number;
      readonly chunkBuffers: ArrayBuffer[];
    }
  | { readonly ok: false; readonly error: string };

/**
 * F-016-T21: exports, serialises and signs a seed snapshot on a worker thread so serve's event loop keeps
 * answering lease renewals and Kaji requests while a large coordinator store is read and canonicalised.
 */
export async function exportSeedSnapshotAsync(
  db: DatabaseSync,
  input: Source & { readonly privateKey: KeyObject; readonly maxBodyBytes?: number },
  onWorker?: (worker: Worker) => void,
): Promise<ExportedCoordinatorSnapshot> {
  const file = (db.prepare('PRAGMA database_list').all() as { name: string; file: string }[]).find(
    (r) => r.name === 'main',
  )?.file;
  if (!file) return exportSeedSnapshot(db, input);
  const data: SeedWorkerInput = {
    nervSeedWorker: true,
    databasePath: file,
    root: input.root,
    sourceBaseId: input.sourceBaseId,
    privateKey: input.privateKey,
    maxBodyBytes: input.maxBodyBytes ?? SEED_FRAME_BYTES,
  };
  return new Promise<ExportedCoordinatorSnapshot>((resolveExport, rejectExport) => {
    const worker = new Worker(new URL('./coordinator-shipping.ts', import.meta.url), {
      execArgv: [],
      workerData: data,
    });
    onWorker?.(worker);
    let settled = false;
    worker.once('message', (reply: SeedWorkerReply) => {
      settled = true;
      if (!reply.ok) {
        rejectExport(new Error(reply.error));
        return;
      }
      resolveExport({
        manifest: reply.manifest,
        signature: reply.signature,
        tables: {},
        chunked: reply.chunked,
        totalBytes: reply.totalBytes,
        chunks: reply.chunkBuffers.map((ab) => Buffer.from(ab)),
      });
    });
    worker.once('error', (err) => {
      if (!settled) {
        settled = true;
        rejectExport(err);
      }
    });
    worker.once('exit', (code) => {
      if (!settled) {
        settled = true;
        rejectExport(new Error(`Seed snapshot worker exited before replying (code ${code}).`));
      }
    });
  });
}

if (!isMainThread && (workerData as Partial<SeedWorkerInput> | null)?.nervSeedWorker === true) {
  const data = workerData as SeedWorkerInput;
  const workerDb = new DatabaseSync(data.databasePath);
  let reply: SeedWorkerReply;
  let transfer: ArrayBuffer[] = [];
  try {
    workerDb.exec('PRAGMA busy_timeout = 5000');
    const exported = exportSeedSnapshot(workerDb, {
      root: data.root,
      sourceBaseId: data.sourceBaseId,
      privateKey: data.privateKey,
      maxBodyBytes: data.maxBodyBytes,
      omitTables: true,
    });
    transfer = exported.chunks.map((chunk) => {
      const ab = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(ab).set(chunk);
      return ab;
    });
    reply = {
      ok: true,
      manifest: exported.manifest,
      signature: exported.signature,
      chunked: exported.chunked,
      totalBytes: exported.totalBytes,
      chunkBuffers: transfer,
    };
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    workerDb.close();
  }
  parentPort!.postMessage(reply, transfer);
}

/** The standby's answer to one seed frame. */
export type SeedReply =
  | { readonly ok: true; readonly complete: boolean; readonly headSeq?: number }
  | { readonly ok: false; readonly reason: string; readonly error: string };

function removeDbFiles(path: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
}

/**
 * The standby side of a seed: verifies the snapshot and swaps it in as `coordinator-standby.sqlite`. Refused
 * while this base promotes, while it runs as the coordinator, or when the snapshot is older than the epoch
 * this base holds or acked. The lease ack history moves into the new store (the promote checks read it).
 */
export function seedStandbyStore(input: {
  readonly home: string;
  readonly frames: readonly Buffer[];
  readonly publicKey: KeyObject;
  readonly expectedRoot: string;
  readonly expectedMainBaseId: string;
  readonly minCoordinatorEpoch: number;
  /** This base's own coordinator mode in `nerv.sqlite`, if it holds coordinator state. */
  readonly localMode: string | undefined;
}): SeedReply {
  if (existsSync(join(input.home, PROMOTION_MARKER_FILE)))
    return { ok: false, reason: 'promoting', error: 'This base is promoting; it takes no seed.' };
  if (input.localMode === 'active' || input.localMode === 'draining')
    return { ok: false, reason: 'active_coordinator', error: 'This base runs as the coordinator; it is never seeded.' };
  const path = join(input.home, STANDBY_DB_FILE);
  let heldEpoch = 0;
  let ack: Record<string, string | number | null> | undefined;
  if (existsSync(path)) {
    let old: DatabaseSync | undefined;
    try {
      old = new DatabaseSync(path);
      old.exec('PRAGMA busy_timeout = 5000');
      old.exec(STANDBY_LEASE_SCHEMA);
      ack = old.prepare('SELECT * FROM standby_lease_state WHERE id = 1').get() as typeof ack;
      heldEpoch = Math.max(
        readCoordinatorFencingState(old)?.coordinatorEpoch ?? 0,
        Number(ack?.standby_coordinator_epoch ?? 0),
      );
    } catch (err) {
      // Its lease ack history cannot be read, so the epoch it acked is unknown: never replaced unattended.
      return {
        ok: false,
        reason: 'standby_unreadable',
        error: `The standby store ${STANDBY_DB_FILE} is unreadable (${err instanceof Error ? err.message : 'error'}): the owner moves it aside on this base, then the main seeds it again.`,
      };
    } finally {
      old?.close();
    }
  }
  const tmp = `${path}.seed`;
  removeDbFiles(tmp);
  const store = new Store(tmp);
  let headSeq: number;
  try {
    const imported = importCoordinatorSnapshotToStandby({
      frames: input.frames,
      standbyDb: store.db,
      publicKey: input.publicKey,
      expectedRoot: input.expectedRoot,
      expectedMainBaseId: input.expectedMainBaseId,
      minCoordinatorEpoch: Math.max(input.minCoordinatorEpoch, heldEpoch),
    });
    headSeq = imported.manifest.headSeq;
    if (ack) {
      store.db.exec(STANDBY_LEASE_SCHEMA);
      const cols = Object.keys(ack);
      store.db
        .prepare(
          `INSERT INTO standby_lease_state(${cols.map(quote).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        )
        .run(...cols.map((c) => ack![c] ?? null));
    }
    store.db.exec('PRAGMA journal_mode = DELETE');
  } catch (err) {
    store.close();
    removeDbFiles(tmp);
    return { ok: false, reason: 'invalid_snapshot', error: err instanceof Error ? err.message : 'not imported' };
  }
  // Windows: every handle on both files is closed before the swap (a file still open cannot be replaced).
  store.close();
  try {
    for (const suffix of ['-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
    renameSync(tmp, path);
  } catch (err) {
    // Windows: a handle another process still holds on the store refuses the swap; the old store stays.
    removeDbFiles(tmp);
    return { ok: false, reason: 'swap_failed', error: err instanceof Error ? err.message : 'not swapped' };
  }
  return { ok: true, complete: true, headSeq };
}

/** Collects the frames of a chunked seed from one main, then seeds. One seed in progress at a time. */
export class StandbySeedReceiver {
  private pending: { from: string; sha: string; total: number; frames: Map<number, Buffer> } | undefined;

  private readonly seed: (from: string, frames: Buffer[]) => SeedReply;

  constructor(seed: (from: string, frames: Buffer[]) => SeedReply) {
    this.seed = seed;
  }

  receive(from: string, text: string): SeedReply {
    let parsed: Partial<CoordinatorSnapshotChunk> & { manifest?: unknown };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return { ok: false, reason: 'invalid_snapshot', error: 'The seed frame is not JSON.' };
    }
    if (parsed.manifest !== undefined || parsed.totalChunks === 1) return this.seed(from, [Buffer.from(text, 'utf8')]);
    const { snapshotSha256: sha, chunkIndex: index, totalChunks: total } = parsed;
    if (
      typeof sha !== 'string' ||
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(total) ||
      total! < 2 ||
      total! > MAX_SEED_CHUNKS ||
      index! < 0 ||
      index! >= total!
    )
      return { ok: false, reason: 'invalid_snapshot', error: 'Invalid seed frame.' };
    if (!this.pending || this.pending.from !== from || this.pending.sha !== sha || this.pending.total !== total)
      this.pending = { from, sha, total: total!, frames: new Map() };
    this.pending.frames.set(index!, Buffer.from(text, 'utf8'));
    if (this.pending.frames.size < total!) return { ok: true, complete: false };
    const frames = [...this.pending.frames.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f);
    this.pending = undefined;
    return this.seed(from, frames);
  }
}

/**
 * #725 re-check: an apply that failed because the standby store was locked (another connection writing) is
 * retried with the same batch; any other fault (an older schema, an unreadable file) asks for a new seed.
 */
export function replicationApplyFault(err: unknown): 'busy' | 'not_standby' {
  const code = (err as { errcode?: unknown } | undefined)?.errcode;
  const message = err instanceof Error ? err.message : '';
  return code === 5 || code === 6 || /database (table )?is (locked|busy)|SQLITE_(BUSY|LOCKED)/i.test(message)
    ? 'busy'
    : 'not_standby';
}

/** What the main needs from the Kaji line to ship (KajiLink, or a simulated line in tests). */
export interface ShippingLink {
  replicate(baseId: string, batch: ReplicationBatch, leaseExpiresAt: number): Promise<ApplyReplicationBatchResult>;
  seedStandby(baseId: string, frame: Buffer, coordinatorEpoch: number, leaseExpiresAt: number): Promise<SeedReply>;
}

export type ShipOutcome = 'inactive' | 'no-standby' | 'current' | 'behind' | 'seeded' | 'unreachable' | 'refused';

interface PeerRow {
  base_id: string;
  coordinator_epoch: number;
  acked_seq: number;
  seeded_seq: number | null;
  seeded_at: string | null;
  acked_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

export interface ReplicationStatus {
  readonly standby: string | undefined;
  readonly coordinatorEpoch: number;
  readonly headSeq: number;
  readonly peer:
    | {
        readonly coordinatorEpoch: number;
        readonly ackedSeq: number;
        readonly seededSeq: number | undefined;
        readonly seededAt: string | undefined;
        readonly ackedAt: string | undefined;
        readonly lastError: string | undefined;
        readonly lastErrorAt: string | undefined;
      }
    | undefined;
  /** Batches the standby is behind, when its position at this epoch is known. */
  readonly lag: number | undefined;
  /** When the oldest batch the standby has not acked was committed. */
  readonly oldestUnackedAt: string | undefined;
}

/** What `kaji standby` shows: the named standby, its seed and how far behind it is. */
export function replicationStatus(db: DatabaseSync): ReplicationStatus {
  db.exec(COORDINATOR_REPLICATION_SCHEMA);
  db.exec(REPLICATION_CAPTURE_SCHEMA);
  const state = db
    .prepare('SELECT coordinator_epoch, head_seq, standby_base_id FROM coordinator_state WHERE id = 1')
    .get() as { coordinator_epoch: number; head_seq: number; standby_base_id: string | null } | undefined;
  const standby = state?.standby_base_id ?? undefined;
  const row = standby
    ? (db.prepare('SELECT * FROM coordinator_replication_peer WHERE base_id = ?').get(standby) as PeerRow | undefined)
    : undefined;
  const epoch = state?.coordinator_epoch ?? 0;
  const head = state?.head_seq ?? 0;
  const known = row && row.coordinator_epoch === epoch;
  const lag = known ? Math.max(head - row.acked_seq, 0) : undefined;
  const oldest =
    known && lag
      ? (
          db
            .prepare('SELECT created_at FROM coordinator_replication_log WHERE coordinator_epoch = ? AND seq = ?')
            .get(epoch, row.acked_seq + 1) as { created_at: string } | undefined
        )?.created_at
      : undefined;
  return {
    standby,
    coordinatorEpoch: epoch,
    headSeq: head,
    peer: row
      ? {
          coordinatorEpoch: row.coordinator_epoch,
          ackedSeq: row.acked_seq,
          seededSeq: row.seeded_seq ?? undefined,
          seededAt: row.seeded_at ?? undefined,
          ackedAt: row.acked_at ?? undefined,
          lastError: row.last_error ?? undefined,
          lastErrorAt: row.last_error_at ?? undefined,
        }
      : undefined,
    lag,
    oldestUnackedAt: oldest,
  };
}

/** One line for the owner (`nerv kaji standby`). */
export function formatReplicationStatus(s: ReplicationStatus): string {
  if (!s.standby) return 'Replication: no standby named.';
  const p = s.peer;
  if (!p) return `Replication: ${s.standby} not seeded from this main yet (head seq ${s.headSeq}).`;
  const parts = [
    p.seededSeq !== undefined
      ? `seeded at seq ${p.seededSeq}${p.seededAt ? ` (${p.seededAt})` : ''}`
      : 'seeded earlier',
    p.coordinatorEpoch === s.coordinatorEpoch
      ? `standby at seq ${p.ackedSeq} of ${s.headSeq} (lag ${s.lag ?? 0})` +
        (s.oldestUnackedAt ? `, oldest unsent batch from ${s.oldestUnackedAt}` : '')
      : `standby position unknown at epoch ${s.coordinatorEpoch} (last seen at epoch ${p.coordinatorEpoch}); it is seeded again`,
  ];
  if (p.lastError) parts.push(`last error: ${p.lastError}${p.lastErrorAt ? ` (${p.lastErrorAt})` : ''}`);
  return `Replication: ${parts.join('; ')}.`;
}

export interface ReplicationShipperOptions {
  readonly db: DatabaseSync;
  readonly baseId: string;
  readonly root: string;
  /** The base key that signs a seed snapshot (read when a seed is sent). */
  readonly privateKey: () => KeyObject;
  readonly link: ShippingLink;
  readonly keepBatches?: number;
  readonly maxBatchesPerTick?: number;
  readonly log?: (line: string) => void;
  /** The wall clock the seed backoff reads (tests inject one). */
  readonly now?: () => number;
  /** How `flush()` waits between rounds (tests inject one). */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * serve's replication loop on the active main (F-016-T20). `tick()` turns noted changes into batches and
 * sends what the named standby lacks, one batch at a time; it never throws and never blocks on a standby.
 */
export class ReplicationShipper {
  private readonly o: ReplicationShipperOptions;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<ShipOutcome> | undefined;
  private readonly workers = new Set<Worker>();
  private installed = false;
  private seedRetryAt = 0;
  private seedFailures = 0;
  private pruned = false;

  constructor(options: ReplicationShipperOptions) {
    this.o = options;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private state() {
    const s = readCoordinatorFencingState(this.o.db);
    if (!s) return undefined;
    const row = this.o.db.prepare('SELECT head_seq, standby_base_id FROM coordinator_state WHERE id = 1').get() as {
      head_seq: number;
      standby_base_id: string | null;
    };
    return { ...s, headSeq: row.head_seq, standby: row.standby_base_id ?? undefined };
  }

  private noteAck(baseId: string, epoch: number, seq: number, seeded = false): void {
    const at = this.now();
    this.o.db
      .prepare(
        `INSERT INTO coordinator_replication_peer(base_id, coordinator_epoch, acked_seq, seeded_seq, seeded_at, acked_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(base_id) DO UPDATE SET coordinator_epoch = excluded.coordinator_epoch, acked_seq = excluded.acked_seq,
           seeded_seq = COALESCE(excluded.seeded_seq, seeded_seq), seeded_at = COALESCE(excluded.seeded_at, seeded_at),
           acked_at = excluded.acked_at, last_error = NULL, last_error_at = NULL`,
      )
      .run(baseId, epoch, seq, seeded ? seq : null, seeded ? at : null, at);
  }

  private noteError(baseId: string, error: string): void {
    this.o.db
      .prepare(
        `INSERT INTO coordinator_replication_peer(base_id, coordinator_epoch, acked_seq, last_error, last_error_at)
         VALUES (?, 0, 0, ?, ?)
         ON CONFLICT(base_id) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at`,
      )
      .run(baseId, error.slice(0, 300), this.now());
  }

  private ensureCapture(): void {
    if (this.installed) return;
    installReplicationCapture(this.o.db);
    this.installed = true;
  }

  private source(): Source {
    return { root: this.o.root, sourceBaseId: this.o.baseId };
  }

  /** Seeds `standby` from a signed snapshot of this main; throws when it cannot (the caller reports it). */
  async seed(standby: string): Promise<{ headSeq: number }> {
    if (standby === this.o.baseId) throw new Error('A coordinator never names or seeds its own base.');
    const state = this.state();
    if (state?.replicationMode !== 'active')
      throw new Error('This base is not the active main: only the active main seeds a standby.');
    this.ensureCapture();
    const exported = await exportSeedSnapshotAsync(
      this.o.db,
      { ...this.source(), privateKey: this.o.privateKey() },
      (worker) => {
        this.workers.add(worker);
        worker.once('exit', () => this.workers.delete(worker));
      },
    );
    const { coordinatorEpoch, headSeq } = exported.manifest;
    let reply: SeedReply = { ok: true, complete: false };
    for (const frame of exported.chunks) {
      const current = this.state();
      if (current?.replicationMode !== 'active' || current.coordinatorEpoch !== coordinatorEpoch)
        throw new Error('This base is no longer the active main: only the active main seeds a standby.');
      reply = await this.o.link.seedStandby(standby, frame, coordinatorEpoch, current.leaseExpiresAt);
      if (!reply.ok) throw new Error(`${standby} refused the seed (${reply.reason}): ${reply.error}`);
    }
    if (!reply.ok || !reply.complete) throw new Error(`${standby} did not complete the seed.`);
    const after = this.state();
    if (after?.replicationMode !== 'active' || after.coordinatorEpoch !== coordinatorEpoch)
      throw new Error('This base is no longer the active main: only the active main seeds a standby.');
    this.noteAck(standby, coordinatorEpoch, headSeq, true);
    this.o.log?.(`Replication: seeded ${standby} at seq ${headSeq}.`);
    return { headSeq };
  }

  private clock(): number {
    return this.o.now?.() ?? Date.now();
  }

  private async reseed(standby: string): Promise<ShipOutcome> {
    if (this.clock() < this.seedRetryAt) return 'behind';
    try {
      await this.seed(standby);
      this.seedRetryAt = 0;
      this.seedFailures = 0;
      return 'seeded';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'seed failed';
      const refused = /refused/.test(message);
      const base = refused ? SEED_REFUSED_BACKOFF_MS : SEED_UNREACHABLE_BACKOFF_MS;
      this.seedRetryAt = this.clock() + Math.min(base * 2 ** this.seedFailures, SEED_MAX_BACKOFF_MS);
      this.seedFailures += 1;
      this.noteError(standby, `seed: ${message}`);
      return refused ? 'refused' : 'unreachable';
    }
  }

  /** Captures noted changes into batches (bounded per call) and drops what no standby needs any more. */
  private capture(epoch: number, head: number): number {
    const limit = this.o.maxBatchesPerTick ?? 20;
    let captured = 0;
    for (let i = 0; i < limit; i += 1) {
      const batch = captureReplicationBatch(this.o.db, this.source());
      if (!batch) break;
      head = batch.seq;
      captured += 1;
    }
    if (!captured && this.pruned) return head;
    this.pruned = true;
    const keep = this.o.keepBatches ?? KEEP_REPLICATION_BATCHES;
    this.o.db
      .prepare('DELETE FROM coordinator_replication_log WHERE coordinator_epoch < ? OR seq <= ?')
      .run(epoch, head - keep);
    return head;
  }

  private async ship(): Promise<ShipOutcome> {
    const state = this.state();
    if (!state || (state.replicationMode !== 'active' && state.replicationMode !== 'draining')) return 'inactive';
    this.ensureCapture();
    const epoch = state.coordinatorEpoch;
    const head = this.capture(epoch, state.headSeq);
    const standby = state.standby;
    if (!standby || standby === this.o.baseId) return 'no-standby';
    const lease = state.leaseExpiresAt;
    const peer = this.o.db
      .prepare('SELECT coordinator_epoch, acked_seq FROM coordinator_replication_peer WHERE base_id = ?')
      .get(standby) as { coordinator_epoch: number; acked_seq: number } | undefined;
    // An unknown position is probed with the head batch: the standby answers where it is.
    let next = peer && peer.coordinator_epoch === epoch ? peer.acked_seq + 1 : head;
    const limit = this.o.maxBatchesPerTick ?? 20;
    for (let i = 0; i < limit; i += 1) {
      if (next > head) return 'current';
      // A position the kept log no longer holds: the head batch asks the standby where it is first (a snapshot
      // is exported only for a standby that answers).
      const batch =
        replicationBatchAt(this.o.db, epoch, next, this.source()) ??
        (next !== head ? replicationBatchAt(this.o.db, epoch, head, this.source()) : undefined);
      if (!batch) return state.replicationMode === 'active' ? this.reseed(standby) : 'behind';
      let res: ApplyReplicationBatchResult;
      try {
        res = await this.o.link.replicate(standby, batch, lease);
      } catch (err) {
        this.noteError(standby, err instanceof Error ? err.message : 'unreachable');
        return /refused \(4\d\d\)/.test(err instanceof Error ? err.message : '') ? 'refused' : 'unreachable';
      }
      if (res.ok) {
        this.noteAck(standby, epoch, res.headSeq);
        next = res.headSeq + 1;
        continue;
      }
      if (
        res.reason === 'need_resync' &&
        res.coordinatorEpoch === epoch &&
        res.expectedSeq !== next &&
        res.expectedSeq <= head &&
        replicationBatchAt(this.o.db, epoch, res.expectedSeq)
      ) {
        this.noteAck(standby, epoch, res.expectedSeq - 1);
        next = res.expectedSeq;
        continue;
      }
      if (res.reason === 'need_resync' && res.coordinatorEpoch === epoch && res.expectedSeq > head + 1)
        this.o.log?.(
          `Replication: ${standby} is ahead of this main at epoch ${epoch} (seq ${res.expectedSeq - 1} > ${head}); it is seeded from this main.`,
        );
      if (res.reason === 'busy') {
        this.noteError(standby, 'the standby store was busy; the same batch is sent again');
        return 'behind';
      }
      if (res.reason === 'invalid_batch') {
        this.noteError(standby, 'the standby refused a batch as invalid');
        return 'refused';
      }
      // Another epoch, a gap the log no longer holds, a diverged digest, or no standby store: seed again.
      return state.replicationMode === 'active' ? this.reseed(standby) : 'behind';
    }
    return 'behind';
  }

  /** One round; concurrent calls share it (one batch in flight). Never throws. */
  tick(): Promise<ShipOutcome> {
    if (!this.running)
      this.running = this.ship()
        .catch((err: unknown) => {
          this.o.log?.(`Replication: ${err instanceof Error ? err.message : 'shipping failed'}.`);
          return 'unreachable' as const;
        })
        .finally(() => {
          this.running = undefined;
        });
    return this.running;
  }

  /**
   * `kaji drain`: stops effects (draining), turns the last noted changes into batches and sends them until the
   * standby holds the head. Throws, and returns the main to active, when the standby does not confirm it.
   */
  async flush(attempts = 5): Promise<{ ackedSeq: number; headSeq: number }> {
    const db = this.o.db;
    db.prepare(
      "UPDATE coordinator_state SET replication_mode = 'draining' WHERE id = 1 AND replication_mode = 'active'",
    ).run();
    let outcome: ShipOutcome = 'behind';
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
    for (let i = 0; i < attempts && outcome !== 'current' && outcome !== 'no-standby'; i += 1) {
      if (i > 0) await sleep(1000);
      outcome = await this.tick();
    }
    const status = replicationStatus(db);
    if (outcome === 'current' || outcome === 'no-standby')
      return { ackedSeq: status.peer?.ackedSeq ?? 0, headSeq: status.headSeq };
    db.prepare(
      "UPDATE coordinator_state SET replication_mode = 'active' WHERE id = 1 AND replication_mode = 'draining'",
    ).run();
    throw new Error(
      `${status.standby} did not confirm the final batch (${outcome}; ${status.peer?.lastError ?? 'no answer'}): nothing was drained.`,
    );
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const worker of this.workers) void worker.terminate();
    this.workers.clear();
  }
}
