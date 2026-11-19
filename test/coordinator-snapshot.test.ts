import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, verify, type KeyObject } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('F-016-T14: serial-monotonic registry merge and worker approval settlement', () => {
  it('merges registry and registry_roots by serial so a newer local revoke survives an older snapshot', () => {
    const mainStore = new Store(':memory:');
    const standbyStore = new Store(':memory:');
    try {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      // Main snapshot has registry records serial 1 and 2.
      mainStore.db
        .prepare(
          "INSERT INTO registry(id, serial, kind, base_id, body, signature, received) VALUES ('reg-1', 1, 'enroll', 'NERV-01', '{}', 'sig1', '2026-11-19T08:00:00Z')",
        )
        .run();
      mainStore.db
        .prepare(
          "INSERT INTO registry(id, serial, kind, base_id, body, signature, received) VALUES ('reg-2', 2, 'enroll', 'NERV-02', '{}', 'sig2', '2026-11-19T08:01:00Z')",
        )
        .run();
      mainStore.db.prepare("INSERT INTO registry_roots(id, root) VALUES ('reg-1', 'root-fp-1')").run();

      // Standby already learned serial 1, 2 AND a newer serial 3 revoke via heartbeat.
      standbyStore.db
        .prepare(
          "INSERT INTO registry(id, serial, kind, base_id, body, signature, received) VALUES ('reg-1', 1, 'enroll', 'NERV-01', '{}', 'sig1', '2026-11-19T08:00:00Z')",
        )
        .run();
      standbyStore.db
        .prepare(
          "INSERT INTO registry(id, serial, kind, base_id, body, signature, received) VALUES ('reg-2', 2, 'enroll', 'NERV-02', '{}', 'sig2', '2026-11-19T08:01:00Z')",
        )
        .run();
      standbyStore.db
        .prepare(
          "INSERT INTO registry(id, serial, kind, base_id, body, signature, received) VALUES ('reg-3', 3, 'revoke', 'NERV-02', '{}', 'sig3', '2026-11-19T09:00:00Z')",
        )
        .run();
      standbyStore.db.prepare("INSERT INTO registry_roots(id, root) VALUES ('reg-1', 'root-fp-1')").run();

      const exported = mainStore.exportCoordinatorSnapshot({
        root: 'root-fp-1',
        sourceBaseId: 'NERV-01',
        coordinatorEpoch: 2,
        coordinatorFence: 5,
        headSeq: 10,
        privateKey,
      });

      standbyStore.importStandbySnapshot({
        frames: exported.chunks,
        publicKey,
        expectedRoot: 'root-fp-1',
        expectedMainBaseId: 'NERV-01',
      });

      const rows = standbyStore.db.prepare('SELECT id, serial, kind FROM registry ORDER BY serial ASC').all() as Array<{
        id: string;
        serial: number;
        kind: string;
      }>;
      assert.deepEqual(
        rows.map((r) => ({ id: r.id, serial: r.serial, kind: r.kind })),
        [
          { id: 'reg-1', serial: 1, kind: 'enroll' },
          { id: 'reg-2', serial: 2, kind: 'enroll' },
          { id: 'reg-3', serial: 3, kind: 'revoke' },
        ],
      );
    } finally {
      mainStore.close();
      standbyStore.close();
    }
  });

  it('uses worker_approvals.persisted_decision with hasApproval LEFT JOIN so expire, cancelWorker and releaseWorker settle once', () => {
    const store = new Store(':memory:');
    try {
      const makeJobAndApproval = (jobId: string, approvalId: string, persistedDecision: string | null) => {
        const expires = Date.now() - 1000;
        const inserted = store.db
          .prepare(
            "INSERT INTO worker_jobs(id, owner, sequence, hash, session, epoch, expires, state, worker_key, owner_key) VALUES (?, ?, NULL, NULL, 'sess-1', 1, ?, 'running', 'k1', 'ok1')",
          )
          .run(jobId, 'NERV-01', expires);
        const lease = {
          id: jobId,
          owner: 'NERV-01',
          fence: Number(inserted.lastInsertRowid),
          session: 'sess-1',
          epoch: 1,
          expires,
          key: 'k1',
          ownerKey: 'ok1',
        };
        store.db
          .prepare('INSERT INTO worker_approvals(approval_id, lease, persisted_decision) VALUES (?, ?, ?)')
          .run(approvalId, JSON.stringify(lease), persistedDecision);
      };

      const jobApprovedId = randomUUID();
      const jobExpireId = randomUUID();
      const jobCancelId = randomUUID();
      const jobReleaseId = randomUUID();

      // Case A: promoted standby with missing approvals row (hasApproval=false) and persisted_decision='approve'
      // Store.expire must NOT throw "No approval with that ID." and must preserve uncertainty (stay running).
      makeJobAndApproval(jobApprovedId, 'app-approved', 'approve');

      // Case B: promoted standby with missing approvals row (hasApproval=false) and persisted_decision=NULL
      // Store.expire settles it once as 'reject' without calling decideCore.
      makeJobAndApproval(jobExpireId, 'app-expire', null);

      // Case C: cancelWorker on a job with missing approvals row (hasApproval=false) settles once without throwing.
      makeJobAndApproval(jobCancelId, 'app-cancel', null);

      // Case D: releaseWorker on a job with missing approvals row (hasApproval=false) settles once without throwing.
      makeJobAndApproval(jobReleaseId, 'app-release', null);

      const before = store.workerJobs.waitingApprovals();
      const approvedItem = before.find((w) => w.id === 'app-approved');
      assert.equal(approvedItem?.hasApproval, false);
      assert.equal(approvedItem?.decision, 'approve');

      // cancelWorker & releaseWorker settle their targets cleanly.
      store.cancelWorker('NERV-01', jobCancelId, 'Cancelled after promotion', 'cli');
      store.releaseWorker(jobReleaseId, 'Confirmed stopped', true);

      // expire settles jobExpireId once and leaves jobApprovedId alone.
      store.expire(new Date());
      store.expire(new Date());

      const jobApproved = store.db.prepare('SELECT state FROM worker_jobs WHERE id = ?').get(jobApprovedId) as {
        state: string;
      };
      const jobExpire = store.db.prepare('SELECT state FROM worker_jobs WHERE id = ?').get(jobExpireId) as {
        state: string;
      };
      const appExpire = store.db
        .prepare("SELECT persisted_decision FROM worker_approvals WHERE approval_id = 'app-expire'")
        .get() as { persisted_decision: string | null };
      assert.equal(jobApproved.state, 'running');
      assert.equal(jobExpire.state, 'completed');
      assert.equal(appExpire.persisted_decision, 'reject');
    } finally {
      store.close();
    }
  });
});

