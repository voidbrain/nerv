import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_INSTALL_DIR, installFolder, serviceSource } from '../src/install-source.ts';
import { moveInstall, type MoveDeps } from '../src/install-move.ts';
import { expectedDefinition, type ServiceHost } from '../src/node-lifecycle-execution.ts';

const SHA = 'a'.repeat(40);

test('F-117-T01: the install folder is ~/.nerv-app unless NERV_INSTALL names an absolute path', () => {
  assert.equal(installFolder('/home/pilot', {}), join('/home/pilot', DEFAULT_INSTALL_DIR));
  assert.equal(installFolder('/home/pilot', { NERV_INSTALL: '/opt/nerv-app' }), '/opt/nerv-app');
  assert.throws(() => installFolder('/home/pilot', { NERV_INSTALL: 'relative/app' }), /absolute/);
});

test('F-117-T01: lifecycle source is the install folder once it holds NERV, otherwise the running checkout', () => {
  const real = (p: string) => p;
  const holds = (p: string) => p.startsWith('/home/pilot/.nerv-app/');
  assert.equal(
    serviceSource({ userHome: '/home/pilot', running: '/dev/nerv', env: {}, exists: holds, real }),
    '/home/pilot/.nerv-app',
  );
  assert.equal(
    serviceSource({ userHome: '/home/pilot', running: '/dev/nerv', env: {}, exists: () => false, real }),
    '/dev/nerv',
  );
});

test('F-117-T01: the resolved install folder is the source the rendered service definition runs', () => {
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
});

type Obs = { definition: string; registration: string; runtime: string };

function fakes(options: { failAt?: string; probe?: boolean; dirty?: boolean; occupied?: boolean } = {}) {
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
    plan: async (h, action) => ({ action, digest: action + ':' + h.context.source, blockers: [] }) as never,
    apply: async (h, plan) => {
      const action = (plan as unknown as { action: string }).action;
      const key = `${h.context.source === '/dev/nerv' ? 'old' : 'new'} ${action}`;
      calls.push(key);
      if (options.failAt === key) return { state: 'uncertain' } as never;
      const s = state[h.context.source]!;
      if (action === 'stop') Object.assign(s, { registration: 'absent', runtime: 'stopped' });
      if (action === 'uninstall') s.definition = 'absent';
      if (action === 'install') s.definition = 'owned';
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
  assert.deepEqual(lifecycle, ['old stop', 'old uninstall', 'new install', 'new start']);
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

test('F-117-T01: a failed start or a silent dashboard puts the old service back and starts it', async () => {
  for (const options of [{ failAt: 'new start' }, { probe: false }]) {
    const { deps, calls, state } = fakes(options);
    const r = await moveInstall(deps);
    assert.equal(r.outcome, 'rolled-back', JSON.stringify(r));
    const tail = calls.filter((c) => /^(old|new) /.test(c)).slice(-3);
    assert.deepEqual(tail.slice(-2), ['old install', 'old start']);
    assert.equal(state['/dev/nerv']!.definition, 'owned');
    assert.equal(state['/dev/nerv']!.runtime, 'running');
    assert.equal(state['/home/pilot/.nerv-app']!.definition, 'absent', 'the new definition is removed');
  }
});
