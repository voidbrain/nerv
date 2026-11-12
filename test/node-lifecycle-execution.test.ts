import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, lstatSync, symlinkSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash, generateKeyPairSync } from 'node:crypto';
import * as lifecycle from '../src/node-lifecycle-execution.ts';
import { serviceFixture } from './mac-service-fixture.ts';
import {
  planService,
  applyService,
  serviceReceipt,
  releaseService,
  macServiceHost,
  type ServiceReceipt,
} from '../src/node-lifecycle-execution.ts';
import { canonical } from '../src/kaji.ts';
import { createServer, type Server } from 'node:http';
import { NODE_FLAGS } from '../src/process-client.ts';
import { macServiceAdapter, macRegistrationMatches, assertServiceStartup } from '../src/node-lifecycle-execution.ts';
const supported = { skip: process.platform === 'win32' || process.getuid?.() === 0 };
test(
  'Mac lifecycle joins exact files, durable started receipts and OS adapter; cached replay never reinstalls',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      assert.deepEqual(serviceReceipt(f.host, 'a'.repeat(64)), { state: 'absent' });
      assert.equal(existsSync(join(f.directory, '.nerv-lifecycle')), false);
      const plan = await planService(f.host, 'install');
      assert.deepEqual(plan.blockers, []);
      await assert.rejects(applyService(f.host, plan, 'wrong'), /exact/);
      assert.equal(existsSync(f.definition), false);
      const installed = await applyService(f.host, plan, plan.digest);
      assert.equal(installed.state, 'completed');
      assert.equal(lstatSync(f.definition).mode & 0o777, 0o600);
      assert.deepEqual(f.calls, ['register']);
      assert.deepEqual(await applyService(f.host, plan, plan.digest), installed);
      assert.equal(f.calls.length, 1);
      const stop = await planService(f.host, 'stop');
      const stopped = await applyService(f.host, stop, stop.digest);
      assert.ok(stopped.fence > installed.fence);
      assert.equal((await f.host.inspect()).runtime, 'stopped');
      const remove = await planService(f.host, 'uninstall');
      await applyService(f.host, remove, remove.digest);
      assert.equal(existsSync(f.definition), false);
      assert.equal(existsSync(f.data), true);
      assert.equal(readFileSync(join(f.host.context.home, 'base-key'), 'utf8'), 'neutral-fixture-private');
      assert.deepEqual(await applyService(f.host, plan, plan.digest), installed);
      assert.equal(existsSync(f.definition), false, 'replaying a historical install must not create a fresh service');
    } finally {
      f.close();
    }
  },
);
test('ownership, drift, legacy, pending work and incompatible source block effects', supported, async () => {
  const f = serviceFixture();
  try {
    const plan = await planService(f.host, 'install');
    f.controls.pending = true;
    await assert.rejects(applyService(f.host, plan, plan.digest), /changed/);
    assert.equal(existsSync(f.definition), false);
    f.controls.pending = false;
    for (const key of ['legacy', 'pending'] as const) {
      f.controls[key] = true;
      assert.ok((await planService(f.host, 'install')).blockers.length);
      f.controls[key] = false;
    }
    writeFileSync(f.definition, 'foreign definition', { mode: 0o600 });
    const foreign = await planService(f.host, 'install');
    assert.ok(foreign.blockers.length);
    await assert.rejects(applyService(f.host, foreign, foreign.digest), /blocked/);
    assert.equal(readFileSync(f.definition, 'utf8'), 'foreign definition');
    const altered = structuredClone(plan);
    altered.context.home = join(f.directory, 'another-profile');
    const { digest: _digest, ...body } = altered;
    altered.digest = createHash('sha256').update(canonical(body)).digest('hex');
    await assert.rejects(applyService(f.host, altered, altered.digest), /Invalid local/);
  } finally {
    f.close();
  }
});
test(
  'partial failure retains a changed foreign definition and resource; replay has no effects',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const plan = await planService(f.host, 'install');
      f.setBeforeCommand(() => {
        writeFileSync(f.definition, 'changed by another owner');
        throw Error('neutral injected failure');
      });
      await assert.rejects(applyService(f.host, plan, plan.digest), /injected/);
      const receipt = serviceReceipt(f.host, plan.digest) as ServiceReceipt;
      assert.equal(receipt.state, 'uncertain');
      assert.equal(readFileSync(f.definition, 'utf8'), 'changed by another owner');
      assert.equal((await applyService(f.host, plan, plan.digest)).state, 'uncertain');
      assert.equal(f.calls.length, 1);
      assert.ok((await planService(f.host, 'install')).blockers.some((s) => s.includes('owns')));
      assert.throws(
        () =>
          releaseService(f.host, receipt, {
            ...receipt,
            handlerStopped: true,
            descendantsStopped: true,
            operatorConfirmed: true,
            reason: 'Neutral handler still running',
          }),
        /handler/,
      );
    } finally {
      f.close();
    }
  },
);
test('concurrent callers return the accepted receipt without a second manager registration', supported, async () => {
  const f = serviceFixture();
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  let entered!: () => void;
  const started = new Promise<void>((done) => (entered = done));
  try {
    f.setBeforeCommand(async () => {
      entered();
      await gate;
    });
    const p = await planService(f.host, 'install'),
      first = applyService(f.host, p, p.digest);
    await started;
    const replay = await applyService(f.host, p, p.digest);
    assert.equal(replay.state, 'running');
    assert.equal(f.calls.length, 1);
    release();
    assert.equal((await first).state, 'completed');
  } finally {
    release();
    f.close();
  }
});
test(
  'update backs up existing data before source effects and refuses source drift between steps',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const install = await planService(f.host, 'install');
      await applyService(f.host, install, install.digest);
      const stop = await planService(f.host, 'stop');
      await applyService(f.host, stop, stop.digest);
      const next = 'b'.repeat(40);
      f.controls.compatible = false;
      assert.ok((await planService(f.host, 'update', next)).blockers.length);
      f.controls.compatible = true;
      const update = await planService(f.host, 'update', next);
      f.setBeforeCommand((step) => {
        if (step === 'fetch') {
          const backup = new DatabaseSync(
            join(f.directory, '.nerv-lifecycle/backups', update.digest, 'database.sqlite'),
            { readOnly: true },
          );
          try {
            assert.equal(
              backup.prepare('SELECT title FROM reminders WHERE id=?').get('original')!.title,
              'Neutral existing reminder',
            );
          } finally {
            backup.close();
          }
        }
      });
      assert.equal((await applyService(f.host, update, update.digest)).state, 'completed');
      assert.equal((await f.host.inspect()).revision, next);
      assert.deepEqual(f.calls.slice(-5), ['fetch', 'checkout', 'dependencies', 'build', 'register']);
      const stopped = await planService(f.host, 'stop');
      await applyService(f.host, stopped, stopped.digest);
      const drift = await planService(f.host, 'update', 'c'.repeat(40));
      f.setBeforeCommand((step) => {
        if (step === 'fetch') f.controls.clean = false;
      });
      await assert.rejects(applyService(f.host, drift, drift.digest), /source changed/);
      assert.equal((serviceReceipt(f.host, drift.digest) as ServiceReceipt).state, 'uncertain');
      assert.equal(readFileSync(f.revision, 'utf8'), next);
    } finally {
      f.close();
    }
  },
);
for (const phase of ['accepted', 'definition:completed', 'start:completed'])
  test(
    'real handler interruption at ' + phase + ' requires exact stopped recovery; new plans take a higher fence',
    supported,
    async () => {
      const f = serviceFixture();
      try {
        const plan = await planService(f.host, 'install'),
          path = join(f.directory, 'plan.json');
        writeFileSync(path, JSON.stringify(plan));
        const code =
          'const {serviceFixture}=await import(' +
          JSON.stringify(new URL('./mac-service-fixture.ts', import.meta.url).href) +
          ');const {applyService}=await import(' +
          JSON.stringify(new URL('../src/node-lifecycle-execution.ts', import.meta.url).href) +
          ");const {readFileSync}=await import('node:fs');const f=serviceFixture(" +
          JSON.stringify(f.directory) +
          ');const p=JSON.parse(readFileSync(' +
          JSON.stringify(path) +
          ",'utf8'));await applyService(f.host,p,p.digest,step=>{if(step===" +
          JSON.stringify(phase) +
          ')process.exit(86)});';
        assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' }));
        const old = serviceReceipt(f.host, plan.digest) as ServiceReceipt;
        assert.equal(old.state, 'running');
        const evidence = {
          ...old,
          handlerStopped: true,
          descendantsStopped: true,
          operatorConfirmed: true,
          reason: 'Neutral child exited; simulated service and descendants stopped',
        };
        assert.throws(() => releaseService(f.host, { ...old, fence: old.fence + 1 }, evidence), /ownership|changed/);
        assert.throws(() => releaseService(f.host, old, { ...evidence, descendantsStopped: false }), /stopped/);
        f.setManager(false);
        assert.equal(releaseService(f.host, old, evidence).state, 'released');
        assert.equal((await applyService(f.host, plan, plan.digest)).state, 'released');
        const action = existsSync(f.definition) ? 'uninstall' : 'install',
          next = await planService(f.host, action);
        const result = await applyService(f.host, next, next.digest);
        assert.ok(result.fence > old.fence);
        assert.equal(result.state, 'completed');
      } finally {
        f.close();
      }
    },
  );
