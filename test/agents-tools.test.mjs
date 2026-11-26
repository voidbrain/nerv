// @ts-check
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string} markdown
 * @param {string} root
 * @returns {string[]}
 */
function missingToolsNamedInAgents(markdown, root) {
  const named = new Set(markdown.match(/\btools\/[A-Za-z0-9_./-]+\.mjs\b/g) ?? []);
  return [...named].filter((rel) => !existsSync(join(root, rel)));
}

test('F-125-T03: every tools/*.mjs file named in AGENTS.md exists, and missing ones fail', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.deepEqual(missingToolsNamedInAgents(agents, ROOT), []);
  assert.deepEqual(missingToolsNamedInAgents(`${agents}\nnode tools/missing-sentinel-tool.mjs\n`, ROOT), [
    'tools/missing-sentinel-tool.mjs',
  ]);
});

test('F-125-T03: required template scripts exist and guard.mjs install runs cleanly', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const script of [
    'guard:install',
    'behaviour',
    'coverage:browser',
    'mcp:recommend',
    'reconcile:preview',
    'friction',
    'impact-map',
  ]) {
    assert.equal(typeof pkg.scripts[script], 'string', `missing package.json script: ${script}`);
  }

  const fixture = mkdtempSync(join(tmpdir(), 'nerv-guard-install-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: fixture });
    mkdirSync(join(fixture, 'tools'), { recursive: true });
    copyFileSync(join(ROOT, 'tools', 'guard.mjs'), join(fixture, 'tools', 'guard.mjs'));
    execFileSync(process.execPath, [join(fixture, 'tools', 'guard.mjs'), 'install'], { cwd: fixture });
    assert.equal(existsSync(join(fixture, '.git', 'hooks', 'pre-push')), true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
