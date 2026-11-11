import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { readToken } from '../src/config.ts';
test(
  'one headless process serves UI and reminders, exits cleanly, and recovers after restart',
  { timeout: 15000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-process-'));
    let child: ChildProcess | undefined;
    const env: NodeJS.ProcessEnv = { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' };
    for (const k of ['NERV_TOKEN', 'NERV_PORT', 'NODO_HOME', 'NODO_TOKEN', 'NODO_PORT']) delete env[k];
    const reservation = createServer();
    await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
    const address = reservation.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    await new Promise<void>((done) => reservation.close(() => done()));
    const launch = async () => {
      const processChild = spawn(process.execPath, ['src/cli.ts', 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      child = processChild;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Nodo startup timed out')), 5000);
        processChild.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error('Nodo exited during startup: ' + code));
        });
        processChild.stdout!.once('data', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return processChild;
    };
    const stop = async (c: ChildProcess) => {
      const exited = once(c, 'exit');
      c.kill('SIGTERM');
      const [code] = await exited;
      assert.equal(code, 0);
    };
    try {
      const initialized = spawnSync(process.execPath, ['src/cli.ts', 'init'], { env, encoding: 'utf8' });
      assert.equal(initialized.status, 0, initialized.stderr);
      writeFileSync(join(home, 'config.json'), JSON.stringify({ port, language: 'it', timeZone: 'Europe/Rome' }));
      const headers = { Authorization: 'Bearer ' + readToken(home), 'Content-Type': 'application/json' };
      const base = `http://127.0.0.1:${port}`;
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({ port, language: 'it', timeZone: 'Europe/Rome', base: { id: 'NERV-02', name: 'Tabgha' } }),
      );
      const first = await launch();
      assert.match(await (await fetch(base)).text(), /nerv-app/);
      // open: the CLI asks the running service for a login code; the page's exchange returns a dashboard session once (F-039), never the admin token.
      const opened = spawnSync(process.execPath, ['src/cli.ts', 'open', '--print'], { env, encoding: 'utf8' });
      assert.equal(opened.status, 0, opened.stderr);
      const code = /#code=([a-f0-9]{32})/.exec(opened.stdout)![1];
      assert.ok(!opened.stdout.includes(readToken(home)), 'the token never appears in the URL');
      const swapped = await fetch(base + '/api/session/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const session = ((await swapped.json()) as { token: string }).token;
      assert.match(session, /^[a-f0-9]{64}$/);
      assert.notEqual(session, readToken(home));
      assert.equal(
        (await fetch(base + '/api/doctor', { headers: { authorization: 'Bearer ' + session } })).status,
        200,
        'the session signs the dashboard in',
      );
      const revoked = spawnSync(process.execPath, ['src/cli.ts', 'sessions', 'revoke'], { env, encoding: 'utf8' });
      assert.equal(revoked.status, 0, revoked.stderr);
      assert.match(revoked.stdout, /^1 dashboard session\(s\) ended/);
      assert.equal(
        (await fetch(base + '/api/doctor', { headers: { authorization: 'Bearer ' + session } })).status,
        401,
        'sessions revoke ends it',
      );
      const dashboard = spawnSync(process.execPath, ['src/cli.ts', 'open', 'dashboard', '--print'], {
        env,
        encoding: 'utf8',
      });
      assert.match(dashboard.stdout, /\/dashboard\/#code=[a-f0-9]{32}/);
      assert.match(
        await (await fetch(base + '/dashboard/')).text(),
        /<script src="live\.js"><\/script>/,
        'the built dashboard is served with its live adapter',
      );
      const health = await (await fetch(base + '/api/doctor', { headers })).json();
      assert.deepEqual(health.base, { id: 'NERV-02', name: 'Tabgha' }, 'doctor names this base');
      const pids = [health.processes.nervous, health.processes.brain] as number[];
      assert.equal(new Set(pids).size, 2);
      const due = new Date(Date.now() + 1500).toISOString();
      assert.equal(
        (
          await fetch(base + '/api/reminders', {
            method: 'POST',
            headers,
            body: JSON.stringify({ title: 'Promemoria di prova', due }),
          })
        ).status,
        201,
      );
      await stop(first);
      child = undefined;
      for (const pid of pids) assert.throws(() => process.kill(pid, 0));
      await new Promise((done) => setTimeout(done, 1600));
      const second = await launch();
      assert.equal((await (await fetch(base + '/api/inbox', { headers })).json()).length, 1);
      await stop(second);
      child = undefined;
      const third = await launch();
      assert.equal((await (await fetch(base + '/api/inbox', { headers })).json()).length, 1);
      await stop(third);
      child = undefined;
      const failing = await launch();
      const failureHealth = await (await fetch(base + '/api/doctor', { headers })).json();
      const exited = once(failing, 'exit');
      process.kill(failureHealth.processes.nervous, 'SIGKILL');
      const [failureCode] = await exited;
      assert.equal(failureCode, 1);
      child = undefined;
      assert.throws(() => process.kill(failureHealth.processes.brain, 0));
      const recovered = await launch();
      assert.equal((await (await fetch(base + '/api/inbox', { headers })).json()).length, 1);
      await stop(recovered);
      child = undefined;
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
      rmSync(home, { recursive: true, force: true });
    }
  },
);
test('launch serves and opens the live dashboard signed in (printed with --print)', { timeout: 15000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-launch-'));
  const env: NodeJS.ProcessEnv = { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' };
  for (const k of ['NERV_TOKEN', 'NERV_PORT']) delete env[k];
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  spawnSync(process.execPath, ['src/cli.ts', 'init'], { env });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ port }));
  const child = spawn(process.execPath, ['src/cli.ts', 'launch', '--print'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  try {
    const end = Date.now() + 8000;
    while (!/#code=/.test(out)) {
      if (Date.now() > end) throw new Error('no dashboard link: ' + out);
      await new Promise((d) => setTimeout(d, 50));
    }
    assert.match(out, new RegExp(`NERV Agency NERV-01 · Neo Tokyo-3: http://127\\.0\\.0\\.1:${port}`));
    assert.match(out, new RegExp(`http://127\\.0\\.0\\.1:${port}/dashboard/#code=[a-f0-9]{32}`));
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
});
