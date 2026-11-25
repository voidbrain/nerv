import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { databasePath, readConfig, readToken } from './config.ts';
import { WINDOWS_TASK, windowsLauncher } from './service.ts';
import { assertRootMigrationReady } from './root-migration.ts';

import {
  checkServicePrerequisites,
  command,
  processIdentity,
  definition,
  DOCTOR_PROBE,
  type DoctorProbeOptions,
  probeDoctor,
  expectedDefinition,
  hash,
  present,
  requireServiceHome,
  safe,
  serviceProfileIdentity,
  windowsLauncherPath,
  type Result,
  type ServiceContext,
  type ServiceHost,
  type ServiceObservation,
  liveDatabase,
} from './node-lifecycle-execution.ts';
import { macServiceAdapter } from './node-lifecycle-mac.ts';
import { serviceSource } from './install-source.ts';

export function windowsRegistrationMatches(output: string, c: ServiceContext): boolean {
  const launcher = windowsLauncherPath(c).replace(/\\/g, '/').toLowerCase();
  const normalized = output.replace(/\\/g, '/').toLowerCase();
  const hasWscript = normalized.includes('wscript.exe') || normalized.includes('wscript');
  const hasLauncher = normalized.includes(launcher);
  const hasTaskName = normalized.includes(WINDOWS_TASK.toLowerCase());
  return hasTaskName && hasWscript && hasLauncher;
}

