// F-006-T23–T25: bounded live placement driver. It runs only the repository's neutral packs (Gauntlet
// neutral-smoke, the Casper/Misato role cases and evals/combination-v1.json) through one inference
// transport and grades them with the existing graders. No tool executes, no cloud route exists here,
// and every run is bounded by caseMs, suiteMs, an output-token total and the campaign stop rule
// (3 consecutive case timeouts abort the run; the rest is recorded as not run, never as passed).
//
// Transports:
//   ollama  loopback Ollama /api/chat on this host (temperature 0, seed 42, think off)
//   nerv    this host's NERV service, POST /api/placement/run (P2 local or P3 Mac over WorkerLink)
//   ssh     the `nerv` transport on another host, through `ssh HOST node DRIVER probe` (stdin JSON)
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));

/** The placement probe takes one prompt of at most 8192 characters and no system message. */
export const PROBE_PROMPT_LIMIT = 8192;

/** Folds a system and user message into one prompt, as the placement probe needs; null when it does not fit. */
export function foldAsk(ask) {
  const prompt = ask.system ? `${ask.system}\n\n${ask.prompt}` : ask.prompt;
  return prompt.length <= PROBE_PROMPT_LIMIT ? prompt : null;
}

/** Gauntlet's neutral-smoke acceptance (engine run): JSON.parse of the reply deep-equal to the expected value, else trimmed text equality. */
export function gradeSmoke(testCase, text) {
  let observed = text.trim();
  if (testCase.expected.kind === 'json') {
    try {
      observed = JSON.parse(text);
    } catch {
      return 'failed';
    }
  }
  return isDeepStrictEqual(observed, testCase.expected.value) ? 'passed' : 'failed';
}

export function smokeCases() {
  const pack = JSON.parse(
    readFileSync(join(root, 'node_modules/@voidbrain/gauntlet-protocol/examples/smoke-v1.json'), 'utf8'),
  );
  if (pack.id !== 'neutral-smoke') throw Error('Unexpected neutral-smoke pack');
  return pack.cases.map((c) => ({
    id: c.id,
    split: c.split,
    ask: { prompt: c.messages.map((m) => m.content).join('\n\n') },
    grade: (text) => gradeSmoke(c, text),
  }));
}

export async function roleItems() {
  const { roleCases, gradeRole } = await import('./evaluate-model.mjs');
  const { casperAsk } = await import('../src/casper.ts');
  const { misatoAsk } = await import('../src/misato.ts');
  const { toolDocs } = await import('../src/executors.ts');
  return roleCases('both').cases.map((item) => ({
    id: `${item.role}:${item.case.id}`,
    split: item.case.split,
    ask: item.role === 'casper' ? casperAsk(item.case.input) : misatoAsk({ ...item.case.input, tools: toolDocs }, 'local'),
    grade: (text) => gradeRole(item.role, item.case, text).status,
  }));
}

const VOTE_REPLY = 'Reply with only one JSON object: {"vote":"approve" or "reject","reason":"one sentence naming the defect if you reject"}.';

export function coderPrompt(c) {
  return [
    'You are the coder. You wrote the patch below for this task.',
    `Task: ${c.task}`,
    `Criteria:\n${c.visibleCriteria.map((v) => `- ${v}`).join('\n')}`,
    `Your patch:\n${c.candidatePatch}`,
    'Check your patch against the task and criteria. Vote approve if it is correct and safe, reject if it has a defect.',
    VOTE_REPLY,
  ].join('\n\n');
}

export function reviewerPrompt(c, coder) {
  return [
    "You are an independent reviewer (auditor) of another model's patch.",
    `Task: ${c.task}`,
    `Criteria:\n${c.visibleCriteria.map((v) => `- ${v}`).join('\n')}`,
    `Candidate patch:\n${c.candidatePatch}`,
    `The coder's own check: ${JSON.stringify(coder)}`,
    'Decide yourself: approve only a correct and safe patch; reject a patch with a defect (for example a silent fallback, a cloud route for tainted data, a missing check) and name it.',
    VOTE_REPLY,
  ].join('\n\n');
}

/** Parses a {vote, reason} reply; anything else is invalid and never becomes an approval. */
export function parseVote(text) {
  const match = /\{[\s\S]*\}/.exec(text ?? '');
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]);
    if (!['approve', 'reject'].includes(value?.vote)) return null;
    return { vote: value.vote, reason: typeof value.reason === 'string' ? value.reason.slice(0, 500) : '' };
  } catch {
    return null;
  }
}

