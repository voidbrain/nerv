import { executeManualUpdate, type ManualUpdateDeps, type ManualUpdateResult } from './manual-update.ts';
import { command, type ServiceHost } from './node-lifecycle-execution.ts';
import {
  checkUpdateAvailability,
  parseUpdateChannel,
  type UpdateAvailability,
  type UpdateGitRunner,
} from './update-availability.ts';

/**
 * F-117-T02: `nerv update [--check]`. It works on the folder the lifecycle host manages (the install folder,
 * `~/.nerv-app`, through `serviceSource`), never on the checkout the command runs from, and updates through the same
 * path as `nodes self-update` (B-108): fetch, preview, refuse before stopping, stop, lifecycle update, restart after a
 * late refusal, result left for the inbox.
 */
export interface NervUpdateDeps {
  host: ServiceHost;
  git: UpdateGitRunner;
  plan?: ManualUpdateDeps['plan'];
  applyPlan?: ManualUpdateDeps['applyPlan'];
  readReceipt?: ManualUpdateDeps['readReceipt'];
  /** Leaves the result for the restarted service to report in the inbox (B-108-T02). */
  writeResult?: (result: ManualUpdateResult) => void;
  channel?: string;
}

export interface NervUpdateReport {
  ok: boolean;
  lines: string[];
  result?: ManualUpdateResult;
}

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : 'unknown');
const GIT_TIMEOUT_MS = 120000;

/** Git in a given folder for the update: never prompts for credentials; a timeout or spawn failure is a status 1. */
export const lifecycleGit: UpdateGitRunner = async (args, cwd) => {
  try {
    const r = await command('git', ['-C', cwd, ...args], undefined, GIT_TIMEOUT_MS, { GIT_TERMINAL_PROMPT: '0' });
    return { status: r.status ?? 1, out: r.out.trim(), err: r.err.trim() };
  } catch (error) {
    return { status: 1, out: '', err: error instanceof Error ? error.message : String(error) };
  }
};

/** The dependencies of the updater outside the service, shared by `nodes self-update` and `nerv update`. */
export function outsideUpdaterDeps(deps: Omit<NervUpdateDeps, 'writeResult' | 'channel'>): ManualUpdateDeps {
  const source = deps.host.context.source;
  return {
    resolveUpdate: (channel, refresh) =>
      checkUpdateAvailability({ source, channel, offline: !refresh, runningRevision: null, git: deps.git }),
    lifecycleHost: () => deps.host,
    stopFirst: true,
    // The lifecycle admits only a commit the install folder can read.
    fetchRevision: async (revision) => {
      const r = await deps.git(['fetch', '--no-tags', 'origin', revision], source);
      if (r.status !== 0) throw Error((r.err || r.out).trim() || 'git fetch failed');
    },
    ...(deps.plan ? { plan: deps.plan } : {}),
    ...(deps.applyPlan ? { applyPlan: deps.applyPlan } : {}),
    ...(deps.readReceipt ? { readReceipt: deps.readReceipt } : {}),
  };
}

interface UpdateStatus {
  availability: UpdateAvailability;
  /** Commits origin/main has that the install folder does not; null when they could not be counted. */
  behind: number | null;
  reason?: string;
}

/** Compare the install folder with origin/main. Downloads the missing commits to count them; moves no ref. */
async function updateStatus(deps: NervUpdateDeps): Promise<UpdateStatus> {
  const source = deps.host.context.source;
  const channel = parseUpdateChannel(deps.channel);
  const availability = await checkUpdateAvailability({ source, channel, runningRevision: null, git: deps.git });
  if (availability.status !== 'update-available') return { availability, behind: null };
  const target = availability.availableRevision!;
  const fetched = await deps.git(['fetch', '--no-tags', '--no-write-fetch-head', 'origin', target], source);
  if (fetched.status !== 0)
    return { availability, behind: null, reason: (fetched.err || fetched.out).trim() || 'git fetch failed' };
  const count = await deps.git(['rev-list', '--count', `${availability.installedRevision}..${target}`], source);
  const behind = count.status === 0 && /^\d+$/.test(count.out.trim()) ? Number(count.out.trim()) : null;
  return { availability, behind, ...(behind === null ? { reason: count.err || 'commits could not be counted' } : {}) };
}

function statusLines(source: string, s: UpdateStatus): string[] {
  const a = s.availability;
  const lines = [`Install folder: ${source}`];
  if (a.status === 'up-to-date') lines.push(`Up to date with origin/${a.channel} at ${short(a.installedRevision)}.`);
  else if (a.status === 'ahead' || s.behind === 0)
    lines.push(`${short(a.installedRevision)} already contains origin/${a.channel} (${short(a.availableRevision)}).`);
  else if (a.status === 'update-available')
    lines.push(
      s.behind === null
        ? `${short(a.installedRevision)} is behind origin/${a.channel} (${short(a.availableRevision)}); the commits could not be counted: ${s.reason}`
        : `${short(a.installedRevision)} is behind origin/${a.channel} by ${s.behind} commit${s.behind === 1 ? '' : 's'} (${short(a.availableRevision)}).`,
    );
  else lines.push(`Could not compare with origin/${a.channel}: ${a.reason ?? a.status}`);
  return lines;
}

function outcomeLines(source: string, r: ManualUpdateResult): string[] {
  if (r.outcome === 'completed')
    return [
      `Outcome: completed. NERV was stopped, updated, started and verified at ${short(r.revision)} from ${source}.`,
    ];
  return [
    `Outcome: ${r.outcome}.`,
    ...(r.reasons.length ? ['Why:', ...r.reasons.map((x) => `  - ${x}`)] : []),
    ...(r.recovery.length ? ['Next:', ...r.recovery.map((x) => `  - ${x}`)] : []),
  ];
}

/** `nerv update --check` reports and changes nothing; `nerv update` updates a behind base to origin/main. */
export async function nervUpdate(deps: NervUpdateDeps, options: { check: boolean }): Promise<NervUpdateReport> {
  const source = deps.host.context.source;
  const status = await updateStatus(deps);
  const lines = statusLines(source, status);
  const behind = status.availability.status === 'update-available' && status.behind !== 0;
  if (options.check || !behind)
    return { ok: status.availability.status === 'up-to-date' || (behind ? status.behind !== null : true), lines };
  const target = status.availability.availableRevision!;
  lines.push(
    `Updating to ${short(target)}: fetch, preview, stop, lifecycle update (backup, rehearsal, build, start, verify).`,
  );
  const result = await executeManualUpdate(outsideUpdaterDeps(deps), {
    revision: target,
    channel: status.availability.channel,
  });
  deps.writeResult?.(result);
  return { ok: result.outcome === 'completed', lines: [...lines, ...outcomeLines(source, result)], result };
}
