# Timing reassessment: what B-042, B-043 and B-046 have in common

11 November 2026, baseline main `d2bb481`. Owner-approved focused [architecture reassessment](../agents/architecture-review.md), triggered by recurring failures: three open bugs describe intermittent test failures in process, heartbeat and delivery timing, and a fourth local observation was made today. Scope: the timers behind those three bugs. This is not an audit and claims no audit coverage; no manifest accompanies it.

## Question

Are these three separate defects, CI noise, or one design assumption showing up in three places?

## What was inspected

- Records [B-042](../BACKLOG.md#b-042), [B-043](../BACKLOG.md#b-043), [B-046](../BACKLOG.md#b-046) and their linked CI attempts as recorded there.
- `src/worker-link.ts` (session heartbeat and request timeout), `src/kaji-link.ts` (base heartbeat), `src/runtime.ts` (outbox, resumer, brief, watch and consolidation ticks), `src/process-client.ts` (child request bound), `src/telegram.ts` (delivery tick).
- `test/worker-link.test.ts`, `test/kaji-run.test.ts`, `test/one-channel.test.ts` fixtures.

## Experiments (macOS, Node 26, 12 cores)

| # | Experiment | Result |
|---|---|---|
| 1 | Each of the three test files 8 times idle, then 8 times with 24 busy-loop processes competing for the 12 cores | 48 of 48 runs passed. Plain CPU contention at this level reproduces nothing. |
| 2 | Worker fixture, heartbeat 150 ms; block the event loop 60–400 ms at arbitrary moments while a request is in flight | 0 sessions lost in 50 stalls. A stall alone is not enough. |
| 3 | Same fixture; block the event loop **immediately after a heartbeat ping is sent** | Budget 150 ms, stall 100 ms: 0 of 8 sessions renegotiated. Budget 150 ms, stall 200 ms: **8 of 8** renegotiated. Budget 1,000 ms, stall 200 ms: 0 of 8. |
| 4 | Local full suite earlier today (unrelated change) | `test/one-channel.test.ts` failed once inside the parallel suite and passed 3 of 3 alone. B-042 is therefore not Windows-only. |

Experiment 3 is kept as a `todo` regression in `test/worker-link.test.ts` (it fails today and does not fail the suite).

## Findings

**1. A liveness verdict is taken when the timer fires, even if the reply has already arrived (demonstrated; B-046).**
The session heartbeat sends `worker.ping` and waits `min(heartbeatMs, requestMs)` for the reply (`startHeartbeat` in `src/worker-link.ts`). When the event loop is busy for longer than that while a ping is in flight, Node runs the expired timeout before it reads the socket, so a reply that is already waiting is never seen: the session ends, every pending request is rejected with "Worker connection lost; result may be unknown", and the next dispatch finds "No outbound worker session" until the reconnect. Those are exactly the two messages B-046 records. The fixtures set the budget to 150 ms; production uses 10 s.

**2. Some periodic work can overlap itself (code evidence, not reproduced; B-043).**
Most ticks in `src/runtime.ts` carry a `busy` guard. Three do not: the resumer (`startResumer` → `sweep`), the proactive watch (`startWatch`) and the base heartbeat in `src/kaji-link.ts` (`listen` then `heartbeat`). Each fires again whether or not the previous run has finished, and each makes child-process calls that share one bound of 32 (`MAX_CHILD_REQUESTS`). The B-043 fixture runs the resumer every 100 ms and heartbeats every 200 ms. If the child answers slower than that, calls accumulate until an unrelated caller is refused with "Process queue is full", which is what B-043 recorded. This matches that record's own hypothesis; no slow-child reproduction was made here.

**3. Delivery ordering (hypothesis only; B-042).**
B-042's record already notes that `deliver()` coalesces an active pass while the fixture expects a fresh cleanup edit after awaiting delivery. Today's local failure shows it is load-dependent, not platform-specific. Nothing more was established.

**4. The common factor.**
The fixtures compress production periods by roughly 20 to 150 times (10 s reply budget → 150 ms; 30 s heartbeat → 150–200 ms; 2 s resumer → 100 ms). That is reasonable for test speed, but it turns ordinary pauses (a synchronous SQLite call, a process spawn, coverage instrumentation, a loaded Windows runner) into events the production design only meets rarely. Underneath is one assumption in the code: **a timer firing on time is treated as a fact about the peer or about the previous tick**, when it is only a fact about this process's event loop.

## Does this matter outside tests?

Probably, in one case that was not tested: a laptop that sleeps. On wake every expired timer runs before any pending socket data, so finding 1 would end healthy worker sessions and mark in-flight work "result may be unknown". The design then correctly refuses to guess and asks the owner to reconcile. That is safe, but it converts a nap into owner work. This is a hypothesis from the mechanism; no sleep/wake trial was run.

## Retain or change

| Choice | Decision | Reason |
|---|---|---|
| Uncertainty over guessing when a session really is lost | Retain | Correct and safe; not the cause. |
| Bounded child request queue (32) | Retain | It is the safeguard that surfaced finding 2; widening it would hide the overlap. |
| Timeout verdict at the instant the timer fires | **Change** | Give already-received data one turn of the event loop before declaring the peer lost. Small, local to `src/worker-link.ts`. |
| Unguarded periodic ticks | **Change** | Same `busy` guard the other ticks already use. |
| Compressed fixture timers | Retain, after the two changes | With the changes, short budgets test the logic instead of the scheduler. Do not widen timeouts as the fix. |

No rewrite, no new dependency and no architecture migration follows from this.

## Next actions (owned by the records)

- **B-046:** fix finding 1 against the committed `todo` regression (remove the `todo` in the fix), then independent review. The link to the recorded CI failures is by matching symptoms and mechanism, not by replaying those runs.
- **B-043:** build the slow-child reproduction for finding 2 before changing code, as its record requires; then add the guards.
- **B-042:** unchanged; re-examine after B-046 and B-043, since both reduce background churn in the same fixtures.

## Limits

One machine and one Node version. Windows and coverage runs were not reproduced. Experiment 1 overlapped with other local test runs. The production impact in "Does this matter outside tests?" is reasoning, not measurement. Reconsider this assessment if the B-046 fix lands and heartbeat-loss failures still appear in CI.
