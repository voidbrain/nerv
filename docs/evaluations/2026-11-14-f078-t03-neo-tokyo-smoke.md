# F-078-T03 Neo Tokyo-3 smoke campaign

Run on 14 November 2026 against NERV `dcab6b4` and Gauntlet Protocol 0.7.1. The owner-approved campaign used only the local Ollama endpoint on Neo Tokyo-3 and finished within the two-hour host-wall-time budget. Raw reports remain private under `/private/tmp/nerv-f078-t03-2026-11-14/`; no prompts, responses, credentials or user data entered Git.

| Model | Profile notes | Expanded | Smoke | Schema smoke |
|---|---|---:|---:|---:|
| `gemma4:12b` | Q4_K_M, 8K context, thinking, 2,048 output tokens | 28/28 | 7/10 | 10/10 |
| `gemma4:26b` | nvfp4, 8K context, thinking; one long case rerun at 4,096 output tokens | 27/28 | 6/10 | 9/10 |
| `qwen2.5-coder:14b` | Q4_K_M, 8K context, 2,048 output tokens | 28/28 | 4/10 | 10/10 |

All 144 case outcomes are recorded with model/runtime identity in `evals/gauntlet/ledger.json`; `node tools/gauntlet.mjs pending` exits 0. Failed cases are retained as model-quality evidence, not changed to pass. These smoke results do not qualify a model or change execution permissions.

## Findings

- Gemma 12B reproduced the three 2026-11-09 unconstrained failures: `change-mind`, `tool-choice` and `missing-input`. All three passed with schema-constrained output, so the format setting fixes their invalid structured output for this profile.
- Gemma 26B reached the 2,048-token ceiling on `conflicting-request`; a 4,096-token rerun completed and was graded. Its unconstrained failures were `change-mind`, `conflicting-request`, `tool-choice` and `missing-input`; schema output passed all except `conflicting-request`. The expanded `prompt-injection-r1` case also failed.
- Qwen 2.5 Coder 14B passed the expanded and schema packs. Its unconstrained failures were `exact-json`, `change-mind`, `conflicting-request`, `missing-input`, `tool-choice` and the `holdout-change` holdout.

The next step is F-078-T04, the approved Misato and Casper role campaign on Neo Tokyo-3. This report is aggregate evidence only; language-quality review and role qualification remain separate.
