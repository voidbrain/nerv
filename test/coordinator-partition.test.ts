import assert from 'node:assert/strict';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, afterEach, describe, it, mock } from 'node:test';
import { readCoordinatorFencingState } from '../src/coordinator-authority.ts';
import {
  LEASE_EFFECTIVE_TTL_MS,
  LEASE_RENEW_MS,
  applyCoordinatorLease,
  rearmSoleCoordinatorLease,
  type LeaseRenewRequest,
  type LeaseRenewResult,
} from '../src/coordinator-lease.ts';
import {
  PROMOTION_MARKER_FILE,
  assertNoPromotionInProgress,
  promoteCoordinator,
  type PromoteCoordinatorInput,
} from '../src/coordinator-promote.ts';
import {
  RelocationRefusedError,
  STANDBY_DB_FILE,
  drainCoordinator,
  ranOrAckedCoordinatorEpoch,
  signDrainReceipt,
} from '../src/coordinator-relocation.ts';
import {
  coordinatorChannelAuthority,
  coordinatorLeaseService,
  coordinatorTelegramContinuity,
} from '../src/coordinator-serve.ts';
import type { ReplicationBatch } from '../src/coordinator-replication.ts';
import { COORDINATOR_STATE_SCHEMA } from '../src/coordinator-snapshot.ts';
import { runKajiCommand } from '../src/cli-kaji.ts';
import { readRelocationBundle } from '../src/coordinator-relocation-bundle.ts';
import {
  ROOT_KEY_FILE,
  Registry,
  createRootKey,
  signRecord,
  unlockRootKey,
  type RegistryBody,
  type SignedRecord,
} from '../src/kaji.ts';
import { Store } from '../src/store.ts';

/*
 * F-016-T08: deterministic multi-base fixtures. Every base is a real data home (its `nerv.sqlite`, and a
 * `coordinator-standby.sqlite` where it keeps one) running the real lease keeper and standby ack
 * (`coordinatorLeaseService`), the real Telegram authority check (`coordinatorChannelAuthority`), the real
 * outbox (`Store.outbox`) and the real `promoteCoordinator`. What is simulated: the wall clock (one mocked
 * `Date` for all bases), each base's monotonic clock (it stops while the host sleeps), and the Kaji line,
 * which follows the KajiLink rules for the routes used here (a revoked or unknown sender is refused; a lease
 * renewal from a base that is not main gets signed newer-epoch evidence or a refusal; an epoch push merges
 * the owner-signed records and answers with the newest epoch, whether a standby store is held and, B-121-T02,
 * the newest epoch the base ran or acked a lease at, which an older peer leaves out). The real
 * HTTP join of those routes is covered in coordinator-lease and coordinator-relocation tests.
 *
 * Every step of one simulated second checks the invariant: at most one base holds coordinator authority,
 * and no effect (Telegram update, outbox send, approval decision) runs twice.
 *
 * Limits (#717 review): the mock bot hands each update out once, so the Telegram check proves only that no
 * two bases poll in the same step; the real getUpdates offset hand-over (an update fetched but not yet
 * confirmed by the old main) is not modelled, nor is replication of what the old main did after the standby
 * was seeded unless a scenario turns replication on (F-016-T20: serve's shipper then runs each step over the
 * simulated line). The simulated decide checks main and epoch like KajiLink's staleEpochReply, in a
 * simplified form; the routing rules are copied here, not shared with KajiLink.
 */

const X = 'NERV-01';
const B = 'NERV-02';
const C = 'NERV-03';
const D = 'NERV-04';
const NAMES: Record<string, string> = { [X]: 'X', [B]: 'B', [C]: 'C', [D]: 'D' };
const STEP_MS = 1000;
const ISSUED = '2026-11-24T10:00:00.000Z';
const OUTBOX_ID = '00000000-0000-4000-8000-0000000000a1';
const APPROVAL_ID = '00000000-0000-4000-8000-0000000000b1';
const OUTBOX_2 = '00000000-0000-4000-8000-0000000000a2';
const PASS = 'neutral mesh passphrase';

const b64 = (k: KeyObject) => k.export({ type: 'spki', format: 'der' }).toString('base64');

function setState(
  db: DatabaseSync,
  o: { epoch: number; mode: string; standby?: string | null; headSeq?: number; digest?: string | null },
) {
  db.exec(COORDINATOR_STATE_SCHEMA);
  db.prepare(
    `INSERT INTO coordinator_state(id, coordinator_epoch, coordinator_fence, replication_mode, head_seq, state_digest,
       lease_expires_at, standby_base_id)
     VALUES (1, ?, 3, ?, ?, ?, 0, ?)`,
  ).run(o.epoch, o.mode, o.headSeq ?? 7, o.digest ?? 'digest-7', o.standby ?? null);
}

/** One uncertain remote action: sent by X under epoch 2 (the standby holds the attempt, not the result). */
function seedOutbox(db: DatabaseSync, done: boolean) {
  db.prepare('INSERT INTO kaji_outbox VALUES(?,?,?,?,?,?,?,?,?)').run(
    OUTBOX_ID,
    '00000000-0000-4000-8000-0000000000c1',
    D,
    'neutral.tool',
    '{}',
    'Neutral request',
    ISSUED,
    done ? ISSUED : null,
    done ? '{"ok":true}' : null,
  );
  db.prepare('INSERT INTO worker_outbox_attempts VALUES(?,?)').run(OUTBOX_ID, ISSUED);
}

interface TemplateData {
  readonly rootPub: string;
  readonly rootKey: KeyObject;
  /** B-124: the encrypted Key of Nebuchadnezzar file, for `kaji relocate` run as the CLI runs it. */
  readonly keyFile: string;
  readonly keys: Record<string, { publicKey: string; privateKey: KeyObject }>;
  readonly serial: number;
}

// Windows CI: building a home (SQLite stores, keys, signed records) costs seconds there, so each mesh variant
// is built once per file and copied for every test (as in coordinator-relocation.test.ts).
const templates = new Map<string, { dir: string; data: TemplateData }>();
after(() => {
  for (const t of templates.values()) rmSync(t.dir, { recursive: true, force: true });
});

/** Bases `ids`, all enrolled; X is main at epoch 2 with B as its standby; `standbys` keep a standby store. */
function buildMesh(dir: string, ids: readonly string[], standbys: readonly string[]): TemplateData {
  const keyFile = createRootKey(PASS);
  const root = unlockRootKey(keyFile.file, PASS);
  const rootPub = keyFile.publicKey;
  const keys: TemplateData['keys'] = {};
  for (const id of ids) {
    const k = generateKeyPairSync('ed25519');
    keys[id] = { publicKey: b64(k.publicKey), privateKey: k.privateKey };
  }
  let serial = 0;
  const records = [
    ...ids.map((id) => ({
      kind: 'enrol',
      baseId: id,
      name: NAMES[id],
      publicKey: keys[id]!.publicKey,
      address: '127.0.0.1:9',
    })),
    { kind: 'main', baseId: X, coordinatorEpoch: 2 },
  ].map((body) =>
    signRecord(root.privateKey, { ...body, serial: ++serial, issued: ISSUED } as unknown as RegistryBody),
  );
  for (const id of ids) {
    const home = join(dir, id);
    mkdirSync(home, { recursive: true });
    const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
    const reg = new Registry(store.db, rootPub);
    for (const r of records) reg.add(r, new Date(ISSUED));
    if (id === X) {
      setState(store.db, { epoch: 2, mode: 'active', standby: B });
      seedOutbox(store.db, true);
    }
    store.close();
    if (standbys.includes(id)) {
      const standby = new Store(join(home, STANDBY_DB_FILE));
      setState(standby.db, { epoch: 2, mode: 'standby' });
      seedOutbox(standby.db, false);
      standby.close();
    }
  }
  return { rootPub, rootKey: root.privateKey, keyFile: keyFile.file, keys, serial };
}

