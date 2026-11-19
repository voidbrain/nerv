import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  REPLICATED_COORDINATOR_TABLES,
  type CoordinatorSnapshotChunk,
  type CoordinatorSnapshotPayload,
} from '../src/coordinator-snapshot.ts';
import { canonical } from '../src/kaji.ts';
import { MAX_BACKUP_BODY } from '../src/kaji-link.ts';
import { Store } from '../src/store.ts';

function verifyCoordinatorSnapshot(payload: CoordinatorSnapshotPayload, publicKey: KeyObject): void {
  const ok = verify(
    null,
    Buffer.from(canonical(payload.manifest), 'utf8'),
    publicKey,
    Buffer.from(payload.signature, 'base64'),
  );
  if (!ok) {
    throw new Error('Coordinator snapshot signature verification failed.');
  }
  const actualSha256 = createHash('sha256').update(canonical(payload.tables), 'utf8').digest('hex');
  if (actualSha256 !== payload.manifest.sha256) {
    throw new Error('Coordinator snapshot digest mismatch.');
  }
}

function reassembleCoordinatorSnapshot(frames: readonly Buffer[], publicKey: KeyObject): CoordinatorSnapshotPayload {
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
    assert.equal(parsedChunks.length, total);
    const ordered = [...parsedChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const buffers = ordered.map((c, i) => {
      assert.equal(c.chunkIndex, i);
      assert.equal(c.totalChunks, total);
      assert.equal(c.snapshotSha256, expectedHash);
      return Buffer.from(c.dataBase64, 'base64');
    });
    payload = JSON.parse(Buffer.concat(buffers).toString('utf8')) as CoordinatorSnapshotPayload;
    assert.equal(payload.manifest.sha256, expectedHash);
  }
  verifyCoordinatorSnapshot(payload, publicKey);
  return payload;
}

