# Nodo backlog

Current work ledger, reviewed 1 November 2026 against main `2a8b901`. PR #1–#5 merged after green checks; target-OS and browser acceptance remain pending. [Rules](BACKLOG-RULES.md) · [Roadmap](ROADMAP.md).

## Features and improvements

### F-001

**Complete harness adoption and propose a reusable Node profile**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟢 Small | ~80% |

💻 **→ Human action required: No**<br />Validate the adopted tools, retain local Node conventions and record the missing reusable profile without modifying the upstream template in this bootstrap.

| | |
|---|---|
| **Issue** | The published template has core and Angular but no Node profile. Adoption exists; remote PR/CI evidence is not available. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | All local harness checks pass; a future upstream profile has its own owned PR and fixtures. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate the adopted tools, retain local Node conventions and record the missing reusable profile without modifying the upstream template in this bootstrap. All local harness checks pass; a future upstream profile has its own owned PR and fixtures.

**Estimates:** Small remaining effort; ~80% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-002

**Harden the reliable core**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟡 Medium | ~70% |

💻 **→ Human action required: No**<br />Complete browser acceptance for the core UI; calendar validation, bounded requests and process lifecycle are covered by regression tests.

| | |
|---|---|
| **Issue** | Local core exists; phone delivery and recurrence belong to F-003. Production deployment is not provisioned. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Restart recovery, no duplicate local inbox delivery, cancellation, auth, invalid input and clean shutdown; production operations separately documented. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Complete browser acceptance for the core UI; calendar validation, bounded requests and process lifecycle are covered by regression tests. Restart recovery, no duplicate local inbox delivery, cancellation, auth, invalid input and clean shutdown; production operations separately documented.

**Estimates:** Medium remaining effort; ~70% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-003

**Models, Telegram, memory and proactive briefs**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Implement provider adapters and a delivery outbox with recurring timezone-aware schedules and user-editable facts.

| | |
|---|---|
| **Issue** | No provider or messaging runtime exists yet. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Italian/English commands, local-only privacy, no cloud fallback without permission, restart/retry/channel failure tests and live phone delivery. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implement provider adapters and a delivery outbox with recurring timezone-aware schedules and user-editable facts. Italian/English commands, local-only privacy, no cloud fallback without permission, restart/retry/channel failure tests and live phone delivery.

**Estimates:** Large remaining effort; ~0% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-004

**Angular PWA and validated GenUI**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~20% |

💻 **→ Human action required: No**<br />Finish browser acceptance, PWA lifecycle and a schema-validated registered component renderer.

| | |
|---|---|
| **Issue** | Angular source exists; no generated UI, service worker or push configuration yet. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Real reminder CRUD and doctor UI; reject arbitrary component/code/action payloads; accessibility and phone install/push acceptance. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Finish browser acceptance, PWA lifecycle and a schema-validated registered component renderer. Real reminder CRUD and doctor UI; reject arbitrary component/code/action payloads; accessibility and phone install/push acceptance.

**Estimates:** Large remaining effort; ~20% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-005

**Discover, install and operate enrolled remote workers**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Implement discovery and inspection, reviewed bootstrap plans, pairing and outbound authenticated worker transport.

| | |
|---|---|
| **Issue** | Versioned TypeScript intentions exist; no worker transport or bootstrap exists. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Mac/mini PC/Pi tests for enrolment, revocation, leases, fencing, cancellation, locks, reconnect and uncertain physical results. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implement discovery and inspection, reviewed bootstrap plans, pairing and outbound authenticated worker transport. Mac/mini PC/Pi tests for enrolment, revocation, leases, fencing, cancellation, locks, reconnect and uncertain physical results.

**Estimates:** Large remaining effort; ~0% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-006

**Orchestrate agents and models across nodes**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Implement capability-aware scheduling with independent model endpoint and execution node selection.

| | |
|---|---|
| **Issue** | Contract only; no agent loop or model server integration. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Mini PC coder uses Mac inference; policy-approved Claude path; Pi capability route; unavailable Mac waits or expires; bounded budgets and delegation. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implement capability-aware scheduling with independent model endpoint and execution node selection. Mini PC coder uses Mac inference; policy-approved Claude path; Pi capability route; unavailable Mac waits or expires; bounded budgets and delegation.

**Estimates:** Large remaining effort; ~0% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-007

**Voice and evaluated skill improvement**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Add push-to-talk STT/TTS and isolated skill proposals with evaluation and rollback.

| | |
|---|---|
| **Issue** | Not implemented; dedicated voice hardware follows measured feasibility. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Italian/English voice corpus; corrected memory; rejected permission escalation; promoted and rolled-back skill versions. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Add push-to-talk STT/TTS and isolated skill proposals with evaluation and rollback. Italian/English voice corpus; corrected memory; rejected permission escalation; promoted and rolled-back skill versions.

**Estimates:** Large remaining effort; ~0% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-008

