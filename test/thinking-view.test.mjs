// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDashboard } from './fixtures/live-view.mjs';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';

// F-148-T04: the thinking pilot on the dashboard. The entries come from GET /api/thinking on a real server; the page is
// the dashboard (dashboard.js) in linkedom with a frozen clock, and live.js reads the endpoint on every feed refresh.
const NOW = Date.UTC(2030, 0, 2, 9, 0, 0);

/** The endpoint's answer for a store that thinks `entries` (the service side is covered in test/thinking.test.ts). */
async function fromEndpoint(entries) {
  const store = new Store(':memory:');
  Object.assign(store, { thinking: async () => entries });
  const token = 'v'.repeat(32);
  const server = makeServer(/** @type {never} */ (store), token);
  await new Promise((d) => server.listen(0, '127.0.0.1', () => d(undefined)));
  try {
    const address = /** @type {{ port: number }} */ (server.address());
    const res = await fetch(`http://127.0.0.1:${address.port}/api/thinking`, {
      headers: { authorization: 'Bearer ' + token },
    });
    return (await res.json()).thinking;
  } finally {
    await new Promise((d) => server.close(() => d(undefined)));
    store.close();
  }
}

const consultant = {
  id: 't1',
  pilot: 'Generic pilot',
  role: 'consultant',
  model: 'gemma4:26b',
  sortieId: '19ee0000-0000-4000-8000-000000000000',
  startedAt: new Date(NOW - 12_000).toISOString(),
};
const planner = {
  ...consultant,
  id: 't2',
  pilot: 'Misato',
  role: 'planner',
  model: 'qwen3:8b',
  startedAt: new Date(NOW - 75_000).toISOString(),
};

test('F-148-T04: a thinking consultant shows in the Pilots panel and on its sortie, with the time it has thought', async () => {
  const { document, run } = loadDashboard(NOW);
  run('renderAll()');
  const cages = document.getElementById('cages-sub')?.textContent;
  const box = document.getElementById('thinking-now');
  assert.ok(box, 'the Pilots panel has a thinking strip');
  assert.equal(box.getAttribute('aria-live'), 'polite');
  assert.ok(box.hidden, 'nothing thinks: nothing extra shows');
  const entries = await fromEndpoint([consultant, planner]);
  run('state.sorties[0].realId = "' + consultant.sortieId + '"');
  run('state.thinking = ' + JSON.stringify(entries) + '; renderAll()');
  assert.equal(box.hidden, false);
  const text = box.textContent.replace(/\s+/g, ' ');
  assert.match(text, /Generic pilot · Consultant \(gemma4:26b\) · S-19EE · thinking 12 s/);
  assert.match(text, /Misato · Planner \(qwen3:8b\) · S-19EE · thinking 1 min 15 s/);
  const sortie = document.querySelector('#sortie-list .card')?.textContent ?? '';
  assert.match(sortie, /Consultant \(gemma4:26b\) · thinking 12 s/, 'the sortie uses the wording of its Comms line');
  assert.equal(document.getElementById('cages-sub')?.textContent, cages, 'a thinking pilot is never an active EVA');
  assert.doesNotMatch(box.textContent, /\b[FBT]-\d{3}/, 'no backlog IDs');
  // The plain voice names the role, not the codename.
  run('state.theme = "simple"; renderAll()');
  assert.match(box.textContent.replace(/\s+/g, ' '), /Planner \(qwen3:8b\) · S-19EE · thinking 1 min 15 s/);
  assert.doesNotMatch(box.textContent, /Misato/);
  // The end: the next refresh brings an empty list and the marks go.
  run('state.thinking = ' + JSON.stringify(await fromEndpoint([])) + '; renderAll()');
  assert.ok(box.hidden);
  assert.doesNotMatch(document.querySelector('#sortie-list .card')?.textContent ?? '', /thinking/);
  assert.equal(document.getElementById('cages-sub')?.textContent, cages);
});

test('F-148-T04: one client timer runs only while something thinks, with no request per tick', () => {
  const { run } = loadDashboard(NOW);
  run(
    'var started = 0, stopped = 0; setInterval = (fn) => (fn === thinkingTick ? (started++, "thinking") : 1); clearInterval = (id) => { if (id === "thinking") stopped++; };',
  );
  run('state.thinking = ' + JSON.stringify([consultant]) + '; renderAll(); renderAll()');
  assert.equal(run('started'), 1, 'one timer, however often the page renders');
  run('state.thinking = []; renderAll()');
  assert.equal(run('stopped'), 1, 'stopped when nothing thinks');
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  assert.match(live, /api\("thinking"\)/, 'live.js reads the endpoint with the other reads of a refresh');
  assert.equal(run('thinkingTick.toString()').includes('api('), false, 'the tick only rewrites the shown times');
});

test('F-148-T04: a card is marked for its own pilot, and a consultant not in the roster marks the generic pilot', () => {
  const { run } = loadDashboard(NOW);
  run(
    'state.thinking = ' +
      JSON.stringify([
        { ...consultant, pilot: 'Ada' },
        { ...consultant, id: 't3', pilot: 'Nobody' },
      ]),
  );
  assert.equal(run('thinkingFor("Ada", ["Ada"]).length'), 1);
  assert.equal(run('thinkingFor(null, ["Ada"]).length'), 1, 'the generic card shows the pilot no roster names');
  assert.equal(run('thinkingFor("Bea", ["Ada", "Bea"]).length'), 0);
});
