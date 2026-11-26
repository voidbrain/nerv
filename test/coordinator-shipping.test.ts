import assert from 'node:assert/strict';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { runKajiCommand } from '../src/cli-kaji.ts';
import { readCoordinatorFencingState } from '../src/coordinator-authority.ts';
import { registryPort } from '../src/coordinator-epoch.ts';
import { applyCoordinatorLease } from '../src/coordinator-lease.ts';
import { STANDBY_DB_FILE, drainCoordinator, type SignedDrainReceipt } from '../src/coordinator-relocation.ts';
import type { ReplicationBatch } from '../src/coordinator-replication.ts';
import { coordinatorLeaseService, coordinatorTelegramContinuity } from '../src/coordinator-serve.ts';
import {
  ReplicationShipper,
  captureReplicationBatch,
  installReplicationCapture,
  replicationApplyFault,
  replicationBatchAt,
  replicationStatus,
  seedStandbyStore,
} from '../src/coordinator-shipping.ts';
import { COORDINATOR_STATE_SCHEMA } from '../src/coordinator-snapshot.ts';
import { pinKajiRoot, readConfig, setBase } from '../src/config.ts';
import { KajiLink } from '../src/kaji-link.ts';
import { Registry, baseKey, signRecord, type RegistryBody } from '../src/kaji.ts';
import { Store } from '../src/store.ts';

/*
 * F-016-T20: the standby store kept current while serve runs. Two real data homes, each with its own
 * KajiLink on a real port: X is the active main at epoch 2, B an enrolled base. `kaji standby B` on X seeds
 * B from a signed snapshot; X's shipper sends each committed batch over /kaji/replicate.
 */

const X = 'NERV-01';
const B = 'NERV-02';
const ISSUED = '2026-11-24T10:00:00.000Z';
const OUT_1 = '00000000-0000-4000-8000-0000000000d1';
const OUT_2 = '00000000-0000-4000-8000-0000000000d2';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });
}

function outboxRow(db: DatabaseSync, id: string) {
  db.prepare('INSERT INTO kaji_outbox VALUES(?,?,?,?,?,?,?,?,?)').run(
    id,
    '00000000-0000-4000-8000-0000000000c1',
    B,
    'neutral.tool',
    '{}',
    'Neutral request',
    ISSUED,
    null,
    null,
  );
}

