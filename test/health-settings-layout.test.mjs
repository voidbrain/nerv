// @ts-check
// B-142 (owner 2026-11-25): the Health rows "Service sample" and "Link · <peer>" were built apart from the table: a
// plain value with no ✓/✗ marker, a label that wrapped ("Service / sample", "Link · NERV- / 02") and the rows placed
// after the updater status, so the table looked broken. B-141: the updater status stands out (state tone, bold, a
// bordered box) and Settings is two columns (update schedule | pair, notifications, revoke) that stack on a phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

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
const { healthRowHtml } = new Function('esc', block('B-142: health rows') + ';return { healthRowHtml };')(esc);
/** F-152: the diagnostics table (service sample and one row per peer link), read lazily so a missing builder fails a test. */
const diagnostics = (/** @type {object} */ hm) =>
  new Function('esc', block('B-142: health rows') + ';return healthDiagnosticsHtml;')(esc)(hm);
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

// F-152 (owner, 2026-11-26): the service sample and the link rows were dotted text lines; they became one table so the
// service and each link compare. F-152-T08 (owner, 2026-11-27, changed requirement): the table scrolled sideways on the
// phone and on the Mac, so the diagnostics are cards at every width: one per row (service, each link), a heading and
// "label: value" pairs in a definition list; a value that does not apply is left out.
test('B-142: the rows sit in one Health table, the labels never wrap, and the availability row ends it', () => {
  const render = live.slice(live.indexOf('window.renderHealth ='), live.indexOf('// Kaji bases (F-036)'));
  assert.match(render, /<div class='health-table'>" \+ table\.map\(healthRowHtml\)\.join\(""\) \+ "<\/div>"/);
  // F-152: the service sample and link rows left this list for the diagnostics table (expectation changed with them).
  assert.match(render, /concat\(availabilityRow \? \[availabilityRow\] : \[\]\)/);
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

// The Health card rendered from live.js with the doctor and update state it reads; the helpers it calls from
// elsewhere in live.js (model routes, updater status, degraded banner) are stubbed empty.
const renderHealthHtml = (/** @type {object} */ state) => {
  const code = live.slice(live.indexOf('  /** B-134: the Phone push line'), live.indexOf('  // Kaji bases (F-036)'));
  const el = { innerHTML: '' };
  new Function(
    'esc',
    'state',
    'document',
    'window',
    'routeRows',
    'updaterStatusHtml',
    'degradedBanner',
    code + ';window.renderHealth();',
  )(
    esc,
    state,
    { getElementById: () => el },
    {},
    () => [],
    () => '',
    () => '',
  );
  return el.innerHTML;
};
const doctor = { processes: { nervous: 1, brain: 2, brainAlive: true }, models: { roles: {} }, push: null };

// F-152 (owner, 2026-11-26): the automatic-update line repeated the settings panel (switch, mode, both hours).
test('F-152: Health has no automatic-update switch line; the last automatic attempt stays', () => {
  const out = renderHealthHtml({
    doctor,
    updatePolicy: {
      policy: { enabled: true, schedule: { mode: 'apply', checkHour: 21, applyHour: 4 } },
      lastAttempt: { outcome: 'completed', revision: 'c'.repeat(40), reasons: [] },
    },
  });
  assert.doesNotMatch(out, /chk-auto-update/);
  assert.doesNotMatch(out, /Automatic updates/);
  assert.match(out, /Last automatic attempt: completed · ccccccc/);
  assert.doesNotMatch(live, /chk-auto-update|liveSetAutoUpdate/, 'its handler went with it');
  assert.doesNotMatch(live, /checked at 20:00, applied at 03:00/, 'no hard-coded hours left');
});

test('F-152-T08: diagnostics are cards: one group per row with a heading and label: value pairs', () => {
  const hm = {
    latestSample: { rssBytes: 600 * 1048576, heapUsedBytes: 120 * 1048576, eventLoopDelayMs: 12, pollCount: 9 },
    links: [
      { peerId: 'NERV-02', bytesSent: 512, bytesReceived: 2048, lastLatencyMs: 38, inFlight: 1, reconnects: 2 },
      { peerId: 'NERV-03', bytesSent: 3 * 1048576, bytesReceived: 0, lastLatencyMs: null, inFlight: 0, reconnects: 0 },
    ],
    warnings: [{ key: 'link:NERV-02:reconnects', message: 'reconnects' }],
  };
  const out = diagnostics(hm);
  assert.doesNotMatch(out, /<table/, 'no table any more');
  const { document } = parseHTML('<div>' + out + '</div>');
  const box = /** @type {Element} */ (document.querySelector('.diag[role=group]'));
  assert.ok(box, 'one labelled group');
  assert.match(
    /** @type {Element} */ (document.getElementById(String(box.getAttribute('aria-labelledby')))).textContent,
    /Diagnostics/,
  );
  const card = (/** @type {string} */ sel) => {
    const c = /** @type {Element} */ (box.querySelector(sel));
    assert.ok(c, sel);
    const h = /** @type {Element} */ (c.querySelector('h2'));
    assert.equal(c.getAttribute('aria-labelledby'), h.id, sel + ' is named by its heading');
    return [
      h.textContent,
      ...[...c.querySelectorAll('dl > div')].map(
        (d) => d.querySelector('dt')?.textContent + ': ' + d.querySelector('dd')?.textContent,
      ),
    ];
  };
  assert.deepEqual(card('section#health-sample-row'), [
    'Service sample',
    'Status: ✓ ok · 9 polls',
    'Latency: loop 12 ms',
    'Memory: RSS 600.0 MB · heap 120.0 MB',
  ]);
  assert.deepEqual(card("section[data-link-peer='NERV-02']"), [
    'Link · NERV-02',
    'Status: ✗ warning',
    'Sent: 512 B',
    'Received: 2.0 KB',
    'Latency: 38 ms',
    'In flight: 1',
    'Reconnects: 2',
  ]);
  assert.deepEqual(card("section[data-link-peer='NERV-03']"), [
    'Link · NERV-03',
    'Status: ✓ ok',
    'Sent: 3.0 MB',
    'Received: 0 B',
    'Latency: not measured yet',
    'In flight: 0',
    'Reconnects: 0',
  ]);
  assert.equal(
    new Set([...box.querySelectorAll('[id]')].map((e) => e.id)).size,
    box.querySelectorAll('[id]').length,
    'unique ids',
  );
  assert.match(
    /** @type {Element} */ (box.querySelector("section[data-link-peer='NERV-02'] dd")).innerHTML,
    /class="warn">✗ warning/,
    'warning is text and colour',
  );
  const hostile = diagnostics({
    links: [{ peerId: "<b x='1'>", bytesSent: 0, bytesReceived: 0, inFlight: 0, reconnects: 0 }],
  });
  assert.doesNotMatch(hostile, /<b /, 'a peer id is escaped in the heading, the id and the attribute');
});

test('F-152-T08: empty diagnostics keep one readable card each', () => {
  const { document } = parseHTML('<div>' + diagnostics(null) + '</div>');
  const sample = /** @type {Element} */ (document.querySelector('section#health-sample-row'));
  assert.equal(/** @type {Element} */ (sample.querySelector('h2')).textContent, 'Service sample');
  assert.equal(/** @type {Element} */ (sample.querySelector('p')).textContent, '· No health samples yet.');
  const links = /** @type {Element} */ (document.querySelector('section#health-links-empty'));
  assert.equal(/** @type {Element} */ (links.querySelector('h2')).textContent, 'Links');
  assert.equal(/** @type {Element} */ (links.querySelector('p')).textContent, '· No peer link traffic recorded.');
});

test('F-152-T08: the cards wrap to the box at every width, styled with tokens only', () => {
  for (const sel of ['.diag', '.diag-card', '.diag-card dl > div'])
    assert.doesNotMatch(css(sel), /#[0-9a-f]{3,8}\b|rgb\(/i, sel + ': tokens only');
  assert.doesNotMatch(css('.diag-card dl > div'), /border-top/, 'F-152-T09: no line between the rows of a card');
  assert.doesNotMatch(html, /\.diag-wrap|overflow-x:auto; margin-top:6px/, 'no sideways-scrolling box');
  const render = live.slice(live.indexOf('window.renderHealth ='), live.indexOf('// Kaji bases (F-036)'));
  assert.match(render, /healthDiagnosticsHtml\(hm\)/, 'Health renders the cards');
});
