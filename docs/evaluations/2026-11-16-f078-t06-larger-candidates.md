# F-078-T06 Larger candidates campaign on Neo Tokyo-3

Run on 16 November 2026 against local Ollama (`http://127.0.0.1:11434`) on Neo Tokyo-3 (`apple-m3-pro-36g-shared-ram`) within the approved `limits-day.json` budget (`caseMs: 30000`, `suiteMs: 300000`, `repeat: 1`). Raw reports remain private under `artifacts/evaluations/f078-t06/`; no prompts, responses, or credentials entered Git.

## Smoke packs (`neutral-smoke`, `neutral-smoke-schema`)

| Model | `neutral-smoke` | `neutral-smoke-schema` | Failed unconstrained case IDs |
|---|---:|---:|---|
| `qwen3-coder:30b` | 10/10 | 10/10 | — |
| `devstral-small-2:24b` | 4/10 | 10/10 | `exact-json`, `change-mind`, `conflicting-request`, `language-italian`, `tool-choice`, `missing-input` |

## Role bundle (`gauntlet:role-run --role=both`)

| Model | Role | Pass rate | Avg latency | Output tokens | Notes / failed case IDs |
|---|---|---:|---:|---:|---|
| `qwen3-coder:30b` | Casper | 4/5 (80%) | 2,988 ms | 202 | Failed `unclear-request` |
| `qwen3-coder:30b` | Misato | 2/5 (40%) | 2,254 ms | 197 | Failed `exact-reminder`, `correct-rejected-time`, `topic-change-during-question` |
| `devstral-small-2:24b` | Casper | 4/5 (80%) | 6,031 ms | 152 | Failed `unclear-request` |
| `devstral-small-2:24b` | Misato | 1/5 (20%) | 28,391 ms | 7 | **4/5 timed out at 30,000 ms `caseMs` cap** (`ask-before-inventing`, `exact-reminder`, `correct-rejected-time`, `italian-missing-title`); passed `topic-change-during-question` (21,946 ms) |

## Findings

- **`qwen3-coder:30b` (MoE)** passed both `neutral-smoke` and `neutral-smoke-schema` at 10/10 and ran ~1.0–1.3 s per warm case, but scored 2/5 on Misato (`unclear-request`, `exact-reminder`, `correct-rejected-time`, `topic-change-during-question`).
- **`devstral-small-2:24b` (24B dense)** passed `neutral-smoke-schema` (10/10) after failing 6/10 unconstrained smoke cases, and timed out on 4/5 Misato cases (~3k input tokens) under the 30 s `caseMs` cap on M3 Pro.
- Neither model is qualified for production execution by this campaign; results inform `F-078-T07` and host-fit selection.
