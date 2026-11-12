import { createHash, randomBytes, createPrivateKey, createPublicKey } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { databasePath, readConfig, readToken } from './config.ts';
import { canonical, keyIdentity, ROOT_KEY_FILE } from './kaji.ts';
import { WINDOWS_TASK, renderService, windowsLauncher } from './service.ts';
import { NODE_FLAGS } from './process-client.ts';
import { assertRootMigrationReady } from './root-migration.ts';
import { lifecycleRecovery } from './node-lifecycle.ts';
import { transaction } from './sqlite-transaction.ts';
import { UPGRADE_CONTRACT } from './upgrade-contract.ts';
import { rehearseUpgrade, READER_ENTRY, type RehearsalReport } from './upgrade-rehearsal.ts';

export const SERVICE_LIFECYCLE_PROTOCOL = 1;
export const SERVICE_READER_SCHEMA = UPGRADE_CONTRACT.readerSchema;
type Action = 'install' | 'start' | 'stop' | 'update' | 'uninstall';
type State = 'running' | 'completed' | 'uncertain' | 'released' | 'refused';
export type ServiceKind = 'mac-service' | 'linux-service' | 'windows-service';
export interface ServiceContext {
  userHome: string;
  home: string;
  source: string;
  node: string;
  uid: number;
}
export interface ServicePrerequisites {
  ok: boolean;
  nodeVersion: string | null;
  requiredNode: string;
  executableOk: boolean;
  nonInteractiveOk: boolean;
  issues: string[];
}
export interface ServiceObservation {
  revision: string;
  schema: number;
  profile: string;
  definition: 'absent' | 'owned' | 'foreign';
  registration: 'absent' | 'owned' | 'foreign';
  runtime: 'stopped' | 'owned' | 'unknown';
  pids: number[];
  session: boolean;
  clean: boolean;
  legacy: boolean;
  pending: boolean;
  built: boolean;
  prerequisites?: ServicePrerequisites;
}
export interface ServicePlan {
  version: 1;
  kind: ServiceKind;
  action: Action;
  context: ServiceContext;
  before: ServiceObservation;
  nextRevision?: string;
  handler: string;
  nonce: string;
  created: string;
  blockers: string[];
  digest: string;
}
export interface ServiceHealthCheck {
  ok: boolean;
  checkedAt: string;
  commit: string | null;
  baseId: string | null;
  database: string | null;
  nervous: boolean;
  brain: boolean;
  failures: string[];
}
export interface ServiceReceipt {
  digest: string;
  resource: string;
  fence: number;
  nonce: string;
  pid: number;
  identity: string;
  state: State;
  steps: string[];
  rehearsal?: Pick<RehearsalReport, 'source' | 'result' | 'blockers'>;
  health?: ServiceHealthCheck;
  recovery?: string[];
}
/** Trusted adapter injection is for tests; no manifest or CLI input can select an adapter or command text. */
export interface ServiceHost {
  readonly kind?: ServiceKind;
  readonly definitionPath?: string;
  context: ServiceContext;
  inspect(): Promise<ServiceObservation>;
  command(
    step: 'register' | 'unregister' | 'fetch' | 'checkout' | 'dependencies' | 'build',
    plan: ServicePlan,
  ): Promise<void>;
  compatible(revision: string): Promise<boolean>;
  backup(path: string): Promise<void>;
  rehearse(plan: ServicePlan, backup: string): Promise<RehearsalReport>;
  health?(plan: ServicePlan): Promise<ServiceHealthCheck>;
  authorizedStart?(plan: ServicePlan): Promise<boolean>;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
/** The handler identity covers this file, the rehearsal comparison it gates updates on and the reader contract, so a plan made under other code or bounds is refused. */
const handler = () =>
  hash(
    Buffer.concat([
      readFileSync(fileURLToPath(import.meta.url)),
      readFileSync(fileURLToPath(new URL('./upgrade-rehearsal.ts', import.meta.url))),
      Buffer.from(canonical(UPGRADE_CONTRACT)),
    ]),
  );
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hostKind = (host: ServiceHost): ServiceKind => host.kind ?? 'mac-service';
const platformOf = (kind: ServiceKind): 'darwin' | 'linux' | 'win32' =>
  kind === 'windows-service' ? 'win32' : kind === 'linux-service' ? 'linux' : 'darwin';
const definition = (c: ServiceContext, kind: ServiceKind = 'mac-service', overridePath?: string) =>
  overridePath ??
  (kind === 'windows-service'
    ? join(c.home, 'nerv-task.xml')
    : kind === 'linux-service'
      ? join(process.env.XDG_CONFIG_HOME || join(c.userHome, '.config'), 'systemd/user/nerv.service')
      : join(c.userHome, 'Library/LaunchAgents/io.nerv.agent.plist'));
const windowsLauncherPath = (c: ServiceContext) => join(c.home, 'nerv-service.vbs');
const expectedDefinition = (c: ServiceContext, kind: ServiceKind = 'mac-service'): string | Buffer =>
  kind === 'windows-service'
    ? Buffer.from('\ufeff' + renderService('win32', c.home, c.source, c.node), 'utf16le')
    : renderService(platformOf(kind), c.home, c.source, c.node);
const area = (c: ServiceContext) => join(c.userHome, '.nerv-lifecycle');
const resource = (c: ServiceContext, kind: ServiceKind = 'mac-service') =>
  'user-service:' + c.uid + ':' + platformOf(kind);
function safe(path: string, uid: number, privateMode = false): void {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' &&
      ((stat.uid !== uid && stat.uid !== 0) ||
        stat.mode & 0o022 ||
        (privateMode && (stat.uid !== uid || !!(stat.mode & 0o077)))))
  )
    throw Error('Service path ownership, permissions or symlink requires review.');
  const actual = realpathSync(path);
  if (actual !== resolve(path)) throw Error('Service paths must be canonical and symlink-free.');
}
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return false;
    throw e;
  }
}
function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function fileHash(path: string): string {
  const fd = openSync(path, 'r'),
    digest = createHash('sha256'),
    bytes = Buffer.alloc(65536);
  try {
    let n: number;
    while ((n = readSync(fd, bytes, 0, bytes.length, null)) > 0) digest.update(bytes.subarray(0, n));
    return digest.digest('hex');
  } finally {
    closeSync(fd);
  }
}
function exclusive(path: string, bytes: string | Buffer): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(dirname(path));
}
function journal(c: ServiceContext, write = false): DatabaseSync | undefined {
  const root = area(c),
    marker = join(root, 'owner.json'),
    file = join(root, 'journal.sqlite'),
    created = !present(root);
  if (created) {
    if (!write) return;
    mkdirSync(root, { mode: 0o700 });
    const db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    db.close();
    exclusive(marker, JSON.stringify({ version: 1, kind: 'nerv-lifecycle' }));
  }
  safe(root, c.uid, true);
  safe(marker, c.uid, true);
  safe(file, c.uid, true);
  if (readFileSync(marker, 'utf8') !== JSON.stringify({ version: 1, kind: 'nerv-lifecycle' }))
    throw Error('Unknown lifecycle journal; do not reset ownership.');
  const db = new DatabaseSync(file, { readOnly: !write });
  db.exec('PRAGMA busy_timeout=5000');
  if (write) db.exec('PRAGMA synchronous=FULL');
  if (created)
    db.exec(
      "CREATE TABLE IF NOT EXISTS operations(digest TEXT PRIMARY KEY,plan TEXT NOT NULL,receipt TEXT NOT NULL);CREATE TABLE IF NOT EXISTS resource(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,fence INTEGER NOT NULL,nonce TEXT NOT NULL,pid INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS clock(id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL);INSERT OR IGNORE INTO clock VALUES(1,0);CREATE TABLE IF NOT EXISTS releases(id INTEGER PRIMARY KEY,digest TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL);CREATE TRIGGER IF NOT EXISTS operations_no_delete BEFORE DELETE ON operations BEGIN SELECT RAISE(ABORT,'lifecycle history is retained');END;",
    );
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  if (!['operations', 'resource', 'clock', 'releases'].every((name) => tables.includes(name))) {
    db.close();
    throw Error('Lifecycle journal is incomplete; never reset its clock.');
  }
  const clock = db.prepare('SELECT value FROM clock WHERE id=1').get(),
    max = db.prepare("SELECT max(json_extract(receipt,'$.fence')) AS value FROM operations").get();
  if (!clock || !Number.isSafeInteger(clock.value) || Number(clock.value) < Number(max?.value ?? 0)) {
    db.close();
    throw Error('Lifecycle fencing history is missing or rolled back.');
  }
  return db;
}
function stored(db: DatabaseSync | undefined, digest: string): ServiceReceipt | undefined {
  if (!db || !db.prepare("SELECT 1 FROM sqlite_master WHERE name='operations'").get()) return;
  const row = db.prepare('SELECT receipt FROM operations WHERE digest=?').get(digest) as
    { receipt: string } | undefined;
  return row ? (JSON.parse(row.receipt) as ServiceReceipt) : undefined;
}
function held(db: DatabaseSync | undefined): boolean {
  return (
    !!db?.prepare("SELECT 1 FROM sqlite_master WHERE name='resource'").get() &&
    !!db.prepare('SELECT 1 FROM resource').get()
  );
}
function blockers(action: Action, o: ServiceObservation, next?: string): string[] {
  const out: string[] = [];
  if (o.schema < UPGRADE_CONTRACT.minimumServiceSchema || o.schema > SERVICE_READER_SCHEMA)
    out.push('The selected database schema is unsupported.');
  if (!o.session) out.push('The selected GUI user session is unavailable.');
  if (!o.clean) out.push('The source checkout must be clean.');
  if (o.legacy) out.push('Legacy service ownership requires a separate review.');
  if (o.pending) out.push('Reconcile pending or uncertain work first.');
  if (!o.built && action !== 'uninstall') out.push('Build the selected source first.');
  if (o.definition === 'foreign' || o.registration === 'foreign' || o.runtime === 'unknown')
    out.push('Service or runtime ownership is unknown or belongs elsewhere.');
  if (action === 'install' && (o.definition !== 'absent' || o.registration !== 'absent' || o.runtime !== 'stopped'))
    out.push('Install requires absent definition/registration and stopped runtime.');
  if (action !== 'install' && o.definition !== 'owned')
    out.push('The definition must exactly match this profile, source and Node.');
  if (['start', 'update', 'uninstall'].includes(action) && (o.registration !== 'absent' || o.runtime !== 'stopped'))
    out.push('Stop the selected service and descendants first.');
  if (action === 'stop' && o.registration === 'absent' && o.runtime !== 'stopped')
    out.push('A foreground runtime must be stopped separately.');
  if (action === 'update' && (!next || next === o.revision))
    out.push('Select a distinct reviewed compatible revision.');
  if (['install', 'start', 'update'].includes(action) && o.prerequisites && !o.prerequisites.ok) {
    if (o.prerequisites.issues.length) out.push(...o.prerequisites.issues);
    else out.push('Service prerequisites are not satisfied.');
  }
  return out;
}
export async function planService(host: ServiceHost, action: Action, nextRevision?: string): Promise<ServicePlan> {
  if (
    !['install', 'start', 'stop', 'update', 'uninstall'].includes(action) ||
    (nextRevision !== undefined && !/^[a-f0-9]{40}$/.test(nextRevision)) ||
    (action !== 'update' && nextRevision !== undefined)
  )
    throw Error('Invalid service action or pinned revision.');
  const before = await host.inspect(),
    db = journal(host.context);
  let pending: boolean;
  try {
    pending = held(db);
  } finally {
    db?.close();
  }
  const issues = blockers(action, before, nextRevision);
  if (pending) issues.push('A lifecycle operation owns this user service.');
  if (action === 'update' && nextRevision && !(await host.compatible(nextRevision)))
    issues.push(
      'This revision is not admitted: beyond documentation it must descend from the installed revision, carry the upgrade reader entry and declare a Node range this runtime meets, with a supported actual schema.',
    );
  const body = {
    version: SERVICE_LIFECYCLE_PROTOCOL as 1,
    kind: hostKind(host),
    action,
    context: host.context,
    before,
    ...(nextRevision ? { nextRevision } : {}),
    handler: handler(),
    nonce: randomBytes(16).toString('hex'),
    created: new Date().toISOString(),
    blockers: issues,
  };
  return { ...body, digest: hash(canonical(body)) };
}
function planOf(raw: unknown, host: ServiceHost): ServicePlan {
  if (
    !object(raw) ||
    raw.version !== SERVICE_LIFECYCLE_PROTOCOL ||
    raw.kind !== hostKind(host) ||
    typeof raw.digest !== 'string' ||
    !['install', 'start', 'stop', 'update', 'uninstall'].includes(String(raw.action)) ||
    canonical(raw.context) !== canonical(host.context) ||
    !object(raw.before) ||
    typeof raw.handler !== 'string' ||
    !Array.isArray(raw.blockers)
  )
    throw Error('Invalid local service plan.');
  const { digest, ...body } = raw;
  if (hash(canonical(body)) !== digest) throw Error('Service plan digest differs.');
  return structuredClone(raw) as unknown as ServicePlan;
}
export function serviceReceipt(host: ServiceHost, digest: string): ServiceReceipt | { state: 'absent' } {
  const db = journal(host.context);
  try {
    return stored(db, digest) ?? { state: 'absent' };
  } finally {
    db?.close();
  }
}
async function processIdentity(pid: number): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform === 'win32') {
    const r = await command('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `try { $p = [Diagnostics.Process]::GetProcessById(${pid}); "$($p.StartTime.ToFileTimeUtc())|$($p.MainModule.FileName)" } catch { exit 1 }`,
    ]);
    return r.status === 0 && r.out.trim() ? hash(r.out.trim()) : undefined;
  }
  const r = await command('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'args=']);
  return r.status === 0 && r.out.trim() ? hash(r.out.trim()) : undefined;
}
/** A retained resource fences ordinary startup. Only the exact manager-owned start already recorded by its live handler can pass. */
export async function assertServiceStartup(host: ServiceHost, managedStart = false): Promise<void> {
  const db = journal(host.context);
  if (!db) return;
  let snapshot: ServiceReceipt | undefined, plan: ServicePlan | undefined;
  try {
    if (!held(db)) return;
    const owner = db.prepare('SELECT * FROM resource WHERE id=1').get()!;
    snapshot = stored(db, String(owner.digest));
    if (!snapshot || snapshot.fence !== owner.fence || snapshot.nonce !== owner.nonce || snapshot.pid !== owner.pid)
      throw Error('Lifecycle ownership requires reconciliation.');
    if (
      !managedStart ||
      snapshot.state !== 'running' ||
      snapshot.steps.at(-1) !== 'start:started' ||
      !host.authorizedStart
    )
      throw Error('Lifecycle operation is unresolved; inspect its receipt before startup.');
    const row = db.prepare('SELECT plan FROM operations WHERE digest=?').get(snapshot.digest) as { plan: string };
    plan = planOf(JSON.parse(row.plan), host);
  } finally {
    db.close();
  }
  if (
    !snapshot ||
    !plan ||
    // An update starts the candidate revision, whose lifecycle files may differ from the installed code that made the
    // plan; the live applying handler (identity below) checked its own handler at apply time and owns this start.
    (plan.action !== 'update' && plan.handler !== handler()) ||
    (await processIdentity(snapshot.pid)) !== snapshot.identity ||
    !(await host.authorizedStart!(plan))
  )
    throw Error('Lifecycle startup is not authorized by the live selected operation.');
  const check = journal(host.context)!;
  try {
    const owner = check.prepare('SELECT * FROM resource WHERE id=1').get();
    if (!owner) return;
    const current = stored(check, snapshot.digest);
    if (
      !current ||
      canonical(current) !== canonical(snapshot) ||
      owner.digest !== snapshot.digest ||
      owner.fence !== snapshot.fence ||
      owner.nonce !== snapshot.nonce ||
      owner.pid !== snapshot.pid
    )
      throw Error('Lifecycle startup ownership changed.');
  } finally {
    check.close();
  }
}
export async function guardLocalService(home: string, managedStart = false): Promise<void> {
  if (
    (process.platform !== 'darwin' && process.platform !== 'linux' && process.platform !== 'win32') ||
    !present(join(homedir(), '.nerv-lifecycle'))
  )
    return;
  const host =
    process.platform === 'win32'
      ? windowsServiceHost(join(homedir(), '.nerv'))
      : process.platform === 'linux'
        ? linuxServiceHost(join(homedir(), '.nerv'))
        : macServiceHost(join(homedir(), '.nerv'));
  await assertServiceStartup(host, managedStart && resolve(home) === host.context.home);
}
const inspectHint = (p: ServicePlan): string =>
  p.kind === 'windows-service'
    ? `Inspect and stop the Windows Task Scheduler task before anything else (schtasks /Query /TN "${WINDOWS_TASK}" /V /FO LIST; schtasks /End /TN "${WINDOWS_TASK}"), and confirm no descendant process remains.`
    : p.kind === 'linux-service'
      ? 'Inspect and stop the user service before anything else (systemctl --user status nerv.service; systemctl --user disable --now nerv.service), and confirm no descendant process remains.'
      : `Inspect and stop the service before anything else (launchctl print gui/${p.context.uid}/io.nerv.agent; launchctl bootout gui/${p.context.uid}/io.nerv.agent), and confirm no descendant process remains.`;
