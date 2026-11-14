# Worker-link heartbeat liveness without blocking on nervous IPC

**Status: proposed, 14 November 2026 (B-066-T01).** Follows B-046 ([PR #293](https://github.com/voidbrain/nerv/pull/293), [PR #361](https://github.com/voidbrain/nerv/pull/361)) and B-060-T02 ([PR #411](https://github.com/voidbrain/nerv/pull/411)), where increasing test headroom stopped CI flakes without removing the underlying IPC dependency on the heartbeat path.

## Problem

In `src/worker-link.ts` (`Peer.receive`), every incoming WebSocket frame—including `worker.ping` requests and replies—runs serially on `this.incoming` and awaits both `this.link.settings.registry.bases()` and `this.link.settings.registry.main?.()`:

```ts
const bases = await this.link.settings.registry.bases(),
  main = await this.link.settings.registry.main?.();
```

In the live service (`src/runtime.ts`), `Runtime.kaji` implements `RegistryPort.bases` and `RegistryPort.main` via `this.nervous.call('kaji.bases')` and `this.nervous.call('kaji.main')`, sending IPC requests to the `nervous` SQLite process. One `worker.ping` round-trip (`ping` + `pong`) triggers four registry IPC calls across the two processes.

Meanwhile, `Peer.request`'s timeout handler (`expire()`) waits on `Promise.race([this.incoming, cap(timeoutMs)])`. When SQLite or `nervous` IPC is delayed under load (or after an event-loop stall), an already-received `worker.pong` sits inside `this.incoming` behind `registry` IPC awaits, `cap(timeoutMs)` expires first, and the session closes (`Worker result unknown after timeout.`) even though the remote peer answered on time.

Widening timeouts hides this symptom in tests (`test/worker-link.test.ts` on Windows CI in B-060-T02), but leaves live sessions vulnerable whenever SQLite or `nervous` is busy.

## Options

### Option A (Recommended) — In-memory registry snapshot in `WorkerLink`

Cache the active enrolled base keys and current `main` base ID in memory inside `WorkerLink` (initialized on start and refreshed synchronously/eagerly when registry records change via `kaji.add`, revocation, key rotation, or `main` change).

- **How it works:** `Peer.receive` verifies frame signatures, `main` identity, and `remoteKey` directly against the in-memory snapshot with **zero IPC calls on the WebSocket frame path** (`0 ms` async wait per frame). Revocation or `main` change still pushes an immediate invalidation to `WorkerLink` (calling `closed`/closing affected sessions), and periodic registry refreshes reconcile any missed update.
- **Pros:**
  - Eliminates `nervous` SQLite IPC completely from `worker.ping`, `worker.pong`, and `worker.run` frame verification, cutting per-heartbeat overhead to pure synchronous Ed25519 verification.
  - Preserves exact security semantics: every frame is still signature-verified before its payload resolves any pending request or advances session state.
  - Works seamlessly across both unit fixtures and the split `nervous` process in `serve`.
- **Cons / risks:**
  - Must ensure every mutation path that adds, revokes, or changes `main` in the registry notifies/refreshes `WorkerLink`'s snapshot promptly so revocation takes effect immediately (within F-036/B-046 bounds).
  - Requires keeping the snapshot consistent during root migration or coordinator relocation (`F-016`).

### Option B — Socket arrival liveness before the async `nervous` queue

Keep `registry.bases()` / `registry.main()` calls async via `RegistryPort`, but decouple timeout expiration from `nervous` IPC latency by recognizing verified/session-matching frame arrival before `nervous` awaits settle.

- **How it works:** When `ws.on('message')` receives a frame matching `this.session` (or verifies its structure/MAC against the pinned peer `remoteKey` on arrival), mark liveness / extend or settle the timeout wait without failing simply because `this.incoming` is still blocked on `nervous` IPC, or allow `expire()` to finish draining frames that arrived at the socket before the deadline without bounding them by `timeoutMs`.
- **Pros:**
  - Minimal surface area: `WorkerLink` does not maintain a second cache of registry state, avoiding any cache-invalidation edge cases on revocation or relocation.
- **Cons / risks:**
  - Every frame still pays four `nervous` SQLite IPC hops per heartbeat interval under normal operation.
  - Careful separation is needed so unauthenticated/revoked frames arriving on the socket can never mark a session alive if authority was actually revoked in `nervous` before `receive()` completes.

## How to record the decision

1. Choose **Option A** (recommended) or **Option B** in conversation or directly in [`docs/work/records/B-066.md`](../work/records/B-066.md).
2. Close `B-066-T01` (`docs/work/tasks/B-066-T01.json`) with the choice and advance `B-066-T02` (`Decouple worker-link frame verification from per-frame nervous IPC`), including restoring a strict heartbeat regression budget in `test/worker-link.test.ts`.