**Integrate the FPV app**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟡 Medium | ~0% |

💻 **→ Human action required: No**<br />Define an adapter for authoritative battery, crash and maintenance operations owned by the FPV app.

| | |
|---|---|
| **Issue** | No FPV application or device connection is provisioned here. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Record battery 2 charge once; record aircraft-specific motor damage and inspection; distinguish record from charger actuation. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Define an adapter for authoritative battery, crash and maintenance operations owned by the FPV app. Record battery 2 charge once; record aircraft-specific motor damage and inspection; distinguish record from charger actuation.

**Estimates:** Medium remaining effort; ~0% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---


### F-009

**Run Nodo headless as one local user service**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟡 Medium | ~80% |

💻 **→ Human action required: No**<br />Validate launchd/systemd installation and login/logout on target hosts; PR #1 CI is green.

| | |
|---|---|
| **Issue** | Service commands and definitions implemented. Linux tests validate rendering and process lifecycle; no service is installed on this execution host. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | Single process serves production UI/API on 4317; config survives init; clean SIGTERM and restart catch-up; private credentials; install/status/start/stop/uninstall on real target OS. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate launchd/systemd installation and login/logout on target hosts; PR #1 CI is green. Single process serves production UI/API on 4317; config survives init; clean SIGTERM and restart catch-up; private credentials; install/status/start/stop/uninstall on real target OS.

**Estimates:** Medium remaining effort; ~80% complete. Estimate dated 2026-11-01, not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #1](https://github.com/voidbrain/nodo/pull/1); 10 regression tests and headless process test pass; CI run 41254646946 green |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-010

**Italian-default interface and dedicated development port**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟢 Small | ~80% |

💻 **→ Human action required: No**<br />Complete browser acceptance for Italian/English, dates and responsive layout; PR #1 CI is green.

| | |
|---|---|
| **Issue** | Translation and configuration implemented; natural-language interpretation remains F-003. Browser visual/accessibility checks remain unverified. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | Italian default, matching translation keys, selectable English, unchanged reminder content, labelled browser-local dates, development port 4318. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Complete browser acceptance for Italian/English, dates and responsive layout; PR #1 CI is green. Italian default, matching translation keys, selectable English, unchanged reminder content, labelled browser-local dates, development port 4318.

**Estimates:** Small remaining effort; ~80% complete. Estimate dated 2026-11-01, not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #1](https://github.com/voidbrain/nodo/pull/1); 10 regression tests and headless process test pass; CI run 41254646946 green |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-011

**Native macOS menu-bar companion without Electron**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🔴 Large | ~80% |

💻 **→ Human action required: No**<br />Validate native notification permissions/banners, guarded service start/stop and login/logout on a target Mac; finish distribution signing/notarization.

| | |
|---|---|
| **Issue** | SwiftUI pairing, private notification checkpoints, bounded catch-up, opt-in OS notifications, guarded local service controls and login selection now exist. Real permission/menu/login acceptance and distribution signing remain incomplete. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | Build and package on macOS; health/reminders, workspace launch, doctor, notifications, launch-at-login; Quit companion leaves service running; Stop Nodo is separate. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate native notification permissions/banners, guarded service start/stop and login/logout on a target Mac; finish distribution signing/notarization. Build and package on macOS; health/reminders, workspace launch, doctor, notifications, launch-at-login; Quit companion leaves service running; Stop Nodo is separate.

**Estimates:** Large remaining effort; ~80% complete. Estimate dated 2026-11-01, not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #5](https://github.com/voidbrain/nodo/pull/5); Linux checks pass; macOS CI pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-012

**Resume a specific paused job after its provider limit resets**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Define durable waiting jobs and implement an authorized browser/editor adapter that rechecks the exact job before resuming once.

| | |
|---|---|
| **Issue** | User wants Nodo to resume a web-chat job or Claude Code job in VS Code after a three-hour token-limit pause. This capability is not implemented. |
| **Reproduce** | Ask to resume an identified job after its reported reset time; keep its worker awake and session available. |
| **Check** | Persist target, permission, reset time, expiry and attempts; verify readiness and unchanged job identity; resume once; notify outcome; survive restart; handle longer limits, logout, closed tabs, sleeping workers, changed tasks and already-resumed jobs without duplicate actions. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Prefer supported application commands/APIs. Use a browser worker or narrowly scoped desktop automation only when required. Adapter capability and host permission must be observed, not inferred. At the deadline inspect actual availability: three hours passing is not proof of a reset. Persist a bounded retry/expiry policy, cancellation, execution lease and result reconciliation. Recheck account/session/window/job identity after sleep or restart; do not replay stale clicks. Permission covers resuming the named job only, not accepting unrelated tool/security prompts or bypassing provider limits. Never place a model-originated resume instruction above user policy. The coordinator can schedule on an always-on host, but execution waits for the target worker and authenticated session. CLI/headless coding adapters should expose resumable job IDs where available; VS Code integration is not assumed to provide such an API. Required evaluations include changed button/DOM, an expired session, revised target content, already-running state and an uncertain click acknowledgement. Depends on F-003 durable scheduling and F-005/F-006 execution capabilities.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-01; adapter feasibility and real host acceptance remain unverified.