describe('F-016-T03: signed coordinator state snapshot export', () => {
  it('exports replicated inventory with exact deliveries.rowid, signed by base key, excluding base-local tables and secrets', () => {
    const store = new Store(':memory:');
    try {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      // Seed coordinator data including a gap in deliveries.rowid to verify exact rowid preservation.
      store.db
        .prepare(
          "INSERT INTO deliveries(rowid, id, reminder_id, kind, message, created, read_at) VALUES (?, ?, NULL, 'brief', ?, ?, NULL)",
        )
        .run(42, 'del-42', 'Morning brief', '2026-11-19T08:00:00Z');
      store.db
        .prepare(
          "INSERT INTO reminders(id, title, due, created, delivered, cancelled) VALUES ('rem-1', 'Check packs', '2026-11-20T09:00:00Z', '2026-11-19T08:00:00Z', NULL, NULL)",
        )
        .run();
      // Seed base-local tables that must NEVER be exported.
      store.db
        .prepare(
          "INSERT INTO push_vapid(id, public_key, private_key, created) VALUES ('1', 'pub', 'SECRET-VAPID-PRIVATE', '2026-11-19T08:00:00Z')",
        )
        .run();
      store.db.prepare("INSERT INTO kaji_seen(base_id, last_seen) VALUES ('NERV-02', '2026-11-19T08:00:00Z')").run();

      const exported = store.exportCoordinatorSnapshot({
        root: 'root-fingerprint-test',
        sourceBaseId: 'NERV-01',
        coordinatorEpoch: 3,
        coordinatorFence: 12,
        headSeq: 99,
        privateKey,
        exportedAt: '2026-11-19T12:00:00Z',
      });

      assert.equal(exported.chunked, false);
      assert.equal(exported.chunks.length, 1);
      assert.ok(exported.totalBytes <= MAX_BACKUP_BODY);
      assert.equal(exported.manifest.coordinatorEpoch, 3);
      assert.equal(exported.manifest.coordinatorFence, 12);
      assert.equal(exported.manifest.headSeq, 99);

      // Exact deliveries.rowid preserved.
      const deliveries = exported.tables.deliveries;
      assert.equal(deliveries?.length, 1);
      assert.equal(deliveries![0]!._rowid_, 42);
      assert.equal(deliveries![0]!.id, 'del-42');

      // Base-local tables and secrets are never included.
      assert.equal(Object.hasOwn(exported.tables, 'push_vapid'), false);
      assert.equal(Object.hasOwn(exported.tables, 'kaji_seen'), false);
      assert.equal(Object.hasOwn(exported.tables, 'worker_jobs'), false);
      assert.equal(Object.hasOwn(exported.tables, 'model_usage'), false);
      assert.equal(JSON.stringify(exported.tables).includes('SECRET-VAPID-PRIVATE'), false);
      assert.deepEqual(Object.keys(exported.tables), [...REPLICATED_COORDINATOR_TABLES]);

      // Signature & digest verify with the base public key.
      const reassembled = reassembleCoordinatorSnapshot(exported.chunks, publicKey);
      assert.equal(reassembled.manifest.sha256, exported.manifest.sha256);

      // Wrong public key or tampered table is rejected.
      const wrongKey = generateKeyPairSync('ed25519').publicKey;
      assert.throws(() => verifyCoordinatorSnapshot(reassembled, wrongKey), /signature/i);
      const tampered = structuredClone(reassembled);
      tampered.tables.reminders = [];
      assert.throws(() => verifyCoordinatorSnapshot(tampered, publicKey), /digest/i);
    } finally {
      store.close();
    }
  });

  it('chunks snapshot payloads within maxBodyBytes and reassembles them losslessly', () => {
    const store = new Store(':memory:');
    try {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      for (let i = 1; i <= 15; i += 1) {
        store.db
          .prepare(
            "INSERT INTO deliveries(rowid, id, reminder_id, kind, message, created, read_at) VALUES (?, ?, NULL, 'brief', ?, ?, NULL)",
          )
          .run(i * 10, `del-${i}`, `Message payload ${'x'.repeat(120)} #${i}`, '2026-11-19T08:00:00Z');
      }

      const maxBodyBytes = 1024;
      const exported = store.exportCoordinatorSnapshot({
        root: 'root-fingerprint-test',
        sourceBaseId: 'NERV-01',
        coordinatorEpoch: 1,
        coordinatorFence: 1,
        headSeq: 15,
        privateKey,
        maxBodyBytes,
      });

      assert.equal(exported.chunked, true);
      assert.ok(exported.chunks.length > 1);
      for (const chunk of exported.chunks) {
        assert.ok(chunk.length <= maxBodyBytes, `chunk ${chunk.length} > ${maxBodyBytes}`);
      }

      const reassembled = reassembleCoordinatorSnapshot(exported.chunks, publicKey);
      assert.equal(reassembled.tables.deliveries?.length, 15);
      assert.equal(reassembled.tables.deliveries![14]!._rowid_, 150);
    } finally {
      store.close();
    }
  });
});

