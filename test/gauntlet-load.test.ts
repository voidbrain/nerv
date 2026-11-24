// B-117: regressions for the load failures of nerv-system-flows/bases and nerv-system-flows/browser.
// 1. browser (test/angular.browser.mjs:894, 5 failed runs on 2026-11-23..24): clicking the checklist checkbox sets
//    input.checked=true synchronously while live.js sets input.disabled=true and sends POST /api/lists/toggle; waiting
//    only for checked===true returns before the POST finishes under load, so store.lists.show('shopping') still sees
//    done===false.
// 2. bases (test/worker-link-heartbeat.test.ts:331, failed 2026-11-23T19:03:54Z with coordinator kaji.main/kaji.seen
//    at 156 ms; test/worker-outbox.test.ts:188, failed 2026-11-24T06:51:41Z at its 15 s timeout below STARTUP_MS=30 s;
//    test/kaji-seats.test.ts:121, freePort() released ports before Runtime startup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STARTUP_MS } from '../src/process-client.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

test('B-117 (browser): angular.browser.mjs checklist wait holds while POST /api/lists/toggle is in flight under load', async () => {
  const source = readFileSync(new URL('./angular.browser.mjs', import.meta.url), 'utf8');
  // Extract the `await until(...)` expression immediately following the checklist `.click()` in test/angular.browser.mjs.
  const match =
    /data-checklist-toggle="\$\{milkItemId\}"\]'\)\?\.click\(\)`[\s\S]*?await until\(\s*`([^`]+)`\s*,?\s*\)/.exec(
      source,
    );
  assert.ok(match, 'Found checklist toggle wait expression in test/angular.browser.mjs');
  const milkItemId = 'item-milk-1';
  const expression = match[1]!.replaceAll('${milkItemId}', milkItemId);

  // Simulate the browser DOM and live.js change handler while POST /api/lists/toggle takes 120 ms under load.
  let storeDone = false;
  const checkbox = {
    checked: false,
    disabled: false,
    dataset: { checklistToggle: milkItemId, listId: 'list-shopping' },
  };
  const document = {
    querySelector(selector: string) {
      if (!selector.includes(`data-checklist-toggle="${milkItemId}"`)) return null;
      if (selector.includes(':not(:disabled)') && checkbox.disabled) return null;
      return checkbox;
    },
  };
  const evaluate = (expr: string) => Boolean(new Function('document', `return (${expr});`)(document));

  // live.js: clicking flips checked synchronously, change handler sets disabled=true during POST /api/lists/toggle.
  checkbox.checked = true;
  checkbox.disabled = true;
  const togglePost = (async () => {
    await new Promise((r) => setTimeout(r, 120));
    storeDone = true;
    checkbox.disabled = false;
  })();

  // Poll the exact wait expression from test/angular.browser.mjs as `until()` does.
  const deadline = Date.now() + 2000;
  while (!evaluate(expression)) {
    assert.ok(Date.now() < deadline, 'Checklist wait expression timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
  // When `until()` resolves, the store write from POST /api/lists/toggle must already have completed.
  assert.equal(storeDone, true, 'ticking dashboard chat checklist updates store before until() resolves');
  await togglePost;
});

test(
  'B-117 (bases): B-046 event-loop stall and busy-slot heartbeats survive 160 ms nervous-process IPC latency under load',
  { timeout: 60000 },
  () => {
    // Reproduces 2026-11-23T19-03-54.108Z-960236b2-959f-49bd-9a83-105b008d2a84.json:
    // "B-046 slow nervous calls: coordinator kaji.main 156ms at 34303 behind 1; coordinator kaji.seen 156ms at 34303 behind 2"
    const preload =
      'data:text/javascript,' +
      encodeURIComponent(`
        import { ProcessClient } from ${JSON.stringify(new URL('../src/process-client.ts', import.meta.url).href)};
        const orig = ProcessClient.prototype.call;
        ProcessClient.prototype.call = async function (method, params, timeoutMs) {
          if (method === 'kaji.seen' || method === 'kaji.main') {
            await new Promise((r) => setTimeout(r, 160));
          }
          return orig.call(this, method, params, timeoutMs);
        };
      `);
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        preload,
        '--test',
        '--test-isolation=none',
        '--test-reporter=tap',
        '--test-name-pattern=B-046: (a healthy session survives an event-loop stall|a link whose request slots are all busy)',
        'test/worker-link-heartbeat.test.ts',
      ],
      { cwd: root, env: childEnv, encoding: 'utf8', timeout: 55000 },
    );
    assert.equal(
      run.status,
      0,
      `worker-link-heartbeat failed under 160 ms nervous IPC load:\n${run.stdout}\n${run.stderr}`,
    );
  },
);

test('B-117 (bases): worker-outbox Runtime tests allow STARTUP_MS with idle-brain and kaji-seats holds reserved ports through Runtime startup', () => {
  const outboxSource = readFileSync(new URL('./worker-outbox.test.ts', import.meta.url), 'utf8');
  assert.ok(
    outboxSource.includes('idle-brain.ts'),
    'test/worker-outbox.test.ts must use idle-brain.ts so non-model outbox tests do not spawn brain-process.ts under load',
  );
  const timeouts = [...outboxSource.matchAll(/\{\s*timeout:\s*(\d+)\s*\}/g)].map((m) => Number(m[1]));
  assert.ok(timeouts.length >= 2, 'Found Runtime test timeouts in test/worker-outbox.test.ts');
  for (const ms of timeouts) {
    assert.ok(
      ms >= STARTUP_MS,
      `test/worker-outbox.test.ts timeout (${ms} ms) must be at least STARTUP_MS (${STARTUP_MS} ms)`,
    );
  }

  const seatsSource = readFileSync(new URL('./kaji-seats.test.ts', import.meta.url), 'utf8');
  assert.ok(
    !seatsSource.includes('const freePort ='),
    'test/kaji-seats.test.ts must hold reserved ports across Runtime startup instead of closing them in freePort()',
  );
});
