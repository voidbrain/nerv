import { test } from 'node:test';
import assert from 'node:assert/strict';
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  SERVICE_READER_SCHEMA,
  applyService,
  planService,
  releaseObservedService,
  serviceReceipt,
  windowsRegistrationMatches,
  windowsServiceAdapter,
  type ServiceContext,
} from '../src/node-lifecycle-execution.ts';

const execFile = promisify(execFileCb);
import { databasePath, defaultBase, defaults } from '../src/config.ts';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';

const SHA_A = 'a'.repeat(40);

function makeFixture(port: number) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nerv-win-lifecycle-')));
  const userHome = join(root, 'user');
  const home = join(userHome, '.nerv');
  const source = join(root, 'source');
  const nodeBin = join(root, 'node-bin');
  mkdirSync(userHome, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(join(source, 'dist/web/browser'), { recursive: true, mode: 0o755 });
  mkdirSync(join(source, 'src'), { recursive: true, mode: 0o755 });
  writeFileSync(join(source, 'dist/web/browser/index.html'), '<html></html>\n', { mode: 0o644 });
  writeFileSync(join(source, 'package.json'), JSON.stringify({ engines: { node: '>=24.0.0' } }), { mode: 0o644 });
  writeFileSync(join(source, 'src/cli.ts'), '// stub\n', { mode: 0o644 });
  writeFileSync(nodeBin, '#!/bin/sh\necho "v24.0.0"\n', { mode: 0o755 });
  chmodSync(nodeBin, 0o755);

  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeFileSync(join(home, 'base-key'), pair.privateKey, { mode: 0o600 });
  writeFileSync(join(home, 'base.pub'), pair.publicKey.toString('base64'), { mode: 0o644 });
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ ...defaults, port, kaji: { root: pair.publicKey.toString('base64'), rootBinding: true } }),
    { mode: 0o600 },
  );
  writeFileSync(join(home, 'token'), 't'.repeat(32), { mode: 0o600 });

  const db = new DatabaseSync(databasePath(home));
  try {
    db.exec(
      `PRAGMA user_version = ${SERVICE_READER_SCHEMA};
       CREATE TABLE worker_jobs(id TEXT PRIMARY KEY, state TEXT NOT NULL);
       CREATE TABLE kaji_outbox(id TEXT PRIMARY KEY, done TEXT);
       CREATE TABLE worker_legacy_outbox(id TEXT PRIMARY KEY, state TEXT NOT NULL);`,
    );
  } finally {
    db.close();
  }

  const uid = process.getuid?.() ?? 0;
  const context: ServiceContext = { userHome, home, source, node: nodeBin, uid };
  return { root, context };
}

test('windowsRegistrationMatches verifies NERV Agency task with wscript and owned launcher path', () => {
  const c: ServiceContext = {
    userHome: 'C:\\Users\\tester',
    home: 'C:\\Users\\tester\\.nerv',
    source: 'C:\\Users\\tester\\nerv',
    node: 'C:\\Program Files\\nodejs\\node.exe',
    uid: 0,
  };
  const ownedOutput = [
    'TaskName:                             \\NERV Agency',
    'Status:                               Ready',
    'Task To Run:                          wscript.exe //B //Nologo "C:\\Users\\tester\\.nerv\\nerv-service.vbs"',
  ].join('\r\n');
  assert.equal(windowsRegistrationMatches(ownedOutput, c), true);

  const foreignOutput = [
    'TaskName:                             \\NERV Agency',
    'Task To Run:                          wscript.exe //B //Nologo "C:\\Other\\.nerv\\nerv-service.vbs"',
  ].join('\r\n');
  assert.equal(windowsRegistrationMatches(foreignOutput, c), false);
});

