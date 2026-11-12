# Design decisions

Decisions preserve rationale and alternatives. A date alone does not make them superseded. Current behavior is summarized by [Architecture](../ARCHITECTURE.md); current acceptance/status stays in the [backlog](../BACKLOG.md).

| Decision | Scope | Reconsider when |
|---|---|---|
| [Hyuga watch](hyuga-watch.md) | Durable proactive admission, immutable gate limits, local planning and quiet-hour delivery; F-026 accepted | Changed trigger, trust, backfill, cancellation or delivery boundary |
| [Native approvals](native-approvals.md) | Read-only companion cards and existing dashboard owner authority; rendering/delivery pending F-023 | Observed owner needs require a separately authorized decision capability |
| [Runtime boundaries](runtime-boundaries.md) | TypeScript/process isolation, RPC, registered components, native pairing and sleeping workers | A measured unmet capability or changed trust/deployment boundary invalidates the recorded assumptions |
| [Worker protocol](worker-protocol.md) | Enrolled signed worker actions, receipts, resource ownership and uncertainty | Protocol/version, execution capabilities, authentication or recovery contract changes |
| [Root migration](node-root-migration.md) | Owner-authorized private replacement-root staging; live activation/storage adapter pending F-005-T03 | New key/bundle generated, recoverable backups and target access available, activation/rollback tests |
| [Node lifecycle](node-lifecycle.md) | Review-only Unix service ownership and fenced recovery contracts; execution/collection adapters pending F-005 | Owner selects profile/service intent; renderer, platform or durable recovery boundary changes |
| [Node upgrades](node-upgrades.md) | Reader contract and review-only upgrade rehearsal on a private backup copy; no application upgrade admitted yet (F-005-T06) | Journaled rehearsal step, admission beyond documentation, schema or migration change, Windows support |
| [Node bootstrap](node-bootstrap.md) | Explicit discovery/inspection and confirmed transactional bootstrap | Service ownership, supported hosts or enrolment/recovery behavior changes |
| [Configuration qualification](configuration-qualification.md) | Accepted staged individual, combination and NERV/host qualification; implementation pending F-006/F-045 | Changed role/workflow/host boundary or measured campaign benefit |
| [Remote inference](remote-inference.md) | Enrolled base endpoint identity, owner-bases privacy class, no silent fallback and bounded expiry; F-006-T01 proposed | Worker protocol changes, Tailscale overlay replaced, non-owner host proposed, or waiting budgets adjusted |
| [Evaluation and improvement](evaluation-and-improvement.md) | Evidence, browser/channel parity and bounded improvement | New flow branches, repeated failures, new model configuration or changed promotion rules |

No decision in this folder was found to be wholly superseded in this reorganization. Their latest review evidence and rerun conditions are in the [review register](../reviews/README.md).
