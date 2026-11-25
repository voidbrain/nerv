# F-079-T02: System evaluation case path declarations and replay measurement

**Date:** 2026-11-20
**Base:** `origin/main` (`6ff973ba`) · **Range replayed:** `1869340..origin/main` (362 first-parent merges)

## Declared paths

Each case in `evals/gauntlet/system-v1.json` now declares `inputs` matching the files its adapter (`evals/suite.json`) exercises, plus `evals/suite.json` and `evals/gauntlet/system-v1.json`:

- `policy`: `src/policy.ts`, `test/evaluation.test.ts` (since `test/evaluation.test.ts` imports only `src/policy.ts`).
- `ledger`, `conversation`, `channels`, `bases`, `stress`: `src/`, `shared/`, and each case's own test files and fixtures (`test/fixtures/posix.ts` where imported), because they transitively import `src/runtime.ts` / `src/store.ts`.
- `browser`: `src/`, `shared/`, `web/`, and the browser test/fixture files.

## Replay results (`1869340..origin/main`, 362 merges)

| Case | Reruns without declarations | Reruns with declarations | Saved |
|---|---:|---:|---:|
| `policy` | 224 | 13 | 211 (94.2%) |
| `ledger` | 224 | 176 | 48 (21.4%) |
| `conversation` | 224 | 177 | 47 (21.0%) |
| `channels` | 224 | 179 | 45 (20.1%) |
| `bases` | 224 | 180 | 44 (19.6%) |
| `stress` | 224 | 176 | 48 (21.4%) |
| `browser` | 224 | 187 | 37 (16.5%) |
| **Total** | **1568** | **1088** | **480 (30.6%)** |

If a scoped case ever misses a real regression, that case returns to the whole-tree key.
