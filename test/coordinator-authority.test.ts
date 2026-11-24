import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';
import {
  CoordinatorAuthorityError,
  advanceCoordinatorFence,
  assertActiveCoordinator,
  isActiveCoordinator,
} from '../src/coordinator-authority.ts';
import { COORDINATOR_STATE_SCHEMA } from '../src/coordinator-snapshot.ts';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
import { Registry, fingerprint, signRecord, type BaseEntry, type SignedRecord } from '../src/kaji.ts';
import { Store } from '../src/store.ts';
import { pinKajiRoot, setBase } from '../src/config.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('F-016-T05: leader epoch in signed registry records and fencing checks at effect boundaries', () => {
  it('tracks monotonic coordinatorEpoch in signed main records and reads legacy main records as epoch 0', () => {
    const store = new Store(':memory:');
    try {
      const root = generateKeyPairSync('ed25519');
      const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      const base1 = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      const base2 = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      const reg = new Registry(store.db, rootPub);

      reg.add(
        signRecord(root.privateKey, {
          kind: 'enrol',
          serial: 1,
          baseId: 'NERV-01',
          name: 'Tokyo',
          publicKey: base1,
          address: '127.0.0.1:4320',
          issued: '2026-11-19T10:00:00.000Z',
        }),
      );
      reg.add(
        signRecord(root.privateKey, {
          kind: 'enrol',
          serial: 2,
          baseId: 'NERV-02',
          name: 'Tabgha',
          publicKey: base2,
          address: '127.0.0.1:4321',
          issued: '2026-11-19T10:00:01.000Z',
        }),
      );

      // Legacy main record without coordinatorEpoch reads as epoch 0.
      reg.add(
        signRecord(root.privateKey, {
          kind: 'main',
          serial: 3,
          baseId: 'NERV-01',
          issued: '2026-11-19T10:00:02.000Z',
        }),
      );
      assert.equal(reg.main(), 'NERV-01');
      assert.equal(reg.mainEpoch(), 0);
      assert.equal(reg.nextMainEpoch(), 1);

      // Reject non-advancing coordinatorEpoch on main record.
      assert.throws(
        () =>
          reg.add(
            signRecord(root.privateKey, {
              kind: 'main',
              serial: 3,
              coordinatorEpoch: 1,
              baseId: 'NERV-02',
              issued: '2026-11-19T10:00:03.000Z',
            }),
          ),
        /advance both serial and coordinatorEpoch/,
      );

      reg.add(
        signRecord(root.privateKey, {
          kind: 'main',
          serial: 4,
          coordinatorEpoch: 1,
          baseId: 'NERV-01',
          issued: '2026-11-19T10:00:04.000Z',
        }),
      );
      assert.equal(reg.mainEpoch(), 1);
      assert.equal(reg.nextMainEpoch(), 2);

      // Reject same epoch 1 when relocating to NERV-02.
      assert.throws(
        () =>
          reg.add(
            signRecord(root.privateKey, {
              kind: 'main',
              serial: 5,
              coordinatorEpoch: 1,
              baseId: 'NERV-02',
              issued: '2026-11-19T10:00:05.000Z',
            }),
          ),
        /advance both serial and coordinatorEpoch/,
      );

      reg.add(
        signRecord(root.privateKey, {
          kind: 'main',
          serial: 5,
          coordinatorEpoch: 2,
          baseId: 'NERV-02',
          issued: '2026-11-19T10:00:06.000Z',
        }),
      );
      assert.equal(reg.main(), 'NERV-02');
      assert.equal(reg.mainEpoch(), 2);
      assert.equal(reg.nextMainEpoch(), 3);
    } finally {
      store.close();
    }
  });

  it('enforces active coordinator epoch, lease expiry, and fencing token at Store effect boundaries', () => {
    const store = new Store(':memory:');
    try {
      store.db.exec(COORDINATOR_STATE_SCHEMA);
      const nowMs = 1_700_000_000_000;
      store.db
        .prepare(
          "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, 2, 10, 'active', 4, ?, 'digest-a')",
        )
        .run(nowMs + 30_000);

      // Active coordinator succeeds and advances fence monotonically.
      assert.equal(isActiveCoordinator({ db: store.db, maxSeenCoordinatorEpoch: 2, nowMs }).ok, true);
      assert.equal(advanceCoordinatorFence(store.db, 2, nowMs), 11);
      assert.equal(store.coordinatorFencingState()?.coordinatorFence, 11);

      const reminder = store.add('Check coolant', new Date(nowMs + 60_000).toISOString(), new Date(nowMs));
      assert.equal(reminder.title, 'Check coolant');

      // Stale epoch fails closed.
      const staleEpoch = isActiveCoordinator({ db: store.db, maxSeenCoordinatorEpoch: 3, nowMs });
      assert.equal(staleEpoch.ok, false);
      if (!staleEpoch.ok) assert.equal(staleEpoch.reason, 'stale_coordinator_epoch');

      // Monotonic lease expiry (backward wall-clock jump) fails closed.
      assert.throws(
        () =>
          assertActiveCoordinator({
            db: store.db,
            nowMs,
            leaseExpiresMonoNs: 100n,
            currentMonoNs: 100n,
          }),
        (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'stale_coordinator_lease',
      );

      // Expired wall lease blocks Store.add, Store.tick, and Store.runAction without workerLease.
      store.db.prepare('UPDATE coordinator_state SET lease_expires_at = ? WHERE id = 1').run(nowMs - 1);
      assert.throws(
        () => store.add('Should fail', new Date(nowMs + 60_000).toISOString(), new Date(nowMs)),
        (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'stale_coordinator_lease',
      );
      assert.throws(
        () => store.tick(new Date(nowMs)),
        (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'stale_coordinator_lease',
      );
      assert.throws(
        () => store.runAction('sortie-1', { tool: 'system.status', args: {}, stage: 'production' }),
        (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'stale_coordinator_lease',
      );

      // Standby/fenced mode blocks coordinator effects.
      store.db
        .prepare("UPDATE coordinator_state SET replication_mode = 'standby', lease_expires_at = ? WHERE id = 1")
        .run(nowMs + 30_000);
      assert.throws(
        () => store.assertActiveCoordinator(nowMs),
        (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'coordinator_not_active',
      );
    } finally {
      store.close();
    }
  });

  it('rejects inactive coordinator or stale x-kaji-coordinator-epoch headers on Kaji RPCs', async () => {
    const b1 = generateKeyPairSync('ed25519');
    const b2 = generateKeyPairSync('ed25519');
    const p1 = await freePort();
    const p2 = await freePort();
    const pub1 = b1.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const pub2 = b2.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const bases: BaseEntry[] = [
      {
        baseId: 'NERV-01',
        name: 'Tokyo',
        address: `127.0.0.1:${p1}`,
        publicKey: pub1,
        fingerprint: fingerprint(pub1),
        status: 'enrolled',
        serial: 1,
      },
      {
        baseId: 'NERV-02',
        name: 'Tabgha',
        address: `127.0.0.1:${p2}`,
        publicKey: pub2,
        fingerprint: fingerprint(pub2),
        status: 'enrolled',
        serial: 2,
      },
    ];
    const port: RegistryPort = {
      bases: async () => bases,
      records: async (): Promise<SignedRecord[]> => [],
      add: async () => 0,
      seen: async () => {},
      lastSeen: async () => ({}),
      main: async () => 'NERV-01',
    };

    let active = true;
    const link1 = new KajiLink({
      baseId: 'NERV-01',
      key: b1.privateKey,
      publicKey: pub1,
      registry: port,
      minCoordinatorEpoch: () => 2,
      checkCoordinatorAuthority: () =>
        active
          ? { ok: true }
          : { ok: false, reason: 'coordinator_not_active', detail: 'Coordinator is in fenced mode.' },
      onChat: async () => ({
        sortieId: 's1',
        reply: 'ok',
        steps: [],
        waiting: [],
      }),
    });
    const link2 = new KajiLink({
      baseId: 'NERV-02',
      key: b2.privateKey,
      publicKey: pub2,
      registry: port,
    });

    await link1.start(60_000);
    await link2.start(60_000);
    try {
      // Active coordinator accepts /kaji/chat.
      const ok = await link2.chat('hello', undefined, 5000);
      assert.equal(ok?.reply, 'ok');

      // Fenced coordinator refuses /kaji/chat.
      active = false;
      const refused = await link2.chat('hello', undefined, 5000);
      assert.ok(refused && /503|coordinator_not_active/.test(refused.error ?? ''));
    } finally {
      await link1.stop();
      await link2.stop();
    }
  });

  it('F-016-T16: Store passes baseId, mainBaseId and maxSeenCoordinatorEpoch from the registry to the authority check', () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-authority-'));
    try {
      const root = generateKeyPairSync('ed25519');
      const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      setBase(home, { id: 'NERV-01', name: 'Tokyo' });
      pinKajiRoot(home, rootPub, true);
      const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
      try {
        const reg = new Registry(store.db, rootPub);
        let serial = 0;
        const add = (body: Omit<Parameters<typeof signRecord>[1], 'serial' | 'issued'>) =>
          reg.add(signRecord(root.privateKey, { ...body, serial: ++serial, issued: '2026-11-24T10:00:00.000Z' }));
        for (const [baseId, port] of [
          ['NERV-01', 4320],
          ['NERV-02', 4321],
        ] as const)
          add({
            kind: 'enrol',
            baseId,
            name: baseId,
            publicKey: generateKeyPairSync('ed25519')
              .publicKey.export({ type: 'spki', format: 'der' })
              .toString('base64'),
            address: `127.0.0.1:${port}`,
          });
        add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 2 });
        const nowMs = Date.now();
        const day = (n: number) => new Date(nowMs + n * 86_400_000).toISOString();
        // Legacy host, no coordinator_state: the registry does not change today's behaviour.
        assert.equal(store.add('Legacy', day(1), new Date(nowMs)).title, 'Legacy');

        store.db.exec(COORDINATOR_STATE_SCHEMA);
        store.db
          .prepare(
            "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at, state_digest) VALUES (1, 2, 1, 'active', 0, ?, 'd')",
          )
          .run(nowMs + 50_000);
        assert.equal(store.add('Active', day(2), new Date(nowMs)).title, 'Active');

        // The owner signed this base again at epoch 3: the store at epoch 2 trails maxSeenCoordinatorEpoch.
        add({ kind: 'main', baseId: 'NERV-01', coordinatorEpoch: 3 });
        assert.throws(
          () => store.add('Stale epoch', day(3), new Date(nowMs)),
          (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'stale_coordinator_epoch',
        );
        // The owner moved main to NERV-02: this base is no longer the main base, whatever its own row says.
        store.db.prepare('UPDATE coordinator_state SET coordinator_epoch = 4 WHERE id = 1').run();
        add({ kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 4 });
        assert.throws(
          () => store.tick(new Date(nowMs)),
          (err: unknown) => err instanceof CoordinatorAuthorityError && err.reason === 'coordinator_not_active',
        );
      } finally {
        store.close();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
