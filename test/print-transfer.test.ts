import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KajiLink, MAX_PART_TRANSFER_BODY, type RegistryPort } from '../src/kaji-link.ts';
import { Registry, createRootKey, signRecord, unlockRootKey, type RegistryBody } from '../src/kaji.ts';
import { execute } from '../src/executors.ts';
import { MAX_PART_FILE_BYTES, type PrintPartReply } from '../src/print-job.ts';
import {
  completeRemotePrint,
  receivePartTransfer,
  validatePrintsConfig,
  type PartTransfer,
  type PartTransferSend,
} from '../src/print-transfer.ts';
import { execSlicerAsync, type SlicerExecAsyncFn } from '../src/slicer.ts';
import { Store } from '../src/store.ts';

// F-121-T04: the Mac (NERV-01) holds the part library, Tabgha (NERV-02) slices. Invented parts and profiles only.
const PROFILES = [{ name: 'Test TPU 0.4', machineProfile: 'test-machine.json', materialProfile: 'test-tpu.json' }];
const FOOT = 'solid foot\nendsolid foot\n';
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

const root = (() => {
  const f = createRootKey('a long test passphrase');
  return unlockRootKey(f.file, 'a long test passphrase');
})();
let serial = 0;
const rec = (body: Omit<RegistryBody, 'serial' | 'issued'>) =>
  signRecord(root.privateKey, { ...body, serial: ++serial, issued: new Date().toISOString() } as RegistryBody);
