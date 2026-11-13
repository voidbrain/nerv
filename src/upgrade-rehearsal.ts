import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from './store.ts';
import { UPGRADE_CONTRACT } from './upgrade-contract.ts';

/**
 * Upgrade rehearsal (F-005-T06, review only). The reader of THIS checkout opens a private copy of a lifecycle backup,
 * and the result is compared with the untouched copy: nothing is inferred from markers, and neither the backup, the
 * data home, the checkout nor any service is changed. A clean report is evidence for a review, never an admission.
 */
export type UpgradeReader = (database: string, home: string) => void | Promise<void>;
/** Where a candidate tree keeps the reader an installed revision runs: `node READER_ENTRY DATABASE HOME`. */
export const READER_ENTRY = 'src/upgrade-reader.ts';
export interface RehearsalReport {
  version: 1;
  execution: 'rehearsal-only';
  contract: typeof UPGRADE_CONTRACT;
  source: { digest: string; schema: number };
  result?: { schema: number; forwardOnly: boolean; tables: number; rows: number; rowsAfter: number };
  blockers: string[];
  note: string;
}
const NOTE =
  'Rehearsal on a private copy only. It admits no upgrade, and a schema that moves forward can be undone only by a separately reviewed restore.';
const LIVE = ['nerv.sqlite', 'nodo.sqlite'];
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
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
function privateEntry(path: string, uid: number | undefined, directory: boolean): void {
  const stat = lstatSync(path);
  const posixPrivate = uid === undefined ? true : stat.uid === uid && !(stat.mode & 0o077);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    !posixPrivate ||
    realpathSync(path) !== path
  )
    throw Error('The backup must be a private, symlink-free copy owned by this user.');
}
/** The reader a candidate checkout ships: its real Store, with the copied configuration as its data home. */
export const currentReader: UpgradeReader = (database, home) => {
  new Store(database, undefined, { home }).db.close();
};

