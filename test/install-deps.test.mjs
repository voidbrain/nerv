import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const TOOL_PATH = resolve('tools/install-deps.mjs');

describe('B-098: dependency install guard for symlinked node_modules', () => {
  it('refuses installDependencies when node_modules is a symbolic link and leaves target intact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-b098-'));
    const target = join(root, 'primary-node_modules');
    const worktree = join(root, 'worktree');
    mkdirSync(join(target, 'keep-pkg'), { recursive: true });
    writeFileSync(join(target, 'keep-pkg', 'index.js'), 'export default 1;\n');
    mkdirSync(worktree, { recursive: true });
    symlinkSync(target, join(worktree, 'node_modules'), 'dir');

    try {
      const { installDependencies } = await import('../tools/install-deps.mjs');
      let called = false;
      assert.throws(
        () =>
          installDependencies({
            cwd: worktree,
            runner: () => {
              called = true;
              return { status: 0 };
            },
          }),
        (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          return /node_modules/i.test(msg) && /symbolic link/i.test(msg);
        },
      );
      assert.equal(called, false);
      assert.equal(existsSync(join(target, 'keep-pkg', 'index.js')), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('forwards npm ci arguments to runner when node_modules is absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-b098-ok-'));
    try {
      const { installDependencies } = await import('../tools/install-deps.mjs');
      const calls = [];
      installDependencies({
        cwd: root,
        args: ['--ignore-scripts'],
        runner: (program, args, options) => {
          calls.push({ program, args, cwd: options.cwd });
          return { status: 0 };
        },
      });
      assert.deepEqual(calls, [{ program: 'npm', args: ['ci', '--ignore-scripts'], cwd: root }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses via CLI when node_modules is a symbolic link, naming the link', () => {
    const root = mkdtempSync(join(tmpdir(), 'nerv-b098-cli-'));
    const target = join(root, 'primary-node_modules');
    const worktree = join(root, 'worktree');
    mkdirSync(join(target, 'keep-pkg'), { recursive: true });
    writeFileSync(join(target, 'keep-pkg', 'index.js'), 'export default 1;\n');
    mkdirSync(worktree, { recursive: true });
    symlinkSync(target, join(worktree, 'node_modules'), 'dir');

    try {
      let exitCode = 0;
      let stderr = '';
      try {
        execFileSync(process.execPath, [TOOL_PATH], { cwd: worktree, encoding: 'utf8', stdio: 'pipe' });
      } catch (err) {
        exitCode = err?.status ?? 1;
        stderr = err?.stderr ?? '';
      }
      assert.notEqual(exitCode, 0);
      assert.match(stderr, /node_modules/i);
      assert.match(stderr, /symbolic link/i);
      assert.equal(existsSync(join(target, 'keep-pkg', 'index.js')), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