function meshFromTemplate(ids: readonly string[], standbys: readonly string[]) {
  const key = `${ids.join(',')}|${standbys.join(',')}`;
  let t = templates.get(key);
  if (!t) {
    const built = mkdtempSync(join(tmpdir(), 'nerv-mesh-template-'));
    t = { dir: built, data: buildMesh(built, ids, standbys) };
    templates.set(key, t);
  }
  const dir = mkdtempSync(join(tmpdir(), 'nerv-mesh-'));
  cpSync(t.dir, dir, { recursive: true });
  return { dir, data: t.data };
}

interface Service {
  readonly lease: ReturnType<typeof coordinatorLeaseService>;
  readonly keeper: ReturnType<ReturnType<typeof coordinatorLeaseService>['keeper']>;
  readonly authority: ReturnType<typeof coordinatorChannelAuthority>;
  readonly store: Store;
  /** F-016-T20: serve's replication shipper, over the simulated Kaji line. */
  readonly shipper: ReturnType<ReturnType<typeof coordinatorLeaseService>['shipper']>;
}

interface Base {
  readonly id: string;
  readonly home: string;
  readonly db: string;
  readonly publicKey: string;
  mono: bigint;
  awake: boolean;
  service: Service | undefined;
}

type Effect = { readonly kind: 'telegram' | 'outbox' | 'approval'; readonly id: string; readonly by: string };

class Mesh {
  readonly dir: string;
  readonly rootPub: string;
  private readonly rootKey: KeyObject;
  private readonly keyFile: string;
  private readonly keys: TemplateData['keys'];
  private serial: number;
  readonly bases = new Map<string, Base>();
  /** Groups that can reach each other; undefined: everyone reaches everyone. */
  partition: string[][] | undefined;
  /** Bases running an older NERV: their epoch-push reply has no `ranOrAckedEpoch` (B-121-T02). */
  readonly olderPeers = new Set<string>();
  /** Every epoch push sent (a probe carries no records). */
  readonly pushes: { from: string; to: string; records: number }[] = [];
  readonly effects: Effect[] = [];
  /** Who held coordinator authority at each step (ms since start). */
  readonly timeline: { at: number; holders: string[] }[] = [];
  private readonly startMs: number;
  private nextUpdate = 1;
  /** F-016-T20: the holder saves its Telegram offset as the channel does. */
  telegramContinuity = false;
  /**
   * F-016-T20: serve's shipper runs each step. Off, the scenarios model a standby store that was not kept
   * current (it holds the template state: the attempt of the uncertain send, not its result).
   */
  replication = false;
  /**
   * B-124: KajiLink's heartbeat registry sync. Every 5 s each serving base pulls the records of every peer it reaches
   * (a peer that holds newer ones hands them over), so a record stored in any live registry reaches every base.
   */
  gossip = false;
  private relocations = 0;
  private readonly telegram: number[] = [];

  constructor(ids: readonly string[], standbys: readonly string[]) {
    const { dir, data } = meshFromTemplate(ids, standbys);
    this.dir = dir;
    this.rootPub = data.rootPub;
    this.rootKey = data.rootKey;
    this.keyFile = data.keyFile;
    this.keys = data.keys;
    this.serial = data.serial;
    this.startMs = Date.parse('2026-11-24T12:00:00.000Z');
    mock.timers.enable({ apis: ['Date'], now: this.startMs });
    for (const id of ids)
      this.bases.set(id, {
        id,
        home: join(dir, id),
        db: join(dir, id, 'nerv.sqlite'),
        publicKey: data.keys[id]!.publicKey,
        mono: 1_000_000_000n,
        awake: true,
        service: undefined,
      });
    // X was renewing through B before the fixture starts: B acked epoch 2 a moment ago, X holds the lease.
    const x = this.base(X);
    const xdb = new DatabaseSync(x.db);
    applyCoordinatorLease(xdb, { coordinatorEpoch: 2, reqStartedWallMs: Date.now(), reqStartedMonoNs: x.mono });
    xdb.close();
    // The X->D outbox send before the fixture started.
    this.effects.push({ kind: 'outbox', id: OUTBOX_ID, by: X });
    for (const id of ids) this.start(id);
  }

  base(id: string): Base {
    const b = this.bases.get(id);
    if (!b) throw new Error(`No base ${id}.`);
    return b;
  }

  /** `serve` on this base; refuses while a promotion is unfinished (the marker), as serve does. */
  start(id: string): void {
    const b = this.base(id);
    if (b.service) return;
    assertNoPromotionInProgress(b.home);
    const lease = coordinatorLeaseService({
      home: b.home,
      databasePath: b.db,
      baseId: id,
      root: this.rootPub,
      ownPublicKey: b.publicKey,
      monoNow: () => b.mono,
      privateKey: this.keys[id]!.privateKey,
    });
    const keeper = lease.keeper((standby, request) => this.renew(id, standby, request));
    const authority = coordinatorChannelAuthority({ home: b.home, databasePath: b.db, baseId: id, root: this.rootPub });
    const shipper = lease.shipper({
      replicate: (to, batch, leaseExpiresAt) => this.replicate(id, to, batch, leaseExpiresAt),
      seedStandby: (to, frame, coordinatorEpoch) => this.seedStandby(id, to, frame, coordinatorEpoch),
    });
    b.service = { lease, keeper, authority, shipper, store: new Store(b.db, undefined, { home: b.home }) };
  }

  stop(id: string): void {
    const b = this.base(id);
    const s = b.service;
    if (!s) return;
    b.service = undefined;
    s.keeper.stop();
    s.shipper.stop();
    s.lease.stop();
    s.authority.close();
    s.store.close();
  }

