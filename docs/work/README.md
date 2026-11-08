# Work sources, tasks and model requirements

[Backlog](../BACKLOG.md) is the generated current-status view. `records/ID.md` owns each active outcome and `layout.json` owns its surrounding text. The [queue](../agents/backlog-queue.md) orders reviewed candidates; it is not another editable backlog.

As of 8 November 2026, all 37 pre-cleanup active outcomes have separate record sources. Detailed decomposition is partial: F-006 has two tasks, F-023 three, F-048 three and F-050 two; F-072's five adoption tasks are closed. Other outcomes still need explicit, reviewed task decomposition before parallel delegation. No claim that every feature or bug has been broken down is made.

Every task declares goal, acceptance, dependencies, affected resources, `capabilities`, validation, privacy and escalation. `suggestedProfile` is optional; none is populated in this snapshot because no local model has qualifying evidence. A suggestion would remain advisory, never authorization. [Model profiles](../agents/model-profiles.json) contains Gemma as candidate only, with no evaluation evidence; its version, quantization, runtime/context/hardware limits must be measured before qualification. There is no honest fixed “minimum parameter count” substitute for these checks.

Use `npm run work:tasks` to inspect current tasks, `npm run check:work` to validate and `npm run work:build` to regenerate the ledger; then regenerate/check recap, dependencies, queue and roadmap as applicable. The [parallel-work procedure](../agents/parallel-work.md) owns model qualification, task readiness, claims and integration. Shared resources serialize work; independent source paths alone do not establish semantic independence.

The `harness/claims-v1` Git branch is coordination metadata. It is never merged into main; a PR opened for it is closed without deleting the branch. No local/cheap model gains broader tool or data permissions.
