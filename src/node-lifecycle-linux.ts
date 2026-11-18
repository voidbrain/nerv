import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { databasePath, readConfig, readToken } from './config.ts';
import { renderService } from './service.ts';
import { assertRootMigrationReady } from './root-migration.ts';

import {
  checkServicePrerequisites,
  command,
  definition,
  hash,
  present,
  requireServiceHome,
  safe,
  serviceProfileIdentity,
  type Result,
  type ServiceContext,
  type ServiceHost,
  type ServiceObservation,
} from './node-lifecycle-execution.ts';
import { macServiceAdapter } from './node-lifecycle-mac.ts';

function systemdField(output: string, key: string): string {
  const match = output.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1]!.trim() : '';
}

function linuxRegistrationMatches(output: string, c: ServiceContext): boolean {
  const execStart = systemdField(output, 'ExecStart');
  const workDir = systemdField(output, 'WorkingDirectory');
  const env = systemdField(output, 'Environment');
  const expectedCli = join(c.source, 'src/cli.ts');
  return (
    systemdField(output, 'LoadState') === 'loaded' &&
    workDir === c.source &&
    env.includes(`NERV_HOME=${c.home}`) &&
    execStart.includes(c.node) &&
    execStart.includes(expectedCli) &&
    execStart.includes('serve')
  );
}

/**
 * Production Linux user-service adapter (`systemd --user`, F-005-T10): requires an unprivileged user session,
 * default `~/.nerv` profile, canonical checkout, and never enables lingering or touches system-wide services.
 */
export function linuxServiceHost(home: string): ServiceHost {
  if (process.platform !== 'linux' || !process.getuid?.())
    throw Error('Durable Linux lifecycle currently requires an unprivileged user.');
  const context: ServiceContext = {
    userHome: homedir(),
    home: resolve(home),
    source: realpathSync(fileURLToPath(new URL('..', import.meta.url))),
    node: realpathSync(process.execPath),
    uid: process.getuid(),
  };
  if (context.home !== join(context.userHome, '.nerv'))
    throw Error('An additional or legacy profile cannot manage this OS service.');
  requireServiceHome(context.home);
  return linuxServiceAdapter(context);
}