  close(): void {
    for (const id of this.bases.keys()) this.stop(id);
    mock.timers.reset();
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** The owner signs a record with the root key (the offline Key of Nebuchadnezzar). */
  sign(body: Record<string, unknown>): SignedRecord {
    return signRecord(this.rootKey, {
      ...body,
      serial: ++this.serial,
      issued: new Date().toISOString(),
    } as unknown as RegistryBody);
  }

  /** One round of the heartbeat registry sync between every pair of serving bases that reach each other. */
  syncRegistries(): void {
    for (const a of this.bases.values())
      for (const b of this.bases.values()) {
        if (a === b || !a.awake || !a.service) continue;
        try {
          this.answering(a.id, b.id);
        } catch {
          continue;
        }
        const theirs = this.withRegistry(b, (reg) => reg.records());
        this.withRegistry(a, (reg) => {
          for (const r of theirs)
            try {
              reg.add(r);
            } catch {
              // Not signed by the pinned root, or an older main record: dropped, as KajiLink drops it.
            }
        });
      }
  }

  /**
   * B-124: `nerv kaji relocate TARGET FILE` run with the real CLI on base `on` (the base holding the Key, its live
   * store); a push it sends goes over the simulated Kaji line. Returns the records of the bundle it wrote.
   */
  async relocate(on: string, target: string, flags: Record<string, string> = {}): Promise<SignedRecord[]> {
    const b = this.base(on);
    writeFileSync(join(b.home, ROOT_KEY_FILE), this.keyFile);
    const file = join(this.dir, `relocate-${target}-${++this.relocations}.json`);
    const config = { base: { id: on }, kaji: { root: this.rootPub } } as unknown as Parameters<
      typeof runKajiCommand
    >[3];
    const log = mock.method(console, 'log', () => {});
    try {
      await runKajiCommand(['relocate', target, file], b.home, b.service!.store, config, {
        readSecret: async () => PASS,
        flag: (name) => flags[name],
        promotion: { pushEpoch: (to, records) => this.pushEpoch(on, to, records) },
      });
    } finally {
      log.mock.restore();
    }
    // What `kaji promote --relocation FILE` and `kaji drain --relocation FILE` read (verified against the root).
    const records = existsSync(file) ? readRelocationBundle(file, this.rootPub).records : [];
    this.serial = Math.max(this.serial, ...records.map((r) => r.body.serial));
    return records;
  }

  /** `kaji import` on a base: merges owner-signed records into its registry. */
  importRecords(id: string, records: SignedRecord[]): void {
    this.withRegistry(this.base(id), (reg) => {
      for (const r of records) reg.add(r);
    });
  }

  registryOf(id: string): { main: string | undefined; epoch: number } {
    return this.withRegistry(this.base(id), (reg) => ({ main: reg.main(), epoch: reg.mainEpoch() }));
  }

  state(id: string) {
    const db = new DatabaseSync(this.base(id).db);
    try {
      return readCoordinatorFencingState(db);
    } finally {
      db.close();
    }
  }

  setStandby(id: string, standby: string): void {
    const db = new DatabaseSync(this.base(id).db);
    try {
      db.prepare('UPDATE coordinator_state SET standby_base_id = ? WHERE id = 1').run(standby);
    } finally {
      db.close();
    }
  }

  private withRegistry<T>(b: Base, fn: (reg: Registry) => T): T {
    const db = new DatabaseSync(b.db);
    try {
      db.exec('PRAGMA busy_timeout = 1000');
      return fn(new Registry(db, this.rootPub));
    } finally {
      db.close();
    }
  }

  private reachable(a: string, b: string): boolean {
    return !this.partition || this.partition.some((g) => g.includes(a) && g.includes(b));
  }

  /** The receiving KajiLink: it answers only when awake, serving and reachable, and refuses unknown or revoked senders. */
  private answering(from: string, to: string): Base {
    const target = this.base(to);
    if (!this.reachable(from, to) || !target.awake || !target.service) throw new Error(`${to} unreachable`);
    const trusted = this.withRegistry(target, (reg) =>
      reg.bases().some((e) => e.baseId === from && e.status === 'enrolled'),
    );
    if (!trusted) throw new Error(`${to} refused ${from}: unknown or revoked base`);
    return target;
  }

  /** `POST /kaji/lease/renew` as KajiLink routes it (src/kaji-link.ts). */
  async renew(from: string, to: string, request: LeaseRenewRequest): Promise<LeaseRenewResult> {
    const target = this.answering(from, to);
    const reg = this.withRegistry(target, (r) => ({ main: r.main(), epoch: r.mainEpoch() }));
    if (reg.main !== from) {
      if (reg.epoch > request.coordinatorEpoch)
        return {
          ok: false,
          reason: 'stale_coordinator_epoch',
          maxSeenCoordinatorEpoch: reg.epoch,
          error: `This base holds a main record at coordinator epoch ${reg.epoch}.`,
        };
      throw new Error(`${to} refused (403): only the main base may renew its lease`);
    }
    return target.service!.lease.onLeaseRenew(from, request);
  }

  /** The coordinator routes KajiLink checks before its handler: only from the main base, never an older epoch, a live lease. */
  private coordinatorRoute(from: string, to: string, coordinatorEpoch: number, leaseExpiresAt?: number): Base {
    const target = this.answering(from, to);
    const reg = this.withRegistry(target, (r) => ({ main: r.main(), epoch: r.mainEpoch() }));
    if (reg.main !== from) throw new Error(`${to} refused (403): only the main base replicates here`);
    if (coordinatorEpoch < reg.epoch) throw new Error(`${to} refused (409): stale_coordinator_epoch`);
    if (leaseExpiresAt !== undefined && Date.now() > leaseExpiresAt)
      throw new Error(`${to} refused (409): stale_coordinator_lease`);
    return target;
  }

  /** `POST /kaji/replicate` as KajiLink routes it (F-016-T20). */
  async replicate(from: string, to: string, batch: ReplicationBatch, leaseExpiresAt: number) {
    const target = this.coordinatorRoute(from, to, batch.coordinatorEpoch, leaseExpiresAt);
    return target.service!.lease.onReplicate(from, batch);
  }

  /** `POST /kaji/standby/seed` as KajiLink routes it (F-016-T20): state, not authority, so no lease check. */
  async seedStandby(from: string, to: string, frame: Buffer, coordinatorEpoch: number) {
    const target = this.coordinatorRoute(from, to, coordinatorEpoch);
    return target.service!.lease.onSeed(from, frame.toString('utf8'));
  }

  /** `POST /kaji/epoch-push` as KajiLink routes it. */
  async pushEpoch(from: string, to: string, records: SignedRecord[]) {
    this.pushes.push({ from, to, records: records.length });
    const target = this.answering(from, to);
    const epoch = this.withRegistry(target, (reg) => {
      for (const r of records) {
        try {
          reg.add(r);
        } catch {
          // A record not signed by the pinned root is dropped.
        }
      }
      return reg.mainEpoch();
    });
    return {
      maxSeenCoordinatorEpoch: epoch,
      standby: existsSync(join(target.home, STANDBY_DB_FILE)),
      ...(this.olderPeers.has(to) ? {} : { ranOrAckedEpoch: target.service!.lease.ranOrAckedEpoch() }),
    };
  }

  /** `POST /kaji/decide` as KajiLink routes it: only from the main base, never with an older epoch header. */
  decide(from: string, to: string, approvalId: string, coordinatorEpoch: number): 'decided' {
    const target = this.answering(from, to);
    const reg = this.withRegistry(target, (r) => ({ main: r.main(), epoch: r.mainEpoch() }));
    if (reg.main !== from) throw new Error(`${to} refused (403): only the main base decides here`);
    if (coordinatorEpoch < reg.epoch) throw new Error(`${to} refused (409): stale_coordinator_epoch`);
    this.record({ kind: 'approval', id: approvalId, by: from });
    return 'decided';
  }

  private record(e: Effect): void {
    const twice = this.effects.find((o) => o.kind === e.kind && o.id === e.id);
    assert.equal(twice, undefined, `${e.kind} ${e.id} ran twice: by ${twice?.by} and by ${e.by}`);
    this.effects.push(e);
  }

  /** Who may act as the coordinator right now (Telegram's own gate), among bases awake and serving. */
  holders(): string[] {
    return [...this.bases.values()].filter((b) => b.awake && b.service && b.service.authority()).map((b) => b.id);
  }

  elapsed(): number {
    return Date.now() - this.startMs;
  }

  /** One step of every base's coordinator loops, gated as serve gates them. */
  private step(): void {
    this.telegram.push(this.nextUpdate++);
    const holders = this.holders();
    this.timeline.push({ at: this.elapsed(), holders });
    assert.ok(holders.length <= 1, `two coordinators at ${this.elapsed()} ms: ${holders.join(', ')}`);
    const [holder] = holders;
    if (!holder) return;
    // Telegram: the bot hands each update out once (getUpdates confirms it); only the holder polls.
    const updates = this.telegram.splice(0);
    for (const u of updates) this.record({ kind: 'telegram', id: String(u), by: holder });
    // F-016-T20: the channel saves its getUpdates offset into coordinator_state (TelegramChannel.save).
    if (this.telegramContinuity && updates.length)
      coordinatorTelegramContinuity(this.base(holder).db).save({ offset: updates.at(-1)! + 1, cards: [] });
    // Outbox: the holder sends every unsettled, unquarantined row (Store.outbox), then settles it.
    const store = this.base(holder).service!.store;
    for (const row of store.outbox()) {
      this.record({ kind: 'outbox', id: row.id, by: holder });
      store.outboxDone(row.id, { ok: true });
    }
  }

  /** Advances the shared wall clock; awake bases' monotonic clocks advance too, keepers run every 15 s. */
  async advance(ms: number): Promise<void> {
    for (let t = 0; t < ms; t += STEP_MS) {
      mock.timers.tick(STEP_MS);
      for (const b of this.bases.values()) if (b.awake) b.mono += BigInt(STEP_MS) * 1_000_000n;
      if (this.gossip && this.elapsed() % 5000 === 0) this.syncRegistries();
      if (this.elapsed() % LEASE_RENEW_MS === 0)
        for (const b of this.bases.values()) if (b.awake && b.service) await b.service.keeper.renewOnce();
      this.step();
      // F-016-T20: serve ships each committed batch to the named standby.
      if (this.replication)
        for (const b of this.bases.values()) if (b.awake && b.service) await b.service.shipper.tick();
    }
  }

  /** The Telegram offset a base's coordinator_state holds (main or standby store). */
  telegramOffset(id: string, file = 'nerv.sqlite'): number | null {
    const db = new DatabaseSync(join(this.base(id).home, file));
    try {
      return (
        db.prepare('SELECT telegram_offset AS o FROM coordinator_state WHERE id = 1').get() as { o: number | null }
      ).o;
    } finally {
      db.close();
    }
  }

  /** A new remote request queued on a base (sent by the holder's outbox at the next step). */
  queueRemote(id: string, outboxId: string): void {
    const db = new DatabaseSync(this.base(id).db);
    try {
      db.prepare('INSERT INTO kaji_outbox VALUES(?,?,?,?,?,?,?,?,?)').run(
        outboxId,
        '00000000-0000-4000-8000-0000000000c2',
        D,
        'neutral.tool',
        '{}',
        'Neutral request',
        new Date().toISOString(),
        null,
        null,
      );
    } finally {
      db.close();
    }
  }

  /** The lid closes: no loop runs and the monotonic clock stops; the wall clock keeps going. */
  sleep(id: string): void {
    this.base(id).awake = false;
  }

  /** The lid opens: the effect boundary checks authority before any timer has run. */
  wake(id: string): void {
    this.base(id).awake = true;
    this.step();
  }

  /**
   * `nerv kaji drain` on a base (src/cli-kaji.ts): drains its coordinator state for the newest main record in its
   * registry and writes the signed receipt; its service keeps running (fenced), as with the real command. The
   * verified main records and (#721 fourth check) the newest epoch this base ran or acked go with the request.
   */
  drain(id: string, relocation?: readonly SignedRecord[]): string {
    const b = this.base(id);
    const db = new DatabaseSync(b.db);
    try {
      const reg = new Registry(db, this.rootPub);
      const state = readCoordinatorFencingState(db)!;
      // B-124: `kaji drain --relocation FILE` reads the bundle's records as if held and stores them with the fence.
      const records = [...reg.records(), ...(relocation ?? [])];
      const mains = records.filter((r) => r.body.kind === 'main');
      const newest = mains.reduce((a, r) => ((r.body.coordinatorEpoch ?? 0) > (a.body.coordinatorEpoch ?? 0) ? r : a));
      const receipt = drainCoordinator(db, {
        baseId: id,
        coordinatorEpoch: state.coordinatorEpoch,
        newMainBaseId: newest.body.baseId!,
        newEpoch: newest.body.coordinatorEpoch ?? 0,
        registryMains: mains.map((r) => ({ baseId: r.body.baseId, coordinatorEpoch: r.body.coordinatorEpoch ?? 0 })),
        ranOrAckedEpoch: ranOrAckedCoordinatorEpoch(db, join(b.home, STANDBY_DB_FILE)),
        ...(relocation
          ? {
              commit: (tx: DatabaseSync) => {
                const signed = new Registry(tx, this.rootPub);
                for (const r of relocation) signed.add(r);
              },
            }
          : {}),
      });
      const file = join(this.dir, `receipt-${id}-${receipt.newMainBaseId}-${receipt.newEpoch}.json`);
      writeFileSync(file, JSON.stringify(signDrainReceipt(this.keys[id]!.privateKey, receipt)));
      return file;
    } finally {
      db.close();
    }
  }

  /** `nerv kaji promote` on a base, its service control and clock wired into the mesh. */
  promote(id: string, extra: Partial<PromoteCoordinatorInput> = {}) {
    const b = this.base(id);
    return promoteCoordinator({
      home: b.home,
      rootPublicKey: this.rootPub,
      ownPublicKey: b.publicKey,
      service: { stop: () => this.stop(id), start: () => this.start(id) },
      clock: { wall: () => Date.now(), mono: () => b.mono, sleep: (ms) => this.advance(ms) },
      pushEpoch: (to, records) => this.pushEpoch(id, to, records),
      ...extra,
    });
  }

  /** First and last step at which `id` held authority. */
  span(id: string): { first: number; last: number } | undefined {
    const at = this.timeline.filter((s) => s.holders.includes(id)).map((s) => s.at);
    return at.length ? { first: at[0]!, last: at.at(-1)! } : undefined;
  }

  sends(kind: Effect['kind'], by: string): number {
    return this.effects.filter((e) => e.kind === kind && e.by === by).length;
  }
}

function refused(reason: string, pattern?: RegExp) {
  return (err: unknown) =>
    err instanceof RelocationRefusedError && err.reason === reason && (!pattern || pattern.test(err.message));
}

let mesh: Mesh | undefined;
afterEach(() => {
  mesh?.close();
  mesh = undefined;
});

describe('F-016-T08: partition, sleep and reconnect keep one authority and run no effect twice', () => {
  it('partition: the old main, still online to Telegram, fences within its lease; the standby promotes only after the revoke and the wait', async () => {
    const m = (mesh = new Mesh([X, B], [B]));
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [X]);
    const lastAckAt = 30_000; // X renewed through B at 15 s and 30 s.

    m.partition = [[X], [B]];
    await m.advance(90_000);
    const x = m.span(X)!;
    assert.ok(x.last < lastAckAt + LEASE_EFFECTIVE_TTL_MS, `X acted until ${x.last} ms`);
    assert.equal(m.state(X)?.replicationMode, 'fenced');

    // The owner revokes X with the root key and names B at epoch 3; B imports both.
    const records = [
      m.sign({ kind: 'revoke', baseId: X, publicKey: m.base(X).publicKey }),
      m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
    ];
    m.importRecords(B, records);
    const promoteAt = m.elapsed();
    const res = await m.promote(B);
    assert.ok('quarantined' in res && res.newEpoch === 3 && res.quarantined === 1);
    await m.advance(30_000);
    const b = m.span(B)!;
    assert.ok(b.first >= promoteAt + 65_000, `B acted at ${b.first} ms`);
    assert.ok(b.first > x.last);

    // Reconnect: X's renewals reach B, which refuses a revoked base; X stays fenced, even after catching up.
    m.partition = undefined;
    await m.advance(30_000);
    m.importRecords(X, records);
    await m.advance(30_000);
    assert.equal(m.state(X)?.replicationMode, 'fenced');
    assert.deepEqual(m.holders(), [B]);
    // The uncertain send of epoch 2 is quarantined for the owner, never sent again by B.
    assert.equal(m.sends('outbox', B), 0);
    assert.deepEqual(
      m
        .base(B)
        .service!.store.cancelledWorkerOutbox()
        .map((r) => [r.id, r.attempted]),
      [[OUTBOX_ID, true]],
    );
    assert.ok(m.sends('telegram', X) > 0 && m.sends('telegram', B) > 0);
  });

  it('sleep: a lid closed past the lease (>175 s) acts on no effect at wake; a benign wake re-arms through the standby, a relocated one stays fenced', async () => {
    const m = (mesh = new Mesh([X, B], [B]));
    await m.advance(20_000);

    // Benign: 200 s asleep, nothing moved. At wake the lease has passed on the wall clock: no effect runs.
    m.sleep(X);
    await m.advance(200_000);
    assert.deepEqual(m.timeline.at(-1)!.holders, []);
    const wokeAt = m.elapsed();
    m.wake(X);
    assert.deepEqual(m.timeline.at(-1)!.holders, []);
    await m.advance(40_000);
    // The keeper fenced on its first run after wake and re-armed at the next ack from B (same epoch, still named).
    const back = m.timeline.find((s) => s.at > wokeAt && s.holders.includes(X))!;
    assert.ok(back.at > wokeAt);
    assert.deepEqual(m.holders(), [X]);
    assert.equal(m.state(X)?.replicationMode, 'active');

    // Relocated: X sleeps for 10 minutes; the owner revokes it and B promotes meanwhile.
    m.sleep(X);
    await m.advance(5_000);
    const records = [
      m.sign({ kind: 'revoke', baseId: X, publicKey: m.base(X).publicKey }),
      m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
    ];
    m.importRecords(B, records);
    await m.promote(B);
    await m.advance(600_000 - m.elapsed() + wokeAt);
    m.wake(X);
    assert.deepEqual(m.timeline.at(-1)!.holders, [B]);
    await m.advance(60_000);
    assert.equal(m.state(X)?.replicationMode, 'fenced');
    assert.ok(m.span(X)!.last < m.span(B)!.first);
  });

  it('review scenario: X moved its standby to D, then {X, D} | {B}: B is refused until D holds the revoke, and X fences before B acts', async () => {
    const m = (mesh = new Mesh([X, B, D], [B, D]));
    await m.advance(30_000); // X renews through B: B holds ack history for epoch 2.
    m.setStandby(X, D);
    await m.advance(30_000); // X now renews through D.

    m.partition = [[X, D], [B]];
    const records = [
      m.sign({ kind: 'revoke', baseId: X, publicKey: m.base(X).publicKey }),
      m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
    ];
    m.importRecords(B, records);
    const firstTry = m.elapsed();
    await assert.rejects(m.promote(B), refused('old_host_unconfirmed', /NERV-04/));
    assert.ok(m.base(B).service, 'a refusal leaves the service running');
    assert.equal(existsSync(join(m.base(B).home, PROMOTION_MARKER_FILE)), false);
    // Had B gone ahead on the revoke and its stale ack history, X would still be acting through D well past
    // the 65 s B would have waited.
    await m.advance(120_000);
    assert.ok(m.span(X)!.last >= firstTry + 65_000);
    assert.deepEqual(m.holders(), [X]);

    // D reaches B again (X still cut off from B): B's push carries the revoke to D, which then refuses X.
    m.partition = [
      [X, D],
      [B, D],
    ];
    const res = await m.promote(B);
    assert.ok(!('resumed' in res) && res.newEpoch === 3);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
    assert.ok(m.span(X)!.last < m.span(B)!.first);
    // B renews through D, the standby that acked the new epoch.
    assert.equal(m.registryOf(D).main, B);
    assert.equal(m.state(X)?.replicationMode, 'fenced');
  });

  it('half-done promote: a crash at any swap step leaves no coordinator acting; the re-run finishes and nothing runs twice', async () => {
    for (const step of [1, 2, 3, 4, 5] as const) {
      const m = (mesh = new Mesh([X, B], [B]));
      m.partition = [[X], [B]];
      await m.advance(60_000); // X fences: its standby is out of reach.
      const records = [
        m.sign({ kind: 'revoke', baseId: X, publicKey: m.base(X).publicKey }),
        m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
      ];
      m.importRecords(B, records);
      await assert.rejects(m.promote(B, { failAfterStep: step }), /Injected crash/);
      assert.ok(existsSync(join(m.base(B).home, PROMOTION_MARKER_FILE)), `step ${step}: the marker stays`);
      assert.throws(() => m.start(B), /promotion is in progress/);
      await m.advance(60_000);
      assert.deepEqual(m.timeline.at(-1)!.holders, [], `step ${step}: nobody acts while the swap is unfinished`);
      const pending = m.effects.filter((e) => e.kind === 'telegram').length;
      const res = await m.promote(B);
      assert.equal(res.newEpoch, 3);
      await m.advance(20_000);
      if (step === 5) {
        // Activation had committed and armed B's sole lease; it passed while the service stayed down, so B
        // fenced itself at start, like a sole main after a long sleep: the owner re-arms it (kaji lease-rearm).
        assert.ok('resumed' in res);
        assert.deepEqual(m.holders(), [], 'step 5: an expired sole lease never acts');
        assert.equal(m.state(B)?.replicationMode, 'fenced');
        m.stop(B);
        const db = new DatabaseSync(m.base(B).db);
        rearmSoleCoordinatorLease(db, {
          coordinatorEpoch: 3,
          hasEnrolledStandby: false,
          confirmSoleCoordinator: true,
          nowMonoNs: m.base(B).mono,
        });
        db.close();
        m.start(B);
        await m.advance(1_000);
      }
      assert.deepEqual(m.holders(), [B], `step ${step}`);
      // The updates that queued while nobody acted are answered once, by B.
      assert.ok(m.effects.filter((e) => e.kind === 'telegram').length > pending);
      assert.equal(m.sends('outbox', B), 0, `step ${step}: the uncertain send stays quarantined`);
      mesh.close();
      mesh = undefined;
    }
  });

  it('#717 review: a main whose own registry names it at a later epoch than its state stops acting (epoch check)', async () => {
    const m = (mesh = new Mesh([X, B], [B]));
    await m.advance(20_000);
    assert.deepEqual(m.holders(), [X]);
    // The owner re-signs X as main at epoch 3 without a promotion: X's store still runs epoch 2, so only the
    // epoch comparison (not the main-base check) can stop it.
    m.importRecords(X, [m.sign({ kind: 'main', baseId: X, coordinatorEpoch: 3 })]);
    await m.advance(1_000);
    assert.deepEqual(m.holders(), []);
  });

  it('#717 review: a service start that fails after the swap is recovered by running kaji promote again', async () => {
    const m = (mesh = new Mesh([X, B], [B]));
    m.partition = [[X], [B]];
    await m.advance(60_000);
    m.importRecords(B, [
      m.sign({ kind: 'revoke', baseId: X, publicKey: m.base(X).publicKey }),
      m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
    ]);
    await assert.rejects(
      m.promote(B, {
        service: {
          stop: () => m.stop(B),
          start: () => {
            throw new Error('launchctl bootstrap failed');
          },
        },
      }),
      /launchctl bootstrap failed/,
    );
    assert.equal(existsSync(join(m.base(B).home, PROMOTION_MARKER_FILE)), false);
    assert.equal(m.base(B).service, undefined);
    const res = await m.promote(B);
    assert.ok('resumed' in res && res.newEpoch === 3);
    await m.advance(5_000);
    assert.deepEqual(m.holders(), [B]);
  });

  it('mixed epochs: a stale main is refused by peers holding the newer epoch, and a re-targeted move never takes over from state older than an epoch that ran', async () => {
    const m = (mesh = new Mesh([X, B, C, D], [B, C, D]));
    await m.advance(30_000);
    assert.equal(m.decide(X, D, APPROVAL_ID, 2), 'decided');

    // X sleeps. The owner revokes it and names B at epoch 3; B pushes the records to C and D, which ack.
    m.sleep(X);
    const toB = [
      m.sign({ kind: 'revoke', baseId: X, publicKey: m.base(X).publicKey }),
      m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
    ];
    m.importRecords(B, toB);
    const b = await m.promote(B);
    assert.ok(!('resumed' in b) && b.newEpoch === 3);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]); // B renews through C, the first base that acked from a standby store.

    // X wakes at epoch 2 with its lease long past: it acts on nothing, and D refuses its decision (revoked there).
    m.wake(X);
    assert.throws(() => m.decide(X, D, APPROVAL_ID, 2), /refused/);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
    assert.equal(m.state(X)?.replicationMode, 'fenced');

    // The owner re-targets to C at epoch 4 while B runs epoch 3. C now holds the newer main record, so B's
    // renewals through C get signed newer-epoch evidence and B fences.
    m.importRecords(C, [...toB, m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 })]);
    // C's standby store holds epoch 2 state, but C itself acked B's lease at epoch 3: an epoch-3 coordinator ran
    // after that state, so taking over from it would undo (and could repeat) what B did. C is refused, and
    // (#717 review) refused before its epoch push: no other base learns epoch 4 from a move that cannot happen.
    await assert.rejects(m.promote(C), refused('standby_behind', /epoch 3/));
    assert.ok(m.base(C).service, 'a refusal leaves the service running');
    assert.equal(m.registryOf(B).epoch, 3);
    assert.equal(m.registryOf(D).epoch, 3);
    await m.advance(30_000);
    assert.equal(m.state(B)?.replicationMode, 'fenced');
    // So B can be kept: it names D as its standby, D (still at epoch 3) acks, and B acts again, alone.
    m.setStandby(B, D);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
    assert.equal(m.sends('approval', X), 1);
  });
});

