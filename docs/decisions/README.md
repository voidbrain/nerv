# Design decisions

Decisions preserve rationale and alternatives. A date alone does not make them superseded. Current behavior is summarized by [Architecture](../ARCHITECTURE.md); current acceptance/status stays in the [backlog](../BACKLOG.md).

| Decision | Scope | Reconsider when |
|---|---|---|
| [Runtime boundaries](runtime-boundaries.md) | TypeScript/process isolation, RPC, registered components, native pairing and sleeping workers | A measured unmet capability or changed trust/deployment boundary invalidates the recorded assumptions |
| [Worker protocol](worker-protocol.md) | Enrolled signed worker actions, receipts, resource ownership and uncertainty | Protocol/version, execution capabilities, authentication or recovery contract changes |
| [Node bootstrap](node-bootstrap.md) | Explicit discovery/inspection and confirmed transactional bootstrap | Service ownership, supported hosts or enrolment/recovery behavior changes |
| [Evaluation and improvement](evaluation-and-improvement.md) | Evidence, browser/channel parity and bounded improvement | New flow branches, repeated failures, new model configuration or changed promotion rules |

No decision in this folder was found to be wholly superseded in this reorganization. Their latest review evidence and rerun conditions are in the [review register](../reviews/README.md).
