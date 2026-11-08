# Gauntlet Protocol — qualification ownership proposal

Assessment dated 8 November 2026, NERV baseline `7d3d091`. Proposed independent evaluation project, using the reusable harness for its own development workflow. No new repository, provider, runtime dependency or model campaign is created by this assessment. NERV work remains owned here; generic component implementation/release would belong to that component after scope is accepted.

## Recommendation and dependency direction

Gauntlet should own reusable evaluation contracts, runner adapters, budgeted execution, capability/result vocabulary and reviewed evidence export. It can adopt project-harness instructions as any other project does. The harness need not import Gauntlet: it already consumes project-authored capability requirements and model-profile evidence. NERV can supply its own versioned domain pack and read a reviewed result through an adapter; neither the generic runner nor harness imports NERV implementation.

| Owner | Responsibility |
|---|---|
| Gauntlet | Model/agent configuration identity, case/result contracts, repeat/holdout handling, evaluator calibration, budgets, trace/provenance and capability-scoped evidence |
| Existing evaluation framework | Execution/scoring/sandbox/provider mechanics where suitable; avoid building duplicates |
| Project harness | Repository workflow, task requirements, review/promotion safeguards and evidence-gated assignment; no mandatory model run on ordinary PRs |
| NERV | Its scenario definitions, flow invariants, agent/runtime adapter, own backlog acceptance and actual product permissions |

Gauntlet adopting harness for development is not a runtime dependency cycle. Its published evaluation contracts must remain usable without NERV or harness implementation. An optional evidence adapter can be added by a consumer when actually needed; generic release acceptance uses owned neutral fixtures, never waits on consumer deployment. A separate project is justified by multiple domains/consumers and independent releases, not a need for another UI/server/database from day one.

## Build versus reuse

Use external benchmarks to screen candidates, then run a small project-owned qualification pack on the exact model + quantization + context + prompt + tools + agent scaffold + hardware/load configuration. A published score for different settings is background evidence, not qualification for a backlog item.

| Existing option | Relevant use and limits |
|---|---|
| [Inspect AI](https://inspect.aisi.org.uk/) and [model providers](https://inspect.aisi.org.uk/models.html) | Candidate runner foundation: composable datasets/agents/tools/scorers, sandboxing and local providers including Ollama. Evaluate fit rather than installing it automatically. A separate Python evaluation process need not become a dependency of NERV's TypeScript live runtime. |
| [Aider coding benchmark](https://aider.chat/docs/leaderboards/) | Screen editing/repair ability within its specified coding scaffold; not NERV flow or privilege acceptance. |
| [SWE-bench](https://www.swebench.com/) | Repository issue-solving agent evaluation; select relevant tasks and account for environment/scaffold. Not a substitute for NERV-specific authorization/recovery tests. |
| [Berkeley Function Calling Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html) | Function/tool choice and arguments, including multi-turn/agentic categories; not an application-specific permission guarantee. |
| [Lighteval](https://huggingface.co/docs/lighteval/main/index) | Alternative model-evaluation framework with reusable/custom tasks; assess overlap rather than maintaining two default runners. |

Recommendation: own the task packs, policy and evidence integration; reuse a runner when it meets the requirements. Do not build a benchmark platform from scratch merely to test Gemma. Check task/dataset licenses before importing external cases, pin versions and label subsets rather than reporting them as full published benchmark results.

## Reusing the existing NERV work

`evals/suite.json` currently declares seven scripted groups: policy, ledger, conversation, channels, bases, stress and browser. They exercise selected invariants and failure scenarios using fixtures; the explicit notCovered list includes unimplemented handoffs and physical/device limits. This is not proof of every possible flow or conversation. A script driving a known-good reply can test NERV while proving nothing about Gemma's ability to choose that reply.

`tools/evaluate-model.mjs` separately runs bounded real-model Casper/Misato corpora, checks structured outcomes and records configuration/source evidence. Those are valuable role-specific tests, not general coding qualification. Existing historical reports retain their exact suite/source scope and are not rerun by this proposal.

A NERV adapter could preserve its current commands and result ownership while exporting normalized evidence. Keep these layers separate in the report:

1. Deterministic system invariants: authorization, duplicates, restart, TTL, cancellation, privacy and recovery.
2. Model judgment: correct tool/arguments, clarification, changing intent, language, abstention and escalation.
3. Agent coding tasks: small neutral repositories, independent hidden acceptance tests, bounded edits, test integrity and reviewer rework.
4. End-to-end scenarios: a candidate implements a change, then scenario tests check both the requested behavior and surrounding NERV invariants.

Do not combine all four into one opaque score. Qualification is capability-scoped, and critical privacy/authority failures cannot be averaged away by easy successes. Independent acceptance tests must not be editable by the candidate. Use holdout cases, controlled task variants, repeated attempts and manual/independent review of samples; compare methods under the same scaffold and budgets.

## Other validation methods and self-improvement

Executable/hidden tests, property-based invariants, metamorphic input variants, deliberately flawed patches that must be detected, trace replay, adversarial tool/error cases and shadow runs can provide evidence without another model solving every task. Stronger-model grading is useful for ambiguous quality only with a bounded rubric and calibration against known outcomes; it is neither ground truth nor a replacement for execution. Track pass rate by capability plus review time, repair effort, latency, memory/timeout behavior and total resource cost.

For self-improvement: retain a failure → classify it → create a regression and separate holdout → propose a versioned prompt/skill/tool/code change in isolation → compare behavior, cost and regressions → independent review and existing owner promotion → monitor/rollback. Gauntlet can support evidence and comparison; it must not authorize its own production promotion, weaken its own evaluators or turn a qualification result into a runtime grant. No automatic weight training or permission expansion follows.

NERV follow-up remains F-006/F-045 for capability/model selection and F-025/F-049 for evaluated trust/execution. The initial F-029 suite remains delivered evidence, not a claim that the full improvement loop is implemented. A Gauntlet repository scaffold, framework selection and paid/local-model execution budget remain proposals rather than newly assigned implementation work here.
