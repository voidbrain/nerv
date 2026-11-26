// @ts-check
// B-165: Gauntlet test runs must never write the tracked run ledger (evals/gauntlet/ledger.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseHash, executeWithEvidence } from '@voidbrain/gauntlet-protocol';
import { main, readSystemPackWithInputs, systemSourceKey } from '../tools/gauntlet.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const trackedLedger = join(root, 'evals/gauntlet/ledger.json');
const examples = join(root, 'node_modules/@voidbrain/gauntlet-protocol/examples');

// (a) The Gauntlet tests on a host too slow for the per-test limit, as the 2026-11-26 audit's loaded Mac was: a short
// --test-timeout leaves the long root-command test running after the runner moved on. The tracked ledger stays
// byte-identical, and no other Gauntlet test fails because of it (B-153).
test('B-165: the Gauntlet tests on a slow host leave the tracked ledger byte-identical', { timeout: 300_000 }, () => {
  const before = readFileSync(trackedLedger);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const name of Object.keys(env)) if (name.startsWith('NERV_GAUNTLET_')) delete env[name];
  const run = spawnSync(
    process.execPath,
    ['--test', '--test-timeout=10000', '--test-reporter=dot', 'test/gauntlet.test.mjs'],
    { cwd: root, env, encoding: 'utf8', timeout: 280_000 },
  );
  const after = readFileSync(trackedLedger);
  // Put the committed bytes back before asserting, so a failure never leaves a rewritten ledger to commit.
  if (!after.equals(before)) writeFileSync(trackedLedger, before);
  assert.ok(after.equals(before), 'test/gauntlet.test.mjs rewrote evals/gauntlet/ledger.json');
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

// The neutral smoke pack through `gauntlet all --execute` with a fixture runtime: every other common pack is excluded and
// NERV's system cases are already covered in the starting ledger. `onExecute` runs as each pack starts executing.
async function runSmoke(dir, ledger, onExecute = () => {}) {
  const consumption = join(dir, 'consumption.json');
  const shipped = readdirSync(examples)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(examples, f), 'utf8')))
    .filter((raw) => Array.isArray(raw?.cases))
    .map((raw) => raw.id);
  writeFileSync(
    consumption,
    JSON.stringify({
      schemaVersion: 1,
      exclude: Object.fromEntries(shipped.filter((id) => id !== 'neutral-smoke').map((id) => [id, 'not this test'])),
    }),
  );
  process.env.NERV_GAUNTLET_CONSUMPTION = consumption;
  process.env.NERV_GAUNTLET_LEDGER = ledger;
  const system = readSystemPackWithInputs().pack;
  writeFileSync(
    ledger,
    JSON.stringify({
      schemaVersion: 2,
      entries: system.cases.map((c) => ({
        pack: system.id,
        packVersion: system.version,
        case: c.id,
        caseHash: caseHash(c),
        profileHash: null,
        status: 'passed',
        reportHash: 'c'.repeat(64),
        finished: '2026-11-11T00:00:00.000Z',
        modelDigest: null,
        runtimeHash: 'a'.repeat(64),
        scenarioHash: null,
        sourceKey: systemSourceKey(system, c.id),
      })),
    }),
  );
  const model = 'gemma4:12b';
  let resident = false;
  const fetcher = async (url) => {
    const path = new URL(String(url)).pathname;
    let value;
    if (path === '/api/version') value = { version: 'neutral-test-runtime' };
    else if (path === '/api/show') value = { details: { quantization_level: 'Q4_K_M' }, capabilities: ['thinking'] };
    else if (path === '/api/tags') value = { models: [{ name: model, size: 100, digest: 'a'.repeat(64) }] };
    else if (path === '/api/ps') value = { models: resident ? [{ name: model, size_vram: 128 }] : [] };
    else if (path === '/api/generate') {
      resident = false;
      value = { done: true, done_reason: 'unload' };
    } else if (path === '/api/chat') {
      resident = true;
      const done = { model, message: { content: '' }, done: true, eval_count: 3, prompt_eval_count: 10 };
      return new Response(
        [{ model, message: { content: '{}' }, done: false }, done].map((x) => JSON.stringify(x)).join('\n') + '\n',
      );
    } else throw Error('Unexpected fixture endpoint');
    return new Response(JSON.stringify(value));
  };
  const services = {
    execute: async (pack, profile, limits, options) => {
      onExecute();
      return executeWithEvidence(pack, profile, limits, {
        ...options,
        fetch: fetcher,
        environmentKey: 'neutral-nerv-ledger-fixture',
      });
    },
  };
  const reports = join(dir, 'reports');
  const result = await main(
    [
      'all',
      '--profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json',
      '--allow-models',
      '--execute',
      '--out-dir=' + reports,
      '--cache-dir=' + join(dir, 'cache'),
    ],
    services,
  );
  return { result: /** @type {any} */ (result), reports };
}

function withGauntletEnvironment(prefix, body) {
  return async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix));
    const saved = Object.fromEntries(
      ['NERV_GAUNTLET_LEDGER', 'NERV_GAUNTLET_CONSUMPTION'].map((name) => [name, process.env[name]]),
    );
    try {
      await body(dir);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

// (b) The race itself: another test changes NERV_GAUNTLET_LEDGER while `gauntlet all --execute` is between reading its
// ledger and writing it. The run keeps writing the ledger it started with.
test(
  'B-165: gauntlet all writes the ledger it started with when NERV_GAUNTLET_LEDGER changes mid-run',
  withGauntletEnvironment('nerv-gauntlet-ledger-race-', async (dir) => {
    const ledger = join(dir, 'ledger.json');
    const decoy = join(dir, 'decoy-ledger.json');
    let runs = 0;
    // What another test's `finally` does to the shared process environment while this run is in flight.
    const { result } = await runSmoke(dir, ledger, () => {
      runs++;
      process.env.NERV_GAUNTLET_LEDGER = decoy;
    });
    assert.equal(runs, 1);
    assert.deepEqual(
      result.results.map((r) => [r.pack, r.cases.length]),
      [['neutral-smoke', 10]],
    );
    assert.equal(existsSync(decoy), false, 'the run wrote the ledger the environment named after it started');
    const written = JSON.parse(readFileSync(ledger, 'utf8')).entries;
    assert.equal(written.filter((e) => e.pack === 'neutral-smoke').length, 10);
  }),
);

// The last line of defence: under the test runner no Gauntlet command writes the tracked ledger, whatever the
// environment names.
test(
  'B-165: under the test runner, recording to the tracked ledger is refused',
  withGauntletEnvironment('nerv-gauntlet-ledger-guard-', async (dir) => {
    const { reports } = await runSmoke(dir, join(dir, 'ledger.json'));
    const before = readFileSync(trackedLedger);
    process.env.NERV_GAUNTLET_LEDGER = trackedLedger;
    let failure;
    try {
      await main(['ledger', '--report=' + join(reports, 'neutral-smoke.json'), '--pack=neutral-smoke']);
    } catch (error) {
      failure = error;
    }
    const after = readFileSync(trackedLedger);
    if (!after.equals(before)) writeFileSync(trackedLedger, before);
    assert.ok(after.equals(before), 'a Gauntlet command under the test runner rewrote evals/gauntlet/ledger.json');
    assert.match(String(failure?.message), /tracked Gauntlet ledger/);
  }),
);
