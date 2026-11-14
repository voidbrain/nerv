# Backlog maintenance rules

This is the authoritative update and review procedure for the [NERV Agency backlog](BACKLOG.md). AGENTS and README link here; keep procedural changes here rather than adding competing instructions elsewhere. The backlog's lifecycle table is the status quick reference. Archives and audits preserve dated evidence, not current state.

- [docs/BACKLOG.md](BACKLOG.md) is the current status ledger (with authoritative per-record sources when `workItems.enabled`; see [parallel work](agents/parallel-work.md)); [docs/BACKLOG-RULES.md](BACKLOG-RULES.md) is the procedure (statuses, human-action cues, record layout, CI reconciliation, closure and archives, documentation ownership and the consistency check every PR records). Update the affected records in the same PR as the change, and run `npm run check:backlog`. When `workItems.enabled`, prefer reading `docs/work/records/<ID>.md` and `docs/work/tasks/<ID>-T*.json` over loading `docs/BACKLOG.md`, and keep `effort.basis` concise (1–2 sentences) without repeating shared boilerplate across tasks.

The rules are split by trigger so an agent reads only what its task needs (F-076). Every requirement is in one of these files; section names cited elsewhere ("BACKLOG-RULES, Review procedure") are headings there.

| Read before you | File | Sections |
|---|---|---|
| change any record | [records](backlog/records.md) | Record and evidence requirements (incl. "A bug fix starts with a failing test"), Visual cues and table integrity |
| add or start a step | [steps](backlog/steps.md) | Owner steps and the steps table, Optional explicit tasks and source-owned records |
| plan a feature up front or change an adopted plan | [feature plans](backlog/feature-plans.md) | Optional upfront feature plans |
| close a step or re-estimate open steps | [estimates](backlog/estimates.md) | Estimate calibration |
| reconcile the backlog or review records | [review](backlog/review.md) | When to update and review, Review procedure |
| track the outcome of a procedure | [outcomes](backlog/outcomes.md) | Procedures and tracked outcomes |
| change documentation | [documentation](backlog/documentation.md) | Documentation consistency |
| close or archive a record | [closure](backlog/closure.md) | Closure and archives |
| touch another repository or a solution | [ownership](backlog/ownership.md) | One repository, one backlog (Ownership rejection and dependency direction, Solution coordinators) |
| add a prerequisite or reorder the queue | [ordering](backlog/ordering.md) | Linked prerequisites (optional), Optional work queue |
| pin or run an evaluation dependency | [evaluations](backlog/evaluations.md) | Evaluation dependencies |
| merge a PR that closes a P1 record or changes a harness file | [pull requests](agents/pull-requests.md) | Independent review |
