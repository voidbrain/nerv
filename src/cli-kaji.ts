import { join } from 'node:path';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { Store } from './store.ts';

import { databasePath, setKajiOffers, setKajiSeat, pinKajiRoot, readConfig } from './config.ts';
import { DatabaseSync } from 'node:sqlite';

import {
  ROOT_KEY_FILE,
  keyIdentity,
  Registry,
  baseKey,
  enrolmentArgs,
  fingerprint,
  signRecord,
  unlockRootKey,
  type SignedRecord,
} from './kaji.ts';

import { builtinTools } from './executors.ts';
import {
  RelocationRefusedError,
  STANDBY_DB_FILE,
  drainCoordinator,
  ranOrAckedCoordinatorEpoch,
  signDrainReceipt,
} from './coordinator-relocation.ts';
import { adoptLegacyCoordinator } from './coordinator-adopt.ts';
import { registryPort } from './coordinator-epoch.ts';
import { addRegistryRecords, readRelocationBundle, type RelocationBundle } from './coordinator-relocation-bundle.ts';
import { KajiLink, type EpochPushReply } from './kaji-link.ts';
import {
  installedPromotionService,
  promoteCoordinator,
  type PromotionClock,
  type PromotionServiceControl,
} from './coordinator-promote.ts';
import { nextLeaseSeq, type LeaseRenewRequest, type LeaseRenewResult } from './coordinator-lease.ts';
import {
  ReplicationShipper,
  formatReplicationStatus,
  replicationStatus,
  type ShippingLink,
} from './coordinator-shipping.ts';
import { OFFER_NAME, toolName } from './mcp.ts';

/**
 * `nerv kaji promote` (F-016-T17): the new main side. Every safety input is read from verified records on this
 * base. The CLI runs it without opening a Store first (third review): opening one would create an empty
 * nerv.sqlite in the middle of an interrupted swap.
 */
export async function runKajiPromoteCommand(
  args: string[],
  home: string,
  config: ReturnType<typeof readConfig>,
  ctx: {
    flag: (name: string) => string | undefined;
    promotion?: {
      service?: PromotionServiceControl;
      clock?: PromotionClock;
      pushEpoch?: (baseId: string, records: SignedRecord[]) => Promise<EpochPushReply>;
    };
  },
): Promise<void> {
  if (args.includes('--confirm-old-host-down'))
    throw new RelocationRefusedError(
      'old_host_unconfirmed',
      "The owner's word does not bound the old main: revoke it with the root key (the Key of Nebuchadnezzar from its offline backup: kaji relocate BASE-ID FILE --revoke OLD-ID) and run kaji promote --relocation FILE here.",
    );
  const receipt = ctx.flag('--drain-receipt');
  // B-124: the records `kaji relocate` wrote; stored and pushed only after this promote's checks pass.
  const relocationFile = ctx.flag('--relocation');
  const relocation = relocationFile ? readRelocationBundle(relocationFile, config.kaji?.root).records : undefined;
  const res = await promoteCoordinator({
    ...(relocation ? { relocation } : {}),
    home,
    rootPublicKey: config.kaji?.root,
    ownPublicKey: baseKey(home).publicKey,
    ...(receipt ? { drainReceiptFile: receipt } : {}),
    service: ctx.promotion?.service ?? installedPromotionService(home),
    ...(ctx.promotion?.clock ? { clock: ctx.promotion.clock } : {}),
    log: (line) => console.log(line),
    // F-016-T18: a client on the signed Kaji line that never listens; it reads the registry when it pushes
    // (after any interrupted swap was finished, so the store exists).
    pushEpoch:
      ctx.promotion?.pushEpoch ??
      (async (id, records) => {
        const db = new DatabaseSync(databasePath(home));
        try {
          return await new KajiLink({
            ...(config.kaji?.root
              ? { trust: { root: config.kaji.root, required: config.kaji.rootBinding === true } }
              : {}),
            baseId: config.base.id,
            key: baseKey(home).privateKey,
            publicKey: baseKey(home).publicKey,
            registry: registryPort(new Registry(db, config.kaji?.root)),
            log: () => {},
          }).pushEpoch(id, records);
        } finally {
          db.close();
        }
      }),
  });
  console.log(
    'reinstated' in res
      ? `Took back this base's coordinator state at epoch ${res.newEpoch} (from ${res.previousEpoch}): no base ran or acked a later epoch. ` +
          (res.leaseExpiresAt
            ? 'Sole coordinator: lease armed.'
            : 'Effects resume when the standby acks the new epoch (within a lease renewal, 15 s).')
      : 'resumed' in res
        ? `Promotion at coordinator epoch ${res.newEpoch} finished; the service is running again.`
        : `Promoted to coordinator epoch ${res.newEpoch} (from ${res.previousEpoch}, ${res.source}); ${res.quarantined} uncertain outbox row(s) parked for review. ` +
          (res.leaseExpiresAt
            ? 'Sole coordinator: lease armed.'
            : 'Effects wait for the first standby-acked lease (name a standby: kaji standby BASE-ID).'),
  );
}

