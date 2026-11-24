import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  comparePlacement,
  placementEvidence,
  placementReport,
  type PlacementEvidence,
} from '../src/placement-report.ts';

const COMMITTED = join(import.meta.dirname, '..', 'docs', 'evaluations', '2026-11-23-f006-t12-placement-evidence.json');
const T26 = join(import.meta.dirname, '..', 'docs', 'evaluations', '2026-11-24-f006-t26-placement-evidence.json');
const T29 = join(import.meta.dirname, '..', 'docs', 'evaluations', '2026-11-24-f006-t29-placement-evidence.json');

const NONE = { unavailableMac: null, disconnectedAuditor: null, cancellation: null, uncertainOutcome: null };

function evidence(over: Partial<PlacementEvidence> & Pick<PlacementEvidence, 'option'>): PlacementEvidence {
  return {
    source: 'live',
    enrolledTargets: true,
    identity: {
      model: 'model-a',
      runtime: 'runtime-1',
      hardware: 'host-x',
      memory: '16 GiB',
      concurrentLoad: 'baseline',
    },
    caseSet: 'pack-1 x3',
    budget: 'budget-1',
    outcome: { passed: 8, total: 10 },
    metrics: { latencyMedianMs: 1000, queueMs: 0, networkMs: 0, outputTokens: 100, resource: 'sampled' },
    failures: { ...NONE },
    ...over,
  };
}

const crossNodeChecks = { unavailableMac: true, disconnectedAuditor: null, cancellation: true, uncertainOutcome: true };

test('a cross-node placement wins only on equivalent live evidence with its failure checks held', () => {
  const mac = evidence({ option: 'mac-only' });
  const p3 = evidence({
    option: 'mini-tools-mac-inference',
    outcome: { passed: 9, total: 10 },
    failures: crossNodeChecks,
  });
  const report = placementReport([mac, p3]);
  assert.equal(
    report.comparisons.find((c) => c.candidate === 'mini-tools-mac-inference' && c.baseline === 'mac-only')?.verdict,
    'prefer-candidate',
  );
  assert.deepEqual(report.recommendation.option, 'mini-tools-mac-inference');
  assert.equal(report.recommendation.status, 'supported');
});

test('a violated failure check rejects the placement whatever its pass rate', () => {
  const verdict = comparePlacement(
    evidence({ option: 'mac-only' }),
    evidence({
      option: 'mini-tools-mac-inference',
      outcome: { passed: 10, total: 10 },
      failures: { ...crossNodeChecks, unavailableMac: false },
    }),
    { baseline: 'mac-only', candidate: 'mini-tools-mac-inference' },
  );
  assert.equal(verdict.verdict, 'rejected');
  assert.match(verdict.reasons[0], /unavailableMac/);
});

test('fixture, unbound, unequal or untested evidence never establishes a placement', () => {
  const mac = evidence({ option: 'mac-only' });
  const cases: [Partial<PlacementEvidence>, RegExp][] = [
    [{ source: 'fixture' }, /fixture/],
    [{ enrolledTargets: false }, /unenrolled/],
    [{ identity: { ...mac.identity, memory: null } }, /memory unknown/],
    [{ caseSet: 'pack-2 x1' }, /case sets differ/],
    [{ budget: 'budget-2' }, /budgets differ/],
    [{ failures: { ...crossNodeChecks, cancellation: null } }, /cancellation not exercised/],
    [{ outcome: null }, /no task outcome/],
  ];
  for (const [over, reason] of cases) {
    const candidate = evidence({
      option: 'mini-tools-mac-inference',
      outcome: { passed: 10, total: 10 },
      failures: crossNodeChecks,
      ...over,
    });
    const result = comparePlacement(mac, candidate, { baseline: 'mac-only', candidate: 'mini-tools-mac-inference' });
    assert.equal(result.verdict, 'insufficient-evidence', String(reason));
    assert.ok(
      result.reasons.some((r) => reason.test(r)),
      `${reason} in ${result.reasons.join('; ')}`,
    );
  }
  const auditor = comparePlacement(mac, evidence({ option: 'mac-coder-mini-auditor', failures: crossNodeChecks }), {
    baseline: 'mac-only',
    candidate: 'mac-coder-mini-auditor',
  });
  assert.ok(auditor.reasons.includes('mac-coder-mini-auditor: disconnectedAuditor not exercised live'));
  assert.throws(() => placementReport([mac, mac]), /Duplicate/);
});

test('no better candidate keeps the Mac-only baseline and lists unknown metrics', () => {
  const report = placementReport([
    evidence({ option: 'mac-only' }),
    evidence({
      option: 'mini-only',
      outcome: { passed: 5, total: 10 },
      metrics: { latencyMedianMs: 4000, queueMs: null, networkMs: 0, outputTokens: 90, resource: null },
    }),
  ]);
  assert.equal(report.comparisons[0].verdict, 'keep-baseline');
  assert.equal(report.recommendation.option, 'mac-only');
  assert.equal(report.recommendation.status, 'provisional');
  assert.ok(report.recommendation.reasons.includes('mini-tools-mac-inference: not run'));
  assert.deepEqual(report.unknowns, ['mini-only: queueMs unknown', 'mini-only: resource unknown']);
});

test('an option with several case sets is compared on the case set it shares with the baseline', () => {
  const report = placementReport([
    evidence({ option: 'mac-only' }),
    evidence({ option: 'mac-only', caseSet: 'combination x3', outcome: { passed: 6, total: 10 } }),
    evidence({
      option: 'mac-coder-mini-auditor',
      caseSet: 'combination x3',
      outcome: { passed: 4, total: 10 },
      failures: { ...crossNodeChecks, disconnectedAuditor: true },
    }),
  ]);
  const auditor = report.comparisons.find((c) => c.candidate === 'mac-coder-mini-auditor');
  assert.equal(auditor?.verdict, 'keep-baseline');
  assert.throws(
    () => placementReport([evidence({ option: 'mac-only' }), evidence({ option: 'mac-only' })]),
    /Duplicate evidence for mac-only on pack-1 x3/,
  );
});

