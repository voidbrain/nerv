import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync, spawn } from 'node:child_process';
import {
  validatePack,
  validateRegistry,
  validateLimits,
  run,
  validateReport,
  assess,
  hash,
} from '@voidbrain/gauntlet-protocol';
import { normalize } from '../tools/gauntlet-adapter.mjs';
import { main } from '../tools/gauntlet.mjs';
import { readSuite } from '../tools/evaluate.mjs';
const suite = readSuite();
function native(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: 'scripted-control-flow',
    suite: suite.id,
    sourceStable: true,
    complete: false,
    selection: { groups: ['policy'], notRunGroups: suite.groups.filter((g) => g.id !== 'policy').map((g) => g.id) },
    revision: { inputs: { 'src/policy.ts': 'neutral-fixture' } },
    results: [
      {
        id: 'policy',
        iteration: 1,
        status: 'passed',
        exitCode: 0,
        error: null,
        counts: { tests: 90, passed: 90, failed: 0, skipped: 0 },
      },
    ],
    ...overrides,
  };
}
test('NERV owns seven group adapters and keeps costly groups explicit', async () => {
  const pack = validatePack(JSON.parse(readFileSync('evals/gauntlet/system-v1.json', 'utf8')));
  assert.deepEqual(
    pack.cases.map((c) => c.id),
    suite.groups.map((g) => g.id),
  );
  const registry = validateRegistry(
    JSON.parse(readFileSync('evals/gauntlet/runners.json', 'utf8')),
    resolve('evals/gauntlet'),
  );
  for (const c of pack.cases) {
    assert.equal(c.layer, 'system');
    assert.equal(registry.runners[c.runner].allowModels, false);
  }
  const plan = await main(['plan']);
  assert.equal(plan.modelCallsAuthorized, false);
  assert.equal(plan.cases.find((c) => c.id === 'stress').eligible, false);
  assert.equal(plan.cases.find((c) => c.id === 'browser').eligible, false);
  await assert.rejects(main(['run', '--only=policy', '--out=/private/tmp/never-gauntlet.json']));
  await assert.rejects(main(['plan', '--only=unknown']));
});
test('selected native group completeness differs from full-suite coverage', () => {
  const evidence = normalize(native(), 'policy');
  assert.equal(evidence.complete, true);
  assert.equal(evidence.results[0].status, 'passed');
  assert.equal(evidence.results[0].checks, 90);
  assert.equal(evidence.fixtureHash.length, 64);
  assert.throws(() => normalize(native({ selection: { groups: ['ledger'] } }), 'policy'));
  assert.throws(() => normalize(native({ results: [] }), 'policy'));
  assert.equal(normalize(native({ sourceStable: false }), 'policy').results[0].status, 'failed');
  const failed = native();
  failed.results[0].counts.failed = 1;
  failed.results[0].counts.passed = 89;
  assert.equal(normalize(failed, 'policy').results[0].status, 'failed');
  const skipped = native();
  skipped.results[0].counts.skipped = 1;
  skipped.results[0].counts.passed = 89;
  assert.equal(normalize(skipped, 'policy').complete, false);
});
test('Gauntlet package consumes actual NERV normalization across its registered process boundary', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-gauntlet-'));
  try {
    const evidence = normalize(native(), 'policy');
    const input = join(root, 'native-normalized.json');
    writeFileSync(input, JSON.stringify(evidence));
    const fixture = join(root, 'copy.mjs');
    writeFileSync(fixture, "import {copyFileSync} from 'node:fs';copyFileSync(process.argv[2],process.argv[3]);");
    const pack = validatePack({
      schemaVersion: 1,
      id: 'nerv-normalization-fixture',
      version: '1.0.0',
      cases: [
        {
          id: 'policy',
          runner: 'normalized',
          layer: 'system',
          split: 'regression',
          capabilities: ['effects'],
          critical: true,
          expensive: false,
        },
      ],
    });
    const registry = validateRegistry(
      {
        schemaVersion: 1,
        runners: {
          normalized: {
            command: 'node',
            args: [fixture, input, '{report}'],
            cwd: root,
            layers: ['system'],
            allowModels: false,
          },
        },
      },
      root,
    );
    const limits = validateLimits(JSON.parse(readFileSync('evals/gauntlet/limits.json', 'utf8')));
    const report = await run(pack, null, limits, { execute: true, registry });
    validateReport(report);
    if (process.platform === 'win32') {
      assert.equal(report.results[0].status, 'error');
      assert.equal(report.passed, false);
    } else {
      assert.equal(report.passed, true);
      assert.equal(report.results[0].adapterHash, hash(evidence));
    }
    assert.equal(
      assess(report, { capabilities: ['effects'], minimumCases: 1, minimumHoldout: 1, minimumPassRate: 1 }).eligible,
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('NERV CLI default is a non-executing plan and model execution needs separate opt-in', () => {
  const cli = spawnSync(process.execPath, ['tools/gauntlet.mjs'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).promotion, false);
  const output = join(realpathSync(tmpdir()), 'nerv-gauntlet-no-execute-' + process.pid + '.json');
  const result = spawnSync(process.execPath, ['tools/gauntlet.mjs', 'run', '--out=' + output], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(existsSync(output), false);
});

test(
  'owner cancellation reaches inherited native runner and its descendants',
  { skip: process.platform === 'win32', timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-gauntlet-cancel-')),
      pids = join(root, 'pids.json'),
      output = join(root, 'report.json');
    let owned = [];
    const nativeScript =
      "const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(" +
      JSON.stringify(pids) +
      ',JSON.stringify([process.ppid,process.pid,child.pid]));setInterval(()=>{},1000);';
    const adapter = join(root, 'adapter.mjs');
    writeFileSync(
      adapter,
      'import {runProcess} from ' +
        JSON.stringify(pathToFileURL(resolve('tools/evaluate.mjs')).href) +
        ";await runProcess(['-e'," +
        JSON.stringify(nativeScript) +
        '],{timeoutMs:30000,supervised:true});',
    );
    const config = {
      schemaVersion: 1,
      runners: { native: { command: 'node', args: [adapter], cwd: root, layers: ['system'], allowModels: false } },
    };
    const cases = ['active', 'later'].map((id) => ({
      id,
      runner: 'native',
      layer: 'system',
      split: 'regression',
      capabilities: ['fixture'],
      critical: true,
      expensive: false,
    }));
    const owner = join(root, 'owner.mjs');
    writeFileSync(
      owner,
      'import {run,defaults,validateRegistry} from ' +
        JSON.stringify(pathToFileURL(resolve('node_modules/@voidbrain/gauntlet-protocol/dist/index.js')).href) +
        ";import {writeFileSync} from 'node:fs';const report=await run(" +
        JSON.stringify({ schemaVersion: 1, id: 'native-supervision', version: '1.0.0', cases }) +
        ',null,{...defaults,caseMs:30000},{execute:true,registry:validateRegistry(' +
        JSON.stringify(config) +
        ',' +
        JSON.stringify(root) +
        ')});writeFileSync(' +
        JSON.stringify(output) +
        ',JSON.stringify(report));',
    );
    const child = spawn(process.execPath, [owner], { stdio: 'ignore' });
    const closed = new Promise((done) => child.once('close', done));
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return (
          process.platform !== 'linux' ||
          !readFileSync('/proc/' + pid + '/stat', 'utf8')
            .split(') ')[1]
            .startsWith('Z')
        );
      } catch (e) {
        if (['ESRCH', 'ENOENT'].includes(e.code)) return false;
        throw e;
      }
    };
    try {
      const until = Date.now() + 5000;
      while (!existsSync(pids) && Date.now() < until) await delay(10);
      assert.equal(existsSync(pids), true);
      owned = JSON.parse(readFileSync(pids, 'utf8'));
      child.kill('SIGTERM');
      await Promise.race([
        closed,
        delay(5000, {}, { ref: false }).then(() => {
          throw Error('Owner failed to cancel');
        }),
      ]);
      const reap = Date.now() + 3000;
      while (owned.some(alive) && Date.now() < reap) await delay(10);
      assert.deepEqual(owned.filter(alive), []);
      const report = JSON.parse(readFileSync(output, 'utf8'));
      assert.equal(report.results[1].status, 'not-run');
      assert.equal(report.complete, false);
    } finally {
      child.kill('SIGTERM');
      if (owned.some(alive))
        try {
          process.kill(-owned[0], 'SIGKILL');
        } catch {}
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('pinned Gauntlet artifact matches reviewed source provenance and installed version', () => {
  const manifest = JSON.parse(readFileSync('vendor/gauntlet-protocol.json', 'utf8'));
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(
    manifest.sha256,
    createHash('sha256')
      .update(readFileSync(join('vendor', manifest.artifact)))
      .digest('hex'),
  );
  const installed = JSON.parse(readFileSync('node_modules/@voidbrain/gauntlet-protocol/package.json', 'utf8'));
  assert.equal(installed.version, manifest.version);
  assert.equal(installed.name, manifest.name);
});
test('generated index joins common model cases and NERV system cases with truthful area coverage', async () => {
  const { testIndex } = await import('../tools/gauntlet.mjs');
  const current = readFileSync('docs/test-capability-index.md', 'utf8');
  assert.equal(current, testIndex());
  assert.match(current, /neutral-smoke@1\.1\.0 \/ exact-json/);
  assert.match(current, /nerv-system-flows@1\.2\.0 \/ policy/);
  assert.match(current, /math: 0 mapped cases/);
  assert.equal((await main(['index', '--check'])).indexCurrent, true);
});
test('NERV model command reuses common exact evidence without repeating generation or pretending telemetry is fresh', async () => {
  const { executeWithEvidence, readEvidence } = await import('@voidbrain/gauntlet-protocol');
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-model-cache-'));
  try {
    const pack = JSON.parse(readFileSync('node_modules/@voidbrain/gauntlet-protocol/examples/smoke-v1.json', 'utf8'));
    let calls = 0,
      resident = false;
    const model = 'gemma4:12b';
    const fetcher = async (url, init) => {
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
        const body = JSON.parse(init.body);
        assert.equal(Object.hasOwn(body, 'expected'), false);
        assert.equal(body.options.num_ctx, 8192);
        assert.equal(body.options.seed, 42);
        assert.equal(body.think, true);
        const answer = JSON.stringify(pack.cases[calls++].expected.value);
        resident = true;
        return new Response(
          [
            { model, message: { content: answer }, done: false },
            {
              model,
              message: { content: '' },
              done: true,
              eval_count: 3,
              prompt_eval_count: 10,
              load_duration: 1000000,
              prompt_eval_duration: 1000000,
              eval_duration: 1000000,
              total_duration: 3000000,
            },
          ]
            .map((x) => JSON.stringify(x))
            .join('\n') + '\n',
        );
      } else throw Error('Unexpected fixture endpoint');
      return new Response(JSON.stringify(value));
    };
    const services = {
      execute: (pack, profile, limits, options) => {
        assert.equal(options.sourceKey, undefined, 'Common model evidence has no NERV source dependency');
        assert.equal(options.telemetry, true);
        return executeWithEvidence(pack, profile, limits, {
          ...options,
          fetch: fetcher,
          environmentKey: 'neutral-nerv-cache-fixture',
        });
      },
    };
    const args = [
      'model-run',
      '--profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json',
      '--execute',
      '--allow-models',
      '--cache-dir=' + join(root, 'cache'),
    ];
    const first = await main([...args, '--out=' + join(root, 'one.json')], services);
    assert.equal(first.passed, true);
    assert.equal(first.kind, 'executed');
    assert.equal(calls, 10);
    const second = await main([...args, '--out=' + join(root, 'two.json')], services);
    assert.equal(second.kind, 'reused');
    assert.equal(second.performanceMeasuredNow, false);
    assert.equal(second.originalFinished, first.originalFinished);
    assert.equal(calls, 10);
    assert.equal(readEvidence(join(root, 'two.json')).id, first.reportId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NERV consumes shared machine/scenario contracts and common evidence across consumer boundaries', async () => {
  const { inspectMachine, executeWithEvidence } = await import('@voidbrain/gauntlet-protocol');
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-environment-'));
  try {
    const machine = join(root, 'machine.json');
    writeFileSync(machine, JSON.stringify(inspectMachine('neutral-host')));
    const profilePath = 'node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json';
    const minimal = 'node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/minimal-load.json';
    const moderate = 'node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json';
    const pack = JSON.parse(readFileSync('node_modules/@voidbrain/gauntlet-protocol/examples/smoke-v1.json', 'utf8'));
    let calls = 0,
      requests = 0,
      invocations = 0,
      lastOptions;
    const fetcher = async (url, init) => {
      requests++;
      const path = new URL(String(url)).pathname;
      let value;
      if (path === '/api/version') value = { version: 'neutral-runtime' };
      else if (path === '/api/show') value = { details: { quantization_level: 'Q4_K_M' }, capabilities: ['thinking'] };
      else if (path === '/api/tags') value = { models: [{ name: 'gemma4:12b', size: 100, digest: 'a'.repeat(64) }] };
      else if (path === '/api/ps') value = { models: [] };
      else if (path === '/api/generate') value = { done: true, done_reason: 'unload' };
      else if (path === '/api/chat') {
        const body = JSON.parse(init.body);
        assert.equal(body.stream, true);
        const answer = JSON.stringify(pack.cases[calls++ % pack.cases.length].expected.value);
        return new Response(
          [
            { model: 'gemma4:12b', message: { content: answer }, done: false },
            { model: 'gemma4:12b', message: { content: '' }, done: true, eval_count: 3, prompt_eval_count: 10 },
          ]
            .map((x) => JSON.stringify(x))
            .join('\n') + '\n',
        );
      } else throw Error('Unexpected fixture endpoint');
      return new Response(JSON.stringify(value));
    };
    const services = {
      execute: (selected, profile, limits, options) => {
        invocations++;
        assert.equal(options.sourceKey, undefined);
        lastOptions = { ...options, fetch: fetcher, environmentKey: 'neutral-environment-cache' };
        return executeWithEvidence(selected, profile, limits, lastOptions);
      },
    };
    const base = ['--profile=' + profilePath, '--machine-profile=' + machine];
    const planned = await main(['model-plan', ...base, '--scenario=' + minimal]);
    assert.equal(planned.environment.scenario.load, 'minimal');
    assert.equal(planned.environmentVerified, false);
    assert.equal(requests, 0);
    const args = [
      'model-run',
      ...base,
      '--scenario=' + minimal,
      '--execute',
      '--allow-models',
      '--cache-dir=' + join(root, 'cache'),
    ];
    await assert.rejects(main([...args, '--out=' + join(root, 'denied.json')], services), /confirmation/);
    assert.equal(invocations, 0);
    assert.equal(requests, 0);
    const first = await main([...args, '--confirm-scenario', '--out=' + join(root, 'nerv.json')], services);
    assert.equal(first.passed, true);
    assert.equal(calls, 10);
    const commonProfile = JSON.parse(readFileSync(profilePath, 'utf8')),
      limits = JSON.parse(readFileSync('node_modules/@voidbrain/gauntlet-protocol/examples/limits-day.json', 'utf8'));
    const otherConsumer = await executeWithEvidence(pack, commonProfile, limits, {
      ...lastOptions,
      output: join(root, 'other-consumer.json'),
    });
    assert.equal(otherConsumer.kind, 'reused');
    assert.equal(otherConsumer.performanceMeasuredNow, false);
    assert.equal(otherConsumer.report.id, first.reportId);
    assert.equal(calls, 10);
    const changed = await main(
      [
        'model-run',
        ...base,
        '--scenario=' + moderate,
        '--execute',
        '--allow-models',
        '--confirm-scenario',
        '--cache-dir=' + join(root, 'cache'),
        '--out=' + join(root, 'moderate.json'),
      ],
      services,
    );
    assert.equal(changed.kind, 'executed');
    assert.equal(calls, 20);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NERV selected diagnostics join the released private capture and report-bound inspector without changing grades', async () => {
  const { executeWithEvidence, readEvidence } = await import('@voidbrain/gauntlet-protocol');
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-private-diagnostic-'));
  let calls = 0;
  try {
    const model = 'gemma4:12b',
      fetcher = async (url, init) => {
        const path = new URL(String(url)).pathname;
        let value;
        if (path === '/api/version') value = { version: 'neutral-runtime-v04' };
        else if (path === '/api/show')
          value = { details: { quantization_level: 'Q4_K_M' }, capabilities: ['thinking'] };
        else if (path === '/api/tags') value = { models: [{ name: model, size: 100, digest: 'b'.repeat(64) }] };
        else if (path === '/api/ps') value = { models: [] };
        else if (path === '/api/generate') value = { done: true, done_reason: 'unload' };
        else if (path === '/api/chat') {
          calls++;
          const body = JSON.parse(init.body);
          assert.equal(body.options.num_ctx, 8192);
          assert.equal(body.options.num_predict, 2048);
          assert.equal(body.options.seed, 42);
          assert.equal(body.think, true);
          assert.equal(Object.hasOwn(body, 'expected'), false);
          return new Response(
            [
              { model, message: { content: 'PRIVATE_INVALID_NERV_REPLY' }, done: false },
              {
                model,
                message: { content: '' },
                done: true,
                eval_count: 2,
                prompt_eval_count: 10,
                eval_duration: 1000000,
              },
            ]
              .map((x) => JSON.stringify(x))
              .join('\n') + '\n',
          );
        } else throw Error('Unexpected fixture endpoint');
        return new Response(JSON.stringify(value));
      };
    const services = {
      execute: (pack, profile, limits, options) => {
        assert.equal(options.sourceKey, undefined);
        assert.equal(options.captureFailures, join(root, 'failures'));
        assert.equal(pack.id, 'neutral-smoke:selected');
        return executeWithEvidence(pack, profile, limits, { ...options, fetch: fetcher });
      },
    };
    const args = [
      'model-run',
      '--profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json',
      '--limits=node_modules/@voidbrain/gauntlet-protocol/examples/limits-diagnostic.json',
      '--only=change-mind,tool-choice,missing-input',
      '--execute',
      '--allow-models',
      '--capture-failures=' + join(root, 'failures'),
      '--cache-dir=' + join(root, 'cache'),
    ];
    await assert.rejects(main([...args, '--out=' + join(root, 'no-fresh.json')], services), /fresh/);
    assert.equal(calls, 0);
    if (process.platform === 'win32') {
      await assert.rejects(
        main([...args, '--fresh', '--out=' + join(root, 'unsupported.json')], services),
        /unavailable on Windows/,
      );
      assert.equal(calls, 0);
      return;
    }
    const out = join(root, 'report.json'),
      result = await main([...args, '--fresh', '--out=' + out], services);
    assert.equal(result.passed, false);
    assert.equal(result.complete, true);
    assert.equal(calls, 3);
    const report = readEvidence(out);
    assert.equal(report.caseCount, 3);
    assert.equal(report.diagnostics.failureCaptures, true);
    assert.ok(report.results.every((r) => r.status === 'failed' && r.reason === 'Invalid structured output'));
    assert.equal(readFileSync(out, 'utf8').includes('PRIVATE_INVALID_NERV_REPLY'), false);
    const inspection = await main(['inspect-failures', '--directory=' + join(root, 'failures'), '--report=' + out]);
    assert.equal(inspection.private, true);
    assert.equal(inspection.untrusted, true);
    assert.equal(inspection.failures.length, 3);
    assert.ok(inspection.failures.every((r) => r.response === 'PRIVATE_INVALID_NERV_REPLY'));
    await assert.rejects(main(['inspect-failures', '--directory=' + join(root, 'failures')]), /report/);
    await assert.rejects(
      main([
        'model-plan',
        '--profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json',
        '--only=missing-input,missing-input',
      ]),
      /duplicate/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NERV schema mode reaches released Ollama adapter and preserves semantic failures', async () => {
  const { executeWithEvidence, readEvidence } = await import('@voidbrain/gauntlet-protocol');
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-schema-'));
  let calls = 0;
  try {
    const model = 'gemma4:12b',
      fetcher = async (url, init) => {
        const path = new URL(String(url)).pathname;
        let value;
        if (path === '/api/version') value = { version: 'neutral' };
        else if (path === '/api/show')
          value = { details: { quantization_level: 'Q4_K_M' }, capabilities: ['thinking'] };
        else if (path === '/api/tags') value = { models: [{ name: model, size: 100, digest: 'b'.repeat(64) }] };
        else if (path === '/api/ps') value = { models: [] };
        else if (path === '/api/generate') value = { done: true };
        else if (path === '/api/chat') {
          calls++;
          const body = JSON.parse(init.body);
          assert.deepEqual(body.format, {
            type: 'object',
            properties: { action: { type: 'string' } },
            required: ['action'],
            additionalProperties: false,
          });
          assert.equal(JSON.stringify(body.format).includes('cancel'), false);
          return new Response(
            [
              { model, message: { content: '{"action":"incorrect"}' }, done: false },
              { model, message: { content: '' }, done: true, eval_count: 2, eval_duration: 1000000 },
            ]
              .map((x) => JSON.stringify(x))
              .join('\n') + '\n',
          );
        } else throw Error('unexpected');
        return new Response(JSON.stringify(value));
      };
    const profile = '--profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json';
    const planned = await main(['model-plan', profile, '--format=schema', '--only=change-mind']);
    assert.equal(planned.pack, 'neutral-smoke-schema:selected');
    assert.equal(planned.cases[0].responseFormat, 'schema');
    assert.equal(calls, 0);
    await assert.rejects(main(['model-plan', profile, '--format=invalid']), /format/);
    const out = join(root, 'report.json');
    const result = await main(
      [
        'model-run',
        profile,
        '--format=schema',
        '--only=change-mind',
        '--execute',
        '--allow-models',
        '--fresh',
        '--out=' + out,
        '--cache-dir=' + join(root, 'cache'),
      ],
      { execute: (p, m, l, o) => executeWithEvidence(p, m, l, { ...o, fetch: fetcher }) },
    );
    assert.equal(calls, 1);
    assert.equal(result.passed, false);
    assert.equal(readEvidence(out).results[0].status, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('NERV compare command joins released 0.5 comparison: baseline, mismatch reasons and no promotion across two saved reports', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-gauntlet-compare-'));
  try {
    const input = join(root, 'native-normalized.json');
    writeFileSync(input, JSON.stringify(normalize(native(), 'policy')));
    const fixture = join(root, 'copy.mjs');
    writeFileSync(fixture, "import {copyFileSync} from 'node:fs';copyFileSync(process.argv[2],process.argv[3]);");
    const pack = validatePack({
      schemaVersion: 1,
      id: 'nerv-comparison-fixture',
      version: '1.0.0',
      cases: [
        {
          id: 'policy',
          runner: 'normalized',
          layer: 'system',
          split: 'regression',
          capabilities: ['effects'],
          critical: true,
          expensive: false,
        },
      ],
    });
    const registry = validateRegistry(
      {
        schemaVersion: 1,
        runners: {
          normalized: {
            command: 'node',
            args: [fixture, input, '{report}'],
            cwd: root,
            layers: ['system'],
            allowModels: false,
          },
        },
      },
      root,
    );
    const limits = validateLimits(JSON.parse(readFileSync('evals/gauntlet/limits.json', 'utf8')));
    const paths = [];
    for (const name of ['first', 'second']) {
      const report = await run(pack, null, limits, { execute: true, registry });
      const path = join(root, name + '.json');
      writeFileSync(path, JSON.stringify(report), { mode: 0o600 });
      paths.push(path);
    }
    const compared = await main(['compare', '--reports=' + paths.join(',')]);
    assert.equal(compared.length, 2);
    assert.deepEqual(
      compared.map((c) => c.baseline),
      [true, false],
    );
    assert.deepEqual(
      compared.map((c) => c.mismatchReasons),
      [[], []],
    );
    assert.ok(
      compared.every(
        (c) =>
          c.comparableToFirst &&
          c.automaticPromotion === false &&
          c.contract.pack === 'nerv-comparison-fixture' &&
          c.tokenCoverage.cacheMeasured === false,
      ),
    );
    const status = process.platform === 'win32' ? 'error' : 'passed';
    assert.ok(compared.every((c) => c.counts[status] === 1 && c.results[0].id === 'policy'));
    assert.notEqual(compared[0].id, compared[1].id);
    await assert.rejects(
      main(['compare', '--reports=' + paths[0]]),
      /2–64/,
      'one report is not a comparison since 0.5',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// F-074-T06..T08: every common pack, the run ledger, pending cases and the root command.
test('every pack the pinned Gauntlet release ships is consumed unless excluded with a reason', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-gauntlet-packs-'));
  const examples = 'node_modules/@voidbrain/gauntlet-protocol/examples';
  const shipped = readdirSync(examples)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(examples, f), 'utf8')))
    .filter((p) => Array.isArray(p.cases))
    .map((p) => p.id)
    .sort();
  try {
    const listed = (await main(['packs'])).packs;
    assert.deepEqual(
      listed
        .filter((p) => p.source === 'common')
        .map((p) => p.id)
        .sort(),
      shipped,
    );
    assert.ok(shipped.includes('general-assistant-expanded'), '0.5.0+ ships the expanded pack');
    assert.deepEqual(
      listed.filter((p) => p.source === 'nerv').map((p) => p.id),
      ['nerv-system-flows'],
    );
    // The index lists every consumed pack.
    const index = readFileSync('docs/test-capability-index.md', 'utf8');
    for (const id of [...shipped, 'nerv-system-flows']) assert.match(index, new RegExp(`\\[${id}@`));
    // An exclusion needs a reason and must name a shipped pack.
    const config = (value) => {
      const p = join(dir, `consumption-${Math.random()}.json`);
      writeFileSync(p, JSON.stringify(value));
      return p;
    };
    const withConfig = async (value, fn) => {
      process.env.NERV_GAUNTLET_CONSUMPTION = config(value);
      try {
        return await fn();
      } finally {
        delete process.env.NERV_GAUNTLET_CONSUMPTION;
      }
    };
    await withConfig({ schemaVersion: 1, exclude: { 'neutral-smoke-schema': 'covered by neutral-smoke' } }, async () =>
      assert.equal(
        (await main(['packs'])).packs.some((p) => p.id === 'neutral-smoke-schema'),
        false,
      ),
    );
    await withConfig({ schemaVersion: 1, exclude: { 'neutral-smoke-schema': '' } }, () =>
      assert.rejects(main(['packs']), /needs a reason/),
    );
    await withConfig({ schemaVersion: 1, exclude: { 'no-such-pack': 'gone' } }, () =>
      assert.rejects(main(['packs']), /not in the pinned release/),
    );
    // model commands select any common pack; legacy --format still works.
    const profile = '--profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json';
    assert.equal((await main(['model-plan', profile, '--pack=general-assistant-expanded'])).cases.length, 28);
    assert.equal((await main(['model-plan', profile, '--format=schema'])).cases.length, 10);
    await assert.rejects(main(['model-plan', profile, '--pack=unknown']), /Unknown common pack/);
    await assert.rejects(main(['model-plan', profile, '--pack=neutral-smoke', '--format=schema']), /not both/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the root command runs only uncovered cases, records them and reports nothing pending afterwards', async () => {
  const { executeWithEvidence, caseHash } = await import('@voidbrain/gauntlet-protocol');
  const { systemSourceKey } = await import('../tools/gauntlet.mjs');
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-gauntlet-all-'));
  const ledger = join(dir, 'ledger.json');
  process.env.NERV_GAUNTLET_LEDGER = ledger;
  // An open fixture task names the three common packs, so the test does not depend on the live backlog.
  const tasks = join(dir, 'tasks');
  mkdirSync(tasks);
  writeFileSync(
    join(tasks, 'X-001-T01.json'),
    JSON.stringify({
      id: 'X-001-T01',
      status: 'planned',
      acceptance: ['Covers general-assistant-expanded/*, neutral-smoke-schema/* and neutral-smoke/*'],
    }),
  );
  process.env.NERV_GAUNTLET_TASKS = tasks;
  try {
    // Schema 1 entries have unknown identity and do NOT silently cover when sourceKey is checked.
    const system = JSON.parse(readFileSync('evals/gauntlet/system-v1.json', 'utf8'));
    writeFileSync(
      ledger,
      JSON.stringify({
        schemaVersion: 1,
        entries: system.cases.map((c) => ({
          pack: system.id,
          packVersion: system.version,
          case: c.id,
          caseHash: caseHash(c),
          profileHash: null,
          status: 'passed',
          reportHash: 'c'.repeat(64),
          finished: '2026-11-11T00:00:00.000Z',
        })),
      }),
    );
    const schema1Pending = await main(['pending']);
    assert.equal(schema1Pending.pendingLines.length, 55);
    assert.equal(
      schema1Pending.pendingLines.filter((l) => l.startsWith('nerv-system-flows/') && l.endsWith('(source-changed)'))
        .length,
      7,
    );
    // Schema 2 entries with the current system sourceKey cover NERV's system cases; every common case is new.
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
          sourceKey: systemSourceKey(system),
        })),
      }),
    );
    const before = await main(['pending']);
    assert.equal(before.pendingLines.length, 48);
    assert.equal(before.pendingLines.filter((l) => l.startsWith('general-assistant-expanded/')).length, 28);
    // Named by an unfinished task (the fixture lists the three common packs as pack/*), so the CI check passes.
    assert.deepEqual((await main(['pending', '--check-records'])).pendingLines, []);
    // Max age and another profile make covered cases pending again; --fresh plans every case.
    const old = await main(['all', '--max-age-days=1']);
    assert.ok(old.plan.find((p) => p.pack === 'nerv-system-flows').run.every((r) => r.reason === 'stale'));
    const fresh = await main(['all', '--fresh']);
    assert.ok(fresh.plan.every((p) => p.run.length > 0 && p.run.every((r) => r.reason === 'fresh')));
    // Without approval the plan blocks every model case and runs nothing.
    const plan = await main(['all']);
    assert.equal(plan.modelCallsAuthorized, false);
    assert.deepEqual(
      plan.plan.map((p) => [p.pack, p.run.length, p.reuse.length, p.blocked?.cases.length ?? 0]),
      [
        ['general-assistant-expanded', 28, 0, 28],
        ['neutral-smoke-schema', 10, 0, 10],
        ['neutral-smoke', 10, 0, 10],
        ['nerv-system-flows', 0, 7, 0],
      ],
    );
    await assert.rejects(main(['all', '--execute']), /out-dir/);
    // With approval, a fixture runtime answers every case; system cases are reused, not rerun.
    const model = 'gemma4:12b';
    let resident = false,
      chats = 0;
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
        chats++;
        resident = true;
        const done = { model, message: { content: '' }, done: true, eval_count: 3, prompt_eval_count: 10 };
        return new Response(
          [{ model, message: { content: '{}' }, done: false }, done].map((x) => JSON.stringify(x)).join('\n') + '\n',
        );
      } else throw Error('Unexpected fixture endpoint');
      return new Response(JSON.stringify(value));
    };
    const systemRuns = [];
    const services = {
      execute: (pack, profile, limits, options) => {
        if (!profile) systemRuns.push(pack.id);
        return executeWithEvidence(pack, profile, limits, {
          ...options,
          fetch: fetcher,
          environmentKey: 'neutral-nerv-all-fixture',
        });
      },
    };
    const run = await main(
      [
        'all',
        '--profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json',
        '--allow-models',
        '--execute',
        '--out-dir=' + join(dir, 'reports'),
        '--cache-dir=' + join(dir, 'cache'),
      ],
      services,
    );
    assert.deepEqual(systemRuns, []);
    assert.equal(chats, 48);
    assert.deepEqual(
      run.results.map((r) => [r.pack, r.cases.length]),
      [
        ['general-assistant-expanded', 28],
        ['neutral-smoke-schema', 10],
        ['neutral-smoke', 10],
      ],
    );
    assert.equal(run.stillPending, 0);
    assert.equal(typeof run.passed, 'boolean');
    assert.deepEqual((await main(['pending'])).pendingLines, []);
    const written = JSON.parse(readFileSync(ledger, 'utf8'));
    const recorded = written.entries;
    assert.equal(recorded.length, 55);
    // Gauntlet 0.7: the ledger is written as schema 2; all entries carry their identity.
    assert.equal(written.schemaVersion, 2);
    const identity = ['modelDigest', 'runtimeHash', 'scenarioHash', 'sourceKey'];
    assert.ok(recorded.every((e) => identity.every((k) => k in e)));
    assert.ok(
      recorded.every((e) => !JSON.stringify(e).includes('content')),
      'metadata only',
    );
    // A second run finds nothing to do; another profile has run nothing yet.
    const again = await main(['all']);
    assert.ok(again.plan.every((p) => p.run.length === 0));
    const other = join(dir, 'other-profile.json');
    const base = JSON.parse(
      readFileSync('node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json', 'utf8'),
    );
    writeFileSync(other, JSON.stringify({ ...base, id: 'other', seed: 7 }));
    const otherPlan = await main(['all', '--profile=' + other]);
    assert.ok(
      otherPlan.plan
        .filter((p) => p.layer === 'model')
        .every(
          (p) => p.run.length === p.reuse.length + p.run.length && p.run.every((r) => r.reason === 'other-profile'),
        ),
    );
    assert.deepEqual(otherPlan.plan.find((p) => p.layer === 'system').run, [], 'system cases need no profile');
  } finally {
    delete process.env.NERV_GAUNTLET_LEDGER;
    delete process.env.NERV_GAUNTLET_TASKS;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pending and ledger keep the harness contract: lines and exit 1 when pending, exit 2 on errors', (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-gauntlet-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (args, env = {}) =>
    spawnSync(process.execPath, ['tools/gauntlet.mjs', ...args], {
      encoding: 'utf8',
      env: { ...process.env, NERV_GAUNTLET_LEDGER: join(dir, 'ledger.json'), ...env },
    });
  const listed = cli(['pending']);
  assert.equal(listed.status, 1);
  assert.equal(listed.stdout.trim().split('\n').length, 55);
  assert.match(listed.stdout, /^nerv-system-flows\/policy \(new\)$/m);
  assert.equal(cli(['pending', '--max-age-days=x']).status, 2);
  writeFileSync(join(dir, 'bad.json'), '{"schemaVersion":1,"entries":[{"x":1}]}');
  assert.equal(cli(['pending'], { NERV_GAUNTLET_LEDGER: join(dir, 'bad.json') }).status, 2);
  assert.equal(cli(['ledger', '--pack=nerv-system-flows']).status, 2);
});

test('check:gauntlet-runs fails for a pending case that no unfinished task lists', async () => {
  const { unnamedPending } = await import('../tools/gauntlet.mjs');
  const changed = { pack: 'nerv-system-flows', case: 'policy', reason: 'changed' };
  // Prose that mentions the pack id does not name it; history in a record never counts.
  assert.deepEqual(unnamedPending([changed], 'F-074 consumes nerv-system-flows and neutral-smoke'), [changed]);
  assert.deepEqual(unnamedPending([changed], 'see nerv-system-flows/policy-old'), [changed]);
  assert.deepEqual(unnamedPending([changed], 'covers nerv-system-flows/policy'), []);
  assert.deepEqual(unnamedPending([changed], 'covers nerv-system-flows/*'), []);
  assert.deepEqual(unnamedPending([changed], 'covers neutral-smoke/*'), [changed]);
});

test('F-074-T10: identity-bound ledger coverage detects source, model, runtime and scenario changes', async () => {
  const { caseHash, evidenceProfile, hash } = await import('@voidbrain/gauntlet-protocol');
  const { systemSourceKey } = await import('../tools/gauntlet.mjs');
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-gauntlet-identity-'));
  const ledger = join(dir, 'ledger.json');
  process.env.NERV_GAUNTLET_LEDGER = ledger;
  try {
    const system = JSON.parse(readFileSync('evals/gauntlet/system-v1.json', 'utf8'));
    const profilePath = 'node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json';
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    const profileHash = hash(evidenceProfile(profile));
    const currentSourceKey = systemSourceKey(system);
    const modelDigest = 'd'.repeat(64);
    const runtimeHash = 'e'.repeat(64);
    const scenarioHash = 'f'.repeat(64);
    const packs = ['general-assistant-expanded', 'neutral-smoke', 'neutral-smoke-schema'].map((id) => {
      const file =
        id === 'general-assistant-expanded'
          ? 'general-assistant-expanded-v1.json'
          : id === 'neutral-smoke-schema'
            ? 'smoke-schema-v1.json'
            : 'smoke-v1.json';
      return JSON.parse(readFileSync(join('node_modules/@voidbrain/gauntlet-protocol/examples', file), 'utf8'));
    });
    writeFileSync(
      ledger,
      JSON.stringify({
        schemaVersion: 2,
        entries: [
          ...system.cases.map((c) => ({
            pack: system.id,
            packVersion: system.version,
            case: c.id,
            caseHash: caseHash(c),
            profileHash: null,
            status: 'passed',
            reportHash: '1'.repeat(64),
            finished: '2020-01-01T00:00:00.000Z',
            modelDigest: null,
            runtimeHash,
            scenarioHash,
            sourceKey: currentSourceKey,
          })),
          ...packs.flatMap((p) =>
            p.cases.map((c) => ({
              pack: p.id,
              packVersion: p.version,
              case: c.id,
              caseHash: caseHash(c),
              profileHash,
              status: 'passed',
              reportHash: '2'.repeat(64),
              finished: '2020-01-01T00:00:00.000Z',
              modelDigest,
              runtimeHash,
              scenarioHash,
              sourceKey: null,
            })),
          ),
        ],
      }),
    );
    // Exact identity covers everything even from 2020 (no default max age).
    assert.deepEqual(
      (
        await main([
          'pending',
          '--profile=' + profilePath,
          '--model-digest=' + modelDigest,
          '--runtime-hash=' + runtimeHash,
          '--scenario-hash=' + scenarioHash,
        ])
      ).pendingLines,
      [],
    );
    // Different source key makes only NERV system cases pending with source-changed.
    const sourceChanged = await main(['all', '--source-key=deadbeef']);
    assert.ok(sourceChanged.plan.find((p) => p.pack === system.id).run.every((r) => r.reason === 'source-changed'));
    assert.ok(sourceChanged.plan.filter((p) => p.layer === 'model').every((p) => p.run.length === 0));
    // Different model digest / runtime / scenario make affected cases pending with the exact reason.
    const modelChanged = await main(['pending', '--profile=' + profilePath, '--model-digest=' + '9'.repeat(64)]);
    assert.equal(modelChanged.pendingLines.length, 48);
    assert.ok(modelChanged.pendingLines.every((l) => l.endsWith('(model-changed)')));
    const runtimeChanged = await main(['pending', '--profile=' + profilePath, '--runtime-hash=' + '8'.repeat(64)]);
    assert.equal(runtimeChanged.pendingLines.length, 48);
    assert.ok(runtimeChanged.pendingLines.every((l) => l.endsWith('(runtime-changed)')));
    const scenarioChanged = await main(['pending', '--profile=' + profilePath, '--scenario-hash=' + '7'.repeat(64)]);
    assert.equal(scenarioChanged.pendingLines.length, 55);
    assert.ok(scenarioChanged.pendingLines.every((l) => l.endsWith('(scenario-changed)')));
    // Recording a system report via `ledger` binds NERV's systemSourceKey automatically.
    const reportPath = join(dir, 'sys-report.json');
    const runnerScript = join(dir, 'runner.mjs');
    writeFileSync(
      runnerScript,
      `import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[1].slice(6), JSON.stringify({
  schemaVersion: 1, layer: 'system', sourceStable: true, complete: true,
  fixtureHash: '${'a'.repeat(64)}', results: [{ id: 'policy', status: 'passed', checks: 1 }]
}));\n`,
    );
    const { run, validateRegistry, validateLimits } = await import('@voidbrain/gauntlet-protocol');
    const registry = validateRegistry(
      {
        schemaVersion: 1,
        runners: {
          policy: {
            command: 'node',
            args: ['runner.mjs', '--out={report}'],
            cwd: '.',
            layers: ['system'],
            allowModels: false,
          },
        },
      },
      dir,
    );
    const singlePack = { ...system, id: system.id + ':policy', cases: [system.cases[0]] };
    const sysReport = await run(
      singlePack,
      null,
      validateLimits(JSON.parse(readFileSync('evals/gauntlet/limits.json', 'utf8'))),
      { execute: true, registry },
    );
    writeFileSync(reportPath, JSON.stringify(sysReport));
    await main(['ledger', '--report=' + reportPath, '--pack=' + system.id]);
    const updated = JSON.parse(readFileSync(ledger, 'utf8'));
    const recordedPolicy = updated.entries.find((e) => e.pack === system.id && e.case === 'policy');
    assert.equal(recordedPolicy.sourceKey, currentSourceKey);
  } finally {
    delete process.env.NERV_GAUNTLET_LEDGER;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F-074-T04: profile-matched role bundle plans, rejects unsupported settings, enforces budgets and saves reports', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-gauntlet-role-'));
  const profilePath = 'node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json';
  const scenarioPath = 'node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json';
  const machinePath = join(dir, 'machine.json');
  try {
    const machine = await main(['machine', '--id=mac-local']);
    writeFileSync(machinePath, JSON.stringify(machine));
    // Plan validates 8K/2048 profile + 300s/10-case/20480-token day limits without running models.
    const planned = await main([
      'role-plan',
      '--profile=' + profilePath,
      '--machine-profile=' + machinePath,
      '--scenario=' + scenarioPath,
    ]);
    assert.equal(planned.bundle, 'nerv-role-evaluation');
    assert.equal(planned.cases.length, 10);
    assert.equal(planned.profile.context, 8192);
    assert.equal(planned.profile.maxOutputTokens, 2048);
    assert.equal(planned.limits.suiteMs, 300000);
    assert.equal(planned.limits.outputTokens, 20480);
    assert.equal(planned.reusesCommonSmoke, false);
    assert.equal(planned.modelCallsAuthorized, false);
    assert.equal(planned.modelQualification, false);

    // Unsupported settings are rejected rather than silently inheriting defaults.
    await assert.rejects(main(['role-plan']), /--profile/);
    const baseProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
    const badBackend = join(dir, 'bad-backend.json');
    writeFileSync(badBackend, JSON.stringify({ ...baseProfile, backend: 'llama.cpp' }));
    await assert.rejects(main(['role-plan', '--profile=' + badBackend]), /Alternative runtime|ollama/);
    const badParallel = join(dir, 'bad-parallel.json');
    writeFileSync(badParallel, JSON.stringify({ ...baseProfile, parallel: 2 }));
    await assert.rejects(main(['role-plan', '--profile=' + badParallel]), /parallel=1/);
    const badEndpoint = join(dir, 'bad-endpoint.json');
    writeFileSync(badEndpoint, JSON.stringify({ ...baseProfile, endpoint: 'https://api.example.com' }));
    await assert.rejects(main(['role-plan', '--profile=' + badEndpoint]), /loopback/);
    await assert.rejects(main(['role-plan', '--profile=' + profilePath, '--limit=8']), /exceed limits\.maxCases/);
    await assert.rejects(
      main([
        'role-run',
        '--profile=' + profilePath,
        '--machine-profile=' + machinePath,
        '--scenario=' + scenarioPath,
        '--execute',
        '--allow-models',
        '--out=' + join(dir, 'no-confirm.json'),
      ]),
      /scenario confirmation/i,
    );

    // Execution sends exact 8K/2048/seed/think options, tracks telemetry gaps and stops on aggregate token budget.
    const chatBodies = [];
    let unloaded = false;
    const mockFetch = async (url, init = {}) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/version') return new Response(JSON.stringify({ version: '0.12.0' }));
      if (path === '/api/tags')
        return new Response(JSON.stringify({ models: [{ name: 'gemma4:12b', digest: 'a'.repeat(64) }] }));
      if (path === '/api/show')
        return new Response(JSON.stringify({ details: { quantization_level: 'Q4_K_M' }, capabilities: ['thinking'] }));
      if (path === '/api/ps') return new Response(JSON.stringify({ models: [] }));
      if (path === '/api/generate') {
        unloaded = true;
        return new Response(JSON.stringify({ done: true }));
      }
      if (path === '/api/chat') {
        chatBodies.push(JSON.parse(init.body));
        const isFirst = chatBodies.length === 1;
        return new Response(
          JSON.stringify({
            model: 'gemma4:12b',
            done_reason: 'stop',
            message: { content: '{"vote":"approve","reason":"ok","confidence":1}' },
            ...(isFirst ? { eval_count: 50, prompt_eval_count: 20 } : {}),
          }),
        );
      }
      throw Error('Unexpected endpoint ' + path);
    };
    const tightLimits = join(dir, 'tight-limits.json');
    writeFileSync(
      tightLimits,
      JSON.stringify({ caseMs: 30000, suiteMs: 300000, maxCases: 4, repeat: 1, outputTokens: 50, maxBytes: 1048576 }),
    );
    const outPath = join(dir, 'role-report.json');
    const summary = await main(
      [
        'role-run',
        '--role=casper',
        '--limit=3',
        '--profile=' + profilePath,
        '--limits=' + tightLimits,
        '--machine-profile=' + machinePath,
        '--scenario=' + scenarioPath,
        '--confirm-scenario',
        '--execute',
        '--allow-models',
        '--out=' + outPath,
      ],
      { fetch: mockFetch },
    );
    assert.equal(summary.kind, 'nerv-role-evaluation');
    assert.equal(summary.reusesCommonSmoke, false);
    assert.equal(summary.modelQualification, false);
    assert.equal(chatBodies.length, 1);
    assert.equal(chatBodies[0].think, true);
    assert.equal(chatBodies[0].options.num_ctx, 8192);
    assert.equal(chatBodies[0].options.num_predict, 50);
    assert.equal(chatBodies[0].options.seed, 42);
    assert.equal(unloaded, true);
    const report = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(report.results.length, 3);
    assert.equal(report.results[0].status, 'passed');
    assert.equal(report.results[1].status, 'not-run');
    assert.match(report.results[1].error, /output token budget/);
    assert.equal(report.complete, false);
    assert.equal(report.actual.modelDigest, 'a'.repeat(64));

    // Interruption saves partial report with not-run remaining cases.
    const abort = new AbortController();
    abort.abort();
    const interruptedOut = join(dir, 'interrupted.json');
    const interrupted = await main(
      [
        'role-run',
        '--role=misato',
        '--limit=2',
        '--profile=' + profilePath,
        '--execute',
        '--allow-models',
        '--out=' + interruptedOut,
      ],
      { fetch: mockFetch, signal: abort.signal },
    );
    assert.equal(interrupted.complete, false);
    const intReport = JSON.parse(readFileSync(interruptedOut, 'utf8'));
    assert.ok(intReport.results.every((r) => r.status === 'not-run' && /Interrupted/.test(r.error)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
