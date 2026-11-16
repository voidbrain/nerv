# Outside-Landscape Architecture Comparison (`F-104-T01`)

- **Date:** 2026-11-16
- **Baseline:** `origin/main` (`86f3249b`)
- **Scope:** Compare NERV's local-first multi-base / specialist / MCP / GenUI architecture against frontier and comparable outside systems using primary sources. No architecture or code changes are made in this report; proposals are queued for owner review (`F-104-T03`) and record creation.

## Primary Sources Inspected

1. **LangGraph (State-Graph & Checkpointers):** https://langchain-ai.github.io/langgraph/
2. **Microsoft Agent Framework / AutoGen (Actor & Conversational Multi-Agent):** https://microsoft.github.io/autogen/
3. **Anthropic Claude Agent SDK & Subagents:** https://docs.anthropic.com/en/docs/claude-code/sdk
4. **Model Context Protocol (MCP) Specification:** https://modelcontextprotocol.io/
5. **Agent2Agent (A2A) Protocol Specification (`a2a-protocol.org`):** https://a2a-protocol.org/

## Comparison Table

| Concept | Outside Source | Disposition | Level | Why / Why Not | Proposed Record (for `F-104-T03`) |
|---|---|---|---|---|---|
| **Node-boundary durable checkpointers** | LangGraph Checkpointers | **Adapt** | Project (`src/store.ts`, `src/runtime.ts`) | NERV persists reminders, ledger sorties, and outbox rows in SQLite, but multi-step specialist orchestration (`F-048-T04`) can pause/restart mid-plan. Adapting step-boundary checkpoints in SQLite avoids re-running completed tool steps on restart without adopting LangGraph's Python runtime. | Tracked under `F-048` / candidate follow-up after `F-048-T04` |
| **Capability / Agent Card discovery (`/.well-known/agent-card.json`) & A2A Task states** | A2A Specification (`a2a-protocol.org`) | **Adapt** | Project (`src/kaji-link.ts`, `src/rpc-schemas.ts`) | NERV's base-to-base Kaji link already exchanges signed capability/health state and queued jobs; aligning task lifecycle states (`input-required`, `completed`, `failed`, `canceled`) and declarative capability manifests simplifies future federation without adopting external HTTP discovery over NERV's private mTLS/Kaji channel. | Candidate backlog note for `F-036` / peer protocol alignment |
| **MCP as universal Agent-to-Tool boundary** | Model Context Protocol (`modelcontextprotocol.io`) | **Adopt (Keep)** | Project & Template | NERV already separates internal Pattern Green/Yellow/Red enforcement (`src/policy.ts`, `src/ledger.ts`) and bridges external tools via `src/mcp.ts`. Keep MCP as the external tool boundary; reject trusting third-party MCP descriptions without Misato quarantine/review (`F-021`, `F-085`). | Already adopted (`F-021`); retain |
| **Emergent peer-to-peer group chat orchestration** | AutoGen / Conversational GroupChat | **Reject** | Project | Unbounded peer-to-peer agent chatter burns local/cloud token budgets and weakens deterministic gate control. NERV's Misato-coordinated hub + bounded specialist handoffs (`F-048-T04`) give predictable cost, auditability, and stage gates. | None (rejected) |
| **Single-vendor model lock-in in the agent loop** | Claude Agent SDK | **Reject** | Project | NERV runs heterogeneous local (`ollama` / MLX / Gemma 4) and cloud routes (`src/model.ts`, `F-006`, `F-078`) with per-case model placement and privacy routing (`local-only` vs `any`). Locking the harness to one cloud SDK violates privacy and local-first requirements. | None (rejected) |
| **Declarative schema-validated GenUI catalog** | NERV `shared/surface.ts` vs arbitrary HTML/artifact runtimes | **Adopt (Keep)** | Project (`shared/surface.ts`, `web/src/surface-renderer.ts`) | Restricting rendered cards to a host-shipped Web Component catalog (`nerv-status-card`, `nerv-notice-card`, `nerv-checklist-card`) with strict schema & forbidden-key rejection prevents prompt-injected HTML/script/action execution. | Already adopted (`F-004-T04`, `F-082-T02`); retain |
| **Explicit lifecycle hooks & isolated subagent context** | Claude Agent SDK hooks & subagent isolation | **Watch / Adapt** | Template / Project (`F-049-T04`, `F-048-T04`) | NERV already isolates tool execution (EVA-03 Seatbelt per job in `F-049-T04`) and tracks specialist context budgets. Watch hook-based pre/post tool policy telemetry for further rule-token savings (`F-104-T02`). | Paired with `F-104-T02` |

## Summary & Next Actions

1. **Retain** NERV's core architectural boundaries: SQLite-backed single-writer store, Pattern Green/Yellow/Red ledger gates, Misato-led bounded orchestration, MCP external tool boundary, and schema-validated GenUI Web Components.
2. **Reject** emergent group-chat orchestration and single-vendor cloud SDK lock-in.
3. **Owner Review (`F-104-T03`):** Decide whether to open dedicated follow-up records for (a) SQLite step-boundary checkpoints on multi-step plans (`F-048`) and (b) A2A-aligned task state naming over Kaji (`F-036`), paired with the measured token-cost findings in `F-104-T02`.