class TimeoutError extends Error {}

/**
 * Runs items × repeat through `infer(ask, {maxTokens, timeoutMs})` → {text, outputTokens, durationMs, serverMs?}.
 * Enforces caseMs, suiteMs, the output-token total and the 3-consecutive-timeouts stop rule.
 */
export async function runSuite(items, infer, limits, { now = () => Date.now(), maxTokens = 2048 } = {}) {
  const started = now();
  let tokens = 0,
    timeouts = 0,
    stopped = null;
  const results = [];
  for (let iteration = 1; iteration <= limits.repeat; iteration++)
    for (const item of items) {
      const base = { id: item.id, split: item.split, iteration };
      if (!stopped && now() - started >= limits.suiteMs) stopped = 'suite time budget exceeded';
      if (!stopped && tokens >= limits.outputTokens) stopped = 'output token budget exceeded';
      if (stopped) {
        results.push({ ...base, status: 'not-run', error: stopped });
        continue;
      }
      if (item.blocked) {
        results.push({ ...base, status: 'not-run', error: item.blocked });
        continue;
      }
      const t0 = now();
      try {
        const reply = await infer(item.ask, {
          maxTokens: Math.min(maxTokens, limits.outputTokens - tokens),
          timeoutMs: Math.min(limits.caseMs, limits.suiteMs - (t0 - started)),
        });
        const ms = now() - t0;
        tokens += reply.outputTokens ?? 0;
        timeouts = 0;
        const status = ms > limits.caseMs ? 'error' : item.grade(reply.text);
        results.push({
          ...base,
          status,
          ...(ms > limits.caseMs ? { error: 'case time budget exceeded' } : {}),
          ms,
          serverMs: reply.serverMs ?? null,
          outputTokens: reply.outputTokens ?? null,
          ...(reply.provenance ? { provenance: reply.provenance } : {}),
          response: String(reply.text).slice(0, 400),
        });
      } catch (error) {
        const timedOut = error instanceof TimeoutError || /timed? ?out|abort/i.test(String(error?.message));
        timeouts = timedOut ? timeouts + 1 : 0;
        results.push({ ...base, status: 'error', error: String(error?.message ?? error).slice(0, 300), ms: now() - t0 });
        if (timeouts >= 3) stopped = 'stop rule: 3 consecutive case timeouts';
      }
    }
  return { results, outputTokens: tokens, elapsedMs: now() - started, stopped, summary: summarize(results) };
}

const median = (values) => {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2)) : null;
};

export function summarize(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const overhead = results.filter((r) => typeof r.serverMs === 'number').map((r) => Math.max(0, r.ms - r.serverMs));
  return {
    passed: count('passed'),
    total: results.length,
    failed: count('failed'),
    invalid: count('invalid'),
    error: count('error'),
    notRun: count('not-run'),
    latencyMedianMs: median(results.filter((r) => r.status !== 'not-run' && r.status !== 'error').map((r) => r.ms)),
    transportOverheadMedianMs: median(overhead),
  };
}

/** One combination case: the coder checks its patch; in coder-reviewer the auditor's vote decides. */
export async function combinationCase(c, mode, coder, reviewer, budget) {
  const t0 = Date.now();
  const first = await coder(coderPrompt(c), budget);
  const coderVote = parseVote(first.text);
  let tokens = first.outputTokens ?? 0,
    rounds = 1,
    final = coderVote,
    auditor = null;
  if (mode === 'coder-reviewer') {
    if (!coderVote) return { submission: null, tokens, rounds, ms: Date.now() - t0, invalid: 'coder' };
    const second = await reviewer(reviewerPrompt(c, coderVote), {
      ...budget,
      timeoutMs: Math.max(1000, budget.timeoutMs - (Date.now() - t0)),
    });
    tokens += second.outputTokens ?? 0;
    rounds = 2;
    auditor = second;
    final = parseVote(second.text);
  }
  const ms = Date.now() - t0;
  if (!final) return { submission: null, tokens, rounds, ms, invalid: mode === 'coder-reviewer' ? 'reviewer' : 'coder' };
  return {
    submission: { reviewerVote: final.vote, reviewerReason: final.reason, rounds, outputTokens: tokens, durationMs: ms },
    tokens,
    rounds,
    ms,
    coderServerMs: first.serverMs ?? null,
    auditorServerMs: auditor?.serverMs ?? null,
  };
}

