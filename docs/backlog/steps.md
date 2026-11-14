# Steps and feature plans

Read before you plan a feature or add, start or close a step. Part of the [backlog rules](../BACKLOG-RULES.md).

Moved to [upfront feature plans](feature-plans.md): "Optional upfront feature plans".

## Owner steps and the steps table

- A step that needs the owner says what it asks in its task file, `effort.ownerKind`: `procedure` or `decision` (one actor per step, below).
- While such a step is ready (planned or ready, every prerequisite step verified or closed) its record shows 🧑‍🔧 (procedure) or 🤔 (decision) in that cell even when the record's own cue is No, so a record an agent can advance still lists what waits on the owner; the line keeps 💻 and the record stays among the agent candidates of the work queue.
- A step that still waits on another step marks nothing.
- The steps table shows the same faces per step in its Who cell (one column since 8.11.0; Procedure and Decision columns in 8.8.0), each linked to the step's `ownerLink`: the repository page (path from the repository root, optional `#anchor`) or https link with the copy-paste procedure or the decision's options.
- One actor per step (8.10.0): a step is agent work (no `ownerKind`), an owner procedure or an owner decision, never two of them; split mixed work into consecutive steps (for example 🧑‍🔧 run the acceptance, then 🤖 record the evidence) so the order is visible, and give no new step `ownerKind: "both"`.
- The record summary gains an Agent cell before Procedures and Decisions: 🤖 a planned or ready step with agent work can start now, ⏳ such steps all wait, — none (shown with feature plans only).
- Steps are listed in the order work can happen (8.11.0): those that can move now, then waiting steps, each below every prerequisite it has in the record, then verified and closed steps; each row has an anchor, and `waits on` and the Depends on / Unlocks cells link to the step's row.
- The Who cell marks steps with agent work (🤖, ⏳ 🤖 while the step waits): every step without `ownerKind`, and an owner step with agent hours too (set `effort.agentHours`, or it shows only its owner face).
- An owner step whose prerequisites are not all verified or closed is not the owner's turn yet: it shows ⏳ before its face in the Who cell and `waits on <step>` in its status (every open prerequisite, in the record or another, linked to its row), and gets its face once it is (8.9.0).
- Every owner step whose turn it is has a page; `check:work` lists those without.
- A waiting step's page is written by the step that makes it runnable, never ahead of the code.

## Optional explicit tasks and source-owned records

Projects that adopt `workItems.enabled` follow [parallel work](../agents/parallel-work.md): stable parent B-/F- outcomes, one source file per active record, a generated current-status ledger and independently reviewable child tasks. The parent retains status/acceptance ownership; task completion or a claim never clears a human cue, verifies an outcome or grants permission. Non-adopters retain the ordinary ledger/record-aware merge procedure ([pull requests](../agents/pull-requests.md)). Adopters resolve conflicting source records/layout without losing either side, regenerate the ledger/recap/dependencies/queue/roadmap, then run their existing checks. Published archives remain unchanged. Model suitability requires capability/evaluation evidence, not model-size rankings.
