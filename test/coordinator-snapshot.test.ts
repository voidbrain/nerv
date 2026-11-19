import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  exportCoordinatorSnapshot,
  reassembleCoordinatorSnapshot,
  REPLICATED_COORDINATOR_TABLES,
  verifyCoordinatorSnapshot,
} from '../src/coordinator-snapshot.ts';
import { MAX_BACKUP_BODY } from '../src/kaji-link.ts';
import { Store } from '../src/store.ts';

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

      const exported = exportCoordinatorSnapshot({
        db: store.db,
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
      const exported = exportCoordinatorSnapshot({
        db: store.db,
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
