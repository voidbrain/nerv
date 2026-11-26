import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { runKajiCommand } from '../src/cli-kaji.ts';
import { readCoordinatorFencingState } from '../src/coordinator-authority.ts';
import { registryPort } from '../src/coordinator-epoch.ts';
import { STANDBY_DB_FILE } from '../src/coordinator-relocation.ts';
import { STANDBY_LEASE_SCHEMA } from '../src/coordinator-lease.ts';
import { coordinatorLeaseService } from '../src/coordinator-serve.ts';
import { COORDINATOR_STATE_SCHEMA } from '../src/coordinator-snapshot.ts';
import { pinKajiRoot, readConfig, setBase } from '../src/config.ts';
import { KajiLink } from '../src/kaji-link.ts';
import {
  ROOT_KEY_FILE,
  Registry,
  baseKey,
  createRootKey,
  signRecord,
  unlockRootKey,
  type RegistryBody,
} from '../src/kaji.ts';
import { Store } from '../src/store.ts';

/*
 * B-172: a main named before F-016 (its main record has no coordinatorEpoch) holds its store with no
 * coordinator_state, so `kaji standby` and `kaji drain` refuse it and nothing created that state. `kaji adopt`
 * takes the legacy store as the first coordinator (epoch 1): backup first, idempotent, refused wherever another
 * coordinator could have run. Two real data homes: X the legacy main with the root key, B an enrolled base.
 */

const X = 'NERV-01';
const B = 'NERV-02';
const ISSUED = '2026-11-01T10:00:00.000Z';
const PASS = 'neutral test passphrase';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });
}

