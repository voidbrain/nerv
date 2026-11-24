# F-006-T29 placement report: P3 role cases with role-sized probes

This report updates the [F-006-T26 report](2026-11-24-f006-t26-placement-report.md) with the P3 role rerun after both bases moved to a revision with role-sized placement probes (PR #714) and the placement socket budget (PR #708). The verdicts come from `placementReport` in `src/placement-report.ts` over [2026-11-24-f006-t29-placement-evidence.json](2026-11-24-f006-t29-placement-evidence.json); `node src/cli.ts placement report EVIDENCE.json` prints them offline, and `test/placement-report.test.ts` checks that this file still yields them. Raw reports stay private in `~/.nerv-private` on their base. Only local models ran (0 paid tokens); the Mac run held the shared machine lock.

## What ran (2026-11-24)

| Step | Placement | Run | Limits | Result |
|---|---|---|---|---|
| F-006-T29 | P3 `mini-tools-mac-inference` | `tools/placement-live.mjs roles --transport=nerv,P3` on NERV-02 through its NERV service (`/api/placement/run` P3, NERV-01 `gemma4:12b` over WorkerLink); each role's own system message travels as the probe's `system` field | `limits-repeat3` (30 s/case, 15 min/suite, 61,440 tokens, repeat 3) | Casper 15/15; Misato 0/15 (15 errors, below); 321 s, 3,403 output tokens, no stop rule |

**Revisions.** NERV-01 ran `~/.nerv-app` at `c43bbb57`; NERV-02 ran `C:\Projects\nerv` at `d9d9aed4` (detached `HEAD`; `doctor`: no revision skew; `kaji list`: NERV-01 and NERV-02 enrolled). Both include PR #714 and PR #708. The four commits between them (`git log d9d9aed4..c43bbb57 --stat`) touch only the harness reconcile v10.9.0 (`.harness.json`, `AGENTS.md`, `docs/`, `tools/work-items.mjs`, `package.json`) and the Gauntlet ledger, nothing under `src/`: placement and remote inference are the same code on both bases.

**Load.** NERV-02: CPU 0–22 %, free memory 5.2–5.3 GB. NERV-01: load average 10.6–37.4, free memory 22–30 %: other sessions were active on the Mac while the lock was held, so the P3 latencies here are an upper bound.

## Results against F-006-T26

| Case set | `mac-only` (P1) | `mini-only` (P2) | P3, F-006-T26 | P3, F-006-T29 |
|---|---|---|---|---|
| neutral-smoke, repeat 3 | 24/30 | 21/30 | 24/30 | (not rerun) |
| Casper, repeat 3 | 15/15 | 6/15 | 4 passed, 11 cut at 15 s (B-119) | **15/15**, median 8.7 s, longest 20.9 s |
| Misato, repeat 3 | 9/15 | 3/15 | not run (over the 8 KiB probe limit) | 0/15: refused by the probe token budget (B-131) |
| neutral-smoke + Casper, repeat 3 | 39/45, median 4.9 s | 27/45, median 1.0 s | not comparable | **39/45**, median 5.0 s, overhead 119 ms |

The P1 and P2 subsets are recounted per case from the same private F-006-T14 and F-006-T23 reports that gave the F-006-T26 totals (48/60 and 30/60 reproduce exactly).

## Verdicts

| Baseline → candidate | Case set | Verdict | Main reason |
|---|---|---|---|
| `mac-only` → `mini-only` | smoke + roles, repeat 3 | keep baseline | 30/60 vs 48/60 |
| `mac-only` → `mac-coder-mini-auditor` | `combination-v1` coder-reviewer | insufficient evidence | unavailable-Mac, cancellation and uncertain-outcome checks not run on the auditor route |
| `mac-only` → `mini-tools-mac-inference` | smoke + Casper, repeat 3 | keep baseline | 39/45 vs 39/45: same pass rate |
| `mini-only` → `mini-tools-mac-inference` | smoke + Casper, repeat 3 | prefer candidate | 39/45 vs 27/45 |

**Recommendation: unchanged. Keep Mac-only (P1) as the default for coder and reviewer roles, still provisional.** The P3 comparisons now include a role pack: with Casper's own system message P3 matches the Mac on every case (15/15) and still beats the mini PC's own model (39/45 vs 27/45), at about 5 s median against 1 s. P3 remains the placement for work that must execute on the mini PC; it does not beat running on the Mac. The coder-alone default and the auditor findings of F-006-T26 are unchanged.

## B-119 live check

Passed. Probes longer than 15 s now return through `/api/placement/run`: a Casper case completed at 20.9 s, and Misato errors at 20.7 s and 22.4 s came back as NERV's own error messages, not `other side closed`. No case ended at 15 s (F-006-T23 had 11).

## Limits of this evidence

- **Misato is still not comparable.** `placementProbe` sets the probe's total token budget to 2 × `maxOutputTokens` (4,096 for the driver's 2,048), and the runtime counts input tokens against it after the Mac replies. Misato's system message alone is about 4,500 tokens, so 14 of 15 cases ended with `Orchestrated token budget exhausted (4781–5206 > 4096).` after generation, and the first with `Worker result unknown after timeout.` at 30 s. This is a NERV defect, not a model outcome, so these 15 errors are left out of the evidence instead of counted as failures (B-131). The Misato half reruns after the fix (F-006-T31).
- **Smoke and Casper ran at different revisions** (NERV-02 `c9fc9994` and `d9d9aed4`); the smoke path sends no system message and did not change between them.
- **Different paths per placement**, as in F-006-T26: P1/P2 used Gauntlet against loopback Ollama (P1 with thinking on); P3 used NERV-01's serve settings over WorkerLink.
- **Unknown stays unknown:** queue time everywhere and several resource figures are `null` in the evidence.
