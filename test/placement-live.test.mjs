// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROBE_PROMPT_BYTES,
  PROBE_SYSTEM_BYTES,
  combinationCase,
  gradeSmoke,
  parseVote,
  probeBody,
  probeRefusal,
  roleItems,
  runSuite,
  runCombination,
  smokeCases,
} from '../tools/placement-live.mjs';

const limits = { caseMs: 30000, suiteMs: 900000, repeat: 3, outputTokens: 61440 };

test('the probe body keeps the system message apart and every role case fits the probe (F-006-T27)', async () => {
  assert.deepEqual(probeBody('P3', { system: 'S', prompt: 'P' }, { maxTokens: 99999, timeoutMs: 30000 }), {
    placement: 'P3',
    system: 'S',
    prompt: 'P',
    endpoint: 'mac',
    timeoutMs: 30000,
    maxOutputTokens: 4096,
    confirmExecute: true,
  });
  assert.deepEqual(probeBody('P2', { prompt: 'P' }, { maxTokens: 10, timeoutMs: 500 }), {
    placement: 'P2',
    prompt: 'P',
    timeoutMs: 1000,
    maxOutputTokens: 10,
    confirmExecute: true,
  });
  const items = await roleItems();
  assert.deepEqual(
    items.filter((i) => probeRefusal(i.ask)).map((i) => i.id),
    [],
  );
  assert.ok(items.some((i) => i.id.startsWith('misato:') && String(i.ask.system).length > 17_000));
  assert.match(String(probeRefusal({ system: 's'.repeat(PROBE_SYSTEM_BYTES + 1), prompt: 'p' })), /system/);
  assert.match(String(probeRefusal({ prompt: 'é'.repeat(PROBE_PROMPT_BYTES / 2 + 1) })), /prompt/);
  assert.equal(probeRefusal({ system: 's'.repeat(PROBE_SYSTEM_BYTES), prompt: 'p'.repeat(PROBE_PROMPT_BYTES) }), null);
});

test('gradeSmoke matches the Gauntlet engine: raw JSON deep equality, no repair', () => {
  const c = { expected: { kind: 'json', value: { count: 3 } } };
  assert.equal(gradeSmoke(c, ' {"count":3} '), 'passed');
  assert.equal(gradeSmoke(c, '```json\n{"count":3}\n```'), 'failed');
  assert.equal(gradeSmoke(c, '{"count":4}'), 'failed');
  assert.equal(smokeCases().length, 10);
});

test('parseVote never turns an invalid reply into an approval', () => {
  assert.deepEqual(parseVote('ok {"vote":"reject","reason":"silent fallback"}'), {
    vote: 'reject',
    reason: 'silent fallback',
  });
  assert.equal(parseVote('{"vote":"maybe"}'), null);
  assert.equal(parseVote('approve'), null);
});

test('runSuite stops after 3 consecutive timeouts and records the rest as not run', async () => {
  const items = [1, 2, 3, 4].map((i) => ({
    id: `c${i}`,
    split: 'regression',
    ask: { prompt: 'p' },
    grade: () => 'passed',
  }));
  let calls = 0;
  const infer = async () => {
    calls++;
    throw Error('The operation was aborted due to timeout');
  };
  const run = await runSuite(items, infer, limits);
  assert.equal(calls, 3);
  assert.equal(run.stopped, 'stop rule: 3 consecutive case timeouts');
  assert.equal(run.summary.error, 3);
  assert.equal(run.summary.notRun, 9);
  assert.equal(run.summary.passed, 0);
});

test('runSuite enforces the output-token total and blocked items never pass', async () => {
  const items = [
    { id: 'a', split: 'regression', ask: { prompt: 'p' }, grade: () => 'passed' },
    { id: 'b', split: 'regression', ask: { prompt: 'p' }, grade: () => 'passed', blocked: 'too long' },
  ];
  const run = await runSuite(items, async () => ({ text: 'x', outputTokens: 40, serverMs: 5 }), {
    ...limits,
    outputTokens: 80,
  });
  assert.deepEqual(
    run.results.map((r) => r.status),
    ['passed', 'not-run', 'passed', 'not-run', 'not-run', 'not-run'],
  );
  assert.equal(run.stopped, 'output token budget exceeded');
});

