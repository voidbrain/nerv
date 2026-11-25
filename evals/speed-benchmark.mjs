// F-126-T01: repeatable local model speed benchmark (uncached prompt reading and generation).
// Local loopback Ollama only (no paid/cloud route). Prepends a fresh random hex nonce at token 0 of every
// iteration so the KV prefix cache cannot reuse prior prompt tokens, and verifies prompt_eval_count stays
// uncached on every repetition.
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, freemem, loadavg, platform, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE_PATH = resolve(here, 'speed-benchmark-v1.json');
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function checkLoopbackEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw Error('Invalid benchmark endpoint URL');
  }
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw Error('Speed benchmark endpoint must be credential-free loopback (local models only)');
  }
  return url.origin;
}

export function readBenchmarkFixture(fixturePath = DEFAULT_FIXTURE_PATH) {
  const raw = readFileSync(fixturePath, 'utf8');
  const data = JSON.parse(raw);
  if (
    data?.schemaVersion !== 1 ||
    typeof data.id !== 'string' ||
    !data.id ||
    typeof data.body !== 'string' ||
    data.body.length < 8000 ||
    !Number.isInteger(data.targetPromptTokens) ||
    data.targetPromptTokens < 1000 ||
    !Number.isInteger(data.minUncachedPromptTokens) ||
    data.minUncachedPromptTokens < 1000 ||
    !Number.isInteger(data.numCtx) ||
    data.numCtx < 4096 ||
    !Number.isInteger(data.maxOutputTokens) ||
    data.maxOutputTokens < 32
  ) {
    throw Error('Invalid speed benchmark fixture');
  }
  return { ...data, sha256: sha256(raw) };
}

/**
 * Builds one uncached prompt by placing 32 random hex digits split into 4 space-separated tokens at byte 0
 * before the fixed neutral fixture body, defeating prefix KV caching from the very first user token.
 */
export function buildUncachedPrompt(fixtureBody, iteration, nonceHex = randomBytes(16).toString('hex')) {
  if (!/^[0-9a-f]{32}$/.test(nonceHex)) throw Error('Benchmark nonce must be 32 lowercase hex characters');
  const prefix = `${nonceHex.slice(0, 8)} ${nonceHex.slice(8, 16)} ${nonceHex.slice(16, 24)} ${nonceHex.slice(24, 32)} [uncached-iteration-${iteration}]`;
  return `${prefix}\n\n${fixtureBody}`;
}

export function inspectSanitizedMachine() {
  const list = cpus();
  return {
    platform: platform(),
    arch: arch(),
    cpu: list[0]?.model ? String(list[0].model).trim() : 'unknown',
    cores: list.length,
    memoryBytes: totalmem(),
  };
}

