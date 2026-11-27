// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { loadDashboard, touched } from './fixtures/live-view.mjs';
import { Store } from '../src/store.ts';

// B-145: the sections that rewrote the most DOM on every poll (EVA heartbeat status, the questions strip, the flow
// and Misato's apartment) update only the values that changed, so Web Inspector keeps what the owner expanded.
const page = loadDashboard();
const { window, document, run } = page;
const text = (n) => (n.nodeType === 1 ? n : n.parentNode);
const id = (n) => text(n).closest('[id]')?.id;

for (const [name, root, render] of [
  ['questions strip', '.questions', 'renderQuestions()'],
  ["Misato's apartment", '#p-needs', 'renderNeeds()'],
  ['flow', '#p-flow', 'renderFlow()'],
  ['EVA heartbeat status', '#p-eva', 'drawHeartbeats(Date.now())'],
]) {
  test(`B-145: rendering the ${name} twice with the same state writes nothing`, async () => {
    const el = document.querySelector(root);
    assert.ok(el, root);
    run(render);
    const t = await touched(window, el, () => run(render));
    assert.deepEqual(
      { replaced: t.replaced.length, changed: t.changed.length, added: t.added.length, writes: t.writes },
      { replaced: 0, changed: 0, added: 0, writes: 0 },
    );
  });
}

test('B-145: one changed value in the questions strip changes only the nodes that show it', async () => {
  run('renderQuestions()');
  const t = await touched(window, document.querySelector('.questions'), () =>
    run('state.spentToday += 1; renderQuestions()'),
  );
  assert.equal(t.replaced.length, 0, 'no node replaced');
  assert.equal(t.added.length, 0, 'no node added');
  // Spent today, the forecast built on it and the strip's warning tint; every other node is untouched.
  assert.deepEqual(t.changed.map(id).sort(), ['q-budget', 'qd-budget', 'qv-budget']);
  assert.ok(
    t.changed.filter((n) => n.nodeType === 3).length === 2,
    'the text nodes keep their identity; only their data changes',
  );
});

test('B-145: one changed step in the flow changes only that node', async () => {
  run('renderFlow()');
  const t = await touched(window, document.querySelector('#p-flow'), () =>
    run(
      '{ const s = state.sorties.find(x => x.id === state.selected); if (s) { s.done.debrief = !s.done.debrief; } renderFlow(); }',
    ),
  );
  assert.equal(t.replaced.length, 0, 'no node replaced');
  assert.ok(t.changed.length <= 2, 'only the toggled step (and its time tag) changed: ' + t.changed.map(id));
});

test('B-145: patchHTML keeps unchanged and keyed rows as the same nodes', async () => {
  const box = document.createElement('div');
  document.body.appendChild(box);
  const rows = (items) => items.map((r) => `<div data-key='${r.id}'><b>${r.id}</b> <span>${r.v}</span></div>`).join('');
  run('patchHTML').call(
    null,
    box,
    rows([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 3 },
    ]),
  );
  const [a, b, c] = [...box.children];
  const t = await touched(window, box, () =>
    run('patchHTML').call(
      null,
      box,
      rows([
        { id: 'c', v: 3 },
        { id: 'a', v: 1 },
        { id: 'b', v: 5 },
      ]),
    ),
  );
  assert.deepEqual([...box.children], [c, a, b], 'rows moved, not rebuilt');
  assert.equal(t.replaced.length, 0);
  assert.deepEqual(
    t.changed.map((n) => n.data),
    ['5'],
    'only the changed value',
  );
  assert.equal(/** @type {Element} */ (box.querySelector('[data-key=b] span')).textContent, '5');
  run('patchHTML').call(null, box, rows([{ id: 'a', v: 1 }]));
  assert.deepEqual([...box.children], [a], 'removed rows go, kept rows stay');
  box.textContent = '';
  run('patchHTML').call(null, box, "<img data-av='x' alt=''/><details><summary>s</summary>t</details>");
  /** @type {Element} */ (box.querySelector('img')).setAttribute('src', 'filled-by-script.png');
  /** @type {Element} */ (box.querySelector('details')).setAttribute('open', '');
  run('patchHTML').call(null, box, "<img data-av='x' alt='y'/><details><summary>s</summary>t2</details>");
  assert.equal(
    /** @type {Element} */ (box.querySelector('img')).getAttribute('src'),
    'filled-by-script.png',
    'a script-set attribute stays',
  );
  assert.ok(/** @type {Element} */ (box.querySelector('details')).hasAttribute('open'), 'an open <details> stays open');
  assert.equal(/** @type {Element} */ (box.querySelector('img')).getAttribute('alt'), 'y');
});

