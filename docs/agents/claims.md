# Shared claims

Read before you claim, renew or release a task. Moved from [parallel-work](parallel-work.md) unchanged (F-076).

## Shared claims

Give every branch its own clean `git worktree` from current main; the primary checkout stays on `main` with no edits of its own (AGENTS, "On its own"). A branch switched, or a change made, in the primary checkout does not satisfy this. One task gets one owner and one reviewable PR; independent tasks may proceed concurrently. Agree shared interfaces first. Include transitive/shared resources in each task; two files can conflict semantically without sharing a path. Resource declarations are reviewed input, not automatic impact analysis.

Claim only what the step changes: exact files (`docs/work/records/F-001.md`, `src/store.ts`) or a narrow glob (`src/store/**`), never a whole top-level folder (`docs/**`, `src/**`, `test/**`) or every record (`docs/work/records/**`) unless the step really edits all of it. A broad claim blocks every other agent's ID allocation and record updates for as long as it is held. Release the claim as soon as the push is done: waiting for CI or review needs no claim, and a fix after review claims again. Hold `contract:backlog-ids` and `generated:backlog-views` only for the minutes between allocating or regenerating and pushing.

The optional `task-claims.mjs` uses the repository's normal authenticated Git remote and a dedicated **metadata** `refs/heads/harness/claims-v1` branch. The branch retains its original main snapshot and updates only reserved `.harness-claims.json`, preserving archive guards without an exception; its old code snapshot is not an execution/deployment source. It changes no worktree/index/FETCH_HEAD and never merges that branch to main. Normal fast-forward pushes atomically select a single update; no force push, shared database disk, extra server or model call is used. Registry writers are trusted repository writers; owner/lease labels are coordination data, not authentication. Preserve registry history; never silently reinitialize missing or rolled-back fencing state. A network failure is unknown ownership until reconciled.

```bash
# One-time setup after reviewing that no earlier ownership/registry must be recovered:
node tools/task-claims.mjs initialize --confirm-new-registry
node tools/task-claims.mjs acquire --task F-001-T01 --owner agent-a --minutes 30
node tools/task-claims.mjs status
# Copy the actual fence/lease UUID from the successful acquisition:
node tools/task-claims.mjs verify --task F-001-T01 --owner agent-a --fence 1 --lease LEASE_UUID
node tools/task-claims.mjs renew --task F-001-T01 --owner agent-a --fence 1 --lease LEASE_UUID --minutes 30
node tools/task-claims.mjs release --task F-001-T01 --owner agent-a --fence 1 --lease LEASE_UUID --confirmed-stopped
```

Verify ownership before mutating owned/shared resources, before pushing a result and at integration. Stop if verification fails or the lease expires; a stale owner cannot renew/release a newer claim. Do not infer that expiry/disconnection stopped another agent. Recovery requires inspecting its work/host and recording actual stopped-work evidence, then `recover --task ID --fence N --confirmed-stopped --reason 'observed evidence'`. Never supply that assertion merely because time passed. Recovery does not undo code, authorize deletion, or establish that physical/external effects stopped. Clocks must be synchronized; uncertain timing requires reconciliation. The tool caps leases at 120 minutes and current registry entries at 256; review retention instead of resetting counters or deleting history when limits are reached.

Integrate one result at a time against current main, checking claim, base compatibility and declared acceptance. Regenerate shared views from all accepted sources rather than choosing one side of a conflict. For generated backlog conflicts, resolve the per-record sources/layout, then regenerate; ordinary non-adopted ledger conflicts still use the record-aware merge helper. Passing separate branch tests does not establish the joined result. Preserve required green checks, independent review, human decisions, source/privacy restrictions and the rule against adding work to a green PR. Claims reduce contention; they cannot guarantee zero textual or semantic conflicts.
