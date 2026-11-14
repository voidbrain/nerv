# Mac operating-conditions plan and budgets (F-006-T05)

**Status: proposed, 14 November 2026 (F-006-T05); owner approval pending in F-006-T18, and three-condition execution in F-006-T08.** References [NERV host assignments and load acceptance](../evaluations/mac-load-scenarios.md) and the released Gauntlet scenario definitions under `node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/`.

## 1. Three comparable Mac operating conditions

Each condition uses the matching released Gauntlet 0.3 scenario JSON as its load declaration (`--scenario`):

| NERV condition | Gauntlet scenario file | Owner desktop activity | Acceptance question |
|---|---|---|---|
| **Heavy (office / active work apps)** | `node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/heavy-load.json` (`heavy-load@1.0.0`) | Browser tabs, video/voice calls, VM or active dev build (`workloadCategories`: `browser`, `calls`, `vm`) | Does local inference keep interactive response acceptable without degrading owner work or tripping timeouts? |
| **Moderate (home / light desktop)** | `node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json` (`moderate-load@1.0.0`) | Light interactive use (`workloadCategories`: `browser`, `editor`, `media`) | Does the role meet day-to-day latency, parse accuracy, and UI responsiveness expectations at home? |
| **Idle (home / awake overnight)** | `node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/minimal-load.json` (`minimal-load@1.0.0`) | Host awake, minimal competing apps (`workloadCategories`: `[]`) | What is the unloaded baseline for cold/warm model residency, latency, and unattended batch fit? |

- Owner confirmation (`--confirm-scenario`) declares which real desktop condition is active when each run starts; Gauntlet records the scenario hash without probing private window contents or closing owner apps.

## 2. Constant controls across all three runs

To isolate host-load impact rather than comparing different models or prompts, hold every variable below identical across `heavy-load`, `moderate-load`, and `minimal-load`:

1. **Private machine profile (`--machine-profile`)**: Generated once on the evaluation Mac outside git (`node tools/gauntlet.mjs machine --id=mac-local > "$HOME/.nerv-private/mac-local.json"`) and reused unchanged across all three conditions.
2. **Model profile (`--profile`)**: One identical private profile JSON on local loopback S² (`http://127.0.0.1:11434`, Ollama), with fixed model tag (for example `gemma4:e2b-it-q4_K_M` or the owner-selected `gemma4:12b` profile), `parallel: 1`, context window, output token cap, `seed`, thinking setting, and temperature (`0`).
3. **Runtime & model digest**: Same installed Ollama version and model digest across all three conditions (verified in each report).
4. **Cases & deterministic grader (`--fresh`)**:
   - **Common smoke pack**: `neutral-smoke` (`model-run --pack=neutral-smoke`, 10 cases) using `--limits=node_modules/@voidbrain/gauntlet-protocol/examples/limits-day.json` (`repeat: 1`).
   - **NERV role bundle**: `role-run --role=both` (5 Casper + 5 Misato cases = 10 cases) using the same `limits-day.json` (`maxCases: 10`, `repeat: 1`).
   - Pass `--fresh` on each run so cached results from an earlier condition are never reused across scenarios.
5. **Power state**: Keep the Mac on **AC power** for all three runs so battery-saver CPU/GPU throttling does not confound load comparison. (Battery behaviour, if ever needed, is a separate run.)
6. **Telemetry sampling**: Pass `--sample-ms=1000` on `model-run` so memory/GPU/daemon samples use the same 1 s cadence across all three conditions (noting the sampling overhead disclosure from [the 9 Nov smoke review](../evaluations/2026-11-09-gemma-common-smoke.md)).

## 3. Explicit budgets and stop rules

| Budget dimension | Per-condition limit (common smoke) | Per-condition limit (role bundle) | Aggregate ceiling (all 3 conditions) |
|---|---|---|---|
| **Cases (`repeat: 1`)** | 10 cases | 10 cases (5 Casper + 5 Misato) | 60 model cases total (20 × 3 conditions) |
| **Per-case timeout (`caseMs`)** | 30 s (`30000` ms) | 30 s (`30000` ms) | 30 s/case hard cap (`limits-day.json`) |
| **Suite wall-clock cap (`suiteMs`)** | 5 min (`300000` ms) | 5 min (`300000` ms) | **30 min active evaluation time** across all 3 runs |
| **Output token cap (`outputTokens`)** | 20,480 tokens | 20,480 tokens | 122,880 tokens max (expected < 15,000 total based on 1,608/10 cases in the 9 Nov smoke) |
| **Artifact size (`maxBytes`)** | 1 MiB (`1048576` B) | 1 MiB (`1048576` B) | 1 MiB/report (`limits-day.json`) |

