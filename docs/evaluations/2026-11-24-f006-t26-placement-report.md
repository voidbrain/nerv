# F-006-T26 placement report: the equivalent runs

This report updates the [F-006-T12 report](2026-11-23-f006-t12-placement-report.md) with the live runs the owner authorized on 2026-11-23/24 (F-006-T22). The verdicts come from `placementReport` in `src/placement-report.ts` over [2026-11-24-f006-t26-placement-evidence.json](2026-11-24-f006-t26-placement-evidence.json); `node src/cli.ts placement report EVIDENCE.json` prints them offline, and `test/placement-report.test.ts` checks that this file still yields them. An option may now carry evidence for up to three case sets; each pair is compared on the case set both share. Raw reports stay private in `~/.nerv-private/placement` on their base. Only local models ran (0 paid tokens); every Mac run held the shared machine lock.

## What ran (2026-11-24)

| Step | Placement | Run | Limits | Result |
|---|---|---|---|---|
| F-006-T23 | P2 `mini-only` | Gauntlet `model-run --pack=neutral-smoke` and `role-run --role=both` on NERV-02, `qwen2.5:1.5b` | `limits-repeat3` (30 s/case, 15 min/suite, 61,440 tokens, repeat 3), `baseline-load` | smoke 21/30, roles 9/30 (4 timeouts) |
| F-006-T23 | P3 `mini-tools-mac-inference` | `tools/placement-live.mjs` on NERV-02 through its NERV service (`/api/placement/run` P3, NERV-01 `gemma4:12b` over WorkerLink) | the same `limits-repeat3` | smoke 24/30; roles not comparable (below) |
| F-006-T24 | `mac-only` | `combination-v1`, coder and reviewer `gemma4:12b` on NERV-01 | one `totalBudget` per mode: 6,144 tokens, 360 s, 30 s/case, repeat 3, 256 tokens per call | coder-alone 9/24, coder-reviewer 15/24 |
| F-006-T24 | `mac-coder-mini-auditor` | coder `gemma4:12b` on NERV-01, auditor `qwen2.5:1.5b` through NERV-02's placement P2 over SSH | the same `totalBudget` | coder-alone 9/24, coder-reviewer 11/24 |
| F-006-T25 | P3 and the auditor route | cancellation, uncertain outcome, NERV on NERV-02 stopped and restarted | single bounded probes | all held (below) |

The P1 Mac baseline is the F-006-T14 moderate-load run (48/60; smoke 24/30); its median case latency, 5,524 ms, was read from those private reports for this update. The mini PC runtime is now recorded: Ollama 0.40.16, as on the Mac.

## Verdicts

| Baseline → candidate | Case set | Verdict | Main reason |
|---|---|---|---|
| `mac-only` → `mini-only` | smoke + roles, repeat 3 | keep baseline | 30/60 vs 48/60 |
| `mac-only` → `mac-coder-mini-auditor` | `combination-v1` coder-reviewer | insufficient evidence | unavailable-Mac, cancellation and uncertain-outcome checks not run on the auditor route (it also scored lower: 11/24 vs 15/24) |
| `mac-only` → `mini-tools-mac-inference` | smoke, repeat 3 | keep baseline | 24/30 vs 24/30: same pass rate |
| `mini-only` → `mini-tools-mac-inference` | smoke, repeat 3 | prefer candidate | 24/30 vs 21/30 |

**Recommendation: keep Mac-only (P1) as the default for coder and reviewer roles, still provisional.** The code keeps it provisional because one comparison is insufficient and one prefers a candidate over the mini PC baseline, not over the Mac. On the mini PC, executing with Mac inference (P3) beats its own `qwen2.5:1.5b` (24/30 vs 21/30, at 4.4 s vs 0.8 s median), so P3 is the placement for work that must execute on the mini PC; it does not beat running on the Mac.

**Coder alone or coder with reviewer.** The campaign rule recommends the pair only with a pass rate at least equal, 0 false rejections and 0 shared blind spots under the same `totalBudget`. Neither placement qualifies: on the Mac the reviewer raised 9/24 to 15/24 and caught every flawed patch (missed flaws 3 → 0), but rejected the correct idempotent-release patch in all 3 repeats; the mini PC auditor raised 9/24 to 11/24 with 4 false rejections and 3 missed flaws. Keep coder-alone as the default; a Mac reviewer is the better auditor where one is used.

## Failure checks (F-006-T25)

- **Disconnected auditor: held.** NERV on NERV-02 was stopped (`service stop`, 03:17) and two `combination-v1` cases ran with the auditor there: both ended as errors and none was graded: the coder's own vote never stood in for the missing auditor. NERV was started again (`service start`, 03:19); `doctor` reported `c9fc9994` with no revision skew, `kaji list` showed NERV-01, NERV-02 and NERV-03 enrolled, and P3 and P2 probes answered `READY` on their own routes.
- **Cancellation: held, with a cost.** A P3 probe cancelled by the client after 1.5 s returned nothing and fell back nowhere; the route answered `READY` again with the same provenance. The cancellation does not reach the Mac: the generation kept the model busy, so the next probe waited past NERV-02's 15 s request limit.
- **Uncertain outcome: held.** A P3 probe whose 1 s budget expired mid-generation answered `Worker result unknown after timeout.` with no text and no provenance (no local or cloud result), and the next probe recovered.
- **Unavailable Mac**: held in F-006-T11 (P4); not repeated.

## Limits of this evidence

- **P3 roles are not comparable.** The Casper prompts ran folded into one message (the placement probe has no system field); 11 of them ended at 15 s because NERV's HTTP server cuts any request at 15 s and `/api/placement/run`, unlike the chat routes, does not extend it (B-119). The 5 Misato prompts (about 17,300 characters) exceed the probe's 8,192-character limit and could not run. The role half of P3 is therefore left out of the evidence; F-006-T27 makes the probe carry role-sized prompts and reruns it.
- **P2 roles:** four consecutive timeouts occurred; the Gauntlet runner does not enforce the campaign's stop rule, so the run continued (3 later passes). With the stop rule applied it would read 27/60; the verdict is the same.
- **Different paths per placement:** P1/P2 used Gauntlet directly against loopback Ollama (P1 with thinking on); P3 used NERV-01's serve settings over WorkerLink; the combination runs used the campaign driver with thinking off. The auditor handoff went over SSH because NERV has no cross-node auditor delegation yet, so its 581 ms median overhead is not WorkerLink's.
- **Unknown stays unknown:** queue time everywhere, the mini auditor's output tokens (the local route reports none) and several resource figures are `null` in the evidence.
