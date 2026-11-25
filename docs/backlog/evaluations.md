# Evaluation dependencies

Read before you pin or run an evaluation dependency. Part of the [backlog rules](../BACKLOG-RULES.md).


## Evaluation dependencies

- **Evaluation dependencies.** A project that pins an evaluation dependency shipping test content (packs, cases, fixtures) declares it in `.harness.json` `evaluations`: `[{ "name": "…", "pending": ["command", "args…"], "timeoutMs": 60000 }]`. The project-owned pending command exits 0 when every case it consumes has a covering run and 1 listing the pending cases, one per line; `check:freshness` reports them at session start. A pin that adds or changes cases, and every session that reports them, keeps an open backlog record naming the pending cases until a run covers them; that run is the owning record's Check. Running real models stays an owner-approved campaign with its own budget: the record carries the human-action cue until the owner approves. A project may also run the same command in CI to fail while a pending case has no open record. The harness names no evaluation tool; the dependency supplies the case identities and the project its ledger, rule and budget.
