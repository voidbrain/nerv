import { join } from 'node:path';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { Store } from './store.ts';

import { setKajiOffers, setKajiSeat, pinKajiRoot, readConfig } from './config.ts';

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
import { drainCoordinator, signDrainReceipt } from './coordinator-relocation.ts';
import { nextLeaseSeq, type LeaseRenewRequest, type LeaseRenewResult } from './coordinator-lease.ts';
import { KajiLink } from './kaji-link.ts';
import { OFFER_NAME, toolName } from './mcp.ts';

export async function runKajiCommand(
  args: string[],
  home: string,
  store: Store,
  config: ReturnType<typeof readConfig>,
  ctx: {
    readSecret: (prompt: string) => Promise<string>;
    flag: (name: string) => string | undefined;
    /** Tests inject the lease renewal `kaji standby` probes with. */
    renewLease?: (baseId: string, req: LeaseRenewRequest) => Promise<LeaseRenewResult>;
  },
): Promise<void> {
  const registry = new Registry(store.db, config.kaji?.root);
  const me = baseKey(home).publicKey;
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
    const id = (args[1] ?? '').toUpperCase();
    const lost = ctx.flag('--revoke')?.toUpperCase();
    const enrolled = registry.bases().filter((b) => b.status === 'enrolled');
    if (!id) throw new Error('Usage: kaji relocate BASE-ID [--revoke LOST-BASE-ID]');
    if (!enrolled.some((b) => b.baseId === id)) throw new Error('No enrolled base with that id (see kaji list).');
    if (registry.main() === id) throw new Error(`${id} is already the main base.`);
    const lostEntry = lost ? enrolled.find((b) => b.baseId === lost) : undefined;
    if (lost && (!lostEntry || lost === id)) throw new Error('--revoke needs another enrolled base id.');
    const root = await unlock();
    const signed = new Registry(store.db, root.publicKey);
    if (lostEntry)
      signed.add(
        signRecord(root.privateKey, {
          kind: 'revoke',
          serial: signed.nextSerial(),
          baseId: lostEntry.baseId,
          publicKey: lostEntry.publicKey,
          issued: new Date().toISOString(),
        }),
      );
    const epoch = signed.nextMainEpoch();
    signed.add(
      signRecord(root.privateKey, {
        kind: 'main',
        serial: signed.nextSerial(),
        coordinatorEpoch: epoch,
        baseId: id,
        issued: new Date().toISOString(),
      }),
    );
    console.log(
      `Signed main ${id} at coordinator epoch ${epoch}${lostEntry ? ` and revoked ${lostEntry.baseId}` : ''}. ` +
        'Export these records (kaji export) and import them on every surviving base before promotion; ' +
        'on the old main, if reachable, run kaji drain and hand its receipt to the new main.',
    );
  } else if (sub === 'drain') {
    // F-016-T07: planned relocation, old main side. Only after the owner signed a newer main record.
    const state = store.coordinatorFencingState();
    const self = registry.bases().find((b) => b.publicKey === me && b.status === 'enrolled');
    if (!state || !self) throw new Error('This base holds no coordinator state to drain.');
    if (registry.mainEpoch() <= state.coordinatorEpoch)
      throw new Error(
        'Sign the relocation first (kaji relocate BASE-ID) and import it here: draining now would leave no coordinator.',
      );
    const newMainBaseId = registry.main();
    if (!newMainBaseId || newMainBaseId === self.baseId)
      throw new Error(
        'The newest main record names no other enrolled base: sign the relocation (kaji relocate BASE-ID).',
      );
    const receipt = drainCoordinator(store.db, {
      baseId: self.baseId,
      coordinatorEpoch: state.coordinatorEpoch,
      newMainBaseId,
      newEpoch: registry.mainEpoch(),
    });
    const out = JSON.stringify(signDrainReceipt(baseKey(home).privateKey, receipt), null, 2) + '\n';
    if (args[1]) {
      writeFileSync(args[1], out);
      console.log(
        `Drained epoch ${receipt.coordinatorEpoch} at seq ${receipt.finalSeq} for ${newMainBaseId} at epoch ${receipt.newEpoch}; receipt written to ${args[1]}.`,
      );
    } else process.stdout.write(out);
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
    const leaseSeq = nextLeaseSeq(store.db);
    const probe = await renew(id, { coordinatorEpoch: state.coordinatorEpoch, leaseSeq }).catch(
      (err: unknown): LeaseRenewResult => ({
        ok: false,
        reason: 'not_standby',
        error: err instanceof Error ? err.message : 'unreachable',
      }),
    );
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
    };
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
      'Usage: kaji enrol | revoke | main [BASE-ID] | relocate BASE-ID [--revoke LOST-ID] | drain [FILE] | standby [BASE-ID] | offer [ACTION…|none] | seat [BASE-ID shadow|veto|off] | list | export [FILE] | import FILE --root FINGERPRINT',
    );
  return;
}
