import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
const source = readFileSync('web/public/dashboard/live.js', 'utf8');
test('each pilot card owns an independent labelled model selector, drafts survive redraws and missing models stay explicit', () => {
  const { document } = parseHTML('<html><body><div id="melons"></div></body></html>');
  const roster = [
    {
      id: 'printer',
      name: 'Print Master',
      domain: 'printing',
      keywords: ['filament'],
      model: 'first',
      stage: 'prototype',
    },
    { id: 'artist', name: 'Artist', domain: 'images', keywords: ['photo'], model: 'second', stage: 'prototype' },
  ];
  const drafts = new Map();
  const models = {
    models: { roles: { consultant: { model: 'first' } } },
    ollama: { models: [{ name: 'first' }, { name: 'second' }] },
  };
  const code = source.slice(
    source.indexOf('  window.renderMelons ='),
    source.indexOf('  document.addEventListener("change", e => {', source.indexOf('  window.renderMelons =')),
  );
  const esc = (s) =>
    String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  const render = new Function(
    'document',
    'state',
    'modelsData',
    'pilotDrafts',
    'esc',
    `const window={},pilotBusy=new Set(),PLANNED='planned',stageTabs=()=>'',currentTab=()=> 'prototype',thinkingFor=()=>[];${code};return window.renderMelons;`,
  )(document, { pilots: roster }, models, drafts, esc);
  render();
  assert.equal(document.querySelectorAll('.card').length, 3);
  assert.equal(document.querySelectorAll('.card form').length, 3);
  const selected = (id) =>
    document
      .getElementById('pilot-model-' + id)
      .querySelector('option[selected]')
      .getAttribute('value');
  assert.equal(selected('generic'), 'first');
  assert.equal(selected('printer'), 'first');
  assert.equal(selected('artist'), 'second');
  assert.ok(
    [...document.querySelectorAll('.pilot-model-form button')].every((b) => b.disabled),
    'unchanged cards cannot apply',
  );
  assert.equal(document.querySelector('label[for="pilot-model-generic"]').textContent, 'Model');
  assert.equal(document.querySelector('label[for="pilot-model-printer"]').textContent, 'Model');
  assert.equal(document.getElementById('pilot-model-printer').getAttribute('aria-label'), 'Model for Print Master');
  drafts.set('printer', 'second');
  render();
  assert.equal(selected('printer'), 'second');
  assert.equal(selected('artist'), 'second');
  assert.equal(document.querySelector('[data-pilot=printer] button').disabled, false);
  assert.equal(document.querySelector('[data-pilot=artist] button').disabled, true);
  drafts.set('printer', 'first');
  render();
  assert.equal(
    document.querySelector('[data-pilot=printer] button').disabled,
    true,
    'returning to the saved value disables Apply',
  );
  drafts.clear();
  roster[0].model = 'not installed';
  render();
  assert.match(document.querySelector('#pilot-model-printer option[selected]').textContent, /unavailable locally/);
  assert.ok(document.querySelector('#pilot-model-printer option[selected]').hasAttribute('disabled'));
  assert.equal(
    document.querySelector('#pilot-model-printer option[value="off"]'),
    null,
    'only the generic fallback can be switched off',
  );
  assert.ok(
    !source
      .slice(source.indexOf('  window.renderModels ='), source.indexOf('  const applyModels ='))
      .includes('m-consultant'),
    'Models panel keeps only role controls',
  );
});

test('F-109-T03: specialist card exposes call name, second name, model and one Apply for combined save', async () => {
  const { document } = parseHTML('<html><body><div id="melons"></div></body></html>');
  const roster = [
    {
      id: 'printer',
      name: 'Unit Zero',
      secondName: 'Aria Vance',
      domain: 'printing',
      keywords: ['filament'],
      model: 'first',
      stage: 'prototype',
    },
  ];
  const drafts = new Map();
  const models = {
    models: { roles: { consultant: { model: 'first' } } },
    ollama: { models: [{ name: 'first' }, { name: 'second' }] },
  };
  const listeners = new Map();
  const docProxy = new Proxy(document, {
    get(target, prop) {
      if (prop === 'addEventListener') {
        return (type, fn) => {
          if (!listeners.has(type)) listeners.set(type, []);
          listeners.get(type).push(fn);
        };
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
  const apiCalls = [];
  const start = source.indexOf('  window.renderMelons =');
  const end = source.indexOf('  // While you were away:', start);
  const code = source.slice(start, end);
  const esc = (s) =>
    String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  const render = new Function(
    'document',
    'state',
    'modelsData',
    'pilotDrafts',
    'esc',
    'api',
    'loadModels',
    'log',
    `const window={},pilotBusy=new Set(),PLANNED='planned',stageTabs=()=>'',currentTab=()=> 'prototype',thinkingFor=()=>[];${code};return window.renderMelons;`,
  )(
    docProxy,
    { pilots: roster },
    models,
    drafts,
    esc,
    async (path, opts) => {
      apiCalls.push({ path, method: opts.method, body: JSON.parse(opts.body) });
      return {
        pilots: [{ ...roster[0], ...JSON.parse(opts.body) }],
      };
    },
    async () => {},
    () => {},
  );
  render();
  const form = document.querySelector('[data-pilot="printer"]');
  assert.ok(form);
  assert.equal(document.querySelectorAll('[data-pilot="printer"] button[type="submit"]').length, 1);
  const nameInput = document.getElementById('pilot-name-printer');
  const secondInput = document.getElementById('pilot-second-printer');
  const modelSelect = document.getElementById('pilot-model-printer');
  const applyBtn = form.querySelector('button[type="submit"]');
  assert.equal(nameInput.value, 'Unit Zero');
  assert.equal(secondInput.value, 'Aria Vance');
  assert.equal(applyBtn.disabled, true);

  nameInput.value = 'Unit One';
  secondInput.value = 'Kai Lin';
  modelSelect.options[0].selected = false;
  modelSelect.options[1].selected = true;
  for (const fn of listeners.get('input') ?? []) fn({ target: nameInput });
  for (const fn of listeners.get('change') ?? []) fn({ target: modelSelect });
  assert.equal(applyBtn.disabled, false);

  for (const fn of listeners.get('submit') ?? []) {
    await fn({ target: form, preventDefault() {} });
  }
  assert.deepEqual(apiCalls, [
    {
      path: 'pilots/printer',
      method: 'PATCH',
      body: { name: 'Unit One', secondName: 'Kai Lin', model: 'second' },
    },
  ]);
  assert.equal(document.getElementById('pilot-name-printer').value, 'Unit One');
  assert.equal(document.getElementById('pilot-second-printer').value, 'Kai Lin');
});
