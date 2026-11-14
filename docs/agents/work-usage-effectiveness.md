# Effectiveness observations

Read before you record an effectiveness observation. Moved from [work-usage](work-usage.md) unchanged (F-076).

## Effectiveness observations (optional)

`node tools/work-usage.mjs observe --job=JOB_UUID --file=/private/observation.json` appends explicit metadata, including to a finished job. Every observation has `version:1`, stable `source`, stable `eventId` and `kind`. It shares the usage event identity boundary: identical same-job replay is idempotent; changed/reassigned identities are refused. Extra fields, transcripts and arbitrary event kinds are refused. No record is overwritten. Source labels and timestamps are supplied metadata, not authenticated proof.

| Kind | Additional fields | Meaning |
|---|---|---|
| `estimate` | `at` ISO timestamp, `measure` (`elapsedMs`, `activeMs`, `inputTokens`, `outputTokens`), nonnegative integer `lower`/`upper`, positive `revision`, short `basis` | Immutable source estimate and assumptions; retain every revision. |
| `interval` | `category` (`execution`, `wait`, `active`), ISO `start`/`end` | Explicitly measured interval within job boundaries. |
| `attempt` | `result` (`succeeded`, `failed`, `interrupted`), `failureKind` (`code`, `infrastructure`, `unknown`, or null) | Observed attempts/retries with distinct IDs; successful attempts require null failure kind. |
| `finding` | `classification` (`review`, `confirmed-regression`, `unverified-suspicion`) | Keep different evidence classes separate. |
| `intervention` | `category` (`scope`, `clarification`, `approval`, `recovery`), nullable nonnegative integer `durationMs` | Explicit human intervention; never infer it from conversation text. |
| `state` | `value` (`reopened`, `reworked`) | Retain observed rework history without changing backlog status. |
| `price` | `usageSource`, `usageEventId`, `currency`, ISO `at`, public HTTPS `rateSource`, `rates:{input,cacheRead,cacheWrite,output}` | Supplied per-million-token rates for one existing same-job event; nullable rates retain unknown coverage. |

Supported currency labels: USD, EUR, GBP, JPY, CAD, AUD, CHF. They remain separate; there is no exchange-rate conversion. A price source cannot contain credentials/query/fragment. Rates are bounded finite nonnegative numbers, not a billing claim. One immutable rate observation per usage-event/currency is allowed; a conflicting concurrent price is detected at report time and requires reconciliation rather than double counting. Missing input/cache/output counts or rates leave that event's estimate unknown. Cache and reasoning are never charged twice; actual subscription cost/quota is not inferred. This is not a billing system and imports no live price table.

Feature and step reports add `effectiveness`, retaining observation provenance and source coverage. Closed-job elapsed wall time is the union of its intervals, so parallel jobs do not double wall-clock time. Open jobs are censored and listed separately. Measured execution, wait and active intervals have their own unions; measured worker active effort sums each job’s active union and is labelled separately. Partial active intervals cannot establish full active effort or a complete estimate comparison. Missing intervals/classifications/durations/rates mean unknown, never zero. Counts describe the explicit sample only, not the absence of other failures or interventions.

Estimate comparisons require matching units and a source timestamp no later than that job's start. Later revisions stay visible but are excluded from the pre-work baseline. Closed elapsed or complete-source token totals can be compared; incomplete sources and active-effort subtotals stay unavailable for full comparison. A timestamp supplied after the fact is an attestation, not proof of pre-work capture. Compare task scope/configuration and retain sample sizes before drawing conclusions. Reports provide cautious batch guidance alongside existing priority/prerequisites/human decisions; observed spend never determines remaining complexity, automatic ranking, blame or execution authority.
