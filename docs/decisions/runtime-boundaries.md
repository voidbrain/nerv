# Runtime boundaries and architecture review

Decision reviewed 1 November 2026. Keep Node.js/TypeScript; isolate responsibilities and enforce bounded contracts. No Agency Swarm runtime dependency is adopted.

## Evaluation of the supplied review

| Claim / suggestion | Decision and correction |
|---|---|
| Node is unsuitable because it is single-threaded | Reject the conclusion. Synchronous CPU work, JSON processing, filesystem and SQLite calls can block one event loop. Ordinary asynchronous network waits do not. Process separation addresses workload and fault boundaries without a backend rewrite. |
| Worker threads immediately | Adopt isolation now, using child processes for the scheduler/database and execution boundary. Threads can later serve measured CPU pools. Processes consume memory and do not provide a security sandbox under the same user. |
| A “Nervous System” and B “Brain” | Adopt, adding C as API/static/transport gateway. A must not serve UI files or parse model output. D is the future native OS bridge; tools/discovery can receive bounded workers as needed, not one permanent daemon per tiny operation. |
| Angular AOT obstructs GenUI | Correct: precompiled registered components can be selected dynamically. No runtime compiler or model-supplied JavaScript is needed. Adopt Web Components for portability, selected by validated data, not arbitrary raw HTML. Shadow DOM is encapsulation, not a security boundary. |
| Tailscale kernel integration | Adopt an optional overlay adapter, not mandatory kernel integration or embedded VPN implementation. Overlay reachability/identity is separate from NERV Agency enrolment and application authorization. It cannot keep a sleeping Mac awake or guarantee connectivity. |
| Agency Swarm depends on old Assistants API assumptions | Outdated framing. Current official docs show multiple patterns and directional communication flows. Reuse explicit edges and typed contracts; avoid a Python/provider-oriented runtime dependency in this TypeScript core for architectural reasons, not the old API claim. |
| Typed schemas make execution deterministic | Schemas validate structure; effects and models remain nondeterministic. Idempotency, state reconciliation, leases, resource locks and provenance remain required. |
| WebSockets + JSON-RPC 2.0 | Adopt for the node protocol. JSON-RPC is transport-independent and does not supply identity, authorization, cancellation, durable delivery or exactly-once effects. Implement those above it. First endpoint is authenticated local read-only RPC, not remote-worker support. |
| Move the “CEO” when a Mac sleeps | Keep a logical user-facing orchestrator role distinct from the durable coordinator. Prefer an always-on coordinator. Coordinator migration needs replicated durable state, leader leases, epochs/fencing and recovery tests; copying context or losing a heartbeat is insufficient and can create split brain. |
| Native addons | Prefer the SwiftUI/native OS bridge for notifications/hotkeys and existing native SQLite. Add Node-API addons only for a measured missing capability; require signed/versioned binaries and ABI/platform packaging tests. No custom addon is introduced now. |

## Process ownership

| Process | Responsibility | Current state |
|---|---|---|
| A — Nervous System | SQLite, due reminder ticker, local inbox and persistence RPC | Implemented for serve; 250 ms catch-up poll, bounded IPC, no model execution |
| B — Brain | Model/provider calls and planner steps | Isolated model process; C owns orchestration and A gates execution |
| C — Gateway/supervisor | Loopback REST, static UI, authenticated local WebSocket reads, child lifecycle | Implemented; async file reads; stops for OS-supervisor recovery if A exits |
| D — Native bridge | SwiftUI menu and Keychain client | Development preview includes opt-in notifications and guarded OS controls; live acceptance remains F-011 |
| Capability workers | Browser/editor, discovery, coding or device execution | Planned; enrolled and restricted individually |

Scheduled briefs atomically commit a local-day identity and inbox delivery in the scheduler database. The additive daily_briefs table preserves all inbox UUIDs and cursor rowids. Unknown checkpoint reads and complete core-source outages defer to a later bounded scheduler tick; partial briefs name unavailable sources.

A reminder is persisted before it is considered accepted. B may be blocked, unavailable or timed out while A continues scheduling. If A fails, C exits unsuccessfully so launchd/systemd can recover the runtime. Graceful shutdown terminates both children; parent IPC disconnect stops them. Standalone CLI commands still use short direct SQLite operations, so this is not a global exclusive-writer guarantee. History reads now use rowid keyset pages (20 rows by default, at most 50 and 32 KiB of items); the Angular workspace replaces one page at a time. The live dashboard reads ten upcoming reminders, the latest brief and SQL delivery counts, and labels the limited view. Legacy REST/WebSocket array reads reject a history requiring more than one page instead of truncating it. Local CLI full exports and the internal daily brief can still aggregate history in C; each IPC query remains bounded. Long SQLite transactions can delay A up to its 5 s busy timeout; the 250 ms ticker is not a latency guarantee. See [F-013 acceptance](../acceptance/runtime-2026-11-07.md) for the measured workload and limits. This is not hard real-time scheduling and does not execute through system sleep.