test('B-145: setText and setAttr write only a changed value', async () => {
  const el = document.createElement('span');
  document.body.appendChild(el);
  run('setText').call(null, el, 'one');
  const node = el.firstChild;
  run('setAttr').call(null, el, 'class', 'ok');
  const t = await touched(window, el, () => {
    run('setText').call(null, el, 'one');
    run('setAttr').call(null, el, 'class', 'ok');
  });
  assert.equal(t.writes, 0);
  run('setText').call(null, el, 'two');
  assert.equal(el.firstChild, node, 'the same text node, new data');
  assert.equal(el.textContent, 'two');
});

test('B-145: the live questions strip (live.js) writes nothing when the state is unchanged', async () => {
  const { window: w, document: d } = parseHTML(
    '<html><body><div id="questions"><div id="q-needs"><b id="qv-needs"></b><i id="qd-needs"></i></div><div id="q-away"><b id="qv-away"></b><i id="qd-away"></i></div><div id="q-next"><b id="qv-next"></b><i id="qd-next"></i></div><div id="q-health"><b id="qv-health"></b><i id="qd-health"></i></div><div id="q-budget"><span data-l="qBudget"></span><b id="qv-budget"></b><i id="qd-budget"></i></div></div></body></html>',
  );
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  const code = live.slice(
    live.indexOf('  window.renderQuestions = function'),
    live.indexOf('\n  };\n', live.indexOf('  window.renderQuestions = function')) + 5,
  );
  const state = {
    approvals: [{ action: { tool: 'reminders.add' } }],
    sorties: [],
    lastVisit: 0,
    upcoming: [],
    doctor: { processes: { nervous: true, brainAlive: true }, degraded: [] },
  };
  const usage = { items: [1, 2] };
  const render = new Function(
    'document',
    'state',
    'setText',
    'usagePage',
    `const window={},usageError=false,usageView=()=>({heading:'test page'}),hhmm=String,degradedSummary=String;${code};return window.renderQuestions;`,
  )(d, state, run('setText'), usage);
  render();
  const t = await touched(w, d.querySelector('#questions'), render);
  assert.deepEqual(
    { replaced: t.replaced.length, changed: t.changed.length, writes: t.writes },
    { replaced: 0, changed: 0, writes: 0 },
  );
  state.approvals.push({ action: { tool: 'memory.add' } });
  const t2 = await touched(w, d.querySelector('#questions'), render);
  assert.deepEqual(t2.changed.map(id).sort(), ['qd-needs', 'qv-needs']);
  assert.equal(t2.replaced.length, 0);
});

// F-152: the base card shows phone push beside Telegram, for this base only (push is local to a base).
const liveSource = readFileSync('web/public/dashboard/live.js', 'utf8');
const dashSource = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
const apiState = dashSource.slice(
  dashSource.indexOf('function telegramApiState('),
  dashSource.indexOf('function drawTelegram', dashSource.indexOf('function telegramApiState(')),
);
/** @type {(b: object) => string} */
const cardLines = (b) =>
  new Function(
    'esc',
    'baseName',
    apiState +
      liveSource.slice(
        liveSource.indexOf('  /** F-152: the phone push line'),
        liveSource.indexOf('  window.renderBases ='),
      ) +
      ';return channelLine;',
  )(
    run('esc'),
    String,
  )(b);
const cardText = (/** @type {string} */ html) =>
  parseHTML('<div>' + html + '</div>')
    .document.toString()
    .replace(/<[^>]+>/g, '\n');
const at = '2030-01-02T09:00:00.000Z';

test('F-152: the base card shows phone push devices, the last push and its open time', () => {
  const html = cardLines({
    self: true,
    push: { devices: 2, last: { at, ok: true, status: 201, reason: null }, lastOpened: at },
  });
  const t = cardText(html);
  assert.match(t, /Telegram · state not reported/, 'the Telegram lines stay');
  assert.match(t, /Phone push · 2 devices/);
  assert.match(t, /Last push accepted · /);
  assert.match(t, /opened /);
  assert.ok(html.includes(new Date(at).toLocaleString()), 'times read as local date and time');
  assert.match(
    cardText(
      cardLines({
        self: true,
        push: { devices: 1, last: { at, ok: true, status: 201, reason: null }, lastOpened: null },
      }),
    ),
    /1 device[\s\S]*not opened yet/,
  );
  const failed = cardLines({
    self: true,
    push: { devices: 1, last: { at, ok: false, status: 403, reason: 'BadJwtToken' }, lastOpened: null },
  });
  assert.match(cardText(failed), /Last push failed \(403 BadJwtToken\)/, 'a failure is said in words, not only colour');
  assert.match(failed, /class='warn'/);
  assert.match(
    cardText(cardLines({ self: true, push: { devices: 1, last: null, lastOpened: null } })),
    /1 device[\s\S]*No push sent yet/,
  );
  assert.match(
    cardText(cardLines({ self: true, push: { devices: 0, last: null, lastOpened: null } })),
    /Phone push · no device subscribed/,
  );
  assert.match(cardText(cardLines({ self: true })), /Phone push · state not reported/);
  assert.doesNotMatch(
    cardLines({ self: false, push: { devices: 2, last: null, lastOpened: null } }),
    /Phone push/,
    'another base: push is local',
  );
  assert.doesNotMatch(html, /\b[BF]-\d+/, 'no backlog IDs in the text');
});

