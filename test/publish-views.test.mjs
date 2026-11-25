// F-125-T02: the published backlog-views ledger carries the same recap a local `npm run work:build` then
// `node tools/backlog-recap.mjs` writes. Since harness 10.21.3 (F-100) the copied backlog-views workflow runs
// `work-items publish --prepare` (read-only job: build, then .harness.json workItems.publishHooks, NERV's recap tool)
// and `work-items publish --ledger=<file>` (writing job, no hook). This drives both commands as the workflow does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('the published ledger matches a local build with its recap (publish --prepare runs the recap hook)', () => {
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

    // Plain publish would leave the recap out, so it refuses while publishHooks is set.
    const plain = spawnSync(process.execPath, ['tools/work-items.mjs', 'publish'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(plain.status, 0);
    assert.match(plain.stderr, /publishHooks/);

    // The read-only job: build and run the hook; the writing job: publish the prepared file.
    assert.match(node('tools/work-items.mjs', 'publish', '--prepare'), /ran 1 publish hook/);
    const prepared = join(base, 'prepared.md');
    cpSync(join(root, 'docs/BACKLOG.md'), prepared);
    rmSync(join(root, 'docs/BACKLOG.md'));
    assert.match(
      node('tools/work-items.mjs', 'publish', `--ledger=${prepared}`),
      /Published the views of [0-9a-f]{40}/,
    );
    const published = git(root, '--git-dir', origin, 'show', 'backlog-views:docs/BACKLOG.md');
    assert.equal(git(root, 'status', '--porcelain'), '', 'the checkout stays clean');

    // The next push publishes a fast-forward child of the previous publication.
    writeFileSync(join(root, 'note.txt'), 'next\n');
    git(root, 'add', 'note.txt');
    git(root, 'commit', '-q', '-m', 'next');
    const before = git(root, '--git-dir', origin, 'rev-parse', 'backlog-views');
    node('tools/work-items.mjs', 'publish', '--prepare');
    cpSync(join(root, 'docs/BACKLOG.md'), prepared);
    node('tools/work-items.mjs', 'publish', `--ledger=${prepared}`);
    assert.equal(git(root, '--git-dir', origin, 'rev-parse', 'backlog-views^'), before, 'a fast-forward');

    node('tools/work-items.mjs', 'build');
    node('tools/backlog-recap.mjs');
    const local = readFileSync(join(root, 'docs/BACKLOG.md'), 'utf8');
    assert.match(local, /\*\*Week \d{4}-\d\d-\d\d – \d{4}-\d\d-\d\d\*\*/);
    assert.equal(published, local.trimEnd(), 'the published ledger is the local build with its recap');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
