import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  buildHarnessPushProposal,
  runCodingJobInWorktree,
  runHarnessJobInWorktree,
  type AllowedCodingRepo,
} from '../src/coding-job.ts';
import { Store } from '../src/store.ts';

const dirs: string[] = [];
const makeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'nerv-coding-job-'));
  dirs.push(root);
  const repoPath = join(root, 'sample-repo');
  execFileSync('git', ['init', '-b', 'main', repoPath], { stdio: 'pipe' });
  execFileSync('git', ['-C', repoPath, 'config', 'user.email', 'test@example.invalid'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'Test'], { stdio: 'pipe' });
  writeFileSync(join(repoPath, 'index.ts'), 'export const value = 1;\n', 'utf8');
  execFileSync('git', ['-C', repoPath, 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repoPath, 'commit', '-m', 'init'], { stdio: 'pipe' });
  return repoPath;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('F-084-T02 run coding change in a fresh worktree', () => {
  it('runs in a fresh worktree leaving primary checkout untouched and reports diff, tests, and spend', async () => {
    const repoPath = makeRepo();
    const allowlist: AllowedCodingRepo[] = [{ id: 'sample', localPath: repoPath, defaultBranch: 'main' }];

    const result = await runCodingJobInWorktree(
      { repoId: 'sample', jobId: 'j1', prompt: 'Bump value to 2' },
      allowlist,
      async (worktreePath) => {
        writeFileSync(join(worktreePath, 'index.ts'), 'export const value = 2;\n', 'utf8');
        return { testPassed: true, testSummary: '1/1 passed', tokens: 1200, costUsd: 0.04 };
      },
    );

    assert.equal(result.status, 'completed');
    assert.notEqual(result.worktreePath, repoPath);
    assert.equal(existsSync(result.worktreePath), true);
    assert.equal(readFileSync(join(repoPath, 'index.ts'), 'utf8'), 'export const value = 1;\n');
    assert.equal(readFileSync(join(result.worktreePath, 'index.ts'), 'utf8'), 'export const value = 2;\n');
    assert.match(result.diffSummary, /index\.ts/);
    assert.equal(result.testResult.passed, true);
    assert.equal(result.spend.tokens, 1200);
    assert.equal(result.spend.costUsd, 0.04);
  });

  it('cancels the agent and preserves the worktree for inspection', async () => {
    const repoPath = makeRepo();
    const allowlist: AllowedCodingRepo[] = [{ id: 'sample', localPath: repoPath, defaultBranch: 'main' }];
    const abort = new AbortController();

    const result = await runCodingJobInWorktree(
      { repoId: 'sample', jobId: 'j2', prompt: 'Long task' },
      allowlist,
      async (worktreePath, _prompt, signal) => {
        writeFileSync(join(worktreePath, 'wip.txt'), 'partial', 'utf8');
        abort.abort();
        assert.equal(signal.aborted, true);
        return { testPassed: false, testSummary: 'interrupted', tokens: 300, costUsd: 0.01 };
      },
      { signal: abort.signal },
    );

    assert.equal(result.status, 'cancelled');
    assert.equal(existsSync(result.worktreePath), true);
    assert.equal(existsSync(join(result.worktreePath, 'wip.txt')), true);
  });

  it('rejects repositories outside the allowlist', async () => {
    await assert.rejects(
      () =>
        runCodingJobInWorktree({ repoId: 'unknown', jobId: 'j3', prompt: 'x' }, [], async () => ({
          testPassed: true,
          testSummary: 'ok',
          tokens: 0,
          costUsd: 0,
        })),
      /not in the owner-approved coding allowlist/,
    );
  });
});

const makeRepoWithBareRemote = () => {
  const root = mkdtempSync(join(tmpdir(), 'nerv-coding-push-'));
  dirs.push(root);
  const remotePath = join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remotePath], { stdio: 'pipe' });
  const repoPath = join(root, 'sample-repo');
  execFileSync('git', ['init', '-b', 'main', repoPath], { stdio: 'pipe' });
  execFileSync('git', ['-C', repoPath, 'config', 'user.email', 'test@example.invalid'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'Test'], { stdio: 'pipe' });
  writeFileSync(join(repoPath, 'index.ts'), 'export const value = 1;\n', 'utf8');
  execFileSync('git', ['-C', repoPath, 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repoPath, 'commit', '-m', 'init'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repoPath, 'remote', 'add', 'origin', remotePath], { stdio: 'pipe' });
  execFileSync('git', ['-C', repoPath, 'push', '-u', 'origin', 'main'], { stdio: 'pipe' });
  return { root, repoPath, remotePath };
};

