// @ts-check
// B-134: the Health "Phone push" line shows subscribed devices and the last delivery result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('web/public/dashboard/live.js', 'utf8');
const start = source.indexOf('  /** B-134: the Phone push line');
const end = source.indexOf('  window.renderHealth = function');
assert.ok(start > 0 && end > start, 'pushRow sits before renderHealth in live.js');
const pushRow = new Function(source.slice(start, end) + ';return pushRow;')();

test('B-134: Phone push line states devices and the last result, a failure with its reason', () => {
  assert.deepEqual(pushRow({ devices: 0, last: null }).slice(0, 2), ['Phone push', 'warn']);
  assert.match(pushRow({ devices: 1, last: null })[2], /1 device · no delivery yet/);
  const ok = pushRow({ devices: 2, last: { at: '2026-11-25T10:00:00Z', ok: true, status: 201, reason: null } });
  assert.equal(ok[1], 'ok');
  assert.match(ok[2], /2 devices · last ok \(201\)/);
  const bad = pushRow({
    devices: 1,
    last: { at: '2026-11-25T10:00:00Z', ok: false, status: 403, reason: 'BadJwtToken' },
  });
  assert.equal(bad[1], 'danger');
  assert.match(bad[2], /last failed \(403 BadJwtToken\)/);
  assert.equal(pushRow(undefined)[1], 'warn');
});