/**
 * X at 2 is revoked while asleep; B promotes to 3 and renews through D only, so C never acks epoch 3. With
 * `replication`, serve's shipper keeps each main's standby current (B seeds D).
 */
async function bRunsThroughD(replication = false) {
  const m = (mesh = new Mesh([X, B, C, D], [B, C, D]));
  m.replication = replication;
  await m.advance(30_000);
  m.sleep(X);
  const toB = [
    m.sign({ kind: 'revoke', baseId: X, publicKey: m.base(X).publicKey }),
    m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
  ];
  m.importRecords(B, toB);
  const b = await m.promote(B);
  assert.ok(!('resumed' in b) && b.newEpoch === 3);
  m.setStandby(B, D);
  await m.advance(30_000);
  assert.deepEqual(m.holders(), [B]);
  return { m, toB };
}

describe('B-121-T02: a re-targeted move hears from every base which epochs ran, before it tells any of them the new one', () => {
  it('B ran epoch 3 renewing through D; re-targeted to C at 4, C (which never acked B) is refused standby_behind and B keeps acting', async () => {
    const { m, toB } = await bRunsThroughD();
    // C's own stores show nothing later than epoch 2: the local check alone (B-121-T01) would let it promote.
    m.importRecords(C, [...toB, m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 })]);
    await assert.rejects(m.promote(C), refused('standby_behind', /epoch 3/));
    assert.ok(m.base(C).service, 'a refusal leaves the service running');
    assert.equal(existsSync(join(m.base(C).home, PROMOTION_MARKER_FILE)), false);
    // The epoch-3 witnesses answered before any push: B and D never learned epoch 4, so B is not fenced.
    assert.equal(m.registryOf(B).epoch, 3);
    assert.equal(m.registryOf(D).epoch, 3);
    await m.advance(60_000);
    assert.deepEqual(m.holders(), [B]);
    assert.equal(m.state(B)?.replicationMode, 'active');
  });

  it('an older peer that does not report the epochs it ran keeps an unplanned move refused, before any push', async () => {
    const m = (mesh = new Mesh([X, B, D], [B, D]));
    await m.advance(30_000);
    m.olderPeers.add(D);
    m.sleep(X);
    m.importRecords(B, [
      m.sign({ kind: 'revoke', baseId: X, publicKey: m.base(X).publicKey }),
      m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
    ]);
    await assert.rejects(m.promote(B), refused('peer_epoch_unknown', /NERV-04/));
    assert.ok(m.base(B).service, 'a refusal leaves the service running');
    assert.equal(m.registryOf(D).epoch, 2, 'D was not told epoch 3');
    // D is updated: it now answers with the epochs it ran or acked (2), and the move goes ahead.
    m.olderPeers.delete(D);
    const res = await m.promote(B);
    assert.ok(!('resumed' in res) && res.newEpoch === 3);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
  });
});

