import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  combinationCorpus,
  compareCombinationRuns,
  configurationIdentity,
  createProtectedGrader,
  detectGraderTamper,
  evaluateCombination,
  run,
  stripHiddenAcceptance,
  validateCombinationSpec,
  verifyCombinationEvidence,
} from '../tools/evaluate-model.mjs';
import { verifyPromotionAuthority } from '../src/pilots.ts';
test(
  'F-029: model evidence distinguishes real returned identity, wrong judgment, partial scope and promotion',
  { timeout: 15000 },
  async () => {
    let response = {
      model: 'fixture-returned',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      choices: [{ message: { content: '{"vote":"approve","reason":"Matches.","confidence":1}' } }],
    };
    const requests = [];
    const server = createServer((req, res) => {
      let body = '';
      req
        .on('data', (d) => (body += d))
        .on('end', () => {
          res.setHeader('content-type', 'application/json');
          if (req.method === 'GET') {
            res.end(JSON.stringify({ models: [{ name: 'fixture', digest: 'f'.repeat(64) }] }));
            return;
          }
          requests.push(JSON.parse(body));
          res.end(JSON.stringify(response));
        });
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
    const temp = mkdtempSync(join(realpathSync(tmpdir()), 'nerv-eval-model-')),
      endpoint = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/v1`;
    try {
      const out = join(temp, 'first.json'),
        summary = await run(['--model=fixture', '--base-url=' + endpoint, '--limit=1', '--out=' + out]);
      assert.equal(summary.passed, true);
      assert.equal(summary.complete, false);
      const report = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(report.results[0].returnedModel, 'fixture-returned');
      assert.equal(report.model.requestedDigest, 'f'.repeat(64));
      assert.equal(report.results[0].usage.inputTokens, 10);
      assert.equal(report.notRun.length, 7);
      assert.equal(report.promotion.eligible, false);
      assert.equal(
        JSON.parse(requests[0].messages.at(-1).content).expected,
        undefined,
        'expected answers never enter the model prompt',
      );
      response = {
        choices: [{ message: { content: '{"action":{"tool":"reminders.cancel","args":{"id":"fixture"}}}' } }],
      };
      const wrong = join(temp, 'wrong.json');
      assert.equal(
        (await run(['--role=misato', '--model=fixture', '--base-url=' + endpoint, '--limit=1', '--out=' + wrong]))
          .passed,
        false,
      );
      const failed = JSON.parse(readFileSync(wrong, 'utf8'));
      assert.equal(failed.results[0].status, 'failed');
      assert.equal(
        failed.results[0].returnedModel,
        null,
        'missing provider identity is not relabelled as requested model',
      );
      await assert.rejects(
        () => run(['--model=fixture', '--base-url=https://provider.example/v1', '--limit=1']),
        /loopback/,
      );
    } finally {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      rmSync(temp, { recursive: true, force: true });
    }
  },
);

test('F-006-T03: combination case pack covers hidden acceptance, flawed patches, false rejection, and shared blind spots', () => {
  const pack = combinationCorpus();
  assert.equal(pack.id, 'combination-qualification-v1');
  assert.equal(pack.cases.length, 8);
  assert.equal(pack.cases.filter((c) => c.split === 'holdout').length, 2);
  for (const family of ['hidden-acceptance', 'deliberately-flawed-patch', 'false-rejection', 'shared-blind-spot']) {
    assert.ok(
      pack.cases.some((c) => c.family === family),
      `Missing family ${family} in combination-v1.json`,
    );
  }

  const grader = createProtectedGrader(pack);
  const publicCases = grader.publicCases();
  assert.equal(publicCases.length, 8);
  for (const pub of publicCases) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(pub, 'hiddenAcceptance'),
      false,
      'hiddenAcceptance must never be exposed in publicCases()',
    );
    assert.equal(Object.prototype.hasOwnProperty.call(stripHiddenAcceptance(pub), 'hiddenAcceptance'), false);
  }

  // Default gold responses pass all 8 cases
  for (const c of pack.cases) {
    const res = grader.gradeCase(c.id);
    assert.equal(res.passed, true, `Expected case ${c.id} to pass default fixture, got ${JSON.stringify(res)}`);
  }

  // Deliberately flawed patch approved by reviewer is caught as a missed flaw
  const missedFlaw = grader.gradeCase('flawed-patch-silent-fallback', {
    reviewerVote: 'approve',
    reviewerReason: 'Looks fine to me',
  });
  assert.equal(missedFlaw.passed, false);
  assert.equal(missedFlaw.missedFlaw, true);

  // Sound minimal patch rejected by reviewer is caught as a false rejection
  const falseRej = grader.gradeCase('false-rejection-minimal-fix', {
    reviewerVote: 'reject',
    reviewerReason: 'Prefer a full rewrite',
  });
  assert.equal(falseRej.passed, false);
  assert.equal(falseRej.falseRejection, true);

  // Shared blind spot: coder omits ancestor symlink loop and reviewer approves, caught by hiddenAcceptance
  const blindSpot = grader.gradeCase('shared-blind-spot-symlink-parent', {
    patch:
      "if (lstatSync(path).isSymbolicLink()) throw new Error('Symlink'); writeFileSync(path, data, { flag: 'wx' });",
    reviewerVote: 'approve',
    reviewerReason: 'Checks target symlink',
  });
  assert.equal(blindSpot.passed, false);
  assert.equal(blindSpot.sharedBlindSpotFailure, true);
});

test('F-006-T09: evidence adapter binds both configurations, handoffs, equal total budgets, and hosts', () => {
  const artifactDigest = 'a'.repeat(64);
  const coderConfig = {
    role: 'coder',
    model: 'qwen2.5-coder:14b',
    modelDigest: 'b'.repeat(64),
    quantization: 'Q4_K_M',
    engine: 'ollama:0.12.0',
    endpoint: 'NERV-01',
    host: { baseId: 'NERV-01', machineId: 'mac-host-01', scenario: 'moderate-load' },
    promptVersion: 'coder-prompt-v1',
    tools: ['code.read', 'code.patch'],
    budget: { maxOutputTokens: 1024, maxCaseMs: 15000 },
  };
  const reviewerConfig = {
    role: 'reviewer',
    model: 'gemma4:12b-it-q4_K_M',
    modelDigest: 'c'.repeat(64),
    quantization: 'Q4_K_M',
    engine: 'ollama:0.12.0',
    endpoint: 'http://127.0.0.1:11434/v1',
    host: { baseId: 'NERV-02', machineId: 'mini-host-01', scenario: 'baseline-load' },
    promptVersion: 'reviewer-prompt-v1',
    tools: ['code.diff'],
    budget: { maxOutputTokens: 512, maxCaseMs: 10000 },
  };
  const totalBudget = { outputTokens: 2048, suiteMs: 120000, caseMs: 30000, repeat: 1 };
  const executionHost = { baseId: 'NERV-02', machineId: 'mini-host-01', scenario: 'baseline-load' };
  const handoff = { maxRounds: 2, format: 'structured-patch-review-v1' };

  const soloSpec = validateCombinationSpec({
    mode: 'coder-alone',
    coder: coderConfig,
    executionHost,
    handoff,
    totalBudget,
    candidateArtifactDigest: artifactDigest,
  });
  const pairedSpec = validateCombinationSpec({
    mode: 'coder-reviewer',
    coder: coderConfig,
    reviewer: reviewerConfig,
    executionHost,
    handoff,
    totalBudget,
    candidateArtifactDigest: artifactDigest,
  });

  // Changing any part of coder or reviewer configuration produces a distinct configurationId
  const pairedId = configurationIdentity(pairedSpec);
  const changedQuantId = configurationIdentity({
    ...pairedSpec,
    reviewer: { ...reviewerConfig, quantization: 'Q8_0' },
  });
  assert.notEqual(pairedId, changedQuantId);

  // Solo run misses a flawed patch while coder+reviewer catches all 8 under the exact same totalBudget
  const soloEvidence = evaluateCombination(soloSpec, {
    'flawed-patch-silent-fallback': {
      reviewerVote: 'approve',
      reviewerReason: 'No reviewer present in solo mode',
      outputTokens: 80,
      durationMs: 100,
    },
  });
  assert.equal(soloEvidence.passed, false);
  assert.equal(soloEvidence.metrics.missedFlaws, 1);

  const pairedEvidence = evaluateCombination(pairedSpec, {
    'flawed-patch-silent-fallback': {
      rounds: 2,
      reviewerVote: 'reject',
      reviewerReason: 'Rejected silent fallback to local route',
      outputTokens: 120,
      durationMs: 150,
    },
  });
  assert.equal(pairedEvidence.passed, true);
  assert.equal(pairedEvidence.hosts.coderHost.baseId, 'NERV-01');
  assert.equal(pairedEvidence.hosts.reviewerHost?.baseId, 'NERV-02');
  assert.equal(pairedEvidence.hosts.executionHost.baseId, 'NERV-02');
  assert.equal(pairedEvidence.handoffs.length, 8);

  const comparison = compareCombinationRuns(soloEvidence, pairedEvidence);
  assert.equal(comparison.equalBudgetVerified, true);
  assert.equal(comparison.recommendReviewerPair, true);
  assert.equal(comparison.passDelta, 1);

  // Unequal budgets between solo and paired runs are rejected
  const unequalPaired = evaluateCombination({
    ...pairedSpec,
    totalBudget: { ...totalBudget, outputTokens: 4096 },
  });
  assert.throws(() => compareCombinationRuns(soloEvidence, unequalPaired), /equal totalBudget/);

  // Exceeding handoff maxRounds or totalBudget.outputTokens fails closed
  assert.throws(
    () =>
      evaluateCombination(pairedSpec, {
        'hidden-acceptance-bounds': { rounds: 3 },
      }),
    /exceed maxRounds/,
  );
  assert.throws(
    () =>
      evaluateCombination(pairedSpec, {
        'hidden-acceptance-bounds': { outputTokens: 3000 },
      }),
    /exceeded totalBudget\.outputTokens/,
  );
});

test('F-006-T10: grader tamper protection, stale or mismatched evidence rejection, and promotion authority recheck', () => {
  const pack = combinationCorpus();
  const grader = createProtectedGrader(pack);
  const artifactDigest = 'd'.repeat(64);
  const spec = {
    mode: 'coder-reviewer',
    coder: {
      role: 'coder',
      model: 'qwen2.5-coder:14b',
      modelDigest: 'b'.repeat(64),
      quantization: 'Q4_K_M',
      engine: 'ollama:0.12.0',
      endpoint: 'NERV-01',
      host: { baseId: 'NERV-01', machineId: 'mac-host-01', scenario: 'moderate-load' },
      promptVersion: 'coder-v1',
      tools: ['code.patch'],
      budget: { maxOutputTokens: 1024, maxCaseMs: 15000 },
    },
    reviewer: {
      role: 'reviewer',
      model: 'gemma4:12b-it-q4_K_M',
      modelDigest: 'c'.repeat(64),
      quantization: 'Q4_K_M',
      engine: 'ollama:0.12.0',
      endpoint: 'http://127.0.0.1:11434/v1',
      host: { baseId: 'NERV-02', machineId: 'mini-host-01', scenario: 'baseline-load' },
      promptVersion: 'reviewer-v1',
      tools: ['code.diff'],
      budget: { maxOutputTokens: 512, maxCaseMs: 10000 },
    },
    executionHost: { baseId: 'NERV-02', machineId: 'mini-host-01', scenario: 'baseline-load' },
    handoff: { maxRounds: 2, format: 'structured-patch-review-v1' },
    totalBudget: { outputTokens: 2048, suiteMs: 120000, caseMs: 30000, repeat: 1 },
    candidateArtifactDigest: artifactDigest,
  };

  // 1. Candidate attempts to tamper with grader, tests, credentials, or environment are caught and rejected
  assert.equal(detectGraderTamper({ patch: 'readFileSync("evals/combination-v1.json")' }).tampered, true);
  assert.equal(detectGraderTamper({ patch: 'writeFileSync("scrolls.json", "{}")' }).tampered, true);
  assert.equal(detectGraderTamper({ passed: true }).tampered, true);
  assert.equal(detectGraderTamper({ patch: 'ok' }, { PATH: '/usr/bin' }, { PATH: '/tmp/hijack' }).tampered, true);

  const tamperedEvidence = evaluateCombination(
    spec,
    {
      'hidden-acceptance-bounds': {
        patch: 'const cheat = "hiddenAcceptance";',
      },
    },
    { pack, grader },
  );
  assert.equal(tamperedEvidence.grader.tamperDetected, true);
  assert.equal(tamperedEvidence.passed, false);
  assert.deepEqual(verifyCombinationEvidence(tamperedEvidence), {
    valid: false,
    reason: 'Grader tamper detected in evidence',
  });

  // 2. Valid evidence passes verification, but stale or mismatched artifact/config/grader/host evidence is rejected
  const nowIso = '2026-11-14T22:00:00.000Z';
  const nowMs = Date.parse(nowIso);
  const validEvidence = evaluateCombination(spec, {}, { pack, grader, started: nowIso, finished: nowIso });
  assert.equal(validEvidence.passed, true);

  const baseExpected = {
    graderHash: grader.graderHash,
    hiddenAcceptanceHash: grader.hiddenAcceptanceHash,
    packHash: grader.packHash,
    candidateArtifactDigest: artifactDigest,
    configurationId: validEvidence.configurationId,
    executionHost: spec.executionHost,
    maxAgeMs: 86_400_000,
    nowMs,
  };
  assert.deepEqual(verifyCombinationEvidence(validEvidence, baseExpected), { valid: true });

  // Stale evidence rejected
  assert.equal(
    verifyCombinationEvidence(validEvidence, { ...baseExpected, nowMs: nowMs + 2 * 86_400_000 }).valid,
    false,
  );
  // Mismatched candidate artifact digest rejected
  assert.equal(
    verifyCombinationEvidence(validEvidence, { ...baseExpected, candidateArtifactDigest: 'e'.repeat(64) }).valid,
    false,
  );
  // Mismatched configuration identity rejected
  assert.equal(
    verifyCombinationEvidence(validEvidence, { ...baseExpected, configurationId: 'f'.repeat(64) }).valid,
    false,
  );
  // Mismatched execution host/scenario rejected
  assert.equal(
    verifyCombinationEvidence(validEvidence, {
      ...baseExpected,
      executionHost: { ...spec.executionHost, scenario: 'heavy-load' },
    }).valid,
    false,
  );

  // 3. Promotion rechecks artifact identity and current NERV authority; a passing report alone grants nothing
  const pilot = {
    id: 'coder-specialist',
    name: 'Coder Specialist',
    domain: 'code patch review',
    keywords: ['code', 'patch', 'review'],
    model: 'qwen2.5-coder:14b',
    stage: 'test',
    tools: ['code.patch'],
  };

  // Without owner approval, passing evidence grants nothing
  const noOwnerApproval = verifyPromotionAuthority({
    pilot,
    evidence: validEvidence,
    expectedConfigurationId: validEvidence.configurationId,
    expectedArtifactDigest: artifactDigest,
    expectedGraderHash: grader.graderHash,
    expectedHiddenAcceptanceHash: grader.hiddenAcceptanceHash,
    ownerApproved: false,
    nowMs,
  });
  assert.equal(noOwnerApproval.allowed, false);
  assert.match(noOwnerApproval.reason ?? '', /Owner approval is required/);

  // With owner approval, matching artifact/config/grader, and active policy authority, promotion check succeeds
  const approved = verifyPromotionAuthority({
    pilot,
    evidence: validEvidence,
    expectedConfigurationId: validEvidence.configurationId,
    expectedArtifactDigest: artifactDigest,
    expectedGraderHash: grader.graderHash,
    expectedHiddenAcceptanceHash: grader.hiddenAcceptanceHash,
    ownerApproved: true,
    policy: { deny: ['shell.raw'] },
    nowMs,
  });
  assert.equal(approved.allowed, true);

  // Policy denial or suspended/retired pilot revokes promotion authority even when evidence is valid and owner-approved
  assert.equal(
    verifyPromotionAuthority({
      pilot: { ...pilot, suspended: true },
      evidence: validEvidence,
      expectedConfigurationId: validEvidence.configurationId,
      expectedArtifactDigest: artifactDigest,
      expectedGraderHash: grader.graderHash,
      expectedHiddenAcceptanceHash: grader.hiddenAcceptanceHash,
      ownerApproved: true,
      nowMs,
    }).allowed,
    false,
  );
  assert.equal(
    verifyPromotionAuthority({
      pilot,
      evidence: validEvidence,
      expectedConfigurationId: validEvidence.configurationId,
      expectedArtifactDigest: artifactDigest,
      expectedGraderHash: grader.graderHash,
      expectedHiddenAcceptanceHash: grader.hiddenAcceptanceHash,
      ownerApproved: true,
      policy: { deny: ['code.patch'] },
      nowMs,
    }).allowed,
    false,
  );
});
