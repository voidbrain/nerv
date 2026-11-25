# Token Cost Compared With Outside Practice (`F-104-T02`)

- **Date:** 2026-11-16
- **Baseline:** `origin/main` (`86f3249b`)
- **Scope:** Compare NERV's measured `work-usage` telemetry and rule-load budgets against current outside LLM-agent token-cost practices. No rule or code changes are made in this report; proposals are queued for owner review (`F-104-T03`).

## 1. Measured NERV Baseline (`work-usage` & Rule Load)

- **Rule-load discipline (`tools/check-rules.mjs`, `.harness.json`):**
  - `AGENTS.md` was slimmed in `8.14.1` / `8.14.3` so always-loaded instructions stay within budget, while **40 procedure documents** (`docs/agents/*.md`, `docs/backlog/*.md`) load only on trigger and add zero duplicate `never`/`ask-first` rules.
  - `check-freshness.mjs` flagged 3 backlog records (`F-004` ~2,429 tokens, `F-007` ~1,529 tokens, plus `rules.budgets.record` at 1,500 tokens) whose historical evidence can be archived to `docs/archive/evidence-<year>.md`.
- **Work-usage report (`node tools/work-usage.mjs report`):**
  - Tracks per-job duration, `suggestedPauses` (15-minute `pauseGapMinutes` in `.harness.json`), and shared-account quota windows (e.g., `codex:secondary` 8% window delta).
  - Token-by-activity (`planning`, `coding`, `tests`, `review`, `documentation`, `backlog`, `harness`) currently reports `known: null` when external IDE/provider token logs are not imported, leaving token attribution coarse across shared sessions.

## 2. Comparison Against Outside Token-Cost Practices

| Technique | Outside Practice | Current NERV State | Disposition | Level | Why / Why Not |
|---|---|---|---|---|---|
| **Prompt caching with stable prefix** | Place static system instructions, tool schemas, and long-lived docs at the front; avoid volatile timestamps/state in prefix to earn ~50–90% cache-read discount (Anthropic/OpenAI/Bedrock). | `src/model.ts` builds chat/tool prompts; `AGENTS.md` + triggered procedures already separate static vs dynamic content in dev harness. | **Adopt / Audit** | Project (`src/model.ts`) | Ensure runtime system prompt & `builtinTools` schemas stay byte-stable at prefix before per-turn inbox/memory/clock context. |
| **Deferred / on-demand tool loading** | Expose a lightweight tool index or category loader instead of sending 50+ full JSON tool schemas on every turn. | `src/executors.ts` registers 30+ `builtinTools` + dynamic MCP tools (`src/mcp.ts`) on every turn. | **Adapt** | Project (`src/executors.ts`, `src/misato.ts`) | As battery, pantry, list, Gmail, and FPV tools grow, sending every schema every turn inflates local 4K–16K context and cloud input cost. Load domain tool schemas on demand by intent/specialist. |
| **Tool-output compaction & ephemeral sub-loops** | Truncate/summarize large logs/files returned by tools and isolate noisy research in disposable subagent contexts. | Harness uses `research` subagents and `work:next` / `code:map`; runtime `src/runtime.ts` passes tool results in turn history. | **Adapt** | Project (`src/runtime.ts`) & Template | Cap/summarize verbose tool outputs (e.g., large `gmail.search`, `blackbox`, or log outputs) before persisting into rolling conversation history. |
| **Semantic / task-complexity model routing** | Route simple extraction/classification/formatting to small/local models; reserve frontier cloud models for complex planning. | NERV already implements per-role & privacy-aware routing (`src/model.ts`, `F-006`, `F-078` local Gemma 4 / Qwen / cloud campaigns). | **Adopt (Keep)** | Project (`src/model.ts`) | Already core NERV design; continue calibrating via `F-078` campaigns. |
| **Trace-driven per-session token telemetry** | Capture input, output, cached-read, cache-write, and reasoning tokens per session ID so optimization is measured rather than guessed. | `work-usage.mjs` supports token fields and `import`, but `byActivity` is mostly `null` without automated provider/CLI log import. | **Adapt** | Template (`tools/work-usage.mjs`) | Import token breakdowns consistently (where providers expose them) so `F-104` reviews compare real token counts, not only wall-clock/quota %. |
| **Unbounded autonomous summary loops** | Background LLM compaction on every few turns regardless of session length. | NERV keeps turns bounded and uses explicit `/compact` or session boundaries. | **Reject** | Template / Project | Extra background LLM calls on short turns cost more than they save; trigger compaction only past explicit token thresholds. |

## 3. Proposed Backlog Items (for `F-104-T03` Owner Review)

1. **Runtime prompt-prefix stability & tool-output cap (`src/model.ts`, `src/runtime.ts`):** Verify static system + tool prefix ordering for prompt caching and bound raw tool-result size injected into chat history.
2. **Deferred domain tool loading (`src/executors.ts`):** Group specialized toolsets (`fpv.*`, `pantry.*`, `gmail.*`, `batteries.*`) behind category discovery or intent-based injection to keep local Gemma 4 / Qwen context lean.
3. **Archive over-budget evidence records (`F-004`, `F-007`):** Move pre-reconciliation evidence to `docs/archive/evidence-2026.md` per `check-freshness` rule-load warnings.
