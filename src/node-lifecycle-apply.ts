import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { databasePath } from './config.ts';
import { canonical, ROOT_KEY_FILE } from './kaji.ts';
import { WINDOWS_TASK, windowsLauncher } from './service.ts';
import { lifecycleRecovery } from './node-lifecycle.ts';
import { transaction } from './sqlite-transaction.ts';

import {
  area,
  blockers,
  definition,
  exclusive,
  expectedDefinition,
  fileHash,
  handler,
  hash,
  held,
  hostKind,
  journal,
  object,
  planOf,
  present,
  handlerIdentity,
  resource,
  safe,
  stored,
  syncDirectory,
  waitFor,
  windowsLauncherPath,
  type ServiceContext,
  type ServiceHost,
  type ServicePlan,
  type ServiceReceipt,
} from './node-lifecycle-execution.ts';

const inspectHint = (p: ServicePlan): string =>
  p.kind === 'windows-service'
    ? `Inspect and stop the Windows Task Scheduler task before anything else (schtasks /Query /TN "${WINDOWS_TASK}" /V /FO LIST; schtasks /End /TN "${WINDOWS_TASK}"), and confirm no descendant process remains.`
    : p.kind === 'linux-service'
      ? 'Inspect and stop the user service before anything else (systemctl --user status nerv.service; systemctl --user disable --now nerv.service), and confirm no descendant process remains.'
      : `Inspect and stop the service before anything else (launchctl print gui/${p.context.uid}/io.nerv.agent; launchctl bootout gui/${p.context.uid}/io.nerv.agent), and confirm no descendant process remains.`;
const manualRecoverySteps = (p: ServicePlan, forwardOnly = false): string[] =>
  p.action === 'update'
    ? forwardOnly
      ? [
          inspectHint(p),
          'Never start the previous revision on forward-migrated data; recovery never runs automatically.',
          'If dependencies failed or node_modules is missing, run npm ci --ignore-scripts in the checkout as it is so the CLI can load; do not start the service from it.',
          `Check out the previous revision (${p.before.revision}) by hand and run npm ci --ignore-scripts && npm run build (do not start the service yet).`,
          `Restore the verified operation backup and release the held operation with nodes lifecycle-recover --receipt FILE --evidence FILE --confirm-backup-restore ${p.digest} (refused while the service or any descendant remains).`,
          'Inspect and apply a fresh start plan (nodes lifecycle-inspect --action start, then nodes lifecycle-apply).',
        ]
      : [
          inspectHint(p),
          'If dependencies failed or node_modules is missing, run npm ci --ignore-scripts in the checkout as it is so the CLI can load; do not start the service from it.',
          'Release the held operation with nodes lifecycle-release --receipt FILE --evidence FILE (refused while the service or any descendant remains).',
          `Check out the previous revision (${p.before.revision}) by hand and run npm ci --ignore-scripts && npm run build.`,
          'Inspect and apply a fresh start plan (nodes lifecycle-inspect --action start, then nodes lifecycle-apply).',
        ]
    : [
        inspectHint(p),
        'Release the held operation with nodes lifecycle-release --receipt FILE --evidence FILE (refused while the service or any descendant remains).',
        'Inspect and apply a fresh plan after resolving the reported failure.',
      ];

const BACKUP_EXTRA_FILES = [
  'config.json',
  'token',
  'base-key',
  'base.pub',
  ROOT_KEY_FILE,
  'anthropic-key',
  'telegram-token',
] as const;

