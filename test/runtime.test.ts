import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { POSIX, assertPrivateFile } from './fixtures/posix.ts';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialize, readConfig, readToken, dataHome, databasePath, setting } from '../src/config.ts';
import { renderService } from '../src/service.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { messages } from '../web/src/i18n.ts';
test('init preserves credentials and configuration; English/Rome defaults and private files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-config-'));
  try {
    initialize(dir);
    const token = readToken(dir);
    assert.equal(token.length, 64);
    assert.deepEqual(readConfig(dir), {
      port: 4317,
      language: 'en',
      timeZone: 'Europe/Rome',
      models: {},
      base: { id: 'NERV-01', name: 'Neo Tokyo-3' },
    });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port: 4900, language: 'en', timeZone: 'UTC' }));
    initialize(dir);
    assert.equal(readToken(dir), token);
    assert.equal(readConfig(dir).port, 4900);
    assertPrivateFile(join(dir, 'token'));
    writeFileSync(join(dir, 'config.json'), '{"language":"xx"}');
    assert.throws(() => readConfig(dir));
    writeFileSync(join(dir, 'config.json'), '{"timeZone":"Not/AZone"}');
    assert.throws(() => readConfig(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('service definitions use absolute paths, encode special characters, and contain no credentials', () => {
  const plist = renderService('darwin', '/Users/name/Nodo & data', '/Users/name/Code/Nodo', '/opt/node');
  assert.match(plist, /Nodo &amp; data/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.doesNotMatch(plist, /_TOKEN/);
  assert.match(plist, /<key>NERV_HOME<\/key>/);
  assert.match(plist, /io\.nerv\.agent/);
  const unit = renderService('linux', '/home/user/data', '/home/user/Code with % and $', '/usr/bin/node');
  assert.match(unit, /Code with %% and \$\$/);
  assert.match(unit, /WantedBy=default.target/);
  assert.doesNotMatch(unit, /_TOKEN/);
  assert.match(unit, /NERV_HOME=/);
  assert.throws(() => renderService('aix', 'a', 'b', 'c'), /macOS, Linux and Windows only/);
  assert.throws(() => renderService('linux', 'bad\npath', 'b', 'c'));
});
test('built UI is public, APIs authenticated, traversal and symlinks cannot expose private files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-static-'));
  const web = join(dir, 'web');
  mkdirSync(web);
  writeFileSync(join(web, 'index.html'), '<h1>Nodo</h1>');
  writeFileSync(join(dir, 'secret.txt'), 'secret');
  symlinkSync(join(dir, 'secret.txt'), join(web, 'linked.txt'));
  const store = new Store(':memory:');
  const server = makeServer(store, 'a'.repeat(32), { webRoot: web, language: 'it', timeZone: 'Europe/Rome' });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type')!, /text\/html/);
    assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal(await page.text(), '<h1>Nodo</h1>');
    assert.equal((await fetch(base + '/api/doctor')).status, 401);
    for (const p of ['/linked.txt', '/%2e%2e%2fsecret.txt', '/.git/config', '/missing.js'])
      assert.equal((await fetch(base + p)).status, 404);
    const doctor = await (
      await fetch(base + '/api/doctor', { headers: { Authorization: 'Bearer ' + 'a'.repeat(32) } })
    ).json();
    assert.equal(doctor.language, 'it');
    assert.equal(doctor.timeZone, 'Europe/Rome');
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('Italian and English cover the same UI messages', () => {
  assert.deepEqual(Object.keys(messages.it).sort(), Object.keys(messages.en).sort());
  assert.equal(messages.it.reminders, 'Promemoria');
});

test('systemd accepts the generated unit syntax when its validator is available', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-unit-'));
  const path = join(dir, 'nerv.service');
  try {
    writeFileSync(path, renderService('linux', dir, process.cwd(), process.execPath));
    const result = spawnSync('systemd-analyze', ['verify', path], { encoding: 'utf8' });
    if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
      t.skip('systemd-analyze unavailable on this platform');
      return;
    }
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rename: ~/.nerv by default, pre-rename ~/.nodo, nodo.sqlite and NODO_* still work until moved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-rename-'));
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    NERV_HOME: process.env.NERV_HOME,
    NODO_HOME: process.env.NODO_HOME,
    NERV_PORT: process.env.NERV_PORT,
    NODO_PORT: process.env.NODO_PORT,
  };
  const cwd = process.cwd();
  try {
    for (const k of ['NERV_HOME', 'NODO_HOME', 'NERV_PORT', 'NODO_PORT']) delete process.env[k];
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.chdir(dir); // homedir() reads USERPROFILE on Windows
    assert.equal(dataHome(), join(dir, '.nerv'));
    mkdirSync(join(dir, '.nodo'));
    assert.equal(dataHome(), join(dir, '.nodo'), 'only the old home exists');
    mkdirSync(join(dir, '.nerv'));
    assert.equal(dataHome(), join(dir, '.nerv'), 'the new home wins once it exists');
    process.env.NODO_HOME = join(dir, 'custom');
    assert.equal(dataHome(), join(dir, 'custom'));
    process.env.NERV_HOME = join(dir, 'mine');
    assert.equal(dataHome(), join(dir, 'mine'));
    process.env.NODO_PORT = '4900';
    assert.equal(setting('PORT'), '4900');
    process.env.NERV_PORT = '4901';
    assert.equal(setting('PORT'), '4901');
    const home = join(dir, '.nerv');
    assert.equal(databasePath(home), join(home, 'nerv.sqlite'));
    writeFileSync(join(home, 'nodo.sqlite'), '');
    assert.equal(databasePath(home), join(home, 'nodo.sqlite'), 'existing database kept');
    writeFileSync(join(home, 'nerv.sqlite'), '');
    assert.equal(databasePath(home), join(home, 'nerv.sqlite'));
  } finally {
    process.chdir(cwd);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
test('every NERV process trusts the system certificates: npm start, both service units and the child processes', async () => {
  const { NODE_FLAGS } = await import('../src/process-client.ts');
  const { Runtime } = await import('../src/runtime.ts');
  const start = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: { start: string } }).scripts.start;
  for (const flag of NODE_FLAGS) {
    assert.ok(start.split(' ').includes(flag), `package.json start has ${flag}`);
    assert.ok(
      readFileSync('src/cli.ts', 'utf8').split('\n')[0]!.split(' ').includes(flag),
      `the nerv command's shebang has ${flag}`,
    );
    assert.ok(renderService('darwin', '/h', '/r', '/n').includes(`<string>/n</string><string>${flag}</string>`));
    assert.ok(renderService('linux', '/h', '/r', '/n').includes(`ExecStart="/n" ${flag} `));
  }
  const dir = mkdtempSync(join(tmpdir(), 'nerv-flags-'));
  const runtime = new Runtime(join(dir, 'db'));
  try {
    await runtime.ready();
    for (const child of [runtime.nervous.child, runtime.brain.child])
      for (const flag of NODE_FLAGS) assert.ok(child.spawnargs.includes(flag), `child started with ${flag}`);
  } finally {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('each machine has a base identity: set at init, shown by base, changed later, validated', async () => {
  const { validateBase } = await import('../src/config.ts');
  const home = mkdtempSync(join(tmpdir(), 'nerv-base-'));
  const run = (...a: string[]) =>
    spawnSync(process.execPath, ['src/cli.ts', ...a], {
      env: { ...process.env, NERV_HOME: home, NERV_OLLAMA: 'http://127.0.0.1:9' },
      encoding: 'utf8',
    });
  try {
    const init = run('init', '--base', 'nerv-02', '--name', 'Tabgha');
    assert.equal(init.status, 0, init.stderr);
    assert.match(init.stdout, /base NERV-02 · Tabgha/);
    assert.equal(run('base').stdout.trim(), 'NERV-02 · Tabgha');
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ ...JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')), language: 'it' }),
    );
    assert.match(run('base', 'NERV-03', 'Bethany').stdout, /Base set: NERV-03 · Bethany/);
    const saved = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    assert.deepEqual(saved.base, { id: 'NERV-03', name: 'Bethany' });
    assert.equal(saved.language, 'it', 'other settings are kept');
    assertPrivateFile(join(home, 'config.json'));
    assert.match(run('init', '--base', 'NERV-04').stderr, /both --base ID and --name/);
    for (const bad of [
      { id: 'nerv 1', name: 'x' },
      { id: 'N', name: 'x' },
      { id: 'NERV-01', name: '' },
      { id: 'NERV-01', name: '<script>' },
      { id: 'NERV-01', name: 'x', extra: 1 },
    ])
      assert.throws(() => validateBase(bad), JSON.stringify(bad));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test('Windows: private files rely on the profile ACLs (no Unix bits), and service install registers a hidden logon task that restarts on failure', async () => {
  const { privateEnough } = await import('../src/config.ts');
  const { windowsLauncher, windowsTaskXml, renderService } = await import('../src/service.ts');
  const { NODE_FLAGS } = await import('../src/process-client.ts');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-win-'));
  const file = join(dir, 'telegram-token');
  try {
    writeFileSync(file, 'x', { mode: 0o644 });
    assert.equal(privateEnough(file, 0o077, 'linux'), false);
    assert.equal(privateEnough(file, 0o077, 'darwin'), false);
    assert.equal(privateEnough(file, 0o077, 'win32'), true);
    const { chmodSync } = await import('node:fs');
    chmodSync(file, 0o600);
    if (POSIX) assert.equal(privateEnough(file, 0o077, 'linux'), true, 'chmod has no effect on Windows');
    const home = 'C:\\Users\\d & co\\.nerv',
      root = 'C:\\Projects\\nerv',
      node = 'C:\\Program Files\\nodejs\\node.exe';
    const task = windowsTaskXml(home, root, 'TABGHA\\d');
    assert.match(
      task,
      /<LogonTrigger><Enabled>true<\/Enabled><UserId>TABGHA\\d<\/UserId><\/LogonTrigger>/,
      "at this user's logon",
    );
    assert.match(task, /<RunLevel>LeastPrivilege<\/RunLevel>/);
    assert.match(task, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/, 'no time limit');
    assert.match(task, /<RestartOnFailure><Interval>PT1M<\/Interval>/);
    assert.match(task, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/, 'never a second copy');
    assert.match(
      task,
      /<Arguments>\/\/B \/\/Nologo "C:\\Users\\d &amp; co\\.nerv\\nerv-service\.vbs"<\/Arguments><WorkingDirectory>C:\\Projects\\nerv<\/WorkingDirectory>/,
      'XML-escaped paths',
    );
    const vbs = windowsLauncher(home, root, node);
    assert.match(vbs, /sh\.Environment\("PROCESS"\)\("NERV_HOME"\) = "C:\\Users\\d & co\\.nerv"/);
    assert.match(vbs, /, 0, True\)/, 'hidden window, and the exit code reaches Task Scheduler');
    assert.ok(
      vbs.includes(
        `""C:\\Program Files\\nodejs\\node.exe"" ${NODE_FLAGS.join(' ')} ""C:\\Projects\\nerv\\src\\cli.ts"" serve >> ""C:\\Users\\d & co\\.nerv\\service.log""`,
      ),
      'the same Node flags as every other launcher, logs in the data home',
    );
    for (const text of [task, vbs])
      assert.doesNotMatch(text, /NERV_TOKEN|Bearer|[a-f0-9]{64}/, 'no credential in the task or the launcher');
    assert.equal(renderService('win32', home, root, node).startsWith('<?xml version="1.0" encoding="UTF-16"?>'), true);
    assert.throws(() => windowsLauncher('C:\\a"b', root, node), /Invalid service path/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
