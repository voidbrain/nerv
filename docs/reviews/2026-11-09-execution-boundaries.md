# Execution boundaries and project separation assessment

9 November 2026; NERV baseline `7f50720`. Requested assessment: ephemeral workspaces, capability enforcement, consolidation, formal checks, trajectory search, security warden and project separation. This is a source-based architecture assessment, not an audit, independent review, sandbox implementation or live campaign.

## Evidence and current behavior

Inspected NERV policy/ledger, Store authorization, bounded conversation/recall, Instrumentality, runtime isolation refusal, worker recovery contract, Gauntlet system packs, F-006/T03, F-023/T03, F-049 and F-065, architecture/decisions and queue. PR230 CI42585327765 passed plan/validate/windows/native-macos with full-suite skipped; previous full evidence remains PR229 CI42584230832. F-023-T03 is still first ready in the queue; this assessment creates no priority override.

Inspected project-harness main `6f70af1` (released 4.2.1), its solution profile, parallel-work and architecture-review procedures; template pulls were up to date. Inspected Gauntlet Protocol main `67cb511` (0.2.0), README, PROTOCOL and area notes. These already distinguish workflow coordination from confinement, require external coding isolation/independent grading, and reject evaluation as production permission. No reusable rule/API defect or necessary upstream change was identified. Do not duplicate NERV's execution requirements into upstream backlogs; no new harness release, Gauntlet release or NERV dependency is needed for this assessment.

NERV already has expiring single-use tool/argument-bound grants, owner-gated memory facts, conversation summaries and bounded retrieval. Gauntlet's NERV adapter runs deterministic system checks as well as separately requested model evaluations. Remaining execution isolation is explicit F-049 work: registered subprocesses and Git worktrees do not confine hostile code. Existing runtime refuses EVA-03 execution until isolation exists.

## Decisions and alternatives

| Choice | Decision and reason | Owner / reconsideration evidence |
|---|---|---|
| Project separation | Retain harness for development workflow, Gauntlet for evaluation contracts/evidence, NERV for planning/authorization/state/execution/recovery. Keep an isolated runner within NERV initially. A fourth repository adds release/compatibility overhead without a demonstrated second consumer. | F-049; reconsider extraction on an independently useful second consumer or separately required release/deployment lifecycle |
| Security warden | A deterministic enforcement role at the execution boundary consumes NERV authorization; it never becomes a second authority or grants exceptions. Validate tool/arguments/expiry and enforce mounts, network, credentials, deadlines, cancellation and resource bounds. A model may advise, never enforce or override. | F-049 runner threat model and escape/cancellation/resource tests; F-065 maps controls, limits and named gaps |
| Speculation and audit | Discard candidate workspace artifacts after rejection, preserve attempt/failure/cancellation/uncertainty events. Evaluation success permits consideration for promotion, never authorizes a production side effect. | F-049/F-006; immutable candidate digest and independently checked acceptance; no failed-attempt erasure |
| Protected grading / promotion | Candidate cannot modify grader/tests/credentials. Evidence binds exact artifact, grader/configuration and environment; promotion checks that identity and current authority. Signature authenticates provenance, not correctness. | F-006-T03 owns NERV integration; generic contracts stay upstream only when a concrete gap requires them |
| Recovery | Retain receipt/fencing/reconciliation behavior; stopped local process does not prove an external operation did not happen. No automatic replay or resource release after uncertain effects. | F-049 joins existing worker contracts; revisit on a changed execution adapter/failure boundary |
| Memory | Retain existing consolidation and bounded retrieval. Ledger growth is not automatically prompt growth. Operational lessons/cold storage need measured retrieval/storage problems and explicit retention/privacy design first. | Defer new subsystem; no evidence of an actionable defect in this review |
| Formal checks | Retain deterministic tests/schema/policy checks. AST parsing is not formal verification; proofs establish encoded properties under assumptions, and agent-generated specifications can omit requirements. Target a specific invariant before choosing SMT/Lean infrastructure. | Defer generic service; reconsider on a concrete invariant inadequately checked by existing methods |
| Search and reviewers | Use F-006's existing bounded combination qualification. Compare coder alone and selected workflows under equal total budgets, independent hidden grading, seeded defects and false rejection. No mandatory triad or MCTS engine. | F-006-T03; reconsider only on measured reliability/cost benefit, including correlated failures |

## Accepted work and limits

F-049 gains an explicit first task for the runner/enforcement threat model and admission contract, retaining EVA-03-first sequencing and pilot/stage prerequisites for execution. F-006-T03 gains explicit artifact-bound promotion and candidate-inaccessible grading acceptance; F-065 maps the warden controls and tested gaps. These are planned requirements, not implemented capabilities. Existing recovery and qualification records retain ownership rather than creating duplicate projects/IDs.

Representative current path: Runtime proposes; Ledger records the action and issues either an approval or an exact-argument short-lived grant; Store authorizes before executor use and records the outcome. On rejection/expiry no approval is inferred; on interrupted/external work uncertainty remains visible. Future isolated execution must preserve this path while restricting OS capabilities, and keep grading/promoting separate from generating the candidate.

Validation: documentation/source/task and derived-view checks are recorded by the assessment PR. No new runtime, model, device, banner, sandbox escape or performance result is claimed. Recheck on material runner/grader/authority changes or a demonstrated need to extract the runner.