const keys = () => {
  const k = generateKeyPairSync('ed25519');
  return {
    privateKey: k.privateKey,
    publicKey: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
};
const freePort = async () => {
  const s = createServer();
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((d) => s.close(() => d()));
  return p;
};
const port = (reg: Registry): RegistryPort => ({
  bases: async () => reg.bases(),
  records: async () => reg.records(),
  add: async () => 0,
  seen: async (u) => reg.seen(u),
  lastSeen: async () => reg.lastSeen(),
});

interface Bases {
  mac: string;
  tabgha: string;
  store: Store;
  la: KajiLink;
  lb: KajiLink;
  /** Every message the Mac sent, as it went on the wire. */
  sent: PartTransfer[];
  send: PartTransferSend;
  slicerCalls: string[][];
  print: (phrase: string) => Promise<PrintPartReply>;
  done: () => Promise<void>;
}

/** Two enrolled bases on loopback with their own data homes; Tabgha accepts part files from the Mac. */
async function bases(
  options: { accept?: string[]; maxBytes?: number; profiles?: typeof PROFILES; exec?: SlicerExecAsyncFn } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-print-transfer-')),
    mac = join(dir, 'mac'),
    tabgha = join(dir, 'tabgha');
  mkdirSync(join(mac, 'prints', 'kite-5'), { recursive: true });
  mkdirSync(tabgha);
  writeFileSync(join(mac, 'config.json'), JSON.stringify({ prints: { slicer: 'NERV-02' } }));
  // The Mac has no slicer: its own allowlist is only what the fleet checks new parts against.
  writeFileSync(join(mac, 'slicer-profiles.json'), JSON.stringify(PROFILES));
  writeFileSync(join(tabgha, 'slicer-profiles.json'), JSON.stringify(options.profiles ?? PROFILES));
  writeFileSync(join(mac, 'prints', 'kite-5', 'foot.stl'), FOOT);
  const store = new Store(':memory:', undefined, { home: mac });
  store.slicerExec = () => {
    throw new Error('The Mac must not slice: slicing runs on NERV-02.');
  };
  store.fleet.importFleet(
    {
      version: 1,
      models: [
        {
          name: 'Kite 5.1',
          parts: [
            {
              name: 'motor foot',
              aliases: ['piedini', 'feet'],
              file: 'kite-5/foot.stl',
              count: 4,
              profile: 'Test TPU 0.4',
            },
          ],
        },
      ],
      drones: [{ name: 'Wisp', model: 'Kite 5.1', parts: [] }],
    },
    undefined,
    { slicerProfiles: PROFILES.map((p) => p.name) },
  );
  const slicerCalls: string[][] = [];
  const fake: SlicerExecAsyncFn = (bin, args) => {
    slicerCalls.push([bin, ...args]);
    writeFileSync(args[args.indexOf('--export-3mf') + 1]!, 'PK-sliced');
    return 'estimated printing time: 42m\ntotal filament used [g] = 7.5\n';
  };
  const A = keys(),
    B = keys(),
    pa = await freePort(),
    pb = await freePort();
  const sa = new Store(':memory:'),
    sb = new Store(':memory:'),
    ra = new Registry(sa.db, root.publicKey),
    rb = new Registry(sb.db, root.publicKey);
  for (const r of [
    rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Neo Tokyo-3', publicKey: A.publicKey, address: `127.0.0.1:${pa}` }),
    rec({ kind: 'enrol', baseId: 'NERV-02', name: 'Tabgha', publicKey: B.publicKey, address: `127.0.0.1:${pb}` }),
  ]) {
    ra.add(r);
    rb.add(r);
  }
  const la = new KajiLink({
    baseId: 'NERV-01',
    key: A.privateKey,
    publicKey: A.publicKey,
    registry: port(ra),
    log: () => {},
  });
  const lb = new KajiLink({
    baseId: 'NERV-02',
    key: B.privateKey,
    publicKey: B.publicKey,
    registry: port(rb),
    log: () => {},
    onPartTransfer: async (from, body) =>
      receivePartTransfer(tabgha, options.accept ?? ['NERV-01'], from, body, {
        exec: options.exec ?? fake,
        ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
      }),
  });
  const sent: PartTransfer[] = [];
  const send: PartTransferSend = (base, message) => {
    sent.push(message);
    return la.sendPartTransfer(base, message);
  };
  const b: Bases = {
    mac,
    tabgha,
    store,
    la,
    lb,
    sent,
    send,
    slicerCalls,
    print: async (phrase) => {
      const pending = execute(store, 'fleet.print', { phrase }) as PrintPartReply;
      assert.equal(pending.sliced, false, 'the Mac does not slice');
      assert.ok(pending.remote, `a remote slice is pending: ${pending.reply}`);
      return completeRemotePrint(mac, pending.remote, send);
    },
    done: async () => {
      await la.stop();
      await lb.stop();
      store.close();
      sa.close();
      sb.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return b;
}

const cacheFiles = (tabgha: string) =>
  existsSync(join(tabgha, 'prints-cache')) ? readdirSync(join(tabgha, 'prints-cache')) : [];

test('F-121-T04: the Mac sends the part over the Kaji line; Tabgha verifies, caches by hash and slices it', async () => {
  const b = await bases();
  try {
    await b.la.start(60_000);
    await b.lb.start(60_000);
    const reply = await b.print('stampa i piedini di Wisp');
    assert.equal(reply.sliced, true, reply.reply);
    assert.equal(reply.slicedOn, 'NERV-02');
    // Asked first without the file; sent once Tabgha said it does not have it.
    assert.deepEqual(
      b.sent.map((m) => m.content !== undefined),
      [false, true],
    );
    assert.deepEqual(b.sent[0]!.request.part, { file: 'kite-5/foot.stl', sha256: sha(FOOT), bytes: FOOT.length });
    // Tabgha wrote only its cache, named by the content hash, never the sender's path.
    assert.deepEqual(cacheFiles(b.tabgha), [`${sha(FOOT)}.stl`]);
    assert.equal(readFileSync(join(b.tabgha, 'prints-cache', `${sha(FOOT)}.stl`), 'utf8'), FOOT);
    assert.equal(existsSync(join(b.tabgha, 'prints')), false);
    assert.equal(b.slicerCalls.length, 1);
    assert.equal(b.slicerCalls[0]!.at(-1), join(b.tabgha, 'prints-cache', `${sha(FOOT)}.stl`));
    // The reply and the hand-off name Tabgha's sliced file; the hand-off runs on Tabgha, where Bambu Connect is.
    for (const text of ['kite-5/foot.stl', '4 prints', 'Test TPU 0.4', '42m', '7.5 g', 'NERV-02']) {
      assert.ok(reply.reply.includes(text), `${text} in: ${reply.reply}`);
    }
    assert.equal(reply.handoffBase, 'NERV-02');
    assert.equal(
      reply.handoff!.gcode3mfPath,
      join(b.tabgha, 'prints-out', `${sha(FOOT).slice(0, 16)}-test-tpu-0-4.gcode.3mf`),
    );
    assert.equal(reply.handoff!.repeats, 4);
  } finally {
    await b.done();
  }
});

test('F-121-T04: a file Tabgha already has is not sent again; a changed file is', async () => {
  const b = await bases();
  try {
    await b.la.start(60_000);
    await b.lb.start(60_000);
    assert.equal((await b.print('stampa i piedini di Wisp')).sliced, true);
    b.sent.length = 0;
    const again = await b.print('print the Kite feet');
    assert.equal(again.sliced, true, again.reply);
    assert.deepEqual(
      b.sent.map((m) => m.content !== undefined),
      [false],
      'a cache hit sends no file',
    );
    const changed = `${FOOT}% v2\n`;
    writeFileSync(join(b.mac, 'prints', 'kite-5', 'foot.stl'), changed);
    b.sent.length = 0;
    const edited = await b.print('stampa i piedini di Wisp');
    assert.equal(edited.sliced, true, edited.reply);
    assert.deepEqual(
      b.sent.map((m) => m.content !== undefined),
      [false, true],
    );
    assert.deepEqual(cacheFiles(b.tabgha).sort(), [`${sha(FOOT)}.stl`, `${sha(changed)}.stl`].sort());
    assert.equal(b.slicerCalls.length, 3);
  } finally {
    await b.done();
  }
});

test('F-121-T04: a tampered, oversized or unaccepted file is refused before anything is written', async () => {
  const b = await bases({ maxBytes: 64 });
  try {
    await b.la.start(60_000);
    await b.lb.start(60_000);
    const request = {
      version: 1 as const,
      part: { file: 'kite-5/foot.stl', sha256: sha(FOOT), bytes: FOOT.length },
      profileName: 'Test TPU 0.4',
      prints: 1,
    };
    const tampered = Buffer.from(FOOT.replace('foot', 'fool')).toString('base64');
    await assert.rejects(b.la.sendPartTransfer('NERV-02', { version: 1, request, content: tampered }), (e: Error) => {
      assert.equal((e as { code?: string }).code, 'EREFUSED');
      assert.equal((e as { status?: number }).status, 422);
      assert.match(e.message, /SHA-256/);
      return true;
    });
    // A file over the receiver's cap (64 bytes here, MAX_PART_FILE_BYTES in service) is refused by its size.
    const big = 'x'.repeat(100);
    await assert.rejects(
      b.la.sendPartTransfer('NERV-02', {
        version: 1,
        request: { ...request, part: { file: 'kite-5/foot.stl', sha256: sha(big), bytes: big.length } },
        content: Buffer.from(big).toString('base64'),
      }),
      (e: Error) => (e as { status?: number }).status === 413 && /larger than/.test(e.message),
    );
    // A sender path is never a cache name: a path outside the library is refused.
    await assert.rejects(
      b.la.sendPartTransfer('NERV-02', {
        version: 1,
        request: { ...request, part: { ...request.part, file: '../../evil.stl' } },
        content: Buffer.from(FOOT).toString('base64'),
      }),
      (e: Error) => (e as { status?: number }).status === 400,
    );
    assert.deepEqual(cacheFiles(b.tabgha), []);
    assert.equal(b.slicerCalls.length, 0);
  } finally {
    await b.done();
  }
  const closed = await bases({ accept: [] });
  try {
    await closed.la.start(60_000);
    await closed.lb.start(60_000);
    const reply = await closed.print('stampa i piedini di Wisp');
    assert.equal(reply.sliced, false);
    assert.equal(reply.handoff, undefined);
    assert.match(reply.reply, /NERV-02 refused the part/);
    assert.deepEqual(cacheFiles(closed.tabgha), []);
  } finally {
    await closed.done();
  }
});

test("F-121-T04: Tabgha's own allowlist decides; a profile it does not have slices nothing", async () => {
  const b = await bases({ profiles: [{ name: 'Other PLA', machineProfile: 'm.json', materialProfile: 'p.json' }] });
  try {
    await b.la.start(60_000);
    await b.lb.start(60_000);
    const reply = await b.print('stampa i piedini di Wisp');
    assert.equal(reply.sliced, false);
    assert.equal(reply.handoff, undefined);
    assert.match(reply.reply, /NERV-02 refused the part: Unknown slicer profile "Test TPU 0\.4"/);
    assert.equal(b.slicerCalls.length, 0);
  } finally {
    await b.done();
  }
});

test('F-121-T04: an unreachable slicing base gets a clear reply and nothing is half done', async () => {
  const b = await bases();
  try {
    await b.la.start(60_000);
    // Tabgha is not listening.
    const reply = await b.print('stampa i piedini di Wisp');
    assert.equal(reply.sliced, false);
    assert.equal(reply.handoff, undefined);
    assert.match(reply.reply, /NERV-02 could not be reached; nothing was sliced/);
    const offline = execute(b.store, 'fleet.print', { phrase: 'stampa i piedini di Wisp' }) as PrintPartReply;
    const noLine = await completeRemotePrint(b.mac, offline.remote!, undefined);
    assert.equal(noLine.sliced, false);
    assert.match(noLine.reply, /Kaji line/);
  } finally {
    await b.done();
  }
});

test('F-121-T04: a part changed between the request and the send is not sliced', async () => {
  const b = await bases();
  try {
    await b.la.start(60_000);
    await b.lb.start(60_000);
    const pending = execute(b.store, 'fleet.print', { phrase: 'stampa i piedini di Wisp' }) as PrintPartReply;
    writeFileSync(join(b.mac, 'prints', 'kite-5', 'foot.stl'), `${FOOT}% edited\n`);
    const reply = await completeRemotePrint(b.mac, pending.remote!, b.send);
    assert.equal(reply.sliced, false);
    assert.match(reply.reply, /changed/);
    assert.deepEqual(b.sent, []);
  } finally {
    await b.done();
  }
});

test('F-121-T04: the transfer cap fits the largest part file, and the prints config is validated', () => {
  assert.ok(MAX_PART_TRANSFER_BODY >= Math.ceil(MAX_PART_FILE_BYTES / 3) * 4 + 1024);
  assert.deepEqual(validatePrintsConfig({ slicer: 'NERV-02' }), { slicer: 'NERV-02' });
  assert.deepEqual(validatePrintsConfig({ accept: ['NERV-01'] }), { accept: ['NERV-01'] });
  assert.throws(() => validatePrintsConfig({ slicer: 'tabgha' }), /Invalid prints/);
  assert.throws(() => validatePrintsConfig({ accept: 'NERV-01' }), /Invalid prints/);
  assert.throws(() => validatePrintsConfig({ other: true }), /Invalid prints/);
});

test('F-121-T04: receivePartTransfer refuses a malformed message', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-print-receive-'));
  try {
    for (const body of [null, {}, { version: 2 }, { version: 1, request: { version: 1 } }]) {
      assert.equal((await receivePartTransfer(home, ['NERV-01'], 'NERV-01', body)).status, 400);
    }
    assert.equal((await receivePartTransfer(home, [], 'NERV-01', {})).status, 403);
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('F-121-T04: a slow slicer does not block the slicing base: other Kaji routes answer meanwhile', async () => {
  let running = 0;
  let most = 0;
  const slow: SlicerExecAsyncFn = async (_bin, args) => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(args[args.indexOf('--export-3mf') + 1]!, 'PK-sliced');
    running -= 1;
    return 'estimated printing time: 42m\ntotal filament used [g] = 7.5\n';
  };
  const b = await bases({ exec: slow });
  try {
    await b.la.start(60_000);
    await b.lb.start(60_000);
    const started = Date.now();
    const printing = b.print('stampa i piedini di Wisp');
    // Wait until the slicer runs on Tabgha, then ask Tabgha something else over the same link.
    for (const end = Date.now() + 5000; running === 0;) {
      if (Date.now() > end) throw new Error('the slicer never started');
      await new Promise((r) => setTimeout(r, 10));
    }
    const asked = Date.now();
    await assert.rejects(b.la.inspectSortie('NERV-02', '00000000-0000-4000-8000-000000000000'));
    assert.ok(Date.now() - asked < 500, `another route answered in ${Date.now() - asked} ms while the slicer ran`);
    const reply = await printing;
    assert.equal(reply.sliced, true, reply.reply);
    assert.ok(Date.now() - started >= 1400);
    // Two requests for the same part at once: both slice, one at a time, into one cache file and no temp files.
    const [one, two] = await Promise.all([b.print('stampa i piedini di Wisp'), b.print('print the Kite feet')]);
    assert.equal(one.sliced, true, one.reply);
    assert.equal(two.sliced, true, two.reply);
    assert.equal(most, 1, 'the slicing base runs one slicer at a time');
    assert.deepEqual(cacheFiles(b.tabgha), [`${sha(FOOT)}.stl`]);
  } finally {
    await b.done();
  }
});

test('F-121-T04: the default slicer runner is asynchronous and kills a slicer that overruns its timeout', async () => {
  let ticks = 0;
  const timer = setInterval(() => (ticks += 1), 20);
  try {
    const started = Date.now();
    await assert.rejects(
      Promise.resolve(execSlicerAsync(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 400)),
      /timed out|killed|SIGKILL|ETIMEDOUT/i,
    );
    assert.ok(Date.now() - started < 5000, 'killed at its timeout');
    assert.ok(ticks >= 5, `the event loop kept running (${ticks} ticks)`);
    assert.equal(
      await execSlicerAsync(process.execPath, ['-e', 'console.log("estimated printing time: 1m")'], 10_000),
      'estimated printing time: 1m\n',
    );
  } finally {
    clearInterval(timer);
  }
});

test('F-121-T04: one slicer runs and one request waits; a third is told the base is busy', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-print-busy-'));
  try {
    writeFileSync(join(home, 'slicer-profiles.json'), JSON.stringify(PROFILES));
    const slow: SlicerExecAsyncFn = async (_bin, args) => {
      await new Promise((r) => setTimeout(r, 300));
      writeFileSync(args[args.indexOf('--export-3mf') + 1]!, 'PK-sliced');
      return 'estimated printing time: 1m\n';
    };
    const message = {
      version: 1,
      request: {
        version: 1,
        part: { file: 'kite-5/foot.stl', sha256: sha(FOOT), bytes: FOOT.length },
        profileName: 'Test TPU 0.4',
        prints: 1,
      },
      content: Buffer.from(FOOT).toString('base64'),
    };
    const answers = await Promise.all(
      [1, 2, 3].map(() => receivePartTransfer(home, ['NERV-01'], 'NERV-01', message, { exec: slow })),
    );
    assert.deepEqual(
      answers.map((a) => a.status),
      [200, 200, 503],
    );
    assert.match((answers[2]!.value as { error: string }).error, /busy/);
    assert.deepEqual(readdirSync(join(home, 'prints-cache')), [`${sha(FOOT)}.stl`]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
