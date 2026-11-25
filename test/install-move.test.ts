import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_INSTALL_DIR, installFolder, serviceSource } from '../src/install-source.ts';
import { moveInstall, type MoveDeps } from '../src/install-move.ts';
import { expectedDefinition, type ServiceHost } from '../src/node-lifecycle-execution.ts';

const SHA = 'a'.repeat(40);

test('F-117-T01: the install folder is ~/.nerv-app unless NERV_INSTALL names an absolute path', () => {
  const home = resolve('/home/pilot'),
    chosen = resolve('/opt/nerv-app');
  assert.equal(installFolder(home, {}), join(home, DEFAULT_INSTALL_DIR));
  assert.equal(installFolder(home, { NERV_INSTALL: chosen }), chosen);
  assert.throws(() => installFolder(home, { NERV_INSTALL: 'relative/app' }), /absolute/);
});

test('F-117-T01: lifecycle source is the install folder once it holds NERV, otherwise the running checkout', () => {
  const real = (p: string) => p;
  const home = resolve('/home/pilot'),
    app = join(home, DEFAULT_INSTALL_DIR),
    running = resolve('/dev/nerv');
  const holds = (p: string) => p.startsWith(app);
  assert.equal(serviceSource({ userHome: home, running, env: {}, exists: holds, real }), app);
  assert.equal(serviceSource({ userHome: home, running, env: {}, exists: () => false, real }), running);
});

// launchd and systemd definitions exist only on macOS and Linux; Windows renders its own task (covered elsewhere).
test(
  'F-117-T01: the resolved install folder is the source the rendered service definition runs',
  { skip: process.platform === 'win32' },
  () => {
    const user = mkdtempSync(join(tmpdir(), 'nerv-install-'));
    try {
      const app = join(user, 'app');
      mkdirSync(join(app, 'src'), { recursive: true });
      writeFileSync(join(app, 'src/cli.ts'), '');
      writeFileSync(join(app, 'package.json'), '{}');
      const source = serviceSource({ userHome: user, running: '/dev/nerv', env: { NERV_INSTALL: app } });
      assert.equal(source, realpathSync(app));
      const context = { userHome: user, home: join(user, '.nerv'), source, node: '/usr/bin/node', uid: 501 };
      const plist = String(expectedDefinition(context, 'mac-service'));
      assert.ok(plist.includes(join(source, 'src/cli.ts')), 'launchd runs the CLI from the install folder');
      assert.ok(plist.includes(`<string>${source}</string>`), 'working directory is the install folder');
      assert.ok(!plist.includes('/dev/nerv'), 'the development checkout is not referenced');
      const unit = String(expectedDefinition(context, 'linux-service'));
      assert.ok(unit.includes(join(source, 'src/cli.ts')), 'systemd runs the CLI from the install folder');
    } finally {
      rmSync(user, { recursive: true, force: true });
    }
  },
);

type Obs = { definition: string; registration: string; runtime: string };

function fakes(
  options: { failAt?: string; probe?: boolean; dirty?: boolean; occupied?: boolean; blockAt?: string } = {},
) {
  const calls: string[] = [];
  const state: Record<string, Obs> = {
    '/dev/nerv': { definition: 'owned', registration: 'matching', runtime: 'running' },
    '/home/pilot/.nerv-app': { definition: 'absent', registration: 'absent', runtime: 'stopped' },
  };
  const host = (source: string) =>
    ({ context: { source }, inspect: async () => ({ ...state[source], pids: [] }) }) as unknown as ServiceHost;
  const deps: MoveDeps = {
    from: '/dev/nerv',
    to: '/home/pilot/.nerv-app',
    exec: async (program, args) => {
      calls.push([program, ...args.filter((a) => !a.startsWith('/') || a === '/dev/nerv')].join(' '));
      if (args.includes('rev-parse')) return { status: 0, out: SHA + '\n' };
      if (args.includes('status')) return { status: 0, out: options.dirty ? ' M src/cli.ts\n' : '' };
      if (args.includes('get-url')) return { status: 0, out: 'https://example.invalid/nerv.git\n' };
      return { status: 0, out: '' };
    },
    occupied: () => !!options.occupied,
    host,
    plan: async (h, action) => {
      const key = `${h.context.source === '/dev/nerv' ? 'old' : 'new'} ${action}`;
      calls.push('plan ' + key);
      const st = state[h.context.source]!;
      // Like planService: start and install need a stopped, unregistered service.
      const running = st.registration !== 'absent' || st.runtime !== 'stopped';
      const blockers =
        options.blockAt === key
          ? ['Service or runtime ownership is unknown or belongs elsewhere.']
          : (action === 'start' || action === 'install') && running
            ? ['Stop the selected service and descendants first.']
            : [];
      return { action, digest: action + ':' + h.context.source, blockers } as never;
    },
    apply: async (h, plan) => {
      const action = (plan as unknown as { action: string }).action;
      const key = `${h.context.source === '/dev/nerv' ? 'old' : 'new'} ${action}`;
      calls.push(key);
      if (options.failAt === key) return { state: 'uncertain' } as never;
      const s = state[h.context.source]!;
      if (action === 'stop') Object.assign(s, { registration: 'absent', runtime: 'stopped' });
      if (action === 'uninstall') s.definition = 'absent';
      // Like applyService: install writes the definition, starts the service and verifies it.
      if (action === 'install') Object.assign(s, { definition: 'owned', registration: 'matching', runtime: 'running' });
      if (action === 'start') Object.assign(s, { registration: 'matching', runtime: 'running' });
      return { state: 'completed' } as never;
    },
    probe: async () => options.probe ?? true,
  };
  return { deps, calls, state };
}

