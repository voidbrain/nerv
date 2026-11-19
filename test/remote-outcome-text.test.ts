import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteOutcomeText } from '../src/runtime-api.ts';

test('B-094: a refusal whose reason already ends a sentence gets one full stop', () => {
  assert.equal(
    remoteOutcomeText('NERV-03', 'reminders.add', {
      outcome: 'reject',
      reason: 'Cancelled before dispatch; nothing was sent.',
    }),
    'NERV-03 refused reminders.add: Cancelled before dispatch; nothing was sent.',
  );
  assert.equal(
    remoteOutcomeText('NERV-03', 'reminders.add', { outcome: 'reject', reason: 'busy' }),
    'NERV-03 refused reminders.add: busy.',
  );
});

test('B-094: a reply after kaji.run carries the results already recorded, and keeps its words when none arrived', async () => {
  const { withRemoteResults } = await import('../src/runtime-api.ts');
  assert.equal(withRemoteResults('Sent to Tabgha; the result follows.', []), 'Sent to Tabgha; the result follows.');
  assert.equal(
    withRemoteResults('Sent to Tabgha.', ['Tabgha ran reminders.add (“Stretch”).']),
    'Sent to Tabgha.\n\nTabgha ran reminders.add (“Stretch”).',
  );
  assert.equal(
    withRemoteResults('Sent.', ['NERV-03 refused reminders.add: busy.', 'NERV-02 may have run x.']),
    'Sent.\n\nNERV-03 refused reminders.add: busy.\nNERV-02 may have run x.',
  );
});
