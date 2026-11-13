# Distributed Contracts, Model Routes, and Runtime Isolation

## Distributed contracts

- `src/kaji.ts` owns the Kaji trust layer: Key of Nebuchadnezzar (Ed25519, scrypt + AES-256-GCM, passphrase never in argv/env), per-base Ed25519 keys, and the append-only Gehirn registry signed by the root and verified against the pinned root fingerprint (no TOFU; newest enrolment wins, revocation always wins).
- `src/kaji-link.ts` listens on the base's enrolled address only, signs every request/reply with the base key (method, path, time, nonce, body digest; requests cannot pass as replies), refuses unknown/revoked bases, stale times, and replayed nonces, merges last-seen, and talks to the registry via `RegistryPort` (scheduler RPC in `serve`, direct in tests).
- Health heartbeats report `online` or `degraded` (at most 3 reasons of 200 chars, first-hand only, never relayed).
- Main base (`kaji main`) is a signed registry record (no automatic election). While main is online, peers poll their own bots, relay outgoing inbox items via `POST /kaji/relay` (accepted only by the main base), and receive taps back via `POST /kaji/decide` (accepted only from the main base). Peer requests dispatch via `POST /kaji/chat` (accepted only by the main base; `kaji:<base>-<channel>`), falling back locally only if the connection itself failed before reaching main.
- Remote actions (`kaji.offers` + owner-only `kaji.run`) queue in `kaji_outbox` and execute over the negotiated signed worker WebSocket with durable stream sequence and deadline; targets hold receipts, leases, and locks in `worker_jobs` (uncertain outcomes never automatically release a lock) and run through `Runtime.runFromPeer`. Legacy HTTP execution is denied; see [worker protocol](../../decisions/worker-protocol.md).
- Peer Casper seats (`POST /kaji/verdict`, accepted only from the main base) are veto-only extra seats in parallel with local Casper (`shadow` by default, or `veto` via `kaji seat BASE veto`).
- Agent role, model endpoint, and execution location remain independent. Node trust requires enrolment; discovery grants no permission. A timeout does not prove an external action failed; inspect device state before replaying physical actions. Never silently send local-only input to cloud inference.

## Model routes

- `src/model.ts` owns route selection and the two adapters; the brain process is the only caller. Privacy defaults to local-only; route choice never falls back to cloud when local fails (`test/model.test.ts` proves both). The cloud key lives in a private file read by the brain, never in env, argv, config, logs, or doctor. `model.complete` is coordinator→brain only: the socket cannot ask, and REST asks need the admin token. Replies are bounded to `MAX_REPLY_BYTES`.
- Route health (`src/route-health.ts`) lives in the brain: every call records outages and the local route gets a 1-minute TCP check (cloud is never probed). A down route is a `degraded` reason, never a reason to switch routes.
- Consultants (`roles.consultant`) and pilots (`src/pilots.ts`) advise Misato on the local route only (`consultant.advise`, max 600 chars, never a vote or action). `choosePilot` is pure (pinned → most keywords → later stage; retired never); after 3 `pilot.unmatched` requests in 30 days `Runtime.proposePilot` opens a `marduk` sortie with an owner-only `pilots.create` card.
- Model setup (`src/model-setup.ts`, `models`, `init`, `GET`/`PUT /api/models`) validates against Ollama `/api/tags` via `planModels` / `validateModels` and reloads the brain in place; the cloud key is never accepted by the API or the dashboard and never returned (only whether it is saved): it is typed at `models key` in the terminal.

## Isolated runtime and protocol

- Read [runtime boundaries](../../decisions/runtime-boundaries.md). Process A owns database/ticks during `serve`; B must not receive root/provider secrets; C owns API/static/network and child lifecycle. Same-user child processes are workload boundaries, not sandboxes.
- All IPC methods have schemas and directed authorization in `src/rpc.ts`. Enrolled outbound workers use the signed protocol in [worker protocol](../../decisions/worker-protocol.md). Browser ticket pairing and local mutation RPC remain unimplemented; do not turn the local read endpoint into an execution tunnel. Bound frames/queues and fail explicitly on oversize replies. Test blocked/killed B and A shutdown/recovery separately.
- Shared surface data is validated in `shared/surface.ts`; `web/src/status-card.ts` must use `textContent` for model/server text (no arbitrary HTML, module URLs, or event handlers).
- The fourth child, `src/tools-process.ts`, is the only place MCP servers run: started on demand by the coordinator, reached only on coordinator→tools (`tools.list`, `tools.call`), holding no ledger, and enforcing grant fingerprints. When `EVA-03` sandboxing ships, this process moves into the sandbox.