describe('F-016-T15: 5-step quiesce-merge-swap under serve guard', () => {
  function setupSwapFixture(dir: string) {
    const mainDbPath = join(dir, 'nerv.sqlite');
    const standbyDbPath = join(dir, 'coordinator-standby.sqlite');
    const archivePath = join(dir, 'nerv.pre-standby.sqlite');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');

    // Source coordinator snapshot
    const source = new Store(':memory:');
    source.db
      .prepare(
        "INSERT INTO deliveries(rowid, id, reminder_id, kind, message, created, read_at) VALUES (88, 'del-88', NULL, 'brief', 'From main', '2026-11-19T08:00:00Z', NULL)",
      )
      .run();
    source.db
      .prepare(
        "INSERT INTO registry(id, serial, kind, base_id, body, signature, received) VALUES ('reg-1', 1, 'enroll', 'NERV-01', '{}', 'sig1', '2026-11-19T08:00:00Z')",
      )
      .run();
    const exported = source.exportCoordinatorSnapshot({
      root: 'root-fp-1',
      sourceBaseId: 'NERV-01',
      coordinatorEpoch: 4,
      coordinatorFence: 10,
      headSeq: 50,
      privateKey,
    });
    source.close();

    // Standby DB holds imported snapshot
    const standby = new Store(standbyDbPath);
    standby.importStandbySnapshot({
      frames: exported.chunks,
      publicKey,
      expectedRoot: 'root-fp-1',
      expectedMainBaseId: 'NERV-01',
    });
    standby.db.exec('PRAGMA user_version = 4');
    standby.close();

    // Local nerv.sqlite holds base-local tables, user_version = 6, and a newer serial-2 revoke
    const local = new Store(mainDbPath);
    local.db.exec('PRAGMA user_version = 6');
    local.db
      .prepare(
        "INSERT INTO push_vapid(id, public_key, private_key, created) VALUES ('1', 'pub', 'LOCAL-VAPID-PRIV', '2026-11-19T08:00:00Z')",
      )
      .run();
    local.db.prepare("INSERT INTO kaji_seen(base_id, last_seen) VALUES ('NERV-01', '2026-11-19T09:00:00Z')").run();
    local.db
      .prepare(
        "INSERT INTO registry(id, serial, kind, base_id, body, signature, received) VALUES ('reg-2', 2, 'revoke', 'NERV-01', '{}', 'sig2', '2026-11-19T09:00:00Z')",
      )
      .run();
    local.close();

    return { mainDbPath, standbyDbPath, archivePath };
  }

  it('runs the 5-step quiesce-merge-swap, preserves base-local tables and user_version, and keeps loops quiesced during swap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-f016-t15-'));
    try {
      const { mainDbPath, standbyDbPath, archivePath } = setupSwapFixture(dir);
      const events: string[] = [];
      const result = Store.promoteStandby({
        mainDbPath,
        standbyDbPath,
        preStandbyArchivePath: archivePath,
        newCoordinatorEpoch: 5,
        quiesce: () => events.push('quiesce'),
        restart: () => events.push('restart'),
      });

      assert.deepEqual(events, ['quiesce', 'restart']);
      assert.equal(result.promoted, true);
      assert.equal(result.coordinatorEpoch, 5);
      assert.equal(result.replicationMode, 'active');
      assert.equal(result.preservedUserVersion, 6);
      assert.ok(result.preservedLocalTables.includes('push_vapid'));
      assert.ok(result.preservedLocalTables.includes('kaji_seen'));
      assert.equal(existsSync(archivePath), true);
      assert.equal(existsSync(standbyDbPath), false);

      const promoted = new Store(mainDbPath);
      try {
        const uv = (promoted.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        assert.equal(uv, 6);
        const del = promoted.db.prepare('SELECT rowid, id FROM deliveries').get() as { rowid: number; id: string };
        assert.equal(del.rowid, 88);
        assert.equal(del.id, 'del-88');
        const vapid = promoted.db.prepare('SELECT private_key FROM push_vapid').get() as { private_key: string };
        assert.equal(vapid.private_key, 'LOCAL-VAPID-PRIV');
        const reg = promoted.db.prepare('SELECT id, serial, kind FROM registry ORDER BY serial ASC').all() as Array<{
          id: string;
          serial: number;
          kind: string;
        }>;
        assert.equal(reg.length, 2);
        assert.equal(reg[1]!.kind, 'revoke');
        const cs = promoted.db
          .prepare('SELECT coordinator_epoch, replication_mode FROM coordinator_state WHERE id = 1')
          .get() as { coordinator_epoch: number; replication_mode: string };
        assert.equal(cs.coordinator_epoch, 5);
        assert.equal(cs.replication_mode, 'active');
      } finally {
        promoted.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recovers cleanly from an injected crash after each step (1..5)', () => {
    for (const failAfterStep of [1, 2, 3, 4, 5] as const) {
      const dir = mkdtempSync(join(tmpdir(), `nerv-f016-t15-crash-${failAfterStep}-`));
      try {
        const { mainDbPath, standbyDbPath, archivePath } = setupSwapFixture(dir);
        let restartedDuringCrash = false;
        assert.throws(
          () =>
            Store.promoteStandby({
              mainDbPath,
              standbyDbPath,
              preStandbyArchivePath: archivePath,
              newCoordinatorEpoch: 5,
              failAfterStep,
              restart: () => {
                restartedDuringCrash = true;
              },
            }),
          /Injected crash/,
        );
        assert.equal(restartedDuringCrash, false);

        // Recovery run completes without losing base-local tables or user_version.
        const recovered = Store.promoteStandby({
          mainDbPath,
          standbyDbPath,
          preStandbyArchivePath: archivePath,
          newCoordinatorEpoch: 5,
        });
        assert.equal(recovered.promoted, true);
        assert.equal(recovered.replicationMode, 'active');
        assert.equal(recovered.preservedUserVersion, 6);

        const promoted = new Store(mainDbPath);
        try {
          const vapid = promoted.db.prepare('SELECT private_key FROM push_vapid').get() as { private_key: string };
          assert.equal(vapid.private_key, 'LOCAL-VAPID-PRIV');
          const del = promoted.db.prepare('SELECT rowid, id FROM deliveries').get() as { rowid: number; id: string };
          assert.equal(del.rowid, 88);
        } finally {
          promoted.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
