import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type {
  ResumeAttemptOutcome,
  ResumeAvailabilityCheck,
  ResumeEngineDeps,
  ResumeIntent,
  ResumeJobIdentity,
} from './resume-intent.ts';

export interface HeadlessResumeTarget {
  agent: 'claude' | string;
  sessionId: string;
  repoPath: string;
  branch: string;
  prompt?: string;
}

export interface HeadlessResumeExecResult {
  stdout: string;
  costUsd?: number;
}

export type HeadlessExecFn = (
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
) => HeadlessResumeExecResult | Promise<HeadlessResumeExecResult>;

const execFileAsync = promisify(execFile);

export interface HeadlessResumeOptions {
  owner: string;
  now?: number;
  timeoutMs?: number;
  checkAvailability?: (intent: ResumeIntent) => Promise<ResumeAvailabilityCheck> | ResumeAvailabilityCheck;
  getBranch?: (repoPath: string) => string | null;
  sessionExists?: (target: HeadlessResumeTarget) => boolean;
  execFn?: HeadlessExecFn;
  notifyOutcome?: (intent: ResumeIntent, message: string) => Promise<void> | void;
}

const DEFAULT_PROMPT = 'Continue the interrupted task from the last checkpoint.';
const DEFAULT_TIMEOUT_MS = 300_000;

export function computeHeadlessResumeFingerprint(target: HeadlessResumeTarget): string {
  return `${target.agent}:${target.repoPath}:${target.branch}:${target.sessionId}`;
}

function defaultGetBranch(repoPath: string): string | null {
  if (!existsSync(repoPath)) return null;
  try {
    return (
      execFileSync('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim() || null
    );
  } catch {
    return null;
  }
}

// Asynchronous, so a long resume never blocks the process that runs it (the scheduler during `serve`, F-090-T04).
async function defaultExecHeadless(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<HeadlessResumeExecResult> {
  const { stdout } = await execFileAsync(bin, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 << 20 });
  return { stdout };
}

/**
 * Rechecks worktree existence, git branch, and session availability before headless resume (F-090-T02).
 * Returning null causes `runResumeEngineTick` to fail closed (needs-attention) without spawning.
 */
export function verifyHeadlessResumeIdentity(
  target: HeadlessResumeTarget,
  options: Pick<HeadlessResumeOptions, 'getBranch' | 'sessionExists'> = {},
): ResumeJobIdentity | null {
  if (!existsSync(target.repoPath)) return null;
  const currentBranch = (options.getBranch ?? defaultGetBranch)(target.repoPath);
  if (!currentBranch || currentBranch !== target.branch) return null;
  if (options.sessionExists && !options.sessionExists(target)) return null;
  return {
    targetId: target.sessionId,
    targetFingerprint: computeHeadlessResumeFingerprint(target),
    stillActive: true,
  };
}

/**
 * Executes a supported headless coding-agent CLI resume once inside the recorded worktree (F-090-T02).
 */
export async function executeHeadlessResume(
  target: HeadlessResumeTarget,
  options: Pick<HeadlessResumeOptions, 'execFn' | 'timeoutMs'> = {},
): Promise<ResumeAttemptOutcome> {
  if (target.agent !== 'claude') {
    return {
      kind: 'failed',
      reason: `Unsupported headless resume agent "${target.agent}" (requires verified CLI capability check).`,
      retryable: false,
    };
  }
  const args = ['-p', '--resume', target.sessionId, target.prompt?.trim() || DEFAULT_PROMPT];
  const execFn = options.execFn ?? defaultExecHeadless;
  try {
    const result = await execFn('claude', args, target.repoPath, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return {
      kind: 'resumed',
      detail: {
        agent: target.agent,
        sessionId: target.sessionId,
        repoPath: target.repoPath,
        branch: target.branch,
        output: result.stdout.trim(),
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      },
    };
  } catch (err) {
    return {
      kind: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      retryable: false,
    };
  }
}

/**
 * Builds `ResumeEngineDeps` for `runResumeEngineTick` backed by headless coding-agent targets (F-090-T02).
 */
export function createHeadlessResumeDeps(
  targets: ReadonlyMap<string, HeadlessResumeTarget>,
  options: HeadlessResumeOptions,
): ResumeEngineDeps {
  return {
    owner: options.owner,
    now: options.now,
    accepts: (intent) => targets.has(intent.id),
    checkAvailability: options.checkAvailability ?? (() => ({ available: true })),
    verifyIdentity: (intent) => {
      const target = targets.get(intent.id);
      if (!target) return null;
      return verifyHeadlessResumeIdentity(target, options);
    },
    executeResume: (intent) => {
      const target = targets.get(intent.id);
      if (!target) {
        return { kind: 'failed', reason: `Missing headless resume target for intent ${intent.id}`, retryable: false };
      }
      return executeHeadlessResume(target, options);
    },
    notifyOutcome: options.notifyOutcome,
  };
}
