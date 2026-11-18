import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findPrReferences, prFromEvent } from '../tools/check-pr-record.mjs';

const tool = fileURLToPath(new URL('../tools/check-pr-record.mjs', import.meta.url));
const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});
/** A neutral repository with one record, one task and a reconciliation log. */
function repo({ record = '', task = {}, log = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nerv-pr-record-'));
  dirs.push(root);
  for (const dir of ['docs/work/records', 'docs/work/tasks', 'docs/archive'])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'docs/work/records/F-001.md'), `### F-001\n\n${record}\n`);
  writeFileSync(join(root, 'docs/work/tasks/F-001-T01.json'), JSON.stringify({ id: 'F-001-T01', ...task }));
  writeFileSync(join(root, 'docs/archive/reconciliation-2030.md'), `# Log\n\n${log}\n`);
  return root;
}
const run = (root, event) => {
  const path = join(root, 'event.json');
  writeFileSync(path, JSON.stringify(event));
  return spawnSync(process.execPath, [tool], {
    cwd: root,
    env: { ...process.env, GITHUB_EVENT_PATH: path },
    encoding: 'utf8',
  });
};
const pull = (number, user = { login: 'owner', type: 'User' }) => ({ pull_request: { number, user } });

describe('F-105: a pull request names itself in the backlog', () => {
  it('finds the PR in a record link, a task prs entry or the reconciliation log, and not as a longer number', () => {
    assert.deepEqual(findPrReferences(repo({ record: '[PR #12](https://example.invalid/pull/12)' }), 12), [
      'docs/work/records/F-001.md',
    ]);
    assert.deepEqual(findPrReferences(repo({ task: { prs: [{ pr: 12, note: 'fix' }] } }), 12), [
      'docs/work/tasks/F-001-T01.json',
    ]);
    assert.deepEqual(findPrReferences(repo({ log: 'Reconciled in PR #12.' }), 12), [
      'docs/archive/reconciliation-2030.md',
    ]);
    assert.deepEqual(findPrReferences(repo({ record: 'PR #123 and /pull/120' }), 12), []);
    assert.throws(() => findPrReferences(repo(), 0), /Invalid PR number/);
  });

  it('passes a PR its branch names, fails one it does not with the places to edit, and skips pushes and bots', () => {
    const named = run(repo({ record: '[PR #7](https://example.invalid/pull/7)' }), pull(7));
    assert.equal(named.status, 0, named.stderr);
    assert.match(named.stdout, /PR #7 is named in docs\/work\/records\/F-001\.md/);
    const missing = run(repo({ record: 'opened in this PR' }), pull(7));
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /PR #7 is named in no record/);
    assert.match(
      missing.stderr,
      /docs\/work\/records\/\*\.md; docs\/work\/tasks\/\*\.json \(prs\); docs\/archive\/reconciliation/,
    );
    const push = run(repo(), { ref: 'refs/heads/main' });
    assert.equal(push.status, 0);
    assert.match(push.stdout, /skipped: not a pull request run/);
    assert.deepEqual(prFromEvent(pull(9, { login: 'dependabot[bot]', type: 'Bot' })), {
      skip: 'opened by dependabot[bot]',
    });
    assert.equal(run(repo(), pull(9, { login: 'dependabot[bot]', type: 'Bot' })).status, 0);
  });
});
