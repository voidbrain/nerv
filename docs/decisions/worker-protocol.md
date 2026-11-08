# Enrolled worker protocol, version 1

F-014 adds an outbound worker channel for registered built-in actions offered by an enrolled base. It does not enable arbitrary shell/MCP tools, device bootstrap, file transfer, pilot execution or physical adapters (F-005/F-006/F-049). The local native `/rpc` endpoint stays read-only. This is a workload boundary under one OS user, not a sandbox against that user's filesystem access.

## Identity and negotiation

A worker connects outbound to the current main base at `GET /kaji/worker`; its own inbound listener need not be reachable. Root-signed registry enrolments and the pinned root identify both peers. The upgrade and every application frame use the base's Ed25519 key, never an admin, root or provider credential. Origin headers (including empty), Authorization headers and URL query credentials are rejected. Revocation, key rotation and a changed main record invalidate authority; the scheduler rechecks both current keys immediately before an effect or deferred approval.

The client generates a fresh UUID session. A signed JSON-RPC 2.0 `worker.hello` negotiates version 1, a scheduler-issued epoch, current advertised tools and an advisory persisted stream cursor. Unsupported versions fail closed. Each direction signs a strictly increasing sequence plus its RPC object using the existing Kaji request/reply signature format, the session-specific path `/kaji/worker/<UUID>`, timestamp, nonce and body digest. Replays, gaps, altered frames and another session's signatures close the channel. Signature verification precedes bounded nonce-cache admission. No JSON-RPC batches or arbitrary method forwarding are accepted on this profile.

The coordinator receives hello/ping; the worker receives ping/run/cancel. Other methods are denied. Signed pings refresh offers and first-hand presence. Default heartbeat is 30 seconds with a 10-second response timeout; reconnect uses jittered exponential backoff capped at 30 seconds. Frames are at most 64 KiB, job arguments 8 KiB and result JSON 24 KiB. Admission is bounded to 16 connections and four outstanding requests per peer. Incoming parsing has a separate eight-frame bounded queue so replies do not consume active request slots; the negotiated peer is published only after its hello acknowledgement is queued. Timed-out request slots remain occupied until a reply or disconnect. Pending upgrades count toward connection admission and expire after five seconds.

Signatures authenticate content and detect alteration; they do not encrypt it. Use the existing encrypted Tailscale overlay between non-loopback enrolled addresses. This version has no file/artifact transfer; results are bounded signed JSON only.

## Acceptance, receipts and effects

The source owner approves `kaji.run`; the scheduler persists the outbox intent. Delivery requires a negotiated peer and a durable dispatch-attempt marker written before transmission. Intent lifetime is five minutes. An expired never-dispatched intent is rejected; an expired attempted intent is uncertain and is never automatically sent again.

The destination binds the job ID, owner, stream sequence and full request/tool/argument digest in SQLite. An ID or sequence collision with another payload is refused. The advisory cursor never authorizes skipping receipt validation or skipping jobs merely because their sequence is lower. Duplicate completed requests replay the stored terminal result; approval progress stays pending at the source until a terminal decision. Receipts survive restart.

The scheduler issues a session/epoch/key-bound lease with a monotonic fencing number and an exclusive base-wide resource lock. Wire leases are at most five minutes; the destination subtracts the two-minute signature clock-skew allowance before using the expiry. Claiming a lease does not authorize an action: the destination still checks its current offers, registered built-in tool, policy, ballot and grant. Grant authorization, current enrolments, lease validation and the local built-in effect run under one SQLite write transaction. Nested Store/Ledger transactions use savepoints.

Pending destination approval cards retain the lock and expire no later than the lease. Approving rechecks the lease, session and both enrolled keys inside the same transaction as the effect. Expiry, rejection or known unexecuted cancellation closes the card and receipt. Reconnection or process restart never silently restarts unfinished work. An unfinished receipt without safe terminal evidence stays uncertain and holds its resource, even after lease expiry. This deliberately favors reconciliation over duplicate effects.

## Cancellation and reconciliation

Source Spear persists cancellation markers for pending remote intents. The coordinator sends signed `worker.cancel` where possible. The cancellation marker and uncertain observation persist when the destination is unavailable, but cancellation is not automatically retried after that terminal uncertain observation; reconcile destination state before further work. A pre-acceptance cancellation creates a tombstone so that a late run cannot execute. During execution it invalidates future lease checks but retains the resource until the handler finishes or an operator confirms it stopped. Completed work returns its original result; cancellation never claims an effect was undone. A late observed terminal result can correct an earlier uncertain source observation without reopening an approval.

Inspect `workers pending`, `workers history`, `workers result ID` and `workers held`. `workers cancel ID --reason "..."` requests cancellation locally; `workers cancel-outbox ID --reason "..."` records a source cancellation. `workers release ID --confirmed-stopped --reason "..."` is an audited local operator assertion that the old handler stopped. It releases the resource but never makes the old job ID reusable. Neither timeout nor a cancellation request is confirmation of stopping. Check actual external/device state before any physical retry; this profile makes no exactly-once physical-effect guarantee.

## Upgrade and recovery

Stop old services before upgrading a base, and update every participating base before enabling new dispatch. Do not run old and new gateway processes against the same runtime directory. There is no fallback to legacy `POST /kaji/run`, even when the peer does not negotiate this protocol.

Old destination `kaji_runs` entries migrate atomically into the receipt journal and retain original evidence. Pending old approval cards are rejected; approved unused grants are revoked. Observed completed actions retain their actual result. Used grants without terminal evidence retain an uncertain lock. Legacy pending source outbox entries are quarantined rather than replayed: `workers held` lists them. Only after confirming that nothing ran may an operator use `workers retry-outbox ID --confirmed-not-run --reason "..."` to create a fresh dispatch deadline. `workers abandon-outbox ID --reason "..."` records uncertainty rather than a fictitious failure.

Back up a stopped runtime before upgrade. Restoring an older database can erase receipts and fencing history: reconcile all outstanding work and peer state before restoring or resuming dispatch. General restore tooling remains F-062; a database rollback is not automatically safe. Remote acknowledgement establishes durable local journal state, not phone notification or external physical completion.

## Evidence and limits

`test/worker-jobs.test.ts`, `test/worker-link.test.ts`, `test/worker-outbox.test.ts`, `test/kaji-run.test.ts`, `test/kaji-link.test.ts` and `test/protocol.test.ts` exercise real signed WebSockets, restart/reconnect, dropped replies, payload collisions, revocation/key rotation during planning, deferred approval fencing, cancellation, migration, expiry, overload and hostile frames. These fixtures use invented local bases; they do not verify a production host, sleeping OS, Tailscale installation, phone receipt or physical adapter. See F-009 for target-host acceptance and B-021 for model judgment evaluation.