| Field | Value |
|---|---|
| PR / evidence | [PR #2](https://github.com/voidbrain/nodo/pull/2); plan only, no runtime implementation |
| Opened | 2026-11-01 |
| Verification | Pending adapter feasibility, regression and live host tests |
| Reviewed | 2026-11-01 |

</details>

---

### F-013

**Isolate the scheduler and execution runtime**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟡 Medium | ~70% |

💻 **→ Human action required: No**<br />Validate process failure/backpressure regressions and finish bounded history/pagination and latency measurements before claiming load resilience.

| | |
|---|---|
| **Issue** | A/B/C process split, validated IPC and fail-closed lifecycle exist. Native inbox and pending-reminder reads are now bounded; background status now pings the scheduler rather than running SQLite quick_check every 15 seconds; full-history web pagination/load limits remain open. Brain is a health boundary only, not an agent/model loop or sandbox. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Blocked/killed Brain leaves due delivery working; Nervous failure shuts supervisor down; no orphaned children; bounded queues/frames; large histories and concurrent CLI writes have measured limits. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate process failure/backpressure regressions and finish bounded history/pagination and latency measurements before claiming load resilience. Blocked/killed Brain leaves due delivery working; Nervous failure shuts supervisor down; no orphaned children; bounded queues/frames; large histories and concurrent CLI writes have measured limits.

**Estimates:** Medium remaining effort; ~70% complete. Estimated 2026-11-01; not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #3](https://github.com/voidbrain/nodo/pull/3); local checks and scoped audit pass; CI pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-014

**Version and secure WebSocket JSON-RPC communication**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🔴 Large | ~30% |

💻 **→ Human action required: No**<br />Extend the local read-only endpoint into an enrolled outbound worker protocol with heartbeat, reconnect cursor, durable idempotency, fencing and resource locks.

| | |
|---|---|
| **Issue** | Authenticated loopback read-only RPC and directed method graph exist; remote transport, mutation RPC, pairing, durable delivery and stream sequencing remain unimplemented. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Reject unauthenticated/Origin/browser/query-token access; validate schemas/graph; bound payloads/concurrency; reconnect and asleep-worker tests before remote execution. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Extend the local read-only endpoint into an enrolled outbound worker protocol with heartbeat, reconnect cursor, durable idempotency, fencing and resource locks. Reject unauthenticated/Origin/browser/query-token access; validate schemas/graph; bound payloads/concurrency; reconnect and asleep-worker tests before remote execution.

**Estimates:** Large remaining effort; ~30% complete. Estimated 2026-11-01; not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #3](https://github.com/voidbrain/nodo/pull/3); local checks and scoped audit pass; CI pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-015

**Pair native clients without sharing the root credential**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🔴 Large | ~70% |

💻 **→ Human action required: No**<br />Validate pinned TLS/Keychain pairing on macOS and complete renewal/rotation recovery before closing native credential acceptance.

| | |
|---|---|
| **Issue** | Backend single-use invitations, pinned TLS transport, separate hashed verifier storage and read-only revocable credentials are implemented; Swift Keychain/pinning source exists with macOS CI checks. Renewal/rotation and live native acceptance remain open. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Expired/replayed tickets fail; credentials are bound to runtime identity; no tokens in URLs/argv/logs or Brain; revocation/rotation tested; native permissions remain explicit. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate pinned TLS/Keychain pairing on macOS and complete renewal/rotation recovery before closing native credential acceptance. Expired/replayed tickets fail; credentials are bound to runtime identity; no tokens in URLs/argv/logs or Brain; revocation/rotation tested; native permissions remain explicit.

**Estimates:** Large remaining effort; ~70% complete. Estimated 2026-11-01; not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #4](https://github.com/voidbrain/nodo/pull/4); backend checks pass; macOS CI pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-016

**Relocate the logical coordinator without split brain**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Keep the coordinator on an always-on host initially; design later replicated state, leader epochs/leases, fencing and restore.

| | |
|---|---|
| **Issue** | Deferred milestone 5b. No distributed election, replication or automatic failover is implemented. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Network partitions, asleep old leaders and reconnect cannot create simultaneous authorities or duplicate physical effects. Context copying alone never grants leadership. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Keep the coordinator on an always-on host initially; design later replicated state, leader epochs/leases, fencing and restore. Network partitions, asleep old leaders and reconnect cannot create simultaneous authorities or duplicate physical effects. Context copying alone never grants leadership.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-01; not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #3](https://github.com/voidbrain/nodo/pull/3); local checks and scoped audit pass; CI pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---
