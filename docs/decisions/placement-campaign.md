# Placement campaign plan and budgets (F-006-T04)

**Status: approved by the owner on 15 November 2026 (F-006-T17) with `repeat: 3` (3 runs per case); F-006-T19 restated all budgets, stop rules, and dry-run plans for `repeat: 3`; proposed 14 November 2026 (F-006-T04); enrolled Mac + mini PC execution in F-006-T11.** References [Remote inference](remote-inference.md), [Configuration qualification](configuration-qualification.md), [Mac operating-conditions plan](mac-operating-conditions.md), and [NERV host assignments and load acceptance](../evaluations/mac-load-scenarios.md).

## 1. Campaign scope and placement questions

The placement campaign compares candidate configurations across the enrolled Mac and home mini PC before any cross-node coder/reviewer or specialist placement is promoted:

| Placement configuration | Execution worker | Inference endpoint | Scenario declaration | Placement question |
|---|---|---|---|---|
| **P1 — Mac local baseline** | Mac (`NERV-01`, local) | Mac loopback S² (`http://127.0.0.1:11434`) | `moderate-load.json` (`moderate-load@1.0.0`) | What is the single-host Mac reference for role accuracy, latency, and combination pass rate? |
| **P2 — Mini PC local baseline** | Mini PC (`NERV-02`, local) | Mini PC loopback S² (`http://127.0.0.1:11434`) | `baseline-load.json` (`baseline-load@1.0.0`) | Does the mini PC's own local model fit Casper/Misato/reviewer budgets without Mac dependency? |
| **P3 — Mini PC worker + Mac remote inference** | Mini PC (`NERV-02`, worker) | Mac (`NERV-01` via `models.remote.endpoints.mac` over Tailscale `WorkerLink`) | Mini PC `baseline-load.json` + Mac `moderate-load.json` | Does executing tools/tests on the mini PC while calling the larger Mac model over `WorkerLink` improve pass rate within latency/token budgets? |
| **P4 — Mac unavailability & wake recovery on P3** | Mini PC (`NERV-02`, worker) | Mac (`NERV-01` remote endpoint: offline → expiry; wake within `waitBudgetMs` → recovery) | Mini PC `baseline-load.json` | When Mac inference is unavailable, does the mini PC wait within `waitBudgetMs`, expire cleanly with zero fallback, and recover when Mac reconnects? |

- As recorded in [NERV host assignments and load acceptance](../evaluations/mac-load-scenarios.md), the home mini PC has **one normal baseline** (`baseline-load.json`, no unrelated office work apps) and does not repeat a separate day/night matrix.
- Only local and owner-enrolled Tailscale bases (`owner-bases` / `local-only` privacy) are used; `models.cloud` remains off (`0` paid cloud API tokens).

## 2. Exact case packs, repeats, and equal-budget controls

Every placement candidate runs the same deterministic case packs with `repeat: 3` (`--fresh`, temperature `0`, fixed `seed: 42`):

1. **Common smoke pack (`neutral-smoke`)**: 10 cases × 3 repeats = 30 runs (`model-run --pack=neutral-smoke`, `repeat: 3`).
2. **NERV role bundle (`role-run --role=both`)**: 10 cases × 3 repeats = 30 runs (`5` Casper from `evals/casper-v1.json` + `5` Misato from `evals/planner-v1.json`, `repeat: 3`), including `2` holdout cases per full corpus when expanded (`--limit=8`).
3. **Combination qualification pack (`evals/combination-v1.json`)**: 8 cases × 3 repeats = 24 runs per mode (`6` regression + `2` holdout across `hidden-acceptance`, `deliberately-flawed-patch`, `false-rejection`, and `shared-blind-spot`), comparing `coder-alone` vs `coder-reviewer` under the **exact same `totalBudget`** (`outputTokens: 6144`, `suiteMs: 360000`, `caseMs: 30000`, `repeat: 3`) and protected grader hash (`createProtectedGrader`).
4. **Dependency recovery check (P4)**: 2 bounded orchestration probes × 3 repeats = 6 probe runs on the mini PC (`waitBudgetMs: 5000` expiry while Mac `WorkerLink` is stopped; `waitBudgetMs: 15000` recovery when Mac reconnects within budget), verifying zero fallback and clean degraded-reason reporting.

## 3. Explicit budgets and stop rules

| Budget dimension | Per-pack limit (`limits-repeat3.json`) | Combination pack limit (`combination-v1`) | Aggregate campaign ceiling (P1–P4) |
|---|---|---|---|
| **Cases (`repeat: 3`)** | 10 cases × 3 = 30 runs (`neutral-smoke`), 10 cases × 3 = 30 runs (`role-run`) | 8 cases × 3 × 2 modes (`coder-alone`, `coder-reviewer`) = 48 runs | **258 case/probe runs total** (86 cases/probes × 3 repeats) across Mac and mini PC |
| **Per-case timeout (`caseMs`)** | 30 s (`30000` ms) | 30 s (`30000` ms) | 30 s/run hard cap |
| **Suite wall-clock cap (`suiteMs`)** | 15 min (`900000` ms) | 6 min (`360000` ms) per mode | **~2 h (120 min) active evaluation time** (**180 min / 3 h** wall-clock max) |
| **Output token cap (`outputTokens`)** | 61,440 tokens/suite | 6,144 tokens/mode | **393,216 tokens ceiling** (expected < 60,000 total) |
| **Handoff & retry bounds** | `maxAttempts: 1` | `maxRounds: 2` (`structured-patch-review-v1`) | Non-recursive delegation (`maxDelegations: 1`) |
| **Monetary cost** | `0` (local/Tailscale only) | `0` (local/Tailscale only) | **0 paid API tokens** |

