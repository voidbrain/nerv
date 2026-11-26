# Agentic Threat Map (F-065-T01)

This map ties OWASP **ASI01–10** (Agentic Applications), **LLM01–10 (2026)**, and **MCP01–10** (MCP Top 10, beta) to pinned [OWASP AISVS](https://github.com/OWASP/AISVS) v1.01 requirements (`v1.01-C<chapter>.<section>.<req>`), NERV's control source paths, and existing tests or named backlog gaps.

> Map, not certification: a row states what a test exercises, never that a risk is eliminated.

## OWASP Agentic Top 10 (ASI01–ASI10)

| Risk | Title | AISVS v1.01 | NERV Control (Source) | Test or Gap |
|---|---|---|---|---|
| ASI01 | Agent Goal Hijack | `v1.01-C5.1.1`, `v1.01-C10.2.1` | `src/misato.ts`, `src/model.ts` | `test/provenance.test.ts` |
| ASI02 | Tool Misuse & Exploitation | `v1.01-C9.1.1`, `v1.01-C9.2.1` | `src/executors.ts`, `src/policy.ts` | `test/gate.test.ts` |
| ASI03 | Identity & Privilege Abuse | `v1.01-C8.1.1`, `v1.01-C8.2.1` | `src/kaji-auth.ts`, `src/native-auth.ts` | `test/native-auth.test.ts`, `test/credential-rotation.test.ts` |
| ASI04 | Agentic Supply Chain Vulnerabilities | `v1.01-C12.1.1`, `v1.01-C12.2.1` | `src/skills.ts`, `src/mcp.ts` | `test/skills.test.ts`, `test/ci-pins.test.mjs` |
| ASI05 | Unexpected Code Execution (RCE) | `v1.01-C9.3.1`, `v1.01-C10.3.1` | `src/tools-process.ts`, `src/brain-process.ts` | `test/isolation.test.ts` (OS sandbox: gap, `F-049`) |
| ASI06 | Memory & Context Poisoning | `v1.01-C5.2.1`, `v1.01-C10.2.2` | `src/memory.ts`, `src/misato.ts` | `test/memory.test.ts`, `test/provenance.test.ts` |
| ASI07 | Insecure Inter-Agent Communication | `v1.01-C8.3.1`, `v1.01-C10.1.1` | `src/kaji-link.ts`, `src/kaji-auth.ts` | `test/kaji-link.test.ts` |
| ASI08 | Cascading Failures | `v1.01-C10.4.1` | `src/watch.ts` (partial watchdog) | gap, `F-064` |
| ASI09 | Human-Agent Trust Exploitation | `v1.01-C9.4.1`, `v1.01-C10.2.3` | `src/ledger.ts`, `src/casper.ts` | `test/gate.test.ts`, `test/dummy-plug.test.ts` |
| ASI10 | Rogue Agents | `v1.01-C9.1.2`, `v1.01-C10.4.2` | `src/pilots.ts`, `src/policy.ts` | `test/pilots.test.ts`, `test/isolation.test.ts` |

## OWASP LLM Top 10 (2026) (LLM01–LLM10)

| Risk | Title | AISVS v1.01 | NERV Control (Source) | Test or Gap |
|---|---|---|---|---|
| LLM01 | Prompt Injection | `v1.01-C5.1.1`, `v1.01-C10.2.1` | `src/misato.ts`, `src/model.ts` | `test/provenance.test.ts` |
| LLM02 | Sensitive Information Disclosure | `v1.01-C5.3.1`, `v1.01-C8.2.2` | `src/misato.ts`, `src/model.ts` | `test/consultant.test.ts`, `test/provenance.test.ts` |
| LLM03 | Supply Chain | `v1.01-C12.1.1` | `src/upgrade-contract.ts`, `src/skills.ts` | `test/ci-pins.test.mjs`, `test/skills.test.ts` |
| LLM04 | Data & Model Poisoning | `v1.01-C5.2.1` | `src/memory.ts` (tainted provenance) | `test/memory.test.ts`, `test/provenance.test.ts` |
| LLM05 | Improper Output Handling | `v1.01-C5.1.2`, `v1.01-C9.1.1` | `src/misato.ts`, `src/executors.ts` | `test/misato.test.ts`, `test/gate.test.ts` |
| LLM06 | Excessive Agency / Unbounded Consumption | `v1.01-C9.2.1`, `v1.01-C10.4.3` | `src/policy.ts`, `src/model-budget.ts` | `test/gate.test.ts`, `test/model-usage.test.ts` (hard circuit: gap, `F-063`) |
| LLM07 | System Prompt Leakage | `v1.01-C5.3.2` | `src/misato.ts`, `src/brain-process.ts` | `test/consultant.test.ts` |
| LLM08 | Vector & Embedding Weaknesses / Hidden Context | `v1.01-C5.2.2`, `v1.01-C10.2.2` | `src/mcp.ts`, `src/memory.ts` | `test/mcp.test.ts`, `test/provenance.test.ts` (MCP prompt taint: gap, `F-065`; owner-accepted exception: `allowTainted` read grants on local servers, [decision](../decisions/tainted-mcp-reads.md)) |
| LLM09 | Misinformation / Embedding Drift | `v1.01-C5.2.3` | N/A (no vector embeddings; Lilith uses deterministic SQLite FTS5 in `src/memory.ts`) | `test/memory.test.ts` |
| LLM10 | Unbounded Consumption (Inference) | `v1.01-C10.4.3` | `src/model-budget.ts`, `src/model-usage.ts` | `test/model-usage.test.ts` (global budget caps: gap, `F-063`) |

## OWASP MCP Top 10 (Beta) (MCP01–MCP10)

| Risk | Title | AISVS v1.01 | NERV Control (Source) | Test or Gap |
|---|---|---|---|---|
| MCP01 | Token Mismanagement & Secret Exposure | `v1.01-C8.2.1`, `v1.01-C8.2.2` | `src/mcp.ts`, `src/config.ts` | `test/mcp.test.ts`, `test/credential-rotation.test.ts` |
| MCP02 | Privilege Escalation via Scope Creep | `v1.01-C9.1.1`, `v1.01-C9.2.1` | `src/mcp.ts`, `src/policy.ts` | `test/mcp.test.ts`, `test/gate.test.ts` |
| MCP03 | Tool Poisoning | `v1.01-C5.1.1`, `v1.01-C12.1.1` | `src/mcp.ts`, `src/executors.ts` | `test/mcp.test.ts` |
| MCP04 | Software Supply Chain & Dependency Tampering | `v1.01-C12.1.1`, `v1.01-C12.2.1` | `src/mcp.ts` | `test/mcp.test.ts`, `test/ci-pins.test.mjs` |
| MCP05 | Command Injection & Execution | `v1.01-C9.3.1` | `src/tools-process.ts`, `src/mcp.ts` | `test/isolation.test.ts`, `test/mcp.test.ts` (OS sandbox: gap, `F-049`) |
| MCP06 | Prompt Injection via Contextual Data | `v1.01-C5.1.1`, `v1.01-C10.2.1` | `src/misato.ts`, `src/mcp.ts` | `test/provenance.test.ts`, `test/mcp.test.ts` |
| MCP07 | Insufficient Authentication & Authorization | `v1.01-C8.1.1`, `v1.01-C8.3.1` | `src/kaji-auth.ts`, `src/mcp.ts` | `test/kaji-link.test.ts`, `test/mcp.test.ts` |
| MCP08 | Lack of Audit & Telemetry | `v1.01-C10.1.1`, `v1.01-C10.1.2` | `src/ledger.ts`, `src/history.ts` | `test/ledger.test.ts`, `test/history.test.ts` |
| MCP09 | Shadow MCP Servers | `v1.01-C9.1.2`, `v1.01-C12.2.1` | `src/mcp.ts`, `src/config.ts` | `test/mcp.test.ts` |
| MCP10 | Context Injection & Over-Sharing | `v1.01-C5.3.1`, `v1.01-C10.2.2` | `src/misato.ts`, `src/mcp.ts` | `test/consultant.test.ts`, `test/mcp.test.ts` |
