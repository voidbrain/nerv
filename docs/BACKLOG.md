# Nodo backlog

Current work ledger, reviewed 4 November 2026 against main `6d8c330`. PR #1–#6 merged after green checks; target-OS and browser acceptance remain pending. Owner commits `1787a30`–`6d8c330` (NERV evaluation, backlog/roadmap update, dashboard prototypes) have no PR; their CI failed on `check:backlog` (P2 icon), fixed in [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan). Governance and naming follow the [NERV architecture](NERV/NERV-ARCHITECTURE.md). [Rules](BACKLOG-RULES.md) · [Roadmap](ROADMAP.md).

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
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~20% |

💻 **→ Human action required: No**<br />Model routes done; next the Misato agent loop on them through the MAGI gate, then the Aoba (Telegram) channel.

| | |
|---|---|
| **Issue** | Model routes exist (S² local, Umbilical cloud); no agent loop or messaging runtime yet. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Italian/English commands, local-only privacy, no cloud fallback without permission, restart/retry/channel failure tests and live phone delivery. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Model routes implemented in [PR #11](https://github.com/voidbrain/nodo/pull/11) (model routes): S² local OpenAI-compatible loopback endpoint and Umbilical Claude route (`claude-opus-5-5`, server-side refusal fallback, off by default, key in a private `anthropic-key` file); explicit privacy per ask, no route fallback, bounded replies; brain-process `model.complete`, admin `POST /api/ask`, CLI `ask [--cloud]`, doctor shows routes. Next: Misato loop calling `Ledger.propose`/`authorize` per tool call, then Telegram. Live acceptance needs the owner: a running local model, an API key if the cloud route is wanted, and a Telegram bot token plus phone for delivery. M2a umbrella, re-scoped 2026-11-04: Telegram adapter (Aoba) with delivery outbox and retry reconciliation; Misato agent loop calling one model route (Umbilical cloud or S² local) through the per-action MAGI gate (F-017); recurring timezone-aware schedules. Memory is F-022, approvals F-023, ledger/trace F-024, triggers F-026, provenance F-027, digest F-028, evals F-029, degraded mode F-030. Closure still needs: Italian/English commands, local-only privacy, no cloud fallback without permission, restart/retry/channel failure tests and live phone delivery.

**Estimates:** Large remaining effort; ~20% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01; reassessed 2026-11-04: scope narrowed to channel + agent loop; model routes done, agent loop and Telegram remain.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks; [PR #11](https://github.com/voidbrain/nodo/pull/11) (model routes) |
| Opened | 2026-11-01 |
| Verification | Unit/integration 2026-11-04: test/model.test.ts covers loopback-only S², cloud off by default, no route fallback (fake cloud receives zero requests), local-only refusal, bounded replies, timeouts, refusal/auth mapping without leaking the key, coordinator → brain → S² join, socket denial, private key file (local run; CI pending). Live model, phone and Italian/English acceptance: pending |
| Reviewed | 2026-11-04 |

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

💻 **→ Human action required: No**<br />Implement capability-aware scheduling with independent model endpoint and execution node selection. Add: counselors/experts are hired (fixed or JIT) and default to suggest-only; only a small core council holds vote authority; capability ads + cost/privacy policy drive hiring; progressive trust can later promote a reliable expert into a stronger role.

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
| PR / evidence | [PR #5](https://github.com/voidbrain/nodo/pull/5) merged; Linux and macOS checks green; real OS acceptance remains pending |
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

**Estimates:** Medium remaining effort; ~70% complete. Estimated 2026-11-01; reassessed 2026-11-04 after PR #6 CI: unchanged, history pagination and load measurements remain.

| Field | Value |
|---|---|
| PR / evidence | [PR #3](https://github.com/voidbrain/nodo/pull/3) runtime; [PR #5](https://github.com/voidbrain/nodo/pull/5) bounded native feeds; [PR #6](https://github.com/voidbrain/nodo/pull/6) lightweight status, CI green at merge `df0a52f` |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-04 |

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
| PR / evidence | [PR #4](https://github.com/voidbrain/nodo/pull/4) merged; Linux and macOS checks green; live Keychain/rotation acceptance remains pending |
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

### F-017

**Per-action MAGI ballot from tool effect classes (Pattern Green / Orange / Blue)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟡 Medium | ~50% |

💻 **→ Human action required: No**<br />Connect Casper to the F-003 model route, load the Scrolls from NODO_HOME and route the first real tool executor through the gate.

| | |
|---|---|
| **Issue** | Risk was classified once per request (Gendo) before any action existed, and a 3-model vote ran on non-trivial work. Risk belongs to each action; policy and reversibility checks are deterministic. |
| **Reproduce** | Run actions of each effect class (read, local reversible write, external write, irreversible, physical) with trusted and Ireul-tainted context; inspect Pattern, seat verdicts, Sync Ratio and whether the A.T. Field was issued. |
| **Check** | Every tool declares an effect class; Melchior (rules) and Balthasar (reversibility, budget, taint) are deterministic; Casper (intent) is a reasoning-blind model seat only for Orange/Blue; Green read/local work never calls a model reviewer; Blue always reaches Misato's apartment; any reject returns to the planner at most 3 times; the grant is checked on every executor call; ballots are recorded in Central Dogma. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #8](https://github.com/voidbrain/nodo/pull/8) (gate, ledger, approvals): `src/policy.ts` (effect classes, Pattern, EVA class, Melchior/Balthasar, veto-only extra seats, Sync Ratio with inputs) and `Ledger.propose`/`authorize` (single-use grants bound to the argument hash, reject limit escalation). Remaining: Casper from the model route, a Scrolls file in NODO_HOME validated by `validatePolicy`, and the first executor calling `authorize`. Original plan: effect classes, Scrolls policy pack, Pattern derivation, deterministic seats, Sync Ratio (0–100 % with its inputs), grant issuance with TTL and the executor check. Casper uses the F-003 model route once it exists; until then a Casper verdict is required input and the gate fails closed. Extra veto-only seats and consultants are F-025. Supersedes the request-level Gendo classification of 2026-11-02 ([NERV architecture](NERV/NERV-ARCHITECTURE.md)).

**Estimates:** Medium remaining effort; ~50% complete. Re-scoped 2026-11-04 from request-level routing to per-action gating; reassessed 2026-11-04 after the deterministic gate landed: Casper wiring, policy file and executor integration remain.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan); [PR #8](https://github.com/voidbrain/nodo/pull/8) (gate, ledger, approvals) |
| Opened | 2026-11-02 |
| Verification | Unit/integration 2026-11-04: test/ledger.test.ts covers every Pattern path, veto-only seats, reject escalation, budget, EVA-00 shadow rule and grant binding (local run; CI pending). Human: pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-019

**Live decision-flow observability (dashboard bound to real stages)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟡 Medium | ~10% |

💻 **→ Human action required: No**<br />Replace decorative dashboard animations with a stage-aware trace of Ingress → risk classification → optional council → token/HITL → execution → ledger.

| | |
|---|---|
| **Issue** | dashboard1.html shows MAGI, Sephiroth tree and streams as test animations. Operators need a real view of where a job is and why a decision was taken. |
| **Reproduce** | Run Blue/Orange/Red jobs; open dashboard; confirm active stage, classification reason, council participation and final outcome match backend state. |
| **Check** | Pipeline tree and MAGI matrix driven by job state; Live Reasoning Stream is structured and filterable; Pattern and Sync Ratio are real; decorative-only paths removed or clearly marked demo; monochrome / light / dark / terminal skins planned. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Define a versioned job-stage and decision-event schema emitted by the coordinator. Bind dashboard panels (and any NERV skin) to that stream. Keep Eva framing as optional skin; functional observability must work without it. Depends on the F-024 event schema (one schema for ledger, traces and the dashboard) and F-017 ballots. Redesign 2026-11-04 around outcomes: needs you (approval cards), activity and traces, upcoming, memory, nodes and channels; MAGI detail becomes a secondary view. Remove decorative-only data (per-seat GPU/CPU, globe, per-EVA sync, random jitter).

**Estimates:** Medium remaining effort; ~10% complete (static UI exists). Estimated 2026-11-02; reassessed 2026-11-04: unchanged, the redesign replaces rather than adds work.

| Field | Value |
|---|---|
| PR / evidence | docs/NERV/dashboard-agnostic-2.html (prototype only); review docs/NERV/review-2026-11-04.md §6 |
| Opened | 2026-11-02 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-020

**Grounded personas for HITL and explanation (Misato primary)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔹 P3 | Open | 🟡 Medium | ~10% |

💻 **→ Human action required: No**<br />Optional conversational faces grounded in real job state: Misato as primary HITL/ops voice; Gendo optional for risk/policy explanation; pilots optional as worker identity only.

| | |
|---|---|
| **Issue** | Personas Codec Chat exists as UI prototype. Free-form roleplay without grounding is a distraction and safety risk. |
| **Reproduce** | Request approval, status brief, or “why was this Red?”; confirm answers cite real job/decision data and cannot bypass policy. |
| **Check** | Misato can surface pending HITL and accept/reject with audit; Gendo (or Command) can explain classification; no persona can grant capabilities the backend policy denies; persona layer can be disabled; responses remain useful in non-Eva skins. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implement thin, state-grounded persona adapters after F-003 messaging and F-017 decisions exist. Prefer Misato for push/HITL. Keep Shinji/pilots as optional labels for workers, not primary chat partners. Safety: persona output never overrides capability tokens or Pattern Red rules.

**Estimates:** Medium remaining effort; ~10% complete (prototype UI; corrected from ~5% to a valid step). Estimated 2026-11-02; priority lowered to P3 on 2026-11-04 (skin, not behaviour); estimate unchanged.

| Field | Value |
|---|---|
| PR / evidence | docs/NERV/dashboard1.html personas tab (prototype) |
| Opened | 2026-11-02 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-021

**MCP and standardized tool/expert protocol**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Adopt MCP and/or OpenAPI-style tool specs so fixed specialists, JIT experts and external tools register without bespoke wrappers.

| | |
|---|---|
| **Issue** | Tool and expert integration is currently undefined; custom wrappers will not scale. |
| **Reproduce** | Register a tool/expert via MCP or OpenAPI descriptor; invoke from a task; confirm schema validation, capability scope and audit. |
| **Check** | Versioned tool/expert descriptors; deny-by-default capability binding; works for local and remote (other-machine) endpoints; appears in expert roster (F-018); no silent privilege escalation. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Choose MCP and/or OpenAPI as the registration path for Lilith/tools and counselors. Milestone M2b. Registered tools must declare an F-017 effect class; MCP tools without one are treated as irreversible (Pattern Blue). Align with F-005/F-006 worker enrolment for remote tools.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-02; reassessed 2026-11-04: unchanged, moved to M2b.

| Field | Value |
|---|---|
| PR / evidence | — |
| Opened | 2026-11-02 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-022

**Lilith memory: facts and pilots in Terminal Dogma, LCL assembly and Instrumentality consolidation**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Add the facts store with provenance, SQLite FTS5 recall, budgeted LCL assembly and held memory writes.

| | |
|---|---|
| **Issue** | Durable SQLite state exists; there is no memory of facts about the owner, no recall and no context budget for model calls. |
| **Reproduce** | Accumulate multi-day history; ask something that needs an earlier fact; propose a new fact from a conversation; edit and forget a fact. |
| **Check** | Facts carry provenance and taint marks; recall uses FTS5 over facts and recent Central Dogma episodes; the LCL is trimmed to the battery budget; agent-proposed facts are held until the owner confirms (or a Production pilot writes them); edit/forget keeps a provenance trail; local-only facts never reach the Umbilical route; nightly Instrumentality consolidation writes summaries without deleting the ledger. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Schema and FTS5 recall in `src/`, then LCL assembly used by the F-003 agent loop. Vector search only if FTS5 recall proves weak on the F-029 eval set.

**Estimates:** Large remaining effort; ~0% complete. Re-scoped 2026-11-04 (was "structured memory and context compaction").

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan) |
| Opened | 2026-11-02 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-023

**Misato's apartment: approval cards with TTL, delivered by Pen Pen**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟡 Medium | ~50% |

💻 **→ Human action required: No**<br />Deliver cards through Pen Pen: menu-bar notification from `/api/approvals`, then Telegram buttons (F-003).

| | |
|---|---|
| **Issue** | Blue actions and low Sync Ratio need the owner. Without full content an approval is a rubber stamp; without a TTL a sleeping owner stalls the sortie. |
| **Reproduce** | Create a Blue approval; approve, reject, edit, or leave it to expire; repeat the decision; restart Nodo while it is pending. |
| **Check** | Card shows action, arguments/diff/recipients, Pattern, Sync Ratio and inputs, reason and remaining TTL; expiry stands down (never approves); a decision is applied once and is idempotent on repeat; pending cards survive restart; the decision and its source are written to Central Dogma; Pen Pen delivery reuses the inbox and later Telegram/native notifications. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #8](https://github.com/voidbrain/nodo/pull/8) (gate, ledger, approvals): approval cards (action, args, effect, Pattern, Sync Ratio and inputs, verdicts, reason, TTL), once-only decisions, TTL expiry on scheduler ticks, survival across restart, CLI `approvals`/`approve`/`reject`. API added in [PR #9](https://github.com/voidbrain/nodo/pull/9) (approvals API): `GET /api/approvals` (read-only clients and socket), `POST /api/approvals/ID` (admin, REST only; grant ID never returned). Remaining: Pen Pen delivery, edit handed back to the agent loop (F-003). Original plan: Approval table and decision transitions in `src/store.ts`, API/CLI to list and decide, then Telegram buttons via F-003. Edit returns the action to the planner rather than changing it in place.

**Estimates:** Medium remaining effort; ~40% complete. Re-scoped 2026-11-04 to include the card content specification; reassessed 2026-11-04 after storage, decisions and expiry landed, and again after the API landed.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan); [PR #8](https://github.com/voidbrain/nodo/pull/8) (gate, ledger, approvals); [PR #9](https://github.com/voidbrain/nodo/pull/9) (approvals API) |
| Opened | 2026-11-02 |
| Verification | Unit/integration 2026-11-04: once-only decisions, expiry never approves, restart, scheduler-process expiry (local run; CI pending); REST once-only decision and socket decision denial across the scheduler process (local run; CI pending). Real-device: pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-024

**Central Dogma sortie ledger and Maya trace events**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟢 Small | ~70% |

💻 **→ Human action required: No**<br />Add a schema version to event payloads and bind the dashboard (F-019) to the event API.

| | |
|---|---|
| **Issue** | Ballots, approvals and agent steps need an append-only record to debug, audit and display; a separate telemetry schema would drift from the dashboard. |
| **Reproduce** | Run a sortie with several actions including a reject and an approval; read its events back in order; locate the failing step from events alone. |
| **Check** | Sortie and action records with append-only events; every event carries sortie id, step, time and a bounded payload without secrets; read API pages events; the same schema feeds F-019 and later OpenTelemetry export. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #8](https://github.com/voidbrain/nodo/pull/8) (gate, ledger, approvals): schema 2 tables (sorties, actions, grants, approvals, events), append-only events enforced by SQLite triggers, paged `Ledger.events`, CLI `events`, one-way migration noted in INSTALL. Paged reads added in [PR #9](https://github.com/voidbrain/nodo/pull/9) (approvals API): `events.page` RPC and `GET /api/sorties/ID/events` (max 50 per page). Remaining: payload versioning and the F-019 binding. Original plan: implement with F-017 in `src/`; OpenTelemetry export later and never blocking M2a. Merged scope with the F-019 decision-event schema on 2026-11-04.

**Estimates:** Small remaining effort; ~60% complete. Moved from M6 to M2a and raised to P1 on 2026-11-04; reassessed 2026-11-04 after the ledger and its read API landed.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan); [PR #8](https://github.com/voidbrain/nodo/pull/8) (gate, ledger, approvals); [PR #9](https://github.com/voidbrain/nodo/pull/9) (approvals API) |
| Opened | 2026-11-02 |
| Verification | Unit/integration 2026-11-04: append-only triggers, ordered events per sortie, version-1 migration keeps reminders (local run; CI pending) |
| Reviewed | 2026-11-04 |

</details>

---
### F-025

**Extra MAGI seats (veto-only), consultants and watermelon trust for pilots**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟡 Medium | ~0% |

💻 **→ Human action required: No**<br />Attach extra seats by action class as veto-only, start new seats in shadow, and promote pilots through Prototype → Test → Production.

| | |
|---|---|
| **Issue** | Specialists help, but a new or remote seat must never approve what the core three would refuse, and skills need earned trust. |
| **Reproduce** | Attach a deterministic test seat and a model expert seat to code-write actions; run them in shadow; promote one; force a failure and a Spear revocation. |
| **Check** | Extra seats can only reject; shadow seats are logged, not counted; a timed-out seat abstains; consultants advise the planner without a vote and receive only Scrolls-allowed data; pilots run only in the EVA class of their stage; promotion to Production needs the owner's confirmation; failure, override spikes or Spear demote automatically. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Seat registry via Marduk and stage tracking on top of F-017/F-024; evaluation evidence from F-029. Absorbs F-018 (closed 2026-11-04).

**Estimates:** Medium remaining effort; ~0% complete. Re-scoped 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan) |
| Opened | 2026-11-02 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-026

**Hyuga watch: proactive triggers (heartbeat, schedules, events)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Turn heartbeat ticks, schedules and events into sorties with budgets and quiet hours; proactive work is read-only unless the pilot is Production.

| | |
|---|---|
| **Issue** | Nodo is meant to act first, but only reminders fire today; there is no loop that wakes the agent to check something. |
| **Reproduce** | Configure a heartbeat check and an event trigger; let both fire inside and outside quiet hours; let the model route be down. |
| **Check** | Triggers create sorties with their source recorded; proactive sorties run in EVA-00 (no external effects) unless the pilot is Production; quiet hours defer notifications, not deliveries already due; per-trigger budget; duplicate ticks after restart do not duplicate sorties. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Trigger table in A (scheduler) reusing tick idempotency; the agent loop from F-003 consumes the sorties.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-027

**Naoko desk provenance and Ireul taint with an egress allowlist**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟡 Medium | ~0% |

💻 **→ Human action required: No**<br />Mark every input with its source, carry the Ireul taint through context and make tainted context escalate external effects.

| | |
|---|---|
| **Issue** | Email, web and third-party content can carry injected instructions; nothing records where context came from. |
| **Reproduce** | Feed a sortie an email body that asks to send data elsewhere; run the same request from the owner directly. |
| **Check** | Every intake item records source and trust; taint propagates into the LCL and memory; a tainted context asking for an external effect is Pattern Blue; network egress only to Scrolls-allowed destinations; untrusted code runs in the EVA-03 quarantine class. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Provenance fields on intake and sortie records, consumed by the F-017 Balthasar seat. Must land before any email or web integration.

**Estimates:** Medium remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-028

**Debrief digest: what happened while you were away**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟢 Small | ~0% |

💻 **→ Human action required: No**<br />Summarise closed sorties, pending approvals and failures since the last digest, from Central Dogma only.

| | |
|---|---|
| **Issue** | Autonomy is only trustable if the owner can see what was done; a raw event log is not a summary. |
| **Reproduce** | Run several sorties, approvals and a failure; request the digest; request it again. |
| **Check** | Digest lists completed, failed, waiting and expired items with links to their traces; built from ledger data, not model memory; a repeat request shows only new items; delivered through the inbox. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Ledger query plus a deterministic template after F-024; an optional model summary later must cite ledger entries.

**Estimates:** Small remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-029

**Golden sortie eval suite for Casper and pilot promotion**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟡 Medium | ~0% |

💻 **→ Human action required: No**<br />Keep a versioned set of scripted sorties with expected Pattern, verdicts and outcomes, runnable without live providers.

| | |
|---|---|
| **Issue** | Watermelon promotion and the Casper seat need regression evidence; a score without a fixed test set means nothing. |
| **Reproduce** | Run the suite against the deterministic seats and against a recorded model seat; change a policy rule and rerun. |
| **Check** | Suite covers each effect class, taint, rejects and expiry; deterministic part runs in CI; model-seat runs are recorded with model id and date; results feed F-025 stage evidence. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Start with deterministic cases alongside F-017 tests; add recorded model cases with F-003.

**Estimates:** Medium remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-030

**Dummy Plug degraded mode**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟢 Small | ~0% |

💻 **→ Human action required: No**<br />Detect that no model route is reachable, show it, and keep deterministic pilots and reminders running.

| | |
|---|---|
| **Issue** | A model outage must not stop reminders or deterministic work, and the owner must see that the agent is degraded. |
| **Reproduce** | Make every model route unreachable; submit a reminder, a deterministic action and a model-needing request; restore the route. |
| **Check** | Status reports degraded with reason; reminders and deterministic pilots continue; model-needing sorties wait or expire with a visible reason; no local-only request is moved to the cloud; recovery is automatic and recorded. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Route health in the F-003 model adapter plus a status field; the A/B/C split already keeps reminders alive.

**Estimates:** Small remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-031

**Dev-server advisories in the Angular build chain**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟢 Small | ~0% |

💻 **→ Human action required: No**<br />Upgrade `@angular/build` (and its pinned Angular peers) to the patch release that pulls a fixed vite.

| | |
|---|---|
| **Issue** | `npm audit` reports a high advisory in vite 8.3.0–8.3.2 (dev server: cross-origin script execution, files outside `server.fs.allow`) and a low one in launch-editor, both through `@angular/build` 22.2.4. Dev-only: `serve` ships the built files, not the dev server. |
| **Reproduce** | `npm audit` on main `0ffdfc6`. |
| **Check** | `npm audit` reports no high advisory; typecheck, tests, build and `npm run dev` still work. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Found 2026-11-04 while adding the model-route dependency ([PR #11](https://github.com/voidbrain/nodo/pull/11), model routes); kept out of that PR. `npm audit fix --force` proposes `@angular/build` 22.2.5, outside the pinned set: upgrade the Angular packages together in their own PR.

**Estimates:** Small remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | `npm audit` 2026-11-04 |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
