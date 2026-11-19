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
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { databasePath, readConfig, readToken } from './config.ts';
import { canonical, keyIdentity } from './kaji.ts';
import { renderService } from './service.ts';
import { NODE_FLAGS } from './process-client.ts';
import { UPGRADE_CONTRACT } from './upgrade-contract.ts';
import { READER_ENTRY, type RehearsalReport } from './upgrade-rehearsal.ts';
import { macServiceHost } from './node-lifecycle-mac.ts';
import { linuxServiceHost } from './node-lifecycle-linux.ts';
import { windowsServiceHost } from './node-lifecycle-windows.ts';
import { transaction } from './sqlite-transaction.ts';

export const SERVICE_LIFECYCLE_PROTOCOL = 1;
export const SERVICE_READER_SCHEMA = UPGRADE_CONTRACT.readerSchema;
export type Action = 'install' | 'start' | 'stop' | 'update' | 'uninstall';
export type State = 'running' | 'completed' | 'uncertain' | 'released' | 'refused';
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
  restoredBackup?: { digest: string; schema: number; revision: string };
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
  /** The identity of a process, asked through the adapter's own runner (B-073); without it the handler asks directly. */
  identity?(pid: number): Promise<string | undefined>;
}
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
/** The handler identity covers this file, the rehearsal comparison it gates updates on and the reader contract, so a plan made under other code or bounds is refused. */
export const handler = () =>
  hash(
    Buffer.concat([
      readFileSync(fileURLToPath(import.meta.url)),
      readFileSync(fileURLToPath(new URL('./upgrade-rehearsal.ts', import.meta.url))),
      Buffer.from(canonical(UPGRADE_CONTRACT)),
    ]),
  );
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const hostKind = (host: ServiceHost): ServiceKind => host.kind ?? 'mac-service';
const platformOf = (kind: ServiceKind): 'darwin' | 'linux' | 'win32' =>
  kind === 'windows-service' ? 'win32' : kind === 'linux-service' ? 'linux' : 'darwin';
export const definition = (c: ServiceContext, kind: ServiceKind = 'mac-service', overridePath?: string) =>
  overridePath ??
  (kind === 'windows-service'
    ? join(c.home, 'nerv-task.xml')
    : kind === 'linux-service'
      ? join(process.env.XDG_CONFIG_HOME || join(c.userHome, '.config'), 'systemd/user/nerv.service')
      : join(c.userHome, 'Library/LaunchAgents/io.nerv.agent.plist'));
export const windowsLauncherPath = (c: ServiceContext) => join(c.home, 'nerv-service.vbs');
export const expectedDefinition = (c: ServiceContext, kind: ServiceKind = 'mac-service'): string | Buffer =>
  kind === 'windows-service'
    ? Buffer.from('\ufeff' + renderService('win32', c.home, c.source, c.node), 'utf16le')
    : renderService(platformOf(kind), c.home, c.source, c.node);
export const area = (c: ServiceContext) => join(c.userHome, '.nerv-lifecycle');
export const resource = (c: ServiceContext, kind: ServiceKind = 'mac-service') =>
  'user-service:' + c.uid + ':' + platformOf(kind);
export function safe(path: string, uid: number, privateMode = false): void {
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
export function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return false;
    throw e;
  }
}
export function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function fileHash(path: string): string {
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
export function exclusive(path: string, bytes: string | Buffer): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(dirname(path));
}
export function journal(c: ServiceContext, write = false): DatabaseSync | undefined {
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
  if (write) {
    db.exec('PRAGMA synchronous=FULL');
    db.exec('PRAGMA journal_mode=TRUNCATE');
  }
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

function transientJournalError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; errcode?: unknown; message?: unknown };
  if (typeof e.errcode === 'number') {
    const base = e.errcode & 0xff;
    if (base === 5 || base === 10) return true; // SQLITE_BUSY (5) or SQLITE_IOERR (10)
  }
  const msg = typeof e.message === 'string' ? e.message : '';
  return /disk i\/o error|database is locked|database table is locked/i.test(msg);
}

/**
 * Run a lifecycle journal transaction, retrying transient SQLite I/O or lock errors
 * (for example Windows Defender/process-exit contention on journal.sqlite).
 */
