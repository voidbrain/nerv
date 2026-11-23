import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { readScrolls } from '../src/config.ts';
import type { HeadlessExecFn } from '../src/headless-resume.ts';
import { NEEDS_ATTENTION, runSessionLimitTick } from '../src/session-limit-resume.ts';
import { Store } from '../src/store.ts';

const dirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const makeRepo = (branch: string) => {
  const dir = tempDir('nerv-limit-repo-');
  execFileSync('git', ['init', '-b', branch, dir], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.invalid'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# Fixture\n', 'utf8');
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init'], { stdio: 'pipe' });
  return dir;
};
const open = (home: string) => new Store(join(home, 'nerv.db'), readScrolls(home), { home });
const notices = (store: Store) =>
  (store.inbox() as { message: string }[]).map((d) => d.message).filter((m) => m.includes('coding session'));
const tick = (store: Store, now: number, execFn: HeadlessExecFn) =>
  runSessionLimitTick(store.sessionLimits, store.resumeIntents, {
    owner: 'test',
    now,
    execFn,
    notify: (message) => store.addBrief(message).id,
  });

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const RESET = Date.parse('2026-01-10T15:00:00Z');

describe('F-090-T04 resume a coding session once after its limit resets', () => {
  it('survives a restart, waits for the reset, runs once with the identity recheck and tells the owner once', async () => {
    const home = tempDir('nerv-limit-home-');
    const repoPath = makeRepo('feat/sample');
    const first = open(home);
    const recorded = first.sessionLimits.record(
      { sessionId: 'sess-0001', repoPath, branch: 'feat/sample', resetAt: RESET, prompt: 'Finish the tests' },
      RESET - 3_600_000,
    );
    assert.equal(recorded.intent.maxAttempts, 1);
    first.close();

    const runs: { bin: string; args: string[]; cwd: string }[] = [];
    const exec: HeadlessExecFn = async (bin, args, cwd) => {
      runs.push({ bin, args, cwd });
      return { stdout: 'Tests pass now.' };
    };

    // Restart: a new process opens the same file. Before the reset nothing runs.
    const second = open(home);
    try {
      await tick(second, RESET - 1, exec);
      assert.equal(runs.length, 0);
      await tick(second, RESET + 1000, exec);
      assert.equal(runs.length, 1);
      assert.deepEqual(runs[0], {
        bin: 'claude',
        args: ['-p', '--resume', 'sess-0001', 'Finish the tests'],
        cwd: repoPath,
      });
      assert.equal(second.resumeIntents.get(recorded.intent.id)!.status, 'resumed');
      assert.equal(notices(second).filter((m) => m.startsWith('Resumed coding session sess-0001')).length, 1);
      assert.match(notices(second)[0]!, /Tests pass now\./);
    } finally {
      second.close();
    }

    // Another restart and later ticks: no second run, no second notice.
    const third = open(home);
    try {
      await tick(third, RESET + 120_000, exec);
      await tick(third, RESET + 240_000, exec);
      assert.equal(runs.length, 1);
      assert.equal(notices(third).length, 1);
      assert.equal(third.lastBrief(), null, 'a resume notice is not mistaken for the daily brief');
    } finally {
      third.close();
    }
  });

  it('recording the same waiting session twice keeps one resume', () => {
    const home = tempDir('nerv-limit-home-');
    const repoPath = makeRepo('main');
    const store = open(home);
    try {
      const a = store.sessionLimits.record({ sessionId: 'sess-0002', repoPath, branch: 'main', resetAt: RESET });
      const b = store.sessionLimits.record({ sessionId: 'sess-0002', repoPath, branch: 'main', resetAt: RESET });
      assert.equal(b.existing, true);
      assert.equal(b.intent.id, a.intent.id);
      assert.equal(store.sessionLimits.list().length, 1);
      assert.throws(() => store.sessionLimits.record({ sessionId: 'x', repoPath, branch: 'main', resetAt: RESET }));
      assert.throws(() =>
        store.sessionLimits.record({ sessionId: 'sess-0003', repoPath: 'relative', branch: 'main', resetAt: RESET }),
      );
      assert.throws(() =>
        store.sessionLimits.record({
          agent: 'other',
          sessionId: 'sess-0003',
          repoPath,
          branch: 'main',
          resetAt: RESET,
        }),
      );
    } finally {
      store.close();
    }
  });

  it('a changed branch or a missing worktree is needs-attention and never runs', async () => {
    const home = tempDir('nerv-limit-home-');
    const repoPath = makeRepo('feat/moved');
    const store = open(home);
    try {
      store.sessionLimits.record({ sessionId: 'sess-0004', repoPath, branch: 'feat/original', resetAt: RESET });
      store.sessionLimits.record({
        sessionId: 'sess-0005',
        repoPath: join(home, 'gone'),
        branch: 'main',
        resetAt: RESET,
      });
      let runs = 0;
      const exec: HeadlessExecFn = () => {
        runs += 1;
        return { stdout: '' };
      };
      await tick(store, RESET + 1, exec);
      await tick(store, RESET + 60_000, exec);
      assert.equal(runs, 0);
      assert.deepEqual(
        store.sessionLimits.list().map((r) => r.intent.status),
        ['failed', 'failed'],
      );
      const told = notices(store);
      assert.equal(told.length, 2);
      for (const m of told) assert.ok(m.startsWith(`${NEEDS_ATTENTION}:`), m);
    } finally {
      store.close();
    }
  });

  it('a resume a restart cut off is needs-attention, never a second run', async () => {
    const home = tempDir('nerv-limit-home-');
    const repoPath = makeRepo('main');
    const first = open(home);
    const { intent } = first.sessionLimits.record({ sessionId: 'sess-0006', repoPath, branch: 'main', resetAt: RESET });
    // The previous service took the lease and stopped before it recorded an outcome.
    assert.ok(first.resumeIntents.claimLease(intent.id, 'serve:old', 60_000, RESET + 1));
    first.close();
    const second = open(home);
    try {
      let runs = 0;
      await tick(second, RESET + 120_000, () => {
        runs += 1;
        return { stdout: '' };
      });
      assert.equal(runs, 0);
      assert.equal(second.resumeIntents.get(intent.id)!.status, 'failed');
      assert.match(notices(second)[0]!, /Needs attention: .*may or may not have finished/);
    } finally {
      second.close();
    }
  });

  it('a session still at its limit is told, not retried', async () => {
    const home = tempDir('nerv-limit-home-');
    const repoPath = makeRepo('main');
    const store = open(home);
    try {
      store.sessionLimits.record({ sessionId: 'sess-0007', repoPath, branch: 'main', resetAt: RESET });
      let runs = 0;
      const exec: HeadlessExecFn = () => {
        runs += 1;
        throw new Error('usage limit reached');
      };
      await tick(store, RESET + 1, exec);
      await tick(store, RESET + 3_600_000, exec);
      assert.equal(runs, 1);
      assert.match(notices(store)[0]!, /Needs attention: .*usage limit reached/);
    } finally {
      store.close();
    }
  });

  it(
    'serve: the scheduler process resumes or flags a recorded session without being asked',
    { timeout: 30000 },
    async () => {
      const { Runtime } = await import('../src/runtime.ts');
      const home = tempDir('nerv-limit-serve-');
      const db = join(home, 'nerv.sqlite');
      const direct = new Store(db, readScrolls(home), { home });
      try {
        // Recorded as the CLI does; the worktree is gone, so the recheck stops it before anything runs.
        direct.sessionLimits.record({
          sessionId: 'sess-0008',
          repoPath: join(home, 'gone'),
          branch: 'main',
          resetAt: Date.now() - 1000,
        });
      } finally {
        direct.close();
      }
      const runtime = new Runtime(db, undefined, home);
      try {
        await runtime.ready();
        let told: string[] = [];
        for (let i = 0; i < 100 && !told.length; i++) {
          told = ((await runtime.inbox()) as { message: string }[])
            .map((d) => d.message)
            .filter((m) => m.includes('sess-0008'));
          if (!told.length) await new Promise((r) => setTimeout(r, 100));
        }
        assert.equal(told.length, 1);
        assert.ok(told[0]!.startsWith(`${NEEDS_ATTENTION}:`), told[0]);
      } finally {
        await runtime.close();
      }
    },
  );
});
