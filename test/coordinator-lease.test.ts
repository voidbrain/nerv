import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';
import { CoordinatorAuthorityError, assertActiveCoordinator } from '../src/coordinator-authority.ts';
import { LEASE_EFFECTIVE_TTL_MS, LEASE_TTL_MS } from '../src/coordinator-lease.ts';
import { COORDINATOR_STATE_SCHEMA } from '../src/coordinator-snapshot.ts';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
import { fingerprint, type BaseEntry, type SignedRecord } from '../src/kaji.ts';
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

function makeBase(baseId: string, name: string, port: number) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const entry: BaseEntry = {
    baseId,
    name,
    address: `127.0.0.1:${port}`,
    publicKey: pubB64,
    fingerprint: fingerprint(pubB64),
    status: 'enrolled',
    serial: 1,
  };
  return { baseId, publicKey, privateKey, pubB64, entry };
}

describe('F-016-T06: standby-acked lease renewal, self-fencing, and sleep-wake refusal', () => {
  it('renews lease over /kaji/lease/renew, refuses asleep old leader on wake, and rejects stale epoch after promotion', async () => {
    assert.equal(LEASE_EFFECTIVE_TTL_MS, 55_000);

    const mainStore = new Store(':memory:');
    const standbyStore = new Store(':memory:');
    const bMain = makeBase('NERV-01', 'Tokyo', await freePort());
    const bStandby = makeBase('NERV-02', 'Tabgha', await freePort());

    mainStore.db.exec(COORDINATOR_STATE_SCHEMA);
    mainStore.db
      .prepare(
        "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, 2, 1, 'active', 10, 0, 'digest-2')",
      )
      .run();

    standbyStore.db.exec(COORDINATOR_STATE_SCHEMA);
    standbyStore.db
      .prepare(
        "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, 2, 1, 'standby', 10, 0, 'digest-2')",
      )
      .run();

    const bases: BaseEntry[] = [bMain.entry, bStandby.entry];
    const port: RegistryPort = {
      bases: async () => bases,
      records: async (): Promise<SignedRecord[]> => [],
      add: async () => 0,
      seen: async () => {},
      lastSeen: async () => ({}),
      main: async () => 'NERV-01',
    };

    let standbyMaxSeenEpoch = 2;
    let standbyPromoting = false;

    const standbyLink = new KajiLink({
      baseId: bStandby.baseId,
      key: bStandby.privateKey,
      publicKey: bStandby.pubB64,
      registry: port,
      onLeaseRenew: async (_from, req) =>
        standbyStore.handleStandbyLeaseRenew({
          standbyBaseId: 'NERV-02',
          request: req,
          maxSeenCoordinatorEpoch: standbyMaxSeenEpoch,
          processBootId: 'boot-standby-1',
          promoting: standbyPromoting,
          nowMs: 1_700_000_000_500,
        }),
    });
    const mainLink = new KajiLink({
      baseId: bMain.baseId,
      key: bMain.privateKey,
      publicKey: bMain.pubB64,
      registry: port,
    });

    await standbyLink.start(60_000);
    await mainLink.start(60_000);

    try {
      // 1. Acquire standby-acked lease for epoch 2, seq 1.
      const reqStartedWallMs = 1_700_000_000_000;
      const reqStartedMonoNs = 10_000_000_000n;
      const ack1 = await mainLink.renewLease('NERV-02', { coordinatorEpoch: 2, leaseSeq: 1 });
      assert.equal(ack1.ok, true);
      if (ack1.ok) {
        assert.equal(ack1.standbyBaseId, 'NERV-02');
        assert.equal(ack1.coordinatorEpoch, 2);
        assert.equal(ack1.ackSeq, 1);
        assert.equal(ack1.headSeq, 10);
        assert.equal(ack1.leaseTtlMs, LEASE_TTL_MS);
      }

      const applied = mainStore.applyCoordinatorLease({
        coordinatorEpoch: 2,
        reqStartedWallMs,
        reqStartedMonoNs,
      });
      assert.equal(applied.leaseExpiresAt, reqStartedWallMs + 55_000);

      // Active before expiry.
      assert.doesNotThrow(() => mainStore.assertActiveCoordinator(reqStartedWallMs + 10_000));

      // 2. Simulating laptop sleep > 55s: asleep old leader is refused on wake before any renewal timer runs!
      const wakeMs = reqStartedWallMs + 200_000;
      assert.throws(
        () => mainStore.add('After sleep', new Date(wakeMs + 60_000).toISOString(), new Date(wakeMs)),
        (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'stale_coordinator_lease',
      );
      assert.throws(
        () => assertActiveCoordinator({ db: mainStore.db, nowMs: wakeMs }),
        (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'stale_coordinator_lease',
      );

      // 3. Benign >175s wake renewal succeeds when standby still sees epoch 2.
      const ack2 = await mainLink.renewLease('NERV-02', { coordinatorEpoch: 2, leaseSeq: 2 });
      assert.equal(ack2.ok, true);

      // Replaying same seq 2 is rejected as stale_lease_seq.
      const replay = await mainLink.renewLease('NERV-02', { coordinatorEpoch: 2, leaseSeq: 2 });
      assert.equal(replay.ok, false);
      if (!replay.ok) assert.equal(replay.reason, 'stale_lease_seq');

      // 4. Once standby promotes or sees epoch 3, old leader's renewal is rejected and it self-fences.
      standbyMaxSeenEpoch = 3;
      const stale = await mainLink.renewLease('NERV-02', { coordinatorEpoch: 2, leaseSeq: 3 });
      assert.equal(stale.ok, false);
      if (!stale.ok) assert.equal(stale.reason, 'stale_coordinator_epoch');

      mainStore.selfFenceCoordinator();
      assert.equal(mainStore.coordinatorFencingState()?.replicationMode, 'fenced');
      assert.throws(
        () => mainStore.assertActiveCoordinator(wakeMs),
        (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'coordinator_not_active',
      );

      // 5. Promoting standby refuses renewal even at matching epoch.
      standbyMaxSeenEpoch = 2;
      standbyPromoting = true;
      const promoting = await mainLink.renewLease('NERV-02', { coordinatorEpoch: 2, leaseSeq: 4 });
      assert.equal(promoting.ok, false);
      if (!promoting.ok) assert.equal(promoting.reason, 'promoting');
    } finally {
      await mainLink.stop();
      await standbyLink.stop();
      mainStore.close();
      standbyStore.close();
    }
  });

  it('requires --confirm-sole-coordinator and zero enrolled standbys to re-arm a sole coordinator lease', () => {
    const store = new Store(':memory:');
    try {
      store.db.exec(COORDINATOR_STATE_SCHEMA);
      store.db
        .prepare(
          "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, 1, 0, 'fenced', 0, 0, 'd1')",
        )
        .run();

      assert.throws(
        () =>
          store.rearmSoleCoordinatorLease({
            coordinatorEpoch: 1,
            hasEnrolledStandby: true,
            confirmSoleCoordinator: true,
          }),
        /enrolled standby/,
      );
      assert.throws(
        () =>
          store.rearmSoleCoordinatorLease({
            coordinatorEpoch: 1,
            hasEnrolledStandby: false,
            confirmSoleCoordinator: false,
          }),
        /--confirm-sole-coordinator/,
      );

      const nowMs = 1_700_000_000_000;
      const rearmed = store.rearmSoleCoordinatorLease({
        coordinatorEpoch: 1,
        hasEnrolledStandby: false,
        confirmSoleCoordinator: true,
        nowMs,
        nowMonoNs: 5_000_000_000n,
      });
      assert.equal(rearmed.leaseExpiresAt, nowMs + 55_000);
      assert.equal(store.coordinatorFencingState()?.replicationMode, 'active');
      assert.doesNotThrow(() => store.assertActiveCoordinator(nowMs + 1000));
    } finally {
      store.close();
    }
  });
});