test('runCombination: the auditor decides in coder-reviewer and an invalid auditor reply fails the case', async () => {
  const budget = { outputTokens: 6144, suiteMs: 360000, caseMs: 30000, repeat: 1 };
  const vote = (prompt) => {
    if (prompt.includes('runLocalFallback')) return '{"vote":"reject","reason":"silent local fallback"}';
    if (prompt.includes("route: 'cloud'")) return '{"vote":"reject","reason":"tainted data sent to cloud"}';
    return '{"vote":"approve","reason":"correct"}';
  };
  const good = async (ask) => ({ text: vote(ask.prompt), outputTokens: 10 });
  const alone = await runCombination('coder-alone', good, null, budget);
  assert.equal(alone.summary.passed, 8);
  assert.equal(alone.summary.falseRejections, 0);
  const silent = await runCombination('coder-reviewer', good, async () => ({ text: 'no', outputTokens: 1 }), budget);
  assert.equal(silent.summary.passed, 0);
  assert.equal(silent.summary.invalid, 8);
  const rejectAll = await runCombination(
    'coder-reviewer',
    good,
    async () => ({ text: '{"vote":"reject","reason":"x"}', outputTokens: 1 }),
    budget,
  );
  assert.equal(rejectAll.summary.falseRejections, 2);
});

test('F-006-T33/T34: cancelled or budget-expired coder/auditor calls never grade or fall back to the coder vote', async () => {
  const sample = {
    id: 'flawed-patch-silent-fallback',
    task: 'Keep remote inference fail-closed',
    visibleCriteria: ['Never fall back silently'],
    candidatePatch: '+ return runLocalFallback();',
  };
  let auditorCalls = 0;
  const coderAbort = new AbortController();
  const slowCoder = (_ask, { signal }) =>
    new Promise((_res, rej) => {
      if (signal?.aborted) {
        rej(new Error('coder cancelled'));
        return;
      }
      signal?.addEventListener('abort', () => rej(new Error('coder cancelled')), { once: true });
    });
  setTimeout(() => coderAbort.abort(), 5);
  await assert.rejects(
    combinationCase(
      sample,
      'coder-reviewer',
      slowCoder,
      async () => {
        auditorCalls++;
        return { text: '{"vote":"approve","reason":"ok"}', outputTokens: 5 };
      },
      { maxTokens: 256, timeoutMs: 5000, coderSignal: coderAbort.signal },
    ),
    /coder cancelled/,
  );
  assert.equal(auditorCalls, 0, 'cancelled coder never invokes auditor');

  const auditorAbort = new AbortController();
  setTimeout(() => auditorAbort.abort(), 5);
  await assert.rejects(
    combinationCase(
      sample,
      'coder-reviewer',
      async () => ({ text: '{"vote":"approve","reason":"coder approved flawed patch"}', outputTokens: 10 }),
      (_ask, { signal }) =>
        new Promise((_res, rej) => {
          if (signal?.aborted) {
            rej(new Error('auditor cancelled'));
            return;
          }
          signal?.addEventListener('abort', () => rej(new Error('auditor cancelled')), { once: true });
        }),
      { maxTokens: 256, timeoutMs: 5000, reviewerSignal: auditorAbort.signal },
    ),
    /auditor cancelled/,
  );

  // Uncertain auditor outcome (budget expired mid-generation): coder's approve vote never stands in; recorded as error.
  let seenReviewerTimeout = 0;
  await assert.rejects(
    combinationCase(
      sample,
      'coder-reviewer',
      async () => ({ text: '{"vote":"approve","reason":"coder approved flawed patch"}', outputTokens: 10 }),
      async (_ask, { timeoutMs }) => {
        seenReviewerTimeout = timeoutMs;
        throw new Error('Orchestrated execution timed out');
      },
      { maxTokens: 256, timeoutMs: 30000, reviewerTimeoutMs: 1000 },
    ),
    /timed out/,
  );
  assert.equal(seenReviewerTimeout, 1000);

  const expiredRun = await runCombination(
    'coder-reviewer',
    async () => ({ text: '{"vote":"approve","reason":"coder approved flawed patch"}', outputTokens: 10 }),
    async () => {
      throw new Error('Worker result unknown after timeout.');
    },
    { outputTokens: 6144, suiteMs: 360000, caseMs: 30000, repeat: 1 },
  );
  assert.equal(expiredRun.summary.passed, 0);
  assert.equal(expiredRun.results[0].status, 'error');
});
