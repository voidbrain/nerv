# F-006-T12 placement report and recommendation

Updated by the [F-006-T26 report](2026-11-24-f006-t26-placement-report.md) with the equivalent live runs; this file stays as the 2026-11-23 evidence.

This report applies the decision criteria of the [placement campaign](../decisions/placement-campaign.md) (section 5) to the live evidence recorded so far. No model was run for it. The verdicts come from `placementReport` in `src/placement-report.ts` over the committed aggregates in [2026-11-23-f006-t12-placement-evidence.json](2026-11-23-f006-t12-placement-evidence.json); `test/placement-report.test.ts` checks that this file still yields the verdicts below. `node src/cli.ts placement report EVIDENCE.json` prints the same verdicts for an updated evidence file, offline and without a model call. Raw reports stay private on their originating base.

## Placements compared

| Option | Plan | Worker | Inference | Live evidence |
|---|---|---|---|---|
| `mac-only` | P1 | NERV-01 | NERV-01 loopback `gemma4:12b` | F-006-T13/T14 moderate-load runs: 48/60 (`neutral-smoke` 24/30, roles 24/30), 9,948 output tokens, median first token 494 ms |
| `mini-only` | P2 | NERV-02 | NERV-02 loopback `qwen2.5:1.5b` | F-006-T11 probe: `READY` in 7,763 ms |
| `mini-tools-mac-inference` | P3 | NERV-02 | NERV-01 `gemma4:12b` over the signed WorkerLink | F-006-T11 probe: `READY` in 2,244 ms, 65 tokens |
| `mini-tools-mac-inference`, Mac unavailable | P4 | NERV-02 | NERV-01 stopped, then restarted | Expired after the 5,000 ms wait budget with no local or cloud fallback; after restart `READY` in 2,448 ms, 57 tokens |
| `mac-coder-mini-auditor` | — | NERV-01 coder, NERV-02 auditor | split | Not run |

Identity is bound per option in the evidence file: model and digest where recorded, runtime, hardware, memory and concurrent load. The mini PC used one normal home baseline; no separate office/day/night matrix and no added inference or tools-test contention, because no concurrent NERV work called for it. The Mac's load cost comes from the [operating-conditions report](2026-11-22-f006-t14-mac-operating-conditions.md): heavy work cut generation by about 18–21% with unchanged outcomes.

## Verdicts

| Baseline → candidate | Verdict | Main reasons |
|---|---|---|
| `mac-only` → `mini-only` | insufficient evidence | different case sets and budgets (one probe vs the repeat-3 packs); mini PC runtime version not recorded |
| `mac-only` → `mac-coder-mini-auditor` | insufficient evidence | no evidence |
| `mac-only` → `mini-tools-mac-inference` | insufficient evidence | different case sets and budgets; cancellation and uncertain outcome not exercised live |
| `mini-only` → `mini-tools-mac-inference` | insufficient evidence | mini PC runtime unknown; cancellation and uncertain outcome not exercised live |

The P4 check held: an unavailable Mac expired within its wait budget, kept execution on NERV-02, made no fallback and recovered. No comparison was rejected.

## Recommendation

**Keep the Mac-only placement (P1) as the default for coder and reviewer roles: provisional.** No candidate beat it on equivalent live evidence, and the probes are bounded smoke checks, not task outcomes. P3 is a working, recoverable route: mini PC execution with Mac inference answered faster than the mini PC's own model (2.2 s vs 7.8 s) and failed cleanly while the Mac was down. That makes it the candidate to measure next, not one to promote.

Context from [F-078-T09](2026-11-22-f078-t09-tabgha-campaign.md) points the same way but does not count here: it used other models, another budget and a forwarded loopback port instead of the WorkerLink. There, local Misato planning on the mini PC timed out on most cases, while the larger Mac model answered within budget.

## What would settle it

The recommendation becomes supported only with live evidence from the enrolled Mac and mini PC:

1. P2 and P3 `role-run --role=both` and `neutral-smoke` with `limits-repeat3`, the same cases and budget as P1, recording the runtime version, queue and network time and sampled resources.
2. The `combination-v1` pack, `coder-alone` and `coder-reviewer`, under one `totalBudget`, for `mac-only` and `mac-coder-mini-auditor`.
3. Bounded live checks that a disconnected auditor, a cancellation and an uncertain outcome keep privacy, leases and permission gates on the cross-node placements.

Until then, unknown metrics stay unknown; the evidence file lists them as `null`.
