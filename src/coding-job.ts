import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface AllowedCodingRepo {
  id: string;
  localPath: string;
  defaultBranch: string;
}

export interface CodingJobRequest {
  repoId: string;
  jobId: string;
  prompt: string;
}

export interface CodingJobAgentOutput {
  testPassed: boolean;
  testSummary: string;
  tokens: number;
  costUsd: number;
}

export type CodingJobAgentRunner = (
  worktreePath: string,
  prompt: string,
  signal: AbortSignal,
) => Promise<CodingJobAgentOutput>;

export interface CodingJobResult {
  status: 'completed' | 'cancelled' | 'failed';
  repoId: string;
  worktreePath: string;
  branch: string;
  diffSummary: string;
  testResult: {
    passed: boolean;
    summary: string;
  };
  spend: {
    tokens: number;
    costUsd: number;
  };
}

function summarizeWorktreeDiff(worktreePath: string): string {
  const diffStat = execFileSync('git', ['-C', worktreePath, 'diff', '--stat'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  }).trim();
  const untracked = execFileSync('git', ['-C', worktreePath, 'status', '--short'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  }).trim();
  return [diffStat, untracked].filter(Boolean).join('\n') || '(no changes)';
}

/**
 * Runs a coding-agent change inside a fresh git worktree branched from the repository's default branch,
 * keeping the primary checkout untouched, reporting diff/test/spend, and leaving the worktree for inspection
 * if cancelled (F-084-T02).
 */
export async function runCodingJobInWorktree(
  request: CodingJobRequest,
  allowlist: readonly AllowedCodingRepo[],
  runner: CodingJobAgentRunner,
  options: { signal?: AbortSignal; startRef?: string } = {},
): Promise<CodingJobResult> {
  const repo = allowlist.find((r) => r.id === request.repoId);
  if (!repo) {
    throw new Error(`Repository "${request.repoId}" is not in the owner-approved coding allowlist.`);
  }
  const safeJobId = request.jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeJobId) {
    throw new Error('Coding jobId must contain alphanumeric characters.');
  }

  const repoPath = resolve(repo.localPath);
  const worktreesDir = join(dirname(repoPath), `${repoPath.split(/[\\/]/).pop()}.worktrees`);
  mkdirSync(worktreesDir, { recursive: true });
  const worktreePath = join(worktreesDir, `job-${safeJobId}`);
  const branch = `coding/${safeJobId}`;
  const startRef = options.startRef ?? repo.defaultBranch;

  if (!existsSync(worktreePath)) {
    execFileSync('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, worktreePath, startRef], {
      stdio: 'pipe',
    });
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const out = await runner(worktreePath, request.prompt, controller.signal);
    if (controller.signal.aborted) {
      return {
        status: 'cancelled',
        repoId: repo.id,
        worktreePath,
        branch,
        diffSummary: summarizeWorktreeDiff(worktreePath),
        testResult: { passed: false, summary: 'Cancelled before completion' },
        spend: { tokens: out.tokens, costUsd: out.costUsd },
      };
    }
    return {
      status: 'completed',
      repoId: repo.id,
      worktreePath,
      branch,
      diffSummary: summarizeWorktreeDiff(worktreePath),
      testResult: { passed: out.testPassed, summary: out.testSummary },
      spend: { tokens: out.tokens, costUsd: out.costUsd },
    };
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        status: 'cancelled',
        repoId: repo.id,
        worktreePath,
        branch,
        diffSummary: summarizeWorktreeDiff(worktreePath),
        testResult: { passed: false, summary: 'Cancelled; worktree preserved for inspection' },
        spend: { tokens: 0, costUsd: 0 },
      };
    }
    return {
      status: 'failed',
      repoId: repo.id,
      worktreePath,
      branch,
      diffSummary: summarizeWorktreeDiff(worktreePath),
      testResult: { passed: false, summary: err instanceof Error ? err.message : String(err) },
      spend: { tokens: 0, costUsd: 0 },
    };
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
