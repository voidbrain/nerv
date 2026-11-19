// B-101: the dashboard names why the base is degraded, and says a model is down only when one is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('web/public/dashboard/live.js', 'utf8');
const start = source.indexOf('  /** B-101: a reason that means');
const end = source.indexOf('  // Real heartbeats on the Kaji line');
assert.ok(start > 0 && end > start, 'the B-101 helpers sit before the heartbeat code in live.js');
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const { degradedBanner, healthOf } = new Function(
  'esc',
  source.slice(start, end) + ';return { degradedBanner, healthOf };',
)(esc);

const up = { processes: { nervous: 1, brainAlive: true }, models: { roles: { misato: 'local (gemma4:12b)' } } };
const nightRun = 'Instrumentality: did not complete — the local route was unavailable; it is retried tomorrow.';
const routeDown = 'S² local route down since 2026-11-19T03:00:00Z: Local route (S²) unreachable.';

test('B-101: a failed overnight run is shown as itself, without a model-failure claim or a standby base', () => {
  const html = degradedBanner([nightRun]);
  assert.match(html, /DEGRADED/);
  assert.match(html, /Instrumentality: did not complete — the local route was unavailable/, 'the reason is shown');
  assert.doesNotMatch(html, /requests that need a model fail/, 'no model is down');
  assert.equal(healthOf({ ...up, degraded: [nightRun] }), 'online', 'the base still answers');
});

test('B-101: a down model route or brain keeps the model-failure sentence and the standby state', () => {
  for (const reason of [routeDown, 'brain process not answering: model-needing requests fail until it is back']) {
    const html = degradedBanner([reason]);
    assert.match(html, /requests that need a model fail/);
    assert.ok(html.includes(esc(reason)), 'the reason is shown');
    assert.equal(healthOf({ ...up, degraded: [reason] }), 'standby');
  }
});

test('B-101: no reason, no banner; every reason is listed and escaped', () => {
  assert.equal(degradedBanner([]), '');
  assert.equal(degradedBanner(undefined), '');
  const html = degradedBanner([nightRun, '<script>x</script>']);
  assert.ok(html.includes('&lt;script&gt;'), 'escaped');
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
});
