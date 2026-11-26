// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const source = readFileSync('web/public/dashboard/live.js', 'utf8');
const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** The Models panel code from live.js, run against a parsed page with the API replaced by a recorder. */
function panel(modelsData) {
  const { document, window } = parseHTML(
    '<html><body><span id="models-sub"></span><div id="models"></div></body></html>',
  );
  const listeners = new Map();
  const doc = new Proxy(document, {
    get(target, prop) {
      if (prop === 'addEventListener') return (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
  const calls = [];
  const start = source.indexOf('  window.renderModels =');
  const code = source.slice(start, source.indexOf('  // Real actions instead of simulated ones.', start));
  const run = new Function(
    'document',
    'window',
    'modelsData',
    'esc',
    'api',
    'log',
    'loadModels',
    'poll',
    'renderModels',
    `let modelsDraft = false, modelsBusy = false;\n${code}\nreturn window.renderModels;`,
  );
  const render = run(
    doc,
    window,
    modelsData,
    esc,
    async (path, init) => {
      calls.push({ path, method: init?.method, body: JSON.parse(init?.body ?? 'null') });
      return { models: { roles: {} } };
    },
    () => {},
    async () => {},
    () => {},
    () => render(),
  );
  render();
  const submit = () => {
    const form = document.getElementById('models-form');
    for (const fn of listeners.get('submit') ?? []) fn({ target: form, preventDefault() {} });
  };
  return { document, calls, submit };
}
const data = (local) => ({
  models: {
    local: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'gemma', ...local },
    roles: { misato: { route: 'local', model: 'gemma' }, casper: { model: 'gemma' } },
  },
  ollama: { reachable: true, url: 'http://127.0.0.1:11434', models: [{ name: 'gemma' }] },
  cloudKey: false,
});
/** The element the selector names, which must exist. */
const pick = (root, selector) => {
  const el = root.querySelector(selector);
  assert.ok(el, selector);
  return el;
};
/** Selects one option of the Keep loaded control, as the owner would. */
const choose = (document, value) => {
  pick(document, '#m-warm option[selected]').removeAttribute('selected');
  pick(document, `#m-warm option[value="${value}"]`).setAttribute('selected', '');
};

test('F-144: the Models panel picks how long the local model stays loaded, or always, with a memory note', () => {
  const { document, calls, submit } = panel(data({ keepAlive: '2h' }));
  const select = pick(document, '#m-warm');
  assert.equal(pick(document, 'label[for="m-warm"]').textContent, 'Keep loaded');
  assert.equal(pick(select, 'option[selected]').getAttribute('value'), '2h');
  assert.deepEqual(
    [...select.querySelectorAll('option')].map((o) => o.getAttribute('value')),
    ['15m', '30m', '1h', '2h', '4h', '8h', '24h', 'always'],
  );
  assert.match(pick(document, '#models').textContent, /Always keeps the model in memory/);
  choose(document, 'always');
  submit();
  assert.deepEqual(calls, [{ path: 'models', method: 'PUT', body: { warm: { alwaysLoaded: true } } }]);
});

test('F-144: from always loaded back to a duration; a duration set by hand stays selectable; no local route, no control', () => {
  const always = panel(data({ keepAlive: '45m', alwaysLoaded: true }));
  assert.equal(pick(always.document, '#m-warm option[selected]').getAttribute('value'), 'always');
  pick(always.document, '#m-warm option[value="45m"]');
  choose(always.document, '30m');
  always.submit();
  assert.deepEqual(always.calls[0].body, { warm: { keepAlive: '30m', alwaysLoaded: false } });

  const fresh = panel(data({}));
  assert.equal(pick(fresh.document, '#m-warm option[selected]').getAttribute('value'), '30m', 'the default');
  fresh.submit();
  assert.deepEqual(fresh.calls, [], 'nothing changed, nothing sent');

  const none = panel({
    models: {},
    ollama: { reachable: true, url: 'x', models: [{ name: 'gemma' }] },
    cloudKey: false,
  });
  assert.equal(none.document.getElementById('m-warm'), null);
});
