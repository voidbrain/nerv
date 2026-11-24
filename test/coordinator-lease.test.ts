import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';
import { CoordinatorAuthorityError, assertActiveCoordinator } from '../src/coordinator-authority.ts';
import {
  CoordinatorLeaseKeeper,
  LEASE_EFFECTIVE_TTL_MS,
  LEASE_TTL_MS,
  handleStandbyLeaseRenew,
} from '../src/coordinator-lease.ts';
import { COORDINATOR_STATE_SCHEMA } from '../src/coordinator-snapshot.ts';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
import {
  Registry,
  baseKey,
  fingerprint,
  signRecord,
  type BaseEntry,
  type RegistryBody,
  type SignedRecord,
} from '../src/kaji.ts';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pinKajiRoot, setBase } from '../src/config.ts';
import { coordinatorLeaseService } from '../src/coordinator-serve.ts';
import {
  RELOCATION_HORIZON_ACKED_MS,
  STANDBY_DB_FILE,
  checkRelocationReadiness,
  relocateCoordinator,
} from '../src/coordinator-relocation.ts';
import { runKajiCommand } from '../src/cli-kaji.ts';
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

describe('F-016-T16: the active main renews its lease and fences itself when renewals stop', () => {
  function activeMain(epoch: number, standby: string | null, leaseExpiresAt = 0) {
    const store = new Store(':memory:');
    store.db.exec(COORDINATOR_STATE_SCHEMA);
    store.db
      .prepare(
        "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest, standby_base_id) VALUES (1, ?, 1, 'active', 10, ?, 'digest', ?)",
      )
      .run(epoch, leaseExpiresAt, standby);
    return store;
  }
  function standbyStoreAt(epoch: number) {
    const store = new Store(':memory:');
    store.db.exec(COORDINATOR_STATE_SCHEMA);
    store.db
      .prepare(
        "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, ?, 1, 'standby', 10, 0, 'digest')",
      )
      .run(epoch);
    return store;
  }
  const isLease = (err: unknown) =>
    err instanceof CoordinatorAuthorityError && err.reason === 'stale_coordinator_lease';
  const isFenced = (err: unknown) =>
    err instanceof CoordinatorAuthorityError && err.reason === 'coordinator_not_active';

  it('renews through the standby over the Kaji line, keeps effects open, and self-fences once renewals stop past the lease', async () => {
    const mainStore = activeMain(2, 'NERV-02');
    const standbyStore = standbyStoreAt(2);
    const bMain = makeBase('NERV-01', 'Tokyo', await freePort());
    const bStandby = makeBase('NERV-02', 'Tabgha', await freePort());
    const port: RegistryPort = {
      bases: async () => [bMain.entry, bStandby.entry],
      records: async (): Promise<SignedRecord[]> => [],
      add: async () => 0,
      seen: async () => {},
      lastSeen: async () => ({}),
      main: async () => 'NERV-01',
    };
    let standbyMaxSeen = 2;
    const standbyLink = new KajiLink({
      baseId: bStandby.baseId,
      key: bStandby.privateKey,
      publicKey: bStandby.pubB64,
      registry: port,
      onLeaseRenew: async (_from, request) =>
        standbyStore.handleStandbyLeaseRenew({
          standbyBaseId: 'NERV-02',
          request,
          maxSeenCoordinatorEpoch: standbyMaxSeen,
          processBootId: 'boot-standby',
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
    let wall = 1_700_000_000_000;
    let mono = 50_000_000_000n;
    let standbyDown = false;
    const keeper = new CoordinatorLeaseKeeper({
      db: mainStore.db,
      renew: (id, req) => (standbyDown ? Promise.reject(new Error('unreachable')) : mainLink.renewLease(id, req)),
      hasOtherEnrolledBases: () => true,
      wallNow: () => wall,
      monoNow: () => mono,
    });
    try {
      // Promoted (epoch 2) with a standby: lease 0 is not authority, effects wait for the first ack.
      assert.throws(() => mainStore.assertActiveCoordinator(wall), isLease);
      assert.equal(await keeper.renewOnce(), 'renewed');
      assert.equal(mainStore.coordinatorFencingState()?.leaseExpiresAt, wall + LEASE_EFFECTIVE_TTL_MS);
      assert.doesNotThrow(() => mainStore.add('Coolant', new Date(wall + 60_000).toISOString(), new Date(wall)));

      // The standby stops answering: within the lease nothing changes; past it the main fences itself.
      standbyDown = true;
      wall += 30_000;
      mono += 30_000_000_000n;
      assert.equal(await keeper.renewOnce(), 'waiting');
      assert.equal(mainStore.coordinatorFencingState()?.replicationMode, 'active');
      // A backward wall-clock jump does not extend the lease: the monotonic deadline still fences.
      wall -= 20_000;
      mono += 30_000_000_000n;
      assert.equal(await keeper.renewOnce(), 'fenced');
      assert.equal(mainStore.coordinatorFencingState()?.replicationMode, 'fenced');
      assert.throws(() => mainStore.assertActiveCoordinator(wall), isFenced);
      // Fenced stays fenced: a later reachable standby does not revive it.
      standbyDown = false;
      assert.equal(await keeper.renewOnce(), 'inactive');

      // A standby that has seen a newer epoch refuses the renewal: the old main fences at once.
      const old = activeMain(2, 'NERV-02', wall + 40_000);
      standbyMaxSeen = 3;
      const superseded = new CoordinatorLeaseKeeper({
        db: old.db,
        renew: (id, req) => mainLink.renewLease(id, req),
        hasOtherEnrolledBases: () => true,
        wallNow: () => wall,
        monoNow: () => mono,
      });
      assert.equal(await superseded.renewOnce(), 'fenced');
      assert.equal(old.coordinatorFencingState()?.replicationMode, 'fenced');
      old.close();
    } finally {
      await mainLink.stop();
      await standbyLink.stop();
      mainStore.close();
      standbyStore.close();
    }
  });

  it('renews a sole coordinator only while its lease is live, and never without a standby while other bases are enrolled', async () => {
    let wall = 1_700_000_000_000;
    const mono = () => BigInt(wall) * 1_000_000n;
    const renew = async (): Promise<never> => {
      throw new Error('no standby is named');
    };
    const sole = activeMain(3, null, wall + 10_000);
    const keeper = new CoordinatorLeaseKeeper({
      db: sole.db,
      renew,
      hasOtherEnrolledBases: () => false,
      wallNow: () => wall,
      monoNow: mono,
    });
    assert.equal(await keeper.renewOnce(), 'self-renewed');
    assert.equal(sole.coordinatorFencingState()?.leaseExpiresAt, wall + LEASE_EFFECTIVE_TTL_MS);
    // Asleep past the lease: no self-renewal on wake; the owner re-arms (kaji lease-rearm).
    wall += 200_000;
    assert.equal(await keeper.renewOnce(), 'fenced');
    assert.throws(() => sole.assertActiveCoordinator(wall), isFenced);
    sole.close();

    const crowded = activeMain(3, null, wall + 10_000);
    const lonely = new CoordinatorLeaseKeeper({
      db: crowded.db,
      renew,
      hasOtherEnrolledBases: () => true,
      wallNow: () => wall,
      monoNow: mono,
    });
    assert.equal(await lonely.renewOnce(), 'waiting');
    assert.equal(crowded.coordinatorFencingState()?.leaseExpiresAt, wall + 10_000, 'never self-renewed');
    wall += 10_000;
    assert.equal(await lonely.renewOnce(), 'fenced');
    crowded.close();

    // Lease 0 after a relocation is not authority, with or without other bases.
    const promoted = activeMain(3, null, 0);
    assert.throws(() => promoted.assertActiveCoordinator(wall), isLease);
    promoted.close();
  });
});

describe('F-016-T16: serve wiring joins the keeper, the standby ack, the authority check and the relocation wait', () => {
  it('renews through the standby base as serve runs it, lets the standby promote without confirmation, and fences the old main', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-lease-serve-'));
    const root = generateKeyPairSync('ed25519');
    const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const homes = { main: join(dir, 'main'), standby: join(dir, 'standby') };
    const ports = { main: await freePort(), standby: await freePort() };
    const stores: Store[] = [];
    const regs: Registry[] = [];
    for (const [id, home] of [
      ['NERV-01', homes.main],
      ['NERV-02', homes.standby],
    ] as const) {
      mkdirSync(home, { recursive: true });
      setBase(home, { id, name: id });
      pinKajiRoot(home, rootPub, true);
      const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
      stores.push(store);
      regs.push(new Registry(store.db, rootPub));
    }
    let serial = 0;
    const signed = (body: Omit<RegistryBody, 'serial' | 'issued'>) =>
      signRecord(root.privateKey, { ...body, serial: ++serial, issued: '2026-11-24T10:00:00.000Z' } as RegistryBody);
    const records = [
      signed({
        kind: 'enrol',
        baseId: 'NERV-01',
        name: 'Tokyo',
        publicKey: baseKey(homes.main).publicKey,
        address: `127.0.0.1:${ports.main}`,
      }),
      signed({
        kind: 'enrol',
        baseId: 'NERV-02',
        name: 'Tabgha',
        publicKey: baseKey(homes.standby).publicKey,
        address: `127.0.0.1:${ports.standby}`,
      }),
      signed({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 }),
    ];
    for (const reg of regs) for (const r of records) reg.add(r);
    const [mainStore, standbyHomeStore] = stores as [Store, Store];
    mainStore.db.exec(COORDINATOR_STATE_SCHEMA);
    mainStore.db
      .prepare(
        "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest, standby_base_id) VALUES (1, 2, 1, 'active', 7, 0, 'digest-7', 'NERV-02')",
      )
      .run();
    const standbyDb = new DatabaseSync(join(homes.standby, STANDBY_DB_FILE));
    standbyDb.exec(COORDINATOR_STATE_SCHEMA);
    standbyDb
      .prepare(
        "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, 2, 1, 'standby', 7, 0, 'digest-7')",
      )
      .run();

    const service = (home: string, baseId: string) =>
      coordinatorLeaseService({
        home,
        databasePath: join(home, 'nerv.sqlite'),
        baseId,
        root: rootPub,
        ownPublicKey: baseKey(home).publicKey,
      });
    const mainLease = service(homes.main, 'NERV-01');
    const standbyLease = service(homes.standby, 'NERV-02');
    const port = (reg: Registry): RegistryPort => ({
      bases: async () => reg.bases(),
      records: async () => reg.records(),
      add: async () => 0,
      seen: async () => {},
      lastSeen: async () => ({}),
      main: async () => reg.main(),
    });
    const standbyLink = new KajiLink({
      baseId: 'NERV-02',
      key: baseKey(homes.standby).privateKey,
      publicKey: baseKey(homes.standby).publicKey,
      registry: port(regs[1]!),
      onLeaseRenew: standbyLease.onLeaseRenew,
    });
    const mainLink = new KajiLink({
      baseId: 'NERV-01',
      key: baseKey(homes.main).privateKey,
      publicKey: baseKey(homes.main).publicKey,
      registry: port(regs[0]!),
    });
    await standbyLink.start(60_000);
    await mainLink.start(60_000);
    const keeper = mainLease.keeper((id, req) => mainLink.renewLease(id, req));
    const later = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
    try {
      assert.throws(() => mainStore.add('Before the first ack', later(1)), /no armed lease/);
      assert.equal(await keeper.renewOnce(), 'renewed');
      assert.equal(mainStore.add('Acked', later(1)).title, 'Acked');

      // The owner relocates to NERV-02 while NERV-01 is cut off: only the standby holds the new record.
      regs[1]!.add(signed({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 }));
      const ready = checkRelocationReadiness({
        candidateDb: standbyDb,
        selfBaseId: 'NERV-02',
        previousMainBaseId: 'NERV-01',
        registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
        liveness: {
          kind: 'unplanned',
          epochSeenAtMs: Date.now(),
          allUnrevokedAckedNewEpoch: true,
          oldHostDownConfirmed: false,
          nowMs: Date.now() + RELOCATION_HORIZON_ACKED_MS,
          monoSinceNs: 0n,
          monoNowNs: BigInt(RELOCATION_HORIZON_ACKED_MS) * 1_000_000n,
        },
      });
      assert.deepEqual([ready.previousEpoch, ready.newEpoch], [2, 3]);

      // The standby holds the newer main record: its signed refusal names epoch 3, so the old main fences at
      // once (F-016-T16 review fix 2; it used to wait for its lease to pass).
      assert.equal(await keeper.renewOnce(), 'fenced');
      assert.throws(() => mainStore.add('After the move', later(2)), /fenced mode/);
    } finally {
      await mainLink.stop();
      await standbyLink.stop();
      mainLease.stop();
      standbyLease.stop();
      standbyDb.close();
      mainStore.close();
      standbyHomeStore.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F-016-T16 review fixes (#701)', () => {
  function main(epoch: number, standby: string | null, leaseExpiresAt = 0, mode = 'active') {
    const store = new Store(':memory:');
    store.db.exec(COORDINATOR_STATE_SCHEMA);
    store.db
      .prepare(
        'INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest, standby_base_id) VALUES (1, ?, 1, ?, 10, ?, ?, ?)',
      )
      .run(epoch, mode, leaseExpiresAt, 'digest', standby);
    return store;
  }
  function standbyAt(epoch: number) {
    const store = new Store(':memory:');
    store.db.exec(COORDINATOR_STATE_SCHEMA);
    store.db
      .prepare(
        "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, ?, 1, 'standby', 10, 0, 'digest')",
      )
      .run(epoch);
    return store;
  }
  const ackVia =
    (standby: Store, maxSeen: () => number, nowMs: () => number) =>
    async (id: string, request: { coordinatorEpoch: number; leaseSeq: number }) =>
      standby.handleStandbyLeaseRenew({
        standbyBaseId: id,
        request,
        maxSeenCoordinatorEpoch: maxSeen(),
        processBootId: 'boot',
        nowMs: nowMs(),
      });

  it('BLOCKER: a main promoted with other bases enrolled names its standby, renews through it and holds authority', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-reloc-standby-'));
    try {
      const mainPath = join(dir, 'nerv.sqlite');
      const standbyPath = join(dir, STANDBY_DB_FILE);
      new Store(mainPath).close();
      const s = new Store(standbyPath);
      s.db.exec(COORDINATOR_STATE_SCHEMA);
      s.db
        .prepare(
          "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest, standby_base_id) VALUES (1, 2, 1, 'standby', 7, 0, 'digest-7', 'NERV-02')",
        )
        .run();
      s.close();
      relocateCoordinator({
        mainDbPath: mainPath,
        standbyDbPath: standbyPath,
        selfBaseId: 'NERV-02',
        previousMainBaseId: 'NERV-01',
        registryMain: { baseId: 'NERV-02', coordinatorEpoch: 3 },
        soleCoordinator: false,
        standbyBaseId: 'NERV-01',
        liveness: {
          kind: 'unplanned',
          epochSeenAtMs: 0,
          allUnrevokedAckedNewEpoch: false,
          oldHostDownConfirmed: true,
          nowMs: 10 * LEASE_TTL_MS,
          monoSinceNs: 0n,
          monoNowNs: BigInt(10 * LEASE_TTL_MS) * 1_000_000n,
        },
      });
      const promoted = new Store(mainPath);
      const peer = standbyAt(2);
      try {
        const row = promoted.db.prepare('SELECT standby_base_id FROM coordinator_state WHERE id = 1').get() as {
          standby_base_id: string | null;
        };
        assert.equal(row.standby_base_id, 'NERV-01');
        assert.throws(() => promoted.assertActiveCoordinator(), /no armed lease/);
        // The named base acks at the new epoch: the keeper arms the lease and the base has authority.
        const named: string[] = [];
        const keeper = new CoordinatorLeaseKeeper({
          db: promoted.db,
          renew: async (id, req) => {
            named.push(id);
            return ackVia(peer, () => 3, Date.now)(id, req);
          },
          hasOtherEnrolledBases: () => true,
        });
        assert.equal(await keeper.renewOnce(), 'renewed');
        assert.deepEqual(named, ['NERV-01']);
        assert.equal(promoted.assertActiveCoordinator()?.coordinatorEpoch, 3);
      } finally {
        promoted.close();
        peer.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('BLOCKER: kaji standby names only a base that acks from a standby store; a base without one never acks (re-review)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-kaji-standby-'));
    try {
      const home = join(dir, 'home');
      mkdirSync(home, { recursive: true });
      const root = generateKeyPairSync('ed25519');
      const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      setBase(home, { id: 'NERV-01', name: 'Tokyo' });
      pinKajiRoot(home, rootPub, true);
      const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
      const reg = new Registry(store.db, rootPub);
      let serial = 0;
      const add = (body: Record<string, unknown>) =>
        reg.add(
          signRecord(root.privateKey, {
            ...body,
            serial: ++serial,
            issued: '2026-11-24T10:00:00.000Z',
          } as unknown as RegistryBody),
        );
      add({ kind: 'enrol', baseId: 'NERV-01', name: 'A', publicKey: baseKey(home).publicKey, address: '127.0.0.1:1' });
      const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      add({ kind: 'enrol', baseId: 'NERV-02', name: 'B', publicKey: other, address: '127.0.0.1:2' });
      add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
      store.db.exec(COORDINATOR_STATE_SCHEMA);
      store.db
        .prepare(
          "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, 2, 1, 'active', 0, 0, 'd')",
        )
        .run();
      const config = { kaji: { root: rootPub, rootBinding: true }, base: { id: 'NERV-01' } } as unknown as Parameters<
        typeof runKajiCommand
      >[3];
      let holdsStandby = false;
      const ctx = {
        readSecret: async () => '',
        flag: () => undefined,
        // The probe a real run sends over the Kaji line: a lease renewal only a standby store acks.
        renewLease: async (id: string, req: { coordinatorEpoch: number; leaseSeq: number }) =>
          holdsStandby
            ? {
                ok: true as const,
                standbyBaseId: id,
                coordinatorEpoch: req.coordinatorEpoch,
                ackSeq: req.leaseSeq,
                headSeq: 0,
                leaseTtlMs: LEASE_TTL_MS,
              }
            : { ok: false as const, reason: 'not_standby' as const, error: 'no standby store' },
      };
      await assert.rejects(runKajiCommand(['standby', 'NERV-09'], home, store, config, ctx), /enrolled/);
      await assert.rejects(runKajiCommand(['standby', 'NERV-01'], home, store, config, ctx), /another/);
      await assert.rejects(runKajiCommand(['standby', 'NERV-02'], home, store, config, ctx), /standby store/);
      assert.equal(
        (
          store.db.prepare('SELECT standby_base_id FROM coordinator_state WHERE id = 1').get() as {
            standby_base_id: string | null;
          }
        ).standby_base_id,
        null,
      );
      holdsStandby = true;
      await runKajiCommand(['standby', 'NERV-02'], home, store, config, ctx);
      const row = store.db.prepare('SELECT standby_base_id FROM coordinator_state WHERE id = 1').get() as {
        standby_base_id: string;
      };
      assert.equal(row.standby_base_id, 'NERV-02');
      store.close();

      // A drained old main (or any base) without a standby store never acks: not from its own nerv.sqlite either.
      const ackHome = join(dir, 'acker');
      mkdirSync(ackHome, { recursive: true });
      const acker = new Store(join(ackHome, 'nerv.sqlite'));
      acker.db.exec(COORDINATOR_STATE_SCHEMA);
      acker.db
        .prepare(
          "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, 2, 1, 'fenced', 7, 0, 'd')",
        )
        .run();
      acker.close();
      const svc = coordinatorLeaseService({
        home: ackHome,
        databasePath: join(ackHome, 'nerv.sqlite'),
        baseId: 'NERV-01',
        root: undefined,
        ownPublicKey: other,
      });
      try {
        const r = await svc.onLeaseRenew('NERV-02', { coordinatorEpoch: 2, leaseSeq: 1 });
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.reason, 'not_standby');
        // And the handler itself refuses a store that is not a standby.
        const db = new DatabaseSync(join(ackHome, 'nerv.sqlite'));
        const direct = handleStandbyLeaseRenew(db, {
          standbyBaseId: 'NERV-01',
          request: { coordinatorEpoch: 2, leaseSeq: 1 },
          maxSeenCoordinatorEpoch: 2,
          processBootId: 'boot',
        });
        db.close();
        assert.equal(direct.ok, false);
        if (!direct.ok) assert.equal(direct.reason, 'not_standby');
      } finally {
        svc.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fix 1: a main fenced by a standby outage re-arms when a renewal succeeds at the same epoch it is still named for', async () => {
    let wall = 1_700_000_000_000;
    let mono = 1_000_000_000_000n;
    const store = main(2, 'NERV-02');
    const peer = standbyAt(2);
    let down = false;
    let registry = { baseId: 'NERV-01' as string | undefined, epoch: 2 };
    const ack = ackVia(
      peer,
      () => 2,
      () => wall,
    );
    const keeper = new CoordinatorLeaseKeeper({
      db: store.db,
      renew: (id, req) => (down ? Promise.reject(new Error('down')) : ack(id, req)),
      hasOtherEnrolledBases: () => true,
      selfBaseId: 'NERV-01',
      registryMain: () => registry,
      wallNow: () => wall,
      monoNow: () => mono,
    });
    assert.equal(await keeper.renewOnce(), 'renewed');
    down = true;
    wall += 60_000;
    mono += 60_000_000_000n;
    assert.equal(await keeper.renewOnce(), 'fenced');
    down = false;
    wall += 15_000;
    mono += 15_000_000_000n;
    assert.equal(await keeper.renewOnce(), 'renewed');
    assert.equal(store.coordinatorFencingState()?.replicationMode, 'active');
    assert.doesNotThrow(() => store.assertActiveCoordinator(wall));
    // Once a newer main record is held (or the base is no longer named), fenced stays fenced.
    down = true;
    wall += 60_000;
    mono += 60_000_000_000n;
    assert.equal(await keeper.renewOnce(), 'fenced');
    down = false;
    registry = { baseId: 'NERV-02', epoch: 3 };
    assert.equal(await keeper.renewOnce(), 'inactive');
    assert.equal(store.coordinatorFencingState()?.replicationMode, 'fenced');
    // A drained main is never revived: drain needs a newer main record first.
    const drained = main(2, 'NERV-02', 0, 'fenced');
    const k2 = new CoordinatorLeaseKeeper({
      db: drained.db,
      renew: ack,
      hasOtherEnrolledBases: () => true,
      selfBaseId: 'NERV-01',
      registryMain: () => ({ baseId: 'NERV-02', epoch: 3 }),
      wallNow: () => wall,
      monoNow: () => mono,
    });
    assert.equal(await k2.renewOnce(), 'inactive');
    store.close();
    peer.close();
    drained.close();
  });

  it('fix 2: a standby that holds a newer main answers with signed newer-epoch evidence and the old main fences at once; a lagging one does not fence it', async () => {
    const old = main(2, 'NERV-02', Date.now() + 40_000);
    const bMain = makeBase('NERV-01', 'Tokyo', await freePort());
    const bStandby = makeBase('NERV-02', 'Tabgha', await freePort());
    let standbyView = { main: 'NERV-03', epoch: 3 };
    const records = (): SignedRecord[] => [
      {
        body: { kind: 'main', serial: 9, baseId: standbyView.main, coordinatorEpoch: standbyView.epoch, issued: 'x' },
        signature: '',
      } as SignedRecord,
    ];
    const port = (): RegistryPort => ({
      bases: async () => [bMain.entry, bStandby.entry],
      records: async () => records(),
      add: async () => 0,
      seen: async () => {},
      lastSeen: async () => ({}),
      main: async () => standbyView.main,
    });
    const standbyLink = new KajiLink({
      baseId: 'NERV-02',
      key: bStandby.privateKey,
      publicKey: bStandby.pubB64,
      registry: port(),
      onLeaseRenew: async () => {
        throw new Error('never reached');
      },
    });
    const mainLink = new KajiLink({
      baseId: 'NERV-01',
      key: bMain.privateKey,
      publicKey: bMain.pubB64,
      registry: port(),
    });
    await standbyLink.start(60_000);
    await mainLink.start(60_000);
    try {
      const keeper = new CoordinatorLeaseKeeper({
        db: old.db,
        renew: (id, req) => mainLink.renewLease(id, req),
        hasOtherEnrolledBases: () => true,
      });
      assert.equal(await keeper.renewOnce(), 'fenced');
      // A peer that does not hold a newer epoch (it lags) is not evidence: the main waits for its lease instead.
      const lagging = main(4, 'NERV-02', Date.now() + 40_000);
      standbyView = { main: 'NERV-03', epoch: 3 };
      const k2 = new CoordinatorLeaseKeeper({
        db: lagging.db,
        renew: (id, req) => mainLink.renewLease(id, req),
        hasOtherEnrolledBases: () => true,
      });
      assert.equal(await k2.renewOnce(), 'waiting');
      lagging.close();
    } finally {
      await mainLink.stop();
      await standbyLink.stop();
      old.close();
    }
  });

  it('fix 3: the lease is bounded on the monotonic clock before any renewal is awaited, after a restart too, and never longer than the TTL', async () => {
    const wall0 = 1_700_000_000_000;
    // More than LEASE_TTL_MS left is impossible for an honest lease: refused (a backward wall jump).
    const far = main(2, 'NERV-02', wall0 + LEASE_TTL_MS + 1);
    assert.throws(() => far.assertActiveCoordinator(wall0), /stale_coordinator_lease|lease/);
    far.close();

    // A restarted keeper derives its monotonic deadline from the remaining lease at first sight.
    let wall = wall0;
    let mono = 5_000_000_000_000n;
    const store = main(2, 'NERV-02', wall0 + 50_000);
    let renewCalls = 0;
    const keeper = new CoordinatorLeaseKeeper({
      db: store.db,
      renew: async () => {
        renewCalls++;
        throw new Error('unreachable');
      },
      hasOtherEnrolledBases: () => true,
      wallNow: () => wall,
      monoNow: () => mono,
    });
    assert.equal(await keeper.renewOnce(), 'waiting');
    // The wall clock jumps back 100 s; 51 s pass on the monotonic clock: the lease is over.
    wall -= 100_000;
    mono += 51_000_000_000n;
    const before = renewCalls;
    assert.equal(await keeper.renewOnce(), 'fenced');
    assert.equal(renewCalls, before, 'fenced before awaiting a renewal');
    store.close();
  });

  it('fix 4: the lease sequence survives a restart even when the wall clock went back', async () => {
    let wall = 1_700_000_000_000;
    const store = main(2, 'NERV-02');
    const peer = standbyAt(2);
    const ack = ackVia(
      peer,
      () => 2,
      () => wall,
    );
    const keeper = () =>
      new CoordinatorLeaseKeeper({
        db: store.db,
        renew: ack,
        hasOtherEnrolledBases: () => true,
        wallNow: () => wall,
        monoNow: () => BigInt(wall) * 1_000_000n,
      });
    assert.equal(await keeper().renewOnce(), 'renewed');
    wall -= 3_600_000;
    assert.equal(await keeper().renewOnce(), 'renewed');
    store.close();
    peer.close();
  });

  it('re-review BLOCKER: a partitioned main renewing through a worker without a standby store fences and stays fenced', async () => {
    // A (main at 2) names worker C; B holds the replication store; A and C cannot reach B; B is promoted.
    const dir = mkdtempSync(join(tmpdir(), 'nerv-partition-'));
    try {
      const homeC = join(dir, 'c');
      mkdirSync(homeC, { recursive: true });
      new Store(join(homeC, 'nerv.sqlite')).close();
      const c = coordinatorLeaseService({
        home: homeC,
        databasePath: join(homeC, 'nerv.sqlite'),
        baseId: 'NERV-03',
        root: undefined,
        ownPublicKey: generateKeyPairSync('ed25519')
          .publicKey.export({ type: 'spki', format: 'der' })
          .toString('base64'),
      });
      let wall = 1_700_000_000_000;
      let mono = 9_000_000_000_000n;
      const a = main(2, 'NERV-03', wall + 30_000);
      const fenced: string[] = [];
      const keeper = new CoordinatorLeaseKeeper({
        db: a.db,
        renew: (_id, req) => c.onLeaseRenew('NERV-01', req),
        hasOtherEnrolledBases: () => true,
        // A's own registry is partitioned: it still names A at 2, so only the acker can stop a re-arm.
        selfBaseId: 'NERV-01',
        registryMain: () => ({ baseId: 'NERV-01', epoch: 2 }),
        wallNow: () => wall,
        monoNow: () => mono,
        onFenced: (detail) => fenced.push(detail),
      });
      try {
        assert.equal(await keeper.renewOnce(), 'waiting');
        wall += 31_000;
        mono += 31_000_000_000n;
        assert.equal(await keeper.renewOnce(), 'fenced');
        assert.match(fenced[0]!, /NERV-03/);
        assert.match(fenced[0]!, /not_standby|standby store/);
        for (let i = 0; i < 3; i++) {
          wall += 15_000;
          mono += 15_000_000_000n;
          assert.equal(await keeper.renewOnce(), 'inactive');
        }
        assert.equal(a.coordinatorFencingState()?.replicationMode, 'fenced');
      } finally {
        a.close();
        c.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-review fix 3: an ack for another lease sequence never renews or re-arms the lease', async () => {
    const wall = 1_700_000_000_000;
    const store = main(2, 'NERV-02', wall + 20_000);
    const keeper = new CoordinatorLeaseKeeper({
      db: store.db,
      renew: async (id, req) => ({
        ok: true,
        standbyBaseId: id,
        coordinatorEpoch: req.coordinatorEpoch,
        ackSeq: req.leaseSeq - 1,
        headSeq: 0,
        leaseTtlMs: LEASE_TTL_MS,
      }),
      hasOtherEnrolledBases: () => true,
      wallNow: () => wall,
      monoNow: () => BigInt(wall) * 1_000_000n,
    });
    assert.equal(await keeper.renewOnce(), 'waiting');
    assert.equal(store.coordinatorFencingState()?.leaseExpiresAt, wall + 20_000);
    store.close();
  });

  it('third review: kaji standby on a fenced main names the base without a probe, so the standby ack history does not move', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-standby-fenced-'));
    try {
      const home = join(dir, 'home');
      mkdirSync(home, { recursive: true });
      const root = generateKeyPairSync('ed25519');
      const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      setBase(home, { id: 'NERV-01', name: 'Tokyo' });
      pinKajiRoot(home, rootPub, true);
      const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
      const reg = new Registry(store.db, rootPub);
      let serial = 0;
      const add = (body: Record<string, unknown>) =>
        reg.add(
          signRecord(root.privateKey, {
            ...body,
            serial: ++serial,
            issued: '2026-11-24T10:00:00.000Z',
          } as unknown as RegistryBody),
        );
      add({ kind: 'enrol', baseId: 'NERV-01', name: 'A', publicKey: baseKey(home).publicKey, address: '127.0.0.1:1' });
      const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      add({ kind: 'enrol', baseId: 'NERV-02', name: 'B', publicKey: other, address: '127.0.0.1:2' });
      add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
      store.db.exec(COORDINATOR_STATE_SCHEMA);
      store.db
        .prepare(
          "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, 2, 1, 'fenced', 0, 0, 'd')",
        )
        .run();
      const config = { kaji: { root: rootPub, rootBinding: true }, base: { id: 'NERV-01' } } as unknown as Parameters<
        typeof runKajiCommand
      >[3];
      let probes = 0;
      await runKajiCommand(['standby', 'NERV-02'], home, store, config, {
        readSecret: async () => '',
        flag: () => undefined,
        renewLease: async () => {
          probes++;
          throw new Error('must not probe from a fenced main');
        },
      });
      assert.equal(probes, 0);
      assert.equal(
        (
          store.db.prepare('SELECT standby_base_id FROM coordinator_state WHERE id = 1').get() as {
            standby_base_id: string;
          }
        ).standby_base_id,
        'NERV-02',
      );
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
