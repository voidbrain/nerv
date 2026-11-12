# Coordinator relocation without split brain

**Status: proposed, 12 November 2026 (F-016-T01). Independent review (F-016-T02) and owner agreement pending; no code implements it yet.** F-016-T03 (signed snapshot export/import), F-016-T04 (incremental log shipping), F-016-T05 (leader epoch and fencing tokens), F-016-T06 (lease renewal and wake refusal), F-016-T07 (owner-initiated relocation with restore) and F-016-T08/T09 (partition, sleep, reconnect and two-device acceptance) build on it once reviewed and agreed.

## Problem

NERV runs one logical coordinator (`main` in the Gehirn registry) on an always-on host, while enrolled worker bases execute bounded jobs over the signed worker channel ([runtime boundaries](runtime-boundaries.md), [worker protocol](worker-protocol.md)). Today `src/kaji.ts` selects `main` from the newest root-signed `kind: 'main'` registry record (`serial` order), and `src/store.ts`, `src/ledger.ts`, `src/kaji-link.ts` and `src/worker-jobs.ts` assume the local SQLite database never moves to another machine.

Moving the logical coordinator to another enrolled base (for example from the mini PC to the Mac before travel, or from an asleep/failed host to a standby) raises four split-brain and replay hazards:

1. **Incomplete or context-only state**: copying Lilith memory or conversation text without the Central Dogma ledger, approval states, inbox `deliveries` rowid sequence, watch/brief checkpoints and `kaji_outbox` receipts would replay fired reminders, reset native/Telegram delivery cursors, drop pending approvals or re-run uncertain remote actions.
2. **Simultaneous authorities during partition or sleep**: if a laptop or host holding `main` sleeps with queued timers or a partitioned network and a second base becomes `main`, the old coordinator could wake and fire a reminder, issue a ledger grant, poll Telegram or dispatch a remote relay before learning it was replaced.
3. **Unfenced in-flight requests**: a slow or delayed Kaji request or `worker.run` frame sent by the old coordinator before cutover could reach a worker base after the new coordinator has taken over.
4. **Secret leakage across bases**: copying the raw `data/` directory or full SQLite files across bases would copy host-bound private keys (`base-key`, `key-of-nebuchadnezzar.enc`), bearer tokens, Telegram tokens and local native-pairing credentials (`native-auth.sqlite`).

## Decision

### 1. Replicated coordinator state vs. base-local state (F-016-T03, F-016-T04)

Coordinator relocation replicates the **logical agency state** in `nerv.sqlite` to an enrolled read-only standby base and never copies host-bound secrets or destination-worker state.

| Category | Tables / files | Rule on relocation |
|---|---|---|
| **Replicated coordinator state** | `reminders`, `deliveries` (preserving exact integer `rowid` and UUID `id`), `daily_briefs`, `watch_runs`, `watch_notices`, `approval_deliveries`, `instrumentality_runs`, `sorties`, `sortie_controls`, `actions`, `approvals`, `events`, `facts`, `fact_history`, `episodes` (FTS5 tables rebuilt locally on import), `registry`, `registry_roots`, `registry_seen`, `kaji_seen`, `kaji_outbox`, `worker_outbox_jobs`, `worker_outbox_events`, `milestones`, and coordinator keys in `state` (`telegram.cursor`, `instrumentality.*`, `watch.*`, `replication.*`) | Exported in signed snapshots (F-016-T03) and kept current by incremental signed log batches (F-016-T04). |
| **Ephemeral epoch-bound state** | `grants` (`src/ledger.ts`), active in-memory timers and open SSE streams | Never replicated as executable. Every unconsumed grant expires on epoch change and must be re-authorized under the new epoch. |
| **Base-local state (never replicated)** | `key-of-nebuchadnezzar.enc`, `base-key`, `token`, `anthropic-key`, `telegram-token`, `native-auth.sqlite`, `push_vapid`, `push_subscriptions`, `model_usage`, and destination-side `worker_sessions` / `worker_jobs` | Stays on its own host. Each base keeps its own enrolled identity, local tokens and paired device credentials. |

