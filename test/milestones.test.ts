import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { Registry, createRootKey, signRecord, unlockRootKey, type RegistryBody } from '../src/kaji.ts';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
import { recordHealth, recordPromotion, recordedMilestones } from '../src/milestones.ts';
import { chronicleDays, composeChronicle, gatherMilestones } from '../src/chronicle.ts';
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(what: string, check: () => Promise<boolean> | boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) assert.fail('timed out waiting for ' + what);
    await wait(50);
  }
}
const freePort = async () => {
  const s = createServer();
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((d) => s.close(() => d()));
  return p;
};
const keys = () => {
  const k = generateKeyPairSync('ed25519');
  return {
    privateKey: k.privateKey,
    publicKey: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
};
const root = (() => {
  const f = createRootKey('a long test passphrase');
  return { ...unlockRootKey(f.file, 'a long test passphrase'), publicKey: f.publicKey };
})();
let serial = 0;
const rec = (body: Omit<RegistryBody, 'serial' | 'issued'>) =>
  signRecord(root.privateKey, { ...body, serial: ++serial, issued: new Date().toISOString() } as RegistryBody);
const kinds = (db: DatabaseSync) => recordedMilestones(db).map((m) => [m.kind, m.subject, m.detail]);
const t = (minute: number) => new Date(Date.UTC(2030, 0, 1, 9, minute)).toISOString();

test('outages and recoveries: one row per change, the minutes down on the recovery, repeats and late reports ignored', () => {
  const st = new Store(':memory:');
  try {
    assert.equal(recordHealth(st.db, 'route', 'local', true, t(0)), undefined, 'first seen working is not news');
    assert.equal(recordHealth(st.db, 'route', 'local', false, t(1)), 'route.down');
    assert.equal(recordHealth(st.db, 'route', 'local', false, t(2)), undefined, 'still down: no second row');
    assert.equal(recordHealth(st.db, 'route', 'local', true, t(1)), undefined, 'a report not newer than the last');
    assert.equal(recordHealth(st.db, 'base', 'local', true, t(3)), undefined, 'a base and a route never mix');
    assert.equal(recordHealth(st.db, 'route', 'local', true, t(13)), 'route.back');
    assert.equal(recordHealth(st.db, 'route', 'local', true, t(14)), undefined);
    assert.equal(recordHealth(st.db, 'route', 'local', false, t(13)), undefined, 'the same down sent again later');
    assert.equal(recordHealth(st.db, 'route', 'local', false, 'not a time'), undefined);
    assert.deepEqual(kinds(st.db), [
      ['route.down', 'local', ''],
      ['route.back', 'local', '12'],
    ]);
    assert.throws(() => st.db.exec('UPDATE milestones SET detail=1'), /append-only/);
    assert.throws(() => st.db.exec('DELETE FROM milestones'), /append-only/);
  } finally {
    st.close();
  }
});

test('a promotion is a move to a later stage only', () => {
  const st = new Store(':memory:');
  try {
    const p = { id: 'fuyutsuki', name: 'Fuyutsuki' };
    assert.equal(recordPromotion(st.db, p, 'prototype', 'test', t(0)), true);
    assert.equal(recordPromotion(st.db, p, 'test', 'test', t(1)), false);
    assert.equal(recordPromotion(st.db, p, 'production', 'test', t(2)), false);
    assert.equal(recordPromotion(st.db, p, 'test', 'unknown', t(3)), false);
    assert.deepEqual(kinds(st.db), [['pilot.promoted', 'fuyutsuki', 'prototype>test']]);
  } finally {
    st.close();
  }
});

test('a base online for the first time is recorded once, and a base seen before the change never is (no backfill)', () => {
  const st = new Store(':memory:');
  try {
    // Seen before F-054-T04: a last-seen time already stored.
    st.db.prepare('INSERT INTO kaji_seen VALUES(?,?)').run('NERV-01', t(0));
    const reg = new Registry(st.db, root.publicKey);
    reg.seen({ 'NERV-01': t(5), 'NERV-02': t(6) });
    reg.seen({ 'NERV-02': t(7), 'NERV-03': 'garbage' });
    assert.deepEqual(
      recordedMilestones(st.db).map((m) => [m.kind, m.subject, m.at]),
      [['base.online', 'NERV-02', t(6)]],
    );
    assert.deepEqual(kinds(new Store(':memory:').db), [], 'a fresh database starts with nothing: nothing backfilled');
  } finally {
    st.close();
  }
});

test(
  'across the Kaji link, the runtime and the nervous process: a peer first online, unreachable and back, in the chronicle',
  { timeout: 30000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const A = keys(),
      B = keys();
    const pb = await freePort();
    const home = mkdtempSync(join(tmpdir(), 'nerv-ms-a-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ base: { id: 'NERV-01', name: 'Neo Tokyo-3' }, kaji: { root: root.publicKey } }),
    );
    const records = [
      rec({ kind: 'enrol', baseId: 'NERV-01', name: 'Neo Tokyo-3', publicKey: A.publicKey, address: '127.0.0.1:1' }),
      rec({ kind: 'enrol', baseId: 'NERV-02', name: 'Tabgha', publicKey: B.publicKey, address: `127.0.0.1:${pb}` }),
    ];
    const a = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    const peerStore = new Store(':memory:');
    const peerReg = new Registry(peerStore.db, root.publicKey);
    for (const r of records) peerReg.add(r);
    const peerPort: RegistryPort = {
      bases: async () => peerReg.bases(),
      records: async () => peerReg.records(),
      add: async () => 0,
      seen: async (u) => peerReg.seen(u),
      lastSeen: async () => peerReg.lastSeen(),
    };
    const link = new KajiLink({
      baseId: 'NERV-01',
      key: A.privateKey,
      publicKey: A.publicKey,
      registry: a.kaji,
      log: () => {},
    });
    const peer = new KajiLink({
      baseId: 'NERV-02',
      key: B.privateKey,
      publicKey: B.publicKey,
      registry: peerPort,
      log: () => {},
    });
    const read = () => {
      const db = new DatabaseSync(join(home, 'nerv.sqlite'));
      try {
        return recordedMilestones(db).map((m) => [m.kind, m.subject]);
      } finally {
        db.close();
      }
    };
    try {
      await a.ready();
      assert.equal(await a.kaji.add(records), 2);
      // Tabgha is not listening yet: three missed heartbeats fill the online window.
      for (let i = 0; i < 3; i++) await link.heartbeat();
      await until('the outage to be recorded', () => read().some(([k]) => k === 'base.down'));
      assert.deepEqual(read(), [
        ['base.online', 'NERV-01'],
        ['base.down', 'NERV-02'],
      ]);
      await peer.start(60_000);
      await link.heartbeat();
      await until('the recovery to be recorded', () => read().some(([k]) => k === 'base.back'));
      await link.heartbeat();
      assert.deepEqual(read(), [
        ['base.online', 'NERV-01'],
        ['base.down', 'NERV-02'],
        ['base.online', 'NERV-02'],
        ['base.back', 'NERV-02'],
      ]);
      const db = new DatabaseSync(join(home, 'nerv.sqlite'));
      const text = composeChronicle(chronicleDays(gatherMilestones(db, root.publicKey), 'Europe/Rome'), 'en');
      db.close();
      assert.match(text, /• Neo Tokyo-3 \(NERV-01\) came online for the first time\. \[milestone:\d+\]/);
      assert.match(text, /• Tabgha \(NERV-02\) stopped answering on the Kaji line\. \[milestone:\d+\]/);
      assert.match(text, /• Tabgha \(NERV-02\) came online for the first time\. \[milestone:\d+\]/);
      assert.match(text, /• Tabgha answered again after 1 min\. \[milestone:\d+\]/);
    } finally {
      await peer.stop();
      await link.stop();
      await a.close();
      peerStore.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test(
  'across the brain and the runtime: the local model route down and back is recorded once each, in the chronicle',
  { timeout: 30000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const port = await freePort();
    const home = mkdtempSync(join(tmpdir(), 'nerv-ms-route-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ models: { local: { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm' } } }),
    );
    const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    type Doc = { routes?: { local: { state: string } } };
    const state = async () => ((await runtime.doctor()) as unknown as Doc).routes?.local.state;
    const read = () => {
      const db = new DatabaseSync(join(home, 'nerv.sqlite'));
      try {
        return recordedMilestones(db).map((m) => [m.kind, m.subject]);
      } finally {
        db.close();
      }
    };
    let model: Server | undefined;
    try {
      await runtime.ready();
      await until('the probe to mark the route down', async () => (await state()) === 'down');
      await runtime.logRoutes();
      await runtime.logRoutes();
      assert.deepEqual(read(), [['route.down', 'local']], 'polled twice, recorded once');
      model = createHttpServer((_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end('{"data":[]}');
      });
      await new Promise<void>((done) => model!.listen(port, '127.0.0.1', done));
      await runtime.reloadModels();
      await until('the route to come back', async () => (await state()) === 'ok');
      await runtime.logRoutes();
      await runtime.logRoutes();
      assert.deepEqual(read(), [
        ['route.down', 'local'],
        ['route.back', 'local'],
      ]);
      const db = new DatabaseSync(join(home, 'nerv.sqlite'));
      const text = composeChronicle(chronicleDays(gatherMilestones(db), 'Europe/Rome'), 'it');
      db.close();
      assert.match(text, /• La S² local route è caduta\. \[milestone:1\]/);
      assert.match(text, /• La S² local route è tornata dopo \d+ min\. \[milestone:2\]/);
    } finally {
      await runtime.close();
      if (model) await new Promise<void>((done) => model!.close(() => done()));
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test('the pilots command records a promotion, not a demotion or another edit, and the chronicle command shows it', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-ms-pilot-'));
  try {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        models: { local: { baseUrl: 'http://127.0.0.1:9/v1', model: 'm' } },
        language: 'en',
        pilots: [{ id: 'fuyutsuki', name: 'Fuyutsuki', domain: 'history', keywords: ['history'], model: 'm' }],
      }),
    );
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ['src/cli.ts', ...args], {
        env: { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' },
        encoding: 'utf8',
      });
    const up = cli('pilots', 'set', 'fuyutsuki', '--stage', 'test');
    assert.equal(up.status, 0, up.stderr);
    assert.match(up.stdout, /Promoted from prototype to test: in the chronicle\./);
    for (const args of [
      ['--stage', 'test'],
      ['--stage', 'prototype'],
      ['--name', 'Kozo'],
    ]) {
      const r = cli('pilots', 'set', 'fuyutsuki', ...args);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /Promoted/);
    }
    const shown = cli('chronicle');
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /• Pilot Fuyutsuki promoted: prototype to test\. \[milestone:1\]/);
    assert.equal(shown.stdout.match(/promoted/g)?.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