const manualRecoverySteps = (p: ServicePlan): string[] =>
  p.action === 'update'
    ? [
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
  const identity = await processIdentity(process.pid);
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
        const report = await host.rehearse(p, join(area(host.context), 'backups', p.digest));
        await settled(p.before.revision);
        // A reader that moves the schema forward cannot be undone by checking out the old revision; that recovery is
        // not built yet, so such an upgrade ends here.
        const blockers = report.result?.forwardOnly
          ? [
              ...report.blockers,
              'The candidate migrates the data from schema ' +
                report.source.schema +
                ' to ' +
                report.result.schema +
                '; forward migrations are not admitted until their recovery exists.',
            ]
          : report.blockers;
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
            next.revision === (p.nextRevision ?? p.before.revision)
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
          if (['install', 'start', 'update'].includes(p.action)) receipt!.recovery = manualRecoverySteps(p);
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
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw Error('Service outcome is unconfirmed; inspect the retained receipt.');
}

interface Result {
  status: number | null;
  out: string;
  err: string;
}
async function command(
  program: string,
  args: string[],
  cwd?: string,
  timeout = 15000,
  extra: Record<string, string> = {},
): Promise<Result> {
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(
      ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL']
        .filter((k) => process.env[k] !== undefined)
        .map((k) => [k, process.env[k]]),
    ),
    ...extra,
  };
  env.PATH = dirname(process.execPath) + ':' + (env.PATH ?? '');
  return new Promise((done, fail) => {
    const child = spawn(program, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '',
      bytes = 0;
    const timer = setTimeout(() => {
      child.kill();
      fail(Error('Lifecycle command timed out; effects remain uncertain.'));
    }, timeout);
    const add = (target: 'out' | 'err', b: Buffer) => {
      bytes += b.length;
      if (bytes > 1048576) {
        child.kill();
        clearTimeout(timer);
        fail(Error('Lifecycle command output exceeded its bound.'));
      } else if (target === 'out') out += b;
      else err += b;
    };
    child.stdout.on('data', (b: Buffer) => add('out', b));
    child.stderr.on('data', (b: Buffer) => add('err', b));
    child.once('error', () => {
      clearTimeout(timer);
      fail(Error('Lifecycle command could not start.'));
    });
    child.once('close', (status) => {
      clearTimeout(timer);
      done({ status, out, err });
    });
  });
}
/** Public keys follow baseKey's mode644 convention; private credentials and matching key identity remain mandatory. */
export function serviceProfileIdentity(c: ServiceContext): string {
  for (const name of ['config.json', 'token', 'base-key']) safe(join(c.home, name), c.uid, true);
  safe(join(c.home, 'base.pub'), c.uid);
  const token = readFileSync(join(c.home, 'token'), 'utf8').trim();
  if (readToken(c.home) !== token || process.env.NERV_PORT !== undefined || process.env.NODO_PORT !== undefined)
    throw Error('Service lifecycle requires persistent configuration and token, without runtime overrides.');
  const pub = readFileSync(join(c.home, 'base.pub'), 'utf8').trim(),
    key = createPrivateKey(readFileSync(join(c.home, 'base-key'), 'utf8'));
  if (createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64') !== keyIdentity(pub))
    throw Error('Base private/public identity mismatch.');
  readConfig(c.home);
  return hash(
    canonical({
      config: hash(readFileSync(join(c.home, 'config.json'))),
      token: hash(token),
      privateKey: hash(readFileSync(join(c.home, 'base-key'))),
      publicKey: hash(readFileSync(join(c.home, 'base.pub'))),
    }),
  );
}
/**
 * Checks Node version, Node/CLI executable readiness, and non-interactive service environment
 * before install, start, or update.
 */
export async function checkServicePrerequisites(
  c: ServiceContext,
  run: typeof command = command,
  options: { session?: boolean } = {},
): Promise<ServicePrerequisites> {
  const issues: string[] = [];
  let requiredNode = '>=24.0.0';
  try {
    const pkg = JSON.parse(readFileSync(join(c.source, 'package.json'), 'utf8')) as {
      engines?: { node?: unknown };
    };
    if (typeof pkg.engines?.node === 'string' && pkg.engines.node.trim()) {
      requiredNode = pkg.engines.node.trim();
    } else {
      issues.push('Source package.json must declare a valid engines.node range.');
    }
  } catch {
    issues.push('Source package.json could not be read for Node prerequisite check.');
  }

  let executableOk = true;
  let nodeVersion: string | null = null;
  try {
    safe(c.node, c.uid);
    const stat = lstatSync(c.node);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o111) === 0)) {
      executableOk = false;
      issues.push('Configured Node binary is not a regular executable file.');
    }
  } catch {
    executableOk = false;
    issues.push('Configured Node executable failed ownership, permission or canonical path checks.');
  }
  if (!existsSync(join(c.source, 'src/cli.ts'))) {
    executableOk = false;
    issues.push('NERV CLI entrypoint src/cli.ts is missing from the selected source.');
  }

  const versionResult = await run(c.node, [...NODE_FLAGS, '--version']).catch(() => ({
    status: -1,
    out: '',
    err: '',
  }));
  if (versionResult.status !== 0) {
    executableOk = false;
    issues.push('Configured Node executable failed non-interactive startup.');
  } else {
    nodeVersion = versionResult.out.trim() || null;
    if (!nodeVersion || !engineSatisfied(requiredNode, nodeVersion)) {
      issues.push(`Node ${nodeVersion ?? 'unknown'} does not satisfy required ${requiredNode}.`);
    }
  }

  const pathsCanonical =
    isAbsolute(c.node) &&
    isAbsolute(c.source) &&
    isAbsolute(c.home) &&
    !/[\r\n\0]/.test(c.node) &&
    !/[\r\n\0]/.test(c.source) &&
    !/[\r\n\0]/.test(c.home);
  const sessionOk =
    options.session !== undefined
      ? options.session
      : (await run('launchctl', ['print', 'gui/' + c.uid]).catch(() => ({ status: -1, out: '', err: '' }))).status ===
        0;
  const nonInteractiveOk = pathsCanonical && sessionOk && versionResult.status === 0;
  if (!pathsCanonical || !sessionOk) {
    issues.push('Non-interactive service environment is unavailable (canonical paths or user service session failed).');
  }

  return {
    ok: issues.length === 0,
    nodeVersion,
    requiredNode,
    executableOk,
    nonInteractiveOk,
    issues,
  };
}
/** The Node range a candidate declares must be the plain `>=X.Y.Z` form and be met by the service's own runtime. */
function engineSatisfied(range: unknown, version: string): boolean {
  const need = typeof range === 'string' ? /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range.trim()) : null,
    have = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!need || !have) return false;
  for (let i = 1; i <= 3; i++) if (Number(have[i]) !== Number(need[i])) return Number(have[i]) > Number(need[i]);
  return true;
}
/**
 * Admission of an update, before any effect. The pin must be a commit that descends from the installed revision
 * (never a downgrade or another line). One that changes only documentation needs nothing more. Any other must carry
 * the reader entry the rehearsal runs and declare a Node range this runtime meets. This admits the attempt, not the data: the journaled rehearsal then
 * runs the candidate's reader on the operation's backup and can still refuse it.
 */
