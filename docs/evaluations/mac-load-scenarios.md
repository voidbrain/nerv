# Host load scenarios

9 November 2026; accepted planning scope, baseline `c743caa`. These are operating conditions for later measured campaigns, not additional task cases, qualified models, an automatic schedule or executed results. F-006-T05 owns the local Mac comparison; T04 owns eventual host placement. The first authorized Gemma smoke remains F-074-T02 with its existing scope and queue position.

## What already exists

Pinned Gauntlet0.2.0 supplies `examples/limits-day.json` and `limits-night.json`: execution budget presets, not measured office/home environments. Day is 30 seconds/case, 300 seconds/suite, ten cases, one repeat and 20,480 output tokens. Night is 120 seconds/case, 1,800 seconds/suite, ten cases, three repeats and 61,440 output tokens. Neither selects apps, observes owner sleep, changes host settings or proves task suitability.

## Mac: three representative conditions

| Condition | Owner's intended use | What to reproduce/record | Main question |
|---|---|---|---|
| Office / heavy competing load | Owner works with demanding work apps, calls, browser and possibly VMs | Representative real app categories and concurrent workload; actual measured memory/CPU/GPU pressure, available RAM and swap when observable | Can NERV remain useful without materially degrading interactive work? |
| Home / active / moderate competing load | Owner is awake and using the Mac for lighter tasks | Representative browser/media/editor activity, fewer demanding apps; measured pressure, not an assumed percentage | Is a larger context/model or a less constrained workflow useful at acceptable latency and desktop impact? |
| Home / overnight / minimal competing load | Owner sleeps while the Mac remains awake and available | Actual low competing load, power/thermal state and model residency; do not assume overnight makes the host idle | What work fits safely with minimal competition, within explicitly authorized unattended budgets? |

Location and time are labels for expected workload, not scheduling/security evidence. Keep the same Mac/hardware, exact model/quantization/runtime, prompts/scaffold, cases/grader, context/output/sampling/thinking, concurrency and total comparison budget across the three conditions. Use the existing day limits for an initial comparable slice; an intermediate numeric budget is unnecessary for the moderate-load condition. Observe realistic load rather than launching synthetic stress into the owner's active work. Do not infer one condition from another or label unknown pressure as low.

Use fresh telemetry (`--telemetry --fresh`; NERV model commands already enable telemetry) for each performance observation. Reused functional evidence is not a new load measurement. Record run ID/time, host/configuration and condition, provider load/prompt/generation/first-token timings, task/critical outcomes, measured token use, sampled RAM/process/whole-device GPU observations and sampler gaps. Swap/thermal/power or owner-observed desktop responsiveness may need separately recorded observations; unsupported metrics stay unknown. Preserve privacy by recording coarse app categories and workload descriptions, not window titles, messages, project content or personal identifiers. Results/evidence remain private unless reviewed for publication.

Current telemetry reports whole-device activity and sampled observations; it cannot attribute every slowdown to the model or establish guaranteed hardware peaks. The condition label and owner responsiveness observation are contextual evidence, not a new automatic admission mechanism. Later repeat comparable slices on different occasions if deciding a production placement; one pass establishes only its named observation.

Longer overnight budgets/repeats are a separate throughput/endurance experiment. Do not compare its larger total allowance directly with a short daytime pass as evidence of a load-only benefit. Finish the initial role smoke before selecting a multi-condition campaign; declare its targets, task selection, repeats and total time/token ceiling separately. This plan authorizes no additional model execution, downloads, app shutdown, OS sleep prevention, remote activation or production promotion. An absent owner does not waive approvals, grants, privacy or cancellation/recovery rules.

## Mini PC: one baseline

Owner clarification 9 November 2026: the mini PC stays at home without competing work apps; day/night are not materially different. Use one normal home baseline. Record actual background NERV work and measured resources rather than assuming zero load; do not clone the Mac's office/home/time matrix onto it.

Only vary workload when it answers a placement question: isolated specialist inference, tools/tests alone, or their combined NERV load if simultaneous operation is intended. Keep these bounded comparisons under T04's host-placement acceptance, not a permanent extra matrix. Mac inference availability still matters when the mini PC depends on it; that is a dependency/recovery test, not a mini PC night/day scenario. No remote-target campaign is enabled by this document.

## Additional checks worth keeping

- **Cold versus warm model residency**, reported within each measured condition. Use the runner's existing cold/warm observations; no extra unbudgeted warm-up. Initial presence is not proof disk/OS caches are cold.
- **Mac sleep, unavailability and wake**, when the mini PC depends on Mac inference. Verify waiting/expiry/reconnect and uncertain-effect reconciliation. Owner asleep and Mac asleep are different states; ordinary inference needs an available host.
- **Sustained thermal/memory pressure**, only when long overnight work is intended. A separately budgeted longer slice can expose degradation that a short smoke misses.

Battery versus mains is useful only if battery operation becomes an intended deployment mode; otherwise hold power mode constant initially. Avoid multiplying every condition by every model, role, host, context and sampling choice. Screen a bounded shortlist, then measure the configurations relevant to actual use.

Reconsider this plan when the owner's workload, hardware, inference/execution placement or measured contention changes. No full audit coverage, load result or model qualification is refreshed by documenting it.
