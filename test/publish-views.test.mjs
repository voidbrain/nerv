// F-125-T02: the published backlog-views ledger carries the same recap a local `npm run work:build` then
// `node tools/backlog-recap.mjs` writes. The template's `work-items publish` renders no project recap, so NERV's forked
// backlog-views workflow runs tools/publish-views.mjs, which publishes through the same publishViews with the recap filled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('the published ledger matches a local build with its recap, and work-items publish alone left it empty', () => {
  const base = mkdtempSync(join(tmpdir(), 'nerv-publish-'));
  const root = join(base, 'repo');
  const origin = join(base, 'origin.git');
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const node = (...args) => {
    const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}${r.stdout}`);
    return r.stdout;
  };
  try {
    for (const path of ['.harness.json', '.gitignore', 'tools', 'docs'])
      cpSync(path, join(root, path), { recursive: true });
    rmSync(join(root, 'docs/BACKLOG.md'), { force: true });
    git(base, 'init', '-q', '--bare', origin);
    git(root, 'init', '-q', '-b', 'main');
    for (const [k, v] of [
      ['user.name', 'Test'],
      ['user.email', 'test@example.invalid'],
      ['commit.gpgsign', 'false'],
    ])
      git(root, 'config', k, v);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'fixture');
    git(root, 'remote', 'add', 'origin', origin);

    // The template command, as the copied workflow ran it: the recap block stays empty.
    node('tools/work-items.mjs', 'publish');
    const bare = git(root, '--git-dir', origin, 'show', 'backlog-views:docs/BACKLOG.md');
    assert.match(bare, /<!-- recap:start -->\n<!-- recap:end -->/);

    // NERV's publisher: a fast-forward child of the previous publication, with the recap.
    git(root, 'commit', '-q', '--allow-empty', '-m', 'next');
    const before = git(root, '--git-dir', origin, 'rev-parse', 'backlog-views');
    assert.match(node('tools/publish-views.mjs'), /Published the views of [0-9a-f]{40}/);
    const published = git(root, '--git-dir', origin, 'show', 'backlog-views:docs/BACKLOG.md');
    assert.equal(git(root, '--git-dir', origin, 'rev-parse', 'backlog-views^'), before, 'a fast-forward');
    assert.equal(git(root, 'status', '--porcelain'), '', 'the checkout stays clean');

    node('tools/work-items.mjs', 'build');
    node('tools/backlog-recap.mjs');
    const local = readFileSync(join(root, 'docs/BACKLOG.md'), 'utf8');
    assert.match(local, /\*\*Week \d{4}-\d\d-\d\d – \d{4}-\d\d-\d\d\*\*/);
    assert.equal(published, local.trimEnd(), 'the published ledger is the local build with its recap');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
