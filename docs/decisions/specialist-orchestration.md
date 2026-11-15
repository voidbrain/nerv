# Bounded multi-step specialist orchestration

**Status: proposed, 16 November 2026 (F-048-T04).** Defines the written contract for the 2026-11-07 owner extension to F-048 before any multi-step specialist execution is implemented or claimed. T01–T03 (`src/request-queue.ts`, `src/model-budget.ts`, `src/item-locks.ts`) are implemented; multi-step specialist orchestration is **not yet implemented**.

## Problem

NERV currently executes single-turn sorties using `RequestQueue` (bounded FIFO admission), `ModelBudget` (`DEFAULT_MODEL_CONCURRENCY = 2` per-model concurrency limits), and `ItemLocks` (per-item mutation serialization with uncertain-effect quarantine). Larger owner requests—such as multi-file changes or multi-stage analyses—require decomposing a plan into bounded chunks executed by separate specialist roles (coder and reviewer consultants), respecting ordered dependencies, iterating through bounded review/refinement loops, and persisting resumable handoff history across process restarts without overloading local model servers or mutating shared items concurrently.

## Decision

Multi-step specialist orchestration runs as a bounded, durable state machine layered above `RequestQueue`, `ModelBudget`, and `ItemLocks`.

### 1. Bounded chunking and resource limits

Every orchestration plan is decomposed and validated **before** any chunk runs:

| Parameter | Default limit | Hard ceiling | Behaviour when exceeded |
|---|---|---|---|
| `maxChunksPerRun` | `8` | `16` | Reject plan before dispatch (`plan_chunk_limit_exceeded`); ask owner to narrow scope. |
| `maxDependencyDepth` | `4` | `6` | Reject plan before dispatch (`plan_depth_limit_exceeded`). |
| `maxConcurrentChunks` | `2` | Bounded by `ModelBudget` | Excess ready chunks wait in `RequestQueue` / `ModelBudget` FIFO order. |
| `maxReviewRounds` | `3` | `5` | Transition chunk to `blocked` (`review_budget_exhausted`) and escalate to owner. |
| `maxHandoffPayloadBytes` | `65_536` | `131_072` | Truncate/summarize with explicit reference to durable artifact path; never inline unbounded transcripts. |
| `chunkWallTimeoutMs` | `300_000` | `900_000` | Cancel active step, preserve partial handoff record, mark `failed` or `uncertain` if external effects occurred. |

- **No recursive sub-orchestration**: specialist chunks cannot spawn nested orchestration runs (`depth === 1`).
- **Per-model concurrency**: every specialist invocation (planner, coder, reviewer) acquires a `ModelLease` from `ModelBudget` (`src/model-budget.ts`), ensuring local Ollama / LM Studio / remote engines never exceed configured concurrency.

### 2. Separate coder and reviewer consultants

- **Role separation**: a chunk's `coder` consultant and `reviewer` consultant must be distinct role invocations with separate fresh-context prompts. A coder invocation cannot self-approve its own output.
- **Capability scoping**:
  - `coder` receives bounded write/tool scope (filtered by `ItemLocks` for declared target items/paths and governed by Central Dogma `Ledger` approvals for gated actions).
  - `reviewer` runs read-only against the coder's declared diff/output and acceptance criteria, emitting a structured verdict (`approve` | `request_changes` | `escalate`) plus concise findings.
- **Channel / trust boundary**: all specialist outputs remain unprivileged proposals until Misato/coordinator commits state or the owner approves gated actions.

### 3. Ordered dependencies and item locks

- Each chunk declares `dependsOn: string[]` referencing earlier chunk IDs in the same orchestration run.
- **Static DAG validation**: cycles, missing chunk IDs, or depth > `maxDependencyDepth` fail closed at admission (`invalid_plan_dag`).
- **Scheduling**: a chunk enters `queued` only when **all** chunks in `dependsOn` are in terminal `approved` state.
- **Per-item serialization**: chunks declaring overlapping mutation keys acquire `ItemLocks` (`src/item-locks.ts`) before modifying shared state. If a lock expires with unconfirmed external effects (`ItemLockUncertainError`), dependent and overlapping chunks halt rather than guessing or overwriting state.