- **Stop rules (abort immediately without fallback or retry)**:
  1. Any unexpected route substitution, non-Tailscale remote address, or ungranted `worker.infer` call.
  2. Grader tamper detection (`tamperDetected: true`) or source/artifact digest mismatch during the run.
  3. 3 consecutive case timeouts (`caseMs`), thermal throttling on either host, or total wall-clock time exceeding **180 min (3 h)**.

## 4. Owner execution workflow (after F-006-T17 approval)

The pasteable P2–P4 workflow is [F-006 placement P2–P4](../acceptance/f006-placement-p2-p4.md). Its authenticated `placement plan` command performs selection with zero model calls; `placement run` requires explicit execution confirmation and probes inference only, never a tool effect.

Keep all machine profiles and raw report artifacts in `$HOME/.nerv-private/` outside git.

### Step A — Generate private machine profiles on Mac and mini PC

```bash
# On Mac (NERV-01):
mkdir -p "$HOME/.nerv-private/placement"
node tools/gauntlet.mjs machine --id=mac-local > "$HOME/.nerv-private/placement/mac-machine.json"

# On mini PC (NERV-02):
mkdir -p "$HOME/.nerv-private/placement"
node tools/gauntlet.mjs machine --id=mini-local > "$HOME/.nerv-private/placement/mini-machine.json"
```

### Step B — Verify dry-run plans (`repeat: 3`, zero model calls)

```bash
# Write repeat: 3 limits matching Section 3 budgets
cat > "$HOME/.nerv-private/placement/limits-repeat3.json" <<'EOF'
{
  "caseMs": 30000,
  "suiteMs": 900000,
  "maxCases": 10,
  "repeat": 3,
  "outputTokens": 61440,
  "maxBytes": 1048576
}
EOF

# Mac baseline plan (P1)
node tools/gauntlet.mjs model-plan \
  --pack=neutral-smoke \
  --profile="$HOME/.nerv-private/placement/mac-profile.json" \
  --limits="$HOME/.nerv-private/placement/limits-repeat3.json" \
  --machine-profile="$HOME/.nerv-private/placement/mac-machine.json" \
  --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json

node tools/gauntlet.mjs role-plan \
  --role=both \
  --profile="$HOME/.nerv-private/placement/mac-profile.json" \
  --limits="$HOME/.nerv-private/placement/limits-repeat3.json" \
  --machine-profile="$HOME/.nerv-private/placement/mac-machine.json" \
  --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json

# Mini PC baseline plan (P2)
node tools/gauntlet.mjs role-plan \
  --role=both \
  --profile="$HOME/.nerv-private/placement/mini-profile.json" \
  --limits="$HOME/.nerv-private/placement/limits-repeat3.json" \
  --machine-profile="$HOME/.nerv-private/placement/mini-machine.json" \
  --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/baseline-load.json
```

### Step C — Execute P1, P2, P3, and P4 after owner approval (`F-006-T11`)

```bash
# P1 on Mac (moderate-load, repeat: 3)
node tools/gauntlet.mjs role-run \
  --role=both \
  --profile="$HOME/.nerv-private/placement/mac-profile.json" \
  --limits="$HOME/.nerv-private/placement/limits-repeat3.json" \
  --machine-profile="$HOME/.nerv-private/placement/mac-machine.json" \
  --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json \
  --confirm-scenario --execute --allow-models --fresh \
  --out="$HOME/.nerv-private/placement/p1-mac-roles.json"

# P2 on mini PC (baseline-load, repeat: 3)
node tools/gauntlet.mjs role-run \
  --role=both \
  --profile="$HOME/.nerv-private/placement/mini-profile.json" \
  --limits="$HOME/.nerv-private/placement/limits-repeat3.json" \
  --machine-profile="$HOME/.nerv-private/placement/mini-machine.json" \
  --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/baseline-load.json \
  --confirm-scenario --execute --allow-models --fresh \
  --out="$HOME/.nerv-private/placement/p2-mini-roles.json"
```

## 5. Evidence and decision criteria for `F-006-T12`

- Record neutral summary tables (pass rate, holdout pass rate, false-rejection count, missed-flaw count, shared-blind-spot count, p50/p95 latency, `transferMs`, and output tokens) in `docs/evaluations/` for `F-006-T12`.
- Recommend `coder-reviewer` over `coder-alone` only if `compareCombinationRuns` shows higher or equal pass rate under the **same `totalBudget`** with `0` false rejections and `0` shared blind-spot failures.
- Recommend mini PC worker + Mac remote inference (`P3`) over mini PC local inference (`P2`) only when accuracy/pass rate improves enough to justify `WorkerLink` transfer latency and Mac availability dependency.