function verifyUpdateBackup(
  c: ServiceContext,
  digest: string,
  expectedSchema: number,
  expectedDigest?: string,
): { dir: string; databaseFile: string; databaseDigest: string; files: Record<string, string> } {
  const dir = join(area(c), 'backups', digest),
    manifestPath = join(dir, 'manifest.json'),
    databaseFile = join(dir, 'database.sqlite');
  if (!present(dir) || !present(manifestPath) || !present(databaseFile))
    throw Error('Operation backup for forward-migration recovery is missing.');
  safe(dir, c.uid, true);
  safe(manifestPath, c.uid, true);
  safe(databaseFile, c.uid, true);
  let manifest: { files?: unknown; database?: unknown; restore?: unknown };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files?: unknown;
      database?: unknown;
      restore?: unknown;
    };
  } catch {
    throw Error('Operation backup manifest could not be parsed.');
  }
  const databaseDigest = fileHash(databaseFile);
  if (
    typeof manifest.database !== 'string' ||
    manifest.database !== databaseDigest ||
    (expectedDigest !== undefined && databaseDigest !== expectedDigest) ||
    !object(manifest.files)
  )
    throw Error('Operation backup database does not match its verified manifest.');
  const files: Record<string, string> = {};
  for (const [name, expectedHash] of Object.entries(manifest.files)) {
    if (!BACKUP_EXTRA_FILES.includes(name as (typeof BACKUP_EXTRA_FILES)[number]) || typeof expectedHash !== 'string')
      throw Error('Operation backup manifest contains an invalid file entry.');
    const filePath = join(dir, name);
    if (!present(filePath)) throw Error(`Operation backup file ${name} is missing.`);
    safe(filePath, c.uid, name !== 'base.pub');
    if (fileHash(filePath) !== expectedHash) throw Error(`Operation backup file ${name} differs from its manifest.`);
    files[name] = expectedHash;
  }
  const check = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    const schema = Number(check.prepare('PRAGMA user_version').get()!.user_version);
    const quick = check.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    if (quick?.quick_check !== 'ok' || schema !== expectedSchema)
      throw Error('Operation backup database failed integrity or schema verification.');
  } finally {
    check.close();
  }
  return { dir, databaseFile, databaseDigest, files };
}
export async function applyService(
  host: ServiceHost,
  raw: unknown,
  confirm: string,
  onStep?: (step: string) => void,
): Promise<ServiceReceipt> {
  const p = planOf(raw, host);
  if (confirm !== p.digest) throw Error('Confirm the exact service plan digest.');
  let db = journal(host.context);
  try {
    const old = stored(db, p.digest);
    if (old) return old;
  } finally {
    db?.close();
  }
  if (
    p.handler !== handler() ||
    !Number.isFinite(Date.parse(p.created)) ||
    Math.abs(Date.now() - Date.parse(p.created)) > 86400000 ||
    p.blockers.length
  )
    throw Error('Service plan is blocked, stale or uses another handler.');
  const observed = await host.inspect();
  if (
    canonical(observed) !== canonical(p.before) ||
    blockers(p.action, observed, p.nextRevision).length ||
    (p.action === 'update' && !(await host.compatible(p.nextRevision!)))
  )
    throw Error('Service evidence changed; make a fresh plan.');
  const identity = host.identity ? await host.identity(process.pid) : await handlerIdentity();
  if (!identity) throw Error('Lifecycle handler identity could not be recorded.');
  db = journal(host.context, true)!;
  let receipt: ServiceReceipt | undefined;
  const owns = () => {
    const r = db!.prepare('SELECT * FROM resource WHERE id=1').get();
    if (
      !receipt ||
      r?.digest !== receipt.digest ||
      r.fence !== receipt.fence ||
      r.nonce !== receipt.nonce ||
      r.pid !== receipt.pid
    )
      throw Error('Lifecycle ownership changed.');
  };
  const save = () =>
    db!.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(JSON.stringify(receipt), p.digest);
  const step = async (name: string, effect: () => Promise<void> | void) => {
    transaction(db!, () => {
      owns();
      receipt!.steps.push(name + ':started');
      save();
    });
    onStep?.(name + ':started');
    await effect();
    transaction(db!, () => {
      owns();
      receipt!.steps[receipt!.steps.length - 1] = name + ':completed';
      save();
    });
    onStep?.(name + ':completed');
  };
  const inspectOwned = async (registered: boolean) => {
    owns();
    const current = await host.inspect();
    if (
      current.definition !== 'owned' ||
      current.profile !== p.before.profile ||
      current.schema !== p.before.schema ||
      current.legacy ||
      !current.session ||
      current.registration !== (registered ? 'owned' : 'absent')
    )
      throw Error('Selected service ownership changed.');
    return current;
  };
  try {
    const cached = transaction(db, () => {
      const previous = stored(db, p.digest);
      if (previous) return previous;
      if (held(db)) throw Error('Another lifecycle operation holds the user service.');
      db!.prepare('UPDATE clock SET value=value+1 WHERE id=1').run();
      const fence = Number(db!.prepare('SELECT value FROM clock').get()!.value);
      receipt = {
        digest: p.digest,
        resource: resource(host.context, hostKind(host)),
        fence,
        nonce: randomBytes(16).toString('hex'),
        pid: process.pid,
        identity,
        state: 'running',
        steps: [],
      };
      db!.prepare('INSERT INTO resource VALUES(1,?,?,?,?)').run(p.digest, fence, receipt.nonce, process.pid);
      db!.prepare('INSERT INTO operations VALUES(?,?,?)').run(p.digest, canonical(p), JSON.stringify(receipt));
      return undefined;
    });
    if (cached) return cached;
    onStep?.('accepted');
    if (p.action === 'install')
      await step('definition', async () => {
        const fresh = await host.inspect();
        if (canonical(fresh) !== canonical(p.before)) throw Error('Installation evidence changed.');
        const defPath = definition(host.context, hostKind(host), host.definitionPath);
        const dir = dirname(defPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
        safe(dir, host.context.uid);
        if (hostKind(host) === 'windows-service') {
          exclusive(
            windowsLauncherPath(host.context),
            windowsLauncher(host.context.home, host.context.source, host.context.node),
          );
        }
        exclusive(defPath, expectedDefinition(host.context, hostKind(host)));
      });
    if (p.action === 'stop')
      await step('stop', async () => {
        const current = await inspectOwned(p.before.registration === 'owned');
        if (current.registration === 'owned') await host.command('unregister', p);
        await waitFor(async () => {
          const next = await host.inspect();
          return next.registration === 'absent' && next.runtime === 'stopped' && !next.pids.length;
        });
        for (const pid of p.before.pids) {
          try {
            process.kill(pid, 0);
            throw Error('A selected descendant remains alive.');
          } catch (e) {
            if (!(e instanceof Error) || !('code' in e) || e.code !== 'ESRCH') throw e;
          }
        }
      });
    if (p.action === 'uninstall')
      await step('remove-definition', async () => {
        const current = await inspectOwned(false);
        if (current.runtime !== 'stopped' || current.pids.length) throw Error('Runtime descendants remain.');
        const defPath = definition(host.context, hostKind(host), host.definitionPath);
        safe(defPath, host.context.uid, true);
        if (hash(readFileSync(defPath)) !== hash(expectedDefinition(host.context, hostKind(host))))
          throw Error('Definition changed before removal.');
        unlinkSync(defPath);
        if (hostKind(host) === 'windows-service' && present(windowsLauncherPath(host.context))) {
          unlinkSync(windowsLauncherPath(host.context));
        }
        syncDirectory(dirname(defPath));
      });
    if (p.action === 'update') {
      await step('backup', async () => {
        await inspectOwned(false);
        const root = join(area(host.context), 'backups');
        if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
        safe(root, host.context.uid, true);
        const dest = join(root, p.digest);
        mkdirSync(dest, { mode: 0o700 });
        await host.backup(dest);
      });
      const settled = async (revision: string) => {
        const current = await inspectOwned(false);
        if (current.runtime !== 'stopped' || current.pids.length || !current.clean || current.revision !== revision)
          throw Error('Runtime or source changed during update.');
      };
      const source = (command: 'fetch' | 'checkout' | 'dependencies' | 'build') =>
        step(command, async () => {
          await settled(['dependencies', 'build'].includes(command) ? p.nextRevision! : p.before.revision);
          await host.command(command, p);
        });
      await source('fetch');
      // The candidate's reader runs on this operation's own backup before the checkout changes; the installed code compares.
      let refused = false;
      await step('rehearse', async () => {
        await settled(p.before.revision);
        const backupDir = join(area(host.context), 'backups', p.digest);
        const report = await host.rehearse(p, backupDir);
        await settled(p.before.revision);
        const blockers = [...report.blockers];
        if (!blockers.length && report.result?.forwardOnly) {
          try {
            verifyUpdateBackup(host.context, p.digest, p.before.schema, report.source.digest);
          } catch (error) {
            blockers.push(
              'Forward migration requires a verified operation backup for explicit recovery (' +
                (error instanceof Error ? error.message : 'backup verification failed') +
                ').',
            );
          }
        }
        receipt!.rehearsal = { source: report.source, ...(report.result ? { result: report.result } : {}), blockers };
        refused = blockers.length > 0;
      });
      // A reported blocker is a determinate end: source, data and service are as planned, so the claim is released without uncertainty.
      if (refused) {
        transaction(db, () => {
          owns();
          receipt!.state = 'refused';
          save();
          db!.prepare('DELETE FROM resource WHERE id=1 AND fence=? AND nonce=?').run(receipt!.fence, receipt!.nonce);
        });
        return receipt!;
      }
      for (const command of ['checkout', 'dependencies', 'build'] as const) await source(command);
    }
    if (['install', 'start', 'update'].includes(p.action))
      await step('start', async () => {
        const current = await inspectOwned(false);
        const expectedSchema =
          p.action === 'update' ? (receipt!.rehearsal?.result?.schema ?? p.before.schema) : p.before.schema;
        if (
          current.runtime !== 'stopped' ||
          current.pids.length ||
          !current.clean ||
          current.revision !== (p.nextRevision ?? p.before.revision)
        )
          throw Error('Selected runtime/source changed before start.');
        await host.command('register', p);
        await waitFor(async () => {
          const next = await host.inspect();
          return (
            next.registration === 'owned' &&
            next.runtime === 'owned' &&
            next.profile === p.before.profile &&
            next.revision === (p.nextRevision ?? p.before.revision) &&
            next.schema === expectedSchema
          );
        });
      });
    await step('verify', async () => {
      const current = await host.inspect();
      if (['install', 'start', 'update'].includes(p.action) && (host.health || p.action === 'update')) {
        if (!host.health) throw Error('Post-start health check is required for updates.');
        const health = await host.health(p);
        transaction(db!, () => {
          owns();
          receipt!.health = health;
          save();
        });
        if (!health.ok)
          throw Error(
            'Started service failed post-start health check (' +
              health.failures.join('; ') +
              '); effects remain uncertain — follow ordered manual recovery.',
          );
      }
      if (
        p.action === 'uninstall'
          ? current.definition !== 'absent' || current.registration !== 'absent' || current.runtime !== 'stopped'
          : p.action === 'stop'
            ? current.definition !== 'owned' || current.registration !== 'absent' || current.runtime !== 'stopped'
            : current.definition !== 'owned' || current.registration !== 'owned' || current.runtime !== 'owned'
      )
        throw Error('Final service state did not match the operation.');
    });
    transaction(db, () => {
      owns();
      receipt!.state = 'completed';
      save();
      db!.prepare('DELETE FROM resource WHERE id=1 AND fence=? AND nonce=?').run(receipt!.fence, receipt!.nonce);
    });
    return receipt!;
  } catch (error) {
    if (receipt)
      try {
        transaction(db, () => {
          owns();
          receipt!.state = 'uncertain';
          if (['install', 'start', 'update'].includes(p.action))
            receipt!.recovery = manualRecoverySteps(p, receipt!.rehearsal?.result?.forwardOnly === true);
          save();
        });
      } catch {}
    throw error;
  } finally {
    db.close();
  }
}
export function releaseService(host: ServiceHost, snapshot: unknown, evidence: unknown): ServiceReceipt {
  const decision = lifecycleRecovery(snapshot, evidence);
  if (decision.action === 'retain') throw Error('Explicit stopped-handler/descendant evidence is required.');
  const db = journal(host.context);
  if (!db) throw Error('No lifecycle receipt.');
  db.close();
  const writable = journal(host.context, true)!;
  try {
    return transaction(writable, () => {
      const old = stored(writable, decision.snapshot.digest);
      if (!old) throw Error('No lifecycle receipt.');
      if (decision.action === 'return-receipt') return old;
      if (
        canonical({
          digest: old.digest,
          resource: old.resource,
          fence: old.fence,
          nonce: old.nonce,
          state: old.state,
        }) !== canonical(decision.snapshot)
      )
        throw Error('Lifecycle receipt changed.');
      try {
        process.kill(old.pid, 0);
        throw Error('Lifecycle handler remains live.');
      } catch (e) {
        if (!(e instanceof Error) || !('code' in e) || e.code !== 'ESRCH')
          throw Error('Lifecycle handler must be confirmed stopped.');
      }
      const r = writable.prepare('SELECT * FROM resource WHERE id=1').get();
      if (r?.digest !== old.digest || r.fence !== old.fence || r.nonce !== old.nonce || r.pid !== old.pid)
        throw Error('Lifecycle resource changed.');
      const planRow = writable.prepare('SELECT plan FROM operations WHERE digest=?').get(old.digest) as
        { plan: string } | undefined;
      if (planRow) {
        const storedPlan = JSON.parse(planRow.plan) as ServicePlan;
        if (storedPlan.action === 'update') {
          if (old.rehearsal?.result?.forwardOnly)
            throw Error(
              'Candidate update migrates the database schema forward; never release without restoring the operation backup — use nodes lifecycle-recover.',
            );
          const liveDbPath = databasePath(host.context.home);
          if (!present(liveDbPath))
            throw Error(
              'Live database is missing after an uncertain update; use nodes lifecycle-recover to restore the operation backup.',
            );
          safe(liveDbPath, host.context.uid);
          const liveDb = new DatabaseSync(liveDbPath, { readOnly: true });
          let liveSchema: number;
          try {
            liveSchema = Number(liveDb.prepare('PRAGMA user_version').get()!.user_version);
          } finally {
            liveDb.close();
          }
          if (liveSchema > storedPlan.before.schema)
            throw Error(
              'Live database was migrated forward from schema ' +
                storedPlan.before.schema +
                ' to ' +
                liveSchema +
                '; never start the previous revision on migrated data — use nodes lifecycle-recover to restore the operation backup.',
            );
          if (liveSchema !== storedPlan.before.schema)
            throw Error(
              'Live database schema changed during uncertain update (' +
                storedPlan.before.schema +
                ' -> ' +
                liveSchema +
                '); use nodes lifecycle-recover to restore the operation backup.',
            );
        }
      }
      const released = { ...old, state: 'released' as const };
      writable.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(JSON.stringify(released), old.digest);
      writable
        .prepare('INSERT INTO releases(digest,reason,created) VALUES(?,?,?)')
        .run(old.digest, decision.reason!, new Date().toISOString());
      writable.prepare('DELETE FROM resource WHERE id=1 AND fence=? AND nonce=?').run(old.fence, old.nonce);
      return released;
    });
  } finally {
    writable.close();
  }
}
/** The CLI release: the selected service must be observed unregistered and stopped first, whatever the evidence says. */
export async function releaseObservedService(
  host: ServiceHost,
  snapshot: unknown,
  evidence: unknown,
): Promise<ServiceReceipt> {
  const current = await host.inspect();
  if (current.registration !== 'absent' || current.runtime !== 'stopped' || current.pids.length)
    throw Error('The service is still registered or running; stop it and its descendants before releasing.');
  return releaseService(host, snapshot, evidence);
}
function restoreVerifiedUpdateBackup(
  c: ServiceContext,
  digest: string,
  expectedSchema: number,
  expectedDigest?: string,
): { digest: string; schema: number } {
  safe(c.home, c.uid, true);
  const verified = verifyUpdateBackup(c, digest, expectedSchema, expectedDigest);
  const liveDbPath = databasePath(c.home);
  const tag = randomBytes(8).toString('hex');
  const candidateDb = join(c.home, '.restore-db-' + tag + '.sqlite');
  const stagedFiles: { staged: string; dest: string }[] = [];
  try {
    copyFileSync(verified.databaseFile, candidateDb, constants.COPYFILE_EXCL);
    chmodSync(candidateDb, 0o600);
    const fd = openSync(candidateDb, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (fileHash(candidateDb) !== verified.databaseDigest)
      throw Error('Operation backup changed while staging restore.');
    for (const [name, expectedHash] of Object.entries(verified.files)) {
      const src = join(verified.dir, name);
      const dest = join(c.home, name);
      const staged = join(c.home, '.restore-' + name + '-' + tag);
      stagedFiles.push({ staged, dest });
      copyFileSync(src, staged, constants.COPYFILE_EXCL);
      chmodSync(staged, name === 'base.pub' ? 0o644 : 0o600);
      const fileFd = openSync(staged, 'r+');
      try {
        fsyncSync(fileFd);
      } finally {
        closeSync(fileFd);
      }
      if (fileHash(staged) !== expectedHash)
        throw Error(`Operation backup file ${name} changed while staging restore.`);
    }
    renameSync(candidateDb, liveDbPath);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = liveDbPath + suffix;
      if (present(sidecar)) unlinkSync(sidecar);
    }
    for (const { staged, dest } of stagedFiles) {
      renameSync(staged, dest);
    }
    syncDirectory(c.home);
  } finally {
    if (present(candidateDb)) rmSync(candidateDb, { force: true });
    for (const { staged } of stagedFiles) {
      if (present(staged)) rmSync(staged, { force: true });
    }
  }
  const check = new DatabaseSync(liveDbPath, { readOnly: true });
  try {
    const schema = Number(check.prepare('PRAGMA user_version').get()!.user_version);
    const quick = check.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    if (quick?.quick_check !== 'ok' || schema !== expectedSchema || fileHash(liveDbPath) !== verified.databaseDigest)
      throw Error('Restored live database failed post-restore verification.');
    return { digest: verified.databaseDigest, schema };
  } finally {
    check.close();
  }
}
/**
 * Explicit owner-invoked recovery for an uncertain update (F-005-T15). Never runs automatically: requires stopped
 * service/descendants, dead applying handler, clean checkout at the previous revision, and explicit confirmation of
 * the operation digest to restore the verified operation backup before releasing the lifecycle claim.
 */
export async function recoverServiceUpdate(
  host: ServiceHost,
  snapshot: unknown,
  evidence: unknown,
  confirmBackupRestore: string,
): Promise<ServiceReceipt> {
  const decision = lifecycleRecovery(snapshot, evidence);
  if (decision.action === 'retain') throw Error('Explicit stopped-handler/descendant evidence is required.');
  if (confirmBackupRestore !== decision.snapshot.digest)
    throw Error('Confirm the exact operation digest to restore its backup.');
  const current = await host.inspect();
  if (current.registration !== 'absent' || current.runtime !== 'stopped' || current.pids.length)
    throw Error('The service is still registered or running; stop it and its descendants before recovering.');
  if (current.definition !== 'owned' || current.legacy)
    throw Error('Service definition or legacy ownership changed; reconcile ownership before restoring the backup.');
  if (current.pending)
    throw Error(
      'Unresolved worker jobs or outbox effects exist in the live database; reconcile them before restoring the backup.',
    );
  if (!current.built) throw Error('Build the previous revision before restoring the operation backup.');
  const db = journal(host.context);
  if (!db) throw Error('No lifecycle receipt.');
  db.close();
  const writable = journal(host.context, true)!;
  try {
    return transaction(writable, () => {
      const old = stored(writable, decision.snapshot.digest);
      if (!old) throw Error('No lifecycle receipt.');
      if (decision.action === 'return-receipt') {
        if (!old.restoredBackup) throw Error('Stored receipt was not recovered from an operation backup.');
        return old;
      }
      if (
        canonical({
          digest: old.digest,
          resource: old.resource,
          fence: old.fence,
          nonce: old.nonce,
          state: old.state,
        }) !== canonical(decision.snapshot)
      )
        throw Error('Lifecycle receipt changed.');
      try {
        process.kill(old.pid, 0);
        throw Error('Lifecycle handler remains live.');
      } catch (e) {
        if (!(e instanceof Error) || !('code' in e) || e.code !== 'ESRCH')
          throw Error('Lifecycle handler must be confirmed stopped.');
      }
      const r = writable.prepare('SELECT * FROM resource WHERE id=1').get();
      if (r?.digest !== old.digest || r.fence !== old.fence || r.nonce !== old.nonce || r.pid !== old.pid)
        throw Error('Lifecycle resource changed.');
      const planRow = writable.prepare('SELECT plan FROM operations WHERE digest=?').get(old.digest) as
        { plan: string } | undefined;
      if (!planRow) throw Error('Stored update plan is missing.');
      const storedPlan = planOf(JSON.parse(planRow.plan), host);
      if (storedPlan.action !== 'update')
        throw Error('Backup restore recovery applies only to uncertain update operations.');
      if (!current.clean || current.revision !== storedPlan.before.revision)
        throw Error(
          `Check out the previous revision (${storedPlan.before.revision}) with a clean working tree before restoring the operation backup.`,
        );
      const restored = restoreVerifiedUpdateBackup(
        host.context,
        old.digest,
        storedPlan.before.schema,
        old.rehearsal?.source.digest,
      );
      const released: ServiceReceipt = {
        ...old,
        state: 'released',
        restoredBackup: {
          digest: restored.digest,
          schema: restored.schema,
          revision: storedPlan.before.revision,
        },
      };
      writable.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(JSON.stringify(released), old.digest);
      writable
        .prepare('INSERT INTO releases(digest,reason,created) VALUES(?,?,?)')
        .run(old.digest, decision.reason!, new Date().toISOString());
      writable.prepare('DELETE FROM resource WHERE id=1 AND fence=? AND nonce=?').run(old.fence, old.nonce);
      return released;
    });
  } finally {
    writable.close();
  }
}
