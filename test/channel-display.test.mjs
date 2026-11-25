import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
const source = readFileSync('web/public/dashboard/live.js', 'utf8');
const code = source.slice(source.indexOf('  function channelLine'), source.indexOf('  window.renderBases ='));
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const dashboard = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
const start = dashboard.indexOf('function telegramApiState(');
const stateCode = dashboard.slice(start, dashboard.indexOf('function drawTelegram', start));
const line = new Function('esc', 'baseName', stateCode + code + ';return channelLine;')(esc, (id) =>
  id === 'NERV-01' ? 'Neo <Tokyo>' : id,
);
const c = {
  mode: 'local-fallback',
  destination: 'NERV-01',
  checkedAt: '2030-01-01T00:00:00.000Z',
  lastDelivery: { route: 'local', result: 'accepted', at: '2030-01-01T00:00:01.000Z' },
};
test('routing and send evidence stay distinct, escaped, and stale or absent telemetry stays unknown', () => {
  const { document } = parseHTML('<div>' + line({ channel: c, channelFresh: true }) + '</div>');
  assert.match(document.toString(), /local fallback/);
  assert.match(document.toString(), /Neo &lt;Tokyo&gt;/);
  assert.equal(document.querySelector('tokyo'), null);
  assert.match(document.toString(), /Last send accepted via local bot/);
  assert.match(document.toString(), /phone receipt unknown/);
  assert.match(line({ channel: c, channelFresh: false }), /unknown · last reported local fallback/);
  assert.match(line({ channel: c, channelFresh: false }), /stale or offline/);
  assert.match(line({}), /state not reported/);
  for (const [mode, label] of [
    ['via-main', 'via main'],
    ['local', 'local channel'],
    ['unavailable', 'unavailable · not configured'],
    ['unknown', 'unknown'],
  ]) {
    const html = line({ channel: { ...c, mode, lastDelivery: undefined }, channelFresh: true });
    assert.ok(html.includes(label));
    assert.match(html, /No send result reported/);
  }
  assert.match(
    line({ channel: { ...c, lastDelivery: { ...c.lastDelivery, result: 'failed' } }, channelFresh: true }),
    /Last send failed/,
  );
});
