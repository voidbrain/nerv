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
