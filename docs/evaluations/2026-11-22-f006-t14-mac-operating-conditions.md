# F-006-T14 Mac operating-conditions report

This report records the owner-run F-006-T13 campaign of 18 November 2026 against the approved [Mac operating-conditions plan](../decisions/mac-operating-conditions.md). Raw reports remain private under `~/.nerv-private/reports`; this page keeps only bounded aggregate evidence. No model was run while writing this report.

## Identity and controls

All three conditions used the same Apple M3 Pro Mac with 36 GiB unified memory, local Ollama `0.40.16`, `gemma4:12b` Q4_K_M, 8K context, temperature 0, seed 42, parallelism 1 and model digest `6114515d…36ed0b`. Each condition freshly ran 30 `neutral-smoke` results and 30 role results (15 Casper, 15 Misato) with the same cases, graders and limits: 30 s per case, 15 min per suite and 61,440 output tokens per suite. No cloud route or paid token was used.

The repeated deterministic settings produced identical answers within each case. The three repeats therefore measure timing stability, not answer variability; a future variability study needs a different seed per repeat or a non-zero temperature and a separately approved campaign.

## Results

| Condition | Actual competing workload | Common | Roles | Cold load | Median TTFT | Generation | Common / role duration | Output tokens | Sampled resource pressure |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Office / heavy (`heavy-load@1.0.0`) | Parallels VM running VS Code, Visual Studio, UaExpert and Postman; Chrome, Safari, Firefox, Teams, Outlook and host VS Code | 24/30 | 24/30 | 11.3 s | 536 ms | 28.3 tok/s | 149 s / 279 s | 3,477 / 6,471 | process RSS peak 9.3 GB; whole-device GPU peak 100%; GPU allocation peak 11.4 GB |
| Home / active (`moderate-load@1.0.0`) | Safari, Firefox and VS Code | 24/30 | 24/30 | 4.1 s | 494 ms | 34.6 tok/s | 115 s / 240 s | 3,477 / 6,471 | process RSS peak 9.9 GB; whole-device GPU peak 100%; GPU allocation peak 11.5 GB |
| Home / minimal (`minimal-load@1.0.0`) | Firefox and VS Code | 24/30 | 24/30 | 2.1 s | 495 ms | 35.8 tok/s | 110 s / 232 s | 3,477 / 6,471 | process RSS peak 10.0 GB; whole-device GPU peak 100%; GPU allocation peak 11.0 GB |

The common failures were `change-mind` and `tool-choice` in all three repeats; their holdouts passed. The role failures were `misato:correct-rejected-time` and `misato:exact-reminder` in all three repeats; Casper passed 15/15. No condition changed an answer or critical outcome. Across the campaign, 180 case runs used 29,844 output tokens, within the approved 368,640-token ceiling. No case timed out and no stop rule fired.

Resource figures are sampled peaks, not guaranteed maxima. GPU counters are whole-device and include the desktop and competing apps; Apple unified-memory allocations overlap RAM and must not be added to it. Activity Monitor memory-pressure colour, swap used, AC-power confirmation, thermal state and the owner's perceived desktop impact were not present in the retained reports or supplied observations, so they remain unknown.

## Interpretation

Heavy competing work reduced generation throughput by about 18–21% versus moderate/minimal load and added roughly 7–9 seconds to cold model loading. Warm first-token latency stayed near 0.5 seconds, and functional outcomes were unchanged. This supports using the Mac route during ordinary moderate work and shows a measurable latency cost under the recorded heavy workload; it does not establish that the owner experienced no disruption, that overnight scheduling is acceptable, or that the model is qualified for the two consistently failing Misato tasks.

Placement P1 uses the moderate run as its Mac baseline. Mini-PC placements P2–P4, placement-specific inference/tools-test contention and Mac dependency recovery remain F-006-T21; this report does not substitute for them.
