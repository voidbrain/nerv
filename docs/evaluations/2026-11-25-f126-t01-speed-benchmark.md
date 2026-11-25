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

- **Window:** `2026-11-25T17:50:43.151Z` to `2026-11-25T17:52:54.030Z` on the owner's Mac (`Apple M3 Pro`, `darwin`/`arm64`, 12 cores, `36 GiB` / `38,654,705,664` bytes unified memory).
- **Runtime:** Ollama `0.40.16` on `http://127.0.0.1:11434`; neither model resident before the run (each loaded cold, then unloaded).
- **Host load:** 1-minute load average `10.56` before `gemma4:12b`, `6.17` between the models, `5.20` after `gemma4:26b` (all under the 12 cores); the report's `warnings` were empty for both models (fully in GPU memory, load under the core count).
- **Discarded first run (15:54Z):** load average `37.9`–`56.2` with under `0.5 GiB` free memory gave `164.89` / `24.51` (12b) and `420.34` / `27.95` (26b) median tok/s. Those figures measure a contended machine, not the models; the runner now names such conditions in each model's `warnings` (review fix).

## Model identities and summary medians

| Model | Digest (`sha256` prefix) | Params / quant | Disk size | `/api/ps` resident (`size_vram`) | Median uncached prompt | Prompt reading (median tok/s) | Generation, 256 tok (median tok/s) | Median wall / turn |
|---|---|---|---|---|---:|---:|---:|---:|
| `gemma4:12b` | `6114515d63c1…` | `11.9B` `Q4_K_M` | `7.47 GiB` (`8,021,618,941` B) | `0.94 GiB` (`1,005,217,380` B, all in GPU memory; cold load `5.9 s`) | `3,878` tok | **201.70 tok/s** | **34.14 tok/s** | `26.86 s` |
| `gemma4:26b` | `48eb98ec778c…` | `26.2B` `nvfp4` | `15.04 GiB` (`16,146,867,483` B) | `16.40 GiB` (`17,605,288,312` B, all in GPU memory; cold load `7.5 s`) | `3,874` tok | **582.14 tok/s** | **47.73 tok/s** | `12.07 s` |

## Per-iteration measurements

| Model | Iter | Prompt tok | Prompt ms | Prompt tok/s | Output tok | Eval ms | Gen tok/s | Load ms | Wall ms | Cache defeated |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `gemma4:12b` | 1 | 3,875 | 19,244 | 201.36 | 256 | 7,745 | 33.05 | 5,905 | 32,911 | yes |
| `gemma4:12b` | 2 | 3,878 | 19,227 | 201.70 | 256 | 7,271 | 35.21 | 5 | 26,606 | yes |
| `gemma4:12b` | 3 | 3,882 | 19,169 | 202.51 | 256 | 7,499 | 34.14 | 3 | 26,855 | yes |
| `gemma4:26b` | 1 | 3,880 | 7,328 | 529.49 | 256 | 5,702 | 44.89 | 7,491 | 20,551 | yes |
| `gemma4:26b` | 2 | 3,874 | 6,331 | 611.92 | 256 | 5,364 | 47.73 | 21 | 11,734 | yes |
| `gemma4:26b` | 3 | 3,874 | 6,655 | 582.14 | 256 | 5,325 | 48.07 | 52 | 12,071 | yes |

## Findings and limits

- **Speed comparison:** `gemma4:26b` (`nvfp4`, mixture of experts) read the ~3,880-token uncached prompt **2.9x faster** at the median than dense `gemma4:12b` (`582.14` vs `201.70 tok/s`, prompt evaluation ~`6.7 s` vs ~`19.2 s`) and generated **1.4x faster** (`47.73` vs `34.14 tok/s`), so a warm turn took `11.7`-`12.1 s` instead of `26.6`-`26.9 s`.
- **Against the owner's hand figures** (12b about `200` / `37`, 26b about `441` / `45` tok/s): 12b prompt reading matches; 12b generation is about 8 % lower; 26b is higher on both (prompt reading by about a third). One run of three repetitions each; the spread between runs is not yet measured.
- **Memory trade-off:** `gemma4:26b` needs about `16.4 GiB` resident and `15.04 GiB` on disk against `gemma4:12b`'s `7.47 GiB` on disk.
- **Scope limit:** Throughput alone does not qualify a model switch. `F-126-T02` reruns the F-006 placement probes and Gauntlet role cases on `gemma4:26b` next to `gemma4:12b` before `F-126-T03` goes to the owner.