async function legacyBases(mainBody: Record<string, unknown> = { kind: 'main', baseId: X }) {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-adopt-'));
  const key = createRootKey(PASS);
  const root = unlockRootKey(key.file, PASS);
  const ports: Record<string, number> = { [X]: await freePort(), [B]: await freePort() };
  const keys: Record<string, string> = {};
  for (const id of [X, B]) {
    const home = join(dir, id);
    mkdirSync(home, { recursive: true });
    setBase(home, { id, name: id });
    pinKajiRoot(home, key.publicKey, true);
    keys[id] = baseKey(home).publicKey;
  }
  writeFileSync(join(dir, X, ROOT_KEY_FILE), key.file);
  let serial = 0;
  const records = [
    ...[X, B].map((id) => ({
      kind: 'enrol',
      baseId: id,
      name: id,
      publicKey: keys[id],
      address: `127.0.0.1:${ports[id]}`,
    })),
    // A main record signed before F-016: no coordinatorEpoch (read as 0).
    mainBody,
  ].map((body) =>
    signRecord(root.privateKey, { ...body, serial: ++serial, issued: ISSUED } as unknown as RegistryBody),
  );
  const sides: Record<
    string,
    { home: string; store: Store; lease: ReturnType<typeof coordinatorLeaseService>; link: KajiLink }
  > = {};
  for (const id of [X, B]) {
    const home = join(dir, id);
    const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
    const reg = new Registry(store.db, key.publicKey);
    for (const r of records) reg.add(r, new Date(ISSUED));
    const lease = coordinatorLeaseService({
      home,
      databasePath: join(home, 'nerv.sqlite'),
      baseId: id,
      root: key.publicKey,
      ownPublicKey: baseKey(home).publicKey,
    });
    const link = new KajiLink({
      ...lease.kajiOptions(),
      trust: { root: key.publicKey, required: true },
      baseId: id,
      key: baseKey(home).privateKey,
      publicKey: baseKey(home).publicKey,
      registry: registryPort(new Registry(store.db, key.publicKey)),
      log: () => {},
    });
    sides[id] = { home, store, lease, link };
  }
  await sides[B]!.link.start(600_000);
  return {
    x: sides[X]!,
    b: sides[B]!,
    rootPublicKey: key.publicKey,
    /** The owner signs a record with the root key. */
    sign: (body: Record<string, unknown>) =>
      signRecord(root.privateKey, { ...body, serial: ++serial, issued: ISSUED } as unknown as RegistryBody),
    async close() {
      for (const s of Object.values(sides)) {
        await s.link.stop();
        s.lease.stop();
        s.store.close();
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function kaji(home: string, store: Store, args: string[]): Promise<string> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(' '));
  try {
    await runKajiCommand(args, home, store, readConfig(home), {
      readSecret: async () => PASS,
      flag: () => undefined,
    });
  } finally {
    console.log = log;
  }
  return lines.join('\n');
}

const backups = (home: string) =>
  existsSync(join(home, 'backups')) ? readdirSync(join(home, 'backups')).filter((f) => /adopt/.test(f)) : [];

describe('B-172: a main from before F-016 adopts its store as the first coordinator', () => {
  it('kaji adopt backs up the store, signs main at epoch 1 and activates it; kaji standby then seeds and names the standby', async () => {
    const t = await legacyBases();
    try {
      const { x, b } = t;
      // What the owner saw on 2026-11-26: the legacy main holds no coordinator state to name a standby for.
      assert.equal(readCoordinatorFencingState(x.store.db), undefined);
      await assert.rejects(kaji(x.home, x.store, ['standby', B]), /holds no coordinator state/);

      const out = await kaji(x.home, x.store, ['adopt']);
      assert.match(out, /Backup: .*adopt.*\.sqlite/);
      assert.match(out, /Adopted this base's store as coordinator epoch 1/);
      assert.match(out, /kaji standby NERV-02/, 'the output names the next step');
      assert.match(out, /Told NERV-02 the epoch/);
      assert.equal(new Registry(b.store.db, t.rootPublicKey).mainEpoch(), 1, 'the standby-to-be holds epoch 1');
      assert.equal(backups(x.home).length, 1, 'one backup before any write');
      const backup = new DatabaseSync(join(x.home, 'backups', backups(x.home)[0]!), { readOnly: true });
      try {
        assert.equal(
          backup.prepare("SELECT 1 FROM sqlite_master WHERE name = 'coordinator_state'").get(),
          undefined,
          'the backup is the store as it was before the adoption',
        );
      } finally {
        backup.close();
      }
      const state = readCoordinatorFencingState(x.store.db);
      assert.equal(state?.replicationMode, 'active');
      assert.equal(state?.coordinatorEpoch, 1);
      const reg = new Registry(x.store.db, t.rootPublicKey);
      assert.equal(reg.main(), X);
      assert.equal(reg.mainEpoch(), 1);
      // The adopted main is as active as the legacy one was (an unarmed lease is authority at epoch 1).
      assert.doesNotThrow(() => x.store.assertActiveCoordinator());

      // Idempotent: a second run changes nothing, signs nothing and makes no second backup.
      const serial = reg.nextSerial();
      assert.match(await kaji(x.home, x.store, ['adopt']), /already holds coordinator state at epoch 1/);
      assert.equal(new Registry(x.store.db, t.rootPublicKey).nextSerial(), serial);
      assert.equal(backups(x.home).length, 1);

      // The relocation page's step 0 now works.
      const named = await kaji(x.home, x.store, ['standby', B]);
      assert.match(named, /Seeded NERV-02/);
      assert.match(named, /Standby: NERV-02/);
      assert.ok(existsSync(join(b.home, STANDBY_DB_FILE)));
    } finally {
      await t.close();
    }
  });

  it('a main record already at epoch 1 needs no signature: adopt activates it at epoch 1 without the passphrase', async () => {
    const t = await legacyBases({ kind: 'main', baseId: X, coordinatorEpoch: 1 });
    try {
      const { x } = t;
      const serial = new Registry(x.store.db, t.rootPublicKey).nextSerial();
      let asked = false;
      const lines: string[] = [];
      const log = console.log;
      console.log = (...a: unknown[]) => void lines.push(a.join(' '));
      try {
        await runKajiCommand(['adopt'], x.home, x.store, readConfig(x.home), {
          readSecret: async () => {
            asked = true;
            return PASS;
          },
          flag: () => undefined,
        });
      } finally {
        console.log = log;
      }
      assert.equal(asked, false);
      assert.match(lines.join('\n'), /Adopted this base's store as coordinator epoch 1/);
      assert.equal(new Registry(x.store.db, t.rootPublicKey).nextSerial(), serial);
      assert.equal(readCoordinatorFencingState(x.store.db)?.coordinatorEpoch, 1);
    } finally {
      await t.close();
    }
  });

  it('refuses, with nothing written and no backup, wherever another coordinator could have run', async () => {
    // Not the main: the registry names another base.
    let t = await legacyBases({ kind: 'main', baseId: B });
    try {
      await assert.rejects(kaji(t.x.home, t.x.store, ['adopt']), /names NERV-02/);
      assert.equal(readCoordinatorFencingState(t.x.store.db), undefined);
      assert.equal(backups(t.x.home).length, 0);
    } finally {
      await t.close();
    }
    // Named at epoch 2 or later: that state comes from kaji promote, never from adopting the store.
    t = await legacyBases({ kind: 'main', baseId: X, coordinatorEpoch: 2 });
    try {
      await assert.rejects(kaji(t.x.home, t.x.store, ['adopt']), /epoch 2/);
      assert.equal(readCoordinatorFencingState(t.x.store.db), undefined);
      assert.equal(backups(t.x.home).length, 0);
    } finally {
      await t.close();
    }
    t = await legacyBases();
    try {
      const { x } = t;
      // A standby store on this base: it was seeded by another main.
      writeFileSync(join(x.home, STANDBY_DB_FILE), '');
      await assert.rejects(kaji(x.home, x.store, ['adopt']), /standby store/);
      rmSync(join(x.home, STANDBY_DB_FILE));
      // This base acked another main's lease: another coordinator ran.
      x.store.db.exec(STANDBY_LEASE_SCHEMA);
      x.store.db
        .prepare(
          "INSERT INTO standby_lease_state(id, standby_coordinator_epoch, last_ack_seq, last_ack_wall_ms, process_boot_id) VALUES (1, 1, 1, 1, 'boot')",
        )
        .run();
      await assert.rejects(kaji(x.home, x.store, ['adopt']), /acked a coordinator lease/);
      x.store.db.exec('DELETE FROM standby_lease_state');
      // Another base answers the epoch probe: it acked a coordinator lease, so another main ran.
      t.b.store.db.exec(STANDBY_LEASE_SCHEMA);
      t.b.store.db
        .prepare(
          "INSERT INTO standby_lease_state(id, standby_coordinator_epoch, last_ack_seq, last_ack_wall_ms, process_boot_id) VALUES (1, 1, 1, 1, 'boot')",
        )
        .run();
      await assert.rejects(kaji(x.home, x.store, ['adopt']), /NERV-02 \(epoch 1\) ran or acked a coordinator lease/);
      assert.equal(readCoordinatorFencingState(x.store.db), undefined);
      assert.equal(new Registry(x.store.db, t.rootPublicKey).mainEpoch(), 0, 'nothing signed or stored');
      // Coordinator state in another mode (a drained or fenced main, a standby): adopt is not the way.
      x.store.db.exec(COORDINATOR_STATE_SCHEMA);
      x.store.db
        .prepare(
          "INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, lease_expires_at) VALUES (1, 1, 1, 'fenced', 0)",
        )
        .run();
      await assert.rejects(kaji(x.home, x.store, ['adopt']), /already holds coordinator state \(fenced/);
      assert.equal(backups(x.home).length, 0);
    } finally {
      await t.close();
    }
  });

  it('review: a base holding a later main record refuses adoption; after adopting, kaji main is refused (kaji relocate moves it)', async () => {
    const t = await legacyBases();
    try {
      const { x, b } = t;
      // The store may be a restored copy: B already holds main NERV-02 at epoch 2.
      new Registry(b.store.db, t.rootPublicKey).add(t.sign({ kind: 'main', baseId: B, coordinatorEpoch: 2 }));
      await assert.rejects(
        kaji(x.home, x.store, ['adopt']),
        /NERV-02 \(epoch 2\) holds a main record later than epoch 0/,
      );
      assert.equal(readCoordinatorFencingState(x.store.db), undefined);
      assert.equal(backups(x.home).length, 0);
    } finally {
      await t.close();
    }
    const u = await legacyBases();
    try {
      await kaji(u.x.home, u.x.store, ['adopt']);
      await assert.rejects(kaji(u.x.home, u.x.store, ['main', B]), /kaji relocate/);
      assert.equal(new Registry(u.x.store.db, u.rootPublicKey).main(), X);
    } finally {
      await u.close();
    }
  });

  it('review: an unreachable base is named and not waited for on a first adoption; with an earlier adopt backup it is waited for', async () => {
    const t = await legacyBases();
    try {
      const { x, b } = t;
      await b.link.stop();
      const out = await kaji(x.home, x.store, ['adopt']);
      assert.match(out, /Adopted this base's store as coordinator epoch 1/);
      assert.match(out, /Not reached now: NERV-02/);
      // A store restored from that backup, while NERV-02 does not answer, is refused.
      x.store.db.exec('DROP TABLE coordinator_state');
      await assert.rejects(kaji(x.home, x.store, ['adopt']), /adopted its store before .*NERV-02 did not answer/);
      assert.equal(readCoordinatorFencingState(x.store.db), undefined);
    } finally {
      await t.close();
    }
  });

  it('review: a run interrupted after the main record was stored adopts on a re-run with no new signature', async () => {
    const t = await legacyBases();
    try {
      const { x } = t;
      // As if the first run stopped between storing main NERV-01 at epoch 1 and writing the state.
      new Registry(x.store.db, t.rootPublicKey).add(t.sign({ kind: 'main', baseId: X, coordinatorEpoch: 1 }));
      const serial = new Registry(x.store.db, t.rootPublicKey).nextSerial();
      const out = await kaji(x.home, x.store, ['adopt']);
      assert.match(out, /Adopted this base's store as coordinator epoch 1/);
      assert.doesNotMatch(out, /signed main/);
      assert.equal(new Registry(x.store.db, t.rootPublicKey).nextSerial(), serial);
    } finally {
      await t.close();
    }
  });

  it('review: with no earlier adopt, a base holding an epoch 1 main record for another base refuses adoption', async () => {
    const t = await legacyBases();
    try {
      const { x, b } = t;
      new Registry(b.store.db, t.rootPublicKey).add(t.sign({ kind: 'main', baseId: B, coordinatorEpoch: 1 }));
      await assert.rejects(
        kaji(x.home, x.store, ['adopt']),
        /NERV-02 \(epoch 1\) holds a main record later than epoch 0/,
      );
      assert.equal(readCoordinatorFencingState(x.store.db), undefined);
      assert.equal(backups(x.home).length, 0);
    } finally {
      await t.close();
    }
  });

  it('review: a store restored from its own adopt backup adopts again while the other bases hold epoch 1', async () => {
    const t = await legacyBases();
    try {
      const { x, b } = t;
      // B already took main NERV-01 at epoch 1 from the adoption this store was restored from.
      new Registry(b.store.db, t.rootPublicKey).add(t.sign({ kind: 'main', baseId: X, coordinatorEpoch: 1 }));
      mkdirSync(join(x.home, 'backups'));
      writeFileSync(join(x.home, 'backups', 'nerv-before-adopt-earlier.sqlite'), '');
      assert.match(await kaji(x.home, x.store, ['adopt']), /Adopted this base's store as coordinator epoch 1/);
      assert.equal(readCoordinatorFencingState(x.store.db)?.coordinatorEpoch, 1);
    } finally {
      await t.close();
    }
  });
});
