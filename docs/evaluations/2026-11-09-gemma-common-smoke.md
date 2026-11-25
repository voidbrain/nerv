# First common Gemma smoke review, 9 November 2026

Owner-provided private report `19a5b470-e87a-4400-a2e9-920404a797d2`; SHA256 `8b0ef91c5255499ea7c0574d05b89842f40c41b82999d81e0657a6155a99c946`. Reviewed with the installed Gauntlet0.3 `readEvidence` validator; engine/pack/profile hashes, all ten message-fixture hashes and requested settings match the pinned release. This is a derived review summary; the original full report remains private and unchanged. It has no NERV source identity because it is the reusable common model pack.

The campaign completed all ten cases: **7 passed,3 failed**; `complete:true`, `passed:false`, `promotion:false`, stable source and no timeout/not-run cases. Regression cases passed3/6; holdouts passed4/4. Every case is marked critical, so the overall failure is correct. No grader, expected answer or report was changed and no model was rerun for this review.

| Case | Split | Result | Recorded acceptance |
|---|---|---|---|
| exact-json | regression | passed | Exact expected result |
| change-mind | regression | failed | Invalid structured output |
| conflicting-request | regression | passed | Exact expected result |
| language-italian | regression | passed | Exact expected result |
| tool-choice | regression | failed | Invalid structured output |
| missing-input | regression | failed | Invalid structured output |
| holdout-change | holdout | passed | Exact expected result |
| holdout-approval | holdout | passed | Exact expected result |
| holdout-tool | holdout | passed | Exact expected result |
| holdout-language | holdout | passed | Exact expected result |

## Configuration and execution

- Pack: `neutral-smoke@1.1.0`, hash `c3c8b9332b7e1acb24381ed53413dea135e5249ba96271d0a650ea79c6e6be08`; protocol0.3.0, engine `f1ba32cb8a099b4483952da3b8a5d731eba6cbecde0878ad3f37f4c0036ec490`.
- Profile: `gemma4-12b-q4-8192`, hash `a1ec5ae0b74eeece57592f294d17d7e5e5c37989a5db6a4079fbd2f19a438f15`. Ollama `gemma4:12b`, Q4_K_M, context8192, output cap2048/case, seed42, thinking on, serial, suite residency, runtime sampling defaults. Requested model identity was established with provider metadata; digest `6114515d63c17436a7c0417d82820ac65ad643e2806c5a3c89cb62846436ed0b` and runtime `ollama:0.40.8`, Node26.12.0.
- Machine: Apple M3 Pro,36GiB unified memory, arm64 macOS. Scenario: owner-declared `moderate-load@1.0.0`; this is not independent proof of competing applications or power state.
- Actual report interval:16:48:37.428–16:49:42.172 UTC (17:48:37–17:49:42 Europe/Rome),64.744s. Limits30s/case,300s/suite, one repetition,20480 aggregate output tokens. Reported usage1608 output tokens; slowest case18.363s. All stay inside the requested limits; monetary cost is unmeasured.
- First call cold:5.648s model load,6.050s first-token time. Subsequent warm first-token median0.507s; decode throughput aggregated over reported output/generation time is about29.8 tokens/s. First-token timing includes thinking; output counts can include reasoning, so this is not a measure of user-visible prose speed.
- Sampled peak daemon/descendant RSS9.27GiB; whole-device GPU utilization99%, GPU allocation11.11GiB. These overlap unified RAM and must not be added together. RSS can double-count shared pages and GPU includes desktop/other apps. The separate model-allocation counter is provider-reported, not a verified total-memory measurement. No sampling errors; cumulative sampling collection time11.514s is reported; its actual added latency was not measured, so this is not an uninstrumented performance baseline.
- Residency cleanup reported `released`. No production tool was executed by these synthetic common cases.

## Interpretation and next evidence

The runner/report path worked and the run is useful measured failure evidence. The candidate did not pass structured-output acceptance on three prompts. In Gauntlet0.3's grader, `Invalid structured output` specifically means `JSON.parse(message.content)` failed. The report retains response hashes, not raw response text, so it cannot distinguish prose, Markdown fences, empty content or another syntax problem. It does not establish why those prompts failed or that changing load/thinking would fix them. Do not loosen parsing or expected results based on this run.

The small common corpus does not qualify NERV's Misato/Casper roles, coder/auditor combinations, execution isolation or end-to-end integration. Failed evidence is not a reusable passing cache entry or a promotion. F-074-T02's requested first campaign is completed and reviewed; F-074-T04 retains the missing profile-matched NERV role workflow. Any later performance comparison must retain this failed result, declare actual load, use fresh evidence and preserve an explicit budget. No additional run is required merely to get a green score. Human observations of desktop responsiveness, memory pressure/swap and actual competing apps were not supplied with this report and remain unknown.