function readStandby<T>(home: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(join(home, STANDBY_DB_FILE));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const headOf = (db: DatabaseSync) =>
  db.prepare('SELECT coordinator_epoch, head_seq, state_digest FROM coordinator_state WHERE id = 1').get() as {
    coordinator_epoch: number;
    head_seq: number;
    state_digest: string | null;
  };

// Windows CI: two homes with keys, stores and signed records cost seconds there; built once, copied per test.
let template: { dir: string; rootPub: string; rootKey: KeyObject; serial: number } | undefined;
after(() => {
  if (template) rmSync(template.dir, { recursive: true, force: true });
});

async function buildTemplate() {
  if (template) return template;
  const dir = mkdtempSync(join(tmpdir(), 'nerv-ship-template-'));
  const root = generateKeyPairSync('ed25519');
  const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const ports: Record<string, number> = { [X]: await freePort(), [B]: await freePort() };
  const keys: Record<string, string> = {};
  for (const id of [X, B]) {
    const home = join(dir, id);
    mkdirSync(home, { recursive: true });
    setBase(home, { id, name: id });
    pinKajiRoot(home, rootPub, true);
    keys[id] = baseKey(home).publicKey;
  }
  let serial = 0;
  const records = [
    ...[X, B].map((id) => ({
      kind: 'enrol',
      baseId: id,
      name: id,
      publicKey: keys[id],
      address: `127.0.0.1:${ports[id]}`,
    })),
    { kind: 'main', baseId: X, coordinatorEpoch: 2 },
  ].map((body) =>
    signRecord(root.privateKey, { ...body, serial: ++serial, issued: ISSUED } as unknown as RegistryBody),
  );
  for (const id of [X, B]) {
    const home = join(dir, id);
    const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
    const reg = new Registry(store.db, rootPub);
    for (const r of records) reg.add(r, new Date(ISSUED));
    if (id === X) {
      store.db.exec(COORDINATOR_STATE_SCHEMA);
      store.db
        .prepare(
          `INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, lease_expires_at)
           VALUES (1, 2, 3, 'active', 0, 0)`,
        )
        .run();
      outboxRow(store.db, OUT_1);
    }
    store.close();
  }
  template = { dir, rootPub, rootKey: root.privateKey, serial };
  return template;
}

interface Side {
  readonly id: string;
  readonly home: string;
  readonly store: Store;
  readonly lease: ReturnType<typeof coordinatorLeaseService>;
  link: KajiLink;
}

async function twoBases() {
  const t = await buildTemplate();
  const dir = mkdtempSync(join(tmpdir(), 'nerv-ship-'));
  cpSync(t.dir, dir, { recursive: true });
  const sides: Record<string, Side> = {};
  let serial = t.serial;
  const linkFor = (s: Omit<Side, 'link'>) =>
    new KajiLink({
      ...s.lease.kajiOptions(),
      trust: { root: t.rootPub, required: true },
      baseId: s.id,
      key: baseKey(s.home).privateKey,
      publicKey: baseKey(s.home).publicKey,
      registry: registryPort(new Registry(s.store.db, t.rootPub)),
      log: () => {},
    });
  for (const id of [X, B]) {
    const home = join(dir, id);
    const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
    const lease = coordinatorLeaseService({
      home,
      databasePath: join(home, 'nerv.sqlite'),
      baseId: id,
      root: t.rootPub,
      ownPublicKey: baseKey(home).publicKey,
    });
    const side = { id, home, store, lease } as Side;
    side.link = linkFor(side);
    sides[id] = side;
  }
  // X holds a live lease (as if B had acked it a moment ago).
  applyCoordinatorLease(sides[X]!.store.db, {
    coordinatorEpoch: 2,
    reqStartedWallMs: Date.now(),
    reqStartedMonoNs: process.hrtime.bigint(),
  });
  await sides[B]!.link.start(600_000);
  return {
    dir,
    rootPub: t.rootPub,
    /** The owner signs a record with the root key. */
    sign: (body: Record<string, unknown>) =>
      signRecord(t.rootKey, { ...body, serial: ++serial, issued: ISSUED } as unknown as RegistryBody),
    x: sides[X]!,
    b: sides[B]!,
    /** B's serve restarts its Kaji line (same port, same handlers). */
    async restartB() {
      await sides[B]!.link.stop();
      sides[B]!.link = linkFor(sides[B]!);
      await sides[B]!.link.start(600_000);
    },
    async close() {
      for (const s of Object.values(sides)) {
        await s.link.stop();
        await s.lease.stopAsync();
        s.store.close();
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function writeFileText(path: string, text: string) {
  writeFileSync(path, text);
}

const modeOf = (db: DatabaseSync) => readCoordinatorFencingState(db)?.replicationMode;

async function kaji(home: string, store: Store, args: string[]): Promise<string> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(' '));
  try {
    await runKajiCommand(args, home, store, readConfig(home), {
      readSecret: async () => '',
      flag: () => undefined,
    });
  } finally {
    console.log = log;
  }
  return lines.join('\n');
}

describe('F-016-T20: the standby store is seeded and kept current while serve runs', () => {
  it('kaji standby seeds the base from a signed snapshot; the shipper sends each committed batch, applied once and in order', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      assert.equal(existsSync(join(b.home, STANDBY_DB_FILE)), false);

      // On X: kaji standby B. B holds no standby store, so X seeds it first, then the lease probe names it.
      const named = await kaji(x.home, x.store, ['standby', B]);
      assert.match(named, /Seeded NERV-02/);
      assert.match(named, /Standby: NERV-02/);
      const seeded = readStandby(b.home, (db) => ({
        state: readCoordinatorFencingState(db),
        head: headOf(db),
        out: db.prepare('SELECT id FROM kaji_outbox').all() as { id: string }[],
      }));
      assert.equal(seeded.state?.replicationMode, 'standby');
      assert.deepEqual(seeded.head, headOf(x.store.db), 'the standby starts at the main head and digest');
      assert.deepEqual(
        seeded.out.map((r) => r.id),
        [OUT_1],
      );

      // Serve on X: a remote request is sent and settled, the Telegram offset moves; one tick ships it.
      outboxRow(x.store.db, OUT_2);
      x.store.outboxDone(OUT_2, { ok: true });
      coordinatorTelegramContinuity(join(x.home, 'nerv.sqlite')).save({ offset: 501, cards: [] });
      const shipper = x.lease.shipper(x.link);
      await shipper.tick();
      const after = readStandby(b.home, (db) => ({
        head: headOf(db),
        done: db.prepare('SELECT done FROM kaji_outbox WHERE id = ?').get(OUT_2) as { done: string | null },
      }));
      assert.deepEqual(after.head, headOf(x.store.db));
      assert.ok(after.head.head_seq > seeded.head.head_seq);
      assert.ok(after.done.done, 'the settled send is known to the standby');
      assert.equal(
        readStandby(
          b.home,
          (db) => (db.prepare('SELECT telegram_offset AS o FROM coordinator_state').get() as { o: number }).o,
        ),
        501,
      );

      // A batch sent again (a lost reply, a retry) is applied once; an out-of-order one is refused unapplied.
      const head = headOf(x.store.db);
      const last = replicationBatchAt(x.store.db, 2, head.head_seq)!;
      const lease = readCoordinatorFencingState(x.store.db)!.leaseExpiresAt;
      assert.deepEqual(await x.link.replicate(B, last, lease), {
        ok: true,
        duplicate: true,
        headSeq: head.head_seq,
        stateDigest: head.state_digest,
      });
      const gap: ReplicationBatch = { ...last, seq: last.seq + 5 };
      const refused = await x.link.replicate(B, gap, lease);
      assert.ok(!refused.ok && refused.reason === 'invalid_batch');
      // A batch from an older epoch than B holds is refused before it is looked at.
      const old = await x.link.replicate(B, { ...last, coordinatorEpoch: 1 }, lease).catch((e: unknown) => e);
      assert.ok(old instanceof Error && /409/.test(old.message));
      assert.deepEqual(readStandby(b.home, headOf), head);

      // kaji standby shows the seed and the lag.
      const status = await kaji(x.home, x.store, ['standby']);
      assert.match(status, /Standby: NERV-02/);
      assert.match(status, new RegExp(`seeded at seq ${seeded.head.head_seq}`));
      assert.match(status, new RegExp(`at seq ${head.head_seq} of ${head.head_seq} \\(lag 0\\)`));
    } finally {
      await t.close();
    }
  });

  it('an unreachable standby never stops the main: it shows lag, and the same batch is sent again once it answers', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await kaji(x.home, x.store, ['standby', B]);
      const shipper = x.lease.shipper(x.link);
      await b.link.stop();
      outboxRow(x.store.db, OUT_2);
      const outcome = await shipper.tick();
      assert.equal(outcome, 'unreachable');
      const head = headOf(x.store.db).head_seq;
      const status = replicationStatus(x.store.db);
      assert.equal(status.peer?.ackedSeq, head - 1);
      assert.equal(status.lag, 1);
      assert.match(status.peer?.lastError ?? '', /\S/);
      assert.match(await kaji(x.home, x.store, ['standby']), /\(lag 1\)/);

      await t.restartB();
      assert.equal(await shipper.tick(), 'current');
      assert.equal(readStandby(b.home, headOf).head_seq, head);
      assert.equal(replicationStatus(x.store.db).lag, 0);
    } finally {
      await t.close();
    }
  });

  it('a standby that lost its store, or fell behind the kept log, is seeded again by serve', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await kaji(x.home, x.store, ['standby', B]);
      const shipper = x.lease.shipper(x.link, { keepBatches: 1 });
      // B falls behind while unreachable; X keeps only its last batch.
      await b.link.stop();
      for (const id of [OUT_2, '00000000-0000-4000-8000-0000000000d3']) {
        outboxRow(x.store.db, id);
        await shipper.tick();
      }
      await t.restartB();
      assert.equal(await shipper.tick(), 'seeded');
      assert.deepEqual(readStandby(b.home, headOf), headOf(x.store.db));
      assert.equal(
        readStandby(b.home, (db) => db.prepare('SELECT COUNT(*) AS n FROM kaji_outbox').get() as { n: number }).n,
        3,
      );

      // B's standby store is lost (removed): the next batch finds no standby; serve seeds it again.
      rmSync(join(b.home, STANDBY_DB_FILE));
      x.store.outboxDone(OUT_2, { ok: true });
      assert.equal(await shipper.tick(), 'seeded', replicationStatus(x.store.db).peer?.lastError);
      assert.deepEqual(readStandby(b.home, headOf), headOf(x.store.db));
      // The seed kept B's lease ack history (the promote checks read it).
      assert.equal(
        readStandby(b.home, (db) => readCoordinatorFencingState(db)?.replicationMode),
        'standby',
      );
    } finally {
      await t.close();
    }
  });

  it('a seed or batch from a base that is not the main is refused, and a base running as main is never seeded', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await kaji(x.home, x.store, ['standby', B]);
      // B (not main) tries to seed X: its shipper refuses (no active coordinator state), and so does X's line.
      await assert.rejects(b.lease.shipper(b.link).seed(X), /not the active main/);
      await x.link.start(600_000);
      const lease = readCoordinatorFencingState(x.store.db)!.leaseExpiresAt;
      await assert.rejects(b.link.seedStandby(X, Buffer.from('{}'), 2, lease), /\(403\)/);
      const head = headOf(x.store.db).head_seq;
      const forged = { ...replicationBatchAt(x.store.db, 2, head)!, sourceBaseId: B };
      await assert.rejects(b.link.replicate(X, forged, lease), /\(403\)/);
      // A coordinator never names or seeds its own base.
      await assert.rejects(x.lease.shipper(x.link).seed(X), /own base/);
      // A base running as the coordinator refuses a seed, whatever the snapshot.
      const refused = seedStandbyStore({
        home: x.home,
        frames: [Buffer.from('{}')],
        publicKey: generateKeyPairSync('ed25519').publicKey,
        expectedRoot: t.rootPub,
        expectedMainBaseId: B,
        minCoordinatorEpoch: 2,
        localMode: 'active',
      });
      assert.equal(refused.ok ? 'seeded' : refused.reason, 'active_coordinator');
      assert.equal(existsSync(join(x.home, STANDBY_DB_FILE)), false);
    } finally {
      await t.close();
    }
  });

  it('kaji drain ships the final batch before it fences, so the drained head is the standby head', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await kaji(x.home, x.store, ['standby', B]);
      outboxRow(x.store.db, OUT_2);
      // The owner signed the relocation to B at epoch 3; X imported it (B imports it after the drain).
      new Registry(x.store.db, t.rootPub).add(t.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }));
      const file = join(t.dir, 'receipt.json');
      assert.match(await kaji(x.home, x.store, ['drain', file]), /Drained epoch 2/);
      const receipt = (JSON.parse(readFileSync(file, 'utf8')) as SignedDrainReceipt).receipt;
      const standby = readStandby(b.home, headOf);
      assert.deepEqual([standby.head_seq, standby.state_digest], [receipt.finalSeq, receipt.stateDigest]);
      assert.equal(
        readStandby(b.home, (db) => db.prepare('SELECT COUNT(*) AS n FROM kaji_outbox').get() as { n: number }).n,
        2,
      );
      assert.equal(readCoordinatorFencingState(x.store.db)?.replicationMode, 'fenced');
    } finally {
      await t.close();
    }
  });
});

