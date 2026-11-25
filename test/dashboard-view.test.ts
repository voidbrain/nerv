// F-130-T01: framework-free feed parsing and keyed merging for the workspace dashboard, and its parity with live.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  healthGlance,
  keyed,
  mapStatus,
  readStream,
  sameValue,
  STREAM_BOUND,
  toApproval,
  toSortie,
  type FeedSortie,
} from '../src/dashboard-view.ts';

const sortie = (over: Partial<FeedSortie> = {}): FeedSortie => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  source: 'owner',
  title: 'Water the plants',
  trust: 'trusted',
  status: 'open',
  created: '2026-11-25T08:00:00.000Z',
  closed: null,
  actions: 1,
  waiting: 0,
  patterns: [],
  why: '',
  ...over,
});

test('F-130-T01: mapStatus matches the live.js rule for every status', () => {
  const src = readFileSync('web/public/dashboard/live.js', 'utf8');
  const start = src.indexOf('  function mapStatus(');
  const live = new Function(`${src.slice(start, src.indexOf('\n', start))};return mapStatus;`)() as typeof mapStatus;
  for (const s of [
    sortie(),
    sortie({ waiting: 1 }),
    sortie({ question: { text: 'Which one?', expires: '2026-11-25T09:00:00.000Z' } }),
    sortie({ status: 'done' }),
    sortie({ status: 'failed' }),
    sortie({ status: 'stood-down' }),
    sortie({ status: 'cancelled' }),
  ])
    assert.equal(mapStatus(s), live(s), s.status);
});

test('F-130-T01: a sortie and an approval map to the rows the dashboard shows', () => {
  const row = toSortie(sortie({ source: 'misato', status: 'done', closed: '2026-11-25T08:05:00.000Z', why: 'asked' }));
  assert.equal(row.id, 'S-A1B2');
  assert.equal(row.pilot, 'misato');
  assert.equal(row.status, 'done');
  assert.equal(row.ended, Date.parse('2026-11-25T08:05:00.000Z'));
  const approval = toApproval({
    id: 'ap-1',
    card: {
      sortieId: 'ffee0000-0000-4000-8000-000000000002',
      actionId: 'x',
      tool: 'reminders.add',
      args: { title: 'Neutral' },
      effect: 'write',
      pattern: 'reminders.*',
      reason: 'new tool',
      expires: '2026-11-25T09:00:00.000Z',
    },
    expires: '2026-11-25T09:00:00.000Z',
    decision: null,
  });
  assert.deepEqual(approval, {
    id: 'ap-1',
    sortie: 'S-FFEE',
    tool: 'reminders.add',
    effect: 'write',
    pattern: 'reminders.*',
    reason: 'new tool',
    expires: Date.parse('2026-11-25T09:00:00.000Z'),
  });
});

test('F-130-T01: health at a glance follows the live.js rule', () => {
  assert.equal(healthGlance(null), 'unknown');
  assert.equal(healthGlance({ processes: { nervous: true, brainAlive: true }, degraded: [] }), 'ok');
  assert.equal(healthGlance({ processes: { nervous: true }, degraded: [{ check: 'disk' }] }), 'degraded');
  assert.equal(healthGlance({ processes: { nervous: false } }), 'issue');
  assert.equal(healthGlance({ processes: { nervous: true, brainAlive: false } }), 'issue');
});

test('F-130-T01: keyed merge keeps the same list and rows when a poll changes nothing (B-144)', () => {
  const key = (r: { id: string }) => r.id;
  const first = keyed(
    [],
    [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ],
    key,
  );
  const again = keyed(
    first,
    [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ],
    key,
  );
  assert.equal(again, first, 'an unchanged poll returns the previous list itself');
  const changed = keyed(
    first,
    [
      { id: 'a', n: 1 },
      { id: 'b', n: 3 },
      { id: 'c', n: 4 },
    ],
    key,
  );
  assert.notEqual(changed, first);
  assert.equal(changed[0], first[0], 'an unchanged row keeps its object');
  assert.notEqual(changed[1], first[1], 'a changed row is a new object');
  const moved = keyed(first, [first[1]!, first[0]!], key);
  assert.notEqual(moved, first, 'a move is a change of the list');
  assert.equal(moved[0], first[1]);
  assert.equal(keyed(first, [{ id: 'a', n: 1 }], key)[0], first[0], 'a removal keeps the rest');
});

test('F-130-T01: structural equality for poll replies', () => {
  assert.ok(sameValue({ a: [1, { b: null }] }, { a: [1, { b: null }] }));
  assert.ok(!sameValue({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(!sameValue([1], { 0: 1 }));
  assert.ok(!sameValue({ a: 1 }, { a: '1' }));
});

test('F-130-T01: the stream reader finds refresh events across chunks and bounds what it holds', () => {
  let r = readStream('', ': connected\n\nevent: ref');
  assert.equal(r.refresh, false);
  r = readStream(r.pending, 'resh\ndata: {}\n\n: heartbeat\n\n');
  assert.equal(r.refresh, true);
  assert.equal(r.pending, '');
  assert.throws(() => readStream('', 'x'.repeat(STREAM_BOUND + 1)), /exceeds bound/);
});
