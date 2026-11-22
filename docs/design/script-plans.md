# Script plans over read-only tools

Status: approved by owner on 2026-11-22 (F-112-T02). This note defines the bounded read-only script-plan design authorized for implementation in `F-112-T03` (EVA-03 isolation, MAGI per-call gates, budgets, and fail-closed recovery).

## Problem and invariant

Misato currently spends one planner step per tool call even when a request is a simple repetition of independent reads. A script plan may reduce repeated context, but it must not turn several calls into one broadly authorized action. Every call remains independently validated, classified, gated, metered, and recorded through the existing executor path.

The model, base, pilot, EVA instance, and tool process remain separate choices. A script plan never receives the SQLite store, coordinator secrets, filesystem access, network access, child-process access, or a direct reference to an MCP server.

## Allowed subset

The first version is a small declarative TypeScript-like expression language, not general JavaScript or TypeScript:

- immutable scalar, array, and record bindings;
- bounded `for ... of` over a literal array or the bounded result of an earlier call;
- `if` over booleans, equality, and numeric comparisons;
- calls only through `tools.call(name, validatedArguments)`, where arguments derive from literal plan inputs and literal-loop bindings, never an earlier tool result;
- selection, projection, sorting, grouping, and bounded reduction over returned JSON values;
- one final JSON-serializable result.

It excludes imports, dynamic evaluation, prototypes/classes, exceptions, recursion, unbounded loops, timers, concurrency, filesystem/process/environment access, sockets, reflection, mutation of shared objects, and computed tool names. Source and the normalized call graph are size-bounded before admission. Syntax outside the subset fails closed.

Only tools whose registered effect is `read` are eligible. A tool is not eligible merely because its name sounds observational: admission uses the current registered effect metadata. Mixed-effect tools, writes, physical actions, approvals, grants, model calls, nested script execution, and tools with unknown effect metadata are rejected.

## Placement and call path

The script runs in a fresh per-job EVA-03 instance. Until EVA-03 isolation is implemented and verified, script plans remain unavailable; a same-user child process is not an acceptable substitute.

The EVA instance receives only the normalized program, literal inputs, an opaque job/call identity, and a narrow call bridge. It cannot contact the tools process directly. Each bridge request returns to the coordinator and follows the normal path:

1. validate the tool name and arguments against the current registered schema;
2. confirm the tool is still registered as `read` and allowed by the job's immutable allowlist;
3. submit that exact call to MAGI and obtain a distinct single-use decision/grant;
4. execute through the existing tools boundary only when permitted;
5. append the ordinary call, gate, result, budget, and provenance events before returning a bounded result to EVA.

A plan-level decision cannot authorize later calls. Argument changes, retries, and repeated calls are new gate decisions. Admission pins each allowed tool's registration fingerprint, schema version, and effect metadata; any change invalidates the job rather than broadening it. Returned content retains provenance and taint; aggregation does not make it trusted. Until Scrolls egress and result-to-argument provenance are enforced at the coordinator/tools join, a tool result cannot contribute to any later call's arguments. That restriction prevents a read result from becoming a new cross-tool data destination.

## Admission and budgets

The caller supplies explicit limits, all capped by configuration:

| Limit | Proposed default | Hard ceiling | Exhaustion behavior |
|---|---:|---:|---|
| Source | 8 KiB | 16 KiB | Reject before EVA starts |
| Tool calls | 16 | 32 | Stop before the next call |
| Loop iterations | 64 total | 128 total | Stop before the next iteration |
| Wall time | 10 s | 30 s | Kill EVA and mark incomplete |
| Encoded bridge request or reply, including its envelope | 32 KiB | 48 KiB | Reject before sending or accepting the frame |
| Aggregate tool results | 512 KiB | 1 MiB | Stop before accepting more output |
| Encoded final reply, including its envelope | 32 KiB | 48 KiB | Reject oversized final output |

Encoded bridge messages must fit the existing `MAX_FRAME_BYTES = 65,536` JSON-RPC boundary after serialization; the lower ceiling reserves space for framing and error metadata. There is no chunking protocol in this proposal. The implementation must also enforce the existing tool-specific limits when they are smaller. Budgets are monotonic and shared across retries. No partial result is presented as complete; the receipt names completed calls and the stopping reason.

## Failure and recovery

- Parse, validation, unknown-tool, non-read, schema/fingerprint change, or gate denial: terminate the whole job without executing that call.
- Wall expiry, EVA crash, bridge loss, or budget exhaustion stops admission of new calls, kills EVA, revokes unused grants, and retains completed-call receipts. It does not prove an already dispatched tool call stopped. The bridge propagates the remaining deadline and cancellation signal where the adapter supports them; an in-flight request continues to occupy admission until its reply, send failure, cancellation acknowledgement, or disconnect, matching the existing IPC rule. A late result is recorded with its latency, output size, and known usage/cost, but its payload is discarded rather than returned to the dead EVA. Its outcome is `completed_late`, `cancelled`, or `unknown`, never simply `stopped`.
- A read call with an unknown late outcome may be retried only by a new job with a new identity and gates. NERV does not silently resume from an uncertain cursor or assume that a timeout avoided provider cost or data access.
- Tool failure or malformed/oversized result: expose a bounded structured failure to the script. The script may branch on it only within the remaining budgets; it cannot suppress the durable receipt.
- Tool effect metadata changes during a job: reject the next call and terminate the job.
- Coordinator restart: the job becomes interrupted. Fresh execution starts from the beginning with a new identity and new per-call gates.
- EVA-03 unavailable or not demonstrably isolated: refuse script mode and retain the ordinary one-call-per-planner-step path.

## Security and privacy properties

Script mode grants no new registered data source. Existing privacy, taint, route, and tool-grant rules apply to every call and result. Because composition could otherwise create a new data destination, the first version forbids result-derived call arguments; relaxing that rule requires the Scrolls/provenance join to be implemented and verified first. The normalized source, pinned tool fingerprints, argument digests, gate decisions, budgets, result sizes, late-call status, and terminal status are auditable; secrets and full private results are not copied into diagnostic events. Output is treated as untrusted tool content when returned to Misato.

## Alternatives and decision

| Alternative | Disposition | Reason |
|---|---|---|
| General JavaScript/TypeScript in a child process | Reject | A same-user process is not a sandbox; the language exposes too much ambient capability. |
| Give EVA live tool objects or one plan-wide grant | Reject | It bypasses the per-call MAGI and executor boundary. |
| Declarative batch endpoint per tool | Retain where domain-specific | Safer and simpler for stable repeated reads, but cannot cover heterogeneous read workflows. |
| Bounded subset in EVA-03 with a gated bridge | Proposed | Preserves existing authority boundaries while testing whether planner-step and token savings justify the added runtime. |

The owner decides whether to adopt this proposal in F-112-T02. Adoption should be reconsidered if EVA-03 cannot provide the stated isolation, per-call gating materially removes the measured benefit, audit receipts cannot distinguish partial from complete work, or a smaller set of domain batch APIs covers the measured cases.

If adopted, implementation acceptance includes negative isolation/gate tests, direct and indirect result-derived-argument tests (including iteration over a prior result), late-reply/cancellation/disconnect tests, and a Gauntlet comparison of planner steps, tokens, latency, and task outcome with and without script mode under identical cases and budgets.
