# Architecture

## Implemented boundary

During serve, A owns SQLite/ticker/inbox in an isolated child, B is an execution/health child with no agent loop yet, and C serves REST/static UI and supervises children. C accesses A through schema-validated JSON-RPC IPC; static file reads are asynchronous. Standalone CLI commands still use the Store directly. REST contracts remain compatible. Native clients can read local `/rpc` over authenticated WebSockets; remote workers and mutation RPC are not implemented. See [the runtime decision](decisions/runtime-boundaries.md) for bounds, failover and security limits.

## Intended distributed boundary

One coordinator initially owns jobs, scheduling, permissions, node registry, notification delivery and authoritative orchestration state. Enrolled workers open outbound authenticated connections. Use one SQLite writer on its local disk, never a database file mounted over the network. Worker-local state may retain bounded execution journals. Coordinator replication and automatic leader failover are deferred.

A role is not a machine and a machine is not a model. A coder on the mini PC may use Gemma on the Mac or Claude remotely, subject to privacy and budgets. A Pi can expose device operations and voice without hosting a useful LLM. Model capabilities are probed, not inferred from names. Route by tool reliability, memory, queue, availability, privacy and task needs. The mini PC can remain on while the Mac sleeps; jobs needing the Mac wait, expire or use an explicitly permitted alternative.

## Protocol requirements before remote execution

Version negotiation, enrolled device identities, key rotation/revocation, heartbeat, capability advertisements, job leases, fencing tokens, deadlines, cancellation, artifact integrity, delivery acknowledgement and bounded retries. Idempotency suppresses known duplicate intents; it cannot create exactly-once physical effects. Reconcile uncertain external results before repeating them. Resource locks prevent two jobs controlling one printer or mutating one checkout concurrently. Do not assume a disconnected worker stopped: fencing must be enforced at the protected resource, or conflicting reassignment must remain blocked.

## Discovery and bootstrap

Discover using selected LAN ranges, mDNS/DNS-SD, configured SSH targets, Tailscale inventory and USB adapters where available. Inspect candidates without enrolling them. Produce a concrete installation plan listing target identity, version, permissions, dependencies, service changes and rollback. On authorized hosts, bootstrap through authenticated SSH or a pairing command with pinned checksums. Verify identity, run doctor and a harmless capability test. Support updating, revoking and uninstalling. Discovery is not a trust grant; printers may need only an API adapter.

## GenUI and interfaces

The stable Angular shell owns navigation and device/permission management. A schema-validated Surface now references an allowlisted Web Component; Angular hosts it in the stable shell. The first deterministic status card is implemented; model surface generation is not. Treat remote agent/tool data as untrusted; never evaluate generated JS or bypass backend permissions. Telegram receives text/buttons representing the same operations. Future voice is another input/output adapter. PWA install, push delivery and background constraints require device tests.

## Skills, models and tools

Tools are versioned typed capabilities, with policy enforced outside prompts and skills. Prefer direct APIs; MCP provides interoperability for app and coding clients. Browser and shell workers require bounded execution environments. Secrets stay in host-managed storage, outside model context and logs. Local-only jobs cannot silently fall back to cloud. Self-improvement proposes memory/skill/code changes, evaluates them in isolation, and promotes versioned changes with rollback; it cannot grant itself permissions or rewrite its evaluator.

## Action governance (planned, milestone 2a)

