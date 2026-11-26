// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { loadDashboard, touched } from './fixtures/live-view.mjs';

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
