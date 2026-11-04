# Backlog archive 2026

Closed records in closing-date order. Dated evidence, not current status.

## Closed 2026-11-04

### F-001

**Complete harness adoption and propose a reusable Node profile**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: harness adopted with local Node conventions; a reusable Node profile is template work, not this backlog's.

| | |
|---|---|
| **Issue** | The published template has core and Angular but no Node profile. Adoption exists; remote PR/CI evidence is not available. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | All local harness checks pass; a future upstream profile has its own owned PR and fixtures. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate the adopted tools, retain local Node conventions and record the missing reusable profile without modifying the upstream template in this bootstrap. All local harness checks pass; a future upstream profile has its own owned PR and fixtures.

**Resolution:** Closed 2026-11-04. Harness v3.1.1 core + Angular adopted; Node conventions kept as project lines in AGENTS.md; `check:harness` reports copied files match the template, and CI runs every harness check green on PR #7–#9 and main. The template has no Node stack; proposing one is a project-harness change and belongs in that repository's backlog (not recorded there as of this date).

**Estimates:** Closed; ~100% complete. Estimated 2026-11-01; closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | CI 2026-11-04: validate green on PR #8 run 41749472703, PR #9 run 41749840854, main run 41787648624 (harness, backlog, conventions, maintenance, audits, freshness) |
| Reviewed | 2026-11-04 |

</details>

---

### F-018

**Fixed and JIT counselors/experts (outside council, suggest-only by default)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Support fixed local/always-on specialists and just-in-time (cloud, other-machine) experts that live outside the voting council and only suggest unless explicitly given a temporary seat.

| | |
|---|---|
| **Issue** | Specialists are needed without making every task a large multi-model committee. Hiring and authority boundaries are undefined. |
| **Reproduce** | Register a fixed specialist and a JIT expert; run tasks that should and should not hire them; inspect suggestions vs binding votes. |
| **Check** | Expert roster with capability ads, cost, privacy and availability; hiring decision is cheap/rule-based; default mode is suggest-only; structured suggestion payload (proposal, confidence, evidence, cost/risk); temporary vote seat and progressive promotion are explicit and logged; MCP/API tools can appear as experts. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Define counselor/expert registry and hiring policy in the router (Gendo). Core MAGI remains small and authoritative. Fixed and JIT experts default to suggest-only; promotion into stronger roles follows progressive-trust rules (link F-007 / F-025). Remote experts are enrolled workers (F-005/F-006), not permanent council members. Dashboard expert-pool panel reflects real roster state.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-02.

| Field | Value |
|---|---|
| PR / evidence | Superseded by F-025 (veto-only extra seats and consultants) in [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan); Closed 2026-11-04 |
| Opened | 2026-11-02 |
| Verification | Not applicable: closed unimplemented as superseded |
| Reviewed | 2026-11-04 |

</details>

---