Names follow the [NERV architecture](NERV/NERV-ARCHITECTURE.md); code uses plain names. The agent (Misato) works in a loop and every proposed action is gated at the executor, not once per plan. Each tool declares an effect class: read, local reversible write, external write, irreversible or physical. The deterministic policy engine derives the Pattern from it: Green (read, local reversible), Orange (external reversible) and Blue (irreversible, physical, or external effect requested from tainted context). Melchior (rules) and Balthasar (reversibility, budget, taint) are deterministic seats; Casper (intent) is one reasoning-blind model seat for Orange and Blue. Extra seats can only reject. A Sync Ratio (0–100 %) is derived from seat verdicts, the pilot's trust record and reversibility, and is always shown with its inputs. Blue or a low ratio requires the owner (Misato's apartment); approvals have a TTL and expiry never approves. A capability grant (A.T. Field) is scoped and short-lived, and the executor checks it on every call. Inputs carry provenance; content from email, web and third-party sources is tainted and cannot cause an external effect without the owner. Ballots, grants, approvals and steps are append-only ledger events with one versioned schema (`src/events.ts`) shared by the ledger, the read APIs and the dashboard. Revocation (Spear) cancels grants and runs only declared inverse actions; any other effect is reported as already happened. Implemented so far: the deterministic ballot, grants, approval cards, the Spear and the versioned event ledger; the planner loop, Casper's model seat in the loop, approval delivery and provenance/taint are still open (F-017, F-023, F-024, F-027 in the backlog).

## Domain ownership

The FPV app owns batteries, aircraft damage and maintenance state. NERV Agency invokes its typed API/MCP tools. Distinguish recording a charge from starting a physical charger. Calendar, insurance deadlines and absence dates are structured facts with provenance and correction, not guesses reconstructed from chat history.

## Local lifecycle and native companion

The OS supervisor owns starting/restarting the Node process; Angular is not responsible for keeping reminders alive. launchd is a per-user GUI agent; systemd uses the current user session. Sleep and logout limits must be visible. The planned native macOS companion uses SwiftUI MenuBarExtra, with independent app/service lifecycles and authenticated API access. Electron is not a dependency.

## Native pairing implementation

Optional native HTTPS on loopback 4319 is enabled by native-init. The existing web/API remains on 4317. The gateway loads a private localhost TLS key/certificate and a separate bounded native credential database. Reminder SQLite/ticks remain in A; Brain receives neither TLS keys nor master/native credentials. The credential database contains only verifier hashes, metadata and a persistent runtime UUID. Small administrative operations occur in C and do not share A's reminder transaction queue.

An authenticated CLI uses the persisted TLS certificate to request a two-minute single-use invitation. It includes the certificate fingerprint and runtime identity. The companion pins that certificate before presenting its ticket, validates hostname/expiry through Security.framework, claims a 30-day read-only client credential and stores it in Keychain. Each subsequent request is TLS-pinned, checks server-side revocation/expiry and checks the runtime UUID before accepting state. Redirects are denied. Nothing adds the local certificate to global trust. Invitations and native tokens are not URL parameters or provider credentials. Per-client socket authentication remains unimplemented; native preview uses REST.

## Native notifications and lifecycle controls

The companion polls every 15 seconds while paired/running. A provides bounded inbox pages with sequence plus delivery-UUID checkpoints in a consistent read transaction. The initial notification baseline is the current inbox head, so enabling notifications does not replay history. Atomic private per-runtime checkpoints advance after OS acceptance/reconciliation. A sequence/UUID mismatch after restore triggers a visible reset to the current head, not an automatic history replay. Deterministic OS request identifiers and pending/delivered reconciliation reduce duplicates; cross-system crash/dismissal windows prevent exactly-once banner guarantees.

The native service controller runs only fixed launchctl argv for the current user's io.nerv.agent. Stop is a separate confirmed action; Quit companion does not call it. A paired daemon's authenticated data directory must match the local agent NERV_HOME before these controls are enabled. SMAppService controls companion login registration independently of the daemon and displays the real approval state. These OS actions use local user authority and never broaden the read-only network credential. No CI test registers a login item, requests notification permission or starts/stops a real user service.

## Status versus diagnostics

`GET /api/status` is an authenticated lightweight runtime ping used by companion polling and notification enablement. It explicitly reports integrityCheck=not-run. `GET /api/doctor` remains an explicit diagnostic and may perform SQLite quick_check. Native background refresh must not invoke full diagnostics on a timer; the bounded inbox/pending reads remain separate.
