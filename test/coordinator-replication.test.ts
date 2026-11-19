import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
import { COORDINATOR_STATE_SCHEMA } from '../src/coordinator-snapshot.ts';
import { type BaseEntry, type SignedRecord } from '../src/kaji.ts';
import { Store } from '../src/store.ts';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        reject(new Error('No port'));
        return;
      }
      const p = addr.port;
      srv.close(() => resolve(p));
    });
  });
}

function makeKeyBase(baseId: string, name: string, port: number) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const entry: BaseEntry = {
    baseId,
    name,
    address: `127.0.0.1:${port}`,
    publicKey: pubPem,
    fingerprint: `fp-${baseId}`,
    status: 'enrolled',
    serial: 1,
  };
  return { baseId, name, publicKey, privateKey, pubPem, entry };
}

describe('F-016-T04: incremental log shipping to standby over /kaji/replicate', () => {
  it('appends ordered digest-chained batches on main, ships via signed /kaji/replicate, and applies to standby', async () => {
    const mainStore = new Store(':memory:');
    const standbyStore = new Store(':memory:');
    const bMain = makeKeyBase('NERV-01', 'Tokyo', await freePort());
    const bStandby = makeKeyBase('NERV-02', 'Tabgha', await freePort());

    let mainLink: KajiLink | undefined;
    let standbyLink: KajiLink | undefined;

    try {
      // Seed active main & standby states at head_seq = 10 after snapshot import.
      mainStore.db.exec(COORDINATOR_STATE_SCHEMA);
      mainStore.db
        .prepare(
          "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, state_digest) VALUES (1, 2, 5, 'active', 10, 'snap-digest')",
        )
        .run();

      standbyStore.db.exec(COORDINATOR_STATE_SCHEMA);
      standbyStore.db
        .prepare(
          "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, state_digest) VALUES (1, 2, 5, 'standby', 10, 'snap-digest')",
        )
        .run();

      const bases: BaseEntry[] = [bMain.entry, bStandby.entry];
      const portImpl = (mainId: string): RegistryPort => ({
        bases: async () => bases,
        records: async (): Promise<SignedRecord[]> => [],
        add: async () => 0,
        seen: async () => {},
        lastSeen: async () => ({}),
        main: async () => mainId,
      });

      standbyLink = new KajiLink({
        baseId: bStandby.baseId,
        key: bStandby.privateKey,
        publicKey: bStandby.pubPem,
        registry: portImpl('NERV-01'),
        onReplicate: async (_from, batch) =>
          standbyStore.applyStandbyReplicationBatch(batch, {
            expectedRoot: 'root-fp-1',
            expectedMainBaseId: 'NERV-01',
            minCoordinatorEpoch: 2,
          }),
      });
      await standbyLink.start(60_000);

      mainLink = new KajiLink({
        baseId: bMain.baseId,
        key: bMain.privateKey,
        publicKey: bMain.pubPem,
        registry: portImpl('NERV-01'),
      });
      await mainLink.start(60_000);

      const leaseExpiresAt = Date.now() + 60_000;

      // Batch 1 (seq 11): delivery with exact rowid + fact (FTS5) + telegram checkpoint.
      const batch1 = mainStore.appendReplicationBatch({
        root: 'root-fp-1',
        sourceBaseId: 'NERV-01',
        changes: [
          {
            op: 'upsert',
            table: 'deliveries',
            row: {
              _rowid_: 105,
              id: 'del-105',
              reminder_id: null,
              kind: 'brief',
              message: 'Incremental brief 105',
              created: '2026-11-19T12:00:00Z',
              read_at: null,
            },
          },
          {
            op: 'upsert',
            table: 'facts',
            row: {
              id: 'fact-11',
              text: 'Tabgha standby runs incremental replication',
              status: 'active',
              source: 'user',
              sortie_id: null,
              tainted: 0,
              shareable: 0,
              created: '2026-11-19T12:00:00Z',
              updated: '2026-11-19T12:00:00Z',
            },
          },
        ],
        telegram: { offset: 444, inboxSeq: 105, inboxId: 'del-105' },
      });
      assert.equal(batch1.seq, 11);
      assert.equal(batch1.prevDigest, 'snap-digest');

      const res1 = await mainLink.replicate('NERV-02', batch1, leaseExpiresAt);
      assert.equal(res1.ok, true);
      if (res1.ok) assert.equal(res1.headSeq, 11);

      // Duplicate delivery of batch 1 is idempotent.
      const dup1 = await mainLink.replicate('NERV-02', batch1, leaseExpiresAt);
      assert.equal(dup1.ok, true);
      if (dup1.ok) assert.equal(dup1.duplicate, true);

      // Batch 2 (seq 12) chained on batch1.batchDigest.
      const batch2 = mainStore.appendReplicationBatch({
        root: 'root-fp-1',
        sourceBaseId: 'NERV-01',
        changes: [
          {
            op: 'upsert',
            table: 'deliveries',
            row: {
              _rowid_: 106,
              id: 'del-106',
              reminder_id: null,
              kind: 'brief',
              message: 'Incremental brief 106',
              created: '2026-11-19T12:01:00Z',
              read_at: null,
            },
          },
        ],
      });
      assert.equal(batch2.seq, 12);
      assert.equal(batch2.prevDigest, batch1.batchDigest);

      // Sequence gap: shipping batch 3 (seq 13) before batch 2 returns need_resync(expectedSeq: 12) without mutating standby.
      const batch3 = mainStore.appendReplicationBatch({
        root: 'root-fp-1',
        sourceBaseId: 'NERV-01',
        changes: [
          {
            op: 'upsert',
            table: 'deliveries',
            row: {
              _rowid_: 107,
              id: 'del-107',
              reminder_id: null,
              kind: 'brief',
              message: 'Incremental brief 107',
              created: '2026-11-19T12:02:00Z',
              read_at: null,
            },
          },
        ],
      });
      const gapRes = await mainLink.replicate('NERV-02', batch3, leaseExpiresAt);
      assert.equal(gapRes.ok, false);
      if (!gapRes.ok) {
        assert.equal(gapRes.reason, 'need_resync');
        assert.equal(gapRes.expectedSeq, 12);
      }
      const delCountBefore = (standbyStore.db.prepare('SELECT count(*) AS n FROM deliveries').get() as { n: number }).n;
      assert.equal(delCountBefore, 1);

      // Now catch up with batch 2 then batch 3.
      assert.equal((await mainLink.replicate('NERV-02', batch2, leaseExpiresAt)).ok, true);
      assert.equal((await mainLink.replicate('NERV-02', batch3, leaseExpiresAt)).ok, true);

      const del107 = standbyStore.db.prepare('SELECT rowid, id FROM deliveries WHERE rowid = 107').get() as {
        rowid: number;
        id: string;
      };
      assert.equal(del107.id, 'del-107');

      const ftsHits = standbyStore.db
        .prepare("SELECT fact_id FROM facts_fts WHERE facts_fts MATCH 'incremental'")
        .all() as Array<{ fact_id: string }>;
      assert.deepEqual(
        ftsHits.map((r) => r.fact_id),
        ['fact-11'],
      );

      const cs = standbyStore.db
        .prepare('SELECT head_seq, telegram_offset FROM coordinator_state WHERE id = 1')
        .get() as { head_seq: number; telegram_offset: number };
      assert.equal(cs.head_seq, 13);
      assert.equal(cs.telegram_offset, 444);

      // Expired lease header is rejected with 409 stale_coordinator_lease.
      const batch4 = mainStore.appendReplicationBatch({
        root: 'root-fp-1',
        sourceBaseId: 'NERV-01',
        changes: [],
      });
      await assert.rejects(
        () => mainLink!.replicate('NERV-02', batch4, Date.now() - 300_000),
        /409|stale_coordinator_lease/,
      );
    } finally {
      await mainLink?.stop();
      await standbyLink?.stop();
      mainStore.close();
      standbyStore.close();
    }
  });
});