test('clock rollback and symlinked journal never initialize replacement fencing state', supported, async () => {
  const f = serviceFixture();
  try {
    const p = await planService(f.host, 'install');
    await applyService(f.host, p, p.digest);
    const db = new DatabaseSync(join(f.directory, '.nerv-lifecycle/journal.sqlite'));
    db.prepare('UPDATE clock SET value=0').run();
    db.close();
    await assert.rejects(planService(f.host, 'stop'), /rolled back/);
  } finally {
    f.close();
  }
  const g = serviceFixture();
  try {
    symlinkSync(join(g.directory, 'missing'), join(g.directory, '.nerv-lifecycle'));
    await assert.rejects(planService(g.host, 'install'));
    assert.equal(lstatSync(join(g.directory, '.nerv-lifecycle')).isSymbolicLink(), true);
  } finally {
    g.close();
  }
});
test('production adapter refuses additional profiles and unsupported/root hosts without installing anything', () => {
  assert.throws(() => macServiceHost('/neutral/additional-profile'), /additional|unprivileged/);
});
test(
  'review regression: retained lifecycle uncertainty blocks ordinary startup, including the real CLI front door',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const p = await planService(f.host, 'install');
      f.setBeforeCommand(() => {
        throw Error('Neutral interrupted service start');
      });
      await assert.rejects(applyService(f.host, p, p.digest));
      const guard = Reflect.get(lifecycle, 'assertServiceStartup') as
        ((host: typeof f.host, managed?: boolean) => Promise<void>) | undefined;
      assert.equal(typeof guard, 'function', 'normal startup needs the durable lifecycle guard');
      await assert.rejects(guard!(f.host), /lifecycle|unresolved/i);
      const code =
        "const os=(await import('node:os')).default;os.homedir=()=>" +
        JSON.stringify(f.directory) +
        ";(await import('node:module')).syncBuiltinESMExports();Object.defineProperty(process,'platform',{value:'darwin'});process.argv=[process.execPath,'cli.ts','serve'];await import(" +
        JSON.stringify(new URL('../src/cli.ts', import.meta.url).href) +
        ');';
      let stderr = '';
      try {
        execFileSync(process.execPath, ['--input-type=module', '-e', code], {
          env: { ...process.env, NERV_HOME: f.host.context.home },
          stdio: 'pipe',
        });
      } catch (error) {
        stderr = String((error as { stderr?: Buffer }).stderr ?? '');
      }
      assert.match(
        stderr,
        /lifecycle|unresolved/i,
        'CLI must refuse the retained resource before touching the runtime',
      );
    } finally {
      f.close();
    }
  },
);
test(
  'review regression: unchanged compatibility markers cannot authorize changed executable/reader code; actual schema is bound',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const compatible = Reflect.get(lifecycle, 'compatibleServiceRevision') as
        ((context: typeof f.host.context, revision: string) => Promise<boolean>) | undefined;
      assert.equal(
        typeof compatible,
        'function',
        'production update needs an actual source/schema compatibility boundary',
      );
      const git = (args: string[]) =>
        execFileSync(
          'git',
          [
            '-C',
            f.host.context.source,
            '-c',
            'user.name=Neutral Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            '-c',
            'commit.gpgsign=false',
            ...args,
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
      git(['init']);
      writeFileSync(
        join(f.host.context.source, 'reader.ts'),
        'export const markers=[1,6]; export const supported=[5,6];',
      );
      git(['add', '.']);
      git(['commit', '-m', 'Neutral reader']);
      const base = git(['rev-parse', 'HEAD']);
      writeFileSync(
        join(f.host.context.source, 'reader.ts'),
        'export const markers=[1,6]; export const supported=[7];',
      );
      git(['add', '.']);
      git(['commit', '-m', 'Incompatible reader retaining markers']);
      const bad = git(['rev-parse', 'HEAD']);
      git(['checkout', '--detach', base]);
      assert.equal(await compatible!(f.host.context, bad), false);
      assert.equal(git(['rev-parse', 'HEAD']), base);
      writeFileSync(join(f.host.context.source, 'README.md'), 'Neutral documentation change');
      git(['add', '.']);
      git(['commit', '-m', 'Identical executable tree']);
      const docs = git(['rev-parse', 'HEAD']);
      git(['checkout', '--detach', base]);
      const db = new DatabaseSync(f.data);
      db.exec('PRAGMA user_version=6');
      db.close();
      assert.equal(await compatible!(f.host.context, docs), true);
      const future = new DatabaseSync(f.data);
      future.exec('PRAGMA user_version=7');
      future.close();
      assert.equal(await compatible!(f.host.context, docs), false);
      assert.equal(git(['rev-parse', 'HEAD']), base);
    } finally {
      f.close();
    }
  },
);
test(
  'read-only regression: standard public base.pub mode644 is accepted while credentials stay private',
  supported,
  () => {
    const f = serviceFixture();
    try {
      const inspect = Reflect.get(lifecycle, 'serviceProfileIdentity') as
        ((context: typeof f.host.context) => string) | undefined;
      assert.equal(typeof inspect, 'function', 'validate the production profile with its actual public-key convention');
      const keys = generateKeyPairSync('ed25519');
      writeFileSync(join(f.host.context.home, 'base-key'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
      writeFileSync(
        join(f.host.context.home, 'base.pub'),
        keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') + '\n',
      );
      chmodSync(join(f.host.context.home, 'base.pub'), 0o644);
      writeFileSync(join(f.host.context.home, 'token'), 'c'.repeat(32));
      assert.match(inspect!(f.host.context), /^[a-f0-9]{64}$/);
      chmodSync(join(f.host.context.home, 'token'), 0o644);
      assert.throws(() => inspect!(f.host.context), /permission|private/i);
    } finally {
      f.close();
    }
  },
);
test(
  'startup permit is specific to the recorded live start; ordinary, missing-manager and changed-identity starts fail',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      await assertServiceStartup(f.host);
      const p = await planService(f.host, 'install');
      f.host.authorizedStart = async () => true;
      f.setBeforeCommand(async (step) => {
        if (step !== 'register') return;
        await assert.rejects(assertServiceStartup(f.host), /unresolved/);
        await assertServiceStartup(f.host, true);
        f.host.authorizedStart = async () => false;
        await assert.rejects(assertServiceStartup(f.host, true), /not authorized/);
        f.host.authorizedStart = async () => true;
        const db = new DatabaseSync(join(f.directory, '.nerv-lifecycle/journal.sqlite'));
        const old = db.prepare('SELECT receipt FROM operations WHERE digest=?').get(p.digest) as { receipt: string };
        const changed = JSON.parse(old.receipt);
        changed.identity = '0'.repeat(64);
        db.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(JSON.stringify(changed), p.digest);
        await assert.rejects(assertServiceStartup(f.host, true), /not authorized/);
        db.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(old.receipt, p.digest);
        db.close();
      });
      await applyService(f.host, p, p.digest);
      await assertServiceStartup(f.host);
    } finally {
      f.close();
    }
  },
);
test(
  'review regression: moving executable source into documentation cannot hide its deletion in rename detection',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const git = (args: string[]) =>
        execFileSync(
          'git',
          [
            '-C',
            f.host.context.source,
            '-c',
            'user.name=Neutral Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            '-c',
            'commit.gpgsign=false',
            ...args,
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
      git(['init']);
      writeFileSync(join(f.host.context.source, 'reader.ts'), 'export const supported=[5,6];');
      git(['add', '.']);
      git(['commit', '-m', 'Neutral executable']);
      const base = git(['rev-parse', 'HEAD']);
      mkdirSync(join(f.host.context.source, 'docs'));
      git(['mv', 'reader.ts', 'docs/reader.ts']);
      git(['commit', '-m', 'Move executable into documentation']);
      const next = git(['rev-parse', 'HEAD']);
      git(['checkout', '--detach', base]);
      assert.equal(
        await lifecycle.compatibleServiceRevision(f.host.context, next),
        false,
        'deleted executable must be considered even if Git detects an unchanged rename',
      );
      assert.equal(git(['rev-parse', 'HEAD']), base);
    } finally {
      f.close();
    }
  },
);
test(
  'production command adapter joins manager parsing, process discovery, authenticated doctor and real backup files',
  supported,
  async () => {
    const f = serviceFixture();
    let server: Server | undefined;
    try {
      const reservation = createServer();
      await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
      const port = (reservation.address() as { port: number }).port;
      await new Promise<void>((done) => reservation.close(() => done()));
      const c = { ...f.host.context, node: join(f.directory, 'neutral-node') },
        keys = generateKeyPairSync('ed25519');
      writeFileSync(c.node, 'Neutral command-adapter executable metadata', { mode: 0o700 });
      writeFileSync(
        join(c.source, 'package.json'),
        JSON.stringify({ name: 'nerv-agency', engines: { node: '>=24.0.0' } }),
      );
      mkdirSync(join(c.source, 'src'), { recursive: true });
      writeFileSync(join(c.source, 'src/cli.ts'), '// Neutral CLI entrypoint\n');
      mkdirSync(join(c.source, 'dist/web/browser'), { recursive: true });
      writeFileSync(join(c.source, 'dist/web/browser/index.html'), '<html>Neutral fixture</html>');
      writeFileSync(join(c.home, 'base-key'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
      writeFileSync(
        join(c.home, 'base.pub'),
        keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      );
      chmodSync(join(c.home, 'base.pub'), 0o644);
      writeFileSync(join(c.home, 'token'), 'c'.repeat(32));
      writeFileSync(join(c.home, 'config.json'), JSON.stringify({ base: { id: 'BASE-01', name: 'Neutral' }, port }));
      const data = new DatabaseSync(f.data);
      data.exec(
        'CREATE TABLE worker_jobs(state TEXT);CREATE TABLE kaji_outbox(done TEXT);CREATE TABLE worker_legacy_outbox(state TEXT)',
      );
      data.close();
      let registered = false,
        extra = false,
        revision = 'a'.repeat(40);
      const calls: { program: string; args: string[] }[] = [];
      const manager = () =>
        [
          'path = ' + f.definition,
          'program = ' + c.node,
          'working directory = ' + c.source,
          'arguments = {',
          ...[c.node, ...NODE_FLAGS, join(c.source, 'src/cli.ts'), 'serve', ...(extra ? ['--unexpected'] : [])].map(
            (s) => '  ' + s,
          ),
          '}',
          'environment = {',
          '  NERV_HOME => ' + c.home,
          '}',
          'pid = 9999999',
        ].join('\n');
      const run = async (program: string, args: string[]) => {
        calls.push({ program, args });
        if (program === 'git') {
          const op = args[2];
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
                    : op === 'checkout'
                      ? (revision = args.at(-1)!)
                      : op === 'cat-file'
                        ? 'commit'
                        : '',
          };
        }
        if (program === 'ps')
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
        if (program === c.node) return { status: 0, err: '', out: 'v24.0.0\n' };
        if (program === 'npm' || program === 'tar') return { status: 0, err: '', out: '' };
        assert.equal(program, 'launchctl');
        if (args[0] === 'print') {
          if (args[1] === 'gui/' + c.uid) return { status: 0, err: '', out: 'Neutral GUI session' };
          return registered && args[1]?.endsWith('/io.nerv.agent')
            ? { status: 0, err: '', out: manager() }
            : { status: 113, err: 'Could not find service', out: '' };
        }
        if (args[0] === 'bootstrap') {
          assert.deepEqual(args, ['bootstrap', 'gui/' + c.uid, f.definition]);
          registered = true;
          server = createServer((req, res) => {
            assert.equal(req.url, '/api/doctor');
            assert.equal(req.headers.authorization, 'Bearer ' + 'c'.repeat(32));
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({
                base: { id: 'BASE-01' },
                build: { commit: revision },
                database: { quick_check: 'ok' },
                processes: { nervous: 9999998, brain: 9999997, brainAlive: true },
                models: { misato: 'neutral-local' },
              }),
            );
          });
          await new Promise<void>((done) => server!.listen(port, '127.0.0.1', done));
          return { status: 0, err: '', out: '' };
        }
        assert.deepEqual(args, ['bootout', 'gui/' + c.uid + '/io.nerv.agent']);
        registered = false;
        server!.closeIdleConnections();
        await new Promise<void>((done) => server!.close(() => done()));
        server = undefined;
        return { status: 0, err: '', out: '' };
      };
      const host = macServiceAdapter(c, run),
        plan = await planService(host, 'install');
      assert.deepEqual(plan.blockers, []);
      await applyService(host, plan, plan.digest);
      const observed = await host.inspect();
      assert.equal(observed.runtime, 'owned');
      assert.deepEqual(observed.pids, [9999998, 9999999]);
      assert.equal(macRegistrationMatches(manager(), c), true);
      extra = true;
      assert.equal((await host.inspect()).registration, 'foreign');
      assert.ok((await planService(host, 'stop')).blockers.length);
      extra = false;
      const stop = await planService(host, 'stop');
      await applyService(host, stop, stop.digest);
      const update = await planService(host, 'update', 'b'.repeat(40));
      await applyService(host, update, update.digest);
      const backup = join(f.directory, '.nerv-lifecycle/backups', update.digest);
      assert.equal(readFileSync(join(backup, 'base.pub'), 'utf8'), readFileSync(join(c.home, 'base.pub'), 'utf8'));
      assert.equal(lstatSync(join(backup, 'base-key')).mode & 0o777, 0o600);
      assert.equal(lstatSync(join(c.home, 'base.pub')).mode & 0o777, 0o644);
      assert.ok(JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8')).database);
      assert.ok(calls.some((r) => r.program === 'git' && r.args.includes('--name-only')));
      assert.ok(calls.some((r) => r.program === 'npm' && r.args.includes('--engine-strict')));
      const stopped = await planService(host, 'stop');
      await applyService(host, stopped, stopped.digest);
      const uninstall = await planService(host, 'uninstall');
      await applyService(host, uninstall, uninstall.digest);
      assert.equal(existsSync(f.definition), false);
      assert.equal(existsSync(f.data), true);
    } finally {
      if (server) {
        server.closeIdleConnections();
        await new Promise<void>((done) => server!.close(() => done()));
      }
      f.close();
    }
  },
);

test(
  'F-005-T08: prerequisite check (Node version, executable, non-interactive environment) joins install, start and update',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const c = { ...f.host.context, node: join(f.directory, 'neutral-node') },
        keys = generateKeyPairSync('ed25519');
      writeFileSync(c.node, 'Neutral executable', { mode: 0o700 });
      writeFileSync(
        join(c.source, 'package.json'),
        JSON.stringify({ name: 'nerv-agency', engines: { node: '>=24.0.0' } }),
      );
      mkdirSync(join(c.source, 'src'), { recursive: true });
      writeFileSync(join(c.source, 'src/cli.ts'), '// Neutral CLI\n');
      mkdirSync(join(c.source, 'dist/web/browser'), { recursive: true });
      writeFileSync(join(c.source, 'dist/web/browser/index.html'), '<html>Neutral</html>');
      writeFileSync(join(c.home, 'base-key'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
      writeFileSync(
        join(c.home, 'base.pub'),
        keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      );
      chmodSync(join(c.home, 'base.pub'), 0o644);
      writeFileSync(join(c.home, 'token'), 'c'.repeat(32));
      writeFileSync(join(c.home, 'config.json'), JSON.stringify({ base: { id: 'BASE-01', name: 'Neutral' }, port: 1 }));
      const data = new DatabaseSync(f.data);
      data.exec(
        'CREATE TABLE worker_jobs(state TEXT);CREATE TABLE kaji_outbox(done TEXT);CREATE TABLE worker_legacy_outbox(state TEXT)',
      );
      data.close();

      let nodeVersion = 'v24.0.0';
      let nodeExit = 0;
      let sessionOk = true;
      const run = async (program: string, args: string[]) => {
        if (program === c.node) return { status: nodeExit, err: '', out: nodeExit === 0 ? `${nodeVersion}\n` : '' };
        if (program === 'git') {
          const op = args[2];
          return {
            status: 0,
            err: '',
            out:
              op === 'rev-parse'
                ? 'a'.repeat(40)
                : op === 'remote'
                  ? 'https://github.com/voidbrain/nerv.git'
                  : op === 'diff'
                    ? 'README.md\0'
                    : op === 'cat-file'
                      ? 'commit'
                      : '',
          };
        }
        if (program === 'ps') return { status: 0, err: '', out: '' };
        if (program === 'launchctl' && args[0] === 'print' && args[1] === 'gui/' + c.uid) {
          return { status: sessionOk ? 0 : 1, err: '', out: '' };
        }
        if (program === 'launchctl' && args[0] === 'print') {
          return { status: 113, err: 'Could not find service', out: '' };
        }
        return { status: 0, err: '', out: '' };
      };

      const ok = await lifecycle.checkServicePrerequisites(c, run);
      assert.equal(ok.ok, true);
      assert.equal(ok.nodeVersion, 'v24.0.0');
      assert.equal(ok.executableOk, true);
      assert.equal(ok.nonInteractiveOk, true);
      assert.deepEqual(ok.issues, []);

      const host = macServiceAdapter(c, run);

      // 1. Outdated Node version blocks install, start and update
      nodeVersion = 'v22.11.0';
      for (const [action, rev] of [
        ['install', undefined],
        ['start', undefined],
        ['update', 'b'.repeat(40)],
      ] as const) {
        const plan = await planService(host, action, rev);
        assert.ok(plan.blockers.some((b) => b.includes('v22.11.0') && b.includes('>=24.0.0')));
        await assert.rejects(applyService(host, plan, plan.digest), /blocked/);
      }

      // 2. Non-executable / failing binary blocks install, start and update
      nodeVersion = 'v24.0.0';
      chmodSync(c.node, 0o600);
      nodeExit = 1;
      for (const [action, rev] of [
        ['install', undefined],
        ['start', undefined],
        ['update', 'b'.repeat(40)],
      ] as const) {
        const plan = await planService(host, action, rev);
        assert.ok(plan.blockers.some((b) => b.includes('not a regular executable file')));
        assert.ok(plan.blockers.some((b) => b.includes('failed non-interactive startup')));
        await assert.rejects(applyService(host, plan, plan.digest), /blocked/);
      }

      // 3. Unavailable non-interactive service environment blocks install, start and update
      chmodSync(c.node, 0o700);
      nodeExit = 0;
      sessionOk = false;
      for (const [action, rev] of [
        ['install', undefined],
        ['start', undefined],
        ['update', 'b'.repeat(40)],
      ] as const) {
        const plan = await planService(host, action, rev);
        assert.ok(plan.blockers.some((b) => b.includes('Non-interactive service environment is unavailable')));
        await assert.rejects(applyService(host, plan, plan.digest), /blocked/);
      }

      // 4. Stop and uninstall are not blocked by Node version/executable prerequisite checks
      sessionOk = true;
      nodeVersion = 'v22.11.0';
      const stopPlan = await planService(host, 'stop');
      assert.equal(
        stopPlan.blockers.some((b) => b.includes('>=24.0.0')),
        false,
      );
      const uninstallPlan = await planService(host, 'uninstall');
      assert.equal(
        uninstallPlan.blockers.some((b) => b.includes('>=24.0.0')),
        false,
      );
    } finally {
      f.close();
    }
  },
);
