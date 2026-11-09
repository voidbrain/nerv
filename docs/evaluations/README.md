# Evaluation evidence

[Gauntlet Protocol integration](gauntlet.md) reuses these flow runners through a pinned independent evidence contract. It does not rerun all groups or call models automatically.

The versioned suite is [evals/suite.json](../../evals/suite.json). It groups repository-owned scenarios; `minimumTests` catches accidentally empty/reduced selections. Changing a case or its expected behavior requires the same requirement review as any regression, with the suite/corpus version and evidence reconciled. Expected answers are never sent to a real model.

```bash
npm run build
npm run evals                                      # all seven control-flow groups
npm run evals -- --only=conversation --seed=7       # explicit partial selection
npm run evals:stress -- --only=stress --seed=7      # three bounded repetitions
npm run evals:model -- --role=casper --model=gemma4:12b
npm run evals:model -- --role=misato --model=gemma4:12b
```

Control-flow runs use scripted providers, disposable databases, loopback peers and mock Telegram. No real owner account, external action or phone receipt is involved. Real-model mode calls only an explicitly selected loopback model, asks it to review/plan synthetic cases, and executes no proposed action. Planner results check ask/action/new-request shape and exact tool arguments; marked language checks require independent review of the recorded text. Casper checks intent votes. An unsuccessful real-model result is useful competence evidence, not a reason to loosen a case.

Reports are new private JSON files under ignored `artifacts/evaluations/`, or a new `--out=...json` destination. They include source revision, working-tree state, input hashes, corpus/role/seed, case outcomes, counters, timing, requested/actual model identity and provider usage when known. Missing provider fields stay null. Seeds order scripted groups; native clocks and unseeded provider sampling remain nondeterministic. Reports distinguish selected success from complete execution and list unrun groups/cases and unsupported branches. Model regression and holdout splits are separate in the evidence.

Bounded work: one control-flow group at a time, 180 seconds per group, 15 minutes per run, at most ten repetitions. Model cases run serially, with a 115-second request limit and at most eight cases per invocation. CI runs the golden policy cases and manifest checks with unit tests, runs the browser group, and uploads its JSON evidence. It does not call real models.

Review raw evidence before copying selected reports here: keep neutral fixtures only, no credentials, private requests or user-specific paths. Reports identify dirty candidate trees honestly. Prefer frozen revision/input hashes for release comparisons. Append evidence; never rewrite a prior result to make a candidate pass.

These reports feed F-025/F-045 stage review. They never promote a pilot, modify model weights, grant tools, rewrite safeguards or deploy a change. Future pilot execution, decomposition and remote-dashboard contracts remain explicitly uncovered until their owning features exist.

Scripted execution currently requires Linux or macOS process groups. The runner terminates its owned group on timeout and after parent exit; repository fixtures must not detach descendants into other groups. Windows execution fails before launching a scenario until Job Object supervision exists. Manifest validation and ordinary platform tests still run on Windows. This runner is a trusted-test coordinator, not an untrusted-code sandbox.

## Baseline recorded 8 November 2026

Frozen source `3c71986bf030d727b5030e1ae510989aa9e66a3a`, clean working tree; all four reports confirm stable input hashes. Provider timestamps retain their actual UTC values.

| Evidence | Outcome | Scope |
|---|---|---|
| [Scripted](2026-11-08-scripted.json) | 178 passed | All seven groups, including real browser/axe and isolated signed bases |
| [Stress](2026-11-08-stress.json) | 24 passed | Three repetitions of the stress group; explicitly partial suite |
| [Casper](2026-11-08-casper.json) | 8/8 passed | Six regression and two holdout cases, local `gemma4:12b` |
| [Misato](2026-11-08-misato.json) | 4/5 passed | Four regression cases passed; topic-change holdout failed |

Misato answered the unrelated calendar question with a final reply instead of returning `newRequest` while clarification was pending. The production prompt requires `newRequest`, so this is retained as a model-quality failure under B-021. No action executed in this evaluator. The expected case remains unchanged; this model result does not qualify a promotion. Independent language review passed: the Italian missing-title question naturally asks for the missing reminder content. The reviewer also confirmed the topic-change result violates the production prompt; review was report-only. These small fixed corpora establish a baseline, not broad competence or exhaustive branch coverage.

Suite `nerv-golden-v2` adds B-042 dashboard/Telegram send-race, restart cleanup and bundled-row cases to the channel group. The v1 baseline above remains unchanged; later runs identify the expanded suite and their own source hashes.

[B-042 channel evidence](2026-11-08-card-reconciliation.json): v2 selected channel group passed all 19 tests on clean source `85aa894`. Includes dashboard REST → delayed Telegram send, cleanup retry across restart, bundled-row preservation and real signed remote status/decision joins. This is explicitly a partial suite and mock Bot API evidence; physical phone receipt is not asserted.

Suite `nerv-golden-v3` adds brief composition and B-041 checkpoint/outage/overlapping-scheduler/atomic-rollback cases to the ledger group. Earlier baseline reports retain their original suite IDs and hashes.

[B-041 full-suite evidence](2026-11-08-brief-recovery.json): v3 passed all 193 checks on clean source `058c3b8`. Reproduced failure classes include checkpoint-read uncertainty, complete source outage and overlapping schedulers; rollback, reopen and cursor preservation also pass. This does not identify which failure produced the original Tabgha messages.

Suite `nerv-golden-v4` adds F-014 worker receipt, transport, cancellation, upgrade and local RPC admission cases. On clean frozen source `cdd8a0e`, [all seven groups](2026-11-08-f014-scripted.json) passed 234 checks, including browser/axe. [Three base-group repetitions](2026-11-08-f014-bases-stress.json) passed 141 checks; that report is explicitly partial. Both reports confirm stable input hashes. These are invented enrolled bases over local sockets; production hosts, physical effects, real phone receipt and real-model judgment remain outside this evidence.

After that frozen F-014 run, Windows CI exposed contention in the existing peer-seat fixture: one run timed out waiting for the delayed shadow reply while a parallel run passed. The fixture now holds/releases replies explicitly and checks shadow completion before release and veto waiting before release. Outcomes are unchanged; targeted peer-seat tests pass and independent diff review confirms the same contract. Earlier frozen reports remain evidence for their recorded source, not for this later fixture edit.

[Host-load scenario plan](mac-load-scenarios.md): three representative Mac conditions, one normal home mini PC baseline, fair comparison settings and optional cold/warm, sustained-load and recovery checks. This is future campaign planning under F-006-T05/T04, not an evaluation result.

[Operator commands](gauntlet.md#operator-runs-common-gemma-smoke-and-nerv-system-acceptance) distinguish common Gemma, scripted NERV system and native role evaluation settings. [External project assessment](../reviews/2026-11-09-external-agent-projects.md) retains optional runner/attack/conversation references without adoption.
Suite `nerv-golden-v5` adds F-026 watch admission/runtime, quiet-hour channel delivery and remote-dispatch revalidation to the ledger, conversation, channel and base groups. The matching NERV Gauntlet system pack is version1.2.0; earlier reports keep their original suite IDs and input hashes. Focused local groups passed50,42,20 and51 checks respectively on the candidate tree; these scripted results do not qualify a real model.

[First common Gemma smoke review](2026-11-09-gemma-common-smoke.md): owner-provided Gauntlet0.3 report completed10 cases,7 passed/3 JSON parse failures,4/4 holdouts passed; requested profile/budget retained, no qualification.
