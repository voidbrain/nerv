import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { databasePath, readConfig, readToken } from './config.ts';
import { canonical, ROOT_KEY_FILE } from './kaji.ts';
import { renderService } from './service.ts';
import { NODE_FLAGS } from './process-client.ts';
import { assertRootMigrationReady } from './root-migration.ts';
import { UPGRADE_CONTRACT } from './upgrade-contract.ts';
import {
  rehearseUpgrade,
  parseUpgradeContract,
  READER_ENTRY,
  CONTRACT_ENTRY,
  type UpgradeContractBounds,
} from './upgrade-rehearsal.ts';

import {
  area,
  checkServicePrerequisites,
  command,
  compatibleServiceRevision,
  definition,
  exclusive,
  fileHash,
  hash,
  object,
  present,
  requireServiceHome,
  safe,
  serviceProfileIdentity,
  type Result,
  type ServiceContext,
  type ServiceHost,
  type ServiceObservation,
} from './node-lifecycle-execution.ts';

export function macRegistrationMatches(output: string, c: ServiceContext): boolean {
  const field = (name: string) => output.match(new RegExp('^\\s*' + name + ' = (.+)$', 'm'))?.[1]?.trim();
  const args = output
    .match(/arguments = \{([\s\S]*?)\n\s*\}/)?.[1]
    ?.split('\n')
    .map((s) => s.trim().replace(/^\d+\s*=\s*/, ''))
    .filter(Boolean);
  const homes = [...output.matchAll(/^\s*NERV_HOME => (.+)$/gm)].map((m) => m[1]!.trim());
  return (
    field('path') === definition(c) &&
    field('program') === c.node &&
    field('working directory') === c.source &&
    canonical(args) === canonical([c.node, ...NODE_FLAGS, join(c.source, 'src/cli.ts'), 'serve']) &&
    homes.length === 1 &&
    homes[0] === c.home
  );
}
/** The only production adapter: current unprivileged GUI user, current checkout and existing default data home. */
export function macServiceHost(home: string): ServiceHost {
  if (process.platform !== 'darwin' || !process.getuid?.())
    throw Error('Durable local lifecycle currently requires an unprivileged macOS GUI user.');
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
  return macServiceAdapter(context);
}
export function macServiceAdapter(context: ServiceContext, run: typeof command = command): ServiceHost {
  const gui = 'gui/' + context.uid,
    target = gui + '/io.nerv.agent',
    expected = renderService('darwin', context.home, context.source, context.node);
  const git = async (args: string[]) => {
    const r = await run('git', ['-C', context.source, ...args]);
    if (r.status !== 0) throw Error('Selected source could not be verified.');
    return r.out.trim();
  };
  const registration = async (label: string): Promise<Result | undefined> => {
    const r = await run('launchctl', ['print', gui + '/' + label]);
    if (r.status === 0) return r;
    if (/Could not find service|service could not be found/i.test(r.err)) return;
    throw Error('The service manager result is unknown.');
  };
  const host: ServiceHost = {
    context,
    inspect: async () => {
      safe(context.userHome, context.uid);
      safe(context.home, context.uid, true);
      safe(context.source, context.uid);
      assertRootMigrationReady(context.home);
      const config = readConfig(context.home),
        token = readToken(context.home);
      const profile = serviceProfileIdentity(context);
      const revision = await git(['rev-parse', 'HEAD']);
      if (
        !/^[a-f0-9]{40}$/.test(revision) ||
        (await git(['remote', 'get-url', 'origin'])) !== 'https://github.com/voidbrain/nerv.git'
      )
        throw Error('Use the canonical reviewed NERV checkout.');
      const session = (await run('launchctl', ['print', gui])).status === 0;
      const prerequisites = await checkServicePrerequisites(context, run, { session });
      const current = definition(context),
        currentKind = !present(current)
          ? 'absent'
          : (() => {
              try {
                safe(current, context.uid, true);
                return hash(readFileSync(current)) === hash(expected) ? 'owned' : 'foreign';
              } catch {
                return 'foreign';
              }
            })();
      const manager = await registration('io.nerv.agent'),
        legacyManager = await registration('io.nodo.agent');
      let registered: 'absent' | 'owned' | 'foreign' = 'absent';
      let managerPid = 0;
      if (manager) {
        registered = macRegistrationMatches(manager.out, context) ? 'owned' : 'foreign';
        managerPid = Number(manager.out.match(/^\s*pid = (\d+)$/m)?.[1]) || 0;
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
            pids.includes(managerPid)
              ? 'owned'
              : 'unknown';
        } else runtime = 'unknown';
      } catch {}
      safe(databasePath(context.home), context.uid);
      const db = new DatabaseSync(databasePath(context.home), { readOnly: true });
      let pending: boolean, schema: number;
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
        legacy: present(join(dirname(current), 'io.nodo.agent.plist')) || !!legacyManager,
        pending,
        built: existsSync(join(context.source, 'dist/web/browser/index.html')),
        prerequisites,
      };
    },
    health: async (p) => {
      const expectedRevision = p.nextRevision ?? p.before.revision;
      const checkedAt = new Date().toISOString();
      const failures: string[] = [];
      let commit: string | null = null;
      let baseId: string | null = null;
      let database: string | null = null;
      let nervous = false;
      let brain = false;
      try {
        const config = readConfig(context.home);
        const token = readToken(context.home);
        const r = await fetch('http://127.0.0.1:' + config.port + '/api/doctor', {
          headers: { authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) {
          failures.push(`doctor returned HTTP ${r.status}`);
        } else {
          const body = (await r.json()) as Record<string, unknown>;
          const build = object(body.build) ? body.build : undefined;
          const base = object(body.base) ? body.base : undefined;
          const dbInfo = object(body.database) ? body.database : undefined;
          const processes = object(body.processes) ? body.processes : undefined;
          commit = typeof build?.commit === 'string' ? build.commit : null;
          baseId = typeof base?.id === 'string' ? base.id : null;
          database = typeof dbInfo?.quick_check === 'string' ? dbInfo.quick_check : null;
          nervous =
            typeof processes?.nervous === 'number' &&
            Number.isSafeInteger(processes.nervous) &&
            processes.nervous > 0 &&
            dbInfo !== undefined;
          brain =
            typeof processes?.brain === 'number' &&
            Number.isSafeInteger(processes.brain) &&
            processes.brain > 0 &&
            processes.brainAlive === true &&
            object(body.models);
          if (commit !== expectedRevision)
            failures.push(`build commit ${commit ?? 'missing'} did not match ${expectedRevision}`);
          if (baseId !== config.base.id)
            failures.push(`base identity ${baseId ?? 'missing'} did not match ${config.base.id}`);
          if (database !== 'ok') failures.push(`database quick_check ${database ?? 'missing'} is not ok`);
          if (!nervous) failures.push('nervous process did not answer doctor');
          if (!brain) failures.push('brain process did not answer ping');
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : 'doctor request failed');
      }
      return {
        ok: failures.length === 0,
        checkedAt,
        commit,
        baseId,
        database,
        nervous,
        brain,
        failures,
      };
    },
    compatible: (revision) => compatibleServiceRevision(context, revision, run),
    authorizedStart: async (p) => {
      if (
        process.ppid !== 1 ||
        (await git(['status', '--porcelain'])) !== '' ||
        serviceProfileIdentity(context) !== p.before.profile ||
        (await git(['rev-parse', 'HEAD'])) !== (p.nextRevision ?? p.before.revision)
      )
        return false;
      const manager = await registration('io.nerv.agent');
      return (
        !!manager &&
        macRegistrationMatches(manager.out, context) &&
        Number(manager.out.match(/^\s*pid = (\d+)$/m)?.[1]) === process.pid &&
        hash(readFileSync(definition(context))) === hash(expected) &&
        manager.out.includes('NERV_HOME => ' + context.home) &&
        manager.out.includes('program = ' + context.node)
      );
    },
    command: async (step, p) => {
      let r: Result;
      if (step === 'register') r = await run('launchctl', ['bootstrap', gui, definition(context)]);
      else if (step === 'unregister') r = await run('launchctl', ['bootout', target]);
      else if (step === 'fetch') {
        // Admission already read the pinned commit from this checkout, so a present commit needs no network; a fetch
        // never prompts for credentials.
        r = await run('git', ['-C', context.source, 'cat-file', '-e', p.nextRevision! + '^{commit}']);
        if (r.status !== 0)
          r = await run(
            'git',
            ['-C', context.source, 'fetch', '--no-tags', 'origin', p.nextRevision!],
            undefined,
            120000,
            { GIT_TERMINAL_PROMPT: '0' },
          );
      } else if (step === 'checkout')
        r = await run('git', ['-C', context.source, 'checkout', '--detach', p.nextRevision!]);
      else
        r = await run(
          process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm',
          // No install scripts: an admitted application upgrade may change the lockfile, and package scripts are not rehearsed.
          process.platform === 'win32'
            ? ['/d', '/s', '/c', step === 'dependencies' ? 'npm ci --engine-strict --ignore-scripts' : 'npm run build']
            : step === 'dependencies'
              ? ['ci', '--engine-strict', '--ignore-scripts']
              : ['run', 'build'],
          context.source,
          600000,
        );
      if (r.status !== 0) throw Error('Service ' + step + ' did not confirm completion; retain uncertainty.');
    },
    rehearse: async (p, backup) => {
      const root = join(area(context), 'staging');
      if (!present(root)) mkdirSync(root, { mode: 0o700 });
      safe(root, context.uid, true);
      const tree = join(root, p.digest),
        archive = tree + '.tar';
      mkdirSync(tree, { mode: 0o700 });
      try {
        // The pinned tree is exported, never checked out: the installed checkout and its dependencies stay as they are.
        if (
          (
            await run(
              'git',
              ['-C', context.source, 'archive', '--format=tar', '-o', archive, p.nextRevision!],
              undefined,
              120000,
            )
          ).status !== 0 ||
          (await run('tar', ['-xf', archive, '-C', tree], undefined, 120000)).status !== 0
        )
          throw Error('The pinned revision could not be exported for rehearsal.');
        let candidateContract: UpgradeContractBounds = UPGRADE_CONTRACT;
        const contractPath = join(tree, CONTRACT_ENTRY);
        if (present(contractPath)) {
          safe(contractPath, context.uid);
          const parsed = parseUpgradeContract(readFileSync(contractPath, 'utf8'));
          if (!parsed) throw Error('The candidate upgrade contract could not be parsed.');
          candidateContract = parsed;
        }
        return await rehearseUpgrade(
          backup,
          async (database, home) => {
            const r = await run(context.node, [...NODE_FLAGS, join(tree, READER_ENTRY), database, home], tree, 120000, {
              NERV_HOME: home,
            });
            if (r.status !== 0) throw Error('The candidate reader exited with a failure.');
          },
          candidateContract,
        );
      } finally {
        rmSync(tree, { recursive: true, force: true });
        rmSync(archive, { force: true });
      }
    },
    backup: async (path) => {
      safe(databasePath(context.home), context.uid);
      const file = join(path, 'database.sqlite'),
        db = new DatabaseSync(databasePath(context.home));
      try {
        db.prepare('VACUUM INTO ?').run(file);
      } finally {
        db.close();
      }
      chmodSync(file, 0o600);
      const fd = openSync(file, 'r+');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      const check = new DatabaseSync(file, { readOnly: true });
      try {
        if (check.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok')
          throw Error('Consistent update backup failed integrity check.');
      } finally {
        check.close();
      }
      const sums: Record<string, string> = {};
      for (const name of [
        'config.json',
        'token',
        'base-key',
        'base.pub',
        ROOT_KEY_FILE,
        'anthropic-key',
        'telegram-token',
      ]) {
        const src = join(context.home, name);
        if (existsSync(src)) {
          safe(src, context.uid, name !== 'base.pub');
          const bytes = readFileSync(src);
          exclusive(join(path, name), bytes);
          sums[name] = hash(bytes);
        }
      }
      exclusive(
        join(path, 'manifest.json'),
        JSON.stringify({ files: sums, database: fileHash(file), restore: 'separately reviewed; never automatic' }),
      );
    },
  };
  return host;
}