describe('B-124: kaji relocate tells no base the new epoch before the target passes its prechecks', () => {
  const epochs = (m: Mesh) => [B, C, D].map((id) => m.registryOf(id).epoch);

  it('B runs 3 through D; relocated to C at 4, C is refused and B keeps acting; then a planned move to D takes over', async () => {
    const { m } = await bRunsThroughD(true);
    m.gossip = true;
    m.pushes.length = 0;
    // The owner signs the re-target on D (it holds the Key): nothing is pushed and no registry holds epoch 4.
    const toC = await m.relocate(D, C);
    assert.deepEqual(
      m.pushes.filter((p) => p.records > 0),
      [],
      'kaji relocate pushed the new epoch',
    );
    await m.advance(10_000);
    assert.deepEqual(epochs(m), [3, 3, 3], 'no registry holds epoch 4, so the heartbeat sync carries none');
    assert.deepEqual(m.holders(), [B]);
    // C's promote reads the bundle's records as if held, asks every base, and is refused before telling any.
    await assert.rejects(m.promote(C, { relocation: toC }), refused('standby_behind', /epoch 3/));
    assert.deepEqual(epochs(m), [3, 3, 3], 'the refused move stored and pushed nothing');
    await m.advance(60_000);
    assert.deepEqual(m.holders(), [B]);
    assert.equal(m.state(B)?.replicationMode, 'active');

    // A planned move to D, whose standby B keeps current: the drain stores the records with the fence.
    const toD = await m.relocate(D, D);
    await m.base(B).service!.shipper.flush();
    const receipt = m.drain(B, toD);
    const res = await m.promote(D, { drainReceiptFile: receipt, relocation: toD });
    assert.ok(!('resumed' in res) && res.newEpoch === 4 && res.previousEpoch === 3);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [D]);
    assert.deepEqual(epochs(m), [4, 4, 4]);
  });

  it('an unplanned move from a relocation bundle (revoke + main) still promotes once every unrevoked base answers', async () => {
    const m = (mesh = new Mesh([X, B, D], [B, D]));
    m.gossip = true;
    await m.advance(30_000);
    m.sleep(X);
    m.pushes.length = 0;
    const toB = await m.relocate(D, B, { '--revoke': X });
    assert.deepEqual(
      m.pushes.filter((p) => p.records > 0),
      [],
    );
    assert.equal(m.registryOf(B).epoch, 2);
    const res = await m.promote(B, { relocation: toB });
    assert.ok(!('resumed' in res) && res.newEpoch === 3);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
  });

  it('the way out: the epoch was pushed and C is refused; a new main record naming B reinstates it from its own store', async () => {
    const { m, toB } = await bRunsThroughD();
    m.gossip = true;
    // As an older relocate did (or a hand import): every base holds C at 4 and B fences; C is refused.
    const toC = [m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 })];
    for (const id of [B, C, D]) m.importRecords(id, [...toB, ...toC]);
    await assert.rejects(m.promote(C), refused('standby_behind', /epoch 3/));
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [], 'no coordinator');
    // The owner names B again (epoch 5); kaji promote on B asks every base that nobody ran a later epoch than 3.
    const back = await m.relocate(D, B);
    const res = await m.promote(B, { relocation: back });
    assert.ok('reinstated' in res && res.newEpoch === 5 && res.previousEpoch === 3);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
    assert.equal(m.state(B)?.coordinatorEpoch, 5);
    // C, no longer named, cannot promote from the old record.
    await assert.rejects(m.promote(C), refused('not_named_main'));
  });

  it('the way out is refused while a base reports a later epoch than the old main ran', async () => {
    const { m, toB } = await bRunsThroughD();
    const toC = [m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 })];
    for (const id of [B, C, D]) m.importRecords(id, [...toB, ...toC]);
    // D acked a lease at epoch 4 (as if C had run): B's state is behind it.
    const ddb = new DatabaseSync(join(m.base(D).home, STANDBY_DB_FILE));
    ddb.prepare('UPDATE standby_lease_state SET standby_coordinator_epoch = 4 WHERE id = 1').run();
    ddb.close();
    const back = await m.relocate(D, B);
    await assert.rejects(m.promote(B, { relocation: back }), refused('standby_behind', /NERV-04 \(epoch 4\)/));
    assert.equal(m.registryOf(D).epoch, 4, 'the refused way out told no base epoch 5');
  });

  it("#734 review BLOCKER: a revoked main named after this base's state may have run: no reinstatement from the older state", async () => {
    const m = (mesh = new Mesh([X, B, D], [B, D]));
    m.replication = true;
    await m.advance(30_000);
    // X drains to B at 3; B runs epoch 3 through D.
    const toB = await m.relocate(X, B);
    await m.base(X).service!.shipper.flush();
    const receipt = m.drain(X, toB);
    const res = await m.promote(B, { drainReceiptFile: receipt, relocation: toB });
    assert.ok('quarantined' in res && res.newEpoch === 3);
    m.setStandby(B, D);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
    // B and D are lost and revoked; the owner names X again. X's store holds epoch 2: B's epoch 3 would be undone.
    m.sleep(B);
    m.sleep(D);
    m.importRecords(X, [m.sign({ kind: 'revoke', baseId: D, publicKey: m.base(D).publicKey })]);
    const back = await m.relocate(X, X, { '--revoke': B });
    await assert.rejects(m.promote(X, { relocation: back }), refused('standby_behind', /NERV-02.*cold restore/s));
    assert.equal(m.state(X)?.coordinatorEpoch, 2, 'X kept its epoch-2 state');
    assert.equal(m.state(X)?.replicationMode, 'fenced');
    assert.equal(m.registryOf(X).epoch, 3, 'the refused way out stored nothing');
  });

  it("#734 review: a promote checks a relocation bundle while the service holds the store's write lock", async () => {
    const { m } = await bRunsThroughD();
    const toC = await m.relocate(D, C);
    const lock = new DatabaseSync(m.base(C).db);
    lock.exec('BEGIN IMMEDIATE');
    try {
      await assert.rejects(m.promote(C, { relocation: toC }), refused('standby_behind', /epoch 3/));
    } finally {
      lock.exec('ROLLBACK');
      lock.close();
    }
  });

  it('#734 review: a drain that fails stores none of the relocation records', async () => {
    const { m } = await bRunsThroughD(true);
    m.gossip = true;
    const toD = await m.relocate(D, D);
    // A change committed after the last batch: the drain refuses (not yet replicated).
    m.queueRemote(B, OUTBOX_2);
    assert.throws(() => m.drain(B, toD), /not yet replicated/);
    await m.advance(10_000);
    assert.deepEqual(
      [B, C, D].map((id) => m.registryOf(id).epoch),
      [3, 3, 3],
    );
  });
});