test('windowsServiceAdapter executes install, status, start, stop and uninstall under the fencing journal', async () => {
  let registered = false;
  let running = false;
  const doctorServer = createServer((req, res) => {
    if (!running || req.url !== '/api/doctor') {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        base: defaultBase,
        build: { commit: SHA_A },
        database: { quick_check: 'ok' },
        processes: { nervous: 1, brain: 2, brainAlive: true },
        models: {},
      }),
    );
  });
  await new Promise<void>((resolve) => doctorServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = doctorServer.address();
  if (!addr || typeof addr === 'string') throw new Error('Expected TCP port.');
  const { root, context } = makeFixture(addr.port);
  try {
    const calls: string[] = [];

    const run = async (program: string, args: string[]) => {
      calls.push(`${program} ${args.join(' ')}`);
      if (program === context.node) {
        return { status: 0, out: args.includes('--version') ? 'v24.0.0\n' : '', err: '' };
      }
      if (program === 'git') {
        if (args.includes('rev-parse')) return { status: 0, out: `${SHA_A}\n`, err: '' };
        if (args.includes('get-url')) return { status: 0, out: 'https://github.com/voidbrain/nerv.git\n', err: '' };
        if (args.includes('status')) return { status: 0, out: '', err: '' };
        return { status: 0, out: '', err: '' };
      }
      if (program === 'schtasks') {
        const op = args[0];
        if (op === '/Query') {
          if (!registered) {
            return { status: 1, out: '', err: 'ERROR: The system cannot find the file specified.' };
          }
          const taskToRun = `wscript.exe //B //Nologo "${join(context.home, 'nerv-service.vbs')}"`;
          return {
            status: 0,
            out: `TaskName: \\NERV Agency\r\nStatus: ${running ? 'Running' : 'Ready'}\r\nTask To Run: ${taskToRun}\r\n`,
            err: '',
          };
        }
        if (op === '/Create') {
          registered = true;
          return { status: 0, out: 'SUCCESS', err: '' };
        }
        if (op === '/Run') {
          running = true;
          return { status: 0, out: 'SUCCESS', err: '' };
        }
        if (op === '/End') {
          running = false;
          return { status: 0, out: 'SUCCESS', err: '' };
        }
        if (op === '/Delete') {
          registered = false;
          running = false;
          return { status: 0, out: 'SUCCESS', err: '' };
        }
      }
      if (program === 'powershell') {
        return {
          status: 0,
          out: running ? `99999|1|node.exe|"${context.node}" ${join(context.source, 'src', 'cli.ts')} serve\r\n` : '',
          err: '',
        };
      }
      if (program === 'taskkill') {
        running = false;
        return { status: 0, out: 'SUCCESS', err: '' };
      }
      return { status: 1, out: '', err: `unexpected ${program}` };
    };

    const host = windowsServiceAdapter(context, run);
    assert.equal(host.kind, 'windows-service');

    // 1. Install
    const installPlan = await planService(host, 'install');
    assert.equal(installPlan.kind, 'windows-service');
    assert.deepEqual(installPlan.blockers, []);
    const installReceipt = await applyService(host, installPlan, installPlan.digest);
    assert.equal(installReceipt.state, 'completed');
    assert.equal(installReceipt.fence, 1);
    assert.equal(installReceipt.resource, `user-service:${context.uid}:win32`);
    assert.ok(existsSync(join(context.home, 'nerv-task.xml')));
    assert.ok(existsSync(join(context.home, 'nerv-service.vbs')));
    assert.equal(
      readFileSync(join(context.home, 'nerv-task.xml'))
        .subarray(0, 2)
        .equals(Buffer.from([0xff, 0xfe])),
      true,
    );

    // 2. Status inspection + receipt lookup
    const inspected = await host.inspect();
    assert.equal(inspected.definition, 'owned');
    assert.equal(inspected.registration, 'owned');
    const stored = serviceReceipt(host, installPlan.digest);
    assert.ok('digest' in stored && stored.state === 'completed');

    // 3. Stop
    const stopPlan = await planService(host, 'stop');
    assert.deepEqual(stopPlan.blockers, []);
    const stopReceipt = await applyService(host, stopPlan, stopPlan.digest);
    assert.equal(stopReceipt.state, 'completed');
    assert.equal(stopReceipt.fence, 2);
    assert.equal((await host.inspect()).registration, 'absent');

    // 4. Start
    const startPlan = await planService(host, 'start');
    assert.deepEqual(startPlan.blockers, []);
    const startReceipt = await applyService(host, startPlan, startPlan.digest);
    assert.equal(startReceipt.state, 'completed');
    assert.equal(startReceipt.fence, 3);
    assert.equal((await host.inspect()).registration, 'owned');

    // 5. Stop + Uninstall
    const stopPlan2 = await planService(host, 'stop');
    const stopReceipt2 = await applyService(host, stopPlan2, stopPlan2.digest);
    assert.equal(stopReceipt2.fence, 4);

    const uninstallPlan = await planService(host, 'uninstall');
    assert.deepEqual(uninstallPlan.blockers, []);
    const uninstallReceipt = await applyService(host, uninstallPlan, uninstallPlan.digest);
    assert.equal(uninstallReceipt.state, 'completed');
    assert.equal(uninstallReceipt.fence, 5);
    assert.equal(existsSync(join(context.home, 'nerv-task.xml')), false);
    assert.equal(existsSync(join(context.home, 'nerv-service.vbs')), false);
    assert.ok(calls.some((c) => c.startsWith('schtasks /Create /TN NERV Agency')));
    assert.ok(calls.some((c) => c.startsWith('schtasks /Delete /TN NERV Agency')));
  } finally {
    await new Promise<void>((resolve) => doctorServer.close(() => resolve()));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

// Spawns git and Node schema-check subprocesses across three update cycles; allow extra time on Windows CI.
test(
  'F-005-T23: Windows update and recovery (backup, rehearsal, checkout, refusal and release)',
  { timeout: process.platform === 'win32' ? 90000 : 60000 },
  async () => {
    let registered = false;
    let running = false;
    let failBuild = false;
    let doctorCommit = '';

    const doctorServer = createServer((req, res) => {
      if (!running || req.url !== '/api/doctor') {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          base: defaultBase,
          build: { commit: doctorCommit },
          database: { quick_check: 'ok' },
          processes: { nervous: 1, brain: 2, brainAlive: true },
          models: {},
        }),
      );
    });
    await new Promise<void>((resolve) => doctorServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = doctorServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Expected TCP port.');
    const { root, context } = makeFixture(addr.port);
    try {
      const gitSync = (...args: string[]) =>
        execFileSync('git', ['-C', context.source, ...args], { encoding: 'utf8' }).trim();
      gitSync('init', '-b', 'main');
      gitSync('config', 'user.name', 'Test');
      gitSync('config', 'user.email', 'test@example.com');
      gitSync('remote', 'add', 'origin', 'https://github.com/voidbrain/nerv.git');
      const readerScript = (raiseSchema: boolean) =>
        `import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
try {
  ${raiseSchema ? `db.exec('PRAGMA user_version = ${SERVICE_READER_SCHEMA + 1};');` : `db.prepare('SELECT count(*) FROM worker_jobs').get();`}
} finally { db.close(); }\n`;
      writeFileSync(join(context.source, 'src/upgrade-reader.ts'), readerScript(false));
      gitSync('add', '-A');
      gitSync('commit', '-m', 'base');
      const rev1 = gitSync('rev-parse', 'HEAD');
      doctorCommit = rev1;

      writeFileSync(join(context.source, 'src/cli.ts'), '// v2\n');
      gitSync('add', 'src/cli.ts');
      gitSync('commit', '-m', 'v2');
      const rev2 = gitSync('rev-parse', 'HEAD');

      writeFileSync(join(context.source, 'src/upgrade-reader.ts'), readerScript(true));
      gitSync('add', 'src/upgrade-reader.ts');
      gitSync('commit', '-m', 'schema raise');
      const revSchema = gitSync('rev-parse', 'HEAD');

      gitSync('checkout', '-q', rev1);

      const run = async (
        program: string,
        args: string[],
        cwd?: string,
        _timeout?: number,
        extraEnv?: Record<string, string>,
      ) => {
        if (program === 'git' || program === 'tar' || program === context.node) {
          if (program === context.node && args.includes('--version')) return { status: 0, out: 'v24.0.0\n', err: '' };
          try {
            const { stdout, stderr } = await execFile(program === context.node ? process.execPath : program, args, {
              cwd,
              env: { ...process.env, ...extraEnv },
            });
            if (program === 'git' && args.includes('checkout')) {
              doctorCommit = gitSync('rev-parse', 'HEAD');
            }
            return { status: 0, out: stdout, err: stderr };
          } catch (e: unknown) {
            const err = e as { code?: number; stdout?: string; stderr?: string };
            return { status: err.code ?? 1, out: err.stdout ?? '', err: err.stderr ?? '' };
          }
        }
        if (program === 'npm' || program.toLowerCase().endsWith('cmd.exe')) {
          if (failBuild && args.join(' ').includes('build')) return { status: 1, out: '', err: 'build failed' };
          return { status: 0, out: '', err: '' };
        }
        if (program === 'schtasks') {
          const op = args[0];
          if (op === '/Query') {
            if (!registered) return { status: 1, out: '', err: 'The system cannot find the file specified.' };
            const taskToRun = `wscript.exe //B //Nologo "${join(context.home, 'nerv-service.vbs')}"`;
            return {
              status: 0,
              out: `TaskName: \\NERV Agency\r\nStatus: ${running ? 'Running' : 'Ready'}\r\nTask To Run: ${taskToRun}\r\n`,
              err: '',
            };
          }
          if (op === '/Create') {
            registered = true;
            return { status: 0, out: 'SUCCESS', err: '' };
          }
          if (op === '/Run') {
            running = true;
            return { status: 0, out: 'SUCCESS', err: '' };
          }
          if (op === '/End') {
            running = false;
            return { status: 0, out: 'SUCCESS', err: '' };
          }
          if (op === '/Delete') {
            registered = false;
            running = false;
            return { status: 0, out: 'SUCCESS', err: '' };
          }
        }
        if (program === 'powershell') {
          return {
            status: 0,
            out: running ? `99999|1|node.exe|"${context.node}" ${join(context.source, 'src', 'cli.ts')} serve\r\n` : '',
            err: '',
          };
        }
        if (program === 'taskkill') {
          running = false;
          return { status: 0, out: 'SUCCESS', err: '' };
        }
        return { status: 1, out: '', err: `unexpected ${program}` };
      };

      const host = windowsServiceAdapter(context, run);
      const installPlan = await planService(host, 'install');
      assert.deepEqual(installPlan.blockers, []);
      await applyService(host, installPlan, installPlan.digest);
      const stopPlan = await planService(host, 'stop');
      await applyService(host, stopPlan, stopPlan.digest);

      // 1. Successful update: backup + rehearsal + checkout + build + register + health
      const updatePlan = await planService(host, 'update', rev2);
      assert.deepEqual(updatePlan.blockers, []);
      const updateReceipt = await applyService(host, updatePlan, updatePlan.digest);
      assert.equal(updateReceipt.state, 'completed');
      assert.equal(gitSync('rev-parse', 'HEAD'), rev2);
      assert.ok(existsSync(join(context.userHome, '.nerv-lifecycle', 'backups', updatePlan.digest, 'database.sqlite')));
      assert.deepEqual(updateReceipt.rehearsal?.blockers, []);

      // 2. Refused update when candidate reader raises schema version
      const stop2 = await planService(host, 'stop');
      await applyService(host, stop2, stop2.digest);
      const schemaPlan = await planService(host, 'update', revSchema);
      const schemaReceipt = await applyService(host, schemaPlan, schemaPlan.digest);
      assert.equal(schemaReceipt.state, 'refused');
      assert.equal(gitSync('rev-parse', 'HEAD'), rev2);

      // 3. Failed build leaves uncertain receipt with Windows recovery steps; releaseService clears it once stopped
      gitSync('checkout', '-q', rev1);
      doctorCommit = rev1;
      failBuild = true;
      const failPlan = await planService(host, 'update', rev2);
      await assert.rejects(
        () => applyService(host, failPlan, failPlan.digest),
        /Service build did not confirm completion/,
      );
      const failReceipt = serviceReceipt(host, failPlan.digest);
      assert.ok('digest' in failReceipt && failReceipt.state === 'uncertain');
      assert.ok(failReceipt.recovery?.some((s) => s.includes('schtasks /Query')));
      const evidence = {
        digest: failReceipt.digest,
        resource: failReceipt.resource,
        fence: failReceipt.fence,
        nonce: failReceipt.nonce,
        handlerStopped: true,
        descendantsStopped: true,
        operatorConfirmed: true,
        reason: 'Verified Windows task absent and restored previous checkout',
      };
      // Simulate handler process exited; releaseObservedService succeeds once task is unregistered/stopped.
      const jdb = new DatabaseSync(join(context.userHome, '.nerv-lifecycle', 'journal.sqlite'));
      try {
        const updated = { ...failReceipt, pid: 999999 };
        jdb.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(JSON.stringify(updated), failReceipt.digest);
        jdb.prepare('UPDATE resource SET pid=? WHERE id=1').run(999999);
      } finally {
        jdb.close();
      }
      const released = await releaseObservedService(host, { ...failReceipt, pid: 999999 }, evidence);
      assert.equal(released.state, 'released');
    } finally {
      await new Promise<void>((resolve) => doctorServer.close(() => resolve()));
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  },
);
