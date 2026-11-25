// B-123: the Health row shows the updater's status beside Update now: in progress (with its step), completed, refused,
// failed or uncertain, with reasons and recovery, escaped, until dismissed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('web/public/dashboard/live.js', 'utf8');
const start = source.indexOf('  // B-123: updater status (start)');
const end = source.indexOf('  // B-123: updater status (end)');
assert.ok(start > 0 && end > start, 'the B-123 helper is marked in live.js');
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const { updaterStatusHtml } = new Function('esc', source.slice(start, end) + ';return { updaterStatusHtml };')(esc);

const B = 'fd0f2a0a'.padEnd(40, '0');
const at = '2026-11-24T10:15:00.000Z';
const base = { version: 1, channel: 'main', revision: B, startedAt: at, at, reasons: [], recovery: [] };

test('B-123: the refusal the owner never saw is shown with its reason and recovery, and can be dismissed', () => {
  const html = updaterStatusHtml({
    ...base,
    state: 'refused',
    reasons: ['Service or runtime ownership is unknown or belongs elsewhere.'],
    recovery: ['Nothing was stopped; NERV keeps running the current revision.'],
  });
  assert.match(html, /id='update-status'/);
  assert.match(html, /Update refused · fd0f2a0/);
  assert.match(html, /class='update-status small warn'/);
  assert.match(html, /<li>Service or runtime ownership is unknown or belongs elsewhere\.<\/li>/);
  assert.match(html, /Recovery:[\s\S]*<li>Nothing was stopped; NERV keeps running the current revision\.<\/li>/);
  assert.match(html, /id='btn-dismiss-update-status'/);
  assert.doesNotMatch(html, /style='[^']*#/, 'no literal colour');
});

test('B-123: in progress names the step and cannot be dismissed; each outcome has its own words', () => {
  const running = updaterStatusHtml({ ...base, state: 'running', step: 'Stopping the service' });
  assert.match(running, /Update in progress · fd0f2a0 · Stopping the service/);
  assert.doesNotMatch(running, /btn-dismiss-update-status/);
  assert.match(updaterStatusHtml({ ...base, state: 'running' }), /Update in progress · fd0f2a0 · started/);
  assert.match(
    updaterStatusHtml({ ...base, state: 'completed' }),
    /class='update-status small ok'[\s\S]*Update completed · now on fd0f2a0/,
  );
  assert.match(
    updaterStatusHtml({ ...base, state: 'failed', reasons: ['boom'] }),
    /class='update-status small danger'[\s\S]*Update failed · fd0f2a0/,
  );
  assert.match(
    updaterStatusHtml({ ...base, state: 'uncertain' }),
    /class='update-status small danger'[\s\S]*Update outcome uncertain/,
  );
  assert.equal(updaterStatusHtml(null), '');
});

test('B-123: every server-provided field is escaped', () => {
  const html = updaterStatusHtml({
    ...base,
    state: 'refused',
    revision: '<img src=x>',
    step: '<b>',
    reasons: ['<script>alert(1)</script>'],
    recovery: ['a & b'],
  });
  assert.doesNotMatch(html, /<\s*(script|img|b)\b/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
});