interface Comparison {
  schema: number;
  tables: number;
  rows: number;
  counts: Map<string, number>;
  blockers: string[];
}
const FTS_SHADOW = ['_data', '_idx', '_content', '_docsize', '_config'];
/** Compares the untouched copy with the copy a reader opened. Both are opened read-only. */
function compare(prior: string, next: string): Comparison {
  const blockers: string[] = [],
    counts = new Map<string, number>(),
    db = new DatabaseSync(prior, { readOnly: true });
  let tables = 0,
    rows = 0,
    schema: number;
  try {
    db.prepare('ATTACH DATABASE ? AS rehearsed').run(next);
    schema = Number(db.prepare('PRAGMA rehearsed.user_version').get()!.user_version);
    if (db.prepare('PRAGMA rehearsed.integrity_check').get()!.integrity_check !== 'ok')
      blockers.push('The data fails its integrity check after the reader ran.');
    const violations = (name: string) => db.prepare('PRAGMA ' + name + '.foreign_key_check').all().length;
    try {
      if (violations('rehearsed') > violations('main')) blockers.push('The reader left new foreign-key violations.');
    } catch {
      blockers.push('The reader left foreign keys that can no longer be checked.');
    }
    const listed = (name: string, type: string) =>
      db
        .prepare(
          'SELECT name,sql FROM ' + name + ".sqlite_master WHERE type=? AND substr(name,1,7)<>'sqlite_' ORDER BY name",
        )
        .all(type) as { name: string; sql: string | null }[];
    const count = (name: string, table: string) =>
      Number(db.prepare('SELECT count(*) AS n FROM ' + name + '.' + quote(table)).get()!.n);
    const rowIds = (name: string, table: string) => {
      try {
        db.prepare('SELECT rowid FROM ' + name + '.' + quote(table) + ' LIMIT 0').all();
        return true;
      } catch {
        return false;
      }
    };
    for (const type of ['index', 'trigger'] as const) {
      const kept = new Set(listed('rehearsed', type).map((o) => o.name));
      for (const o of listed('main', type))
        if (!kept.has(o.name)) blockers.push('The ' + type + ' ' + o.name + ' is missing after the reader ran.');
    }
    const before = listed('main', 'table'),
      after = new Set(listed('rehearsed', 'table').map((t) => t.name));
    const virtual = before.filter((t) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql ?? '')).map((t) => t.name);
    for (const table of before) {
      if (virtual.some((name) => FTS_SHADOW.some((suffix) => table.name === name + suffix))) continue;
      if (!after.has(table.name)) {
        blockers.push('Table ' + table.name + ' is missing after the reader ran.');
        continue;
      }
      const had = count('main', table.name),
        has = count('rehearsed', table.name);
      counts.set(table.name, has);
      tables++;
      rows += had;
      if (virtual.includes(table.name)) {
        if (has < had) blockers.push('Search index ' + table.name + ' lost ' + (had - has) + ' indexed row(s).');
        continue;
      }
      const columns = (name: string) =>
        db.prepare('PRAGMA ' + name + '.table_info(' + quote(table.name) + ')').all() as { name: string; pk: number }[];
      const old = columns('main'),
        kept = new Set(columns('rehearsed').map((c) => c.name)),
        dropped = old.filter((c) => !kept.has(c.name));
      for (const column of dropped) blockers.push('Table ' + table.name + ' lost column ' + column.name + '.');
      const keys = old.filter((c) => c.pk > 0).map((c) => c.name);
      if (dropped.some((c) => keys.includes(c.name))) continue;
      // Row ids are channel cursors (the inbox) and must survive with their keys; only a table that never had them is matched by key alone.
      const match = keys.map((key) => 'b.' + quote(key) + ' IS a.' + quote(key));
      if (rowIds('main', table.name)) {
        if (!rowIds('rehearsed', table.name)) {
          blockers.push('Table ' + table.name + ' lost its row ids.');
          continue;
        }
        match.push('b.rowid=a.rowid');
      }
      const missing = Number(
        db
          .prepare(
            'SELECT count(*) AS n FROM main.' +
              quote(table.name) +
              ' a WHERE NOT EXISTS(SELECT 1 FROM rehearsed.' +
              quote(table.name) +
              ' b WHERE ' +
              match.join(' AND ') +
              ')',
          )
          .get()!.n,
      );
      if (missing) blockers.push('Table ' + table.name + ' lost or renumbered ' + missing + ' existing row(s).');
    }
    const sequences = (name: string) =>
      db.prepare('SELECT 1 FROM ' + name + ".sqlite_master WHERE name='sqlite_sequence'").get()
        ? (db.prepare('SELECT name,seq FROM ' + name + '.sqlite_sequence').all() as { name: string; seq: number }[])
        : [];
    const current = new Map(sequences('rehearsed').map((row) => [row.name, Number(row.seq)]));
    for (const row of sequences('main'))
      if ((current.get(row.name) ?? -1) < Number(row.seq))
        blockers.push('The id counter of ' + row.name + ' was lowered.');
  } finally {
    db.close();
  }
  return { schema, tables, rows, counts, blockers };
}

/**
 * Rehearses `reader` on a copy of BACKUP (the layout a lifecycle update backup has: database.sqlite, optional
 * config.json and manifest.json). The actual input schema is checked against the contract before the reader runs.
 */
