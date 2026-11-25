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

export interface CodingJobPushRequest {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  title: string;
  body?: string;
  remote?: string;
}

export type CodingJobPrOpener = (opts: {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  remote: string;
  title: string;
  body: string;
}) => string;

export interface CodingJobPushResult {
  branch: string;
  remote: string;
  prUrl: string;
}

function defaultPrOpener(opts: {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
}): string {
  return execFileSync(
    'gh',
    ['pr', 'create', '--head', opts.branch, '--base', opts.baseBranch, '--title', opts.title, '--body', opts.body],
    { cwd: opts.worktreePath, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  ).trim();
}

/**
 * Pushes a coding-job branch to the configured remote and opens a pull request, returning the PR URL (F-084-T03).
 * Must only be invoked behind an approved Orange (`write-external`) action gate.
 */
export function pushBranchAndOpenPr(
  request: CodingJobPushRequest,
  opener: CodingJobPrOpener = defaultPrOpener,
): CodingJobPushResult {
  const worktreePath = resolve(request.worktreePath);
  const remote = request.remote?.trim() || 'origin';
  const branch = request.branch.trim();
  const baseBranch = request.baseBranch.trim();
  const title = request.title.trim();
  const body = request.body?.trim() ?? '';
  if (!branch || !baseBranch || !title) {
    throw new Error('branch, baseBranch, and title are required to push and open a PR.');
  }
  execFileSync('git', ['-C', worktreePath, 'push', '-u', remote, branch], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  const prUrl = opener({ worktreePath, branch, baseBranch, remote, title, body }).trim();
  if (!prUrl) {
    throw new Error('PR opener did not return a pull request URL.');
  }
  return { branch, remote, prUrl };
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

const PINNED_TEMPLATE_TAG_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface HarnessJobRequest {
  repoId: string;
  jobId: string;
  templateRepo: string;
  templateTag: string;
  prompt?: string;
}

export interface HarnessJobContext {
  templateRepo: string;
  templateTag: string;
  applyProcedurePath: 'APPLY.md';
}

export type HarnessJobRunner = (
  worktreePath: string,
  prompt: string,
  context: HarnessJobContext,
  signal: AbortSignal,
) => Promise<CodingJobAgentOutput>;

export interface HarnessJobResult extends CodingJobResult {
  templateRepo: string;
  templateTag: string;
  applyProcedurePath: 'APPLY.md';
  prGateTool: 'coding.push_pr';
}

/** Validates that a harness job uses a pinned semantic-version release tag, never a branch or cached ref (F-091-T01). */
export function assertPinnedTemplateTag(tag: string): string {
  const trimmed = tag.trim();
  if (!PINNED_TEMPLATE_TAG_RE.test(trimmed)) {
    throw new Error(`Harness job requires a pinned release tag (e.g. v10.1.0); refused "${tag || '(empty)'}".`);
  }
  return trimmed;
}

/**
 * Runs a harness application coding job in a fresh worktree from a pinned template tag,
 * instructs the runner to follow `APPLY.md` and run project checks, and prepares the Orange PR gate (F-091-T01).
 */
export async function runHarnessJobInWorktree(
  request: HarnessJobRequest,
  allowlist: readonly AllowedCodingRepo[],
  runner: HarnessJobRunner,
  options: { signal?: AbortSignal; startRef?: string } = {},
): Promise<HarnessJobResult> {
  const templateTag = assertPinnedTemplateTag(request.templateTag);
  const templateRepo = request.templateRepo.trim();
  if (!templateRepo) {
    throw new Error('Harness job requires a templateRepo URL or path.');
  }
  const applyProcedurePath = 'APPLY.md' as const;
  const prompt =
    request.prompt?.trim() ||
    `Apply project-harness pinned release ${templateTag} from ${templateRepo} by following ${applyProcedurePath} and running the project's checks.`;
  const context: HarnessJobContext = { templateRepo, templateTag, applyProcedurePath };

  const result = await runCodingJobInWorktree(
    { repoId: request.repoId, jobId: request.jobId, prompt },
    allowlist,
    (worktreePath, jobPrompt, signal) => runner(worktreePath, jobPrompt, context, signal),
    options,
  );
  return {
    ...result,
    templateRepo,
    templateTag,
    applyProcedurePath,
    prGateTool: 'coding.push_pr',
  };
}

/** Builds the Orange-gated `coding.push_pr` action proposal for a completed harness job (F-091-T01). */
export function buildHarnessPushProposal(
  result: HarnessJobResult,
  options: { baseBranch: string; title?: string; body?: string; remote?: string },
): {
  tool: 'coding.push_pr';
  stage: 'production';
  args: {
    worktreePath: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
    diffSummary: string;
    remote?: string;
  };
} {
  return {
    tool: 'coding.push_pr',
    stage: 'production',
    args: {
      worktreePath: result.worktreePath,
      branch: result.branch,
      baseBranch: options.baseBranch,
      title: options.title?.trim() || `chore(harness): apply template ${result.templateTag}`,
      body:
        options.body?.trim() ||
        `Applied ${result.templateRepo} @ ${result.templateTag} via ${result.applyProcedurePath}.\nChecks: ${result.testResult.summary}`,
      diffSummary: result.diffSummary,
      ...(options.remote ? { remote: options.remote } : {}),
    },
  };
}
