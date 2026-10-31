# Nodo backlog

Reviewed 1 November 2026 against main `f25fae5`. Foundation CI run #1 passed; current branch acceptance is recorded below. [Rules](BACKLOG-RULES.md) · [Roadmap](ROADMAP.md).

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
| PR / evidence | Foundation CI #1 green; current PR pending; scoped audit and local checks |
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

💻 **→ Human action required: No**<br />Validate CLI/API/frontend joins; add strict calendar-date validation, bounded requests and lifecycle checks where findings require them.

| | |
|---|---|
| **Issue** | Local core exists; phone delivery and recurrence belong to F-003. Production deployment is not provisioned. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Restart recovery, no duplicate local inbox delivery, cancellation, auth, invalid input and clean shutdown; production operations separately documented. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate CLI/API/frontend joins; add strict calendar-date validation, bounded requests and lifecycle checks where findings require them. Restart recovery, no duplicate local inbox delivery, cancellation, auth, invalid input and clean shutdown; production operations separately documented.

**Estimates:** Medium remaining effort; ~70% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; current PR pending; scoped audit and local checks |
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
| PR / evidence | Foundation CI #1 green; current PR pending; scoped audit and local checks |
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
| PR / evidence | Foundation CI #1 green; current PR pending; scoped audit and local checks |
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
| PR / evidence | Foundation CI #1 green; current PR pending; scoped audit and local checks |
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
| PR / evidence | Foundation CI #1 green; current PR pending; scoped audit and local checks |
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
| PR / evidence | Foundation CI #1 green; current PR pending; scoped audit and local checks |
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
| PR / evidence | Foundation CI #1 green; current PR pending; scoped audit and local checks |
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

💻 **→ Human action required: No**<br />Validate the current PR in CI; retain actual launchd/systemd user-session installation and logout tests as unperformed host acceptance.

| | |
|---|---|
| **Issue** | Service commands and definitions implemented. Linux tests validate rendering and process lifecycle; no service is installed on this execution host. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | Single process serves production UI/API on 4317; config survives init; clean SIGTERM and restart catch-up; private credentials; install/status/start/stop/uninstall on real target OS. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate the current PR in CI; retain actual launchd/systemd user-session installation and logout tests as unperformed host acceptance. Single process serves production UI/API on 4317; config survives init; clean SIGTERM and restart catch-up; private credentials; install/status/start/stop/uninstall on real target OS.

**Estimates:** Medium remaining effort; ~80% complete. Estimate dated 2026-11-01, not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | Current branch, local regression and process checks; CI pending |
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

💻 **→ Human action required: No**<br />Run the current PR checks and browser acceptance for Italian/English, dates and responsive layout.

| | |
|---|---|
| **Issue** | Translation and configuration implemented; natural-language interpretation remains F-003. Browser visual/accessibility checks remain unverified. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | Italian default, matching translation keys, selectable English, unchanged reminder content, labelled browser-local dates, development port 4318. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Run the current PR checks and browser acceptance for Italian/English, dates and responsive layout. Italian default, matching translation keys, selectable English, unchanged reminder content, labelled browser-local dates, development port 4318.

**Estimates:** Small remaining effort; ~80% complete. Estimate dated 2026-11-01, not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | Current branch, local regression and process checks; CI pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-011

**Native macOS menu-bar companion without Electron**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Create a SwiftUI MenuBarExtra companion with authenticated local API pairing and independent service controls.

| | |
|---|---|
| **Issue** | Approved native companion is planned. No Swift application ships in this step. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | Build and package on macOS; health/reminders, workspace launch, doctor, notifications, launch-at-login; Quit companion leaves service running; Stop Nodo is separate. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Create a SwiftUI MenuBarExtra companion with authenticated local API pairing and independent service controls. Build and package on macOS; health/reminders, workspace launch, doctor, notifications, launch-at-login; Quit companion leaves service running; Stop Nodo is separate.

**Estimates:** Large remaining effort; ~0% complete. Estimate dated 2026-11-01, not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | Current branch, local regression and process checks; CI pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---
