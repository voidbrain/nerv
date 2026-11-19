#!/usr/bin/env node
// Guarded dependency install: refuses `npm ci` when `node_modules` is a symbolic link
// so a worktree install cannot empty the primary checkout's dependencies (B-098).
import { spawnSync } from 'node:child_process';
import { lstatSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Refuses dependency installation if `<cwd>/node_modules` is a symbolic link,
 * then runs `npm ci` with any forwarded arguments.
 */
export function installDependencies({ cwd = process.cwd(), args = [], runner } = {}) {
  const modulesPath = join(cwd, 'node_modules');
  let stat = null;
  try {
    stat = lstatSync(modulesPath);
  } catch (err) {
    if (!err || typeof err !== 'object' || !('code' in err) || err.code !== 'ENOENT') {
      throw err;
    }
  }
  if (stat && stat.isSymbolicLink()) {
    const target = readlinkSync(modulesPath);
    throw new Error(
      `Refusing dependency install: ${modulesPath} is a symbolic link -> ${target}. Remove the link first (rm node_modules, not its contents) before running npm ci.`,
    );
  }

  const run =
    runner ??
    ((program, cmdArgs, options) =>
      spawnSync(program, cmdArgs, {
        ...options,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      }));

  const result = run('npm', ['ci', ...args], { cwd });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`npm ci failed with exit code ${result.status}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    installDependencies({ cwd: process.cwd(), args: process.argv.slice(2) });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