export async function compatibleServiceRevision(
  c: ServiceContext,
  revision: string,
  run: typeof command = command,
): Promise<boolean> {
  if (!/^[a-f0-9]{40}$/.test(revision)) return false;
  const db = new DatabaseSync(databasePath(c.home), { readOnly: true });
  let schema: number;
  try {
    schema = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  } finally {
    db.close();
  }
  if (schema < UPGRADE_CONTRACT.minimumServiceSchema || schema > SERVICE_READER_SCHEMA) return false;
  const git = (args: string[]) => run('git', ['-C', c.source, ...args]);
  // The pin must be a commit (a tag object would check out as another id) that contains the installed revision.
  const kind = await git(['cat-file', '-t', revision]);
  if (kind.status !== 0 || kind.out.trim() !== 'commit') return false;
  if ((await git(['merge-base', '--is-ancestor', 'HEAD', revision])).status !== 0) return false;
  const diff = await git(['diff', '--no-renames', '--name-only', '-z', 'HEAD', revision, '--']);
  if (diff.status !== 0) return false;
  if (
    diff.out
      .split('\0')
      .filter(Boolean)
      .every((path) => path.startsWith('docs/') || path === 'README.md')
  )
    return true;
  if ((await git(['cat-file', '-e', revision + ':' + READER_ENTRY])).status !== 0) return false;
  const manifest = await git(['show', revision + ':package.json']),
    runtime = await run(c.node, ['--version']);
  if (manifest.status !== 0 || runtime.status !== 0) return false;
  try {
    return engineSatisfied((JSON.parse(manifest.out) as { engines?: { node?: unknown } }).engines?.node, runtime.out);
  } catch {
    return false;
  }
}
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
          'npm',
          // No install scripts: an admitted application upgrade may change the lockfile, and package scripts are not rehearsed.
          step === 'dependencies' ? ['ci', '--engine-strict', '--ignore-scripts'] : ['run', 'build'],
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
        return await rehearseUpgrade(backup, async (database, home) => {
          const r = await run(context.node, [...NODE_FLAGS, join(tree, READER_ENTRY), database, home], tree, 120000, {
            NERV_HOME: home,
          });
          if (r.status !== 0) throw Error('The candidate reader exited with a failure.');
        });
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
      '--property=LoadState,ActiveState,SubState,MainPID,ExecStart,WorkingDirectory,Environment',
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
        registered = linuxRegistrationMatches(manager.out, context) ? 'owned' : 'foreign';
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
export function windowsRegistrationMatches(output: string, c: ServiceContext): boolean {
  const launcher = windowsLauncherPath(c).replace(/\\/g, '/').toLowerCase();
  const normalized = output.replace(/\\/g, '/').toLowerCase();
  const hasWscript = normalized.includes('wscript.exe') || normalized.includes('wscript');
  const hasLauncher = normalized.includes(launcher);
  const hasTaskName = normalized.includes(WINDOWS_TASK.toLowerCase());
  return hasTaskName && hasWscript && hasLauncher;
}

/** Production Windows adapter: current unprivileged Windows user, current checkout and default `.nerv` data home. */
export function windowsServiceHost(home: string): ServiceHost {
  if (process.platform !== 'win32') {
    throw Error('Durable Windows local lifecycle requires Windows.');
  }
  const context: ServiceContext = {
    userHome: homedir(),
    home: resolve(home),
    source: realpathSync(fileURLToPath(new URL('..', import.meta.url))),
    node: realpathSync(process.execPath),
    uid: 0,
  };
  if (context.home !== join(context.userHome, '.nerv')) {
    throw Error('An additional or legacy profile cannot manage this OS service.');
  }
  return windowsServiceAdapter(context);
}

/** Windows Task Scheduler lifecycle adapter (`windows-service`) under the shared fencing journal. */
export function windowsServiceAdapter(context: ServiceContext, run: typeof command = command): ServiceHost {
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
            pids.length > 0
              ? 'owned'
              : 'unknown';
        } else {
          runtime = 'unknown';
        }
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
        definition: defKind,
        registration: registered,
        runtime,
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
        hash(readFileSync(vbsPath)) === hash(expectedVbs)
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
