import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  SERVICE_READER_SCHEMA,
  applyService,
  linuxServiceAdapter,
  linuxServiceHost,
  planService,
  releaseObservedService,
  serviceReceipt,
  type ServiceContext,
} from '../src/node-lifecycle-execution.ts';
import { renderService } from '../src/service.ts';

const supported = { skip: process.platform === 'win32' || process.getuid?.() === 0 };

async function makeLinuxEnv() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nerv-linux-service-')));
  const userHome = root;
  const home = join(root, '.nerv');
  const source = join(root, 'source');
  const unitPath = join(root, '.config/systemd/user/nerv.service');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(source, { recursive: true, mode: 0o700 });
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'nerv-agency', engines: { node: '>=24.0.0' } }));
  mkdirSync(join(source, 'src'), { recursive: true, mode: 0o700 });
  writeFileSync(join(source, 'src/cli.ts'), 'export {};\n');
  mkdirSync(join(source, 'dist/web/browser'), { recursive: true, mode: 0o700 });
  writeFileSync(join(source, 'dist/web/browser/index.html'), '<html></html>');

  execFileSync('git', ['-C', source, 'init']);
  execFileSync('git', ['-C', source, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', source, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', source, 'remote', 'add', 'origin', 'https://github.com/voidbrain/nerv.git']);
  execFileSync('git', ['-C', source, 'add', '-A']);
  execFileSync('git', ['-C', source, 'commit', '-m', 'init']);

  const db = new DatabaseSync(join(home, 'nerv.sqlite'));
  db.exec(
    'PRAGMA user_version = 5;' +
      'CREATE TABLE worker_jobs(state TEXT);' +
      'CREATE TABLE kaji_outbox(done TEXT);' +
      'CREATE TABLE worker_legacy_outbox(state TEXT);',
  );
  db.close();
  chmodSync(join(home, 'nerv.sqlite'), 0o600);

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubB64 = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
  writeFileSync(join(home, 'base-key'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(join(home, 'base.pub'), pubB64, { mode: 0o644 });
  writeFileSync(join(home, 'token'), 't'.repeat(32), { mode: 0o600 });

  let active = false;
  let registered = false;
  let serviceProc: ChildProcess | null = null;
  const server = createServer((req, res) => {
    if (!active) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        base: { id: 'LINUX-01' },
        build: { commit: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() },
        database: { quick_check: 'ok' },
        processes: { nervous: process.pid, brain: process.pid, brainAlive: true },
        models: {},
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ port, base: { id: 'LINUX-01', name: 'Linux Base' } }), {
    mode: 0o600,
  });

  const nodeBin = join(root, 'node-bin');
  writeFileSync(nodeBin, `#!/bin/sh\necho ${process.version}\n`, { mode: 0o755 });

  const context: ServiceContext = {
    userHome,
    home,
    source,
    node: nodeBin,
    uid: process.getuid!(),
  };

  let sessionAvailable = true;
  let failBuild = false;
  const systemctlCalls: string[][] = [];
  const loginctlCalls: string[][] = [];

  const run = async (
    program: string,
    args: string[],
    cwd?: string,
  ): Promise<{ status: number; out: string; err: string }> => {
    if (program === 'loginctl') {
      loginctlCalls.push(args);
      return { status: 1, out: '', err: 'unexpected loginctl' };
    }
    if (program === 'systemctl') {
      systemctlCalls.push(args);
      if (args[0] !== '--user') {
        return { status: 1, out: '', err: 'system-wide systemctl is forbidden' };
      }
      if (args[1] === 'show-environment') {
        return sessionAvailable
          ? { status: 0, out: 'PATH=/usr/bin', err: '' }
          : { status: 1, out: '', err: 'Failed to connect to bus' };
      }
      if (args[1] === 'daemon-reload') {
        return { status: 0, out: '', err: '' };
      }
      if (args[1] === 'enable' && args[2] === '--now' && args[3] === 'nerv.service') {
        registered = true;
        active = true;
        serviceProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        return { status: 0, out: '', err: '' };
      }
      if (args[1] === 'disable' && args[2] === '--now' && args[3] === 'nerv.service') {
        registered = false;
        active = false;
        if (serviceProc && !serviceProc.killed) {
          serviceProc.kill('SIGKILL');
          await new Promise<void>((resolve) => serviceProc!.once('exit', () => resolve()));
        }
        serviceProc = null;
        return { status: 0, out: '', err: '' };
      }
      if (args[1] === 'show') {
        const unit = args[args.length - 1];
        if (unit !== 'nerv.service' || !registered) {
          return { status: 0, out: 'LoadState=not-found\n', err: '' };
        }
        return {
          status: 0,
          out: [
            'LoadState=loaded',
            `ActiveState=${active ? 'active' : 'inactive'}`,
            `SubState=${active ? 'running' : 'dead'}`,
            `MainPID=${active && serviceProc?.pid ? serviceProc.pid : 0}`,
            `ExecStart=${context.node} ${join(context.source, 'src/cli.ts')} serve`,
            `WorkingDirectory=${context.source}`,
            `Environment=NERV_HOME=${context.home}`,
          ].join('\n'),
          err: '',
        };
      }
      return { status: 1, out: '', err: 'unsupported systemctl call' };
    }
    if (program === 'ps') {
      return { status: 0, out: '', err: '' };
    }
    if (program === 'git') {
      try {
        const out = execFileSync('git', args, { cwd, encoding: 'utf8' });
        return { status: 0, out, err: '' };
      } catch (e) {
        return { status: 1, out: '', err: e instanceof Error ? e.message : 'git error' };
      }
    }
    if (program === 'tar') {
      try {
        const out = execFileSync('tar', args, { cwd, encoding: 'utf8' });
        return { status: 0, out, err: '' };
      } catch (e) {
        return { status: 1, out: '', err: e instanceof Error ? e.message : 'tar error' };
      }
    }
    if (program === 'npm') {
      if (failBuild && args.includes('build')) return { status: 1, out: '', err: 'build failed' };
      return { status: 0, out: '', err: '' };
    }
    if (program === context.node) {
      if (args.includes('--version')) return { status: 0, out: process.version + '\n', err: '' };
      try {
        const out = execFileSync(process.execPath, args, { cwd, encoding: 'utf8' });
        return { status: 0, out, err: '' };
      } catch (e) {
        return { status: 1, out: '', err: e instanceof Error ? e.message : 'node error' };
      }
    }
    return { status: 1, out: '', err: 'unexpected command' };
  };

  const host = linuxServiceAdapter(context, run, unitPath);
  return {
    root,
    context,
    unitPath,
    host,
    systemctlCalls,
    loginctlCalls,
    setSession: (ok: boolean) => {
      sessionAvailable = ok;
    },
    setFailBuild: (fail: boolean) => {
      failBuild = fail;
    },
    close: async () => {
      if (serviceProc && !serviceProc.killed) serviceProc.kill('SIGKILL');
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test(
  'F-005-T10: Linux user-service adapter installs, stops and uninstalls via systemd --user without linger or system-wide systemctl',
  supported,
  async () => {
    const env = await makeLinuxEnv();
    try {
      assert.deepEqual(serviceReceipt(env.host, 'a'.repeat(64)), { state: 'absent' });
      const installPlan = await planService(env.host, 'install');
      assert.equal(installPlan.kind, 'linux-service');
      assert.deepEqual(installPlan.blockers, []);

      const installed = await applyService(env.host, installPlan, installPlan.digest);
      assert.equal(installed.state, 'completed');
      assert.equal(installed.resource, `user-service:${env.context.uid}:linux`);
      assert.equal(
        readFileSync(env.unitPath, 'utf8'),
        renderService('linux', env.context.home, env.context.source, env.context.node),
      );
      assert.equal(await env.host.authorizedStart!(installPlan), false);

      // Replay must be cached and must not re-register.
      const callsBeforeReplay = env.systemctlCalls.length;
      assert.deepEqual(await applyService(env.host, installPlan, installPlan.digest), installed);
      assert.equal(env.systemctlCalls.length, callsBeforeReplay);

      const stopPlan = await planService(env.host, 'stop');
      assert.deepEqual(stopPlan.blockers, []);
      const stopped = await applyService(env.host, stopPlan, stopPlan.digest);
      assert.equal(stopped.state, 'completed');

      const uninstallPlan = await planService(env.host, 'uninstall');
      assert.deepEqual(uninstallPlan.blockers, []);
      const removed = await applyService(env.host, uninstallPlan, uninstallPlan.digest);
      assert.equal(removed.state, 'completed');
      assert.equal(existsSync(env.unitPath), false);

      assert.equal(env.loginctlCalls.length, 0);
      assert.ok(env.systemctlCalls.every((args) => args[0] === '--user'));
      assert.ok(!env.systemctlCalls.some((args) => args.join(' ').includes('linger')));
    } finally {
      await env.close();
    }
  },
);

test(
  'F-005-T10: Linux user-service adapter blocks missing systemd --user session and foreign unit files',
  supported,
  async () => {
    const env = await makeLinuxEnv();
    try {
      env.setSession(false);
      const noSessionPlan = await planService(env.host, 'install');
      assert.ok(noSessionPlan.blockers.some((b) => /user service session/i.test(b)));

      env.setSession(true);
      mkdirSync(join(env.root, '.config/systemd/user'), { recursive: true, mode: 0o700 });
      writeFileSync(env.unitPath, '[Unit]\nDescription=Foreign\n', { mode: 0o600 });
      const foreignPlan = await planService(env.host, 'install');
      assert.ok(foreignPlan.blockers.some((b) => /ownership|absent/i.test(b)));
    } finally {
      await env.close();
    }
  },
);

test('F-005-T10: linuxServiceHost refuses non-Linux or additional profiles', () => {
  if (process.platform !== 'linux') {
    assert.throws(() => linuxServiceHost('/tmp/.nerv'), /Linux/);
  } else {
    assert.throws(() => linuxServiceHost('/tmp/other-profile'), /additional or legacy/);
  }
});

test('F-005-T25: Linux update and recovery (backup, rehearsal, checkout, refusal and release)', supported, async () => {
  const env = await makeLinuxEnv();
  try {
    const gitSync = (...args: string[]) =>
      execFileSync('git', ['-C', env.context.source, ...args], { encoding: 'utf8' }).trim();
    const readerScript = (raiseSchema: boolean) =>
      `import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
try {
  ${raiseSchema ? `db.exec('PRAGMA user_version = ${SERVICE_READER_SCHEMA + 1};');` : `db.prepare('SELECT count(*) FROM worker_jobs').get();`}
} finally { db.close(); }\n`;
    writeFileSync(join(env.context.source, 'src/upgrade-reader.ts'), readerScript(false));
    gitSync('add', '-A');
    gitSync('commit', '-m', 'base with reader');
    const rev1 = gitSync('rev-parse', 'HEAD');

    writeFileSync(join(env.context.source, 'src/cli.ts'), 'export const v = 2;\n');
    gitSync('add', 'src/cli.ts');
    gitSync('commit', '-m', 'v2');
    const rev2 = gitSync('rev-parse', 'HEAD');

    writeFileSync(join(env.context.source, 'src/upgrade-reader.ts'), readerScript(true));
    gitSync('add', 'src/upgrade-reader.ts');
    gitSync('commit', '-m', 'schema raise');
    const revSchema = gitSync('rev-parse', 'HEAD');

    gitSync('checkout', '-q', rev1);

    const installPlan = await planService(env.host, 'install');
    await applyService(env.host, installPlan, installPlan.digest);
    const stopPlan = await planService(env.host, 'stop');
    await applyService(env.host, stopPlan, stopPlan.digest);

    // 1. Successful update
    const updatePlan = await planService(env.host, 'update', rev2);
    assert.deepEqual(updatePlan.blockers, []);
    const updateReceipt = await applyService(env.host, updatePlan, updatePlan.digest);
    assert.equal(updateReceipt.state, 'completed');
    assert.equal(gitSync('rev-parse', 'HEAD'), rev2);
    assert.ok(
      existsSync(join(env.context.userHome, '.nerv-lifecycle', 'backups', updatePlan.digest, 'database.sqlite')),
    );
    assert.deepEqual(updateReceipt.rehearsal?.blockers, []);

    // 2. Refused update on schema raise
    const stop2 = await planService(env.host, 'stop');
    await applyService(env.host, stop2, stop2.digest);
    const schemaPlan = await planService(env.host, 'update', revSchema);
    const schemaReceipt = await applyService(env.host, schemaPlan, schemaPlan.digest);
    assert.equal(schemaReceipt.state, 'refused');
    assert.equal(gitSync('rev-parse', 'HEAD'), rev2);

    // 3. Failed build leaves uncertain receipt with Linux recovery steps and releaseObservedService clears it
    gitSync('checkout', '-q', rev1);
    env.setFailBuild(true);
    const failPlan = await planService(env.host, 'update', rev2);
    await assert.rejects(
      () => applyService(env.host, failPlan, failPlan.digest),
      /Service build did not confirm completion/,
    );
    const failReceipt = serviceReceipt(env.host, failPlan.digest);
    assert.ok('digest' in failReceipt && failReceipt.state === 'uncertain');
    assert.ok(failReceipt.recovery?.some((s) => s.includes('systemctl --user status nerv.service')));
    const jdb = new DatabaseSync(join(env.context.userHome, '.nerv-lifecycle', 'journal.sqlite'));
    try {
      const updated = { ...failReceipt, pid: 999999 };
      jdb.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(JSON.stringify(updated), failReceipt.digest);
      jdb.prepare('UPDATE resource SET pid=? WHERE id=1').run(999999);
    } finally {
      jdb.close();
    }
    const released = await releaseObservedService(
      env.host,
      { ...failReceipt, pid: 999999 },
      {
        digest: failReceipt.digest,
        resource: failReceipt.resource,
        fence: failReceipt.fence,
        nonce: failReceipt.nonce,
        handlerStopped: true,
        descendantsStopped: true,
        operatorConfirmed: true,
        reason: 'Verified systemd user unit inactive and restored previous checkout',
      },
    );
    assert.equal(released.state, 'released');
  } finally {
    await env.close();
  }
});