describe('F-016-T20 review (#725)', () => {
  it('BLOCKER 1: kaji relocate pushed the new main record to the standby; the drain still ships the final batch to it', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await kaji(x.home, x.store, ['standby', B]);
      // kaji relocate pushes the signed records to every reachable base, the standby included.
      const record = t.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 });
      new Registry(x.store.db, t.rootPub).add(record);
      new Registry(b.store.db, t.rootPub).add(record);
      outboxRow(x.store.db, OUT_2);
      // serve's shipper still reaches the standby with the old main's batches (same epoch as its store).
      assert.equal(await x.lease.shipper(x.link).tick(), 'current');
      outboxRow(x.store.db, '00000000-0000-4000-8000-0000000000d3');
      const file = join(t.dir, 'receipt.json');
      assert.match(await kaji(x.home, x.store, ['drain', file]), /Drained epoch 2/);
      const receipt = (JSON.parse(readFileSync(file, 'utf8')) as SignedDrainReceipt).receipt;
      const standby = readStandby(b.home, headOf);
      assert.deepEqual([standby.head_seq, standby.state_digest], [receipt.finalSeq, receipt.stateDigest]);
      // The feed holds only for the epoch the standby's store holds: X never sends epoch-3 batches to B.
      const head = headOf(x.store.db).head_seq;
      const later = { ...replicationBatchAt(x.store.db, 2, head)!, coordinatorEpoch: 3 };
      await assert.rejects(x.link.replicate(B, later, Date.now() + 60_000), /\(403\)/);
    } finally {
      await t.close();
    }
  });

  it('BLOCKER 2 and SHOULD-FIX 3: a write after the flush stops the fence; a re-run (or interrupted) drain flushes again; --cancel returns to active', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await kaji(x.home, x.store, ['standby', B]);
      new Registry(x.store.db, t.rootPub).add(t.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }));
      outboxRow(x.store.db, OUT_2);
      await x.lease.shipper(x.link).flush();
      // An effect in flight commits after the flush confirmed the head.
      x.store.outboxDone(OUT_2, { ok: true });
      const drain = () =>
        drainCoordinator(x.store.db, {
          baseId: X,
          coordinatorEpoch: 2,
          newMainBaseId: B,
          newEpoch: 3,
          registryMains: [],
          ranOrAckedEpoch: 2,
        });
      assert.throws(drain, /not yet replicated/);
      assert.equal(modeOf(x.store.db), 'draining', 'interrupted: effects stay stopped, nothing fenced');
      // The owner runs kaji drain again: it flushes from draining, then fences.
      const file = join(t.dir, 'receipt.json');
      assert.match(await kaji(x.home, x.store, ['drain', file]), /Drained epoch 2/);
      const receipt = (JSON.parse(readFileSync(file, 'utf8')) as SignedDrainReceipt).receipt;
      const standby = readStandby(b.home, headOf);
      assert.deepEqual([standby.head_seq, standby.state_digest], [receipt.finalSeq, receipt.stateDigest]);
      assert.ok(
        readStandby(
          b.home,
          (db) => db.prepare('SELECT done FROM kaji_outbox WHERE id = ?').get(OUT_2) as { done: string },
        ).done,
      );
    } finally {
      await t.close();
    }
  });

  it('SHOULD-FIX 3: kaji drain --cancel returns an interrupted drain to active', async () => {
    const t = await twoBases();
    try {
      const { x } = t;
      x.store.db.prepare("UPDATE coordinator_state SET replication_mode = 'draining' WHERE id = 1").run();
      assert.match(await kaji(x.home, x.store, ['drain', '--cancel']), /active again/);
      assert.equal(modeOf(x.store.db), 'active');
    } finally {
      await t.close();
    }
  });

  it('SHOULD-FIX 4: the Telegram offset ships only with the batch that holds every change before it', async () => {
    const t = await twoBases();
    try {
      const { x } = t;
      await kaji(x.home, x.store, ['standby', B]);
      // The channel saves its offset before it handles the update; the rows it writes are noted after.
      coordinatorTelegramContinuity(join(x.home, 'nerv.sqlite')).save({ offset: 900, cards: [] });
      for (let i = 0; i < 250; i += 1)
        outboxRow(x.store.db, `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`);
      const source = { root: t.rootPub, sourceBaseId: X };
      const first = captureReplicationBatch(x.store.db, source)!;
      assert.equal(first.telegram, undefined, 'a cut batch carries no offset ahead of its rows');
      const second = captureReplicationBatch(x.store.db, source)!;
      assert.equal(second.telegram?.offset, 900);
      assert.equal(captureReplicationBatch(x.store.db, source), undefined);
    } finally {
      await t.close();
    }
  });

  it('SHOULD-FIX 5: an updated row keeps its place (rowid order) on the standby', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await kaji(x.home, x.store, ['standby', B]);
      outboxRow(x.store.db, OUT_2);
      x.store.outboxDone(OUT_1, { ok: true });
      assert.equal(await x.lease.shipper(x.link).tick(), 'current');
      const order = (db: DatabaseSync) =>
        (db.prepare('SELECT id FROM kaji_outbox ORDER BY rowid').all() as { id: string }[]).map((r) => r.id);
      assert.deepEqual(readStandby(b.home, order), order(x.store.db));
      assert.deepEqual(order(x.store.db), [OUT_1, OUT_2]);
    } finally {
      await t.close();
    }
  });

  it('SHOULD-FIX 6: a seed that does not arrive is retried with a growing backoff, not every tick', async () => {
    const t = await twoBases();
    try {
      const { x } = t;
      x.store.db.prepare('UPDATE coordinator_state SET standby_base_id = ? WHERE id = 1').run(B);
      let now = 1_000_000;
      let seeds = 0;
      const shipper = new ReplicationShipper({
        db: x.store.db,
        baseId: X,
        root: t.rootPub,
        privateKey: () => baseKey(x.home).privateKey,
        now: () => now,
        link: {
          // The standby answers (it holds no store) but the seed frames never arrive.
          replicate: async () => ({ ok: false as const, reason: 'not_standby' as const, expectedSeq: 0 }),
          seedStandby: async () => {
            seeds += 1;
            throw new Error('unreachable');
          },
        },
      });
      outboxRow(x.store.db, OUT_2);
      assert.equal(await shipper.tick(), 'unreachable');
      assert.equal(await shipper.tick(), 'behind');
      now += 10_000;
      assert.equal(await shipper.tick(), 'unreachable');
      now += 15_000;
      assert.equal(await shipper.tick(), 'behind', 'the second wait is longer');
      now += 10_000;
      assert.equal(await shipper.tick(), 'unreachable');
      assert.equal(seeds, 3);
    } finally {
      await t.close();
    }
  });

  it('minor: an unreadable standby store is reported, never a crash loop', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await kaji(x.home, x.store, ['standby', B]);
      writeFileText(join(b.home, STANDBY_DB_FILE), 'not a database at all, neutral fixture bytes'.repeat(200));
      outboxRow(x.store.db, OUT_2);
      assert.equal(await x.lease.shipper(x.link).tick(), 'refused');
      assert.match(replicationStatus(x.store.db).peer?.lastError ?? '', /unreadable/);
    } finally {
      await t.close();
    }
  });
});