export function sampleHostLoad() {
  const [loadAvg1m, loadAvg5m, loadAvg15m] = loadavg().map((n) => Math.round(n * 100) / 100);
  return {
    loadAvg1m,
    loadAvg5m,
    loadAvg15m,
    freeMemoryBytes: freemem(),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

export function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : round2((nums[mid - 1] + nums[mid]) / 2);
}

export function computeIterationMetrics(raw, minUncachedPromptTokens) {
  const promptTokens = Number.isInteger(raw?.prompt_eval_count) ? raw.prompt_eval_count : null;
  const promptDurationNs = Number.isFinite(raw?.prompt_eval_duration) && raw.prompt_eval_duration > 0 ? raw.prompt_eval_duration : null;
  const outputTokens = Number.isInteger(raw?.eval_count) ? raw.eval_count : null;
  const evalDurationNs = Number.isFinite(raw?.eval_duration) && raw.eval_duration > 0 ? raw.eval_duration : null;
  const loadDurationNs = Number.isFinite(raw?.load_duration) && raw.load_duration >= 0 ? raw.load_duration : null;
  const totalDurationNs = Number.isFinite(raw?.total_duration) && raw.total_duration > 0 ? raw.total_duration : null;

  const promptTokensPerSecond =
    promptTokens !== null && promptDurationNs !== null ? round2(promptTokens / (promptDurationNs / 1e9)) : null;
  const generationTokensPerSecond =
    outputTokens !== null && evalDurationNs !== null ? round2(outputTokens / (evalDurationNs / 1e9)) : null;
  const cacheDefeated = promptTokens !== null && promptTokens >= minUncachedPromptTokens;

  return {
    returnedModel: typeof raw?.model === 'string' ? raw.model : null,
    doneReason: typeof raw?.done_reason === 'string' ? raw.done_reason : null,
    promptTokens,
    promptDurationMs: promptDurationNs !== null ? Math.round(promptDurationNs / 1e6) : null,
    promptTokensPerSecond,
    outputTokens,
    evalDurationMs: evalDurationNs !== null ? Math.round(evalDurationNs / 1e6) : null,
    generationTokensPerSecond,
    loadDurationMs: loadDurationNs !== null ? Math.round(loadDurationNs / 1e6) : null,
    totalDurationMs: totalDurationNs !== null ? Math.round(totalDurationNs / 1e6) : null,
    cacheDefeated,
  };
}

export function parseBenchmarkArgs(argv) {
  const opts = {
    models: ['gemma4:12b', 'gemma4:26b'],
    endpoint: DEFAULT_ENDPOINT,
    repeat: 3,
    timeoutMs: 180000,
    fixturePath: DEFAULT_FIXTURE_PATH,
    execute: false,
    out: null,
  };
  for (const arg of argv) {
    if (arg === '--execute') opts.execute = true;
    else if (arg.startsWith('--models=')) {
      const list = arg
        .slice('--models='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!list.length) throw Error('At least one model required in --models=');
      opts.models = list;
    } else if (arg.startsWith('--endpoint=')) {
      opts.endpoint = arg.slice('--endpoint='.length);
    } else if (arg.startsWith('--repeat=')) {
      const n = Number(arg.slice('--repeat='.length));
      if (!Number.isInteger(n) || n < 1 || n > 10) throw Error('--repeat must be an integer 1..10');
      opts.repeat = n;
    } else if (arg.startsWith('--timeout-ms=')) {
      const n = Number(arg.slice('--timeout-ms='.length));
      if (!Number.isInteger(n) || n < 1000 || n > 600000) throw Error('--timeout-ms must be 1000..600000');
      opts.timeoutMs = n;
    } else if (arg.startsWith('--fixture=')) {
      opts.fixturePath = resolve(arg.slice('--fixture='.length));
    } else if (arg.startsWith('--out=')) {
      opts.out = resolve(arg.slice('--out='.length));
    } else {
      throw Error(`Unknown argument: ${arg}`);
    }
  }
  opts.endpoint = checkLoopbackEndpoint(opts.endpoint);
  return opts;
}

export async function runSpeedBenchmark(rawArgs = [], { fetch: fetchImpl = fetch } = {}) {
  const opts = typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...parseBenchmarkArgs([]), ...rawArgs } : parseBenchmarkArgs(rawArgs);
  opts.endpoint = checkLoopbackEndpoint(opts.endpoint);
  const fixture = readBenchmarkFixture(opts.fixturePath);

  if (!opts.execute) {
    return {
      mode: 'plan',
      modelCallsAuthorized: false,
      endpoint: opts.endpoint,
      models: opts.models,
      repeat: opts.repeat,
      timeoutMs: opts.timeoutMs,
      fixture: {
        id: fixture.id,
        sha256: fixture.sha256,
        targetPromptTokens: fixture.targetPromptTokens,
        minUncachedPromptTokens: fixture.minUncachedPromptTokens,
        bodyBytes: Buffer.byteLength(fixture.body, 'utf8'),
        numCtx: fixture.numCtx,
        maxOutputTokens: fixture.maxOutputTokens,
      },
    };
  }

  if (opts.out && existsSync(opts.out)) {
    throw Error(`Refusing to overwrite existing output file: ${opts.out}`);
  }

  const jsonReq = async (path, init = {}) => {
    const res = await fetchImpl(new URL(path, opts.endpoint), {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      ...init,
    });
    if (!res.ok) throw Error(`HTTP ${res.status} on ${path}`);
    return res.json();
  };

  const started = new Date().toISOString();
  const machine = inspectSanitizedMachine();
  let runtimeVersion = null;
  try {
    runtimeVersion = (await jsonReq('/api/version'))?.version ?? null;
  } catch {
    runtimeVersion = null;
  }
  const tags = await jsonReq('/api/tags');
  const initialPs = await jsonReq('/api/ps').catch(() => ({ models: [] }));
  const initiallyResident = new Set((initialPs?.models ?? []).map((m) => m.name));

  const modelReports = [];
  for (const modelName of opts.models) {
    const tagEntry = (tags?.models ?? []).find((m) => m.name === modelName);
    if (!tagEntry) throw Error(`Model "${modelName}" is not installed on ${opts.endpoint}`);
    let quantization = null,
      parameterSize = null,
      family = null;
    try {
      const show = await jsonReq('/api/show', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
      });
      quantization = show?.details?.quantization_level ?? null;
      parameterSize = show?.details?.parameter_size ?? null;
      family = show?.details?.family ?? null;
    } catch {
      /* optional show metadata */
    }

    const loadBefore = sampleHostLoad();
    const iterations = [];
    for (let i = 1; i <= opts.repeat; i++) {
      const prompt = buildUncachedPrompt(fixture.body, i);
      const t0 = performance.now();
      const res = await fetchImpl(new URL('/api/chat', opts.endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          think: false,
          keep_alive: '5m',
          options: {
            num_ctx: fixture.numCtx,
            num_predict: fixture.maxOutputTokens,
            temperature: 0,
          },
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (!res.ok) throw Error(`HTTP ${res.status} from /api/chat for ${modelName}`);
      const raw = await res.json();
      const wallMs = Math.round(performance.now() - t0);
      const metrics = computeIterationMetrics(raw, fixture.minUncachedPromptTokens);
      if (!metrics.cacheDefeated) {
        throw Error(
          `Prompt cache was not defeated on ${modelName} iteration ${i}: prompt_eval_count=${String(metrics.promptTokens)} (< ${fixture.minUncachedPromptTokens})`,
        );
      }
      iterations.push({ iteration: i, wallMs, ...metrics });
    }

    let residentSizeBytes = null,
      residentVramBytes = null;
    try {
      const psAfter = await jsonReq('/api/ps');
      const psModel = (psAfter?.models ?? []).find((m) => m.name === modelName);
      residentSizeBytes = Number.isFinite(psModel?.size) ? psModel.size : null;
      residentVramBytes = Number.isFinite(psModel?.size_vram) ? psModel.size_vram : null;
    } catch {
      /* optional ps metadata */
    }
    const loadAfter = sampleHostLoad();

    // Release residency if this model was not resident before the benchmark, keeping unified memory free for the next model.
    if (!initiallyResident.has(modelName)) {
      await jsonReq('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName, keep_alive: 0 }),
      }).catch(() => {});
    }

    modelReports.push({
      model: modelName,
      digest: tagEntry.digest ?? null,
      diskSizeBytes: Number.isFinite(tagEntry.size) ? tagEntry.size : null,
      residentSizeBytes,
      residentVramBytes,
      quantization,
      parameterSize,
      family,
      wasResidentBefore: initiallyResident.has(modelName),
      loadBefore,
      loadAfter,
      summary: {
        repetitions: iterations.length,
        cacheDefeatedAll: iterations.every((it) => it.cacheDefeated),
        medianPromptTokens: median(iterations.map((it) => it.promptTokens)),
        medianPromptTokensPerSecond: median(iterations.map((it) => it.promptTokensPerSecond)),
        medianOutputTokens: median(iterations.map((it) => it.outputTokens)),
        medianGenerationTokensPerSecond: median(iterations.map((it) => it.generationTokensPerSecond)),
        firstLoadDurationMs: iterations[0]?.loadDurationMs ?? null,
        medianWallMs: median(iterations.map((it) => it.wallMs)),
      },
      iterations,
    });
  }

  const report = {
    schemaVersion: 1,
    kind: 'nerv-local-speed-benchmark-v1',
    started,
    finished: new Date().toISOString(),
    endpoint: opts.endpoint,
    runtimeVersion,
    machine,
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      targetPromptTokens: fixture.targetPromptTokens,
      minUncachedPromptTokens: fixture.minUncachedPromptTokens,
      numCtx: fixture.numCtx,
      maxOutputTokens: fixture.maxOutputTokens,
    },
    models: modelReports,
  };

  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true, mode: 0o700 });
    writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpeedBenchmark(process.argv.slice(2)).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
