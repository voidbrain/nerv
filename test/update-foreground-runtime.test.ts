/**
 * B-122: after `nerv service move` the definition is owned by the install folder; when NERV then runs as a foreground
 * `nerv launch` (the global `nerv` command, here from another checkout) instead of the launchd service, the dashboard's
 * Update now was refused with "Service or runtime ownership is unknown or belongs elsewhere." and no way forward.
 * The join under test: the production macOS observation (launchctl, ps, authenticated doctor) → the update plan → the
 * outside updater's result. Neutral fixtures only; no real service, checkout or data home is touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync } from 'node:crypto';
import { serviceFixture } from './mac-service-fixture.ts';
import { macServiceAdapter, planService, type ServiceContext } from '../src/node-lifecycle-execution.ts';
import { executeManualUpdate } from '../src/manual-update.ts';
import { renderService } from '../src/service.ts';
import { NODE_FLAGS } from '../src/process-client.ts';
import type { UpdateAvailability } from '../src/update-availability.ts';

const supported = { skip: process.platform !== 'darwin' || process.getuid?.() === 0 };
const INSTALLED = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);

/** A moved install folder: built, its definition written as `service move` writes it, the service not registered. */
async function movedHost() {
  const f = serviceFixture();
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const c: ServiceContext = { ...f.host.context, node: join(f.directory, 'neutral-node') };
  const keys = generateKeyPairSync('ed25519');
  writeFileSync(c.node, 'Neutral executable', { mode: 0o700 });
  writeFileSync(join(c.source, 'package.json'), JSON.stringify({ name: 'nerv-agency', engines: { node: '>=24.0.0' } }));
  mkdirSync(join(c.source, 'src'), { recursive: true });
  writeFileSync(join(c.source, 'src/cli.ts'), '// Neutral CLI\n');
  mkdirSync(join(c.source, 'dist/web/browser'), { recursive: true });
  writeFileSync(join(c.source, 'dist/web/browser/index.html'), '<html>Neutral</html>');
  writeFileSync(join(c.home, 'base-key'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(c.home, 'base.pub'), keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
  chmodSync(join(c.home, 'base.pub'), 0o644);
  writeFileSync(join(c.home, 'token'), 'c'.repeat(32));
  writeFileSync(join(c.home, 'config.json'), JSON.stringify({ base: { id: 'BASE-01', name: 'Neutral' }, port }));
  const data = new DatabaseSync(f.data);
  data.exec(
    'CREATE TABLE worker_jobs(state TEXT);CREATE TABLE kaji_outbox(done TEXT);CREATE TABLE worker_legacy_outbox(state TEXT)',
  );
  data.close();
  writeFileSync(f.definition, renderService('darwin', c.home, c.source, c.node), { mode: 0o600 });

  const state = {
    registered: false,
    /** ps rows: what runs besides the launchd service. */
    foreground: '',
    calls: [] as string[][],
  };
  let server: Server | undefined;
  const serveDoctor = async (commit: string) => {
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ base: { id: 'BASE-01' }, build: { commit } }));
    });
    await new Promise<void>((done) => server!.listen(port, '127.0.0.1', done));
  };
  const stopDoctor = async () => {
    if (!server) return;
    server.closeIdleConnections();
    await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
  };
  const manager = () =>
    [
      'path = ' + f.definition,
      'program = ' + c.node,
      'working directory = ' + c.source,
      'arguments = {',
      ...[c.node, ...NODE_FLAGS, join(c.source, 'src/cli.ts'), 'serve'].map((s) => '  ' + s),
      '}',
      'environment = {',
      '  NERV_HOME => ' + c.home,
      '}',
      'pid = 7000001',
    ].join('\n');
  const run = async (program: string, args: string[]) => {
    state.calls.push([program, ...args]);
    if (program === 'git') {
      const op = args[2];
      const out =
        op === 'rev-parse'
          ? INSTALLED
          : op === 'remote'
            ? 'https://github.com/voidbrain/nerv.git'
            : op === 'diff'
              ? 'README.md\0'
              : op === 'cat-file'
                ? 'commit'
                : '';
      return { status: 0, err: '', out };
    }
    if (program === c.node) return { status: 0, err: '', out: 'v24.0.0\n' };
    if (program === 'ps')
      return {
        status: 0,
        err: '',
        out:
          (state.registered
            ? `7000001 1 node ${c.node} ${NODE_FLAGS.join(' ')} ${join(c.source, 'src/cli.ts')} serve\n`
            : '') + state.foreground,
      };
    if (program === 'launchctl' && args[0] === 'print') {
      if (args[1] === 'gui/' + c.uid) return { status: 0, err: '', out: 'Neutral GUI session' };
      return state.registered && args[1]?.endsWith('/io.nerv.agent')
        ? { status: 0, err: '', out: manager() }
        : { status: 113, err: 'Could not find service "io.nerv.agent" in domain for user gui', out: '' };
    }
    return { status: 0, err: '', out: '' };
  };
  const host = macServiceAdapter(c, run);
  return {
    f,
    c,
    host,
    state,
    serveDoctor,
    stopDoctor,
    close: async () => {
      await stopDoctor();
      f.close();
    },
  };
}

