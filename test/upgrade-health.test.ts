import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serviceFixture } from './mac-service-fixture.ts';
import {
  applyService,
  macServiceAdapter,
  planService,
  serviceReceipt,
  type ServiceContext,
  type ServiceReceipt,
} from '../src/node-lifecycle-execution.ts';
import { renderService } from '../src/service.ts';

const supported = { skip: process.platform === 'win32' || process.getuid?.() === 0 };
const PREV = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);

async function adapterFixture(doctorFor: (revision: string, callCount: number) => { status: number; body: unknown }) {
  const f = serviceFixture();
  const c: ServiceContext = { ...f.host.context, node: join(f.directory, 'neutral-node') };
  writeFileSync(c.node, 'Neutral command-adapter executable metadata', { mode: 0o700 });
  writeFileSync(join(c.source, 'package.json'), JSON.stringify({ name: 'nerv-agency', engines: { node: '>=24.0.0' } }));
  mkdirSync(join(c.source, 'src'), { recursive: true });
  writeFileSync(join(c.source, 'src/cli.ts'), '// Neutral CLI\n');
  let revision = PREV;
  let registered = false;
  let doctorCalls = 0;
  // B-060: one server on a port the kernel chose, held for the whole test; a stopped service drops connections
  // instead of closing the port, so no other socket can take it between a stop and the next start.
  const server: Server = createServer((req, res) => {
    if (!registered) {
      req.socket.destroy();
      return;
    }
    doctorCalls++;
    const reply = doctorFor(revision, doctorCalls);
    res.statusCode = reply.status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const port = (server.address() as AddressInfo).port;
  const keys = generateKeyPairSync('ed25519');
  const pubBase64 = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  writeFileSync(
    join(c.home, 'config.json'),
    JSON.stringify({
      port,
      base: { id: 'BASE-01', name: 'Neutral fixture' },
      kaji: { root: pubBase64, rootBinding: true },
    }),
    { mode: 0o600 },
  );
  writeFileSync(join(c.home, 'token'), 'c'.repeat(32), { mode: 0o600 });
  writeFileSync(join(c.home, 'base-key'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(join(c.home, 'base.pub'), pubBase64, {
    mode: 0o644,
  });
  const db = new DatabaseSync(f.data);
  try {
    db.exec(
      'PRAGMA user_version=6;' +
        'CREATE TABLE IF NOT EXISTS worker_jobs(id TEXT PRIMARY KEY, state TEXT);' +
        'CREATE TABLE IF NOT EXISTS kaji_outbox(id TEXT PRIMARY KEY, done TEXT);' +
        'CREATE TABLE IF NOT EXISTS worker_legacy_outbox(id TEXT PRIMARY KEY, state TEXT);',
    );
  } finally {
    db.close();
  }
  const plist = renderService('darwin', c.home, c.source, c.node);
  const manager = () =>
    [
      'gui/' + c.uid + '/io.nerv.agent = {',
      '\tstate = running',
      '\tpid = 9999999',
      '\tpath = ' + f.definition,
      '\tprogram = ' + c.node,
      '\tworking directory = ' + c.source,
      '\targuments = {',
      '\t\t' + c.node,
      '\t\t--use-system-ca',
      '\t\t' + join(c.source, 'src/cli.ts'),
      '\t\tserve',
      '\t}',
      '\tenvironment = {',
      '\t\tNERV_HOME => ' + c.home,
      '\t}',
      '}',
    ].join('\n');
  const run = async (program: string, args: string[]) => {
    if (program === 'git') {
      const op = args[2];
      if (op === 'checkout') revision = args.at(-1)!;
      return {
        status: 0,
        err: '',
        out:
          op === 'rev-parse'
            ? revision
            : op === 'remote'
              ? 'https://github.com/voidbrain/nerv.git'
              : op === 'diff'
                ? 'README.md\0'
                : op === 'cat-file'
                  ? 'commit'
                  : '',
      };
    }
    if (program === 'ps') {
      return {
        status: 0,
        err: '',
        out: registered
          ? '9999999 1 node ' +
            c.node +
            ' ' +
            join(c.source, 'src/cli.ts') +
            ' serve\n9999998 9999999 node ' +
            c.node +
            ' ' +
            join(c.source, 'src/nervous-process.ts')
          : '',
      };
    }
    if (program === c.node) return { status: 0, err: '', out: 'v24.0.0\n' };
    if (program === 'npm' || program === 'tar') return { status: 0, err: '', out: '' };
    if (program !== 'launchctl') throw Error('Unexpected program: ' + program);
    if (args[0] === 'print') {
      if (args[1] === 'gui/' + c.uid) return { status: 0, err: '', out: 'Neutral GUI session' };
      return registered && args[1]?.endsWith('/io.nerv.agent')
        ? { status: 0, err: '', out: manager() }
        : { status: 113, err: 'Could not find service', out: '' };
    }
    if (args[0] === 'bootstrap') {
      registered = true;
      return { status: 0, err: '', out: '' };
    }
    registered = false;
    server.closeAllConnections();
    return { status: 0, err: '', out: '' };
  };
  const host = macServiceAdapter(c, run);
  mkdirSync(join(c.source, 'dist/web/browser'), { recursive: true });
  writeFileSync(join(c.source, 'dist/web/browser/index.html'), '<!doctype html>');
  writeFileSync(f.definition, plist, { mode: 0o600 });
  return {
    host,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      f.close();
    },
  };
}

test('F-005-T14: update records after-start health check in receipt when service is healthy', supported, async () => {
  const f = await adapterFixture((revision) => ({
    status: 200,
    body: {
      base: { id: 'BASE-01' },
      build: { commit: revision },
      database: { quick_check: 'ok' },
      processes: { nervous: 9999998, brain: 9999997, brainAlive: true },
      models: { misato: 'neutral-local' },
    },
  }));
  try {
    const plan = await planService(f.host, 'update', NEXT);
    assert.deepEqual(plan.blockers, []);
    const receipt = await applyService(f.host, plan, plan.digest);
    assert.equal(receipt.state, 'completed');
    assert.equal(receipt.recovery, undefined);
    assert.ok(receipt.health);
    assert.equal(receipt.health.ok, true);
    assert.equal(receipt.health.commit, NEXT);
    assert.equal(receipt.health.baseId, 'BASE-01');
    assert.equal(receipt.health.database, 'ok');
    assert.equal(receipt.health.nervous, true);
    assert.equal(receipt.health.brain, true);
    assert.deepEqual(receipt.health.failures, []);
    assert.ok(Number.isFinite(Date.parse(receipt.health.checkedAt)));
    assert.deepEqual(serviceReceipt(f.host, plan.digest), receipt);
  } finally {
    await f.close();
  }
});

test(
  'B-060: the fixture service keeps its port even when another socket holds the port it would draw',
  { ...supported, timeout: 20_000 },
  async () => {
    // Another process (an outgoing connection in CI) holds the port the fixture would pick at random.
    const blocker = createServer();
    await new Promise<void>((done) => blocker.listen(44500, '127.0.0.1', done));
    const random = Math.random;
    Math.random = () => 0.51; // 43990 + 510 = 44500
    let f: ReturnType<typeof adapterFixture> | undefined;
    try {
      f = adapterFixture((revision) => ({
        status: 200,
        body: {
          base: { id: 'BASE-01' },
          build: { commit: revision },
          database: { quick_check: 'ok' },
          processes: { nervous: 9999998, brain: 9999997, brainAlive: true },
          models: { misato: 'neutral-local' },
        },
      }));
      Math.random = random;
      const host = (await f).host;
      const plan = await planService(host, 'update', NEXT);
      const receipt = await applyService(host, plan, plan.digest);
      assert.equal(receipt.state, 'completed');
    } finally {
      Math.random = random;
      await (await f)?.close();
      await new Promise<void>((done) => blocker.close(() => done()));
    }
  },
);

test(
  'F-005-T14: failed brain, database, nervous or identity check leaves update uncertain with ordered recovery',
  supported,
  async () => {
    const cases: {
      name: string;
      doctor: (revision: string, callCount: number) => { status: number; body: unknown };
      expectFailure: RegExp;
      checkHealth: (receipt: ServiceReceipt) => void;
    }[] = [
      {
        name: 'brain unavailable',
        doctor: (revision) => ({
          status: 200,
          body: {
            base: { id: 'BASE-01' },
            build: { commit: revision },
            database: { quick_check: 'ok' },
            processes: { nervous: 9999998, brain: null, brainAlive: false },
            models: 'brain unavailable',
          },
        }),
        expectFailure: /brain process did not answer/,
        checkHealth: (receipt) => {
          assert.equal(receipt.health?.brain, false);
          assert.equal(receipt.health?.nervous, true);
          assert.equal(receipt.health?.database, 'ok');
        },
      },
      {
        name: 'database integrity failure',
        doctor: (revision) => ({
          status: 200,
          body: {
            base: { id: 'BASE-01' },
            build: { commit: revision },
            database: { quick_check: 'corrupt' },
            processes: { nervous: 9999998, brain: 9999997, brainAlive: true },
            models: { misato: 'neutral-local' },
          },
        }),
        expectFailure: /database quick_check corrupt/,
        checkHealth: (receipt) => {
          assert.equal(receipt.health?.database, 'corrupt');
        },
      },
      {
        name: 'nervous unavailable during verify',
        doctor: (revision, callCount) =>
          callCount <= 2
            ? {
                status: 200,
                body: {
                  base: { id: 'BASE-01' },
                  build: { commit: revision },
                  database: { quick_check: 'ok' },
                  processes: { nervous: 9999998, brain: 9999997, brainAlive: true },
                  models: { misato: 'neutral-local' },
                },
              }
            : { status: 400, body: { error: 'Scheduler unavailable' } },
        expectFailure: /doctor returned HTTP 400/,
        checkHealth: (receipt) => {
          assert.equal(receipt.health?.nervous, false);
        },
      },
      {
        name: 'mismatched build commit during verify',
        doctor: (revision, callCount) => ({
          status: 200,
          body: {
            base: { id: 'BASE-01' },
            build: { commit: callCount <= 2 ? revision : PREV },
            database: { quick_check: 'ok' },
            processes: { nervous: 9999998, brain: 9999997, brainAlive: true },
            models: { misato: 'neutral-local' },
          },
        }),
        expectFailure: /build commit/,
        checkHealth: (receipt) => {
          assert.equal(receipt.health?.commit, PREV);
        },
      },
      {
        name: 'mismatched base identity during verify',
        doctor: (revision, callCount) => ({
          status: 200,
          body: {
            base: { id: callCount <= 2 ? 'BASE-01' : 'FOREIGN-BASE' },
            build: { commit: revision },
            database: { quick_check: 'ok' },
            processes: { nervous: 9999998, brain: 9999997, brainAlive: true },
            models: { misato: 'neutral-local' },
          },
        }),
        expectFailure: /base identity/,
        checkHealth: (receipt) => {
          assert.equal(receipt.health?.baseId, 'FOREIGN-BASE');
        },
      },
    ];

    for (const c of cases) {
      const f = await adapterFixture(c.doctor);
      try {
        const plan = await planService(f.host, 'update', NEXT);
        await assert.rejects(applyService(f.host, plan, plan.digest), c.expectFailure);
        const receipt = serviceReceipt(f.host, plan.digest) as ServiceReceipt;
        assert.equal(receipt.state, 'uncertain', c.name);
        assert.equal(receipt.health?.ok, false, c.name);
        c.checkHealth(receipt);
        assert.ok(Array.isArray(receipt.recovery) && receipt.recovery.length >= 5, c.name);
        assert.match(receipt.recovery[0]!, /bootout/, c.name);
        assert.match(receipt.recovery[2]!, /lifecycle-release/, c.name);
        assert.match(receipt.recovery[3]!, new RegExp(PREV), c.name);
        assert.match(receipt.recovery[4]!, /start/, c.name);
      } finally {
        await f.close();
      }
    }
  },
);