export async function runKajiCommand(
  args: string[],
  home: string,
  store: Store,
  config: ReturnType<typeof readConfig>,
  ctx: {
    readSecret: (prompt: string) => Promise<string>;
    flag: (name: string) => string | undefined;
    /** Tests inject the service control and clock of `kaji promote`. */
    promotion?: {
      service?: PromotionServiceControl;
      clock?: PromotionClock;
      pushEpoch?: (baseId: string, records: SignedRecord[]) => Promise<{ maxSeenCoordinatorEpoch: number }>;
    };
    /** Tests inject the lease renewal `kaji standby` probes with. */
    renewLease?: (baseId: string, req: LeaseRenewRequest) => Promise<LeaseRenewResult>;
    /** Tests inject the line `kaji standby` seeds and `kaji drain` ships the final batch over. */
    shippingLink?: ShippingLink;
  },
): Promise<void> {
  const registry = new Registry(store.db, config.kaji?.root);
  const me = baseKey(home).publicKey;
  // F-016-T18: a client on the signed Kaji line (it never listens) for commands that push owner-signed records.
  const kajiClient = () =>
    new KajiLink({
      ...(config.kaji?.root ? { trust: { root: config.kaji.root, required: config.kaji.rootBinding === true } } : {}),
      baseId: config.base.id,
      key: baseKey(home).privateKey,
      publicKey: me,
      registry: registryPort(new Registry(store.db, config.kaji?.root)),
      log: () => {},
    });
  // F-016-T20: seeding a standby and the drain's final batch go over the same line as serve's shipper.
  let client: KajiLink | undefined;
  const shipper = (baseId = config.base.id) =>
    new ReplicationShipper({
      db: store.db,
      baseId,
      root: config.kaji?.root ?? '',
      privateKey: () => baseKey(home).privateKey,
      // The Kaji client is built only when a batch or seed is sent (a drain with no standby sends none).
      link: ctx.shippingLink ?? {
        replicate: (id, batch, lease) => (client ??= kajiClient()).replicate(id, batch, lease),
        seedStandby: (id, frame, epoch, lease) => (client ??= kajiClient()).seedStandby(id, frame, epoch, lease),
      },
    });
  const [sub] = args;
  const unlock = async () => {
    const path = ctx.flag('--key') ?? join(home, ROOT_KEY_FILE);
    if (!existsSync(path))
      throw new Error(`No key file at ${path}: enrol on the base that holds the Key, or pass --key PATH.`);
    const root = unlockRootKey(
      readFileSync(path, 'utf8'),
      await ctx.readSecret('Passphrase for the Key of Nebuchadnezzar: '),
    );
    if (config.kaji?.root && keyIdentity(root.publicKey) !== keyIdentity(config.kaji.root))
      throw new Error('This key file does not match the root pinned on this base.');
    return root;
  };
  if (sub === 'enrol') {
    // Every argument is checked before the passphrase is asked for.
    const e = enrolmentArgs(args[1], args[2], args[3], args[4], me);
    const root = await unlock();
    const rec = signRecord(root.privateKey, {
      kind: 'enrol',
      serial: registry.nextSerial(),
      baseId: e.baseId,
      name: e.name,
      publicKey: e.publicKey,
      address: e.address,
      issued: new Date().toISOString(),
    });
    new Registry(store.db, root.publicKey).add(rec);
    console.log(`Enrolled ${e.baseId} · ${e.name} at ${e.address} (key ${fingerprint(e.publicKey)}).`);
  } else if (sub === 'revoke') {
    const id = (args[1] ?? '').toUpperCase();
    const entry = registry.bases().find((b) => b.baseId === id && b.status === 'enrolled');
    if (!entry) throw new Error('No enrolled base with that id (see kaji list).');
    const root = await unlock();
    new Registry(store.db, root.publicKey).add(
      signRecord(root.privateKey, {
        kind: 'revoke',
        serial: registry.nextSerial(),
        baseId: id,
        publicKey: entry.publicKey,
        issued: new Date().toISOString(),
      }),
    );
    console.log(`Revoked ${id}: its key is refused from now on; re-enrolling it needs a new base key.`);
  } else if (sub === 'seat') {
    // Phase 2: how another base's Casper votes on this base's actions. shadow: shown, never counted; veto: may stop it; off.
    const [id, mode] = [(args[1] ?? '').toUpperCase(), args[2]];
    const seats = config.kaji?.seats ?? {};
    if (!id) {
      const others = registry.bases().filter((b) => b.status === 'enrolled' && b.publicKey !== me);
      console.log(
        others.length
          ? others.map((b) => `${b.baseId.padEnd(8)} ${b.name.padEnd(16)} ${seats[b.baseId] ?? 'shadow'}`).join('\n')
          : 'No other base enrolled.',
      );
      return;
    }
    if (!['shadow', 'veto', 'off'].includes(mode ?? '')) throw new Error('Usage: kaji seat BASE-ID shadow|veto|off');
    if (!registry.bases().some((b) => b.baseId === id && b.status === 'enrolled'))
      throw new Error('No enrolled base with that id (see kaji list).');
    setKajiSeat(home, id, mode as 'shadow' | 'veto' | 'off');
    console.log(
      mode === 'veto'
        ? `${id}'s Casper now votes on this base's actions, veto-only: its reject stops an action, its approve adds nothing.`
        : mode === 'shadow'
          ? `${id}'s Casper votes in shadow: shown on cards, never counted.`
          : `${id}'s Casper is not asked.`,
    );
  } else if (sub === 'offer') {
    // Slice 3b: the actions this base lets the main base run here; each still passes this base's own gate.
    // F-021-T04: a granted MCP tool can be offered too; it runs only while its grant still matches the tool.
    const names = args.slice(1);
    const offerable = [
      ...builtinTools.map((t) => t.name).filter((n) => n !== 'kaji.run'),
      ...(config.tools?.grants ?? [])
        .filter((g) => g.eva !== '03')
        .map((g) => toolName(g.server, g.tool))
        .filter((n) => OFFER_NAME.test(n)),
    ];
    if (!names.length) {
      const o = config.kaji?.offers ?? [];
      console.log(
        o.length
          ? `This base offers: ${o.join(', ')}`
          : 'This base offers nothing to the main base. Offer actions with: kaji offer reminders.add reminders.list (or: kaji offer none).',
      );
      return;
    }
    const list = names.length === 1 && names[0] === 'none' ? [] : names;
    const bad = list.filter((n) => !offerable.includes(n));
    if (bad.length)
      throw new Error(`Not an action this base can offer: ${bad.join(', ')}. Offerable: ${offerable.join(', ')}.`);
    setKajiOffers(home, [...new Set(list)]);
    console.log(
      list.length
        ? `This base now offers: ${list.join(', ')}. The main base sees it at the next heartbeat; restart is not needed.`
        : 'This base now offers nothing to the main base.',
    );
  } else if (sub === 'main') {
    // The owner names the main base (F-036): Aoba there is the one channel while the line is up. Signed by the Key.
    const id = (args[1] ?? '').toUpperCase();
    if (!id) {
      console.log(
        registry.main()
          ? `Main base: ${registry.main()}`
          : 'No main base named yet: kaji main BASE-ID (on the base that holds the Key).',
      );
      return;
    }
    if (!registry.bases().some((b) => b.baseId === id && b.status === 'enrolled'))
      throw new Error('No enrolled base with that id (see kaji list).');
    // #734 review (B-124): once a coordinator has moved, or runs here, a stored main record stops it unchecked.
    const held = store.coordinatorFencingState();
    // #734 re-check: the running main named again, or a revoked newest main, is refused the same way.
    // B-172 review: an adopted first coordinator (state at epoch 1) is moved with kaji relocate too.
    if (registry.mainEpoch() >= 2 || held !== undefined)
      throw new Error(
        `The main record is at coordinator epoch ${registry.mainEpoch()}${registry.main() ? ` (${registry.main()})` : ''}: move it with kaji relocate ${id} FILE (then kaji promote --relocation FILE on ${id}). kaji main names the first main only.`,
      );
    const root = await unlock();
    new Registry(store.db, root.publicKey).add(
      signRecord(root.privateKey, {
        kind: 'main',
        serial: registry.nextSerial(),
        coordinatorEpoch: registry.nextMainEpoch(),
        baseId: id,
        issued: new Date().toISOString(),
      }),
    );
    console.log(
      `Main base: ${id}. While it is online, the other bases send their cards, reminders and briefs through its Aoba and keep their own bots quiet.`,
    );
  } else if (sub === 'relocate') {
    // F-016-T07: the owner moves the coordinator; never automatic. --revoke names a lost base to revoke first.
    // B-124: the signed records go to a file, never into a registry or over the line: any registry holding them
    // hands them to every base (heartbeat sync), which stops the running main before the target is checked.
    const id = (args[1] ?? '').toUpperCase();
    const file = args[2];
    const lost = ctx.flag('--revoke')?.toUpperCase();
    const enrolled = registry.bases().filter((b) => b.status === 'enrolled');
    if (!id) throw new Error('Usage: kaji relocate BASE-ID [FILE] [--revoke LOST-BASE-ID]');
    if (!enrolled.some((b) => b.baseId === id)) throw new Error('No enrolled base with that id (see kaji list).');
    if (registry.main() === id) throw new Error(`${id} is already the main base.`);
    const lostEntry = lost ? enrolled.find((b) => b.baseId === lost) : undefined;
    if (lost && (!lostEntry || lost === id)) throw new Error('--revoke needs another enrolled base id.');
    if (!config.kaji?.root) throw new Error('No root pinned on this base.');
    const root = await unlock();
    let serial = registry.nextSerial();
    const added: SignedRecord[] = [];
    if (lostEntry)
      added.push(
        signRecord(root.privateKey, {
          kind: 'revoke',
          serial: serial++,
          baseId: lostEntry.baseId,
          publicKey: lostEntry.publicKey,
          issued: new Date().toISOString(),
        }),
      );
    const epoch = registry.nextMainEpoch();
    added.push(
      signRecord(root.privateKey, {
        kind: 'main',
        serial,
        coordinatorEpoch: epoch,
        baseId: id,
        issued: new Date().toISOString(),
      }),
    );
    const bundle: RelocationBundle = {
      root: config.kaji.root,
      ...(config.kaji.rootBinding ? { rootBinding: 1 as const } : {}),
      relocation: { baseId: id, coordinatorEpoch: epoch, ...(lostEntry ? { revoked: lostEntry.baseId } : {}) },
      records: [...registry.records(), ...added],
    };
    const out = JSON.stringify(bundle, null, 2) + '\n';
    const next =
      `Nothing was stored or pushed: copy the file to ${id} and run kaji promote --relocation FILE there` +
      (lostEntry
        ? ''
        : ' (planned: first kaji drain RECEIPT --relocation FILE on the old main, then add --drain-receipt RECEIPT)') +
      '. Promote asks every base first and only then tells them the new epoch.';
    if (file) {
      writeFileSync(file, out, { mode: 0o600 });
      console.log(
        `Signed main ${id} at coordinator epoch ${epoch}${lostEntry ? ` and revoked ${lostEntry.baseId}` : ''} into ${file}. ${next}`,
      );
    } else {
      process.stdout.write(out);
      console.error(`Signed main ${id} at coordinator epoch ${epoch}. ${next}`);
    }
  } else if (sub === 'drain') {
    // F-016-T07: planned relocation, old main side. Only after the owner signed a newer main record.
    const state = store.coordinatorFencingState();
    // #725 review: an interrupted drain left effects stopped; the owner returns the main to active.
    if (args.includes('--cancel')) {
      if (state?.replicationMode !== 'draining') throw new Error('No drain to cancel: this main is not draining.');
      store.db
        .prepare(
          "UPDATE coordinator_state SET replication_mode = 'active' WHERE id = 1 AND replication_mode = 'draining'",
        )
        .run();
      const named = registry.main();
      const self = registry.bases().find((b) => b.publicKey === me && b.status === 'enrolled');
      // F-016-T20 re-check: once the relocation is imported here the registry names the new main, so the
      // authority check keeps every coordinator effect off whatever the mode says.
      console.log(
        named && self && named !== self.baseId
          ? `Drain cancelled: the mode is active again, but this base's registry names ${named} at epoch ${registry.mainEpoch()}, so it runs no coordinator effects. The move goes on with a drain and kaji promote on ${named}.`
          : 'Drain cancelled: this main is active again (its lease keeper renews or fences it as before).',
      );
      return;
    }
    const self = registry.bases().find((b) => b.publicKey === me && b.status === 'enrolled');
    if (!state || !self) throw new Error('This base holds no coordinator state to drain.');
    // B-124: with --relocation the bundle's records are read as held, and stored only with the fence.
    const relocationFile = ctx.flag('--relocation');
    const relocation = relocationFile ? readRelocationBundle(relocationFile, config.kaji?.root) : undefined;
    const mainRecords = [...registry.records(), ...(relocation?.records ?? [])].filter((r) => r.body.kind === 'main');
    const newEpoch = Math.max(registry.mainEpoch(), relocation?.coordinatorEpoch ?? 0);
    if (newEpoch <= state.coordinatorEpoch)
      throw new Error(
        'Sign the relocation first (kaji relocate BASE-ID FILE) and pass it here (kaji drain RECEIPT --relocation FILE): draining now would leave no coordinator.',
      );
    const newMainBaseId = relocation && relocation.coordinatorEpoch === newEpoch ? relocation.baseId : registry.main();
    if (!newMainBaseId || newMainBaseId === self.baseId)
      throw new Error(
        'The newest main record names no other enrolled base: sign the relocation (kaji relocate BASE-ID).',
      );
    // F-016-T20: effects stop (draining) and the standby receives the final batch before the lease is given up,
    // so the receipt's final seq is what the standby holds. A standby that does not confirm it leaves this
    // main active: nothing is drained. #725 review: a drain interrupted in `draining` flushes again on a re-run,
    // and a change committed after the flush (an effect in flight) refuses the fence: it is shipped and tried again.
    const drainNow = () =>
      drainCoordinator(store.db, {
        baseId: self.baseId,
        coordinatorEpoch: state.coordinatorEpoch,
        newMainBaseId,
        newEpoch,
        registryMains: mainRecords.map((r) => ({
          baseId: r.body.baseId,
          coordinatorEpoch: r.body.coordinatorEpoch ?? 0,
        })),
        ranOrAckedEpoch: ranOrAckedCoordinatorEpoch(store.db, join(home, STANDBY_DB_FILE)),
        ...(relocation ? { commit: (db) => void addRegistryRecords(db, config.kaji?.root, relocation.records) } : {}),
      });
    const flushing =
      (state.replicationMode === 'active' || state.replicationMode === 'draining') && !!config.kaji?.root;
    let receipt: ReturnType<typeof drainCoordinator> | undefined;
    for (let attempt = 0; !receipt; attempt += 1) {
      if (flushing) {
        const flushed = await shipper(self.baseId).flush();
        if (flushed.headSeq)
          console.log(`Final batch: the standby holds seq ${flushed.ackedSeq} of ${flushed.headSeq}.`);
      }
      try {
        receipt = drainNow();
      } catch (err) {
        if (!flushing || attempt >= 2 || !/not yet replicated/.test(err instanceof Error ? err.message : '')) throw err;
      }
    }
    const out = JSON.stringify(signDrainReceipt(baseKey(home).privateKey, receipt), null, 2) + '\n';
    if (args[1]) {
      writeFileSync(args[1], out);
      console.log(
        `Drained epoch ${receipt.coordinatorEpoch} at seq ${receipt.finalSeq} for ${newMainBaseId} at epoch ${receipt.newEpoch}; receipt written to ${args[1]}.`,
      );
    } else process.stdout.write(out);
  } else if (sub === 'adopt') {
    // B-172: a main from before F-016 takes its own store as the first coordinator (epoch 1).
    const res = await adoptLegacyCoordinator({
      db: store.db,
      home,
      rootPublicKey: config.kaji?.root,
      ownPublicKey: me,
      sign: async (body) => signRecord((await unlock()).privateKey, body),
      push: (id, records) => kajiClient().pushEpoch(id, records),
    });
    const others = [...res.told, ...res.notTold].sort();
    const told =
      (res.told.length ? ` Told ${res.told.join(', ')} the epoch.` : '') +
      (res.notTold.length
        ? ` Not reached now: ${res.notTold.join(', ')} (the next registry sync carries it, or run kaji adopt again).`
        : '');
    const next = others.length
      ? ` Next: name a standby with kaji standby ${res.told[0] ?? others[0]}.`
      : ' No other base is enrolled: it runs as the sole coordinator.';
    console.log(
      'already' in res
        ? `This base already holds coordinator state at epoch ${res.epoch} (active): nothing to adopt.${told}${next}`
        : `Backup: ${res.backup}\n` +
            `Adopted this base's store as coordinator epoch 1 (active, no lease yet)${res.signed ? `; signed main ${config.base.id} at coordinator epoch 1` : ''}.${told}${next}`,
    );
  } else if (sub === 'promote') {
    await runKajiPromoteCommand(args, home, config, ctx);
  } else if (sub === 'standby') {
    // F-016-T16 review: the owner names the base the active main renews its lease through.
    const id = (args[1] ?? '').toUpperCase();
    const state = store.coordinatorFencingState();
    if (!id) {
      const row = state
        ? (store.db.prepare('SELECT standby_base_id FROM coordinator_state WHERE id = 1').get() as {
            standby_base_id: string | null;
          })
        : undefined;
      console.log(row?.standby_base_id ? `Standby: ${row.standby_base_id}` : 'No standby named.');
      // F-016-T20: the seed and how far the standby is behind this main.
      if (state && state.replicationMode !== 'standby')
        console.log(formatReplicationStatus(replicationStatus(store.db)));
      return;
    }
    const entry = registry.bases().find((b) => b.baseId === id && b.status === 'enrolled');
    if (!entry) throw new Error('No enrolled base with that id (see kaji list).');
    if (keyIdentity(entry.publicKey) === keyIdentity(me))
      throw new Error('Name another enrolled base: a coordinator never acks its own lease.');
    if (!state || (state.replicationMode !== 'active' && state.replicationMode !== 'fenced'))
      throw new Error('This base holds no coordinator state to name a standby for.');
    // F-016-T16 re-review: only a base that acks from a standby store may be named; on an active main one lease
    // renewal proves it. A fenced main never probes (that would move the standby's ack history for a main that
    // holds no lease); its keeper re-arms only through an ack, which only a standby store gives.
    if (state.replicationMode === 'fenced') {
      store.db.prepare('UPDATE coordinator_state SET standby_base_id = ? WHERE id = 1').run(id);
      console.log(`Standby: ${id}. This main is fenced: it re-arms only when ${id} acks from its standby store.`);
      return;
    }
    const renew =
      ctx.renewLease ??
      ((base: string, req: LeaseRenewRequest) =>
        new KajiLink({
          ...(config.kaji?.root
            ? { trust: { root: config.kaji.root, required: config.kaji.rootBinding === true } }
            : {}),
          baseId: config.base.id,
          key: baseKey(home).privateKey,
          publicKey: me,
          registry: {
            bases: async () => registry.bases(),
            records: async () => registry.records(),
            add: async () => 0,
            seen: async () => {},
            lastSeen: async () => ({}),
            main: async () => registry.main(),
          },
          log: () => {},
        }).renewLease(base, req));
    const probeOnce = async () => {
      const leaseSeq = nextLeaseSeq(store.db);
      const result = await renew(id, { coordinatorEpoch: state.coordinatorEpoch, leaseSeq }).catch(
        (err: unknown): LeaseRenewResult => ({
          ok: false,
          reason: 'not_standby',
          error: err instanceof Error ? err.message : 'unreachable',
        }),
      );
      return { result, leaseSeq };
    };
    let { result: probe, leaseSeq } = await probeOnce();
    // F-016-T20: a base without a standby store is seeded from a signed snapshot of this main, then probed again.
    if (!probe.ok && probe.reason === 'not_standby' && config.kaji?.root) {
      const { headSeq } = await shipper()
        .seed(id)
        .catch((err: unknown) => {
          throw new Error(
            `${id} holds no standby store and could not be seeded (${err instanceof Error ? err.message : 'unreachable'}).`,
          );
        });
      console.log(`Seeded ${id}'s standby store from this main at seq ${headSeq}.`);
      ({ result: probe, leaseSeq } = await probeOnce());
    }
    if (!probe.ok || probe.standbyBaseId !== id || probe.ackSeq !== leaseSeq)
      throw new Error(
        `${id} did not ack a lease from a standby store (${probe.ok ? 'mismatched ack' : probe.reason}): name a base that holds the replicated standby store.`,
      );
    store.db.prepare('UPDATE coordinator_state SET standby_base_id = ? WHERE id = 1').run(id);
    console.log(`Standby: ${id}. The lease renews through it from the next renewal (every 15 s).`);
  } else if (sub === 'lease-rearm') {
    const confirmSole = args.includes('--confirm-sole-coordinator');
    const ownPub = baseKey(home).publicKey;
    const enrolledOthers = registry.bases().filter((b) => b.status === 'enrolled' && b.publicKey !== ownPub);
    const epoch = store.coordinatorFencingState()?.coordinatorEpoch ?? registry.mainEpoch();
    const applied = store.rearmSoleCoordinatorLease({
      coordinatorEpoch: epoch,
      hasEnrolledStandby: enrolledOthers.length > 0,
      confirmSoleCoordinator: confirmSole,
    });
    console.log(
      `Re-armed sole coordinator lease at epoch ${epoch} until ${new Date(applied.leaseExpiresAt).toISOString()}.`,
    );
  } else if (sub === 'list' || !sub) {
    const bases = registry.bases();
    if (!config.kaji?.root) console.log('No root pinned yet: key init (main base) or kaji import --root FINGERPRINT.');
    else {
      const main = registry.main();
      console.log(
        `Root ${fingerprint(config.kaji.root)}\n` +
          (bases.length
            ? bases
                .map(
                  (b) =>
                    `${b.baseId.padEnd(8)} ${b.name.padEnd(16)} ${b.address.padEnd(24)} ${b.status}${b.publicKey === me ? '  (this base)' : ''}${b.baseId === main ? '  (main)' : ''}`,
                )
                .join('\n')
            : 'No bases enrolled yet.'),
      );
    }
  } else if (sub === 'export') {
    const bundle =
      JSON.stringify(
        {
          root: config.kaji?.root,
          ...(config.kaji?.rootBinding ? { rootBinding: 1 } : {}),
          records: registry.records(),
        },
        null,
        2,
      ) + '\n';
    if (!config.kaji?.root) throw new Error('Nothing to export: no root pinned.');
    if (args[1]) {
      writeFileSync(args[1], bundle);
      console.log(`Wrote ${registry.records().length} signed record(s) to ${args[1]}.`);
    } else process.stdout.write(bundle);
  } else if (sub === 'import') {
    // The root is pinned only when the owner confirms its fingerprint, read on the main base: no trust on first use.
    const file = args[1];
    const expect = ctx.flag('--root');
    if (!file) throw new Error('Usage: kaji import FILE --root FINGERPRINT');
    const bundle = JSON.parse(readFileSync(file, 'utf8')) as {
      root: string;
      rootBinding?: number;
      records: SignedRecord[];
      relocation?: { baseId?: string };
    };
    // B-124: a relocation bundle held in a registry spreads to every base and stops the running main unchecked.
    if (bundle.relocation)
      throw new Error(
        `This is a relocation bundle: run kaji promote --relocation FILE on ${bundle.relocation.baseId ?? 'the new main'} (planned: kaji drain RECEIPT --relocation FILE on the old main first). It is never imported.`,
      );
    if (bundle.rootBinding !== undefined && bundle.rootBinding !== 1)
      throw new Error('Unsupported root-binding version.');
    if (!config.kaji?.root) {
      const given = (expect ?? '').toLowerCase();
      const where =
        'the "Root …" line of nerv kaji list on the base that holds the Key of Nebuchadnezzar (also printed by key init)';
      if (!given) throw new Error(`Give --root with the root fingerprint: ${where}.`);
      if (given === fingerprint(me))
        throw new Error(
          `That is this base's own fingerprint (from base pubkey). --root needs the root fingerprint: ${where}.`,
        );
      // The file's own fingerprint is never printed: the owner compares what the main base shows with the file.
      if (fingerprint(bundle.root) !== given)
        throw new Error(
          `The root fingerprint does not match the one this file was signed with. Check ${where}; if they really differ, the file is not from your Key: do not import it.`,
        );
      pinKajiRoot(home, bundle.root, bundle.rootBinding === 1);
    } else if (keyIdentity(bundle.root) !== keyIdentity(config.kaji.root))
      throw new Error('This file is signed by a different root than the one pinned here.');
    else if (bundle.rootBinding === 1 && !config.kaji.rootBinding) pinKajiRoot(home, bundle.root, true);
    const reg = new Registry(store.db, bundle.root);
    let added = 0;
    for (const r of bundle.records) if (reg.add(r) === 'added') added++;
    console.log(
      `Imported ${added} new record(s); ${reg.bases().filter((b) => b.status === 'enrolled').length} base(s) enrolled.`,
    );
  } else
    throw new Error(
      'Usage: kaji enrol | revoke | main [BASE-ID] | relocate BASE-ID [FILE] [--revoke LOST-ID] | drain [FILE] [--relocation BUNDLE] [--cancel] | standby [BASE-ID] | adopt | promote [--drain-receipt FILE] [--relocation BUNDLE] | offer [ACTION…|none] | seat [BASE-ID shadow|veto|off] | list | export [FILE] | import FILE --root FINGERPRINT',
    );
  return;
}
