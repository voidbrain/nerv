// F-006-T12: placement report and recommendation. Pure: it reads aggregate evidence and
// returns verdicts; it never runs a model, schedules work or grants a route.

export type PlacementOption = 'mac-only' | 'mini-only' | 'mac-coder-mini-auditor' | 'mini-tools-mac-inference';

/** A safety check: true held, false violated, null not exercised on live targets. */
type Check = boolean | null;

export interface PlacementEvidence {
  option: PlacementOption;
  /** Only `live` evidence from selected, authorized, enrolled targets can establish suitability. */
  source: 'live' | 'fixture';
  enrolledTargets: boolean;
  identity: {
    model: string | null;
    runtime: string | null;
    hardware: string | null;
    memory: string | null;
    concurrentLoad: string | null;
  };
  /** Case pack and repeats; comparisons need the same value on both sides. */
  caseSet: string;
  /** Budget identity (timeouts, token caps); comparisons need the same value on both sides. */
  budget: string;
  outcome: { passed: number; total: number } | null;
  metrics: {
    latencyMedianMs: number | null;
    queueMs: number | null;
    networkMs: number | null;
    outputTokens: number | null;
    resource: string | null;
  };
  /** Each must preserve privacy, leases and permission gates; fallback to another route is a violation. */
  failures: {
    unavailableMac: Check;
    disconnectedAuditor: Check;
    cancellation: Check;
    uncertainOutcome: Check;
  };
}

export type Verdict = 'prefer-candidate' | 'keep-baseline' | 'insufficient-evidence' | 'rejected';

export interface PlacementComparison {
  baseline: PlacementOption;
  candidate: PlacementOption;
  verdict: Verdict;
  reasons: string[];
}

export interface PlacementReport {
  comparisons: PlacementComparison[];
  recommendation: { option: PlacementOption; status: 'supported' | 'provisional'; reasons: string[] };
  unknowns: string[];
}

const MAC_DEPENDENT: PlacementOption[] = ['mac-coder-mini-auditor', 'mini-tools-mac-inference'];
const PAIRS: [PlacementOption, PlacementOption][] = [
  ['mac-only', 'mini-only'],
  ['mac-only', 'mac-coder-mini-auditor'],
  ['mac-only', 'mini-tools-mac-inference'],
  ['mini-only', 'mini-tools-mac-inference'],
];

const OPTIONS: PlacementOption[] = ['mac-only', 'mini-only', ...MAC_DEPENDENT];

