import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  computeHeadlessResumeFingerprint,
  createHeadlessResumeDeps,
  type HeadlessResumeTarget,
} from '../src/headless-resume.ts';
import { RESUME_INTENT_SCHEMA, ResumeIntentStore, runResumeEngineTick } from '../src/resume-intent.ts';

const dirs: string[] = [];
const makeRepo = (branch: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-headless-resume-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-b', branch, dir], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.invalid'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# Fixture\n', 'utf8');
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init'], { stdio: 'pipe' });
  return dir;
};

const makeStore = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(RESUME_INTENT_SCHEMA);
  return { db, store: new ResumeIntentStore(db) };
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('F-090-T02 headless resume adapter', () => {
  it('rechecks branch and session identity and resumes once via claude CLI without a second run', async () => {
    const repoPath = makeRepo('feat/sample');
    const { db, store } = makeStore();
    try {
      const target: HeadlessResumeTarget = {
        agent: 'claude',
        sessionId: 'sess-1234',
        repoPath,
        branch: 'feat/sample',
        prompt: 'Finish tests',
      };
      const intent = store.create({
        targetKind: 'cli-job',
        targetId: target.sessionId,
        targetFingerprint: computeHeadlessResumeFingerprint(target),
        permissionScope: {
          allowedAction: 'resume-named-job',
          targetId: target.sessionId,
          allowSecurityPrompts: false,
          allowLimitBypass: false,
          modelOverrideBlocked: true,
          grantedBy: 'owner',
        },
        resetAt: 1000,
        expiresAt: 10_000,
        now: 500,
      });

      const targets = new Map([[intent.id, target]]);
      let runs = 0;
      const notifications: string[] = [];

      const deps = createHeadlessResumeDeps(targets, {
        owner: 'nerv-test',
        now: 2000,
        execFn: (bin, args, cwd) => {
          runs += 1;
          assert.equal(bin, 'claude');
          assert.deepEqual(args, ['-p', '--resume', 'sess-1234', 'Finish tests']);
          assert.equal(cwd, repoPath);
          return { stdout: 'All tests passed.', costUsd: 0.12 };
        },
        notifyOutcome: (_i, msg) => {
          notifications.push(msg);
        },
      });

      const tick1 = await runResumeEngineTick(store, deps);
      assert.equal(tick1.processed.length, 1);
      assert.equal(tick1.processed[0].status, 'resumed');
      assert.equal(runs, 1);
      assert.equal(notifications.length, 1);

      // Running a second tick must not launch a second run
      const tick2 = await runResumeEngineTick(store, deps);
      assert.equal(tick2.processed.length, 0);
      assert.equal(runs, 1);
    } finally {
      db.close();
    }
  });

  it('transitions to failed (needs-attention) without running when the branch changed', async () => {
    const repoPath = makeRepo('feat/other-branch');
    const { db, store } = makeStore();
    try {
      const target: HeadlessResumeTarget = {
        agent: 'claude',
        sessionId: 'sess-9999',
        repoPath,
        branch: 'feat/expected-branch',
      };
      const intent = store.create({
        targetKind: 'cli-job',
        targetId: target.sessionId,
        targetFingerprint: computeHeadlessResumeFingerprint(target),
        permissionScope: {
          allowedAction: 'resume-named-job',
          targetId: target.sessionId,
          allowSecurityPrompts: false,
          allowLimitBypass: false,
          modelOverrideBlocked: true,
          grantedBy: 'owner',
        },
        resetAt: 1000,
        expiresAt: 10_000,
        now: 500,
      });

      let runs = 0;
      const deps = createHeadlessResumeDeps(new Map([[intent.id, target]]), {
        owner: 'nerv-test',
        now: 2000,
        execFn: () => {
          runs += 1;
          return { stdout: '' };
        },
      });

      const tick = await runResumeEngineTick(store, deps);
      assert.equal(tick.processed.length, 1);
      assert.equal(tick.processed[0].status, 'failed');
      assert.equal(runs, 0);
    } finally {
      db.close();
    }
  });
});