### 4. States, review loops, and failure paths

#### Orchestration run states

`planned` → `running` → `completed` | `failed` | `blocked` | `cancelled`

#### Chunk states

`pending` → `queued` → `coding` → `reviewing` → (`refining` → `reviewing`)* → `approved` | `failed` | `blocked` | `cancelled`

#### Failure paths

| Failure condition | Chunk transition | Run effect & recovery |
|---|---|---|
| Dependency validation fails (cycle, unknown ID, > `maxChunksPerRun`) | Not created | Run fails immediately at `planned` (`invalid_plan_dag` / limit error); zero mutations. |
| Upstream dependency enters `failed`, `blocked`, or `cancelled` | Downstream `pending` chunks → `cancelled` (`upstream_failed`) | Independent branches may finish if explicitly marked `allowPartial`, otherwise run → `failed` or `blocked`. |
| Reviewer returns `request_changes` with `round < maxReviewRounds` | `reviewing` → `refining` (passes reviewer findings to fresh coder turn) | Increments `round`; next turn re-enters `reviewing`. |
| Reviewer returns `request_changes` at `round === maxReviewRounds` | `reviewing` → `blocked` (`review_budget_exhausted`) | Preserves last diff + review notes in handoff history; escalates to owner. |
| Reviewer returns `escalate` or coder hits unapproved/denied action | `blocked` (`owner_decision_required`) | Pauses run cleanly; resumes only after owner decision or cancellation. |
| `ItemLockUncertainError` or external effect uncertainty | `blocked` (`uncertain_effect`) | Never auto-retries external effects; surfaces `UncertainEffectRecord` to owner. |
| Worker/process crash mid-chunk | `coding`/`reviewing`/`refining` → `interrupted` on restart | Startup recovery inspects last committed `handoffSeq` (see Section 5); never replays non-idempotent side effects automatically. |

### 5. Resumable handoff history

Every state transition and role handoff is persisted synchronously in SQLite before advancing:

- **`orchestration_runs`**: `id`, `sortie_id`, `status`, `plan_json`, `limits_json`, `created_at`, `updated_at`.
- **`orchestration_chunks`**: `run_id`, `chunk_id`, `status`, `depends_on_json`, `round`, `item_keys_json`, `updated_at`.
- **`orchestration_handoffs`**: `(run_id, chunk_id, handoff_seq)` primary key, `from_role`, `to_role`, `verdict`, `summary`, `artifact_refs_json`, `created_at`.

On restart recovery:

1. Chunks in `approved`, `failed`, `blocked`, or `cancelled` stay terminal.
2. Chunks interrupted in `reviewing` (read-only) may safely re-run the review step from the persisted coder handoff.
3. Chunks interrupted in `coding` or `refining` without confirmed completion transition to `blocked` (`interrupted_during_mutation`) if any external/mutating tool call was started, or `queued` if no mutation began.
4. No execution claim is made for multi-step specialist orchestration until implementation and integration tests verify this state machine end-to-end.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Unbounded recursive agent spawning | Exhausts local model memory, bypasses `ModelBudget`, and makes failure attribution and termination non-deterministic. |
| Single-role self-review loop | Risks confirmation bias and context pollution; fresh-context reviewer separation keeps checks independent. |
| Ephemeral in-memory orchestration state | Loses handoff history on restart and risks replaying non-idempotent mutations. |

## Consequences

- Future implementation slices under `F-048` must enforce the limits, state machine, role separation, and durable handoff tables specified here before claiming multi-step specialist execution.
- `F-048` remains open with no execution claim until the implementation and regression/integration suite land.

Reconsider when: multi-host worker execution (`F-014` / `F-016`) changes chunk placement semantics, or measured model campaigns (`F-006` / `F-078`) show `maxChunksPerRun` or `maxReviewRounds` defaults need tuning.
