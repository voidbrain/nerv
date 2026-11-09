# Gauntlet Protocol in NERV

[Gauntlet Protocol](https://github.com/voidbrain/gauntlet-protocol) is the independent evaluation contract/CLI. It adopts the development harness; the harness does not import Gauntlet. NERV owns its domain packs, native runners, model/task requirements and production decisions. F-073 delivered the first adoption; F-074 owns the indexed, reusable and instrumented extension and its requested smoke campaign.

The development dependency is a versioned, source-included npm artifact in `vendor/`, with SHA256 and source provenance in [the manifest](../../vendor/gauntlet-protocol.json). It needs no private GitHub token at installation. Update the independent project first, then replace the pinned artifact, lockfile and provenance together; do not edit extracted copies or vendor a fork silently.

## Commands and costs

```sh
npm run gauntlet:plan
npm run gauntlet:plan -- --only=policy
npm run gauntlet:run -- --only=policy --execute --out=/private/tmp/nerv-policy-new.json
```

Planning performs no runner/model execution. The seven system cases map to existing `evals/suite.json` groups. Stress and browser cases additionally require `--allow-expensive`; other deterministic groups remain ordinary system tests. The evidence-aware runner rejects an ineligible selection before metadata or execution; use --only or explicitly enable the costly cases. Prefer a selected group when it addresses the changed risk. No Gauntlet command is added as an automatic model/stress CI campaign.

The adapter calls the existing native evaluator with inherited process-group supervision, then normalizes its selected group. The native full-suite `complete: false` is correct for a selected group; Gauntlet selected-pack completeness checks that group's actual execution, minimum checks, zero skipped checks and stable sources. It never asserts coverage of omitted groups. Native JSON logs remain private under ignored `artifacts/evaluations/`; the outer report retains a hash incorporating native evidence and adapter source. The pinned 0.2.0 protocol catches SIGINT/SIGTERM, cancels the suite and leaves later cases not-run. Supervised children inherit the Gauntlet process group so cancellation does not leave a detached native test tree. Linux/macOS external adapters are supported; Windows fails closed until Job Object supervision exists.

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

The package ships day/night budget files and four profile examples. No weights, Ollama globals, VM allocation or background schedules are changed. Version0.2.0 retains provider token/load/prompt/generation timings, streaming first-token time and bounded sampled RAM/process/model/whole-device GPU observations when available. Sampled peaks are not guaranteed maxima; unified-memory allocations overlap RAM and desktop GPU activity includes other apps. Energy and human repair/review effort remain unmeasured; unknown is not zero.

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

The [accepted staged design](../decisions/configuration-qualification.md) separates individual role screening, complete coder/auditor workflow qualification and NERV acceptance. A combination needs its own configuration identity, component evidence, independent hidden grading and measured joint outcomes; individual passes are insufficient. Mac/mini PC comparisons include specialist inference and separate tools/tests, with explicit privacy and unavailable-host behavior. This is planned NERV work under F-006-T03/T04 and F-045, not a delivered protocol command, measured pair pass or hardware recommendation. F-074 remains the bounded single-model smoke; owner resumed backlog work on 2026-11-09 and it follows the queue.
