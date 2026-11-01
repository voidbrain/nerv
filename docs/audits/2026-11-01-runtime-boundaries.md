# Nodo runtime boundaries — scoped review, 1 November 2026

Baseline is the current origin/main commit recorded in the matching manifest; changed scope is this branch's process/RPC/surface implementation and related documentation. Earlier reports remain historical. This is not a completed full product/device audit.

## Inspected areas

| Area | Evidence and limits |
|---|---|
| code | Reviewed scheduler/SQLite child A, execution boundary B, HTTP/static/WS supervisor C, validation, lifecycle and Web Component host. No model/agent or remote worker exists. |
| logic | Traced REST → async facade → directed/schema-checked IPC → Store; due tick remains in A. Traced killed/blocked B, killed A, graceful close and restart. Raw HTML/actions are never supplied by surface data. |
| tests | 15 regression/protocol/DOM/isolation tests plus real headless integration. Brain CPU stall does not stop delivery; A death exits C unsuccessfully; child PIDs disappear on shutdown; restart does not duplicate delivery. DOM text escaping is checked with LinkeDOM, not a real browser or AXE. |
| documentation | Reconciled README, architecture, milestones, installation, area/style notes and F-013–F-016. Reviewed the supplied claims against primary sources linked in the decision record. |
| harness | Retained copied helpers and v3.1.1; project-specific boundaries/impact map/receipt updated. No generic template modification. Merged branch cleanup lacks a write-capable git shell/delete-ref tool; it is not silently claimed complete. |
| security | Read-only bearer-auth native WS, browser-Origin and query-token rejection, schemas, directed edges, bounded frames/batches/pending calls, IPC environments without inherited root/provider tokens, no arbitrary HTML or tool runtime. Same-user processes are not sandboxes. |
| delivery | TypeScript, Angular production build, process/DOM tests, conventions, backlog/integration/maintenance/audit checks inspected. Production dependency audit reports zero known vulnerabilities after updating Ajv to 8.20.0 and ws to 8.22.1. Remote PR checks are separate evidence. |
| backlog | Preserved previous IDs and acceptance gaps; added isolation, protocol completion, native pairing and later coordinator relocation outcomes. No remote/native/failover capability is marked complete. |

## Findings and limits

- The supplied review conflated async network waits with blocking CPU work; corrected in the decision record. Angular registered rendering is compatible with AOT; Web Components are a portability choice, not an execution sandbox.
- Process A owns DB/ticker during serve, but standalone CLI writes still use SQLite directly. Busy transactions and unbounded historical queries can affect latency. Frames fail explicitly above 64 KiB; pagination and measured load limits remain F-013.
- B exposes health only. It has no model, tool or agent loop. Same-user child isolation reduces workload coupling but grants no sandbox security guarantee.
- Native `/rpc` is loopback and read-only. Node enrolment, heartbeat/reconnect, durable mutation idempotency, stream sequencing and per-client native credentials are not implemented (F-014/F-015).
- First Web Component is a deterministic doctor status card. Model surface selection, browser visual/accessibility and real phone acceptance remain F-004.
- Native Swift/Keychain pairing, Tailscale integration, wake capabilities and leader migration are designed/tracked, not installed. F-016 requires state replication and fencing; moving a context file is not failover.
- One local service now supervises three Node processes; no migration of reminders is required for this change. Node 24+ and npm ci remain required after pulling new dependencies.

The review performed static tracing and the named tests, not a guarantee of no defects, hard-real-time delivery or live device acceptance. The unperformed checks remain in their owning records.
