# Evaluation evidence

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