- **Monetary budget**: Local loopback Ollama only (`models.cloud` stays off); no paid cloud API tokens are authorized.
- **Stop rules (abort immediately without retrying)**:
  1. Owner desktop responsiveness degrades unacceptably during `heavy-load` or `moderate-load` (for example audio/video call stutters or editor input lags).
  2. macOS thermal state reaches critical or sustained swap thrashing locks up the UI.
  3. Any run stalls on 3 consecutive case timeouts (`caseMs`), or total elapsed campaign time reaches **45 min** wall clock including cooldown between conditions.

## 4. Owner execution workflow (after F-006-T18 approval)

Keep all machine profiles and report files in `$HOME/.nerv-private/` (never commit host hardware specs or raw prompts/outputs to git).

### Step A — Generate private machine profile once

```bash
mkdir -p "$HOME/.nerv-private/reports"
node tools/gauntlet.mjs machine --id=mac-local > "$HOME/.nerv-private/mac-local.json"
```

### Step B — Plan first (zero model calls) to verify profile, scenario, and budget

```bash
for cond in heavy-load moderate-load minimal-load; do
  node tools/gauntlet.mjs model-plan \
    --pack=neutral-smoke \
    --profile="$HOME/.nerv-private/profile.json" \
    --limits=node_modules/@voidbrain/gauntlet-protocol/examples/limits-day.json \
    --machine-profile="$HOME/.nerv-private/mac-local.json" \
    --scenario="node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/${cond}.json"
  node tools/gauntlet.mjs role-plan \
    --role=both \
    --profile="$HOME/.nerv-private/profile.json" \
    --limits=node_modules/@voidbrain/gauntlet-protocol/examples/limits-day.json \
    --machine-profile="$HOME/.nerv-private/mac-local.json" \
    --scenario="node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/${cond}.json"
done
```

### Step C — Execute each condition under its matching real desktop load (`--execute --allow-models --confirm-scenario`)

Run one condition at a time when the Mac is actually in that state (`heavy-load`, then `moderate-load`, then `minimal-load`), plugged into AC power, allowing a short idle cooldown before switching conditions:

```bash
COND=heavy-load # repeat with: moderate-load, minimal-load
node tools/gauntlet.mjs model-run \
  --pack=neutral-smoke \
  --profile="$HOME/.nerv-private/profile.json" \
  --limits=node_modules/@voidbrain/gauntlet-protocol/examples/limits-day.json \
  --machine-profile="$HOME/.nerv-private/mac-local.json" \
  --scenario="node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/${COND}.json" \
  --confirm-scenario --execute --allow-models --fresh --sample-ms=1000 \
  --out="$HOME/.nerv-private/reports/mac-${COND}-common.json"

node tools/gauntlet.mjs role-run \
  --role=both \
  --profile="$HOME/.nerv-private/profile.json" \
  --limits=node_modules/@voidbrain/gauntlet-protocol/examples/limits-day.json \
  --machine-profile="$HOME/.nerv-private/mac-local.json" \
  --scenario="node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/${COND}.json" \
  --confirm-scenario --execute --allow-models --fresh \
  --out="$HOME/.nerv-private/reports/mac-${COND}-roles.json"
```

### Step D — Compare reports and record owner observations (F-006-T08 / T09)

```bash
node tools/gauntlet.mjs compare \
  --reports="$HOME/.nerv-private/reports/mac-heavy-load-common.json,$HOME/.nerv-private/reports/mac-moderate-load-common.json,$HOME/.nerv-private/reports/mac-minimal-load-common.json"
```

For each condition, record in the F-006-T08 / F-006-T09 evidence note:
- Actual competing apps running, AC power verified, and Activity Monitor memory pressure (`green`/`yellow`/`red`) + swap used if observed.
- Owner desktop responsiveness rating (no impact / noticeable lag / disrupted work).
- Cold first-call latency, warm p50/p95 case latency, output tokens, and pass/parse-failure counts per pack.
- Any case timeouts or aborted runs under the stop rules above.

Reconsider when: the evaluation Mac hardware or Ollama backend changes, role placement needs larger context/limits than `limits-day.json`, or F-006-T08 shows 30 s/case is too tight under `heavy-load`.
