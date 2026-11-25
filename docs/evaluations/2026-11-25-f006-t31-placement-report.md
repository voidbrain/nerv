# F-006-T31 placement report: P3 Casper and Misato with the fixed probe budget

This report updates the [F-006-T29 report](2026-11-24-f006-t29-placement-report.md) with the P3 role rerun after NERV-02 moved to a revision with the B-131 probe budget (PR #735). The verdicts come from `placementReport` in `src/placement-report.ts` over [2026-11-25-f006-t31-placement-evidence.json](2026-11-25-f006-t31-placement-evidence.json); `node src/cli.ts placement report EVIDENCE.json` prints them offline, and `test/placement-report.test.ts` checks that this file still yields them. Raw reports stay private in `~/.nerv-private` on their base. Only local models ran (0 paid tokens); the Mac run held the shared machine lock.

## What ran (2026-11-25)

| Step | Placement | Run | Limits | Result |
|---|---|---|---|---|
| F-006-T31 | P3 `mini-tools-mac-inference` | `tools/placement-live.mjs roles --transport=nerv,P3` on NERV-02 through its NERV service (`/api/placement/run` P3, NERV-01 `gemma4:12b` over WorkerLink); each role's own system message travels as the probe's `system` field | `limits-repeat3` (30 s/case, 15 min/suite, 61,440 tokens, repeat 3) | Casper 15/15; Misato 8/15 (3 failed, 4 invalid, 0 errors); 254 s, 5,975 output tokens, no stop rule |

**Revisions.** NERV-02 ran `C:\Projects\nerv` at `e05aae22` (detached `HEAD`, updated 2026-11-25 for F-006-T30; `doctor`: build 1.735, no revision skew; `kaji list`: NERV-01, NERV-02 and NERV-03 enrolled). NERV-01 ran `~/.nerv-app` at `03316fbd`, an ancestor of `e05aae22` (read only). The probe budget is applied on the executing base (NERV-02), which has PR #735. Between the two revisions (`git diff --stat 03316fbd e05aae22 -- src`) nothing changed in the WorkerLink receiver or `src/model.ts`; `src/placement-campaign.ts` (the B-131 fix) and `src/executors.ts` changed, and the role asks were built on NERV-02 from its own revision.

**Load.** NERV-02: CPU 2–13 %, free memory 5.1 GB. NERV-01: load average 2.4–5.5, free memory 24–34 %.

## Results against F-006-T29

| Case set | `mac-only` (P1) | `mini-only` (P2) | P3, F-006-T29 | P3, F-006-T31 |
|---|---|---|---|---|
| neutral-smoke, repeat 3 | 24/30 | 21/30 | 24/30 (F-006-T23, not rerun) | 24/30 (F-006-T23, not rerun) |
| Casper, repeat 3 | 15/15 | 6/15 | 15/15 | **15/15**, median 8.3 s, longest 14.9 s |
| Misato, repeat 3 | 9/15 | 3/15 (4 errors) | 0/15: refused by the probe token budget (B-131) | **8/15**, median 7.4 s, longest 28.1 s, 0 errors |
| neutral-smoke + both roles, repeat 3 | 48/60, median 5.5 s | 30/60, median 1.2 s | not comparable | **47/60**, median 5.5 s, overhead 122 ms |

Misato's failures on P3 are the cases that fail on P1 too: `exact-reminder` 0/3 and `correct-rejected-time` 0/3 on both placements; the only difference is `italian-missing-title` (P1 3/3, P3 2/3). They are graded model answers (3 failed, 4 invalid JSON), not NERV errors. P1 used Gauntlet with thinking on; P3 used NERV-01's serve settings, so the one-case difference is within the different paths listed below.

## Verdicts

| Baseline → candidate | Case set | Verdict | Main reason |
|---|---|---|---|
| `mac-only` → `mini-only` | smoke + roles, repeat 3 | keep baseline | 30/60 vs 48/60 |
| `mac-only` → `mac-coder-mini-auditor` | `combination-v1` coder-reviewer | insufficient evidence | unavailable-Mac, cancellation and uncertain-outcome checks not run on the auditor route |
| `mac-only` → `mini-tools-mac-inference` | smoke + roles, repeat 3 | keep baseline | 47/60 vs 48/60: no higher pass rate |
| `mini-only` → `mini-tools-mac-inference` | smoke + roles, repeat 3 | prefer candidate | 47/60 vs 30/60 |

**Recommendation: unchanged. Keep Mac-only (P1) as the default for coder and reviewer roles, still provisional.** The P3 role half is now settled on the same cases and budget as P1: with both roles' own system messages P3 is within one case of the Mac (47/60 vs 48/60) at the same median latency, and beats the mini PC's own model (47/60 vs 30/60). P3 remains the placement for work that must execute on the mini PC; it does not beat running on the Mac.

## B-131 live check

Passed. All 15 Misato probes (about 4,500 input tokens each, `maxOutputTokens` 2,048) returned a graded answer through `/api/placement/run` on NERV-02: no `Orchestrated token budget exhausted` and no other error (F-006-T29: 15 errors). The longest case took 28.1 s, inside the 30 s case limit.

## Limits of this evidence

- **Smoke and roles ran at different revisions** (NERV-02 `c9fc9994` for smoke, `e05aae22` for roles); the smoke path sends no system message, and its prompts are short, so the B-131 budget change was not rerun on it.
- **Different paths per placement**, as in F-006-T26: P1/P2 used Gauntlet against loopback Ollama (P1 with thinking on); P3 used NERV-01's serve settings over WorkerLink.
- **Unknown stays unknown:** queue time everywhere and several resource figures are `null` in the evidence.
