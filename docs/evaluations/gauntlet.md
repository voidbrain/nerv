# Gauntlet Protocol in NERV

[Gauntlet Protocol](https://github.com/voidbrain/gauntlet-protocol) is the independent evaluation contract/CLI. It adopts the development harness; the harness does not import Gauntlet. NERV owns its domain packs, native runners, model/task requirements and production decisions. F-073 delivered the first adoption; F-074 owns the indexed, reusable and instrumented extension and its requested smoke campaign.

The development dependency is a versioned, source-included npm artifact in `vendor/`, with SHA256 and source provenance in [the manifest](../../vendor/gauntlet-protocol.json). It needs no private GitHub token at installation. Update the independent project first, then replace the pinned artifact, lockfile and provenance together; do not edit extracted copies or vendor a fork silently.

Pinned release: **0.7.1** (tag `v0.7.1`, 2026-11-11; upstream B-002 PRs #37/#38, release PR #40 / CI 43072438199). 0.7.0 makes ledger coverage follow run identity: ledger schema 2 records each run's model digest, runtime hash, scenario hash and an optional source key, and `pending` can be told the identity it intends to run under (upstream `docs/LEDGER.md`, shipped in the artifact). 0.7.1 changes only Gauntlet's development harness. Packs, grading and protocol 0.4 evidence are unchanged; the engine hash changed in 0.7.0, so Gauntlet's cache reuses only evidence produced by 0.7.x. NERV records new runs in schema 2 (`recordSelected`); entries recorded under 0.6.0 stay valid as unknown identity, and they cover every query that sets no identity field, which is what NERV asks today. Passing NERV's intended identity is F-074-T10.

Earlier pin, 0.6.0: It adds the run ledger and `pending`. The engine hash changed, so the cache reused only evidence produced by 0.6.0.

Earlier pin, 0.5.0: It adds the separate 28-case `general-assistant-expanded@1.0.0` pack and repeatable candidate comparisons with full identity, mismatch reasons and error/not-run counts (upstream `docs/COMPARISONS.md`, shipped in the artifact). `npm run gauntlet:compare` passes straight to the upstream comparison, so its behaviour changes with this pin: it needs 2 to 64 reports (one report is refused), and each entry now carries `baseline`, `requested`, `observed`, `contract`, `mismatchReasons`, per-result rows and `tokenCoverage` in place of the earlier top-level `profile`, `pack`, `version`, `packHash` and `tokens`. No NERV code read the old keys. At that pin the expanded pack was not wired in; F-074-T06 consumes it. No model run was made for this update. Reports stay protocol 0.4; earlier evidence remains readable.

## Every common pack, the run ledger and the root command (F-074-T06..T08)

NERV consumes **every pack the pinned release ships** (today `neutral-smoke`, `neutral-smoke-schema`, `general-assistant-expanded`) plus its own `nerv-system-flows`; `npm run gauntlet:packs` lists them. A pack is left out only by `evals/gauntlet/consumption.json` `exclude` with a reason, and an exclusion naming no shipped pack fails. The generated index lists every consumed pack. `gauntlet:model-plan`/`model-run` take `--pack=<id>` (default `neutral-smoke`; `--format=schema` still selects `neutral-smoke-schema`). Model limits scale Gauntlet's day limits per case (30 s and 2,048 output tokens a case), so a ten-case pack keeps exactly the day limits and the 28-case pack gets 28 cases, 840 s and 57,344 tokens; a `--only` subset gets limits for its own size unless `--limits` is given. `NERV_GAUNTLET_LEDGER` and `NERV_GAUNTLET_CONSUMPTION` override the two file paths (for tests).

`evals/gauntlet/ledger.json` is the committed, metadata-only run ledger (Gauntlet ledger schema 2 from 0.7.0; earlier entries keep schema 1 fields): which case definitions ran, under which profile, with which result and report hash; no prompts, outputs or timings. Only graded results cover a case: an error from an unanswering runtime does not.

```sh
npm run gauntlet:pending                     # one line per case with no covering run; exit 1 when any
npm run check:gauntlet-runs                  # CI: fails while a pending case is not listed by an unfinished task (pack/case or pack/*)
npm run gauntlet:all                         # plan: per pack, what runs (new/changed/stale) and what is reused
npm run gauntlet:all -- --execute --out-dir=/private/tmp/nerv-all-new   # runs uncovered NERV system cases
# Only after an owner-approved budget:
npm run gauntlet:all -- --profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json --allow-models --allow-expensive --execute --out-dir=/private/tmp/nerv-all-new
npm run gauntlet:ledger -- --report=/private/report.json --pack=neutral-smoke   # record a saved report
```

`gauntlet:all` runs only the cases the ledger does not cover, or every case with `--fresh`, and records each report in the ledger; `--max-age-days=N` also reruns cases whose last run is older and passes the same age to Gauntlet's cache (which caps it at 30 days), so an older cached report is not reused (no default age, owner decision 2026-11-11: a run stays valid until its identity changes; today the ledger binds case definition and profile only, and F-074-T10 adds model digest, runtime, scenario and NERV source once gauntlet-protocol B-002 is released). `gauntlet:all` exits 1 when any executed case fails. NERV system cases need no model and run one per report; `stress` and `browser` need `--allow-expensive`. Model cases need `--allow-models` and `--profile`, and remain an owner-approved campaign. Session start reports pending cases through the harness setting `evaluations` (`.harness.json`, harness 5.2.0), and the `gauntlet-runs` impact row tells the agent to raise or update the backlog item in the PR that bumps the pin.

Ledger state at adoption (2026-11-11): the five ordinary system cases ran and passed locally with this branch; `stress`, `browser` and all 48 common model cases are pending and listed by F-074-T09 (`pack/*` or `pack/case`; a pending case counts as raised only when an unfinished task lists it). The 2026-11-09 Gemma smoke predates the ledger; its report is not in the repository.

## Commands and costs

```sh
npm run gauntlet:plan
npm run gauntlet:plan -- --only=policy
npm run gauntlet:run -- --only=policy --execute --out=/private/tmp/nerv-policy-new.json
```

Planning performs no runner/model execution. The seven system cases map to existing `evals/suite.json` groups. Stress and browser cases additionally require `--allow-expensive`; other deterministic groups remain ordinary system tests. The evidence-aware runner rejects an ineligible selection before metadata or execution; use --only or explicitly enable the costly cases. Prefer a selected group when it addresses the changed risk. No Gauntlet command is added as an automatic model/stress CI campaign.

The adapter calls the existing native evaluator with inherited process-group supervision, then normalizes its selected group. The native full-suite `complete: false` is correct for a selected group; Gauntlet selected-pack completeness checks that group's actual execution, minimum checks, zero skipped checks and stable sources. It never asserts coverage of omitted groups. Native JSON logs remain private under ignored `artifacts/evaluations/`; the outer report retains a hash incorporating native evidence and adapter source. The pinned0.4.1 protocol catches SIGINT/SIGTERM, cancels the suite and leaves later cases not-run. Supervised children inherit the Gauntlet process group so cancellation does not leave a detached native test tree. Linux/macOS external adapters are supported; Windows fails closed until Job Object supervision exists.

```sh
npm run gauntlet:model-plan -- --profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json
# Only after a separately approved campaign budget:
npm run gauntlet:model-run -- --profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json --execute --allow-models --out=/private/tmp/nerv-model-new.json
npm run gauntlet:compare -- --reports=/private/tmp/model-a.json,/private/tmp/model-b.json
npm run gauntlet:qualify -- --report=/private/tmp/model-a.json --review=/private/tmp/review.json --requirements=node_modules/@voidbrain/gauntlet-protocol/examples/requirements.json --out=/private/tmp/reviewed-profile-new.json
```

The model command runs Gauntlet's **neutral smoke pack**, not NERV's planner/gate acceptance or coding qualification. Existing `evals:model -- --role=casper|misato` remains separate role evidence; it is not silently relabelled as a matching Gauntlet configuration. Production NERV currently requests at most 4096 output tokens and inherits local sampling/context defaults. Matching production settings requires explicit review, not assuming the smoke profile represents them.

`qualify` only exports reviewed profile data to a new file. A receipt is an owner attestation, not authenticated reviewer identity. Inspect the report, cases/holdouts, task capabilities and independent review before any manual update of `docs/agents/model-profiles.json`; existing task claims reject candidates. No profile is qualified by this integration and execution permissions never change.

## Mac comparison proposals

| Candidate | Weight target / approximate size | Initial use |
|---|---|---|
| Gemma 4 12B | Q4_K_M / 8 GB | Existing general/structured baseline, 8K context, thinking on |
| Qwen2.5-Coder 14B | Q4_K_M / 9 GB | Existing bounded coding candidate, 8K context |
| Devstral Small 2 24B | Q4_K_M / 15 GB | Larger coding-agent candidate, 8K; no download performed |
| Qwen3-Coder 30B | Q4_K_M / 19 GB | Overnight candidate, 16K; no download performed |

All are unqualified candidates. On the 36 GiB M3 Pro start serial, with one resident model. Teams/browser/VMs and context cache share memory. Overnight permits longer budgets and fewer competing apps, not extra RAM. Start sampling defaults; compare temperature 0.2/0.6 and Gemma thinking on/off separately. Keep top-p/top-k defaults initially, output 2K then 4K only when necessary, context 8K then measured 16K/32K. Seeds do not guarantee determinism. Parallel requests and cache precision need a separately measured scheduling adapter; the current direct runner rejects parallel profiles. Proposed profiles now retain suite residency, so cold-model loading and subsequent warm requests are distinguished without an extra warm-up generation. A preexisting resident is not unloaded; newly introduced residency receives bounded cleanup with released/unknown outcome.

The package ships day/night **budget presets**, not measured office/home scenarios, and four model profile examples. Released0.3 owns reusable [machine/load-scenario contracts](https://github.com/voidbrain/gauntlet-protocol/blob/v0.3.0/docs/ENVIRONMENTS.md), examples, local compatibility admission and report/cache identity. [NERV assignments and acceptance](mac-load-scenarios.md) map three Mac conditions and one normal mini PC baseline to those definitions. Comparative campaigns under F-006-T05/T04 remain unexecuted; the separately reviewed first common moderate-load smoke is linked below; this adoption adds no qualification or campaign budget. No weights, Ollama globals, VM allocation or background schedules are changed. Telemetry introduced in0.2 remains available in0.3 and retains provider token/load/prompt/generation timings, streaming first-token time and bounded sampled RAM/process/model/whole-device GPU observations when available. Sampled peaks are not guaranteed maxima; unified-memory allocations overlap RAM and desktop GPU activity includes other apps. Energy and human repair/review effort remain unmeasured; unknown is not zero.

## Qualification and improvement boundaries

System regression, real-model judgment, coding-agent tasks and end-to-end scenarios remain distinct. Reuse established external runners through Gauntlet's registered evidence bridge; this release does not install Inspect or provide an untrusted-code sandbox. Coding workers must supply independent isolation/grading before coding capability claims. Fixed smoke thresholds are not broad task competence.

Failures can become owned regressions plus separate heldouts, followed by an isolated candidate comparison and independent review. NERV's owner-controlled promotion/rollback process remains authoritative. This enables evidence-driven improvement, not automatic permission expansion or weight training. No full branch coverage, physical Telegram receipt or production self-improvement claim follows from a system report.

## Generated index and evidence reuse

[The generated test-to-capability index](../test-capability-index.md) joins ten common model cases and seven NERV system groups, with stable IDs, areas, capabilities, requirements, graders and zero-coverage areas. `npm run gauntlet:index` regenerates it; `npm run check:gauntlet-index` and required CI reject drift. An optional `index --reports=...` returns an evidence-backed private view without overwriting the committed unmeasured index.

Model commands automatically collect telemetry and reuse only exact fresh passing evidence from the private shared per-user cache. Defaults are seven days, overridden with `--max-age-hours`, and `--cache-dir` selects another private authorized cache. Reuse binds evaluator code, case/grader/pack metadata, model digest/runtime metadata, profile/settings, hardware/host and daemon PID/start. Missing current daemon identity disables automatic model reuse. A cached pass does not bypass current execution/cost opt-ins. Source-bound system results additionally bind actual source, built assets when required, adapter/wrapper and dependency provenance. Common neutral model results intentionally have no NERV source dependency; NERV-specific planner/tool prompts still require their own acceptance.

A reused output is explicitly an evidence reference to the original timestamp/report/hash with `performanceMeasuredNow:false`, never a fresh success or new telemetry sample. `compare` and reviewed export resolve that reference without arbitrary pointer traversal. Use `--fresh` for a new performance measurement or deliberate incident rerun. The requested first Gemma campaign is a fresh ten-case serial pass, 8K context, output2048/case, seed42, thinking on, runtime sampling defaults, 30s/case, 300s/suite and20480 maximum output tokens; source/settings are recorded before execution. No automatic retry on missing usage or budget overrun.

```sh
npm run gauntlet:index
npm run check:gauntlet-index
npm run gauntlet:model-run -- --profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json --execute --allow-models --fresh --out=/private/tmp/gemma-new.json
```

Local llama.cpp and MLX-LM adapters are included in the independent release and tested with fixtures. They require explicitly prepared local artifacts/manifests and live model/context/fingerprint checks. They install/start/download nothing and have not received real-host acceptance here. No live alternative-runtime campaign is part of this first Ollama smoke.

## Combination and host qualification

The [accepted staged design](../decisions/configuration-qualification.md) separates individual role screening, complete coder/auditor workflow qualification and NERV acceptance. A combination needs its own configuration identity, component evidence, independent hidden grading and measured joint outcomes; individual passes are insufficient. Mac/mini PC comparisons include specialist inference and separate tools/tests, with explicit privacy and unavailable-host behavior. This is planned NERV work under F-006-T03/T04 and F-045, not a delivered protocol command, measured pair pass or hardware recommendation. F-074-T02's first bounded single-model smoke is now completed and reviewed below; the requested profile-matched role operator bundle remains T04.

## Machine/scenario context

`node tools/gauntlet.mjs machine --id=<label>` returns a sanitized local machine profile. `model-plan`, `model-run`, `plan` and `run` accept paired `--machine-profile=<private-file> --scenario=<package-example>`; execution additionally needs `--confirm-scenario` and existing opt-ins. Plans validate definitions, not current load. Complete context binds shared evidence; unknown/unscoped results cannot replace requested conditions. The owner declaration is not independent power/load verification. Use `--fresh` to measure each new load observation. No new npm script, app control, schedule or provider setting is introduced.

## Operator runs: common Gemma smoke and NERV system acceptance

These are terminal commands, not assistant-only procedures. Run one campaign at a time. Use the already installed Gemma model; the commands download no weights and start no Ollama daemon. Keep the Mac awake, choose the scenario that describes its actual competing workload, and retain that observation with the reports. `--confirm-scenario` is your declaration, not measured proof of load.

From the NERV root, this runs the authorized ten-case common Gemma smoke and saves private machine/report files:

```sh
(
  set -eu
  umask 077
  gauntlet_root="$HOME/.local/state/gauntlet"
  mkdir -p "$gauntlet_root"
  gauntlet_run_dir=$(mktemp -d "$gauntlet_root/common-$(date +%Y%m%d-%H%M%S)-XXXXXX")
  node tools/gauntlet.mjs machine --id=mac-local > "$gauntlet_run_dir/machine.json"
  npm run gauntlet:model-run -- \
    --profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json \
    --limits=node_modules/@voidbrain/gauntlet-protocol/examples/limits-day.json \
    --machine-profile="$gauntlet_run_dir/machine.json" \
    --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json \
    --confirm-scenario --fresh --execute --allow-models \
    --out="$gauntlet_run_dir/common.json"
  printf 'Results: %s\n' "$gauntlet_run_dir"
)
```

This fixes Gemma4:12b Q4_K_M,8K context, output2048/case, seed42, thinking on, serial execution and runtime sampling defaults; one repetition,30s/case,300s/suite and20480 aggregate output tokens. Verify the actual installed identity matches the profile; do not substitute or download another model to make admission pass. For a later low-contention run, use `minimal-load.json` in the same block; it creates a new directory and fresh evidence. No second run is required merely because the first occurred during daytime.

From an already prepared Gauntlet0.3.0 checkout, the equivalent common command is below. Choose this OR the NERV wrapper for the same campaign; running both would duplicate the common measurement.

```sh
(
  set -eu
  umask 077
  gauntlet_root="$HOME/.local/state/gauntlet"
  mkdir -p "$gauntlet_root"
  gauntlet_run_dir=$(mktemp -d "$gauntlet_root/common-$(date +%Y%m%d-%H%M%S)-XXXXXX")
  node bin/gauntlet.mjs machine --id=mac-local > "$gauntlet_run_dir/machine.json"
  node bin/gauntlet.mjs run \
    --pack=examples/smoke-v1.json \
    --profile=examples/profiles/gemma4-12b.json --limits=examples/limits-day.json \
    --machine-profile="$gauntlet_run_dir/machine.json" \
    --scenario=examples/scenarios/moderate-load.json \
    --confirm-scenario --fresh --execute --allow-models --telemetry \
    --out="$gauntlet_run_dir/common.json"
  printf 'Results: %s\n' "$gauntlet_run_dir"
)
```

For the dedicated NERV **system** pack, run the next block from NERV. It builds the browser assets and runs all seven scripted groups, including browser and bounded stress; it does not call Gemma or another real model. The run budget is180s/group,900s/suite, one repetition. Build time is outside that run budget. `--allow-expensive` explicitly includes browser/stress costs. Requirements remain the existing Linux/macOS runner and local Chrome/browser setup.

```sh
(
  set -eu
  umask 077
  gauntlet_root="$HOME/.local/state/gauntlet"
  mkdir -p "$gauntlet_root"
  gauntlet_run_dir=$(mktemp -d "$gauntlet_root/nerv-$(date +%Y%m%d-%H%M%S)-XXXXXX")
  npm run build
  node tools/gauntlet.mjs machine --id=mac-local > "$gauntlet_run_dir/machine.json"
  npm run gauntlet:run -- \
    --machine-profile="$gauntlet_run_dir/machine.json" \
    --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json \
    --confirm-scenario --fresh --execute --allow-expensive \
    --out="$gauntlet_run_dir/nerv-system.json"
  printf 'Results: %s\n' "$gauntlet_run_dir"
)
```

A failed/interrupted campaign may still leave useful private evidence in its new directory; inspect it before repeating. Never edit a report into a pass. Give the reviewing agent the report/directory path, actual competing apps/load, interruptions and desktop responsiveness observations. The reviewer checks hashes, actual identity/settings, failures/not-run cases, telemetry gaps and cache status before reconciling F-074/F-006. A passing common report is not NERV role qualification or full integration acceptance.

The separate `evals:model` Casper/Misato commands above currently use production-shaped defaults (up to4096 output tokens, inherited context/sampling/thinking,115s/case, at most eight cases per role), with no shared300s aggregate cap. They are not an equivalent8K/2048 profile campaign. A profile-matched, bounded operator role bundle remains tracked under F-074-T04; do not treat the two commands above as that missing role evaluation. No model campaign was executed while documenting these commands.

## First measured common smoke

The [owner-provided first report](2026-11-09-gemma-common-smoke.md) completed all ten cases under the recorded moderate-load declaration:7 passed,3 JSON parse failures,64.744s and1608 output tokens. The campaign completed inside budget; candidate acceptance failed. Its engine/pack/profile/fixture identities matched the0.3 release pinned when the report was originally reviewed; they are not relabelled as the current0.4 engine. Preserve this failed report; no automatic rerun, promotion or qualification follows. F-074-T02 is closed as a completed campaign/review, while the role workflow under T04 remains unimplemented.

## Private failure diagnostics (Gauntlet0.4)

The pinned artifact (0.5.0 since 2026-11-11) retains0.4.0 support for bounded, opt-in private final-reply captures. The first7/10 report remains frozen historical0.3 evidence; its hashes cannot recover raw replies. New diagnostic runs produce new evidence, keep failed grades and do not silently replace that run. No new model campaign was executed for this adoption.

Plan the three failed regression cases without generation:

```sh
npm run gauntlet:model-plan --   --profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json   --limits=node_modules/@voidbrain/gauntlet-protocol/examples/limits-diagnostic.json   --format=schema   --only=change-mind,tool-choice,missing-input
```

For a separately selected manual diagnostic run, copy this complete block from the NERV root. It saves new private machine/report files and failed replies without launching another run automatically:

```sh
(
  set -eu
  umask 077
  gauntlet_root="$HOME/.local/state/gauntlet"
  mkdir -p "$gauntlet_root"
  gauntlet_run_dir=$(mktemp -d "$gauntlet_root/diagnostic-$(date +%Y%m%d-%H%M%S)-XXXXXX")
  node tools/gauntlet.mjs machine --id=mac-local > "$gauntlet_run_dir/machine.json"
  gauntlet_status=0
  npm run gauntlet:model-run -- \
    --profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json \
    --limits=node_modules/@voidbrain/gauntlet-protocol/examples/limits-diagnostic.json \
    --format=schema \
    --only=change-mind,tool-choice,missing-input \
    --machine-profile="$gauntlet_run_dir/machine.json" \
    --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json \
    --capture-failures="$gauntlet_run_dir/failures" \
    --confirm-scenario --fresh --execute --allow-models \
    --out="$gauntlet_run_dir/common.json" || gauntlet_status=$?
  printf 'Artifacts: %s\n' "$gauntlet_run_dir"
  exit "$gauntlet_status"
)
```

The command preserves a failed exit status while printing the artifact directory. Capture is off unless explicitly requested, and its `failures` child must be new. The scenario is the owner's actual-load declaration; change it only to describe actual conditions.

This command uses the separate schema-constrained pack from released0.4.1. The schemas specify keys/types, not expected answer values. It targets the three previously failed case IDs with strict semantic grading; its result is selected-case evidence and cannot replace the original ten-case score. Omit `--format=schema` for the original unconstrained pack. Keep model settings and actual moderate workload comparable; no low-load rerun is required.

This diagnostic preset permits3 cases,30s/case,90s/suite, one repetition and6144 output tokens, preserving the8K/2048 thinking-on model profile. It is selected-case evidence, not full common-pack or NERV role acceptance. Minimal-load changes competing host workload, not model quality criteria; no overnight repeat is required merely to get a green result.

Inspect the private final replies with source matching:

```sh
node tools/gauntlet.mjs inspect-failures   --directory=/absolute/private/campaign/failures   --report=/absolute/private/campaign/common.json
```

Inspection explicitly returns private untrusted model text. The sidecar records report/case/iteration/fixture/response identities, completion reason and clipping; hashes are consistency checks, not authenticated author identity. No prompt, expected answer or separate hidden-reasoning field is saved. Final replies can themselves contain sensitive text: opt in only when their private retention is allowed. Keep captures outside checkouts;10 files maximum,16KiB/file and128KiB aggregate,0700/0600 POSIX permissions, no overwrite or symlink paths. Windows capture fails before provider work because private ACL verification is unavailable; existing non-capture flows retain their own platform scope.

Public0.4 reports contain only the diagnostic-enabled marker, not raw replies or private capture paths. Diagnostic instrumentation is excluded from ordinary passing-cache reuse and from non-diagnostic performance equivalence. Captures are off by default. Grading remains strict; raw evidence can distinguish fences/prose/empty/malformed content, but a clipped capture cannot prove its missing suffix. A missing/error manifest means unavailable capture evidence, not success. See the [released upstream contract](https://github.com/voidbrain/gauntlet-protocol/blob/v0.4.0/docs/FAILURES.md).

## Development job registration

NERV adopts [harness4.4.1 job usage](../agents/work-usage.md), enabled in this repository's `.harness.json`. AGENTS owns the startup/phase/completion rule; CLAUDE/GEMINI/QWEN/Copilot entry files point to it. The owner need not select the agent in advance unless task suitability requires it. A job records the actual client/model when observable, its task and activity; imports accept only canonical measured counter metadata. Missing usage remains unknown, and shared work stays unallocated. No exporter, transcript scraping or native client adapter is installed. These files do not prove actual loading in every client.

The optional ledger is private and outside Git. This development session exposes no measured provider counters to the agent; metadata registration is not a token measurement. Native client source validation remains upstream project-harness F-048-T02. Gauntlet run usage and NERV runtime usage remain separately owned and must not be imported twice. The profile-matched NERV Casper/Misato operator bundle remains F-074-T04; adopting these common diagnostics does not implement or qualify it.

Observed adoption-review limitation: a report-only agent omitted the available registration step. This was not a capability outage. No counts/phases were backfilled; reliable automatic startup needs verified host/launcher hooks under harness F-048-T02. The shared rule alone is not evidence that every agent follows it.

## Structured-output mode

NERV `model-plan` and `model-run` accept `--format=unconstrained` (default) or `--format=schema`. Schema mode selects upstream `neutral-smoke-schema@1.0.0`, not a mutation of the original pack; pack/report/cache identity distinguishes it. Released Gauntlet0.4.1 (PR11 / CI42686856664) forwards explicit formats through native local Ollama streaming/non-streaming requests and rejects alternative backends before metadata work. This is fixture-tested adapter support; actual Gemma schema behavior remains unmeasured. JSON validity alone never passes an incorrect decision. Upstream also supports per-case `responseFormat: "json"` for custom packs; this wrapper exposes the reviewed common structural variant. No runtime production decision path was changed.