describe('F-016-T13: standby snapshot import into coordinator-standby.sqlite', () => {
  it('verifies signature, root, sourceBaseId and epoch before any write; imports with exact rowids, standby mode, and FTS5 rebuild', () => {
    const mainStore = new Store(':memory:');
    const standbyStore = new Store(':memory:');
    const localHostStore = new Store(':memory:');
    try {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      mainStore.db
        .prepare(
          "INSERT INTO deliveries(rowid, id, reminder_id, kind, message, created, read_at) VALUES (?, ?, NULL, 'brief', ?, ?, NULL)",
        )
        .run(77, 'del-77', 'Standby delivery 77', '2026-11-19T08:00:00Z');
      mainStore.db
        .prepare(
          "INSERT INTO facts(id, text, status, source, sortie_id, tainted, shareable, created, updated) VALUES ('fact-1', 'Standby drone uses 6S packs', 'active', 'user', NULL, 0, 0, '2026-11-19T08:00:00Z', '2026-11-19T08:00:00Z')",
        )
        .run();
      mainStore.db
        .prepare(
          "INSERT INTO episodes(id, since, until, summary, exchanges, proposed, created) VALUES ('ep-1', '2026-11-19T07:00:00Z', '2026-11-19T08:00:00Z', 'Calibrated compass on Tabgha', 2, 0, '2026-11-19T08:00:00Z')",
        )
        .run();

      // Host's own nerv.sqlite has its own local delivery rowid 1 that must stay untouched.
      localHostStore.db
        .prepare(
          "INSERT INTO deliveries(rowid, id, reminder_id, kind, message, created, read_at) VALUES (1, 'local-del-1', NULL, 'worker', 'Local worker notice', '2026-11-19T08:00:00Z', NULL)",
        )
        .run();

      const exported = mainStore.exportCoordinatorSnapshot({
        root: 'root-fp-1',
        sourceBaseId: 'NERV-01',
        coordinatorEpoch: 4,
        coordinatorFence: 19,
        headSeq: 205,
        privateKey,
      });

      // Pre-write verification failures must leave standby untouched.
      const wrongKey = generateKeyPairSync('ed25519').publicKey;
      assert.throws(
        () =>
          standbyStore.importStandbySnapshot({
            frames: exported.chunks,
            publicKey: wrongKey,
            expectedRoot: 'root-fp-1',
            expectedMainBaseId: 'NERV-01',
          }),
        /signature/i,
      );
      assert.throws(
        () =>
          standbyStore.importStandbySnapshot({
            frames: exported.chunks,
            publicKey,
            expectedRoot: 'wrong-root',
            expectedMainBaseId: 'NERV-01',
          }),
        /root/i,
      );
      assert.throws(
        () =>
          standbyStore.importStandbySnapshot({
            frames: exported.chunks,
            publicKey,
            expectedRoot: 'root-fp-1',
            expectedMainBaseId: 'NERV-02',
          }),
        /active main/i,
      );
      assert.throws(
        () =>
          standbyStore.importStandbySnapshot({
            frames: exported.chunks,
            publicKey,
            expectedRoot: 'root-fp-1',
            expectedMainBaseId: 'NERV-01',
            minCoordinatorEpoch: 5,
          }),
        /stale/i,
      );
      const beforeCount = (standbyStore.db.prepare('SELECT count(*) AS n FROM deliveries').get() as { n: number }).n;
      assert.equal(beforeCount, 0);

      // Valid import into standbyStore succeeds.
      const imported = standbyStore.importStandbySnapshot({
        frames: exported.chunks,
        publicKey,
        expectedRoot: 'root-fp-1',
        expectedMainBaseId: 'NERV-01',
        minCoordinatorEpoch: 4,
      });
      assert.equal(imported.replicationMode, 'standby');

      const coordState = standbyStore.db.prepare('SELECT * FROM coordinator_state WHERE id = 1').get() as {
        replication_mode: string;
        coordinator_epoch: number;
        coordinator_fence: number;
        head_seq: number;
        state_digest: string;
      };
      assert.equal(coordState.replication_mode, 'standby');
      assert.equal(coordState.coordinator_epoch, 4);
      assert.equal(coordState.coordinator_fence, 19);
      assert.equal(coordState.head_seq, 205);
      assert.equal(coordState.state_digest, exported.manifest.sha256);

      // Exact deliveries.rowid preserved in standby, while host nerv.sqlite stayed untouched.
      const standbyDel = standbyStore.db.prepare('SELECT rowid, id FROM deliveries').get() as {
        rowid: number;
        id: string;
      };
      assert.equal(standbyDel.rowid, 77);
      assert.equal(standbyDel.id, 'del-77');
      const localDel = localHostStore.db.prepare('SELECT rowid, id FROM deliveries').get() as {
        rowid: number;
        id: string;
      };
      assert.equal(localDel.rowid, 1);
      assert.equal(localDel.id, 'local-del-1');

      // FTS5 tables rebuilt locally and searchable.
      const factHits = standbyStore.db
        .prepare("SELECT fact_id FROM facts_fts WHERE facts_fts MATCH '6S'")
        .all() as Array<{ fact_id: string }>;
      assert.deepEqual(
        factHits.map((r) => r.fact_id),
        ['fact-1'],
      );
      const epHits = standbyStore.db
        .prepare("SELECT episode_id FROM episodes_fts WHERE episodes_fts MATCH 'Tabgha'")
        .all() as Array<{ episode_id: string }>;
      assert.deepEqual(
        epHits.map((r) => r.episode_id),
        ['ep-1'],
      );
    } finally {
      mainStore.close();
      standbyStore.close();
      localHostStore.close();
    }
  });
});