test('F-152: the push line reads the same in the plain and Eva voices', () => {
  const push = { devices: 1, last: { at, ok: true, status: 201, reason: null }, lastOpened: null };
  const lines = [];
  for (const theme of ['simple', 'eva']) {
    run(`state.theme = ${JSON.stringify(theme)}`);
    lines.push(cardLines({ self: true, push }));
  }
  run('state.theme = "eva"');
  assert.equal(lines[0], lines[1]);
  assert.doesNotMatch(lines[0], /Pen Pen|Kaji|Misato|EVA/, 'no Eva names in a line both voices share');
});

test('F-152: the store push status carries the last open time to the card', async () => {
  const store = new Store(':memory:');
  try {
    store.pushFetch = /** @type {typeof fetch} */ (async () => new Response('', { status: 201 }));
    store.savePushSubscription({
      endpoint: 'https://push.example.test/device-a',
      p256dh: 'BNeutralTestKey',
      auth: 'neutral-auth',
      deviceId: '0123456789abcdef',
    });
    assert.equal(store.pushHealth().lastOpened, null);
    store.add('Water the plants', '2030-01-01T10:00:00Z');
    store.tick(new Date('2030-01-01T10:01:00Z'));
    const id = store.inboxPage(0, 5).items[0].id;
    assert.ok(store.recordDelivery(id, 'push', 'opened'));
    const health = store.pushHealth();
    assert.match(String(health.lastOpened), /^\d{4}-\d\d-\d\dT/);
    const t = cardText(cardLines({ self: true, push: health }));
    assert.match(t, /Phone push · 1 device/);
    assert.match(
      t,
      new RegExp(
        'opened ' + new Date(String(health.lastOpened)).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    );
  } finally {
    store.close();
  }
});

// B-183: Health said "Phone push · 2 devices" beside one paired device: it counted every subscription, also one left
// by an earlier install of the app, from before subscriptions carried the device id.
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
/** @type {(p: object) => string[]} */
const pushRow = new Function(
  liveSource.slice(
    liveSource.indexOf('  /** B-134: the Phone push line'),
    liveSource.indexOf('  window.renderHealth = function'),
  ) + ';return pushRow;',
)();
const sub = (/** @type {string} */ name, /** @type {string} */ userAgent, /** @type {string} */ deviceId = '') => ({
  endpoint: 'https://push.example.test/' + name,
  p256dh: 'BNeutralTestKey',
  auth: 'neutral-auth',
  userAgent,
  ...(deviceId ? { deviceId } : {}),
});

test('B-183: the base card and Health count paired devices, and name unpaired subscriptions apart', () => {
  const store = new Store(':memory:');
  try {
    store.savePushSubscription(sub('earlier-install', iphone));
    store.savePushSubscription(sub('mac-browser', mac));
    store.savePushSubscription(sub('phone-app', iphone, '0123456789abcdef'));
    const health = store.pushHealth();
    assert.equal(health.devices, 1, 'one paired device, as Settings lists');
    const t = cardText(cardLines({ self: true, push: health }));
    assert.match(t, /Phone push · 1 device · 1 unpaired subscription\b/);
    assert.match(pushRow(health)[2], /^1 device · 1 unpaired subscription · no delivery yet/);
    assert.match(
      cardText(cardLines({ self: true, push: { devices: 0, unpaired: 2, last: null, lastOpened: null } })),
      /Phone push · 0 devices · 2 unpaired subscriptions/,
      'subscriptions without a paired device are still said, never "no device subscribed"',
    );
  } finally {
    store.close();
  }
});

test('B-183: a paired device that subscribes drops the unpaired subscriptions an earlier install left on that kind of device', () => {
  const store = new Store(':memory:');
  try {
    store.savePushSubscription(sub('earlier-install', iphone));
    store.savePushSubscription(sub('older-install', iphone.replace('18_7', '18_6')));
    store.savePushSubscription(sub('mac-browser', mac));
    assert.deepEqual(store.pushHealth().devices, 0);
    store.savePushSubscription(sub('phone-app', iphone, '0123456789abcdef'));
    assert.deepEqual(
      store
        .listPushSubscriptions()
        .map((s) => s.endpoint.split('/').pop())
        .sort(),
      ['mac-browser', 'phone-app'],
      'the iPhone leftovers go; the Mac browser, subscribed without pairing, stays',
    );
    assert.deepEqual(
      { devices: store.pushHealth().devices, unpaired: store.pushHealth().unpaired },
      { devices: 1, unpaired: 1 },
    );
  } finally {
    store.close();
  }
});

// F-152 (owner decision, 2026-11-27): the model reload moves from Health into a collapsed Advanced section of Settings.
const liveCode = readFileSync('web/public/dashboard/live.js', 'utf8');
const settingsHtml = (/** @type {object} */ state) => {
  const el = { innerHTML: '' };
  const code = liveCode.slice(
    liveCode.indexOf('  window.renderSettings ='),
    liveCode.indexOf('  function readSettingsDraft()'),
  );
  new Function('esc', 'state', 'document', 'window', 'settingsModel', code + ';window.renderSettings();')(
    run('esc'),
    state,
    { getElementById: () => el },
    {},
    () => ({
      enabled: false,
      mode: 'apply',
      checkHour: 20,
      applyHour: 3,
      quietFrom: 8,
      quietUntil: 23,
      briefEnabled: false,
      briefAt: '08:00',
      timeZone: 'Europe/Rome',
    }),
  );
  return el.innerHTML;
};

test('F-152: Settings has a collapsed Advanced section with the model reload, outside the settings form', () => {
  const out = settingsHtml({});
  const { document: d } = parseHTML('<div>' + out + '</div>');
  const adv = /** @type {Element} */ (d.querySelector('details#settings-advanced'));
  assert.ok(adv, 'an Advanced section');
  assert.equal(adv.hasAttribute('open'), false, 'collapsed by default');
  assert.equal(/** @type {Element} */ (adv.querySelector('summary')).textContent, 'Advanced');
  const btn = /** @type {Element} */ (adv.querySelector('button#btn-reload'));
  assert.equal(btn.getAttribute('type'), 'button');
  assert.equal(btn.textContent, 'Re-read the model settings from config.json');
  assert.equal(d.querySelector('#settings-form #btn-reload'), null, 'not a submit inside the form');
  assert.ok(adv.querySelector('#reload-status[role=status]'), 'the result shows next to the button');
  assert.doesNotMatch(out, /\b[BF]-\d{3}\b/, 'no backlog IDs in the text');
  const open = parseHTML(
    '<div>' +
      settingsHtml({ advancedOpen: true, reloadMsg: { kind: 'ok', text: 'Model settings re-read.' } }) +
      '</div>',
  ).document;
  assert.ok(
    /** @type {Element} */ (open.querySelector('#settings-advanced')).hasAttribute('open'),
    'stays open across polls',
  );
  assert.equal(/** @type {Element} */ (open.querySelector('#reload-status')).textContent, 'Model settings re-read.');
  const health = liveCode.slice(
    liveCode.indexOf('  window.renderHealth ='),
    liveCode.indexOf('  // Kaji bases (F-036)'),
  );
  assert.doesNotMatch(health, /btn-reload|Edited config\.json/, 'gone from Health');
});

test('F-152: the reload posts once per click and shows its result in plain words', async () => {
  const code = liveCode.slice(
    liveCode.indexOf('  window.liveReload ='),
    liveCode.indexOf('  window.liveApplyUpdate ='),
  );
  /** @param {(path: string, init: object) => Promise<object>} api */
  const reload = (api) => {
    const state = {};
    const calls = /** @type {string[]} */ ([]);
    const w = /** @type {{ liveReload: () => Promise<void> }} */ ({});
    new Function('state', 'window', 'api', 'log', 'poll', 'renderSettings', code)(
      state,
      w,
      (/** @type {string} */ p, /** @type {object} */ i) => (calls.push(p), api(p, i)),
      () => {},
      () => {},
      () => {},
    );
    return { state, calls, go: w.liveReload };
  };
  const ok = reload(async () => ({ models: { roles: {} } }));
  await Promise.all([ok.go(), ok.go()]);
  assert.deepEqual(ok.calls, ['models/reload'], 'a second click while it runs posts nothing');
  assert.deepEqual(ok.state.reloadMsg, { kind: 'ok', text: 'Model settings re-read from config.json.' });
  const bad = reload(async () => {
    throw new Error('invalid models section');
  });
  await bad.go();
  assert.deepEqual(bad.state.reloadMsg, {
    kind: 'danger',
    text: 'Not re-read: invalid models section. The previous settings stay in use.',
  });
});
