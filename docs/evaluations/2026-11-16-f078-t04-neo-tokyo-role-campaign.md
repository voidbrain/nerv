# F-078-T04 Neo Tokyo-3 role campaign

Run on 16 November 2026 against local Ollama (`http://127.0.0.1:11434`) on Neo Tokyo-3 (`apple-m3-pro-36g-shared-ram`) using `node tools/gauntlet.mjs role-run --role=both` (5 `casper-intent-v1` + 5 `misato-planner-v2` cases per model, `limits-day.json`). Raw reports remain private under `artifacts/evaluations/f078-t04/`; no prompts, responses, or credentials entered Git.

| Model | Role | Pass rate | Avg latency | Total latency | Output tokens | Failed / invalid case IDs |
|---|---|---:|---:|---:|---:|---|
| `gemma4:12b` | Casper | 5/5 (100%) | 9,501 ms | 47,507 ms | 1,049 | — |
| `gemma4:12b` | Misato | 3/5 (60%) | 10,974 ms | 54,868 ms | 976 | `exact-reminder`, `correct-rejected-time` |
| `gemma4:26b` | Casper | 5/5 (100%) | 6,792 ms | 33,959 ms | 1,100 | — |
| `gemma4:26b` | Misato | 3/5 (60%) | 9,146 ms | 45,732 ms | 1,216 | `exact-reminder`, `correct-rejected-time` |
| `qwen2.5-coder:14b` | Casper | 4/5 (80%) | 4,871 ms | 24,354 ms | 235 | `unclear-request` |
| `qwen2.5-coder:14b` | Misato | 3/5 (60%) | 8,229 ms | 41,145 ms | 251 | `exact-reminder` (invalid), `correct-rejected-time` |

## Findings

- Both `gemma4:12b` and `gemma4:26b` passed 5/5 on Casper; `gemma4:26b` (MoE) ran ~29% faster on Casper and ~17% faster on Misato than `gemma4:12b` despite larger total weights.
- All three models scored 3/5 on Misato (`exact-reminder` and `correct-rejected-time` failed across all three; `qwen2.5-coder:14b` produced invalid structured output on `exact-reminder` and missed ambiguity on Casper `unclear-request`).
- These aggregate metrics satisfy `F-078-T04` without claiming role qualification or changing production execution permissions.