describe('F-016-T20 re-check (#725): every standby-feed refusal', () => {
  it('the feed takes the old main only while the standby store holds its epoch, unpromoted, unrevoked, with no later ack; a fenced main sends nothing', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await kaji(x.home, x.store, ['standby', B]);
      const record = t.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 });
      new Registry(x.store.db, t.rootPub).add(record);
      new Registry(b.store.db, t.rootPub).add(record);
      const standbyDb = join(b.home, STANDBY_DB_FILE);
      const onStandby = (sql: string, ...args: (string | number)[]) => {
        const db = new DatabaseSync(standbyDb);
        try {
          db.prepare(sql).run(...args);
        } finally {
          db.close();
        }
      };
      const shipper = x.lease.shipper(x.link);
      // Baseline: accepted, over the line too.
      assert.equal(b.lease.standbyFeedFrom(X, 2), true);
      outboxRow(x.store.db, OUT_2);
      assert.equal(await shipper.tick(), 'current');
      const before = readStandby(b.home, headOf);

      // A promotion marker on the standby: refused (403 over the line), nothing applied.
      writeFileText(join(b.home, 'coordinator-promotion.json'), '{}');
      assert.equal(b.lease.standbyFeedFrom(X, 2), false, 'promotion marker');
      x.store.outboxDone(OUT_2, { ok: true });
      assert.equal(await shipper.tick(), 'refused');
      assert.match(replicationStatus(x.store.db).peer?.lastError ?? '', /403/);
      assert.deepEqual(readStandby(b.home, headOf), before);
      rmSync(join(b.home, 'coordinator-promotion.json'));

      // Another epoch than the one the store holds.
      assert.equal(b.lease.standbyFeedFrom(X, 1), false, 'batch epoch other than the store');
      assert.equal(b.lease.standbyFeedFrom(X, 3), false, 'X is not named main at 3');
      onStandby('UPDATE coordinator_state SET coordinator_epoch = 1 WHERE id = 1');
      assert.equal(b.lease.standbyFeedFrom(X, 2), false, 'store at another epoch');
      onStandby('UPDATE coordinator_state SET coordinator_epoch = 2 WHERE id = 1');

      // The standby acked a lease at a later epoch (a later coordinator ran).
      onStandby('UPDATE standby_lease_state SET standby_coordinator_epoch = 3 WHERE id = 1');
      assert.equal(b.lease.standbyFeedFrom(X, 2), false, 'later lease ack');
      onStandby('UPDATE standby_lease_state SET standby_coordinator_epoch = 2 WHERE id = 1');
      assert.equal(b.lease.standbyFeedFrom(X, 2), true, 'baseline again');

      // A fenced X sends nothing at all.
      x.store.db.prepare("UPDATE coordinator_state SET replication_mode = 'fenced' WHERE id = 1").run();
      assert.equal(await shipper.tick(), 'inactive');
      x.store.db.prepare("UPDATE coordinator_state SET replication_mode = 'active' WHERE id = 1").run();
      assert.equal(await shipper.tick(), 'current');

      // A revoked sender: refused for good.
      const xEntry = new Registry(b.store.db, t.rootPub).bases().find((e) => e.baseId === X)!;
      new Registry(b.store.db, t.rootPub).add(t.sign({ kind: 'revoke', baseId: X, publicKey: xEntry.publicKey }));
      assert.equal(b.lease.standbyFeedFrom(X, 2), false, 'revoked');
    } finally {
      await t.close();
    }
  });

  it('minor (a): a busy standby store is retried with the same batch, never reseeded', () => {
    assert.equal(replicationApplyFault(Object.assign(new Error('database is locked'), { errcode: 5 })), 'busy');
    assert.equal(replicationApplyFault(new Error('database table is locked')), 'busy');
    assert.equal(replicationApplyFault(new Error('no such table: kaji_outbox_pilots')), 'not_standby');
  });

  it('minor (b): --cancel after the relocation was imported says effects stay off', async () => {
    const t = await twoBases();
    try {
      const { x } = t;
      new Registry(x.store.db, t.rootPub).add(t.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }));
      x.store.db.prepare("UPDATE coordinator_state SET replication_mode = 'draining' WHERE id = 1").run();
      const out = await kaji(x.home, x.store, ['drain', '--cancel']);
      assert.match(out, /NERV-02 at epoch 3/);
      assert.match(out, /no coordinator effects/);
      assert.doesNotMatch(out, /renews or fences it as before/);
    } finally {
      await t.close();
    }
  });

  it('minor (c): a named standby whose position at this epoch is unknown counts as not replicated', async () => {
    const t = await twoBases();
    try {
      const { x } = t;
      installReplicationCapture(x.store.db);
      x.store.db.prepare('UPDATE coordinator_state SET standby_base_id = ? WHERE id = 1').run(B);
      assert.throws(
        () =>
          drainCoordinator(x.store.db, {
            baseId: X,
            coordinatorEpoch: 2,
            newMainBaseId: B,
            newEpoch: 3,
            registryMains: [],
            ranOrAckedEpoch: 2,
          }),
        /not yet replicated/,
      );
    } finally {
      await t.close();
    }
  });
});

