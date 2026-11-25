// F-125-T02: with workItems.views "built" the ledger is never committed. The recap and roadmap tools rebuild it from the
// record sources and fill the layout's bare recap marker pair; these tests cover that join with the copied work-items tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { builtViews, headerProblems, place } from '../tools/backlog-recap.mjs';

const BARE = '<!-- recap:start -->\n<!-- recap:end -->';
const ledger = (marker) =>
  [
    '# Backlog',
    '',
    'Reviewed against main `abc1234`.',
    '[Rules](BACKLOG-RULES.md)',
    '',
    marker,
    '',
    '## Work items',
    '',
  ].join('\n');

test('place fills the bare marker pair of a built view, once, and copies the block literally', () => {
  const block = '<!-- recap:start · generated -->\n**Week** costs $& and $1\n<!-- recap:end -->';
  const out = place(ledger(BARE), block);
  assert.equal(out, ledger(block));
  assert.equal(place(out, block), out, 'placing again replaces the block instead of adding one');
});

test('the header of a built view ends at the bare recap marker', () => {
  assert.deepEqual(headerProblems(ledger(BARE)), []);
});

test('builtViews reads workItems.views from .harness.json and is false without one', () => {
  const root = mkdtempSync(join(tmpdir(), 'nerv-views-'));
  try {
    assert.equal(builtViews(root), false);
    writeFileSync(join(root, '.harness.json'), JSON.stringify({ workItems: { enabled: true, views: 'built' } }));
    assert.equal(builtViews(root), true);
    writeFileSync(join(root, '.harness.json'), JSON.stringify({ workItems: { enabled: false, views: 'built' } }));
    assert.equal(builtViews(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check:recap and check:roadmap rebuild the ledger from the sources; only check:recap leaves the recap in it', () => {
  const root = mkdtempSync(join(tmpdir(), 'nerv-views-'));
  try {
    for (const path of ['.harness.json', 'tools', 'docs']) cpSync(path, join(root, path), { recursive: true });
    const run = (...args) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    writeFileSync(join(root, 'docs/BACKLOG.md'), 'SENTINEL-F125-T02: never read with built views\n');
    const recap = run('tools/backlog-recap.mjs', '--check');
    assert.equal(recap.status, 0, recap.stderr);
    const withRecap = readFileSync(join(root, 'docs/BACKLOG.md'), 'utf8');
    assert.match(withRecap, /<!-- recap:start · generated[^\n]*-->\n\*\*Week \d{4}-\d\d-\d\d – \d{4}-\d\d-\d\d\*\*/);
    assert.doesNotMatch(withRecap, /SENTINEL-F125-T02/);
    const roadmap = run('tools/roadmap-status.mjs', '--check');
    assert.equal(roadmap.status, 0, roadmap.stderr);
    assert.match(readFileSync(join(root, 'docs/BACKLOG.md'), 'utf8'), /<!-- recap:start -->\n<!-- recap:end -->/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