export async function rehearseUpgrade(backup: string, reader: UpgradeReader = currentReader): Promise<RehearsalReport> {
  const uid = process.getuid?.();
  if (process.platform !== 'win32' && uid === undefined)
    throw Error('Upgrade rehearsal needs POSIX private-file ownership; it is not available on this platform yet.');
  if (!isAbsolute(backup) || resolve(backup) !== backup) throw Error('Name the backup directory by its absolute path.');
  privateEntry(backup, uid, true);
  if (readdirSync(backup).some((name) => LIVE.includes(name) || /-(wal|shm|journal)$/.test(name)))
    throw Error('This looks like a live data home. Rehearse on a backup copy only.');
  const database = join(backup, 'database.sqlite'),
    config = join(backup, 'config.json'),
    manifest = join(backup, 'manifest.json'),
    configured = existsSync(config);
  privateEntry(database, uid, false);
  if (configured) privateEntry(config, uid, false);
  const digest = fileHash(database),
    blockers: string[] = [];
  if (existsSync(manifest)) {
    privateEntry(manifest, uid, false);
    let recorded: unknown;
    try {
      recorded = (JSON.parse(readFileSync(manifest, 'utf8')) as { database?: unknown }).database;
    } catch {
      recorded = undefined;
    }
    if (recorded !== digest) throw Error('The database differs from its backup manifest; take a fresh backup.');
  }
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-rehearsal-'));
  try {
    chmodSync(work, 0o700);
    const prior = join(work, 'prior.sqlite'),
      next = join(work, 'nerv.sqlite');
    for (const copy of [prior, next]) {
      copyFileSync(database, copy, constants.COPYFILE_EXCL);
      chmodSync(copy, 0o600);
    }
    // Only the database and config.json are copied; credentials in a lifecycle backup stay where they are.
    if (configured) {
      copyFileSync(config, join(work, 'config.json'), constants.COPYFILE_EXCL);
      chmodSync(join(work, 'config.json'), 0o600);
    }
    if (fileHash(prior) !== digest || fileHash(next) !== digest)
      throw Error('The backup changed while it was copied; take a fresh backup.');
    let schema = -1,
      sound = false;
    try {
      const source = new DatabaseSync(prior, { readOnly: true });
      try {
        schema = Number(source.prepare('PRAGMA user_version').get()!.user_version);
        sound = source.prepare('PRAGMA quick_check').get()!.quick_check === 'ok';
      } finally {
        source.close();
      }
    } catch {
      sound = false;
    }
    const report = (result?: RehearsalReport['result']): RehearsalReport => ({
      version: 1,
      execution: 'rehearsal-only',
      contract: UPGRADE_CONTRACT,
      source: { digest, schema },
      ...(result ? { result } : {}),
      blockers,
      note: NOTE,
    });
    if (!sound) blockers.push('The backup fails its integrity check.');
    else if (schema < UPGRADE_CONTRACT.minimumServiceSchema || schema > UPGRADE_CONTRACT.readerSchema)
      blockers.push(
        'Schema ' +
          schema +
          ' is outside what the service lifecycle accepts for this reader (' +
          UPGRADE_CONTRACT.minimumServiceSchema +
          ' to ' +
          UPGRADE_CONTRACT.readerSchema +
          ').',
      );
    if (blockers.length) return report();
    const result = (seen: Comparison) => ({
      schema: seen.schema,
      forwardOnly: seen.schema > schema,
      tables: seen.tables,
      rows: seen.rows,
      rowsAfter: [...seen.counts.values()].reduce((a, b) => a + b, 0),
    });
    // Reader messages are fixed code strings, except parse errors, which can quote the file they failed on.
    const failure = (error: unknown) =>
      error instanceof SyntaxError || !(error instanceof Error)
        ? 'its configuration or data could not be parsed'
        : error.message.replace(/\s+/g, ' ').slice(0, 200);
    let first: Comparison | undefined;
    // Twice: a service restarts, so opening data the reader already opened must lose nothing and settle.
    for (const pass of ['first', 'second'] as const) {
      try {
        await reader(next, work);
      } catch (error) {
        blockers.push('The reader refused or failed on the ' + pass + ' open: ' + failure(error));
        return report(first && result(first));
      }
      const seen = compare(prior, next);
      blockers.push(...seen.blockers);
      if (seen.schema < schema)
        blockers.push('The reader lowered the schema from ' + schema + ' to ' + seen.schema + '.');
      if (seen.schema > UPGRADE_CONTRACT.readerSchema)
        blockers.push('The reader wrote schema ' + seen.schema + ', beyond its own contract.');
      if (first) {
        if (seen.schema !== first.schema) blockers.push('Opening the data again changed its schema.');
        for (const [table, rows] of seen.counts)
          if (first.counts.get(table) !== rows)
            blockers.push('Opening the data again changed the row count of ' + table + '.');
      }
      first ??= seen;
      if (blockers.length) break;
    }
    return report(result(first!));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
