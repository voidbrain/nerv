import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildUncachedPrompt,
  checkLoopbackEndpoint,
  computeIterationMetrics,
  readBenchmarkFixture,
  runSpeedBenchmark,
  runWarnings,
} from '../evals/speed-benchmark.mjs';

test('F-126-T01: speed benchmark fixture is neutral, ~3,900 tokens, and plan mode makes no network calls', async () => {
  const fixture = readBenchmarkFixture();
  assert.equal(fixture.id, 'local-speed-benchmark-v1');
  assert.equal(fixture.targetPromptTokens, 3900);
  assert.ok(fixture.minUncachedPromptTokens >= 3000);
  assert.match(fixture.sha256, /^[0-9a-f]{64}$/);

  const p1 = buildUncachedPrompt(fixture.body, 1);
  const p2 = buildUncachedPrompt(fixture.body, 2);
  assert.notEqual(p1.slice(0, 35), p2.slice(0, 35), 'leading tokens differ on every iteration to defeat prefix cache');
  assert.ok(p1.endsWith(fixture.body));
  assert.ok(p2.endsWith(fixture.body));

  let called = 0;
  const plan = await runSpeedBenchmark([], {
    fetch: async () => {
      called++;
      throw Error('unexpected network call in plan mode');
    },
  });
  assert.equal(plan.mode, 'plan');
  assert.equal(plan.modelCallsAuthorized, false);
  assert.equal(called, 0);

  assert.throws(() => checkLoopbackEndpoint('https://api.example.com:11434'), /loopback/);
  assert.throws(() => checkLoopbackEndpoint('http://user:secret@127.0.0.1:11434'), /loopback/);
});

test('F-126-T01: speed benchmark measures uncached prompt and generation tok/s, records digest/load, and rejects cached prompts', async () => {
  const seenPrompts = [];
  let cachedMode = false;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') {
        res.end(JSON.stringify({ version: '0.9.0-fixture' }));
        return;
      }
      if (req.url === '/api/tags') {
        res.end(
          JSON.stringify({
            models: [
              { name: 'gemma4:12b', size: 8_000_000_000, digest: 'a'.repeat(64) },
              { name: 'gemma4:26b', size: 16_000_000_000, digest: 'b'.repeat(64) },
            ],
          }),
        );
        return;
      }
      if (req.url === '/api/ps') {
        res.end(
          JSON.stringify({
            models: [{ name: 'gemma4:12b', size: 8_200_000_000, size_vram: 8_200_000_000 }],
          }),
        );
        return;
      }
      if (req.url === '/api/show') {
        const { model } = JSON.parse(body);
        res.end(
          JSON.stringify({
            details: {
              quantization_level: 'Q4_K_M',
              parameter_size: model === 'gemma4:26b' ? '26B' : '12B',
              family: 'gemma4',
            },
          }),
        );
        return;
      }
      if (req.url === '/api/generate') {
        res.end(JSON.stringify({ done: true, done_reason: 'unload' }));
        return;
      }
      if (req.url === '/api/chat') {
        const parsed = JSON.parse(body);
        seenPrompts.push(parsed.messages[0].content);
        const is26b = parsed.model === 'gemma4:26b';
        res.end(
          JSON.stringify({
            model: parsed.model,
            message: { role: 'assistant', content: '{"summary":"ok"}' },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: cachedMode ? 24 : 3902,
            prompt_eval_duration: is26b ? 8_850_000_000 : 19_510_000_000,
            eval_count: 150,
            eval_duration: is26b ? 3_333_333_333 : 4_054_054_054,
            load_duration: 120_000_000,
            total_duration: is26b ? 12_303_333_333 : 23_684_054_054,
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const temp = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-speed-bench-'));
  const endpoint = `http://127.0.0.1:${server.address().port}`;

  try {
    const out = join(temp, 'bench.json');
    const report = await runSpeedBenchmark([
      '--execute',
      '--endpoint=' + endpoint,
      '--models=gemma4:12b,gemma4:26b',
      '--repeat=2',
      '--out=' + out,
    ]);
    assert.equal(existsSync(out), true);
    const saved = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(saved.kind, 'nerv-local-speed-benchmark-v1');
    assert.equal(saved.models.length, 2);
    assert.equal(seenPrompts.length, 4);
    assert.equal(new Set(seenPrompts.map((p) => p.slice(0, 35))).size, 4, 'every call carries a fresh nonce');

    const [m12, m26] = report.models;
    assert.equal(m12.digest, 'a'.repeat(64));
    assert.equal(m26.digest, 'b'.repeat(64));
    assert.equal(m12.summary.cacheDefeatedAll, true);
    assert.equal(m12.summary.medianPromptTokens, 3902);
    assert.equal(m12.summary.medianPromptTokensPerSecond, 200);
    assert.equal(m12.summary.medianGenerationTokensPerSecond, 37);
    assert.equal(m26.summary.medianPromptTokensPerSecond, 440.9);
    assert.equal(m26.summary.medianGenerationTokensPerSecond, 45);
    assert.equal(typeof report.machine.cpu, 'string');
    assert.ok(report.machine.memoryBytes > 0);
    assert.equal(typeof m12.loadBefore.loadAvg1m, 'number');
    assert.ok(Array.isArray(m12.warnings));

    // A model partly on the CPU, or a loaded host, is named in the report rather than silently averaged in.
    assert.deepEqual(
      runWarnings({
        residentSizeBytes: 8_000_000_000,
        residentVramBytes: 1_000_000_000,
        loadBefore: { loadAvg1m: 40 },
        loadAfter: { loadAvg1m: 56.2 },
        cores: 12,
      }),
      [
        'model only 13% in GPU memory: part ran on the CPU',
        'host load average 56.2 above 12 cores: other work shared the machine',
      ],
    );
    assert.deepEqual(
      runWarnings({
        residentSizeBytes: 8_000_000_000,
        residentVramBytes: 8_000_000_000,
        loadBefore: { loadAvg1m: 3 },
        loadAfter: { loadAvg1m: 4 },
        cores: 12,
      }),
      [],
    );

    // Refuses to overwrite an existing output path.
    await assert.rejects(
      () =>
        runSpeedBenchmark(['--execute', '--endpoint=' + endpoint, '--models=gemma4:12b', '--repeat=1', '--out=' + out]),
      /overwrite/,
    );

    // Fails closed if a runtime returns a cached prompt_eval_count (< minUncachedPromptTokens).
    cachedMode = true;
    await assert.rejects(
      () => runSpeedBenchmark(['--execute', '--endpoint=' + endpoint, '--models=gemma4:12b', '--repeat=1']),
      /Prompt cache was not defeated/,
    );

    const direct = computeIterationMetrics(
      { prompt_eval_count: 3900, prompt_eval_duration: 10_000_000_000, eval_count: 100, eval_duration: 2_500_000_000 },
      3500,
    );
    assert.equal(direct.promptTokensPerSecond, 390);
    assert.equal(direct.generationTokensPerSecond, 40);
    assert.equal(direct.cacheDefeated, true);
  } finally {
    await new Promise((done) => {
      server.close(done);
      server.closeAllConnections();
    });
    rmSync(temp, { recursive: true, force: true });
  }
});
