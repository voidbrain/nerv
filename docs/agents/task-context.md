# Task context and handoffs

Optional workflow for keeping agent context relevant across independent tasks. It is an agent instruction, not a thread-control daemon, a cache service or permission to install an adapter. Adopt the AGENTS trigger and this guide together. Existing projects can retain their current workflow without a new CI or data requirement.

## Choose at a real task boundary

| Situation | Context choice |
|---|---|
| Continue implementation, debugging, review fixes or CI for the same outcome | Keep the current task/thread; a new message, tool call or retry is not a new independent job |
| Start a different independent task after the current scope is safely recorded | Prefer a fresh thread through an already authorized host capability, using a short persisted handoff and authoritative repository sources |
| Continue the same task near a context limit | Use supported compaction after preserving unresolved state; a compacted thread remains the same task |
| Fresh-thread/compaction tools are unavailable | State the capability limit briefly, keep input/output focused and continue authorized work without claiming a reset happened |

A backlog item may have several independently reviewable tasks; the handoff follows the actual boundary, not an automatic restart for every child action. User instructions and existing work/permission boundaries take precedence. A fresh thread does not itself create a sandbox, change a branch or terminate processes.

## Preserve the handoff before a transition

Update the owning backlog/task and evidence first. Reuse authoritative records instead of copying the whole transcript. A short handoff identifies:

- Repository, task ID, current base/revision, branch/worktree and relevant changed-file state; preserve uncommitted work deliberately rather than silently discarding/stashing it.
- Goal, acceptance, accepted decisions and task-specific constraints, with links to their sources.
- Actual checks/results and remaining checks, exact PR/CI evidence, blockers and next authorized action; failed or unexecuted work keeps that status.
- Active claims/leases, running jobs, pending approvals and uncertain external effects, with their durable reconciliation references. Verify or transfer ownership using the existing procedure before another worker writes.
- Relevant privacy/data-location, execution/cost limits and owner decisions. Reload current AGENTS and applicable procedures at the start; a summary is not a replacement for governing rules.

Keep credentials, private prompts, conversation dumps and personal/session content out of committed handoffs. Use approved private storage for required private references. A handoff describes facts and limits, not inferred permission. Record corrections rather than rewriting historical evidence. Account for running work before another executor starts; context loss or lease expiry does not prove a process or external action stopped.

## Host capability and continuity

If the current host exposes an authorized fresh-thread operation, use the handoff to start the new independent task there and keep the prior thread as evidence. Confirm the operation actually succeeded before reporting a fresh context. Transfer the intended task once; use the host's documented acknowledgement/identity and existing claims to avoid duplicate workers. If acknowledgement is lost or the new worker's status is uncertain, inspect/reconcile before starting another. A supporting host adapter owns its operation identity, retries and cancellation behavior.

If no such capability is exposed, the harness cannot clear or replace the active conversation. A short handoff prompt can be shown for the owner to use in a new chat; absent an explicit request to stop, the lack of a thread API alone does not block otherwise authorized work. Compaction is also host-dependent; preserve required state before requesting it and describe it as compaction, not a new thread. The harness supplies no host adapter in this release and does not run shell/editor automation to simulate an unsupported UI operation.

The new task reloads current repository state and revalidates the handoff's claims, approvals, privacy boundaries and next action. If the old task still has unfinished accepted work, it remains tracked with an owner/blocker rather than disappearing because the chat changed. An independent reviewer can use a separate fresh context without copying the implementer's reasoning, retaining the review target and acceptance sources.

## Prompt caching and actual cost

Keep stable governing instructions in authoritative files and load only applicable task context. Where an authorized host adapter controls prompt construction, reuse stable instruction prefixes and keep dynamic task data separate. This guide does not configure a provider cache, promise cache hits, store private prompts externally or remove applicable rules to shorten input.

Prompt caching and compaction are different operations. Cached input can still be processed/billed, compaction has work of its own, and a fresh thread must reload essential instructions. Fewer visible messages or a shorter summary is not proof of lower total spend. Measure provider-reported input/output/cached usage, context preparation and repeated reads when available; missing usage remains unknown. Keep actual totals separate from savings estimates and compare similar tasks/configurations. Useful context continuity can cost less than repeatedly reconstructing an unfinished task.

For a host exposing them, official OpenAI documentation describes [fresh threads and compaction](https://learn.chatgpt.com/docs/app-server) and [provider prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching). These are capability examples, not a required provider, installation or a guarantee that those APIs are available in the current session.

## Evidence and adoption

Document the observed transition mode (fresh thread, compacted continuation or bounded continuation) and any meaningful limitation on the owning task when it affects acceptance. File/link checks and fixture tests establish template integrity, not actual host behavior or token savings. Use a configured agent-behaviour runner for rule-following evidence; an unconfigured runner remains explicitly unrun. Actual host adapters need their own transition/duplicate/recovery tests before claiming automatic context control.
