# F-126-T01 local model speed benchmark: gemma4:12b vs gemma4:26b

Repeatable local-only speed benchmark for uncached prompt reading and token generation across installed Ollama models ([F-126](../work/records/F-126.md)). Only loopback Ollama (`http://127.0.0.1:11434`) was called (0 paid tokens); raw JSON reports stay private in `~/.local/state/nerv-evals/`.

## Benchmark command and fixture

```bash
node evals/speed-benchmark.mjs                                                        # dry-run plan (no network calls)
node evals/speed-benchmark.mjs --execute --models=gemma4:12b,gemma4:26b --repeat=3 \
  --out="$HOME/.local/state/nerv-evals/speed-benchmark-$(date +%Y%m%d-%H%M%S).json"
```

- **Runner:** [evals/speed-benchmark.mjs](../../evals/speed-benchmark.mjs) (`test/speed-benchmark.test.mjs`).
- **Fixture:** [evals/speed-benchmark-v1.json](../../evals/speed-benchmark-v1.json) (`local-speed-benchmark-v1`, SHA-256 `62a7f4ba64cf840d6620c484976ff8bdaa8ea13cca82c024d1aeefd79bcc3582`), neutral synthetic planner/tool/telemetry context (`num_ctx: 8192`, `num_predict: 256`, `temperature: 0`, `think: false`).
- **Prompt cache defeat:** Every iteration prepends 32 random hex characters split into four tokens plus `[uncached-iteration-<i>]` at byte 0 of the user message, defeating Ollama's prefix KV cache from token 0, and verifies `prompt_eval_count >= 3500` (`minUncachedPromptTokens`) on every iteration.
- **Residency hygiene:** Records whether each model was already resident in `/api/ps`, measures resident memory after its iterations, and sends `keep_alive: 0` when a model was loaded specifically for the benchmark so unified memory returns before the next model runs.

## Machine and operating conditions (2026-11-25)

- **Window:** `2026-11-25T15:54:33.898Z` to `2026-11-25T15:57:22.782Z` on the owner's Mac (`Apple M3 Pro`, `darwin`/`arm64`, 12 cores, `36 GiB` / `38,654,705,664` bytes unified memory).
- **Runtime:** Ollama `0.40.16` on `http://127.0.0.1:11434`.
- **Host load (concurrent workload active on the Mac):**
  - `gemma4:12b`: load average (1m / 5m / 15m) `37.93 / 17.94 / 13.00` before (`509 MiB` free memory), `56.20 / 30.31 / 18.44` after (`86 MiB` free).
  - `gemma4:26b`: load average (1m / 5m / 15m) `56.20 / 30.31 / 18.44` before (`91 MiB` free memory), `31.54 / 28.35 / 18.59` after (`1.08 GiB` free).

## Model identities and summary medians

| Model | Digest (`sha256` prefix) | Params / quant | Disk size | `/api/ps` resident (`size_vram`) | Median uncached prompt | Prompt reading (median tok/s) | Generation, 256 tok (median tok/s) | Median wall / turn |
|---|---|---|---|---|---:|---:|---:|---:|
| `gemma4:12b` | `6114515d63c1…` (`6114515d63c17436a7c0417d82820ac65ad643e2806c5a3c89cb62846436ed0b`) | `11.9B` `Q4_K_M` | `7.47 GiB` (`8,021,618,941` B) | `1.08 GiB` (`1,156,537,383` B; resident before run) | `3,877` tok | **164.89 tok/s** | **24.51 tok/s** | `34.46 s` |
| `gemma4:26b` | `48eb98ec778c…` (`48eb98ec778c163d87f69d735fcdd79e345063af9af4685613fd018ae5debf5e`) | `26.2B` `nvfp4` | `15.04 GiB` (`16,146,867,483` B) | `15.92 GiB` (`17,097,937,272` B; cold load `10.08 s`, unloaded after) | `3,879` tok | **420.34 tok/s** | **27.95 tok/s** | `19.62 s` |

## Per-iteration measurements

| Model | Iter | Prompt tok | Prompt ms | Prompt tok/s | Output tok | Eval ms | Gen tok/s | Load ms | Wall ms | Cache defeated |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `gemma4:12b` | 1 | 3,874 | 23,008 | 168.38 | 256 | 11,372 | 22.51 | 3 | 34,528 | yes |
| `gemma4:12b` | 2 | 3,880 | 23,531 | 164.89 | 256 | 10,402 | 24.61 | 5 | 34,134 | yes |
| `gemma4:12b` | 3 | 3,877 | 23,851 | 162.55 | 256 | 10,445 | 24.51 | 6 | 34,463 | yes |
| `gemma4:26b` | 1 | 3,879 | 9,228 | 420.34 | 256 | 8,876 | 28.84 | 10,080 | 28,287 | yes |
| `gemma4:26b` | 2 | 3,879 | 8,027 | 483.24 | 256 | 9,463 | 27.05 | 25 | 17,614 | yes |
| `gemma4:26b` | 3 | 3,881 | 10,206 | 380.26 | 256 | 9,159 | 27.95 | 63 | 19,618 | yes |

## Findings and limits

- **Speed comparison:** Even under heavy Mac load (`loadavg` 31–56 vs 8–15 in the owner's earlier hand check), `gemma4:26b` (`nvfp4` sparse/MoE layout) read the ~3,880-token uncached prompt **2.55× faster** at the median than dense `gemma4:12b` (`420.34` vs `164.89 tok/s`, cutting prompt evaluation from ~`23.5 s` to ~`9.2 s`) and generated **1.14× faster** (`27.95` vs `24.51 tok/s`), lowering warm per-turn wall time from `34.1–34.5 s` to `17.6–19.6 s`.
- **Memory trade-off:** `gemma4:26b` uses `15.04 GiB` on disk and `15.92 GiB` resident unified memory/VRAM (`10.08 s` cold load), roughly twice `gemma4:12b`'s `7.47 GiB` model weight footprint.
- **Scope limit:** Throughput alone does not qualify a model switch. `F-126-T02` reruns the F-006 placement probes and Gauntlet role cases on `gemma4:26b` next to `gemma4:12b` before `F-126-T03` goes to the owner.
