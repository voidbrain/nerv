# NERV host assignments and load acceptance

9 November2026; supersedes the consumer-only definition placement from PR234 (baseline4f74ab2). Reusable machine/scenario schemas, examples, CLI inspection and evidence identity now belong to [Gauntlet0.3 environments](https://github.com/voidbrain/gauntlet-protocol/blob/v0.3.0/docs/ENVIRONMENTS.md). NERV references the released package rather than redefining them. This document owns NERV's assignments, deployment questions and acceptance; no live load/model campaign has run for it.

## Assignment map

| NERV deployment condition | Shared scenario | NERV acceptance question |
|---|---|---|
| Mac at office with demanding work apps | `heavy-load` | Does the selected role remain useful without materially degrading owner work? |
| Mac at home while owner uses lighter apps | `moderate-load` | Does the role fit the owner's latency and desktop responsiveness needs? |
| Mac at home while owner sleeps, host awake and available | `minimal-load` | Does approved unattended work fit its explicit time/token and safety bounds? |
| Home mini PC without unrelated work apps | `baseline-load` | Does its assigned inference/tool workload fit its measured resources? |

Scenario files are `node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/<id>.json`. These are generic definitions, not measured load labels or schedules. Private machine profiles are generated/reviewed on the selected local evaluation host using `node tools/gauntlet.mjs machine --id=<owner-label>`. No hostname, serial, work-window content or credentials are added to repository files. Local machine compatibility is not remote enrolment/trust; enrolled target execution and data privacy remain NERV decisions.

NERV plans accept `--machine-profile=<private-file> --scenario=<shared-file>` together, returning `environmentVerified:false`. Runs additionally require `--confirm-scenario` and existing execution/model/cost opt-ins. Confirmation is an owner declaration about current workload/power, not automatic stress detection. The library verifies local hardware compatibility before metadata/cache/runner execution; unsupported remote execution identity must remain explicit. No NERV permission, grant or promotion follows from a shared result.

## Planned acceptance, not new qualification

F-006-T05 owns future local Mac comparisons after F-074-T02's bounded initial smoke. Hold model/runtime/settings/cases/grader and total budget equal across the three conditions, record actual contention and owner desktop impact, and use fresh telemetry for new performance observations. Unknown pressure, swap/thermal/power or responsiveness data stays unknown. The shared protocol owns the measurement limitations and identity rules; NERV owns whether the observed scope meets a role's needs.

F-006-T04 owns eventual host placement. The mini PC has one normal baseline, not repeated day/night scenarios; vary inference/tools-test contention only if simultaneous NERV work is intended. When it depends on Mac inference, test Mac sleep/unavailability/wake as dependency recovery, preserving waits/expiry/leases and uncertain effects. Owner asleep and host asleep are different states.

Cold/warm residency and separately budgeted sustained-load checks are orthogonal dimensions. Battery mode is relevant only if intended; otherwise hold power constant. Screen useful configurations rather than multiplying every machine/scenario/model/role/context. Select exact cases/repeats and aggregate time/token budgets before a live campaign. This adoption does not expand the authorized Gemma smoke, start models, download weights, close apps, prevent sleep, activate remote services or schedule unattended work.

## Sharing results and usage

NERV's wrapper forwards upstream environment context unchanged. Common model evidence has no NERV source dependency and can serve another authorized consumer for the same complete configuration/context and freshness contract. Different machine/scenario or unscoped reports cannot substitute for a requested condition. Source-specific system reports still bind NERV's actual source/adapter. Reuse retains original dates and `performanceMeasuredNow:false`; one idle observation does not establish active-load performance.

Development token spend by item/job/activity is separate work under [project-harness F-048](https://github.com/voidbrain/project-harness/blob/main/docs/BACKLOG.md#f-048). Gauntlet retains evaluation-run usage, NERV retains runtime usage, and future imports must avoid counting the same provider event twice. No measured phase breakdown of this development session is available or inferred.

## First available observation, 9 November 2026

The [first common Gemma smoke review](2026-11-09-gemma-common-smoke.md) records one owner-declared moderate-load Mac run:10 cases executed,7 passed/3 JSON parse failures,64.744s/1608 output tokens. Human responsiveness, competing-app details, power state and swap/pressure observations remain unavailable. This is a single common-pack observation, not the comparative F-006-T05/T04 campaign or NERV role/host qualification. No repeat or new load budget is implied.

Harness4.4.1 generic job registration/metadata ledger is adopted in NERV; native client counter adapters remain project-harness F-048-T02. Phase annotations are not measured token splits. Gauntlet0.4 private diagnostics are available for a separately selected focused run; no low-load or overnight campaign was launched by adoption.
