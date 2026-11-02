# Nodo roadmap

| Milestone | Scope | Acceptance |
|---|---|---|
| 0 — Harness and contracts | v3.1.1 core + Angular adoption; project Node conventions; protocol and privacy boundaries | Harness checks, current review evidence, explicit upstream Node gap F-001 |
| 1 — Reliable local core | CLI, SQLite reminders, local inbox, cancellation, doctor, restart recovery | Restart and duplicate regression tests; authenticated API; F-002 tracks remaining hardening |
| 1a — Headless and bilingual workspace | Single process on 4317, dev 4318, private configuration, Italian/English UI, launchd/systemd user services | Local process/restart and configuration tests; actual OS service acceptance F-009; localization F-010 |
| 1a.1 — Isolated runtime foundation | A scheduler/SQLite child, B execution boundary, C API/static supervisor, validated local IPC | Brain CPU stall/crash does not stop reminders; A death triggers supervisor recovery; F-013 |
| 1b — Native macOS companion | SwiftUI MenuBarExtra and native bridge; no Electron; Keychain client pairing, scoped credentials, independent lifecycle, health, notifications and OS controls | Pairing replay/revocation/runtime-identity tests F-015; build/sign/package on macOS; Quit companion leaves service running; F-011 |
| 2 — Useful assistant | Claude/Ollama adapters, Telegram, editable memory, recurring schedules, briefs | Local-only never leaves machine; model outage does not stop reminders; phone delivery reconciles retries; F-003 |
| 3 — Multi-node foundation | Discovery, inspection, enrolment, SSH bootstrap, optional Tailscale adapter, outbound WebSocket/JSON-RPC workers | Mac + mini PC + Pi; identity/auth, heartbeat/wake reconciliation, version/frame/backpressure limits, leases, fencing and locks; F-005/F-014 |
| 4 — Angular PWA and GenUI | Stable Angular workspace, allowlisted Web Components with validated data, onboarding and doctor | Browser/accessibility checks, schema rejection, install/push tests on real phones; F-004 |
| 5 — Distributed agents/models | Independent role/model/node routing, explicit directional communication graph, schema-defined tools, coding workers, bounded delegation | Gemma on Mac serves mini PC worker; optional Claude route; Pi capabilities; privacy/budget/cancellation; F-006 |
| 5b — Coordinator relocation (later) | Durable replicated state, leader lease/epoch, fencing and restore | Partition/sleep tests prove no concurrent coordinators or duplicated effects; no automatic context-only takeover; F-016 |
| 6 — Voice and evaluated improvement | Push-to-talk, STT/TTS, voice client; evaluated skills and rollback | Italian/English command evaluation, no silent physical activation, rejected privilege changes; F-007 |

## Delta — 2026-11-02 (architecture discussion)

| Milestone | Additions / clarifications | Backlog |
|---|---|---|
| **2 — Useful assistant** | Risk-tiered routing (Blue fast-path; Orange/Red may invoke dynamic council). Structured memory + context compaction. MCP/tool registration. HITL timeout/escrow. No full multi-model ballot on Blue or high-Sync work. | F-003 (amended), **F-017**, **F-021**, **F-022**, **F-023** |
| **3 — Multi-node foundation** | Fixed + JIT counselors/experts live outside the voting council by default (suggest-only). Hiring driven by capability ads, cost and privacy policy. Remote experts = enrolled workers. | **F-018**, F-005, F-014 |
| **4 — Angular PWA and GenUI** | Live decision-flow observability: dashboard stages, MAGI matrix and stream bound to real job state (replace decorative animations). Optional grounded personas (Misato = primary HITL/ops voice). Monochrome / light / dark / terminal skins. | **F-019**, **F-020**, F-004 |
| **5 — Distributed agents/models** | Counselors/experts remain suggest-only unless given an explicit temporary seat. Capability-aware scheduling continues to treat role ≠ machine ≠ model. | F-006 (amended), **F-018** |
| **5b — Coordinator relocation** | Unchanged; still later. No automatic context-only takeover. | F-016 |
| **6 — Voice and evaluated improvement** | Progressive trust (shadow → bounded → fuller role) applies to counselors/experts as well as skills. Structured telemetry/tracing for decision and execution spans. | F-007, **F-024**, **F-025** |

**Explicit non-goals for early milestones**
- Full 2/3 multi-model MAGI on every non-trivial task. (to check, can be just one for small tasks)
- Firecracker / complex fencing before real heterogeneous-node need.
- Free-form persona roleplay that is not grounded in job state and policy.

FPV battery/crash integration is F-008 and can proceed after typed tool/model boundaries. WhatsApp remains an optional channel after Telegram. Dedicated always-listening hardware and replicated coordinators require separate feasibility acceptance; neither is assumed necessary for the first release.

Current implementation step: 1b native preview and F-015 pairing. Menu-bar pairing/read access, bounded inbox catch-up, opt-in notifications, guarded service controls and launch-at-login selection are implemented. Distribution signing and real Mac permission/menu/login acceptance remain open. Real model execution is still milestone 2. It does not replace model/channel milestone 2. Service render/process tests are not an actual macOS/systemd installation trial. Italian natural-language and voice acceptance remain in F-003/F-007; F-010 is interface localization only.

## Waiting and resuming external jobs (F-012)

Example: “When this web-chat or Claude Code job resets its token limit in three hours, resume it once and notify me.” Durable scheduling belongs to milestone 2; enrolled browser/editor execution to milestones 3/5. A timer alone cannot guarantee availability. Recheck the exact session/job and ready state, apply expiry and bounded retries, and reconcile uncertain effects before repeating. An asleep worker, closed tab, logged-out session or changed job produces a waiting/expired/needs-attention result. Resume permission never approves unrelated dialogs or bypasses the provider limit. Prefer a supported command/API; browser or desktop automation requires an explicit adapter and host permissions. Not available in the current release.

Architecture evaluation and adopted/deferred boundaries: [runtime decision](decisions/runtime-boundaries.md). Web Components do not authorize raw generated HTML. JSON-RPC does not replace application permissions or durable jobs. Native addons are conditional on a measured gap; Swift OS integration is the default native path.
