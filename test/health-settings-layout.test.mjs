// B-142 (owner 2026-11-25): the Health rows "Service sample" and "Link · <peer>" were built apart from the table: a
// plain value with no ✓/✗ marker, a label that wrapped ("Service / sample", "Link · NERV- / 02") and the rows placed
// after the updater status, so the table looked broken. B-141: the updater status stands out (state tone, bold, a
// bordered box) and Settings is two columns (update schedule | pair, notifications, revoke) that stack on a phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const live = readFileSync('web/public/dashboard/live.js', 'utf8');
const html = readFileSync('web/public/dashboard/index.html', 'utf8');
const esc = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#39;');
const block = (name) => {
  const start = live.indexOf(`  // ${name} (start)`);
  const end = live.indexOf(`  // ${name} (end)`);
  assert.ok(start > 0 && end > start, `${name} is marked in live.js`);
  return live.slice(start, end);
};
const { healthRowHtml, healthMetricRows } = new Function(
  'esc',
  block('B-142: health rows') + ';return { healthRowHtml, healthMetricRows };',
)(esc);
const { updaterStatusHtml } = new Function('esc', block('B-123: updater status') + ';return { updaterStatusHtml };')(
  esc,
);
const css = (selector) => {
  const at = html.indexOf(selector + ' {');
  assert.ok(at >= 0, selector + ' is styled');
  return html.slice(at, html.indexOf('}', at));
};

// Every Health row: one div with exactly a label span and a value span holding the marker, the text and any action.
const ROW =
  /^<div class='row small health-row'(?: [^>]*)?><span class='health-label'>[^<]*<\/span><span class='row health-value'><span class='(ok|warn|danger|muted)'>([✓✗·]) [^<]*<\/span>(?:<button[^>]*>[^<]*<\/button>)?<\/span><\/div>$/;

test('B-142: service sample and link rows render with the same two-cell structure as every Health row', () => {
  const hm = {
    latestSample: { rssBytes: 600 * 1048576, heapUsedBytes: 120 * 1048576, eventLoopDelayMs: 12, pollCount: 9 },
    links: [{ peerId: 'NERV-02', bytesSent: 512, bytesReceived: 1024, lastLatencyMs: 38, inFlight: 1, reconnects: 2 }],
    warnings: [{ key: 'link:NERV-02:reconnects', message: 'reconnects' }],
  };
  const rows = healthMetricRows(hm).map(healthRowHtml);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.match(row, ROW);
  assert.match(rows[0], /^<div class='row small health-row' id='health-sample-row'>/);
  assert.match(rows[0], /<span class='health-label'>Service sample<\/span>/);
  assert.match(rows[0], /<span class='ok'>✓ RSS 600\.0 MB · Heap 120\.0 MB · Loop 12 ms · Polls 9<\/span>/);
  assert.match(rows[1], /data-link-peer='NERV-02'/);
  assert.match(rows[1], /<span class='health-label'>Link · NERV-02<\/span>/);
  assert.match(rows[1], /<span class='warn'>✗ 512B↑ \/ 1024B↓ · 38 ms · in-flight 1 · reconnects 2<\/span>/);

  const empty = healthMetricRows(null).map(healthRowHtml);
  for (const row of empty) assert.match(row, ROW);
  assert.match(empty[0], /id='health-sample-row'[\s\S]*<span class='muted'>· No health samples yet\.<\/span>/);
  assert.match(empty[1], /id='health-links-empty'[\s\S]*<span class='muted'>· No peer link traffic recorded\.<\/span>/);

  const hostile = healthRowHtml(healthMetricRows({ links: [{ peerId: "<b x='1'>" }] })[1]);
  assert.doesNotMatch(hostile, /<b /, 'a peer id is escaped in the label and the attribute');
});

test('B-142: the rows sit in one Health table, the labels never wrap, and the availability row ends it', () => {
  const render = live.slice(live.indexOf('window.renderHealth ='), live.indexOf('// Kaji bases (F-036)'));
  assert.match(render, /<div class='health-table'>" \+ table\.map\(healthRowHtml\)\.join\(""\) \+ "<\/div>"/);
  assert.match(render, /concat\(healthMetricRows\(hm\), availabilityRow \? \[availabilityRow\] : \[\]\)/);
  assert.doesNotMatch(render, /sampleHtml|linksHtml/, 'no metric row is rendered outside the table');
  assert.match(css('.health-row > .health-label'), /white-space:nowrap/);
  assert.match(css('.health-row > .health-value'), /justify-content:flex-end/);
  const withAction = healthRowHtml([
    'Update availability',
    'warn',
    'update available · bbbbbbb (main)',
    "<button class='btn sm' id='btn-apply-update' type='button'>Update now</button>",
    "<div id='update-status'></div>",
  ]);
  assert.match(withAction.slice(0, withAction.indexOf("<div id='update-status'")), ROW);
});

test('B-141: the updater status stands out with its state tone, bold and a bordered box, no literal colour', () => {
  for (const [state, tone] of [
    ['running', 'warn'],
    ['refused', 'warn'],
    ['failed', 'danger'],
    ['uncertain', 'danger'],
    ['completed', 'ok'],
  ]) {
    const out = updaterStatusHtml({ state, revision: 'b'.repeat(40), at: '2026-11-25T10:00:00Z' });
    assert.match(out, new RegExp(`^<div id='update-status' class='update-status small ${tone}'>`), state);
    assert.match(out, /<strong>Update /);
  }
  const box = css('.update-status');
  assert.match(box, /font-weight:700/);
  assert.match(box, /border:1px solid currentColor/);
  assert.match(box, /var\(--radius\)/);
  assert.doesNotMatch(box, /#[0-9a-f]{3,8}\b|rgb\(/i, 'tokens and currentColor only');
  assert.match(
    html,
    /\.ok \{ color:var\(--ok\); \} \.warn \{ color:var\(--warn\); \} \.danger \{ color:var\(--danger\); \}/,
  );
});

// B-146 (owner, 2026-11-25): the columns no longer stack on a phone; they stay two, with tighter gaps.
test('B-141: Settings is two columns (schedule | pair, notifications, revoke), on a phone too (B-146)', () => {
  const panel = html.slice(html.indexOf('<section class="panel" id="p-settings">'));
  const cols = panel.slice(0, panel.indexOf('</section>'));
  assert.match(
    cols,
    /<div class="cols-2" id="settings-cols">\s*<div class="pad" id="settings"><\/div>\s*<div>\s*<div class="pad" id="settings-devices"><\/div>\s*<div class="pad" id="settings-push"><\/div>\s*<\/div>\s*<\/div>/,
  );
  assert.match(css('.cols-2'), /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(html, /\.cols-2 \{ grid-template-columns:minmax\(0,1fr\); \}/);
  assert.match(css('.field-grid'), /grid-template-columns:auto minmax\(0,1fr\)/);

  const settings = live.slice(live.indexOf('window.renderSettings ='), live.indexOf('function readSettingsDraft()'));
  assert.match(settings, /<div class='field-grid small'>/);
  for (const label of ['Updates', 'Check at', 'Apply at', 'Quiet hours', 'Daily brief'])
    assert.match(settings, new RegExp(`"<span>${label}</span><(?:span|label) class='field`), label);
  assert.doesNotMatch(settings, /style='/, 'layout comes from classes, not inline styles');
  const devices = live.slice(live.indexOf('function renderDevices()'), live.indexOf('function pairingHtml()'));
  assert.match(devices, /btn-pair-device/);
  assert.match(devices, /data-revoke=/);
  assert.doesNotMatch(devices, /<code>/, 'the command reads inline, not as a full-width block');
});