const outsideUpdater = (host: ReturnType<typeof macServiceAdapter>) => ({
  resolveUpdate: async () =>
    ({ status: 'update-available', channel: 'main', availableRevision: NEXT }) as unknown as UpdateAvailability,
  lifecycleHost: () => host,
  stopFirst: true,
  fetchRevision: async () => {},
  // Planning only: this test never applies a plan.
  applyPlan: async () => {
    throw Error('This test never applies a plan.');
  },
});

test('B-122: a moved, registered service is owned, so Update now only has to stop it first', supported, async () => {
  const m = await movedHost();
  try {
    m.state.registered = true;
    await m.serveDoctor(INSTALLED);
    const observed = await m.host.inspect();
    assert.equal(observed.definition, 'owned');
    assert.equal(observed.registration, 'owned');
    assert.equal(observed.runtime, 'owned');
    const preview = await planService(m.host, 'update', NEXT);
    assert.deepEqual(preview.blockers, ['Stop the selected service and descendants first.']);
  } finally {
    await m.close();
  }
});

test(
  'B-122: a foreground `nerv launch` serving the base is found and named, and nothing is stopped',
  supported,
  async () => {
    const m = await movedHost();
    try {
      // The service is not registered (stopped with `nerv service stop`); the owner runs `nerv launch` from a terminal
      // through the global `nerv` link, from another checkout. Its children run that checkout's processes.
      m.state.foreground = [
        `7100001 7099999 node node --use-system-ca /neutral/node/bin/nerv launch`,
        `7100002 7100001 /neutral/node/bin/node /neutral/node/bin/node --use-system-ca /neutral/dev/src/nervous-process.ts`,
        `7100003 7100001 /neutral/node/bin/node /neutral/node/bin/node --use-system-ca /neutral/dev/src/brain-process.ts`,
      ].join('\n');
      await m.serveDoctor('d'.repeat(40));
      const observed = await m.host.inspect();
      assert.equal(observed.definition, 'owned', 'the moved definition is still the one the install folder expects');
      assert.equal(observed.registration, 'absent');
      assert.equal(observed.runtime, 'unknown');
      assert.deepEqual(observed.pids, [7100001, 7100002, 7100003], 'the foreground launch and its children are found');

      const result = await executeManualUpdate(outsideUpdater(m.host), { revision: NEXT, channel: 'main' });
      assert.equal(result.outcome, 'refused');
      const why = result.reasons.join(' ');
      assert.match(why, /foreground/i, 'the reason says NERV runs in the foreground, outside the service');
      assert.match(why, /nerv launch/);
      assert.match(why, /7100001/, 'the reason names the process to stop');
      assert.doesNotMatch(why, /ownership is unknown/, 'not the generic ownership refusal');
      assert.ok(
        !m.state.calls.some((c) => c[0] === 'launchctl' && (c[1] === 'bootout' || c[1] === 'kickstart')),
        'nothing is stopped',
      );

      // Once the foreground NERV is stopped, the same update plan on the same host has nothing in its way.
      m.state.foreground = '';
      await m.stopDoctor();
      const ready = await planService(m.host, 'update', NEXT);
      assert.deepEqual(ready.blockers, []);
    } finally {
      await m.close();
    }
  },
);
