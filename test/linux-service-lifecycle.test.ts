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
  applyService,
  linuxServiceAdapter,
  linuxServiceHost,
  planService,
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
  const revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

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
        build: { commit: revision },
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
    if (program === context.node) {
      return { status: 0, out: process.version + '\n', err: '' };
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