describe('B-121 (#721 review): a planned re-target never hands over from state older than an epoch that ran', () => {
  it('X drains to B (3), B runs through D, the owner names C (4): the receipt from X lists B, which must answer; asleep or at epoch 3, C is refused', async () => {
    const m = (mesh = new Mesh([X, B, C, D], [B, C, D]));
    await m.advance(30_000);
    const toB = [m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 })];
    m.importRecords(X, toB);
    m.importRecords(B, toB);
    const first = m.drain(X);
    const b = await m.promote(B, { drainReceiptFile: first });
    assert.ok(!('resumed' in b) && b.newEpoch === 3);
    m.setStandby(B, D);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);

    // B and D are out of reach (asleep); the owner names C at epoch 4 and the drained X gives a second receipt.
    m.sleep(B);
    m.sleep(D);
    const toC = [m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 })];
    m.importRecords(X, toC);
    m.importRecords(C, [...toB, ...toC]);
    const second = m.drain(X);
    // B, which the receipt lists as skipped, does not answer: it may have run epoch 3.
    await assert.rejects(m.promote(C, { drainReceiptFile: second }), refused('old_host_unconfirmed', /NERV-02/));
    assert.equal(existsSync(join(m.base(C).home, PROMOTION_MARKER_FILE)), false);

    // B and D wake: B acts again through D, alone; asked again, B answers that it ran epoch 3.
    m.wake(B);
    m.wake(D);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
    await assert.rejects(m.promote(C, { drainReceiptFile: second }), refused('standby_behind', /epoch 3/));
    assert.equal(m.registryOf(B).epoch, 3, 'no base was told epoch 4');
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
  });

  it('a re-target whose first target never promoted stays planned: the receipt from X lists B, B answers epoch 2, C takes over', async () => {
    const m = (mesh = new Mesh([X, B, C, D], [B, C, D]));
    await m.advance(30_000);
    const records = [
      m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
      m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 }),
    ];
    m.importRecords(X, records);
    m.importRecords(C, records);
    const receipt = m.drain(X);
    const res = await m.promote(C, { drainReceiptFile: receipt });
    assert.ok(!('resumed' in res) && res.newEpoch === 4 && res.previousEpoch === 2);
  });

  it('an older peer whose signed reply shows a main record later than the standby keeps a planned move refused', async () => {
    const m = (mesh = new Mesh([X, B, C, D], [B, C, D]));
    await m.advance(30_000);
    // B runs an older NERV and holds a main record at epoch 3 (it may have run it); X and C never received it.
    m.olderPeers.add(B);
    const toB = m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 });
    const toC = m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 });
    m.importRecords(B, [toB]);
    m.importRecords(X, [toC]);
    m.importRecords(C, [toC]);
    const receipt = m.drain(X);
    await assert.rejects(m.promote(C, { drainReceiptFile: receipt }), refused('peer_epoch_unknown', /NERV-02/));
    assert.equal(existsSync(join(m.base(C).home, PROMOTION_MARKER_FILE)), false);
    assert.equal(m.registryOf(D).epoch, 2, 'no base was told epoch 4');
  });

  it('#721 third check: B ran 3 through D, B is lost and revoked, D asleep; with a skipped main every unrevoked base must answer', async () => {
    const m = (mesh = new Mesh([X, B, C, D], [B, C, D]));
    await m.advance(30_000);
    const toB = [m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 })];
    m.importRecords(X, toB);
    m.importRecords(B, toB);
    const first = m.drain(X);
    const b = await m.promote(B, { drainReceiptFile: first });
    assert.ok(!('resumed' in b) && b.newEpoch === 3);
    m.setStandby(B, D);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);

    // B is lost; the owner revokes it and names C at 4. Revoking B stops it, but does not undo epoch 3, which D
    // (asleep) acked; X drains again, listing B at 3.
    m.sleep(B);
    m.sleep(D);
    const toC = [
      m.sign({ kind: 'revoke', baseId: B, publicKey: m.base(B).publicKey }),
      m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 }),
    ];
    m.importRecords(X, toC);
    m.importRecords(C, [...toB, ...toC]);
    const second = m.drain(X);
    await assert.rejects(m.promote(C, { drainReceiptFile: second }), refused('old_host_unconfirmed', /NERV-04/));
    assert.equal(existsSync(join(m.base(C).home, PROMOTION_MARKER_FILE)), false);
    assert.equal(m.registryOf(D).epoch, 3, 'no base was told epoch 4');
    // D wakes and answers that it acked epoch 3: C's epoch-2 state is behind.
    m.wake(D);
    await assert.rejects(m.promote(C, { drainReceiptFile: second }), refused('standby_behind', /epoch 3/));
  });

  it('#721 fourth check: an earlier receipt (X at 2 to B at 3) is refused for C at 4 before any probe or push', async () => {
    const m = (mesh = new Mesh([X, B, C, D], [B, C, D]));
    await m.advance(30_000);
    const toB = [m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 })];
    m.importRecords(X, toB);
    const toBReceipt = m.drain(X);
    m.importRecords(C, [...toB, m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 })]);
    await assert.rejects(m.promote(C, { drainReceiptFile: toBReceipt }), refused('drain_receipt_invalid'));
    assert.deepEqual(m.pushes, [], 'neither the probe nor the push went out');
    assert.equal(m.registryOf(D).epoch, 2);
  });

  it('#721 fourth check: a drained main that acked a later epoch from its own standby store says so in its receipt', async () => {
    // X keeps a standby store too: drained to B at 3, X goes on serving, and B renews through X.
    const m = (mesh = new Mesh([X, B, C, D], [X, B, C, D]));
    await m.advance(30_000);
    const toB = [m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 })];
    m.importRecords(X, toB);
    m.importRecords(B, toB);
    const first = m.drain(X);
    const b = await m.promote(B, { drainReceiptFile: first });
    assert.ok(!('resumed' in b) && b.newEpoch === 3);
    m.setStandby(B, X);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
    // B is lost and revoked, X out of reach; D (which never acked epoch 3) answers. X drains again, to C at 4.
    m.sleep(B);
    m.sleep(X);
    const toC = [
      m.sign({ kind: 'revoke', baseId: B, publicKey: m.base(B).publicKey }),
      m.sign({ kind: 'main', baseId: C, coordinatorEpoch: 4 }),
    ];
    m.importRecords(X, toC);
    m.importRecords(C, [...toB, ...toC]);
    m.importRecords(D, [...toB, ...toC]);
    const second = m.drain(X);
    m.pushes.length = 0;
    await assert.rejects(m.promote(C, { drainReceiptFile: second }), refused('standby_behind', /epoch 3/));
    assert.deepEqual(m.pushes, [], 'refused from the receipt, before any probe or push');
    assert.equal(existsSync(join(m.base(C).home, PROMOTION_MARKER_FILE)), false);
  });
});