## Communication and protocol

`src/rpc.ts` owns method JSON Schemas and the deny-by-default directed graph. Current edges: interface → coordinator; coordinator → nervous; coordinator → brain (model/provider calls, planner steps, consultant advice and health). Neither a Pi nor any model is automatically trusted to delegate tools. Role, device capability, selected model and transport identity remain independent. Do not permanently prohibit a Pi from reasoning: it may advertise a small local model if capability/latency evaluations pass; a sensory-only Pi is a deployment choice, not a hardware trust rule. Schema validation, graph authorization and business validation are separate checks.

Approval-card reconciliation uses a read-only coordinator → nervous point lookup for at most 200 IDs, independently of pending-card pagination. The signed Kaji status endpoint is restricted to the configured main base and validates bounded IDs and the returned subset; it cannot decide or execute anything.

Local IPC carries JSON-RPC objects. `/rpc` upgrades WebSockets only with a bearer Authorization header and no browser Origin; it never accepts tokens in URLs. Clients can read doctor/reminders/inbox and ping. Mutation RPC is explicitly rejected until durable request idempotency and reconciliation exist. Browser UI keeps using authenticated REST; browser session tickets are not implemented. Frames are limited to 64 KiB, batches to 16, frames in flight to four per socket and child requests to 32, including startup waiters and timed-out requests awaiting late replies. A timeout reports an unknown outcome and never frees admission until a reply, send failure or disconnect; an indefinitely stalled child stays saturated until recovery. Compression is off. Socket responses are bounded; oversize history fails explicitly rather than being silently truncated. Stream sequencing, heartbeats, global connection budgets, reconnect/resume cursors and remote enrolment are later protocol work, not properties inherited from JSON-RPC.

## Web Component contract

`shared/surface.ts` exposes the versioned schema/validator for the registered `nerv-status-card`. NERV Agency ships the executable component; data selects the component and bounded text props. The component uses textContent, never HTML evaluation, model event handlers, arbitrary attributes/styles/URLs or dynamic module imports. Angular hosts the registered custom element inside its stable navigation. This is a renderer foundation and live deterministic doctor-status card, not model-driven UI generation. DOM tests are not real browser, visual or accessibility acceptance.

## Secure native handoff (development implementation)

Pinned localhost HTTPS on optional port 4319 carries a two-minute single-use invitation and a separate 30-day revocable read-only client credential. The trusted CLI obtains its invitation over TLS using the persisted certificate and administrative token; the invitation includes a fingerprint/runtime UUID. The Swift companion checks the fingerprint before sending the ticket, sets the exact pinned certificate as its local trust anchor, validates the hostname and certificate dates, rejects redirects and stores the client credential in Keychain. It does not acquire the root/provider credential. Every native read checks verifier expiry/revocation and the daemon's runtime UUID. Pairing state/verifiers live in private native-auth.sqlite owned by C, separate from A's reminder database. Browser Origins are rejected on the native listener; invitations are not issued by plaintext HTTP. No system-wide certificate trust change occurs.

These are workload/client capability boundaries under one user, not protection against compromise of that user's filesystem or private TLS key. Certificate rotation, credential renewal, scoped native WebSocket sessions and live Keychain/menu/OS acceptance remain incomplete. See [native guide](../../native/README.md). Service controls are separate user-initiated OS actions with local runtime-directory matching; the read-only network credential does not authorize mutation. Quit companion does not stop NERV Agency.

## Overlay and sleeping workers

Optional Tailscale transport uses explicit host enrolment, scoped grants and reviewed bootstrap credentials. Do not give the model a reusable tailnet administration key or change system network settings automatically. LAN printers can be reached through an enrolled LAN worker without joining the overlay. A worker transitions online → suspected/offline → reconnecting → online; a heartbeat timeout never proves a physical action stopped. Reconcile state, job expiry and resource ownership after wake before granting work again. Wake-on-LAN may be an explicit supported capability where hardware permits; it is not a cross-platform guarantee. Coordinator relocation is a separate later milestone.

## Primary sources reviewed

- Node worker threads: https://nodejs.org/api/worker_threads.html (CPU work versus built-in asynchronous I/O).
- Angular custom elements: https://angular.dev/guide/elements .
- JSON-RPC 2.0: https://www.jsonrpc.org/specification .
- Agency Swarm communication: https://agency-swarm.ai/core-framework/agencies/communication-flows .
- Tailscale grants: https://tailscale.com/docs/features/access-control/grants .
- Apple Keychain: https://developer.apple.com/documentation/security/keychain-services .