export function journalTransaction<T>(
  db: DatabaseSync,
  work: () => T,
  options?: { delaysMs?: number[]; sleep?: (ms: number) => void },
): T {
  const delays = options?.delaysMs ?? [50, 150, 350, 750, 1500];
  const sleep = options?.sleep ?? ((ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  let attempt = 0;
  for (;;) {
    try {
      return transaction(db, work);
    } catch (error) {
      if (!transientJournalError(error) || attempt >= delays.length) throw error;
      sleep(delays[attempt++]!);
    }
  }
}
export function stored(db: DatabaseSync | undefined, digest: string): ServiceReceipt | undefined {
  if (!db || !db.prepare("SELECT 1 FROM sqlite_master WHERE name='operations'").get()) return;
  const row = db.prepare('SELECT receipt FROM operations WHERE digest=?').get(digest) as
    { receipt: string } | undefined;
  return row ? (JSON.parse(row.receipt) as ServiceReceipt) : undefined;
}
export function held(db: DatabaseSync | undefined): boolean {
  return (
    !!db?.prepare("SELECT 1 FROM sqlite_master WHERE name='resource'").get() &&
    !!db.prepare('SELECT 1 FROM resource').get()
  );
}
export function blockers(action: Action, o: ServiceObservation, next?: string): string[] {
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
  requireServiceFiles(host.context.home);
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
export function planOf(raw: unknown, host: ServiceHost): ServicePlan {
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
/** A cold PowerShell start on a loaded Windows machine took longer than the 15 s command bound (B-073, CI 2026-11-18);
 * the query only reads, so a longer bound costs nothing when it is fast. */
export const WINDOWS_IDENTITY_TIMEOUT_MS = 60000;
export async function processIdentity(
  pid: number,
  run: typeof command = command,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (platform === 'win32') {
    const r = await run(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `try { $p = [Diagnostics.Process]::GetProcessById(${pid}); "$($p.StartTime.ToFileTimeUtc())|$($p.MainModule.FileName)" } catch { exit 1 }`,
      ],
      undefined,
      WINDOWS_IDENTITY_TIMEOUT_MS,
    );
    return r.status === 0 && r.out.trim() ? hash(r.out.trim()) : undefined;
  }
  const r = await run('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'args=']);
  return r.status === 0 && r.out.trim() ? hash(r.out.trim()) : undefined;
}
/** The running handler's identity never changes, so it is queried once per process (a cold PowerShell start on Windows
 * can approach the command bound; B-073). A failed query is not kept, so the next operation asks again. */
export function ownIdentity(query: (pid: number) => Promise<string | undefined> = processIdentity) {
  let known: string | undefined;
  return async () => (known ??= await query(process.pid));
}
export const handlerIdentity = ownIdentity();
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
    (await (host.identity ?? processIdentity)(snapshot.pid)) !== snapshot.identity ||
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
export async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw Error('Service outcome is unconfirmed; inspect the retained receipt.');
}

/** Node's folder first on the child's PATH, joined with the platform separator: ':' on Windows broke the first entry,
 * so schtasks was not found and every lifecycle command failed there (B-080). */
export function childPath(
  nodeDir: string,
  path: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string {
  const separator = platform === 'win32' ? ';' : ':';
  return path ? nodeDir + separator + path : nodeDir;
}
/** The environment a lifecycle command gets: a short allowlist, plus the user session bus that `systemctl --user` needs
 * (without XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS it found no bus on a real Linux host, B-085), Node first on PATH. */
export function childEnv(
  source: Record<string, string | undefined>,
  nodeDir: string,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = Object.fromEntries(
    ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']
      .filter((k) => source[k] !== undefined)
      .map((k) => [k, source[k]]),
  );
  env.PATH = childPath(nodeDir, env.PATH, platform);
  return env;
}
export interface Result {
  status: number | null;
  out: string;
  err: string;
}
export async function command(
  program: string,
  args: string[],
  cwd?: string,
  timeout = 15000,
  extra: Record<string, string> = {},
): Promise<Result> {
  const env: Record<string, string | undefined> = {
    ...childEnv(process.env, dirname(process.execPath)),
    ...extra,
  };
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

/** The files a lifecycle operation reads, and the command that creates each (B-084: a raw ENOENT before). */
const SERVICE_HOME_FILES: [string, string][] = [
  ['config.json', 'nerv init'],
  ['token', 'nerv init'],
  ['base-key', 'nerv base pubkey'],
  ['base.pub', 'nerv base pubkey'],
  ['nerv.sqlite', 'nerv doctor'],
];
export function requireServiceHome(home: string): void {
  if (!present(home)) {
    throw Error(
      `NERV data home ${home} does not exist yet; nothing was changed. Initialize it first (for example: nerv setup or nerv doctor).`,
    );
  }
}
/** The files a lifecycle plan reads (B-084), checked when planning only: the startup guard builds a host for every
 * command, so a host must not demand the key `nerv base pubkey` is about to create (B-092). */
export function requireServiceFiles(home: string): void {
  requireServiceHome(home);
  const missing = SERVICE_HOME_FILES.filter(([name]) => !present(join(home, name)));
  if (missing.length)
    throw Error(
      `NERV data home ${home} is not fully initialized (missing ${missing.map(([n]) => n).join(', ')}); nothing was changed. ` +
        `Create them first: ${[...new Set(missing.map(([, c]) => c))].join(', then ')}.`,
    );
}

export { applyService, releaseService, releaseObservedService, recoverServiceUpdate } from './node-lifecycle-apply.ts';
export { macRegistrationMatches, macServiceHost, macServiceAdapter } from './node-lifecycle-mac.ts';
export { linuxServiceHost, linuxServiceAdapter } from './node-lifecycle-linux.ts';
export { windowsRegistrationMatches, windowsServiceHost, windowsServiceAdapter } from './node-lifecycle-windows.ts';
