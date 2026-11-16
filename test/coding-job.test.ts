import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { runCodingJobInWorktree, type AllowedCodingRepo } from '../src/coding-job.ts';

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
