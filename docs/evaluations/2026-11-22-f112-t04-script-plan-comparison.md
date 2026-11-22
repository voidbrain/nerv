# F-112-T04: Planner steps and tokens with and without script plans

Measured on 2026-11-22 via the `nerv-system-flows/script-plans` Gauntlet system case (`test/script-plan.test.ts`), driving `RuntimePlanning.loop` on a neutral 4-read request (`"List my reminders for day-1, day-2, day-3, and day-4."`) against `misatoAsk` and `measureMisatoPrompt` (`src/prompt-samples.ts`) with the full 43-tool `toolDocs` catalogue.

## Verdict

Script mode reduced planner round-trips from **5 steps to 2 steps (-60.0%)** and total estimated tokens from **21,861 to 8,835 (-59.6%)** while keeping all 4 `reminders.list` calls individually gated through `host.gate` inside EVA-03.

## Neutral 4-read comparison (deterministic system runner, `local` route)

| Mode | Planner steps | Gated `reminders.list` calls | Prompt tokens | Tool-schema tokens | Output tokens | Total tokens |
|---|---:|---:|---:|---:|---:|---:|
| Without scripts (sequential `action` turns) | 5 | 4 | 21,783 | 14,715 | 78 | 21,861 |
| With scripts (`{ script }` in EVA-03) | 2 | 4 | 8,741 | 5,886 | 94 | 8,835 |
| Delta (scripted vs baseline) | -3 (-60.0%) | 0 | -13,042 (-59.9%) | -8,829 (-60.0%) | +16 (+20.5%) | -13,026 (-59.6%) |

## Notes & scope

- **Deterministic system evidence**: Executed via `npm run gauntlet:run -- --only=script-plans --execute` (`reportId`: `b22879a8-7c7f-4599-8889-b950376b45c5`) and recorded in `evals/gauntlet/ledger.json`.
- **Real-model comparison**: Not run here; running real models requires owner approval under [BACKLOG-RULES](../BACKLOG-RULES.md) ("Evaluation dependencies").