function record(value: unknown, at: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at} must be an object.`);
  const v = value as Record<string, unknown>;
  const extra = Object.keys(v).find((key) => !keys.includes(key));
  if (extra) throw new Error(`${at}.${extra} is not a placement evidence field.`);
  return v;
}

function nullable(v: Record<string, unknown>, at: string, keys: string[], type: 'string' | 'number' | 'boolean') {
  for (const key of keys)
    if (v[key] !== null && (typeof v[key] !== type || (type === 'number' && !((v[key] as number) >= 0))))
      throw new Error(`${at}.${key} must be ${type === 'number' ? 'a non-negative number' : `a ${type}`} or null.`);
}

/** Validates `{ evidence: PlacementEvidence[] }` read from a file; unknown fields and shapes are refused. */
export function placementEvidence(value: unknown): PlacementEvidence[] {
  const top = record(value, 'evidence file', ['source', 'evidence']);
  if (!Array.isArray(top.evidence) || top.evidence.length > OPTIONS.length)
    throw new Error(`evidence must be an array of at most ${OPTIONS.length} entries.`);
  return top.evidence.map((entry, i) => {
    const at = `evidence[${i}]`;
    const e = record(entry, at, [
      'option',
      'source',
      'enrolledTargets',
      'identity',
      'caseSet',
      'budget',
      'outcome',
      'metrics',
      'failures',
    ]);
    if (!OPTIONS.includes(e.option as PlacementOption))
      throw new Error(`${at}.option must be one of ${OPTIONS.join(', ')}.`);
    if (e.source !== 'live' && e.source !== 'fixture') throw new Error(`${at}.source must be live or fixture.`);
    if (typeof e.enrolledTargets !== 'boolean') throw new Error(`${at}.enrolledTargets must be a boolean.`);
    for (const key of ['caseSet', 'budget'])
      if (typeof e[key] !== 'string' || !e[key]) throw new Error(`${at}.${key} must be a non-empty string.`);
    const identityKeys = ['model', 'runtime', 'hardware', 'memory', 'concurrentLoad'];
    nullable(record(e.identity, `${at}.identity`, identityKeys), `${at}.identity`, identityKeys, 'string');
    const metricKeys = ['latencyMedianMs', 'queueMs', 'networkMs', 'outputTokens'];
    const metrics = record(e.metrics, `${at}.metrics`, [...metricKeys, 'resource']);
    nullable(metrics, `${at}.metrics`, metricKeys, 'number');
    nullable(metrics, `${at}.metrics`, ['resource'], 'string');
    const failureKeys = ['unavailableMac', 'disconnectedAuditor', 'cancellation', 'uncertainOutcome'];
    nullable(record(e.failures, `${at}.failures`, failureKeys), `${at}.failures`, failureKeys, 'boolean');
    if (e.outcome !== null) {
      const o = record(e.outcome, `${at}.outcome`, ['passed', 'total']);
      if (
        !Number.isSafeInteger(o.passed) ||
        !Number.isSafeInteger(o.total) ||
        (o.passed as number) < 0 ||
        (o.passed as number) > (o.total as number)
      )
        throw new Error(`${at}.outcome needs integers 0 <= passed <= total.`);
    }
    return e as unknown as PlacementEvidence;
  });
}

function requiredFailures(option: PlacementOption): (keyof PlacementEvidence['failures'])[] {
  if (option === 'mac-coder-mini-auditor')
    return ['unavailableMac', 'disconnectedAuditor', 'cancellation', 'uncertainOutcome'];
  if (option === 'mini-tools-mac-inference') return ['unavailableMac', 'cancellation', 'uncertainOutcome'];
  return [];
}

function missingIdentity(e: PlacementEvidence): string[] {
  return Object.entries(e.identity)
    .filter(([, value]) => value === null || value === '')
    .map(([key]) => `${e.option}: ${key} unknown`);
}

export function comparePlacement(
  baseline: PlacementEvidence | undefined,
  candidate: PlacementEvidence | undefined,
  options: { baseline: PlacementOption; candidate: PlacementOption },
): PlacementComparison {
  const result = (verdict: Verdict, reasons: string[]): PlacementComparison => ({ ...options, verdict, reasons });
  if (!candidate) return result('insufficient-evidence', [`${options.candidate}: no evidence`]);
  const violated = requiredFailures(candidate.option).filter((name) => candidate.failures[name] === false);
  if (violated.length)
    return result(
      'rejected',
      violated.map((name) => `${candidate.option}: ${name} did not preserve privacy, leases or gates`),
    );
  if (!baseline) return result('insufficient-evidence', [`${options.baseline}: no evidence`]);
  const reasons: string[] = [];
  for (const e of [baseline, candidate]) {
    if (e.source !== 'live' || !e.enrolledTargets)
      reasons.push(`${e.option}: fixture or unenrolled evidence cannot establish real-device suitability`);
    reasons.push(...missingIdentity(e));
    if (!e.outcome || e.outcome.total <= 0) reasons.push(`${e.option}: no task outcome`);
  }
  if (baseline.caseSet !== candidate.caseSet)
    reasons.push(`case sets differ (${baseline.caseSet} vs ${candidate.caseSet})`);
  if (baseline.budget !== candidate.budget) reasons.push(`budgets differ (${baseline.budget} vs ${candidate.budget})`);
  for (const name of requiredFailures(candidate.option))
    if (candidate.failures[name] === null) reasons.push(`${candidate.option}: ${name} not exercised live`);
  if (reasons.length) return result('insufficient-evidence', reasons);
  const rate = (e: PlacementEvidence) => e.outcome!.passed / e.outcome!.total;
  if (rate(candidate) > rate(baseline)) {
    if (candidate.metrics.latencyMedianMs === null)
      return result('insufficient-evidence', [`${candidate.option}: higher pass rate but latency unknown`]);
    return result('prefer-candidate', [
      `${candidate.option} passes ${candidate.outcome!.passed}/${candidate.outcome!.total} vs ${baseline.outcome!.passed}/${baseline.outcome!.total} on the same cases and budget`,
    ]);
  }
  return result('keep-baseline', [`${candidate.option} does not raise the pass rate on the same cases and budget`]);
}

/** Compares every placement against its baseline; the Mac-only baseline stays recommended unless a candidate wins. */
export function placementReport(evidence: PlacementEvidence[]): PlacementReport {
  const byOption = new Map<PlacementOption, PlacementEvidence>();
  for (const e of evidence) {
    if (byOption.has(e.option)) throw new Error(`Duplicate evidence for ${e.option}.`);
    byOption.set(e.option, e);
  }
  const comparisons = PAIRS.map(([baseline, candidate]) =>
    comparePlacement(byOption.get(baseline), byOption.get(candidate), { baseline, candidate }),
  );
  const winners = comparisons.filter((c) => c.verdict === 'prefer-candidate' && c.baseline === 'mac-only');
  const unknowns = [
    ...new Set(
      evidence.flatMap((e) => [
        ...missingIdentity(e),
        ...Object.entries(e.metrics)
          .filter(([, value]) => value === null)
          .map(([key]) => `${e.option}: ${key} unknown`),
      ]),
    ),
  ];
  if (winners.length === 1)
    return {
      comparisons,
      recommendation: { option: winners[0].candidate, status: 'supported', reasons: winners[0].reasons },
      unknowns,
    };
  const mac = byOption.get('mac-only');
  const supported =
    winners.length === 0 && comparisons.every((c) => c.verdict === 'keep-baseline' || c.verdict === 'rejected');
  return {
    comparisons,
    recommendation: {
      option: 'mac-only',
      status: supported && mac?.source === 'live' ? 'supported' : 'provisional',
      reasons: [
        winners.length > 1
          ? 'More than one placement beat the Mac-only baseline; the owner chooses between them.'
          : 'No placement beat the Mac-only baseline on equivalent live evidence.',
        ...MAC_DEPENDENT.filter((o) => !byOption.has(o)).map((o) => `${o}: not run`),
      ],
    },
    unknowns,
  };
}
