# F-078-T09: Tabgha Campaign — Remote Endpoint & Local Fallback (2026-11-22)

Ran on 22 November 2026 on Tabgha (`NERV-02`, Intel N97 4-core CPU, 12,321,688 KB / ~11.75 GiB total RAM, Windows 11, `limits-day.json` with 30 s per-case timeout) using `node tools/gauntlet.mjs role-run --role=both` (5 `casper-intent-v1` + 5 `misato-planner-v2` cases per model). Raw reports remain private on the host under temporary artifacts; this page records metadata and aggregate outcomes only.

## 1. Local Fallback on Tabgha (`intel-n97-12g-windows`)

| Model | Role | Pass | Fail | Error (30 s timeout) | Avg latency | Total latency | Output tokens | Non-passing case IDs |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `qwen2.5:1.5b` | Casper | 3/5 (60%) | 2 | 0 | 5,374 ms | 26,871 ms | 123 | `contradictory-time`, `unclear-request` |
| `qwen2.5:1.5b` | Misato | 0/5 (0%) | 2 | 3 | 25,141 ms | 125,703 ms | 105 | `ask-before-inventing` (timeout), `exact-reminder` (timeout), `correct-rejected-time` (timeout), `italian-missing-title`, `topic-change-during-question` |
| `qwen2.5:3b` | Casper | 4/5 (80%) | 1 | 0 | 9,981 ms | 49,905 ms | 122 | `unclear-request` |
| `qwen2.5:3b` | Misato | 0/5 (0%) | 0 | 5 | 30,159 ms | 150,795 ms | 0 | All 5 Misato cases hit the 30 s timeout |

### Memory Pressure on Tabgha (`NERV-02`)

- **Before `qwen2.5:1.5b`**: `FreePhysicalMemory = 6,461,664 KB` (~6.16 GiB free of 11.75 GiB total).
- **After `qwen2.5:1.5b` (986 MB weights)**: `FreePhysicalMemory = 6,585,224 KB` (~6.28 GiB free).
- **After `qwen2.5:3b` (1.9 GB weights)**: `FreePhysicalMemory = 6,670,196 KB` (~6.36 GiB free).
- Neither `1.5b` nor `3b` exhausted Windows RAM (over ~6 GiB stayed free throughout). The bottleneck on Tabgha is **4-core Intel N97 CPU compute**, which keeps `casper-intent-v1` under ~10 s/case on average (`qwen2.5:3b` 4/5) but pushes `misato-planner-v2`'s larger tool-list prompt past the 30 s limit (3/5 timeouts on `1.5b`, 5/5 timeouts on `3b`).

## 2. Remote Endpoint from Tabgha → Neo Tokyo-3 (`models.remote` path)

Measured from Tabgha over the LAN to Neo Tokyo-3 (`Apple M3 Pro`, 36 GB unified memory) via a loopback-forwarded Ollama endpoint (`127.0.0.1:11435` → `Neo Tokyo-3:11434`):

| Model (remote) | Role | Pass | Fail / Invalid | Error | Avg latency | Total latency | Output tokens | Non-passing case IDs |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `gemma4:26b` | Casper | 5/5 (100%) | 0 | 0 | 7,157 ms | 35,783 ms | 1,080 | — |
| `gemma4:26b` | Misato | 3/5 (60%) | 2 | 0 | 10,268 ms | 51,338 ms | 1,178 | `exact-reminder` (invalid), `correct-rejected-time` |
| `qwen2.5-coder:14b` | Casper | 4/5 (80%) | 1 | 0 | 5,186 ms | 25,929 ms | 235 | `unclear-request` |
| `qwen2.5-coder:14b` | Misato | 2/5 (40%) | 3 | 0 | 10,348 ms | 51,742 ms | 305 | `exact-reminder` (invalid), `italian-missing-title` (invalid), `correct-rejected-time` |

- **Neo Tokyo-3 asleep / unreachable probe**: Pointing Tabgha at an unreachable remote port (`127.0.0.1:11499`) failed fast on `casper-intent-v1/matching-reminder` with `fetch failed` in **4 ms** (`0` output tokens), confirming immediate failure detection without hanging for the 30 s case budget.

## Findings

- **Remote primary works cleanly**: `gemma4:26b` over the LAN from Tabgha scored 5/5 Casper (`7.2 s` avg) and 3/5 Misato (`10.3 s` avg) with zero timeouts — matching its local Neo Tokyo-3 accuracy (`F-078-T04`) with ~0.3–1.1 s network overhead.
- **Local fallback limits**: `qwen2.5:3b` is viable on Tabgha for short Casper intent votes (4/5, `10.0 s` avg) when Neo Tokyo-3 is asleep, while Misato planning on Tabgha's N97 CPU cannot complete within 30 s locally on either `1.5b` or `3b`.