describe('F-016-T21: seed snapshot export runs off serve event loop', () => {
  it('serves lease renewals and Kaji requests during snapshot serialisation/signing with bounded event-loop delay, and aborts if fenced mid-export', async () => {
    const t = await twoBases();
    try {
      const { x, b } = t;
      await x.link.start(600_000);
      await kaji(x.home, x.store, ['standby', B]);

      // Populate X with 12,000 committed deliveries rows (~24 MB JSON) and clear pending capture so the seed
      // measures reading, canonicalising and signing the snapshot itself.
      const body = 'neutral-delivery-payload-'.repeat(70);
      x.store.db.exec('BEGIN IMMEDIATE');
      const ins = x.store.db.prepare(
        "INSERT INTO deliveries(rowid, id, reminder_id, kind, message, created, read_at) VALUES (?, ?, NULL, 'brief', ?, ?, NULL)",
      );
      for (let i = 1; i <= 12_000; i += 1) ins.run(i, `del-${i}`, `${i}:${body}`, ISSUED);
      x.store.db.exec('DELETE FROM coordinator_replication_pending');
      x.store.db.exec('COMMIT');

      let readCommittedAt = 0;
      let firstChunkAt = 0;
      let renewOutcome: string | undefined;
      let renewDoneAt = 0;
      let kajiDoneAt = 0;
      let concurrentWork: Promise<void> | undefined;
      const keeper = x.lease.keeper((id, req) => x.link.renewLease(id, req));

      const shipper = x.lease.shipper(
        {
          replicate: (id, batch, lease) => x.link.replicate(id, batch, lease),
          seedStandby: (id, frame, epoch, lease) => {
            if (!firstChunkAt) firstChunkAt = performance.now();
            return x.link.seedStandby(id, frame, epoch, lease);
          },
        },
        {
          // Fires right after the worker's SQLite read transaction commits, while it canonicalises and signs.
          onReadCommitted: () => {
            readCommittedAt = performance.now();
            concurrentWork = Promise.all([
              keeper.renewOnce().then((out) => {
                renewOutcome = out;
                renewDoneAt = performance.now();
              }),
              b.link.heartbeat().then(() => {
                kajiDoneAt = performance.now();
              }),
            ]).then(() => undefined);
          },
        },
      );

      const startedAt = performance.now();
      let lastTick = startedAt;
      let maxGapMs = 0;
      let ticksDuringSerialise = 0;
      const ticker = setInterval(() => {
        const now = performance.now();
        const gap = now - lastTick;
        if (!firstChunkAt) {
          if (readCommittedAt > 0) ticksDuringSerialise += 1;
          if (gap > maxGapMs) maxGapMs = gap;
        }
        lastTick = now;
      }, 5);

      try {
        await shipper.seed(B);
        await concurrentWork;
      } finally {
        clearInterval(ticker);
      }

      const serialiseMs = firstChunkAt - readCommittedAt;
      assert.ok(readCommittedAt > 0, 'worker reported read-committed before canonicalising');
      assert.equal(renewOutcome, 'renewed');
      assert.ok(
        ticksDuringSerialise >= 1,
        `expected event-loop ticks during ${Math.round(serialiseMs)} ms serialise/sign, got ${ticksDuringSerialise}`,
      );
      assert.ok(
        renewDoneAt >= readCommittedAt && renewDoneAt < firstChunkAt,
        `lease renewal did not complete during serialise/sign (${Math.round(renewDoneAt - readCommittedAt)} ms vs ${Math.round(serialiseMs)} ms)`,
      );
      assert.ok(
        kajiDoneAt >= readCommittedAt && kajiDoneAt < firstChunkAt,
        `Kaji request did not complete during serialise/sign (${Math.round(kajiDoneAt - readCommittedAt)} ms vs ${Math.round(serialiseMs)} ms)`,
      );
      assert.ok(
        maxGapMs < Math.max(150, serialiseMs * 0.5),
        `event-loop delay ${Math.round(maxGapMs)} ms blocked serialise/sign (${Math.round(serialiseMs)} ms)`,
      );
      assert.equal(
        readStandby(b.home, (db) => (db.prepare('SELECT COUNT(*) AS n FROM deliveries').get() as { n: number }).n),
        12_000,
      );

      // Authority invariant: if X fences after the worker read active state (while serialising/signing), the
      // main-thread post-worker fence check aborts and zero seed frames leave X.
      let sentAfterFence = 0;
      const fencedShipper = x.lease.shipper(
        {
          replicate: (id, batch, lease) => x.link.replicate(id, batch, lease),
          seedStandby: async () => {
            sentAfterFence += 1;
            return { ok: true as const, complete: true };
          },
        },
        {
          onReadCommitted: () => {
            x.store.db.prepare("UPDATE coordinator_state SET replication_mode = 'fenced' WHERE id = 1").run();
          },
        },
      );
      await assert.rejects(fencedShipper.seed(B), /no longer the active main/);
      assert.equal(sentAfterFence, 0, 'fenced main never sends a seed frame');
    } finally {
      await t.close();
    }
  });
});
