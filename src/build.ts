/**
 * What this NERV Agency is running (owner, 2026-11-06): an incrementing history-based version and the git commit of its checkout, read
 * once when the service starts, so the dashboard shows the code actually running, not what is on disk now.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export interface BuildInfo {
  version: string;
  commit: string | null;
  shortCommit: string | null;
}
export interface RevisionSkew {
  skewed: boolean;
  runningCommit: string | null;
  runningShortCommit: string | null;
  checkoutCommit: string | null;
  checkoutShortCommit: string | null;
  message?: string;
}
function readGitHead(root: string): { commit: string | null; shortCommit: string | null } {
  const run = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 3000 });
  const git = run(['rev-parse', 'HEAD']);
  const sha = typeof git.stdout === 'string' ? git.stdout.trim() : '';
  const commit = git.status === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  let shortCommit: string | null = null;
  if (commit) {
    const abbreviated = run(['rev-parse', '--short', commit]);
    const short = typeof abbreviated.stdout === 'string' ? abbreviated.stdout.trim() : '';
    if (abbreviated.status === 0 && /^[0-9a-f]{4,40}$/.test(short) && commit.startsWith(short)) shortCommit = short;
  }
  return { commit, shortCommit };
}
/** Reports whether a running service's revision differs from the checkout HEAD on disk (B-105-T01). */
export function checkRevisionSkew(
  running: Pick<BuildInfo, 'commit' | 'shortCommit'>,
  root = fileURLToPath(new URL('..', import.meta.url)),
): RevisionSkew {
  const checkout = readGitHead(root);
  const skewed = Boolean(running.commit && checkout.commit && running.commit !== checkout.commit);
  return {
    skewed,
    runningCommit: running.commit,
    runningShortCommit: running.shortCommit,
    checkoutCommit: checkout.commit,
    checkoutShortCommit: checkout.shortCommit,
    ...(skewed
      ? {
          message: `Running service (${running.shortCommit ?? running.commit}) differs from checkout HEAD (${checkout.shortCommit ?? checkout.commit}); update or restart through the lifecycle flow.`,
        }
      : {}),
  };
}
let cached: BuildInfo | undefined;
/** v1.N counts first-parent commits (one per main merge); package version is the fallback without full git history. */
export function buildInfo(root = fileURLToPath(new URL('..', import.meta.url))): BuildInfo {
  if (cached) return cached;
  let version = 'unknown';
  try {
    const v = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }).version;
    if (typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v)) version = v;
  } catch {
    /* not found: unknown */
  }
  const run = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 3000 });
  const { commit, shortCommit } = readGitHead(root);
  if (commit) {
    const shallow = run(['rev-parse', '--is-shallow-repository']);
    if (shallow.status === 0 && shallow.stdout.trim() === 'false') {
      const count = run(['rev-list', '--first-parent', '--count', commit]);
      if (count.status === 0 && /^[1-9]\d*$/.test(count.stdout.trim())) version = `1.${count.stdout.trim()}`;
    }
  }
  cached = { version, commit, shortCommit };
  return cached;
}