test('committed F-006-T12 evidence yields the recorded provisional Mac-only recommendation', () => {
  const report = placementReport(placementEvidence(JSON.parse(readFileSync(COMMITTED, 'utf8'))));
  assert.deepEqual(
    report.comparisons.map((c) => `${c.baseline}->${c.candidate}:${c.verdict}`),
    [
      'mac-only->mini-only:insufficient-evidence',
      'mac-only->mac-coder-mini-auditor:insufficient-evidence',
      'mac-only->mini-tools-mac-inference:insufficient-evidence',
      'mini-only->mini-tools-mac-inference:insufficient-evidence',
    ],
  );
  const p3 = report.comparisons[2].reasons;
  assert.ok(p3.includes('mini-tools-mac-inference: cancellation not exercised live'));
  assert.ok(p3.some((r) => r.startsWith('case sets differ')));
  assert.ok(!p3.some((r) => r.includes('unavailableMac')), 'the P4 expiry/recovery check held');
  assert.deepEqual(report.recommendation, {
    option: 'mac-only',
    status: 'provisional',
    reasons: [
      'No placement beat the Mac-only baseline on equivalent live evidence.',
      'mac-coder-mini-auditor: not run',
    ],
  });
  assert.ok(report.unknowns.includes('mini-only: runtime unknown'));
  assert.ok(report.unknowns.includes('mini-tools-mac-inference: networkMs unknown'));
});

test('committed F-006-T26 evidence yields the recorded verdicts of the equivalent runs', () => {
  const report = placementReport(placementEvidence(JSON.parse(readFileSync(T26, 'utf8'))));
  assert.deepEqual(
    report.comparisons.map((c) => `${c.baseline}->${c.candidate}:${c.verdict}`),
    [
      'mac-only->mini-only:keep-baseline',
      'mac-only->mac-coder-mini-auditor:insufficient-evidence',
      'mac-only->mini-tools-mac-inference:keep-baseline',
      'mini-only->mini-tools-mac-inference:prefer-candidate',
    ],
  );
  assert.ok(report.comparisons[1].reasons.includes('mac-coder-mini-auditor: cancellation not exercised live'));
  assert.deepEqual(report.comparisons[3].reasons, [
    'mini-tools-mac-inference passes 24/30 vs 21/30 on the same cases and budget',
  ]);
  assert.equal(report.recommendation.option, 'mac-only');
  assert.equal(report.recommendation.status, 'provisional');
  assert.ok(!report.unknowns.some((u) => u.includes('runtime unknown')), 'the mini PC runtime is recorded');
});

test('committed F-006-T29 evidence compares P3 on the smoke and Casper cases', () => {
  const report = placementReport(placementEvidence(JSON.parse(readFileSync(T29, 'utf8'))));
  assert.deepEqual(
    report.comparisons.map((c) => `${c.baseline}->${c.candidate}:${c.verdict}`),
    [
      'mac-only->mini-only:keep-baseline',
      'mac-only->mac-coder-mini-auditor:insufficient-evidence',
      'mac-only->mini-tools-mac-inference:keep-baseline',
      'mini-only->mini-tools-mac-inference:prefer-candidate',
    ],
  );
  assert.deepEqual(report.comparisons[3].reasons, [
    'mini-tools-mac-inference passes 39/45 vs 27/45 on the same cases and budget',
  ]);
  assert.deepEqual(report.comparisons[2].reasons, [
    'mini-tools-mac-inference does not raise the pass rate on the same cases and budget',
  ]);
  assert.equal(report.recommendation.option, 'mac-only');
  assert.equal(report.recommendation.status, 'provisional');
});

test('evidence files with unknown fields, bad options or impossible outcomes are refused', () => {
  const valid = JSON.parse(readFileSync(COMMITTED, 'utf8')) as { evidence: Record<string, unknown>[] };
  const variant = (change: (e: Record<string, unknown>) => void) => {
    const copy = structuredClone(valid);
    change(copy.evidence[0]);
    return copy;
  };
  assert.throws(() => placementEvidence(variant((e) => (e.option = 'cloud'))), /option/);
  assert.throws(() => placementEvidence(variant((e) => (e.extra = 1))), /extra/);
  assert.throws(() => placementEvidence(variant((e) => (e.outcome = { passed: 3, total: 2 }))), /outcome/);
  assert.throws(() => placementEvidence(variant((e) => delete (e.identity as Record<string, unknown>).model)), /model/);
  assert.throws(
    () => placementEvidence(variant((e) => ((e.metrics as Record<string, unknown>).queueMs = -1))),
    /queueMs/,
  );
});

test('the placement report CLI prints the verdicts for an evidence file without a running service', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-placement-'));
  try {
    const run = spawnSync(
      process.execPath,
      [join(import.meta.dirname, '..', 'src', 'cli.ts'), 'placement', 'report', COMMITTED],
      {
        env: { ...process.env, NERV_HOME: home },
        encoding: 'utf8',
      },
    );
    assert.equal(run.status, 0, run.stderr);
    const printed = JSON.parse(run.stdout) as ReturnType<typeof placementReport>;
    assert.deepEqual(printed, placementReport(placementEvidence(JSON.parse(readFileSync(COMMITTED, 'utf8')))));
    assert.equal(printed.recommendation.option, 'mac-only');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
