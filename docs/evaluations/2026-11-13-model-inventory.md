# Model and hardware inventory, 13 November 2026 (F-078-T01)

Read-only inventory with the commands in [the F-078 inventory steps](../acceptance/f078-model-inventory.md). The owner allowed the agent to run the Tabgha inventory once over SSH. Nothing was installed, downloaded or changed, and no model was called.

## Neo Tokyo-3 (main base)

Apple M3 Pro, 36 GB unified memory. Ollama runs on the GPU with that memory, so about 24 GB (two thirds) is a practical ceiling for weights plus context.

| Installed model | Size | Profile in `docs/agents/model-profiles.json` | Fits |
|---|---|---|---|
| `gemma4:12b` | 8.0 GB | yes (candidate) | yes |
| `qwen2.5-coder:14b` | 9.0 GB | yes (candidate) | yes |
| `gemma4:26b` | 16 GB | no | yes, with a modest context |
| `gemma4-128k:latest` | 16 GB | no | weights fit; a 128k context adds a large KV cache on top, so measure it before using it |
| `gemma4:e2b-it-q4_K_M` | 7.2 GB | no | yes |

Not installed: `devstral-small-2:24b` (about 15 GB) and `qwen3-coder:30b` (about 19 GB). Both would fit under the ceiling, the second with little room for context.

## Tabgha, NERV-02 (mini PC)

Intel N97 (4 cores), 12 GB memory, Intel UHD Graphics (2 GB shared). Ollama does not use this GPU, so models run on the CPU from system memory, beside Windows. About 8 GB is a practical ceiling, and generation on four efficiency cores is slow.

| Installed model | Size | Fits |
|---|---|---|
| `qwen2.5:1.5b` | 986 MB | yes |

`qwen2.5-coder:14b` is **not** installed on Tabgha: it is on Neo Tokyo-3. At 9 GB it would exceed Tabgha's ceiling and run at a few tokens per second at best. Of the four candidate profiles, none fits Tabgha.

## What this changes

- The F-078 plan assumed Tabgha runs `qwen2.5-coder:14b` (F-078-T05). It does not, and could not do so usefully.
- NERV already lets a base use another base's model over the Kaji line (`models.remote`, endpoints named by enrolled base ID). Tabgha can use Neo Tokyo-3's models for its roles while Neo Tokyo-3 is online, and keep a small local model for when it is not.
- Proposed for the owner's decision in F-078-T02: on Tabgha, measure (1) the remote endpoint path to Neo Tokyo-3 (latency, timeouts, behaviour when Neo Tokyo-3 sleeps) and (2) `qwen2.5:1.5b` and at most one 3–4B model locally as a degraded fallback. On Neo Tokyo-3, add `gemma4:26b` to the matrix beside the four candidates.

## Approved matrix and budget (F-078-T02, 2026-11-13)

The owner approved the proposals above and both downloads ("approve all", 2026-11-13). Only local models are run, and no cloud model.

| Base | Model | Smoke packs (T03) | Misato and Casper roles (T04) | Notes |
|---|---|---|---|---|
| Neo Tokyo-3 | `gemma4:12b` | yes, plus the three failures of 2026-11-09 | yes | |
| Neo Tokyo-3 | `gemma4:26b` | yes | yes | added by this decision |
| Neo Tokyo-3 | `qwen2.5-coder:14b` | yes | yes | |
| Neo Tokyo-3 | `devstral-small-2:24b` | in T06 | in T06 | downloaded 2026-11-13 |
| Neo Tokyo-3 | `qwen3-coder:30b` | in T06 | in T06 | downloaded 2026-11-13 |
| Tabgha | best two Neo Tokyo-3 models over `models.remote` | yes | yes | latency, timeouts, Neo Tokyo-3 asleep |
| Tabgha | `qwen2.5:1.5b` and `qwen2.5:3b`, local | yes | yes | fallback when Neo Tokyo-3 is offline; `qwen2.5:3b` (about 2 GB) is downloaded on Tabgha in T05 |

Left out: `gemma4-128k` (only if a role needs the long context) and `gemma4:e2b` (no base needs it: too large for Tabgha's fallback, smaller than the Mac's candidates).

**Budget:** at most 2 h of host wall time each for T03, T05 and T06, and 3 h for T04. A campaign that would exceed its budget stops and asks. Runs start only when the agent has said which campaign it is starting.
