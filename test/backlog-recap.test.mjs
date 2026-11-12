import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekOf, recap, parseRecords } from '../tools/backlog-recap.mjs';

const r = (id, status, opened, closed = null) => ({
  id,
  kind: id.startsWith('F') ? 'feature' : 'bug',
  status,
  human: false,
  opened,
  closed,
  archived: status === 'Closed',
});

test('the recap week runs Monday to Sunday (UTC), the same weeks as the archive', () => {
  assert.deepEqual(weekOf('2026-11-02'), { from: '2026-11-02', to: '2026-11-08' }, 'a Monday starts its own week');
  assert.deepEqual(weekOf('2026-11-06'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(weekOf('2026-11-08'), { from: '2026-11-02', to: '2026-11-08' }, 'a Sunday ends it');
  assert.deepEqual(weekOf('2027-01-01'), { from: '2026-12-28', to: '2027-01-03' }, 'a week across the new year');
  assert.throws(() => weekOf('2026-02-30'), /Invalid date/);
});

test('opened and closed count the whole current week, not the 7 days before the date', () => {
  const records = {
    active: [r('F-001', 'Open', '2026-11-02'), r('F-002', 'Open', '2026-11-01'), r('B-001', 'Open', '2026-11-08')],
    archived: [r('F-003', 'Closed', '2026-10-20', '2026-11-03'), r('B-002', 'Closed', '2026-11-02', '2026-11-09')],
  };
  const block = recap(records, '2026-11-04');
  assert.match(block, /\*\*Week 2026-11-02 – 2026-11-08\*\*/);
  assert.match(
    block,
    /\| \*\*This week\*\* \| 1 \| 1 \| 2 \| 0 \|/,
    'Sunday counts, the previous Sunday and the next Monday do not',
  );
  assert.doesNotMatch(block, /Recap as of|Last 7 days/);
});

test('the human cue is read from the generated summary table as well as the authored line (harness 6.0.0)', () => {
  const generated = (id, cue) =>
    `### ${id}\n\n**Title**\n\n| Signal | Priority | Status | Effort | Remaining | Depends on | Unlocks | Human action |\n|:---:|---|---|---|---|---|---|:---:|\n| 🔴 | 🔶 P2 | Open | 🟢 Small | 2 h | — | — | ${cue} |\n\n${cue.split(' ')[0]} **→** Next.\n\n---\n`;
  const authored =
    '### F-003\n\n**Title**\n\n| Signal | Priority | Status | Effort |\n|:---:|---|---|---|\n| 🔴 | 🔶 P2 | Open | 🟢 Small |\n\n🧑 **→ Human action required: Yes**<br />Decide.\n\n---\n';
  const records = parseRecords(generated('F-001', '🧑 Yes') + generated('B-001', '💻 No') + authored);
  assert.deepEqual(
    records.map((x) => [x.id, x.human]),
    [
      ['F-001', true],
      ['B-001', false],
      ['F-003', true],
    ],
  );
});

test('the status is read from the generated summary where Status carries its colour (harness 7.0.0)', () => {
  const record = (id, status, cue) =>
    `### ${id}\n\n**Title**\n\n| Status | Priority | Effort | Remaining | Depends on | Unlocks | Human action |\n|---|---|---|---|---|---|:---:|\n| ${cue} ${status} | 🔶 P2 | 🟣 Very large | 9 h | — | — | 💻 No |\n\n💻 **→** Next.\n\n---\n`;
  const records = parseRecords(
    record('F-001', 'Implemented', '🟡') + record('B-002', 'Blocked', '🟣') + record('F-003', 'Open', '🔴'),
  );
  assert.deepEqual(
    records.map((r) => [r.id, r.status]),
    [
      ['F-001', 'Implemented'],
      ['B-002', 'Blocked'],
      ['F-003', 'Open'],
    ],
  );
});

test('Require Human splits each kind into Procedures and Decision (harness 8.0.0)', () => {
  const generated = (id, procedure, decision) =>
    `### ${id}\n\n**Title**\n\n| Status | Priority | Effort | Remaining | Procedures | Decisions |\n|---|---|---|---|:---:|:---:|\n| 🔴 Open | 🔶 P2 | 🟢 Small | 2 h | ${procedure} | ${decision} |\n\n${procedure === '🧑' || decision === '🧑' ? '🧑' : '💻'} **→** Next.\n\n---\n`;
  const authored = (id, kind) =>
    `### ${id}\n\n**Title**\n\n| Signal | Priority | Status | Effort |\n|:---:|---|---|---|\n| 🔴 | 🔶 P2 | Open | 🟢 Small |\n\n🧑 **→ Human action required: ${kind}**<br />Next.\n\n---\n`;
  const records = parseRecords(
    generated('F-001', '🧑', '—') +
      generated('F-002', '—', '🧑') +
      generated('B-001', '🧑', '🧑') +
      generated('B-002', '—', '—') +
      authored('F-003', 'Both') +
      authored('B-003', 'Decision'),
  );
  assert.deepEqual(
    records.map((x) => [x.id, x.human, x.procedure, x.decision]),
    [
      ['F-001', true, true, false],
      ['F-002', true, false, true],
      ['B-001', true, true, true],
      ['B-002', false, false, false],
      ['F-003', true, true, true],
      ['B-003', true, false, true],
    ],
  );
  const block = recap({ active: records, archived: [] }, '2026-11-12');
  assert.match(block, /\| \*\*Require Human 🧑\*\* \| 3 \| 2 \|/, 'a record counts once whatever its kind');
  assert.match(
    block,
    /### Require Human 🧑\n\n\| Features \| \| Bugs \| \|\n\|---\|---\|---\|---\|\n\| \*\*Procedures\*\* \| \*\*Decisions\*\* \| \*\*Procedures\*\* \| \*\*Decisions\*\* \|\n\| \[F-001\]\(#f-001\) \| \[F-002\]\(#f-002\) \| \[B-001\]\(#b-001\) \| \[B-001\]\(#b-001\) \|\n\| \[F-003\]\(#f-003\) \| \[F-003\]\(#f-003\) \| {2}\| \[B-003\]\(#b-003\) \|\n<!-- recap:end -->/,
  );
  const none = recap({ active: [records[3]], archived: [] }, '2026-11-12');
  assert.match(none, /\*\*Decisions\*\* \|\n\| — \| — \| — \| — \|\n<!-- recap:end -->/, 'empty columns show —');
});

test('parseRecords reads icon and back-to-top link headings', () => {
  const sample = [
    '### <a id="f-074"></a>[✨ F-074](#top)',
    '',
    '**Title**',
    '',
    '| Status | Priority | Effort | Remaining | Procedures | Decision |',
    '|---|---|---|---|---|---|',
    '| 🔴 Open | 🔶 P2 | 🟢 Small | 1 h | — | — |',
    '',
    '💻 **→** Next.',
    '',
    '---',
    '### <a id="b-045"></a>[🐞 B-045](#top)',
    '',
    '**Bug**',
    '',
    '| Status | Priority | Effort | Remaining | Procedures | Decision |',
    '|---|---|---|---|---|---|',
    '| 🟣 Blocked | 🔺 P1 | 🟢 Small | 1 h | 🧑 | — |',
    '',
    '🧑 **→** Next.',
    '',
    '---',
  ].join('\n');
  const records = parseRecords(sample);
  assert.deepEqual(
    records.map((r) => [r.id, r.kind, r.status, r.procedure]),
    [
      ['F-074', 'feature', 'Open', false],
      ['B-045', 'bug', 'Blocked', true],
    ],
  );
});