export async function runCombination(mode, coder, reviewer, totalBudget, perCallTokens = 256) {
  const { combinationCorpus, createProtectedGrader } = await import('./evaluate-model.mjs');
  const pack = combinationCorpus();
  const grader = createProtectedGrader(pack);
  const started = Date.now();
  let tokens = 0,
    timeouts = 0,
    stopped = null;
  const results = [];
  for (let iteration = 1; iteration <= totalBudget.repeat; iteration++)
    for (const c of grader.publicCases()) {
      const base = { id: c.id, family: c.family, split: c.split, iteration };
      if (!stopped && Date.now() - started >= totalBudget.suiteMs) stopped = 'suite time budget exceeded';
      if (!stopped && tokens >= totalBudget.outputTokens) stopped = 'output token budget exceeded';
      if (stopped) {
        results.push({ ...base, status: 'not-run', error: stopped });
        continue;
      }
      try {
        const out = await combinationCase(c, mode, coder, reviewer, {
          maxTokens: Math.min(perCallTokens, totalBudget.outputTokens - tokens),
          timeoutMs: Math.min(totalBudget.caseMs, totalBudget.suiteMs - (Date.now() - started)),
        });
        tokens += out.tokens;
        timeouts = 0;
        if (out.ms > totalBudget.caseMs) {
          results.push({ ...base, status: 'error', error: 'case time budget exceeded', ms: out.ms, tokens: out.tokens });
          continue;
        }
        if (!out.submission) {
          results.push({ ...base, status: 'invalid', error: `${out.invalid} reply invalid`, ms: out.ms, tokens: out.tokens });
          continue;
        }
        const graded = grader.gradeCase(c.id, out.submission);
        if (graded.tamperDetected) stopped = 'stop rule: grader tamper detected';
        results.push({
          ...base,
          status: graded.status,
          vote: out.submission.reviewerVote,
          reason: out.submission.reviewerReason,
          falseRejection: graded.falseRejection,
          missedFlaw: graded.missedFlaw,
          sharedBlindSpotFailure: graded.sharedBlindSpotFailure,
          tamperDetected: graded.tamperDetected,
          rounds: out.rounds,
          ms: out.ms,
          tokens: out.tokens,
          coderServerMs: out.coderServerMs,
          auditorServerMs: out.auditorServerMs,
        });
      } catch (error) {
        const timedOut = /timed? ?out|abort/i.test(String(error?.message));
        timeouts = timedOut ? timeouts + 1 : 0;
        results.push({ ...base, status: 'error', error: String(error?.message ?? error).slice(0, 300), ms: Date.now() - started });
        if (timeouts >= 3) stopped = 'stop rule: 3 consecutive case timeouts';
      }
    }
  const n = (k) => results.filter((r) => r[k]).length;
  return {
    mode,
    pack: { id: grader.packId, hash: grader.packHash },
    grader: { graderHash: grader.graderHash, hiddenAcceptanceHash: grader.hiddenAcceptanceHash },
    totalBudget,
    perCallTokens,
    results,
    outputTokens: tokens,
    elapsedMs: Date.now() - started,
    stopped,
    summary: {
      ...summarize(results),
      falseRejections: n('falseRejection'),
      missedFlaws: n('missedFlaw'),
      sharedBlindSpotFailures: n('sharedBlindSpotFailure'),
      tamperDetected: n('tamperDetected'),
    },
  };
}

// ---- transports ----

export function ollamaTransport(model, endpoint = 'http://127.0.0.1:11434') {
  const url = new URL('/api/chat', endpoint);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Ollama endpoint must be loopback');
  return async (ask, { maxTokens, timeoutMs }) => {
    const messages = [...(ask.system ? [{ role: 'system', content: ask.system }] : []), { role: 'user', content: ask.prompt }];
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        think: false,
        keep_alive: '5m',
        options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: maxTokens },
      }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return {
      text: raw?.message?.content ?? '',
      outputTokens: Number.isInteger(raw?.eval_count) ? raw.eval_count : null,
      serverMs: Number.isFinite(raw?.total_duration) ? Math.round(raw.total_duration / 1e6) : null,
    };
  };
}