- **Signed snapshot export and standby import (F-016-T03)**:
  - The active coordinator exports a canonical JSON/binary snapshot of the replicated tables inside a single SQLite read transaction, together with a manifest `{ version, root, sourceBaseId, leaderEpoch, headSeq, exportedAt, tableCounts, sha256 }` signed by the coordinator's enrolled Ed25519 base key.
  - A designated standby base verifies the pinned root, the source base's active enrolment and `main` record at `leaderEpoch`, the schema version ([node upgrades](node-upgrades.md)) and the SHA-256 digest before importing into its local SQLite store in **read-only standby mode** (`replication.mode = 'standby'`).
  - Preserving exact `deliveries.rowid` values keeps `/api/inbox?after=<cursor>` and `telegram.cursor` continuous across relocation so neither native clients nor Telegram replay already-delivered reminders, briefs, watches or approval cards.
  - While in `standby` mode, the base refuses coordinator mutations and suppresses background loops (`Store.tick`, `Store.watchPoll`, `Store.addBrief`, Instrumentality, `KajiLink.flush` and Telegram polling). It may still act as an enrolled worker for `WorkerJobs`.
- **Incremental log shipping (F-016-T04)**:
  - Each committed coordinator transaction on the active `main` base appends a deterministic replication batch keyed by `(leaderEpoch, seq)` with `prevDigest` and `batchDigest`.
  - The coordinator ships ordered batches to the enrolled standby over the authenticated Kaji link (`POST /kaji/replicate`, signed with the coordinator's base key and carrying the current fencing token).
  - The standby applies batches idempotently in strict `(leaderEpoch, seq)` order inside a single transaction. If a batch arrives with a sequence gap or a `prevDigest` mismatch, the standby rejects it with `need_resync` (`expectedSeq`) and remains safe at its last verified checkpoint until catch-up or a fresh snapshot completes.

### 2. Leader epoch in signed registry records and bounded leader lease (F-016-T05, F-016-T06)

- **Monotonic leader epoch in `main` records (F-016-T05)**:
  - Root-signed `kind: 'main'` records in `src/kaji.ts` carry an explicit integer `leaderEpoch` (`>= 1`; legacy `main` records without the field read as `leaderEpoch: 0`).
  - A new `main` record is valid only if both its registry `serial` and its `leaderEpoch` are strictly greater than the previous `main` record under the pinned root (`next.serial > prev.serial && next.leaderEpoch > prev.leaderEpoch`).
  - Only the owner holding the `Key of Nebuchadnezzar` (or a replacement root activated via [root migration](node-root-migration.md)) can sign a `main` record and advance `leaderEpoch`. No base can self-promote or elect itself.
- **Bounded leader lease and wake refusal (F-016-T06)**:
  - Holding the latest `main` record is necessary but not sufficient to act: the coordinator must also hold an active, unexpired **leader lease** for `leaderEpoch` (`LEASE_TTL_MS = 60_000`, renewed every `LEASE_RENEW_MS = 15_000`).
  - Lease renewal checks both wall clock (`Date.now()`) and monotonic elapsed time (` process.hrtime.bigint()`) since the previous renewal, plus the local registry's highest known `leaderEpoch`.
  - If the host sleeps (for example macOS lid close or VM pause) or stalls so that monotonic or wall-clock time since the last renewal exceeds `LEASE_TTL_MS - KAJI_CLOCK_SKEW_MS`, the lease is **immediately expired on wake** before any timer callback, reminder tick, grant authorization, outbox flush or Telegram poll can run.
  - Once a lease expires during a partition or sleep where a standby may be promoted, or once any peer or worker reports a higher `leaderEpoch`, the old leader transitions to `fenced` / non-main state and refuses all coordinator actions. If no relocation occurred while the host slept, the coordinator may resume its lease for the same `leaderEpoch` only after confirming with its configured standby/peers (or owner lease re-arm when no standby is configured) that no higher `leaderEpoch` was issued.

### 3. Fencing tokens checked at every effect boundary (F-016-T05, F-016-T06)

Every coordinator-initiated effect carries and verifies a fencing token `(leaderEpoch, fenceSeq)` where `leaderEpoch` is the signed `main` epoch and `fenceSeq` is a strictly increasing counter stored in SQLite (`replication.fence_seq`).

| Boundary | Fencing check | Behaviour on stale epoch or expired lease |
|---|---|---|
| **Local scheduler & inbox (`src/store.ts`)** | `tick`, `addBrief`, `watchPoll`, `runInstrumentality`, `runAction` and `decide` assert `isActiveCoordinator(now)` (local base is `main` at `maxSeenLeaderEpoch` and lease is unexpired). | Refuses immediately without mutating `reminders`, `deliveries`, `watch_runs` or `daily_briefs`; logs a fenced-leader audit event. |
| **Ledger grants (`src/ledger.ts`)** | `Ledger.authorize` embeds `leaderEpoch` and `fenceSeq` in the grant row; `Ledger.consume` checks that the grant's `leaderEpoch` equals the active coordinator's current `leaderEpoch` and the lease is still valid. | A grant minted just before sleep or demotion cannot be consumed after wake or epoch bump (`stale_leader_epoch`). |
| **Kaji peer link (`src/kaji-link.ts`)** | Coordinator requests (`/kaji/relay`, `/kaji/replicate`, `/kaji/verdict`, `/kaji/decide`) include signed headers `X-Kaji-Epoch` and `X-Kaji-Fence`. Each base persists `maxSeenLeaderEpoch` from verified registry records and peer headers. | If `X-Kaji-Epoch < maxSeenLeaderEpoch`, the receiving base rejects the request (`409 stale_leader_epoch`) and returns its newest signed `main` record so the caller immediately fences itself. |
| **Signed worker channel (`src/worker-link.ts`, `src/worker-jobs.ts`)** | `worker.hello`, `worker.run` and `worker.cancel` carry `leaderEpoch` and `fenceSeq`. `WorkerJobs` persists `(maxLeaderEpoch, maxFenceSeq)` under the pinned root. | Any frame with `leaderEpoch < maxLeaderEpoch` (or equal epoch with regressed `fenceSeq` on the same session) is rejected before execution (`stale_leader_epoch`), and any running job from an older epoch is fenced from emitting new coordinator side effects. |
| **External channels (`src/telegram.ts`, native push)** | Telegram `getUpdates` polling and outbound delivery flushes check `isActiveCoordinator(now)` before every request and before advancing `telegram.cursor`. | A demoted or lease-expired coordinator stops polling and sending immediately, preventing duplicate bot messages or split updates. |

### 4. Owner-initiated relocation and restore; never context-only takeover (F-016-T07, F-016-T08, F-016-T09)

- **Explicit owner action only**:
  - Missed heartbeats or `KajiLink` offline transitions never trigger automatic failover. Relocating `main` is always an explicit owner operation (`kaji relocate` / root-signed `main` record for the target base at `leaderEpoch = oldEpoch + 1`).
- **Context copying alone never grants leadership**:
  - A base cannot activate as coordinator for `leaderEpoch > 0` with an empty store or with copied Lilith facts/chat history alone. Promotion requires a verified replicated state (`replication.mode = 'standby'` with verified `headSeq` and `stateDigest`, or an explicit cold restore from a verified signed snapshot) bound to the predecessor epoch, except on initial agency bootstrap (`leaderEpoch = 1` on the first base).
  - The signed `main` record (or owner relocation bundle) for `leaderEpoch = E + 1` commits to the predecessor's `previousEpoch: E` and minimum required `minHeadSeq` / `snapshotDigest` so an out-of-date standby cannot be promoted accidentally without the owner explicitly approving a bounded state-loss restore from a named snapshot.
- **Cutover protocol (planned drain vs. unreachable old leader)**:
  1. **Planned relocation (old leader reachable)**:
     - The old coordinator enters `draining` mode: it stops starting new sorties or ticks, flushes its final committed delta batch (`headSeq`) to the standby, revokes its own active lease for epoch `E`, and returns a base-key-signed **drain receipt** `{ baseId, leaderEpoch: E, finalSeq, stateDigest, leaseRevokedAt }`.
     - Because the old leader has durably revoked its lease and shipped `finalSeq`, the standby verifies `stateDigest` and activates epoch `E + 1` immediately upon receiving the root-signed `main` record—zero lost rows and no lease-wait delay.
  2. **Unplanned relocation (old leader asleep or unreachable)**:
     - If the old coordinator cannot return a drain receipt, the standby records the last verified batch `(E, headSeq)` (or imports the latest signed snapshot) and enforces the **safety wait window** until `lastKnownLeaseIssuedAt + LEASE_TTL_MS + 2 * KAJI_CLOCK_SKEW_MS` has elapsed before activating epoch `E + 1`.
     - This guarantees the old leader's local lease has expired on its own clock before the new coordinator can fire a single tick or issue a grant.
- **Restore and quarantine on activation**:
  - Before enabling its scheduler loop for epoch `E + 1`, the newly promoted coordinator runs a single atomic activation transaction:
    1. Marks any open `running` or `approved` sorties from epoch `E` as `interrupted` (`closeInterrupted`), keeping `waiting` approval requests intact for the owner to decide under epoch `E + 1`.
    2. Expires all unconsumed rows in `grants` from epoch `E`.
    3. Quarantines any `kaji_outbox` or `worker_outbox_jobs` entries left in `attempted` state without a terminal receipt as `uncertain` (`quarantined`), surfacing them for owner review rather than replaying an external or remote action that may already have executed.
    4. Switches `replication.mode` from `'standby'` to `'active'`, records `leaderEpoch = E + 1`, and starts a fresh lease.
- **Reconnect of the old leader (F-016-T08, F-016-T09)**:
  - When the old leader wakes or reconnects after cutover, its local lease check has already fenced its scheduler. On its first Kaji heartbeat or registry sync it receives the root-signed `main` record for `E + 1`, persists `maxSeenLeaderEpoch = E + 1`, drops any queued outbox/timer work from epoch `E`, and becomes a non-main enrolled base (eligible to receive snapshots/log batches as the new standby once re-seeded).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Automatic Raft / Paxos consensus and heartbeat-triggered leader election | Violates [runtime boundaries](runtime-boundaries.md): NERV typically has two or three bases across home LAN, Tailscale and a sleeping laptop, where a majority quorum is unavailable whenever one host sleeps and heartbeat loss is routine. Root-signed owner relocation with leases and fencing prevents split brain without false failovers. |
| Context-only takeover (copying Lilith facts or conversation history to a fresh base and signing `main`) | Loses the Central Dogma ledger, pending approvals, `deliveries.rowid` cursors, reminder/watch fire state and `kaji_outbox` attempt state—causing duplicate reminder deliveries, replayed actions and lost safety gates. Explicitly forbidden by F-016's acceptance criteria. |
| Raw `nerv.sqlite` / `data/` file sync (rsync, Syncthing or volume replication) | Copies base-local private keys (`base-key`, `key-of-nebuchadnezzar.enc`), bearer tokens, Telegram tokens and `native-auth.sqlite` across machines, and can corrupt SQLite WAL state if copied outside a coordinated transaction boundary. |
| Trusting registry `serial` alone without `leaderEpoch`, leases and effect-level fencing | A partitioned or sleeping old leader does not see the newer `serial` until it talks to a peer; without a local lease expiry and per-effect fencing tokens on `Store`, `Ledger`, `KajiLink` and `WorkerJobs`, it can fire local reminders, poll Telegram or send delayed requests concurrently with the new leader. |
| Automatically replaying in-flight `attempted` outbox actions on the new coordinator | An `attempted` remote relay or worker job may already have run on the destination base before the connection dropped. Replaying it automatically can duplicate physical or external effects; quarantining `attempted` items matches [worker protocol](worker-protocol.md) uncertainty rules. |

## Consequences and mapping to F-016 slices

- **F-016-T02 (Step 1b)**: Independent fresh-context review of this decision record before implementation starts.
- **F-016-T03 (Step 2a)**: Implements canonical signed snapshot export on the coordinator and verified read-only standby import (`replication.mode = 'standby'`), preserving `deliveries.rowid` and excluding base-local secrets and tables.
- **F-016-T04 (Step 2b)**: Implements ordered, base-key-signed incremental log batches over `/kaji/replicate` with sequence/digest chaining and `need_resync` detection.
- **F-016-T05 (Step 3a)**: Adds `leaderEpoch` to root-signed `main` registry records and `(leaderEpoch, fenceSeq)` fencing checks across `Store`, `Ledger.authorize`/`consume`, `KajiLink` and `WorkerJobs`.
- **F-016-T06 (Step 3b)**: Implements bounded coordinator lease renewal, monotonic/wall-clock sleep detection, immediate wake refusal when expired or superseded, and peer/worker rejection of stale epochs.
- **F-016-T07 (Step 4a)**: Implements owner-initiated `kaji relocate` (planned drain receipt path and unreachable lease-wait path), quarantine of `attempted` outbox work, and refusal of context-only takeover.
- **F-016-T08 (Step 5a)**: Deterministic multi-base fixtures covering network partition, sleeping old leader waking with queued reminders/grants/relays, and reconnect reconciliation proving one authority at a time and zero duplicate effects.
- **F-016-T09 (Step 5b)**: Live two-device relocation acceptance run with the owner.

Reconsider when: NERV moves beyond owner-operated enrolled bases, a hardware token or threshold root replaces the single `Key of Nebuchadnezzar`, or live two-device trials (F-016-T09) show `LEASE_TTL_MS` needs tuning for target links.
