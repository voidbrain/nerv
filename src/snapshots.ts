import { backup, DatabaseSync } from 'node:sqlite';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { briefDue } from './brief.ts';

/**
 * F-062-T02: nightly consistent snapshots of the base database. The owner chose one snapshot a night (up to 24 h of
 * data may be lost) in F-062-T01. SQLite's online backup copies a consistent state while the service keeps writing;
 * each copy passes an integrity check before it replaces the partial file. Off-host retention is F-062-T03.
 */
export const SNAPSHOT_AT = '03:30';
export const SNAPSHOT_KEEP = 7;
const NAME = /^nerv-(\d{4}-\d{2}-\d{2})\.sqlite$/;

export const snapshotDir = (home: string) => join(home, 'snapshots');

function syncPath(path: string, mode: 'r' | 'r+') {
  const fd = openSync(path, mode);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Snapshot dates on disk, newest first. The files are the checkpoint, so a restart neither repeats nor skips a night. */
export function snapshotDates(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => NAME.exec(f)?.[1])
    .filter((d): d is string => !!d)
    .sort()
    .reverse();
}

/** Takes one snapshot for `date`, verifies it, then keeps only the newest `keep`. Returns the file name and size. */
export async function takeSnapshot(
  database: string,
  dir: string,
  date: string,
  keep = SNAPSHOT_KEEP,
): Promise<{ file: string; bytes: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid snapshot date.');
  if (!existsSync(database)) throw Error('Database not found.');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = `nerv-${date}.sqlite`,
    partial = join(dir, file + '.partial');
  rmSync(partial, { force: true });
  try {
    const source = new DatabaseSync(database, { readOnly: true });
    try {
      await backup(source, partial);
    } finally {
      source.close();
    }
    // The copy inherits the live database's WAL mode; fold it into one self-contained file before it is verified and
    // renamed, so no committed page is left behind in a -wal file.
    const check = new DatabaseSync(partial);
    try {
      check.exec('PRAGMA journal_mode = DELETE');
      if (check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
        throw Error('Snapshot failed its integrity check.');
    } finally {
      check.close();
    }
    chmodSync(partial, 0o600);
    syncPath(partial, 'r+');
    renameSync(partial, join(dir, file));
    // Windows cannot open a directory for fsync (EPERM); NTFS commits the rename itself.
    if (process.platform !== 'win32') syncPath(dir, 'r');
  } catch (e) {
    for (const p of [partial, partial + '-wal', partial + '-shm']) rmSync(p, { force: true });
    throw e;
  }
  for (const old of snapshotDates(dir).slice(Math.max(1, keep)))
    rmSync(join(dir, `nerv-${old}.sqlite`), { force: true });
  return { file, bytes: statSync(join(dir, file)).size };
}

/** The local date a snapshot is due for, or undefined: once per local night, at or after `at`. */
export function snapshotDue(now: Date, timeZone: string, latest: string | undefined, at = SNAPSHOT_AT) {
  return briefDue(now, timeZone, at, latest);
}

/**
 * Checks every minute and takes the night's snapshot when due. One attempt per local date: a failure is logged once
 * (the reason only, never a path or database content) and retried the next night, so a broken disk cannot loop.
 */
export function startSnapshots(
  home: string,
  database: () => string,
  timeZone: () => string,
  log: (line: string) => void = (l) => console.error(l),
  everyMs = 60_000,
): () => void {
  const dir = snapshotDir(home);
  let attempted: string | undefined,
    busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const zone = timeZone(),
        date = snapshotDue(new Date(), zone, snapshotDates(dir)[0]);
      if (!date || attempted === date) return;
      attempted = date;
      try {
        await takeSnapshot(database(), dir, date);
      } catch (e) {
        log(`Nightly snapshot for ${date} failed (${reason(e)}); next attempt tomorrow.`);
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

function reason(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') return e.code;
  if (e instanceof Error && /^(Snapshot failed its integrity check|Database not found)\.$/.test(e.message))
    return e.message.slice(0, -1).toLowerCase();
  return 'unexpected error';
}
