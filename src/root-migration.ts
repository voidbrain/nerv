import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  fstatSync,
  readSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { databasePath, readConfig } from './config.ts';
import {
  canonical,
  Registry,
  REGISTRY_SCHEMA,
  ROOT_KEY_FILE,
  publicKeyFrom,
  keyIdentity,
  verifyRecord,
  type SignedRecord,
} from './kaji.ts';
import { transaction } from './sqlite-transaction.ts';

interface Bundle {
  root: string;
  records: SignedRecord[];
}
export interface RootPlan {
  version: 1;
  kind: 'root-migration';
  home: string;
  oldRoot: string;
  bundle: Bundle;
  configHash: string;
  registryHash: string;
  oldKeyHash: string | null;
  newKeyPath: string | null;
  newKeyHash: string | null;
  identity: string;
  port: number;
  handlerHash: string;
  digest: string;
}
type Phase = 'accepted' | 'backup' | 'registry' | 'key' | 'config';
interface Receipt {
  digest: string;
  state: 'applying' | 'uncertain' | 'completed';
  phase: Phase;
  fence: number;
}
interface Operation extends Receipt {
  plan: string;
  nonce: string;
  pid: number;
  backupHash: string | null;
}
export interface RootApplyOptions {
  confirm: string;
  confirmedStopped: boolean;
  backupConfirmed: boolean;
  resume?: boolean;
  reason?: string;
  onPhase?: (phase: Phase) => void;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const handlerHash = () => hash(readFileSync(fileURLToPath(import.meta.url)));
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const journal = `CREATE TABLE IF NOT EXISTS root_migrations(digest TEXT PRIMARY KEY,plan TEXT NOT NULL,state TEXT NOT NULL,phase TEXT NOT NULL,fence INTEGER NOT NULL,nonce TEXT NOT NULL,pid INTEGER NOT NULL,backupHash TEXT);
 CREATE TABLE IF NOT EXISTS root_migration_resource(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,fence INTEGER NOT NULL,nonce TEXT NOT NULL,pid INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS root_migration_clock(id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL);
 INSERT OR IGNORE INTO root_migration_clock VALUES(1,0);
 CREATE TABLE IF NOT EXISTS root_migration_recovery(id INTEGER PRIMARY KEY,digest TEXT NOT NULL,fence INTEGER NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL);`;
function readFile(path: string, max = 1048576, privateFile = false): Buffer {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max)
    throw Error('Migration input must be a bounded regular file without symlinks.');
  if (process.platform !== 'win32' && (s.uid !== process.getuid?.() || (privateFile && (s.mode & 0o077) !== 0)))
    throw Error('Migration file ownership/permissions require review.');
  return readFileSync(path);
}
function checkHome(home: string): string {
  const path = resolve(home),
    s = lstatSync(path),
    actual = realpathSync(path);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    (process.platform === 'win32' ? actual.toLowerCase() !== path.toLowerCase() : actual !== path) ||
    (process.platform !== 'win32' && (s.uid !== process.getuid?.() || (s.mode & 0o077) !== 0)) ||
    process.getuid?.() === 0
  )
    throw Error('Migration needs the private, real data home of an unprivileged owner.');
  return path;
}
function openDatabase(home: string, readOnly = true): DatabaseSync {
  const path = databasePath(home),
    stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.uid !== process.getuid?.()))
    throw Error('Invalid database ownership/path.');
  const db = new DatabaseSync(path, { readOnly });
  db.exec('PRAGMA busy_timeout=5000');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version < 5 || version > 6) {
    db.close();
    throw Error('Upgrade the reviewed NERV database reader before migration.');
  }
  return db;
}
function bundleOf(value: unknown): Bundle {
  if (
    !object(value) ||
    typeof value.root !== 'string' ||
    !Array.isArray(value.records) ||
    !value.records.length ||
    value.records.length > 256
  )
    throw Error('Invalid public migration bundle.');
  if (keyIdentity(value.root) !== value.root) throw Error('Migration root must use canonical public-key encoding.');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(REGISTRY_SCHEMA);
    const registry = new Registry(db, value.root),
      serials = new Set<number>();
    for (const raw of value.records) {
      if (!object(raw) || !object(raw.body) || typeof raw.signature !== 'string' || raw.signature.length > 128)
        throw Error('Invalid migration record.');
      const r = raw as unknown as SignedRecord;
      if (
        (r.body.kind === 'enrol' || (r.body.kind === 'revoke' && r.body.publicKey !== undefined)) &&
        keyIdentity(r.body.publicKey!) !== r.body.publicKey
      )
        throw Error('Replacement base keys must use canonical public-key encoding.');
      if (serials.has(r.body.serial)) throw Error('Migration serials must be unique.');
      serials.add(r.body.serial);
      registry.add(r);
    }
    const records = registry.records();
    if (records.length !== value.records.length) throw Error('Duplicate migration record.');
    return { root: value.root, records };
  } finally {
    db.close();
  }
}
function idle(db: DatabaseSync): void {
  const has = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (
    (has('worker_jobs') &&
      db.prepare("SELECT 1 FROM worker_jobs WHERE state NOT IN ('completed','cancelled','released') LIMIT 1").get()) ||
    (has('kaji_outbox') && db.prepare('SELECT 1 FROM kaji_outbox WHERE done IS NULL LIMIT 1').get()) ||
    (has('worker_legacy_outbox') &&
      db.prepare("SELECT 1 FROM worker_legacy_outbox WHERE state='pending' LIMIT 1").get())
  )
    throw Error('Reconcile pending/uncertain workers and outboxes before migrating trust.');
}
function validateMembership(db: DatabaseSync, root: string, bundle: Bundle, identity: string): void {
  const old = new Registry(db, root),
    temp = new DatabaseSync(':memory:');
  try {
    temp.exec(REGISTRY_SCHEMA);
    const next = new Registry(temp, bundle.root);
    for (const record of bundle.records) next.add(record);
    const bases = next.bases();
    if (!bases.some((b) => keyIdentity(b.publicKey) === keyIdentity(identity) && b.status === 'enrolled'))
      throw Error('Replacement registry does not enroll this base.');
    for (const b of old.bases())
      if (
        (b.status === 'enrolled' &&
          !bases.some(
            (n) =>
              n.status === 'enrolled' &&
              n.baseId === b.baseId &&
              keyIdentity(n.publicKey) === keyIdentity(b.publicKey) &&
              n.address === b.address &&
              n.name === b.name,
          )) ||
        (b.status === 'revoked' &&
          bases.some((n) => n.status === 'enrolled' && keyIdentity(n.publicKey) === keyIdentity(b.publicKey)))
      )
        throw Error('Migration must retain enrolled identities and cannot resurrect revoked keys.');
    const tagged = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='registry_roots'").get();
    const history = tagged
      ? (
          db
            .prepare('SELECT r.body,r.signature,g.root FROM registry r LEFT JOIN registry_roots g ON g.id=r.id')
            .all() as { body: string; signature: string; root: string | null }[]
        ).map((r) => ({
          root: r.root ?? root,
          record: { body: JSON.parse(r.body), signature: r.signature } as SignedRecord,
        }))
      : old.records().map((record) => ({ root, record }));
    const revokedKeys = new Set<string>(),
      wildcards = new Set<string>(),
      currentWildcardIds = new Set<string>();
    for (const item of history) {
      if (!verifyRecord(item.root, item.record)) throw Error('Historical root binding/signature is invalid.');
      const b = item.record.body;
      if (b.kind === 'revoke') {
        if (b.publicKey) revokedKeys.add(keyIdentity(b.publicKey));
        else {
          wildcards.add(keyIdentity(item.root) + '\n' + b.baseId);
          if (keyIdentity(item.root) === keyIdentity(root)) currentWildcardIds.add(b.baseId);
        }
      }
    }
    for (const {
      root: authority,
      record: { body: b },
    } of history)
      if (b.kind === 'enrol' && wildcards.has(keyIdentity(authority) + '\n' + b.baseId))
        revokedKeys.add(keyIdentity(b.publicKey!));
    if (
      bases.some(
        (b) =>
          b.status === 'enrolled' && (revokedKeys.has(keyIdentity(b.publicKey)) || currentWildcardIds.has(b.baseId)),
      )
    )
      throw Error('Migration cannot resurrect a historically revoked key or wildcard-revoked base.');
    if (old.main() !== next.main()) throw Error('Migration must retain the selected main base.');
  } finally {
    temp.close();
  }
}
export function planRootMigration(home: string, value: unknown, newKeyPath?: string): RootPlan {
  home = checkHome(home);
  const configBytes = readFile(join(home, 'config.json'), 65536, true),
    config = readConfig(home),
    oldRoot = config.kaji?.root;
  if (!oldRoot) throw Error('Existing-root migration needs an already pinned root.');
  publicKeyFrom(oldRoot);
  const bundle = bundleOf(value);
  if (keyIdentity(bundle.root) === keyIdentity(oldRoot)) throw Error('Select a different replacement root.');
  const identity = readFile(join(home, 'base.pub'), 256).toString('utf8').trim();
  publicKeyFrom(identity);
  const oldKey = join(home, ROOT_KEY_FILE),
    oldKeyHash = existsSync(oldKey) ? hash(readFile(oldKey, 65536, true)) : null;
  let newKeyHash: string | null = null;
  const keyPath = newKeyPath ? resolve(newKeyPath) : null;
  if ((oldKeyHash && !keyPath) || (keyPath && !oldKeyHash))
    throw Error('Only the existing root-holder supplies a replacement encrypted key.');
  if (keyPath) {
    const bytes = readFile(keyPath, 65536, true);
    let key: unknown;
    try {
      key = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw Error('Invalid replacement encrypted key.');
    }
    if (
      !object(key) ||
      key.version !== 1 ||
      key.kdf !== 'scrypt' ||
      key.publicKey !== bundle.root ||
      key.n !== 32768 ||
      !['salt', 'iv', 'tag', 'secret'].every(
        (field, i) =>
          typeof key[field] === 'string' &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(key[field] as string) &&
          Buffer.from(key[field] as string, 'base64').length === [16, 12, 16, 48][i] &&
          Buffer.from(key[field] as string, 'base64').toString('base64') === key[field],
      )
    )
      throw Error('Replacement encrypted key does not match the signed bundle.');
    newKeyHash = hash(bytes);
  }
  const db = openDatabase(home);
  let registryHash: string;
  try {
    idle(db);
    if (
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='root_migration_resource'").get() &&
      db.prepare('SELECT 1 FROM root_migration_resource').get()
    )
      throw Error('A migration resource is held; inspect its receipt.');
    if (
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='registry_roots'").get() &&
      (db.prepare('SELECT DISTINCT root FROM registry_roots').all() as { root: string }[]).some(
        (r) => keyIdentity(r.root) === keyIdentity(bundle.root),
      )
    )
      throw Error('Replacement root must be fresh; historical root reuse is not supported.');
    validateMembership(db, oldRoot, bundle, identity);
    registryHash = hash(canonical(new Registry(db, oldRoot).records()));
  } finally {
    db.close();
  }
  const body = {
    version: 1 as const,
    kind: 'root-migration' as const,
    home,
    oldRoot,
    bundle,
    configHash: hash(configBytes),
    registryHash,
    oldKeyHash,
    newKeyPath: keyPath,
    newKeyHash,
    identity,
    port: config.port,
    handlerHash: handlerHash(),
  };
  return { ...body, digest: hash(canonical(body)) };
}
function planOf(value: unknown): RootPlan {
  if (!object(value) || value.version !== 1 || value.kind !== 'root-migration' || typeof value.digest !== 'string')
    throw Error('Invalid migration plan.');
  const { digest, ...body } = value;
  if (hash(canonical(body)) !== digest || body.handlerHash !== handlerHash())
    throw Error('Migration plan/handler differs from the reviewed digest.');
  const keys = [
    'version',
    'kind',
    'home',
    'oldRoot',
    'bundle',
    'configHash',
    'registryHash',
    'oldKeyHash',
    'newKeyPath',
    'newKeyHash',
    'identity',
    'port',
    'handlerHash',
  ];
  if (Object.keys(body).some((k) => !keys.includes(k)) || Object.keys(body).length !== keys.length)
    throw Error('Unexpected migration plan fields.');
  for (const k of ['home', 'oldRoot', 'configHash', 'registryHash', 'identity'])
    if (typeof body[k] !== 'string') throw Error('Invalid migration plan field.');
  for (const k of ['oldKeyHash', 'newKeyPath', 'newKeyHash'])
    if (body[k] !== null && typeof body[k] !== 'string') throw Error('Invalid migration key field.');
  if (!Number.isInteger(body.port) || Number(body.port) < 1 || Number(body.port) > 65535)
    throw Error('Invalid migration port.');
  bundleOf(body.bundle);
  checkHome(String(body.home));
  return structuredClone(value) as unknown as RootPlan;
}
function op(db: DatabaseSync, digest: string): Operation | undefined {
  const row = db.prepare('SELECT * FROM root_migrations WHERE digest=?').get(digest) as unknown as
    Operation | undefined;
  if (
    row &&
    (!['applying', 'uncertain', 'completed'].includes(row.state) ||
      !['accepted', 'backup', 'registry', 'key', 'config'].includes(row.phase) ||
      !Number.isSafeInteger(row.pid) ||
      row.pid < 1 ||
      !Number.isSafeInteger(row.fence) ||
      row.fence < 1 ||
      typeof row.nonce !== 'string' ||
      !row.nonce ||
      typeof row.plan !== 'string')
  )
    throw Error('Migration journal ownership is invalid; do not infer stopped work.');
  return row;
}
const receipt = (row: Operation): Receipt => ({
  digest: row.digest,
  state: row.state,
  phase: row.phase,
  fence: row.fence,
});
export function rootMigrationStatus(home: string, digest: string): Receipt | { state: 'absent' } {
  const db = openDatabase(checkHome(home));
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='root_migrations'").get())
      return { state: 'absent' };
    const row = op(db, digest);
    return row ? receipt(row) : { state: 'absent' };
  } finally {
    db.close();
  }
}
export function assertRootMigrationReady(home: string): void {
  if (!existsSync(databasePath(home))) return;
  // Every CLI command runs this check; it waits for a starting service's write lock as Store does (B-048).
  const db = new DatabaseSync(databasePath(home), { readOnly: true, timeout: 5000 });
  try {
    if (
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='root_migration_resource'").get() &&
      db.prepare('SELECT 1 FROM root_migration_resource').get()
    )
      throw Error('Root migration is unresolved; use root-migration status/apply --resume.');
    if (
      Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version) >= 6 &&
      readConfig(home).kaji?.rootBinding !== true
    )
      throw Error('Migrated trust requires root-bound peer authentication; do not downgrade the binding.');
  } finally {
    db.close();
  }
}
function writeExclusive(path: string, value: string | Buffer): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, value);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function fileHash(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Invalid backup file.');
  const fd = openSync(path, 'r'),
    digest = createHash('sha256'),
    buffer = Buffer.alloc(1024 * 1024);
  try {
    if (!fstatSync(fd).isFile()) throw Error('Invalid backup handle.');
    let size: number;
    while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, size));
    return digest.digest('hex');
  } finally {
    closeSync(fd);
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
async function reservePort(port: number): Promise<() => void> {
  const server = createServer();
  return new Promise((done, fail) => {
    server.once('error', () =>
      fail(Error('The configured runtime port is in use; stop and inspect the selected runtime.')),
    );
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => done(() => server.close()));
  });
}
export async function applyRootMigration(value: unknown, options: RootApplyOptions): Promise<Receipt> {
  const plan = planOf(value);
  if (options.confirm !== plan.digest || options.confirmedStopped !== true || options.backupConfirmed !== true)
    throw Error('Confirm the exact plan, stopped runtime/descendants and independent encrypted-root backup.');
  const db = openDatabase(plan.home, false);
  let releasePort: (() => void) | undefined,
    owned = false,
    nonce = '',
    fence = 0;
  const area = join(plan.home, '.root-migrations'),
    backup = join(area, plan.digest);
  const owns = () => {
    const current = db.prepare('SELECT * FROM root_migration_resource WHERE id=1').get() as
      Record<string, unknown> | undefined;
    if (
      current?.digest !== plan.digest ||
      current.nonce !== nonce ||
      current.fence !== fence ||
      current.pid !== process.pid
    )
      throw Error('Migration ownership changed.');
  };
  const progress = (phase: Phase, backupHash?: string) =>
    transaction(db, () => {
      owns();
      db.prepare('UPDATE root_migrations SET phase=?,backupHash=COALESCE(?,backupHash) WHERE digest=?').run(
        phase,
        backupHash ?? null,
        plan.digest,
      );
    });
  try {
    const previous = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='root_migrations'").get()
      ? op(db, plan.digest)
      : undefined;
    if (previous?.state === 'completed') return receipt(previous);
    if (previous && previous.plan !== canonical(plan))
      throw Error('Stored migration plan differs from the reviewed digest.');
    if (previous && !options.resume) return receipt(previous);
    if (options.resume) {
      if (
        !previous ||
        typeof options.reason !== 'string' ||
        options.reason.trim().length < 8 ||
        options.reason.length > 500 ||
        /[\r\n\0]/.test(options.reason)
      )
        throw Error('Explicit recovery needs a recorded stopped-operation reason.');
      try {
        process.kill(previous.pid, 0);
        throw Error('Migration handler is still live.');
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH')
          throw Error('Old migration handler must be confirmed stopped.');
      }
    }
    releasePort = await reservePort(plan.port);
    idle(db);
    if (hash(canonical(new Registry(db, plan.oldRoot).records())) !== plan.registryHash)
      throw Error('Old registry changed; re-plan before effects.');
    if (!previous) {
      const current = planRootMigration(plan.home, plan.bundle, plan.newKeyPath ?? undefined);
      if (current.digest !== plan.digest) throw Error('Target configuration/identity/key changed; re-plan.');
    }
    db.exec(journal);
    transaction(db, () => {
      const current = db.prepare('SELECT * FROM root_migration_resource WHERE id=1').get() as
        Record<string, unknown> | undefined;
      if (previous) {
        if (
          !current ||
          current.digest !== plan.digest ||
          current.nonce !== previous.nonce ||
          current.fence !== previous.fence ||
          current.pid !== previous.pid
        )
          throw Error('Recovery ownership changed.');
      } else if (current) throw Error('Another root migration owns this profile.');
      db.prepare('UPDATE root_migration_clock SET value=value+1 WHERE id=1').run();
      fence = Number((db.prepare('SELECT value FROM root_migration_clock').get() as { value: number }).value);
      nonce = randomUUID();
      if (previous) {
        db.prepare('UPDATE root_migration_resource SET fence=?,nonce=?,pid=? WHERE id=1').run(
          fence,
          nonce,
          process.pid,
        );
        db.prepare("UPDATE root_migrations SET state='applying',fence=?,nonce=?,pid=? WHERE digest=?").run(
          fence,
          nonce,
          process.pid,
          plan.digest,
        );
        db.prepare('INSERT INTO root_migration_recovery(digest,fence,reason,created) VALUES(?,?,?,?)').run(
          plan.digest,
          fence,
          options.reason!,
          new Date().toISOString(),
        );
      } else {
        db.prepare('INSERT INTO root_migration_resource VALUES(1,?,?,?,?)').run(plan.digest, fence, nonce, process.pid);
        db.prepare("INSERT INTO root_migrations VALUES(?,?,'applying','accepted',?,?,?,NULL)").run(
          plan.digest,
          canonical(plan),
          fence,
          nonce,
          process.pid,
        );
      }
      db.exec('PRAGMA user_version=6');
      owned = true;
    });
    options.onPhase?.('accepted');
    if (!existsSync(area)) mkdirSync(area, { mode: 0o700 });
    checkHome(area);
    if (!previous || previous.phase === 'accepted') {
      if (!existsSync(backup)) mkdirSync(backup, { mode: 0o700 });
      checkHome(backup);
      if (!existsSync(join(backup, 'config.json')))
        writeExclusive(join(backup, 'config.json'), readFile(join(plan.home, 'config.json'), 65536, true));
      if (plan.oldKeyHash && !existsSync(join(backup, ROOT_KEY_FILE)))
        writeExclusive(join(backup, ROOT_KEY_FILE), readFile(join(plan.home, ROOT_KEY_FILE), 65536, true));
      const file = join(backup, 'database.sqlite');
      if (!existsSync(file)) {
        db.prepare('VACUUM INTO ?').run(file);
        chmodSync(file, 0o600);
      }
      const check = new DatabaseSync(file, { readOnly: true });
      try {
        if (
          (check.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check !== 'ok' ||
          hash(canonical(new Registry(check, plan.oldRoot).records())) !== plan.registryHash
        )
          throw Error('Recovery backup is not the reviewed consistent snapshot.');
      } finally {
        check.close();
      }
      const fd = openSync(file, 'r+');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      syncDirectory(backup);
      progress('backup', fileHash(file));
      options.onPhase?.('backup');
    }
    checkHome(backup);
    const original = readFile(join(backup, 'config.json'), 65536, true);
    if (hash(original) !== plan.configHash) throw Error('Original configuration backup differs.');
    const row = op(db, plan.digest)!;
    if (!row.backupHash || fileHash(join(backup, 'database.sqlite')) !== row.backupHash)
      throw Error('Consistent database backup needs reconciliation.');
    if (plan.oldKeyHash && hash(readFile(join(backup, ROOT_KEY_FILE), 65536, true)) !== plan.oldKeyHash)
      throw Error('Original encrypted-key backup differs.');
    transaction(db, () => {
      owns();
      idle(db);
      db.exec(REGISTRY_SCHEMA);
      const legacy = db
        .prepare(
          'SELECT r.id,r.body,r.signature FROM registry r LEFT JOIN registry_roots g ON g.id=r.id WHERE g.id IS NULL',
        )
        .all() as { id: string; body: string; signature: string }[];
      for (const r of legacy) {
        if (!verifyRecord(plan.oldRoot, { body: JSON.parse(r.body), signature: r.signature } as SignedRecord))
          throw Error('Unscoped historical registry does not match the old root.');
        db.prepare('INSERT INTO registry_roots VALUES(?,?)').run(r.id, plan.oldRoot);
      }
      db.prepare('INSERT OR IGNORE INTO registry_seen SELECT ?,base_id,last_seen FROM kaji_seen').run(plan.oldRoot);
      const registry = new Registry(db, plan.bundle.root);
      for (const record of plan.bundle.records) registry.add(record);
      progress('registry');
    });
    options.onPhase?.('registry');
    const replace = (path: string, bytes: Buffer | string, oldHash: string | null, newHash: string) => {
      owns();
      const current = existsSync(path) ? hash(readFile(path, 1048576, true)) : null;
      if (current === newHash) return;
      if (current !== oldHash) throw Error('Live migration file changed; retain uncertainty.');
      const candidate = join(backup, 'candidate-' + nonce + '-' + randomUUID());
      writeExclusive(candidate, bytes);
      if ((existsSync(path) ? hash(readFile(path, 1048576, true)) : null) !== oldHash)
        throw Error('Migration file changed before atomic replacement.');
      renameSync(candidate, path);
      syncDirectory(dirname(path));
    };
    if (plan.newKeyPath) {
      const bytes = readFile(plan.newKeyPath, 65536, true);
      if (hash(bytes) !== plan.newKeyHash) throw Error('Replacement encrypted key changed.');
      replace(join(plan.home, ROOT_KEY_FILE), bytes, plan.oldKeyHash, plan.newKeyHash!);
    }
    progress('key');
    options.onPhase?.('key');
    const config = JSON.parse(original.toString('utf8')) as Record<string, unknown>;
    const next =
      JSON.stringify(
        { ...config, kaji: { ...(config.kaji as object), root: plan.bundle.root, rootBinding: true } },
        null,
        2,
      ) + '\n';
    replace(join(plan.home, 'config.json'), next, plan.configHash, hash(next));
    progress('config');
    options.onPhase?.('config');
    if (
      readConfig(plan.home).kaji?.root !== plan.bundle.root ||
      readConfig(plan.home).kaji?.rootBinding !== true ||
      hash(canonical(new Registry(db, plan.bundle.root).records())) !== hash(canonical(plan.bundle.records))
    )
      throw Error('Post-activation root/registry verification failed.');
    transaction(db, () => {
      owns();
      db.prepare("UPDATE root_migrations SET state='completed' WHERE digest=?").run(plan.digest);
      db.prepare('DELETE FROM root_migration_resource WHERE id=1 AND nonce=? AND fence=?').run(nonce, fence);
    });
    owned = false;
    return receipt(op(db, plan.digest)!);
  } catch (error) {
    if (owned)
      try {
        transaction(db, () => {
          owns();
          db.prepare("UPDATE root_migrations SET state='uncertain' WHERE digest=?").run(plan.digest);
        });
      } catch {}
    throw error;
  } finally {
    releasePort?.();
    db.close();
  }
}
export async function rootMigrationCommand(home: string, args: string[]): Promise<unknown> {
  const [command, ...rest] = args,
    values = new Map<string, string>(),
    flags = new Set<string>();
  const allowed =
    command === 'plan'
      ? ['bundle', 'new-key', 'out']
      : command === 'apply'
        ? ['plan', 'confirm', 'reason']
        : command === 'status'
          ? ['digest']
          : [];
  if (!allowed.length)
    throw Error(
      'Use root-migration plan --bundle FILE [--new-key FILE] [--out FILE] | apply --plan FILE --confirm DIGEST --confirmed-stopped --backup-confirmed [--resume --reason EVIDENCE] | status --digest DIGEST.',
    );
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]!.slice(2);
    if (!rest[i]!.startsWith('--') || values.has(key) || flags.has(key))
      throw Error('Invalid/duplicate migration option.');
    if (command === 'apply' && ['confirmed-stopped', 'backup-confirmed', 'resume'].includes(key)) flags.add(key);
    else if (allowed.includes(key) && rest[i + 1] && !rest[i + 1]!.startsWith('--')) values.set(key, rest[++i]!);
    else throw Error('Invalid migration option.');
  }
  const required = (key: string) => {
    const v = values.get(key);
    if (!v) throw Error('Missing --' + key);
    return v;
  };
  if (command === 'status') return rootMigrationStatus(home, required('digest'));
  const value = JSON.parse(readFile(required(command === 'plan' ? 'bundle' : 'plan')).toString('utf8')) as unknown;
  if (command === 'apply') {
    const plan = planOf(value);
    if (resolve(home) !== plan.home) throw Error('Migration plan belongs to a different data home.');
    return applyRootMigration(plan, {
      confirm: required('confirm'),
      confirmedStopped: flags.has('confirmed-stopped'),
      backupConfirmed: flags.has('backup-confirmed'),
      resume: flags.has('resume'),
      reason: values.get('reason'),
    });
  }
  const plan = planRootMigration(home, value, values.get('new-key'));
  if (values.has('out')) {
    writeExclusive(values.get('out')!, JSON.stringify(plan, null, 2) + '\n');
    return { saved: values.get('out'), digest: plan.digest, execution: 'none' };
  }
  return plan;
}
