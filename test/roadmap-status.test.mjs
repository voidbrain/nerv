import { test } from 'node:test';
import assert from 'node:assert/strict';
import { milestones, statuses, state, block, problems, place, START, END } from '../tools/roadmap-status.mjs';

const rec = (id, status, archived = false) => ({ id, kind: id.startsWith('F') ? 'feature' : 'bug', status, archived });
const table = (rows) =>
  [
    '# Roadmap',
    '',
    '| Milestone | Scope | Records | Acceptance |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Later',
    '',
  ].join('\n');
const withBlock = (text, active, archived) => place(text, block(milestones(text), statuses(active, archived)));

test('milestone status follows its records', () => {
  assert.equal(state([]), 'Planned');
  assert.equal(state(['Open', 'Investigate']), 'Planned');
  assert.equal(state(['Closed', 'Open']), 'In progress');
  assert.equal(state(['Implemented', 'Open']), 'In progress');
  assert.equal(state(['Closed', 'Implemented', 'Verified']), 'Awaiting verification');
  assert.equal(state(['Closed', 'Closed']), 'Delivered');
});

test('an archived record counts as closed and the active ledger wins', () => {
  const s = statuses([rec('F-002', 'Implemented')], [rec('F-001', 'Closed', true), rec('F-002', 'Closed', true)]);
  assert.equal(s.get('F-001'), 'Closed');
  assert.equal(s.get('F-002'), 'Implemented');
});

test('a consistent roadmap has no problems', () => {
  const active = [rec('F-002', 'Open'), rec('F-003', 'Implemented')];
  const archived = [rec('F-001', 'Closed', true)];
  const text = withBlock(
    table(['| 1 | core | F-001, F-002 | tests |', '| 2 | more | F-003 | tests |']),
    active,
    archived,
  );
  assert.deepEqual(problems(text, active, archived), []);
  assert.match(text, /\| 1 \| In progress \| 1 \| 0 \| 1 \| F-002 \|/);
  assert.match(text, /\| 2 \| Awaiting verification \| 0 \| 1 \| 0 \| — \|/);
});

test('an open feature must be placed exactly once', () => {
  const active = [rec('F-002', 'Open'), rec('F-004', 'Open')];
  const text = withBlock(table(['| 1 | core | F-002 | tests |', '| 2 | more | F-002 | tests |']), active, []);
  const p = problems(text, active, []);
  assert.ok(p.some((x) => x.startsWith('F-002 is placed in more than one milestone')));
  assert.ok(p.some((x) => x.startsWith('F-004 (Open) is not placed')));
});

test('closed features need no placement; unknown IDs and bugs are refused', () => {
  const active = [rec('F-002', 'Open'), rec('B-001', 'Open')];
  const archived = [rec('F-001', 'Closed', true)];
  const text = withBlock(table(['| 1 | core, see F-099 | F-002, B-001 | tests |']), active, archived);
  const p = problems(text, active, archived);
  assert.ok(p.includes('F-099 is cited in the roadmap but is not a backlog record.'));
  assert.ok(p.some((x) => x.startsWith('B-001 in 1')));
  assert.ok(!p.some((x) => x.startsWith('F-001')));
});

test('a status change in the backlog makes the table stale until regenerated', () => {
  const before = [rec('F-002', 'Open')];
  const after = [rec('F-002', 'Implemented')];
  const text = withBlock(table(['| 1 | core | F-002 | tests |']), before, []);
  assert.deepEqual(problems(text, before, []), []);
  assert.ok(problems(text, after, []).some((x) => x.startsWith('The milestone status block does not match')));
  assert.deepEqual(problems(withBlock(text, after, []), after, []), []);
});

test('the block is placed once before the first section and replaced in place', () => {
  const active = [rec('F-002', 'Open')];
  const once = withBlock(table(['| 1 | core | F-002 | tests |']), active, []);
  const twice = withBlock(once, active, []);
  assert.equal(twice, once);
  assert.equal(once.split(START).length, 2);
  assert.ok(once.indexOf(END) < once.indexOf('## Later'));
  assert.ok(problems(table(['| 1 | core | F-002 | tests |']), active, []).some((x) => x.includes('block is missing')));
});
