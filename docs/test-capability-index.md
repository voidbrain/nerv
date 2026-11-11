<!-- Generated from executable packs; do not edit. -->
# Test-to-capability index

Mapped cases are implemented coverage, not model qualification. Evidence retains its actual run date/configuration; missing evidence means unmeasured.

| Pack / case | Area | Capabilities | Layer / split | Critical / costly | Grader / requirements | Evidence |
|---|---|---|---|---|---|---|
| [neutral-smoke@1.1.0 / exact-json](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | structured-output | model / regression | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [neutral-smoke@1.1.0 / change-mind](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | intent-resolution, structured-output | model / regression | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [neutral-smoke@1.1.0 / conflicting-request](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | approval-boundaries, structured-output | model / regression | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [neutral-smoke@1.1.0 / language-italian](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | language-control, structured-output | model / regression | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [neutral-smoke@1.1.0 / tool-choice](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | tool-selection, structured-output | model / regression | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [neutral-smoke@1.1.0 / missing-input](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | clarification, structured-output | model / regression | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [neutral-smoke@1.1.0 / holdout-change](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | intent-resolution, structured-output | model / holdout | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [neutral-smoke@1.1.0 / holdout-approval](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | approval-boundaries, structured-output | model / holdout | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [neutral-smoke@1.1.0 / holdout-tool](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | tool-selection, structured-output | model / holdout | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [neutral-smoke@1.1.0 / holdout-language](https://github.com/voidbrain/gauntlet-protocol/blob/v0.5.0/examples/smoke-v1.json) | general-assistant | language-control, structured-output | model / holdout | true / false | exact-json-v1 / local-model-runtime | Unmeasured |
| [nerv-system-flows@1.2.0 / policy](../evals/gauntlet/system-v1.json) | security-permissions | effects, taint, vote-permutations, shadow-veto, budget, confinement | system / regression | true / false | registered:policy / posix-process-groups | Unmeasured |
| [nerv-system-flows@1.2.0 / ledger](../evals/gauntlet/system-v1.json) | security-permissions | expiry, single-use-grants, restart, executor-effects, approval-idempotency, brief-source-recovery, daily-delivery-idempotency, proactive-admission, slot-idempotency, immutable-stage-action-limits | system / regression | true / false | registered:ledger / posix-process-groups | Unmeasured |
| [nerv-system-flows@1.2.0 / conversation](../evals/gauntlet/system-v1.json) | conversation-memory | ambiguity, mind-change, conversation-isolation, bounded-replanning, language, explanations, proactive-local-planning, durable-step-reservations, quiet-hours, interruption-recovery | system / regression | true / false | registered:conversation / posix-process-groups | Unmeasured |
| [nerv-system-flows@1.2.0 / channels](../evals/gauntlet/system-v1.json) | distributed-coordination | delivery-retry, cross-channel, relay, owner-authorization, approval-card-reconciliation, proactive-quiet-delivery | system / regression | true / false | registered:channels / posix-process-groups | Unmeasured |
| [nerv-system-flows@1.2.0 / bases](../evals/gauntlet/system-v1.json) | distributed-coordination | signed-bases, remote-idempotency, seat-delay, shadow-after-decision, lease-fencing, outbound-reconnect, approval-locks, signed-cancellation, legacy-quarantine, hostile-frames, connection-admission, proactive-dispatch-revalidation, quiet-remote-followups | system / regression | true / false | registered:bases / posix-process-groups | Unmeasured |
| [nerv-system-flows@1.2.0 / stress](../evals/gauntlet/system-v1.json) | ci-operations | bounded-queues, brain-stall, crash, parallel-writes, latency | system / regression | true / true | registered:stress / posix-process-groups | Unmeasured |
| [nerv-system-flows@1.2.0 / browser](../evals/gauntlet/system-v1.json) | ui-visual | dashboard-operator, waiting-state, approval, topic-change, accessibility | system / regression | true / true | registered:browser / posix-process-groups, built-browser-assets | Unmeasured |

## Area coverage

- unclassified: 0 mapped cases
- general-assistant: 10 mapped cases
- coding: 0 mapped cases
- code-review: 0 mapped cases
- math: 0 mapped cases
- logic-planning: 0 mapped cases
- cad-3d: 0 mapped cases
- backlog-management: 0 mapped cases
- estimation: 0 mapped cases
- ci-operations: 1 mapped cases
- research: 0 mapped cases
- tools: 0 mapped cases
- conversation-memory: 1 mapped cases
- distributed-coordination: 2 mapped cases
- ui-visual: 1 mapped cases
- security-permissions: 2 mapped cases
- documents-data: 0 mapped cases
- language-translation: 0 mapped cases
- audio-video: 0 mapped cases
- scheduling-time: 0 mapped cases
