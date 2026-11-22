# Model Splitting Across Bases (F-116-T01)

Date: 2026-11-22  
Status: Feasibility note for owner decision (`F-116-T02`)

## 1. When Splitting Is Not Worth It

Splitting a model across bases adds a network round-trip at every cross-host layer boundary. It **never improves speed** over running the same model on a single base.

- **Do not split** any model whose weights + KV cache fit within one enrolled base's practical memory ceiling (for example, `<= 24 GB` on Neo Tokyo-3). Use single-base inference directly or `models.remote` over the Kaji line.
- **Only consider splitting** when a target model's weights exceed every enrolled base's free memory and cannot load on any single host.

## 2. Target Model & Runtime

- **Target model class**: A ~40 GB quantized model (such as a 70B `Q4_K_M` GGUF, ~40–42 GB weights plus KV cache), which exceeds Neo Tokyo-3's ~24 GB practical ceiling (Apple M3 Pro, 36 GB unified memory) and Tabgha's ~8 GB practical ceiling (12 GB total RAM).
- **Runtime**: `llama.cpp` with its **RPC backend** (`rpc-server` on worker base(s), `llama-server --rpc` / `llama-cli --rpc` on the coordinator base).
- **Why not Ollama**: Ollama exposes no distributed layer-splitting or RPC backend, so a split model cannot run inside Ollama; it would sit beside Ollama as a dedicated `llama.cpp` OpenAI-compatible HTTP endpoint (`llama-server`).

## 3. Enrolment, Routing & Security Boundary

- **Routing & enrolment join**: Each participating worker base advertises an active `rpc-server` capability and free memory budget in its Kaji heartbeat. NERV's model router registers the split model as a composite route pinned to those base IDs and **refuses** (or falls back to a smaller single-base model) whenever any participating base is offline or asleep.
- **Security boundary**: `llama.cpp`'s `rpc-server` has **no built-in authentication or transport encryption**. Exposing it on `0.0.0.0` over a LAN would allow arbitrary tensor/memory RPC access. In NERV, `rpc-server` must bind only to loopback or an authenticated/encrypted tunnel (such as the Kaji mTLS wire or a private Tailscale interface) and never accept unauthenticated LAN connections.

## 4. Alternatives Comparison (~40 GB Model)

| Approach | Expected Throughput | Setup & Operations | Fit for NERV's Node/Ollama Stack |
|---|---|---|---|
| **Single-base Ollama** | N/A (cannot load ~40 GB in 24 GB ceiling) | Already integrated | Native, but blocked by single-host RAM |
| **AirLLM** (layer-by-layer from disk) | ~7–10 s/token (~0.1–0.14 tok/s) on a 5–6 GB/s NVMe SSD | Python/PyTorch runtime + per-layer disk streaming | Poor fit: heavy Python dependency, very slow interactive latency |
| **`llama.cpp` `mmap` offload** (single base) | ~0.3–1.5 tok/s once paging from SSD (severe thrash above physical RAM) | Single `llama-server` binary, no cross-host coordination | Moderate: HTTP-compatible with Node, but degrades host responsiveness |
| **`llama.cpp` RPC split** (Mac + mini PC) | **~1.5–3 tok/s** (when split fits combined RAM) | `rpc-server` on Tabgha + `llama-server --rpc` on Neo Tokyo-3 over encrypted tunnel | Moderate: Node talks HTTP to `llama-server`, requires lifecycle/health coordination across two bases |

## 5. Throughput Check Against Mini PC (`Tabgha`, `NERV-02`) Specs

From the recorded hardware inventory ([2026-11-13-model-inventory.md](../evaluations/2026-11-13-model-inventory.md)):

- **Neo Tokyo-3 (main base)**: Apple M3 Pro, 36 GB unified memory (~24 GB practical model ceiling).
- **Tabgha (`NERV-02`, mini PC)**: Intel N97 (4 efficiency cores), 12 GB system memory, Intel UHD Graphics (2 GB shared, unused by Ollama), ~8 GB practical ceiling beside Windows.

For a ~40 GB model, Neo Tokyo-3 + Tabgha together only have ~32 GB of combined practical ceiling (36 GB + 12 GB = 48 GB raw RAM), so a full 40 GB `Q4_K_M` still leaves minimal OS headroom unless further quantized (e.g. `Q3_K_M` / ~30–34 GB). Even where it fits in combined RAM:

1. **Memory bandwidth, not network, is the bottleneck**: An Intel N97 runs on CPU memory bandwidth (~25–38 GB/s single-channel DDR4/LPDDR5, further limited by 4 efficiency cores) rather than M3 Pro GPU bandwidth (~150 GB/s). Reading ~8 GB of weights per generated token on the N97 takes ~250–500 ms+ on its own, capping total generation at **~1.5–3 tok/s** even before network latency.
2. **Network overhead is secondary**: One cross-host hop per token over Gigabit Ethernet or local Wi-Fi adds ~1–5 ms, which is small compared to the N97's per-token CPU compute/memory-bandwidth time.

## 6. Recommendation for F-116-T02

Keep whole-model placement and `models.remote` as the default. Only build `llama.cpp` RPC splitting if the owner specifically wants slow (~1.5–3 tok/s) offline batch/background capacity for a ~30–34 GB+ model that cannot fit on Neo Tokyo-3 alone, and require encrypted tunnel binding for `rpc-server`.
