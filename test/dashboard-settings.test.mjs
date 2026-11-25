import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const live = readFileSync('web/public/dashboard/live.js', 'utf8');
const html = readFileSync('web/public/dashboard/index.html', 'utf8');
const body = live.slice(live.indexOf('  const pushSupported ='), live.indexOf('  function renderPush()'));
const view = ({ supported = true, permission = 'default', push = {} } = {}) =>
  new Function('navigator', 'window', 'Notification', 'state', `const INSTALLED=false;${body};return pushView();`)(
    supported ? { serviceWorker: {} } : {},
    supported ? { PushManager: 1, Notification: 1 } : {},
    { permission },
    { push: { busy: false, on: false, checked: true, broken: false, msg: null, ...push } },
  );
const enable = (v) => /id='btn-push-enable'/.test(v[2]);

test('B-146: Enable notifications shows only when enabling is possible', () => {
  assert.ok(enable(view()), 'supported, not denied, not subscribed');
  assert.ok(!enable(view({ supported: false })), 'no push support');
  const denied = view({ permission: 'denied' });
  assert.ok(!enable(denied), 'permission denied');
  assert.equal(denied[0], 'muted', 'denied is a short muted hint');
  assert.ok(denied[1].length < 100, denied[1]);
  const on = view({ push: { on: true } });
  assert.ok(!enable(on) && /id='btn-push-disable'/.test(on[2]), 'subscribed: Turn off instead');
  assert.ok(!enable(view({ push: { checked: false } })), 'not while the subscription is still being checked');
  assert.ok(!enable(view({ push: { broken: true } })), 'not when the worker cannot be reached');
});

test('B-146: Settings keeps two columns on a phone, with a spaced header row', () => {
  const phone = [...html.matchAll(/@media \(max-width:720px\) \{([^\n]*)\}/g)].map((m) => m[1]).join('\n');
  assert.doesNotMatch(phone, /\.cols-2 \{ grid-template-columns:minmax\(0,1fr\)/, '.cols-2 no longer stacks at 720 px');
  assert.match(phone, /\.cols-2 \{ gap:0 4px; \}/, 'tighter gap on a phone');
  assert.match(html, /\.settings-head \{[^}]*flex-wrap:wrap[^}]*gap:/);
  assert.match(live, /<div class='row small settings-head'><b>Notifications<\/b>/);
});