test('F-117-T01: move prepares the install folder at the running revision, then swaps old for new through the lifecycle', async () => {
  const { deps, calls, state } = fakes();
  const r = await moveInstall(deps);
  assert.equal(r.outcome, 'moved', r.reasons.join(' '));
  assert.equal(r.revision, SHA);
  const lifecycle = calls.filter((c) => /^(old|new) /.test(c));
  assert.deepEqual(
    lifecycle,
    ['old stop', 'old uninstall', 'new install'],
    'install starts the service; no extra start',
  );
  assert.ok(
    calls.some((c) => c.startsWith('git clone')),
    'clones',
  );
  assert.ok(
    calls.some((c) => c.includes('checkout --quiet --detach ' + SHA)),
    'checks out the running revision',
  );
  assert.ok(calls.indexOf('npm run build') < calls.indexOf('old stop'), 'builds before touching the service');
  assert.equal(state['/dev/nerv']!.definition, 'absent');
  assert.equal(state['/home/pilot/.nerv-app']!.runtime, 'running');
});

test('F-117-T01: move refuses without touching the service when the folder is taken or the checkout is dirty', async () => {
  for (const options of [{ occupied: true }, { dirty: true }]) {
    const { deps, calls } = fakes(options);
    const r = await moveInstall(deps);
    assert.equal(r.outcome, 'refused');
    assert.ok(!calls.some((c) => /^(old|new) /.test(c)), 'no lifecycle step ran');
  }
  const same = fakes();
  assert.equal((await moveInstall({ ...same.deps, to: '/dev/nerv' })).outcome, 'refused');
  assert.equal((await moveInstall({ ...same.deps, to: '/dev/nerv/app' })).outcome, 'refused');
});

test('F-117-T01: a failed new install or a silent dashboard puts the old service back; install starts it, no extra start', async () => {
  for (const options of [{ failAt: 'new install' }, { probe: false }]) {
    const { deps, calls, state } = fakes(options);
    const r = await moveInstall(deps);
    assert.equal(r.outcome, 'rolled-back', JSON.stringify(r));
    const applied = calls.filter((c) => /^(old|new) /.test(c));
    assert.equal(applied.at(-1), 'old install', 'the old install is the last step; it starts the service');
    assert.ok(!applied.includes('old start') && !applied.includes('new start'), 'no separate start: ' + applied);
    assert.equal(state['/dev/nerv']!.definition, 'owned');
    assert.equal(state['/dev/nerv']!.runtime, 'running');
    assert.equal(state['/home/pilot/.nerv-app']!.definition, 'absent', 'the new definition is removed');
  }
});

test('F-117-T01: a failed old uninstall restarts the old service, which still has its definition', async () => {
  const { deps, calls, state } = fakes({ failAt: 'old uninstall' });
  const r = await moveInstall(deps);
  assert.equal(r.outcome, 'rolled-back', JSON.stringify(r));
  assert.deepEqual(
    calls.filter((c) => /^(old|new) /.test(c)),
    ['old stop', 'old uninstall', 'old start'],
  );
  assert.equal(state['/dev/nerv']!.runtime, 'running');
});

test('F-117-T01: a blocked stop of the old service refuses before anything is cloned, built or started', async () => {
  const { deps, calls, state } = fakes({ blockAt: 'old stop' });
  const r = await moveInstall(deps);
  assert.equal(r.outcome, 'refused', JSON.stringify(r));
  assert.match(r.reasons.join(' '), /ownership is unknown/);
  assert.ok(!calls.some((c) => c.startsWith('git clone') || c.startsWith('npm')), 'nothing prepared');
  assert.ok(!calls.some((c) => /^(old|new) /.test(c)), 'no lifecycle step applied, no rollback start');
  assert.equal(state['/dev/nerv']!.runtime, 'running');
});
