// @ts-check
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('../tools/check-conflict-markers.mjs', import.meta.url));
const repo = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'nerv-markers-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
};
const run = (root) => spawnSync(process.execPath, [tool], { cwd: root, encoding: 'utf8' });

test('B-089: committed conflict markers fail the check and name the file; clean files pass', () => {
  const dirty = repo({
    'ledger.json': '{\n<<<<<<< HEAD\n  "a": 1\n=======\n  "a": 2\n>>>>>>> origin/main\n}\n',
    'notes.md': 'A line of ======= inside text is fine.\n',
  });
  const clean = repo({ 'notes.md': '# Title\n\n=======\n\nA setext rule alone is fine.\n' });
  try {
    const bad = run(dirty);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /ledger\.json:2/);
    assert.doesNotMatch(bad.stderr, /notes\.md/);
    const good = run(clean);
    assert.equal(good.status, 0, good.stderr);
  } finally {
    rmSync(dirty, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  }
});