/** Launcher comments are non-executable metadata and may change across a fenced update. */
function windowsLauncherMatches(actual: Buffer, expected: string): boolean {
  const executableBody = (value: string) => value.replace(/^\uFEFF?'[^\r\n]*(?:\r?\n|$)/, '');
  return executableBody(actual.toString('utf8')) === executableBody(expected);
}

/** Production Windows adapter: current unprivileged Windows user, current checkout and default `.nerv` data home. */
export function windowsServiceHost(home: string, source?: string): ServiceHost {
  if (process.platform !== 'win32') {
    throw Error('Durable Windows local lifecycle requires Windows.');
  }
  const context: ServiceContext = {
    userHome: homedir(),
    home: resolve(home),
    source: realpathSync(source ?? serviceSource({ userHome: homedir() })),
    node: realpathSync(process.execPath),
    uid: 0,
  };
  if (context.home !== join(context.userHome, '.nerv')) {
    throw Error('An additional or legacy profile cannot manage this OS service.');
  }
  requireServiceHome(context.home);
  return windowsServiceAdapter(context);
}

/** Windows Task Scheduler lifecycle adapter (`windows-service`) under the shared fencing journal. */
export function windowsServiceAdapter(
  context: ServiceContext,
  run: typeof command = command,
  environment: Record<string, string | undefined> = process.env,
  doctor: DoctorProbeOptions = DOCTOR_PROBE,
): ServiceHost {
  const expectedTask = expectedDefinition(context, 'windows-service');
  const expectedVbs = windowsLauncher(context.home, context.source, context.node);
  const mac = macServiceAdapter(context, run);
  const git = async (args: string[]) => {
    const r = await run('git', ['-C', context.source, ...args]);
    if (r.status !== 0) throw Error('Selected source could not be verified.');
    return r.out.trim();
  };
  const queryTask = async (): Promise<Result | undefined> => {
    const r = await run('schtasks', ['/Query', '/TN', WINDOWS_TASK, '/V', '/FO', 'LIST']);
    if (r.status === 0) return r;
    if (/cannot find|does not exist|the system cannot find/i.test(r.err + '\n' + r.out)) return undefined;
    throw Error('The Windows Task Scheduler result is unknown.');
  };
  const queryProcesses = async (): Promise<number[]> => {
    const ps = await run('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -or $_.Name -eq 'wscript.exe' } | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CommandLine)\" }",
    ]);
    if (ps.status !== 0) throw Error('Windows process ownership could not be inspected.');
    const rows = ps.out.split(/\r?\n/).flatMap((line) => {
      const parts = line.split('|');
      if (parts.length < 4) return [];
      const pid = Number(parts[0]);
      const parent = Number(parts[1]);
      if (!Number.isInteger(pid) || pid <= 0) return [];
      return [{ pid, parent, name: parts[2]!.toLowerCase(), args: parts.slice(3).join('|') }];
    });
    const launcher = windowsLauncherPath(context).toLowerCase();
    const roots = rows.filter(
      (r) =>
        (r.name === 'node.exe' && /src[\\/]cli\.ts\s+(serve|launch)(\s|$)/i.test(r.args)) ||
        (r.name === 'wscript.exe' && r.args.toLowerCase().includes(launcher)),
    );
    const ids = new Set(roots.map((r) => r.pid));
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of rows) {
        if (ids.has(r.parent) && !ids.has(r.pid)) {
          ids.add(r.pid);
          changed = true;
        }
      }
    }
    return [...ids].sort((a, b) => a - b);
  };

  return {
    kind: 'windows-service',
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
      ) {
        throw Error('Use the canonical reviewed NERV checkout.');
      }
      const prerequisites = await checkServicePrerequisites(context, run, { session: true });
      if (environment.SSH_CONNECTION) {
        prerequisites.ok = false;
        prerequisites.issues.push(
          'Windows lifecycle actions that start the service must run from the interactive Windows desktop session: that session cannot verify the SSH handler process identity (StartTime and MainModule are inaccessible across sessions/elevation).',
        );
      }
      const taskPath = definition(context, 'windows-service');
      const vbsPath = windowsLauncherPath(context);
      const defKind: ServiceObservation['definition'] = !present(taskPath)
        ? 'absent'
        : (() => {
            try {
              safe(taskPath, context.uid, true);
              const taskMatches = hash(readFileSync(taskPath)) === hash(expectedTask);
              const vbsMatches =
                present(vbsPath) &&
                (() => {
                  safe(vbsPath, context.uid, true);
                  return hash(readFileSync(vbsPath)) === hash(expectedVbs);
                })();
              return taskMatches && vbsMatches ? 'owned' : 'foreign';
            } catch {
              return 'foreign';
            }
          })();

      const task = await queryTask();
      const registered: ServiceObservation['registration'] = !task
        ? 'absent'
        : windowsRegistrationMatches(task.out, context)
          ? 'owned'
          : 'foreign';
      const pids = await queryProcesses();
      let runtime: ServiceObservation['runtime'] = pids.length ? 'unknown' : 'stopped';
      let unanswered: ServiceObservation['doctor'];
      const answer = await probeDoctor(config.port, token, doctor);
      if (answer.ok)
        runtime =
          answer.body.base?.id === config.base.id &&
          answer.body.build?.commit === revision &&
          registered === 'owned' &&
          pids.length > 0
            ? 'owned'
            : 'unknown';
      else {
        // Something answered the port without OK: never stopped, as before (B-135 only names it).
        if (answer.unanswered.outcome === 'http') runtime = 'unknown';
        if (runtime === 'unknown') unanswered = answer.unanswered;
      }

      safe(databasePath(context.home), context.uid);
      const db = liveDatabase(databasePath(context.home));
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
        definition: defKind,
        registration: registered,
        runtime,
        ...(unanswered ? { doctor: unanswered } : {}),
        pids,
        session: true,
        clean: (await git(['status', '--porcelain'])) === '',
        legacy: false,
        pending,
        built: existsSync(join(context.source, 'dist/web/browser/index.html')),
        prerequisites,
      };
    },
    health: mac.health!,
    compatible: mac.compatible,
    rehearse: mac.rehearse,
    backup: mac.backup,
    identity: (pid) => processIdentity(pid, run, 'win32'),
    authorizedStart: async (p) => {
      if (
        (await git(['status', '--porcelain'])) !== '' ||
        serviceProfileIdentity(context) !== p.before.profile ||
        (await git(['rev-parse', 'HEAD'])) !== (p.nextRevision ?? p.before.revision)
      ) {
        return false;
      }
      const task = await queryTask();
      const taskPath = definition(context, 'windows-service');
      const vbsPath = windowsLauncherPath(context);
      return (
        !!task &&
        windowsRegistrationMatches(task.out, context) &&
        present(taskPath) &&
        present(vbsPath) &&
        hash(readFileSync(taskPath)) === hash(expectedTask) &&
        windowsLauncherMatches(readFileSync(vbsPath), expectedVbs)
      );
    },
    command: async (step, p) => {
      if (step === 'register') {
        const created = await run('schtasks', [
          '/Create',
          '/TN',
          WINDOWS_TASK,
          '/XML',
          definition(context, 'windows-service'),
        ]);
        if (created.status !== 0) throw Error('Service register did not confirm completion; retain uncertainty.');
        const started = await run('schtasks', ['/Run', '/TN', WINDOWS_TASK]);
        if (started.status !== 0) throw Error('Service register did not confirm start; retain uncertainty.');
        return;
      }
      if (step === 'unregister') {
        await run('schtasks', ['/End', '/TN', WINDOWS_TASK]);
        const pids = await queryProcesses();
        for (const pid of pids) {
          await run('taskkill', ['/PID', String(pid), '/T', '/F']);
        }
        const deleted = await run('schtasks', ['/Delete', '/TN', WINDOWS_TASK, '/F']);
        if (deleted.status !== 0) throw Error('Service unregister did not confirm completion; retain uncertainty.');
        return;
      }
      await mac.command(step, p);
    },
  };
}