describe('F-016-T20: live replication carries what the old main did across a partition', () => {
  it('a remote request the old main sent before the partition, and its Telegram offset, are known to the promoted main', async () => {
    const m = (mesh = new Mesh([X, B], [B]));
    m.replication = true;
    m.telegramContinuity = true;
    // `kaji standby B` on X: B's store is seeded from a signed snapshot of X (it held only the older template).
    await m.base(X).service!.shipper.seed(B);
    m.queueRemote(X, OUTBOX_2);
    await m.advance(30_000);
    assert.equal(m.sends('outbox', X), 2, 'X sent the queued request (and the one from before the fixture)');
    const shippedOffset = m.telegramOffset(X);
    assert.ok(shippedOffset && shippedOffset > 1);
    assert.equal(m.telegramOffset(B, STANDBY_DB_FILE), shippedOffset, 'the standby is current before the partition');

    m.partition = [[X], [B]];
    await m.advance(90_000);
    assert.equal(m.state(X)?.replicationMode, 'fenced');
    // X polled Telegram until it fenced; those offsets never reached B (Telegram's own confirmation covers them).
    assert.ok(m.telegramOffset(X)! > shippedOffset);

    const records = [
      m.sign({ kind: 'revoke', baseId: X, publicKey: m.base(X).publicKey }),
      m.sign({ kind: 'main', baseId: B, coordinatorEpoch: 3 }),
    ];
    m.importRecords(B, records);
    const res = await m.promote(B);
    // Both sends are settled in B's state: nothing is parked as uncertain, and nothing is sent again.
    assert.ok('quarantined' in res && res.newEpoch === 3 && res.quarantined === 0);
    // The promoted main resumes Telegram from the offset X had shipped (the channel hydrates it on activation).
    assert.equal(coordinatorTelegramContinuity(m.base(B).db).load()?.offset, shippedOffset);
    await m.advance(30_000);
    assert.deepEqual(m.holders(), [B]);
    assert.equal(m.sends('outbox', B), 0);
    assert.equal(m.base(B).service!.store.outbox().length, 0);
  });
});