/** The local NERV service's placement probe; P2 infers on this base, P3 on the Mac over WorkerLink. */
export function nervTransport(placement, home = process.env.NERV_HOME || join(homedir(), '.nerv')) {
  const port = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).port ?? 4317;
  const token = readFileSync(join(home, 'token'), 'utf8').trim();
  return async (ask, { maxTokens, timeoutMs, signal }) => {
    const prompt = foldAsk(ask);
    if (prompt === null) throw Error(`prompt exceeds the placement probe limit of ${PROBE_PROMPT_LIMIT} characters`);
    const res = await fetch(`http://127.0.0.1:${port}/api/placement/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        placement,
        prompt,
        ...(placement === 'P2' ? {} : { endpoint: 'mac' }),
        timeoutMs: Math.max(1000, Math.min(120000, timeoutMs)),
        maxOutputTokens: Math.max(1, Math.min(4096, maxTokens)),
        confirmExecute: true,
      }),
      signal: signal ?? AbortSignal.timeout(timeoutMs + 2000),
    });
    const value = await res.json();
    if (!res.ok) throw Error(value?.error ?? `HTTP ${res.status}`);
    const p = value.provenance ?? {};
    if (placement === 'P2' && (p.inferenceKind !== 'local' || p.executionKind !== 'local'))
      throw Error('P2 route substitution');
    if (placement !== 'P2' && (p.inferenceKind !== 'remote' || p.executionKind !== 'local'))
      throw Error('P3 route substitution');
    return {
      text: value.inference?.text ?? '',
      outputTokens: value.inference?.usage?.outputTokens ?? null,
      serverMs: value.inference?.durationMs ?? null,
      provenance: `${p.executionBaseId}/${p.executionKind} -> ${p.inferenceBaseId}/${p.inferenceKind} ${p.inferenceModel}`,
    };
  };
}

/** Runs the `nerv` transport on another host over SSH, one probe per call. */
export function sshTransport(host, nodePath, driverPath, placement) {
  return (ask, { maxTokens, timeoutMs }) =>
    new Promise((resolvePromise, reject) => {
      const child = spawn('ssh', ['-o', 'BatchMode=yes', host, `"${nodePath}" "${driverPath}" probe ${placement}`], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '',
        err = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new TimeoutError('ssh probe timed out'));
      }, timeoutMs + 5000);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const value = JSON.parse(out);
          if (value.error) reject(Error(value.error));
          else resolvePromise(value);
        } catch {
          reject(Error(`ssh probe failed (${code}): ${err.replace(/\*\*.*\n?/g, '').trim().slice(0, 200)}`));
        }
      });
      child.stdin.end(JSON.stringify({ ask, maxTokens, timeoutMs }));
    });
}

const LIMITS_REPEAT3 = { caseMs: 30000, suiteMs: 900000, repeat: 3, outputTokens: 61440 };
const COMBINATION_BUDGET = { outputTokens: 6144, suiteMs: 360000, caseMs: 30000, repeat: 3 };

async function main(args) {
  const [command, ...rest] = args;
  const opt = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  if (command === 'probe') {
    // stdin {ask, maxTokens, timeoutMs} -> stdout one JSON reply (used by the ssh transport).
    const input = JSON.parse(readFileSync(0, 'utf8'));
    try {
      console.log(JSON.stringify(await nervTransport(rest[0])(input.ask, input)));
    } catch (error) {
      console.log(JSON.stringify({ error: String(error?.message ?? error) }));
    }
    return;
  }
  if (!opt.execute) throw Error('Live runs need --execute (owner-authorized campaign, F-006-T22).');
  const transport = (spec) => {
    const [kind, a, b, c] = spec.split(',');
    if (kind === 'ollama') return ollamaTransport(a);
    if (kind === 'nerv') return nervTransport(a);
    if (kind === 'ssh') return sshTransport(a, b, c, opt.placement ?? 'P2');
    throw Error('Use --transport=ollama,MODEL | nerv,P2|P3 | ssh,HOST,NODE,DRIVER');
  };
  if (command === 'smoke' || command === 'roles') {
    const infer = transport(opt.transport);
    let items = command === 'smoke' ? smokeCases() : await roleItems();
    if (opt.transport.startsWith('nerv'))
      items = items.map((i) => (foldAsk(i.ask) === null ? { ...i, blocked: `prompt exceeds the placement probe limit (${PROBE_PROMPT_LIMIT} characters)` } : i));
    return runSuite(items, infer, LIMITS_REPEAT3);
  }
  if (command === 'combination') {
    const coder = transport(opt.coder);
    const reviewer = opt.reviewer ? transport(opt.reviewer) : null;
    if (opt.mode === 'coder-reviewer' && !reviewer) throw Error('coder-reviewer needs --reviewer');
    return runCombination(opt.mode, coder, reviewer, COMBINATION_BUDGET);
  }
  throw Error('Use smoke|roles|combination --transport=… --execute, or probe P2|P3');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(
    (result) => result && console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );

