import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * B-099-T02: EVA jobs can run as a dedicated macOS user (docs/guides/eva-job-user.md). Every process a job starts then
 * belongs to that user, so at the end everything the user runs is killed and the table is checked: no escape trick
 * (a detached child, a double fork after setsid) outlives the job.
 */
export interface EvaJobUser {
  /** The service user, e.g. `_nervjob`: no password, no login, no home. */
  readonly name: string;
  /** A folder both the owner and the job user reach (`/Users/Shared/nerv-eva`): instances and the runtime copy. */
  readonly sharedRoot: string;
  /** Tests point these at stand-ins; a stand-in sudo never runs `kill -1` as the owner. */
  readonly sudoPath?: string;
  readonly psPath?: string;
}

const USER_NAME = /^_?[a-z][a-z0-9_]{0,31}$/;
const PLAIN_PATH = /^\/[A-Za-z0-9 ._/-]{1,200}$/;

/** config.json `eva.jobUser`: a plain user name and an absolute plain folder, or nothing. */
export function validateJobUser(raw: unknown): EvaJobUser | undefined {
  if (raw === undefined) return undefined;
  const r = raw as { name?: unknown; sharedRoot?: unknown };
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => k !== 'name' && k !== 'sharedRoot')
  )
    throw new Error('Invalid eva.jobUser: {"name": "_nervjob", "sharedRoot": "/Users/Shared/nerv-eva"}.');
  if (typeof r.name !== 'string' || !USER_NAME.test(r.name))
    throw new Error('Invalid eva.jobUser.name: a plain user name such as "_nervjob".');
  if (typeof r.sharedRoot !== 'string' || !PLAIN_PATH.test(r.sharedRoot) || r.sharedRoot.includes('..'))
    throw new Error('Invalid eva.jobUser.sharedRoot: an absolute folder such as "/Users/Shared/nerv-eva".');
  return { name: r.name, sharedRoot: r.sharedRoot };
}

/** The command line that runs a job as the job user: only `sandbox-exec` and `kill` are allowed by the sudo rule. */
export function asJobUser(
  user: EvaJobUser,
  command: string,
  args: readonly string[],
): { command: string; args: string[] } {
  return { command: user.sudoPath ?? '/usr/bin/sudo', args: ['-n', '-u', user.name, '--', command, ...args] };
}

/** The pids the job user runs now; null when the table cannot be read. */
function userProcesses(user: EvaJobUser): Promise<number[] | null> {
  return new Promise((resolve) => {
    execFile(user.psPath ?? '/bin/ps', ['-U', user.name, '-o', 'pid='], { timeout: 2000 }, (err, out) => {
      // ps exits 1 with no output when the user runs nothing.
      if (err && (err as { code?: unknown }).code !== 1) return resolve(null);
      resolve(
        String(out ?? '')
          .split('\n')
          .map((l) => Number(l.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      );
    });
  });
}

/**
 * Ends everything the job user runs: `kill -KILL -1` as that user (it can only signal its own processes), then the
 * table is checked. Survivors, or a table that cannot be read, make the job's end uncertain.
 */
export async function endJobUser(user: EvaJobUser): Promise<{ survivors: number[]; tracked: boolean }> {
  await new Promise<void>((done) =>
    execFile(
      user.sudoPath ?? '/usr/bin/sudo',
      ['-n', '-u', user.name, '--', '/bin/kill', '-KILL', '-1'],
      { timeout: 5000 },
      () => done(),
    ),
  );
  for (let i = 0; i < 10; i++) {
    const left = await userProcesses(user);
    if (left === null) return { survivors: [], tracked: false };
    if (!left.length) return { survivors: [], tracked: true };
    await new Promise((done) => setTimeout(done, 100));
  }
  return { survivors: (await userProcesses(user)) ?? [], tracked: true };
}

/**
 * A read-only copy of what the tools process needs (node, src, node_modules, package.json) in the shared folder: the job
 * user cannot open the owner's home. One copy per revision and Node version, made once (APFS clones, so cheap).
 */
export function stageRuntime(
  user: EvaJobUser,
  repoRoot: string,
): { dir: string; node: string; src: string; nodeModules: string; packageJson: string } {
  const revision = (() => {
    try {
      return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return 'unversioned';
    }
  })();
  const key = createHash('sha256')
    .update(
      [revision, process.execPath, process.version, readFileSync(join(repoRoot, 'package.json'), 'utf8')].join('\n'),
    )
    .digest('hex')
    .slice(0, 16);
  const dir = join(user.sharedRoot, 'runtime', key);
  const paths = {
    dir,
    node: join(dir, 'node'),
    src: join(dir, 'src'),
    nodeModules: join(dir, 'node_modules'),
    packageJson: join(dir, 'package.json'),
  };
  if (existsSync(join(dir, '.complete'))) return paths;
  const temp = `${dir}.${process.pid}.partial`;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  // cp -c clones on APFS (no extra space); -R for folders; -p keeps modes so node stays executable.
  for (const [from, to] of [
    [process.execPath, join(temp, 'node')],
    [join(repoRoot, 'src'), join(temp, 'src')],
    [join(repoRoot, 'node_modules'), join(temp, 'node_modules')],
    [join(repoRoot, 'package.json'), join(temp, 'package.json')],
  ] as const)
    execFileSync('/bin/cp', ['-cRp', from, to]);
  // Readable and listable by everyone, writable by no one: the job user reads it, never changes it.
  execFileSync('/bin/chmod', ['-R', 'a+rX,a-w', temp]);
  // B-157: the folder itself stays writable until it is in place: macOS 15 refuses to rename a read-only folder
  // (EACCES), so making it read-only before the rename failed every staging there.
  chmodSync(temp, 0o755);
  rmSync(dir, { recursive: true, force: true });
  renameSync(temp, dir);
  writeFileSync(join(dir, '.complete'), revision + '\n');
  chmodSync(dir, 0o555);
  return paths;
}