export function linuxServiceAdapter(
  context: ServiceContext,
  run: typeof command = command,
  unitPath = definition(context, 'linux-service'),
): ServiceHost {
  const expected = renderService('linux', context.home, context.source, context.node);
  const macShared = macServiceAdapter(context, run);
  const git = async (args: string[]) => {
    const r = await run('git', ['-C', context.source, ...args]);
    if (r.status !== 0) throw Error('Selected source could not be verified.');
    return r.out.trim();
  };
  const showUnit = async (unitName: string): Promise<Result | undefined> => {
    const r = await run('systemctl', [
      '--user',
      'show',
      '--no-pager',
      '--property=LoadState,UnitFileState,ActiveState,SubState,MainPID,ExecStart,WorkingDirectory,Environment',
      unitName,
    ]);
    if (r.status !== 0) return undefined;
    if (systemdField(r.out, 'LoadState') === 'not-found') return undefined;
    return r;
  };
  return {
    kind: 'linux-service',
    definitionPath: unitPath,
    context,
    inspect: async () => {
      safe(context.userHome, context.uid);
      safe(context.home, context.uid, true);
      safe(context.source, context.uid);
      assertRootMigrationReady(context.home);
      const config = readConfig(context.home);
      const token = readToken(context.home);
      const profile = serviceProfileIdentity(context);
      const revision = await git(['rev-parse', 'HEAD']);
      if (
        !/^[a-f0-9]{40}$/.test(revision) ||
        (await git(['remote', 'get-url', 'origin'])) !== 'https://github.com/voidbrain/nerv.git'
      )
        throw Error('Use the canonical reviewed NERV checkout.');
      const session = (await run('systemctl', ['--user', 'show-environment'])).status === 0;
      const prerequisites = await checkServicePrerequisites(context, run, { session });
      const currentKind: ServiceObservation['definition'] = !present(unitPath)
        ? 'absent'
        : (() => {
            try {
              safe(unitPath, context.uid, true);
              return hash(readFileSync(unitPath)) === hash(expected) ? 'owned' : 'foreign';
            } catch {
              return 'foreign';
            }
          })();
      const manager = await showUnit('nerv.service');
      const legacyManager = await showUnit('nodo.service');
      let registered: ServiceObservation['registration'] = 'absent';
      let managerPid = 0;
      if (manager) {
        // B-086: systemd loads a unit as soon as its file exists; it is registered once enabled, or while it still
        // runs after a `disable` without --now (B-086-T02), so a fenced stop can recover it.
        const enabled = /^enabled(-runtime)?$/.test(systemdField(manager.out, 'UnitFileState'));
        const running = /^(active|activating|reloading)$/.test(systemdField(manager.out, 'ActiveState'));
        registered = linuxRegistrationMatches(manager.out, context)
          ? enabled || running
            ? 'owned'
            : 'absent'
          : 'foreign';
        const rawPid = Number(systemdField(manager.out, 'MainPID'));
        managerPid = Number.isSafeInteger(rawPid) && rawPid > 0 ? rawPid : 0;
      }
      const ps = await run('ps', ['-axo', 'pid=,ppid=,comm=,args=']);
      if (ps.status !== 0) throw Error('Process ownership could not be inspected.');
      const rows = ps.out.split('\n').flatMap((line) => {
        const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        return m ? [{ pid: Number(m[1]), parent: Number(m[2]), comm: m[3]!, args: m[4]! }] : [];
      });
      const roots = rows.filter(
        (r) => (r.comm === 'node' || r.comm.endsWith('/node')) && /src\/cli\.ts\s+(serve|launch)(\s|$)/.test(r.args),
      );
      const ids = new Set(roots.map((r) => r.pid));
      if (managerPid) ids.add(managerPid);
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of rows)
          if (ids.has(r.parent) && !ids.has(r.pid)) {
            ids.add(r.pid);
            changed = true;
          }
      }
      const pids = [...ids].sort((a, b) => a - b);
      let runtime: ServiceObservation['runtime'] = pids.length ? 'unknown' : 'stopped';
      try {
        const r = await fetch('http://127.0.0.1:' + config.port + '/api/doctor', {
          headers: { authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(1500),
        });
        if (r.ok) {
          const body = (await r.json()) as { base?: { id: string }; build?: { commit: string } };
          runtime =
            body.base?.id === config.base.id &&
            body.build?.commit === revision &&
            registered === 'owned' &&
            systemdField(manager?.out ?? '', 'ActiveState') === 'active' &&
            pids.includes(managerPid)
              ? 'owned'
              : 'unknown';
        } else runtime = 'unknown';
      } catch {}
      safe(databasePath(context.home), context.uid);
      const db = new DatabaseSync(databasePath(context.home), { readOnly: true });
      let pending: boolean;
      let schema: number;
      try {
        schema = Number(db.prepare('PRAGMA user_version').get()!.user_version);
        pending =
          !!db
            .prepare("SELECT 1 FROM worker_jobs WHERE state NOT IN ('completed','cancelled','released') LIMIT 1")
            .get() ||
          !!db.prepare('SELECT 1 FROM kaji_outbox WHERE done IS NULL LIMIT 1').get() ||
          !!db.prepare("SELECT 1 FROM worker_legacy_outbox WHERE state='pending' LIMIT 1").get();
      } finally {
        db.close();
      }
      return {
        revision,
        schema,
        profile,
        definition: currentKind,
        registration: registered,
        runtime,
        pids,
        session,
        clean: (await git(['status', '--porcelain'])) === '',
        legacy: present(join(dirname(unitPath), 'nodo.service')) || !!legacyManager,
        pending,
        built: existsSync(join(context.source, 'dist/web/browser/index.html')),
        prerequisites,
      };
    },
    health: macShared.health,
    compatible: macShared.compatible,
    rehearse: macShared.rehearse,
    backup: macShared.backup,
    authorizedStart: async (p) => {
      if (
        (await git(['status', '--porcelain'])) !== '' ||
        serviceProfileIdentity(context) !== p.before.profile ||
        (await git(['rev-parse', 'HEAD'])) !== (p.nextRevision ?? p.before.revision)
      )
        return false;
      const manager = await showUnit('nerv.service');
      return (
        !!manager &&
        linuxRegistrationMatches(manager.out, context) &&
        systemdField(manager.out, 'ActiveState') === 'active' &&
        Number(systemdField(manager.out, 'MainPID')) === process.pid &&
        hash(readFileSync(unitPath)) === hash(expected)
      );
    },
    command: async (step, p) => {
      if (step === 'register') {
        const reload = await run('systemctl', ['--user', 'daemon-reload']);
        if (reload.status !== 0) throw Error('Service register did not confirm completion; retain uncertainty.');
        const enable = await run('systemctl', ['--user', 'enable', '--now', 'nerv.service']);
        if (enable.status !== 0) throw Error('Service register did not confirm completion; retain uncertainty.');
        return;
      }
      if (step === 'unregister') {
        const disable = await run('systemctl', ['--user', 'disable', '--now', 'nerv.service']);
        if (disable.status !== 0) throw Error('Service unregister did not confirm completion; retain uncertainty.');
        const reload = await run('systemctl', ['--user', 'daemon-reload']);
        if (reload.status !== 0) throw Error('Service unregister did not confirm completion; retain uncertainty.');
        return;
      }
      await macShared.command(step, p);
    },
  };
}

/**
 * Windows Task Scheduler registration check: verifies the scheduled task runs `wscript.exe`
 * with our hidden launcher `nerv-service.vbs` inside `context.home` and `context.source`.
 */
