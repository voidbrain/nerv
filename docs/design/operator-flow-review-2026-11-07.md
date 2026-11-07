# Operator flow assessment — 2026-11-07

Source inspection, not runtime acceptance. Active backlog records own pending work.

| Topic | Current behavior and required work |
|---|---|
| Step and communication | The reported `liveEdges()` derived the incoming edge from the current phase, keeping it active for the whole step. The current branch removes that inferred animation and pulses busy nodes instead. B-040 separates busy nodes from observed transfers. A bounded recent-transfer pulse can be visible without claiming an ongoing network transfer. |
| MAGI and Midori | MAGI uses the accent token, explaining its orange active-like appearance. Midori uses the info token while Telegram responds and becomes solid. F-051 owns violet MAGI identity, dotted Midori, explicit legends and actual base/channel I/O. |
| Intake and advice topology | EDGES includes both detection→intake and detection→route, plus consultant→plan. A visual shortcut does not prove runtime bypass. F-051 maps events before changing topology and distinguishes advice request/return. |
| Approval race | Telegram selects unsent cards before awaiting delivery. A concurrent dashboard decision needs a status recheck and card reconciliation. Durable idempotency alone does not fix stale presentation. B-042 requires delayed-send integration coverage and exactly one effect. |
| Brief | The reported implementation hardcoded the morning greeting; the current branch selects a greeting at composition in the owner time zone. Multiple messages and unavailable reads have not been attributed to a cause. B-041 checks delivery identities, partial reads, retries and restarts. Building while serving is not evidence of the cause; an existing process can retain old backend code. |
| Misato loops | Reply, ask for clarification and proposed action are supported. Each runtime planning-loop invocation is bounded to six iterations; a resumed turn can start another invocation. Gate rejection reasons feed replanning. Advice is normally once before planning and reused on approval resume; substantial clarification can consult again. This is not a general specialist task graph. F-029 tests branches; F-048 owns chunking and coder/reviewer orchestration. |
| Pilots and assignment | Keyword matching selects advisers, with pinned/stage preferences. Advice never executes or votes. The current roster does not establish execution assignment/history, learned tools or evaluated competence. F-045/F-049 own evolution and execution continuity. |
| Time Request PROTO | A candidate and keywords do not prove expertise. F-045 must expose rationale, examples, description, consultation/sortie outcomes and sample sizes, and evaluate generic domain proposals. |
| Morph/split/merge | Proposed governed evolution needs versioned lineage, evaluation, promotion and rollback gates. No current automatic capability-learning guarantee. |
| Beast mode | No beast identifier was found in current planner/runtime source in this assessment. Do not present an older concept as a working mode; define its behavior and safeguards before revival. |
| Operator directory | Configuration calls the private-chat bot Aoba; this does not establish configurable per-base operator aliases. F-070 owns authenticated aliases, defaults, rename and ambiguity handling. |
| Coverage and improvement | Selected paths have tests; an exhaustive branch/loop matrix has not been demonstrated. F-029 covers vote combinations, changing decisions, contradictions, language, clarification and recovery using retained traces. Logs can produce candidate fixes; improvement still needs reproducible failures, evaluation and regressions. |

Several bots can share a Telegram group, but NERV currently authorizes one owner's private chat. Group support needs sender/chat authorization, addressed commands and loop prevention. Current Telegram documentation permits conditional bot-to-bot communication; avoid the older blanket assumption that bots never see bots. See [bot-to-bot communication](https://core.telegram.org/api/bots/bot-to-bot).

Command menus and keyboards can come from the shared NERV catalog; maintaining a separate command dictionary is unnecessary. The current deterministic chat commands are `/status` and `/help`. Welcome panels and common reminder/note actions belong to F-056. See [Telegram bot features](https://core.telegram.org/bots/features).

An ordinary bot speaks as itself. A separately connected business bot can process/reply on a user's behalf with scoped permissions; separately authorized user clients are another integration. This assessment authorizes no account connection or message sending. See [connected business bots](https://core.telegram.org/api/bots/connected-business-bots) and [user authorization](https://core.telegram.org/api/auth).

CRT remains opt-in with readable text and reduced-motion support (reopened F-053). Pausing/reversing bands are a stylized artifact, not a precise tube simulation. Latest owner feedback restores the earlier flicker strength with regular double variants; band speed now varies through fresh random eased passes. Reduced-motion and below-threshold flashing behavior remain acceptance requirements.

Dashboard-only operator parity with Telegram is not established for all distributed approvals and notifications. F-029/B-021 must exercise each destination and recovery path, excluding only genuinely transport-specific Telegram checks. Keep accepted, received, decided and executed states distinct.
