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
import {
  SERVICE_READER_SCHEMA,
  applyService,
  planService,
  serviceReceipt,
  windowsRegistrationMatches,
  windowsServiceAdapter,
  type ServiceContext,
} from '../src/node-lifecycle-execution.ts';
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
    rmSync(root, { recursive: true, force: true });
  }
});