describe('F-084-T03 push and open the PR behind approval', () => {
  it('shows an Orange approval card with diff summary and never pushes on expiry or rejection', async () => {
    const { root, repoPath, remotePath } = makeRepoWithBareRemote();
    const allowlist: AllowedCodingRepo[] = [{ id: 'sample', localPath: repoPath, defaultBranch: 'main' }];
    const job = await runCodingJobInWorktree(
      { repoId: 'sample', jobId: 'j4', prompt: 'Bump value to 2' },
      allowlist,
      async (worktreePath) => {
        writeFileSync(join(worktreePath, 'index.ts'), 'export const value = 2;\n', 'utf8');
        execFileSync('git', ['-C', worktreePath, 'add', '.'], { stdio: 'pipe' });
        execFileSync('git', ['-C', worktreePath, 'commit', '-m', 'bump value'], { stdio: 'pipe' });
        return { testPassed: true, testSummary: '1/1 passed', tokens: 100, costUsd: 0.01 };
      },
    );

    const store = new Store(join(root, 'nerv.db'));
    let openerCalled = 0;
    store.codingPrOpener = () => {
      openerCalled += 1;
      return 'https://example.invalid/org/repo/pull/42';
    };

    const expiredSortie = store.ledger.openSortie('owner', 'Push coding job j4 (expired)', 'trusted');
    const expiredProposal = store.runAction(
      expiredSortie,
      {
        tool: 'coding.push_pr',
        stage: 'production',
        args: {
          worktreePath: job.worktreePath,
          branch: job.branch,
          baseBranch: 'main',
          title: 'Bump value to 2',
          diffSummary: job.diffSummary,
        },
      },
      undefined,
    );
    assert.equal(expiredProposal.outcome, 'approval');
    assert.equal(expiredProposal.pattern, 'orange');
    assert.ok(expiredProposal.approvalId);
    // Force expiry on the approval row to verify expired approvals never push.
    store.db
      .prepare('UPDATE approvals SET expires=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), expiredProposal.approvalId);
    const expiredDecided = store.decide(expiredProposal.approvalId!, 'approve', 'owner');
    assert.equal(expiredDecided.decision, 'expired');
    assert.equal(expiredDecided.result, undefined);
    assert.equal(openerCalled, 0);
    assert.equal(
      execFileSync('git', ['ls-remote', '--heads', remotePath, job.branch], { encoding: 'utf8' }).trim(),
      '',
    );

    const rejectedSortie = store.ledger.openSortie('owner', 'Push coding job j4 (rejected)', 'trusted');
    const rejectedProposal = store.runAction(rejectedSortie, {
      tool: 'coding.push_pr',
      stage: 'production',
      args: {
        worktreePath: job.worktreePath,
        branch: job.branch,
        baseBranch: 'main',
        title: 'Bump value to 2',
        diffSummary: job.diffSummary,
      },
    });
    assert.equal(rejectedProposal.outcome, 'approval');
    assert.equal(rejectedProposal.pattern, 'orange');
    const [pendingCard] = store.ledger.pendingApprovals();
    assert.equal(pendingCard?.card.pattern, 'orange');
    assert.equal(pendingCard?.card.args.diffSummary, job.diffSummary);

    const rejected = store.decide(rejectedProposal.approvalId!, 'reject', 'owner');
    assert.equal(rejected.decision, 'reject');
    assert.equal(openerCalled, 0);
    assert.equal(
      execFileSync('git', ['ls-remote', '--heads', remotePath, job.branch], { encoding: 'utf8' }).trim(),
      '',
    );
    store.close();
  });

  it('pushes the branch, opens the PR, and returns the PR link only after approval', async () => {
    const { root, repoPath, remotePath } = makeRepoWithBareRemote();
    const allowlist: AllowedCodingRepo[] = [{ id: 'sample', localPath: repoPath, defaultBranch: 'main' }];
    const job = await runCodingJobInWorktree(
      { repoId: 'sample', jobId: 'j5', prompt: 'Bump value to 3' },
      allowlist,
      async (worktreePath) => {
        writeFileSync(join(worktreePath, 'index.ts'), 'export const value = 3;\n', 'utf8');
        execFileSync('git', ['-C', worktreePath, 'add', '.'], { stdio: 'pipe' });
        execFileSync('git', ['-C', worktreePath, 'commit', '-m', 'bump value to 3'], { stdio: 'pipe' });
        return { testPassed: true, testSummary: '1/1 passed', tokens: 120, costUsd: 0.02 };
      },
    );

    const store = new Store(join(root, 'nerv.db'));
    store.codingPrOpener = ({ branch, baseBranch, title }) => {
      assert.equal(branch, job.branch);
      assert.equal(baseBranch, 'main');
      assert.equal(title, 'Bump value to 3');
      return 'https://example.invalid/org/repo/pull/99';
    };

    const sortie = store.ledger.openSortie('owner', 'Push coding job j5', 'trusted');
    const proposal = store.runAction(sortie, {
      tool: 'coding.push_pr',
      stage: 'production',
      args: {
        worktreePath: job.worktreePath,
        branch: job.branch,
        baseBranch: 'main',
        title: 'Bump value to 3',
        body: 'Automated coding job result.',
        diffSummary: job.diffSummary,
      },
    });
    assert.equal(proposal.outcome, 'approval');
    assert.equal(proposal.pattern, 'orange');
    assert.equal(
      execFileSync('git', ['ls-remote', '--heads', remotePath, job.branch], { encoding: 'utf8' }).trim(),
      '',
    );

    const decided = store.decide(proposal.approvalId!, 'approve', 'owner');
    assert.equal(decided.decision, 'approve');
    assert.deepEqual(decided.result, {
      branch: job.branch,
      remote: 'origin',
      prUrl: 'https://example.invalid/org/repo/pull/99',
    });
    assert.match(
      execFileSync('git', ['ls-remote', '--heads', remotePath, job.branch], { encoding: 'utf8' }),
      new RegExp(`refs/heads/${job.branch}`),
    );
    store.close();
  });
});

describe('F-091-T01 harness job template', () => {
  it('refuses untagged or branch template references before creating a worktree', async () => {
    const repoPath = makeRepo();
    const allowlist: AllowedCodingRepo[] = [{ id: 'sample', localPath: repoPath, defaultBranch: 'main' }];
    for (const badTag of ['', 'main', 'HEAD', 'latest']) {
      await assert.rejects(
        () =>
          runHarnessJobInWorktree(
            { repoId: 'sample', jobId: 'h0', templateRepo: 'https://example.invalid/harness', templateTag: badTag },
            allowlist,
            async () => ({ testPassed: true, testSummary: 'ok', tokens: 0, costUsd: 0 }),
          ),
        /pinned release tag/,
      );
    }
  });

  it('applies a pinned template tag following APPLY.md, runs checks, and opens a PR behind Orange approval', async () => {
    const { root, repoPath, remotePath } = makeRepoWithBareRemote();
    const allowlist: AllowedCodingRepo[] = [{ id: 'sample', localPath: repoPath, defaultBranch: 'main' }];

    const job = await runHarnessJobInWorktree(
      {
        repoId: 'sample',
        jobId: 'h1',
        templateRepo: 'https://example.invalid/project-harness',
        templateTag: 'v10.1.0',
      },
      allowlist,
      async (worktreePath, prompt, context) => {
        assert.equal(context.templateTag, 'v10.1.0');
        assert.equal(context.applyProcedurePath, 'APPLY.md');
        assert.match(prompt, /v10\.1\.0/);
        assert.match(prompt, /APPLY\.md/);
        writeFileSync(join(worktreePath, '.harness.json'), '{"version":"10.1.0"}\n', 'utf8');
        execFileSync('git', ['-C', worktreePath, 'add', '.'], { stdio: 'pipe' });
        execFileSync('git', ['-C', worktreePath, 'commit', '-m', 'apply harness v10.1.0'], { stdio: 'pipe' });
        return { testPassed: true, testSummary: 'check:fast passed', tokens: 500, costUsd: 0.02 };
      },
    );

    assert.equal(job.status, 'completed');
    assert.equal(job.templateTag, 'v10.1.0');
    assert.equal(job.applyProcedurePath, 'APPLY.md');
    assert.equal(job.testResult.passed, true);

    const store = new Store(join(root, 'nerv.db'));
    store.codingPrOpener = ({ branch, title }) => {
      assert.equal(branch, job.branch);
      assert.match(title, /v10\.1\.0/);
      return 'https://example.invalid/org/repo/pull/101';
    };

    const sortie = store.ledger.openSortie('owner', 'Apply harness v10.1.0', 'trusted');
    const proposal = store.runAction(sortie, buildHarnessPushProposal(job, { baseBranch: 'main' }));
    assert.equal(proposal.outcome, 'approval');
    assert.equal(proposal.pattern, 'orange');
    assert.equal(
      execFileSync('git', ['ls-remote', '--heads', remotePath, job.branch], { encoding: 'utf8' }).trim(),
      '',
    );

    const decided = store.decide(proposal.approvalId!, 'approve', 'owner');
    assert.equal(decided.decision, 'approve');
    assert.deepEqual(decided.result, {
      branch: job.branch,
      remote: 'origin',
      prUrl: 'https://example.invalid/org/repo/pull/101',
    });
    store.close();
  });
});
