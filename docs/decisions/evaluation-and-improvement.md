# Evaluation and measured improvement

Assessment requested 7 November 2026. Implementation status stays in B-021, F-029, F-025, F-045, F-049 and F-051. The initial design is implemented as a versioned scripted runner and separate local-model evaluator; see [execution and evidence](../evaluations/README.md). The autonomous repair/promotion loop remains unimplemented.

## Dashboard operation

The current interface is `/dashboard/`, not the retired dashboard1.html prototype. Chat uses `POST /api/chat`. Approval cards appear in **Misato's apartment / Needs you**; Comms records their trace. Approve/reject buttons use `POST /api/approvals/ID`, reaching the same Store decision path used by Telegram. Answering a clarification uses the chat input in the dashboard conversation. A browser agent can operate these controls and inspect the resulting ledger.

| Operation | Dashboard coverage today |
|---|---|
| Chat, clarification answers, approval/rejection | Supported on the displayed base, subject to the same backend policy |
| Trace, sortie history, memory, model controls | Supported; generally more inspection than Telegram |
| Edit an approval's proposed arguments | Not implemented as an editable live card; the demo edit control is hidden |
| Remote-base work and approvals | Ordinary requests can route to main, but one dashboard is not a unified view of every base's pending cards. Telegram relay supports remote cards; authenticated destination inspection/navigation remains F-051 |
| Telegram API/polling/buttons and actual phone rendering/receipt | Bot fixtures test protocol behavior; a browser cannot establish phone receipt |
| Credentials and privileged service bootstrap | Some actions intentionally require the CLI/admin token. A dashboard session cannot mint sessions, revoke sessions or stop the service |

Evidence: `web/public/dashboard/live.js`, `src/server.ts`, `src/runtime.ts`, `src/telegram.ts`, `test/clarification.test.ts`, `test/telegram.test.ts` and `test/one-channel.test.ts`.

## B-021 and automatic acceptance

B-021's backend tests already cover questions remaining open, conversation binding, the eight-word boundary, restart, expiry, topic change, approval resume and the signed cross-base link. Its browser waiting-state assertion was initially pending; the golden dashboard scenario now checks a waiting apartment, unlit Debrief, same-sortie answer, approval effect and topic change across the real processes. The known forwarded-answer timeout limitation remains separate. Browser/agent execution can perform those checks. Current tests include Chrome/CDP and axe; a new Playwright dependency is not required to prove the browser behavior.

Two kinds of evidence must stay distinct:

- A scripted provider returns known asks/plans/replies. The browser and real processes must preserve the right sortie, wait state, decision, effect count and trace. This tests the control flow reproducibly.
- A real configured model receives ambiguous requests, contradictions and topic changes. Record its actual requested/returned model, configuration, language and outcome. This evaluates whether it chooses the appropriate ask/plan; scripted output does not prove that model judgment.

The agent can run both kinds on disposable data and suitable accessible models. A missing model is a runtime dependency, not automatically an owner-only test. Real Telegram device acceptance is needed for claims about phone display/receipt; Bot protocol tests cover other channel mechanics. B-021 remains open until the required evidence exists; changing the actor does not establish verification or erase its known forwarded-answer timeout limitation.

## F-029 scenario suite

| Family | Example cases | Assert from observable state |
|---|---|---|
| Simple tasks | Read/list, create one reminder, clear request in Italian/English | Exact intended effect, correct language instruction/reply, expected policy path |
| Ambiguity and follow-up | Missing file/title/time, short/long answer, different conversation | Ask before action, same sortie when continuing, no invented parameters |
| Contradiction and changed intent | Change time/target, cancel while waiting, unrelated new topic, approve an old card | Current intent governs the proposed effect; stale approval or grant cannot authorize a different action |
| Temporal boundaries | Expiry, midnight, timezone/DST, missed schedule, restart | Explicit clock, no accidental replay or reinterpretation |
| Concurrency and recovery | Duplicate request/tap, concurrent conversations, double approval, child crash, late result, network failure | Single-use decisions and checkpoints, isolation, bounded queues, unknown outcome retained |
| Language and explanations | Italian→English and back, short confirmation, quoted foreign text, denied tool | Language follows owner intent; explanation matches the recorded state; unsupported capabilities are not claimed |
| Multiple bases | Main unavailable/changes, forwarded question, peer delay/abstention, reconnect | Authenticated identity, correct conversation/base attribution, no unauthorized local fallback or duplicate remote effects |
| Untrusted content | Tool output contains instructions or requests exfiltration | The required control is identified; current F-027 gaps remain named gaps, never a claimed pass |

Each scenario needs a versioned requirement, neutral fixture, deterministic seed, explicit expected transitions/effects and a time/call/cost bound. Start with deterministic CI contracts and B-021's browser gap, then recorded real-model runs, then bounded generated variants and stress. A multi-base case can use isolated local runtimes with real signed transport before requiring real machines. Parallel agents can act as owner/requester, planner and independent observer, each with separate test state; more agents alone do not improve the oracle.

Evidence should include scenario/version/seed, source revision, base topology, model identity, clock/timezone, request/response transcript for neutral cases, event sequence, exact proposed/executed arguments, approvals/expiry, observed SQLite/files/mock-service effects, screenshots/accessibility results, duration and usage. Exclude credentials and private user data. An agent's claim that an action succeeded is not the effect oracle. Natural-language judges supplement deterministic checks; the same model should not be the sole evaluator of its own change.

## Improvement loop

1. Observe an anomaly and retain reproducible, privacy-safe evidence.
2. Classify a confirmed defect, missing feature, model-quality failure or ambiguous requirement; use the owning record.
3. Preserve a failing regression case and frozen evaluation/holdout cases.
4. Propose a versioned prompt, skill, adapter or code change in an isolated workspace.
5. Run regression, adversarial, browser and bounded stress checks; compare against the prior version, including cost and new failures.
6. Obtain independent verification and the required promotion approval, then monitor and retain rollback evidence.

NERV currently has owner-approved memory, pilot roster/advice and proposals for new specialists, action gates, ledgers and some regression tests. The full discover→reproduce→repair→evaluate→promote loop is unfinished: F-029 owns evaluation, F-025/F-045 own trust and pilot/skill promotion, and F-049 owns isolated execution. Runtime evidence does not currently retrain model weights or automatically rewrite its own production code. The proposed loop improves remembered facts and versioned behavior; model training would be a separate capability.

Production promotion remains owner-confirmed under the existing project decisions. A candidate cannot make its own evaluation pass by weakening the expected behavior, deleting cases or widening permissions. Governing safeguards retain their existing owners.

## Work ordering

Keep stable IDs and the canonical ledger's required ID order. Present a separate, derived ready-to-work view rather than treating ID numbers as chronology for execution.

Use explicit owner sequence and hard prerequisite outcomes first. Separate ready work, required human decisions and blocked work. Within ready work, consider impact/priority (data loss, security and core correctness first), roadmap fit, dependents unlocked, remaining effort and confidence in the evidence. A small verification task may unblock several larger records. Active records use remaining effort, with optional hours/days and uncertainty; completion percentages have been removed. The [derived work queue](../agents/backlog-queue.md) displays explicit owner ordering and prerequisite constraints without a weighted score.

For the questions in this session, B-021's agent-executable acceptance and an initial F-029 scenario slice are valuable next candidates. F-062's backup value remains high but its recorded recovery/storage decisions still require the owner. A new weighted score, priority rewrite or automatic reprioritization has not been adopted by this assessment.
