# Development job usage

Optional metadata accounting, enabled by `workUsage.enabled` in `.harness.json`. The shared rule is in AGENTS. It applies to any agent that has actually loaded repository instructions and can run local tools. It does not configure a client, expose hidden counters or replace execution permissions. API/model identity, task owner and client name are separate fields; owner assignment before launch is optional unless task suitability requires it.

## Start, label and finish

Start one job at an independently attributable task boundary, before its model work when the host supports that boundary. Record the actual agent and model; omit model when unexposed. Keep a continuing debugging/review/CI job coherent. A phase annotation alone does not split a provider turn's tokens. Mixed turns use an explicit source mapping or remain `unallocated`; repeated attribution to several items is refused.

```sh
node tools/work-usage.mjs start --repository=project-harness --item=F-048 --task=F-048-T01 --agent=codex --activity=coding
# Copy the actual job UUID returned above, then use that UUID:
node tools/work-usage.mjs phase --job=JOB_UUID --activity=review
node tools/work-usage.mjs import --job=JOB_UUID --file=/private/path/usage-metadata.json
node tools/work-usage.mjs finish --job=JOB_UUID --coverage=partial --outcome=done
node tools/work-usage.mjs report --repository=project-harness --item=F-048
node tools/work-usage.mjs report --repository=project-harness --item=F-048 --task=F-048-T02
```

Activities: planning, coding, tests, review, documentation, backlog, harness and unallocated. Test execution itself is not model-token spend: import only model work used to prepare, run or interpret it. Count failed/retried model calls with their distinct source event IDs. Waiting time and tool calls do not establish token counts. Register a shared job with `--item=unallocated` when ownership cannot be attributed without guessing.

The default store is outside the checkout at `~/.local/state/project-harness/work-usage`; `--store` selects another private local directory. POSIX directories/files use0700/0600 and exclusive creation; linked stores and stores inside the current checkout are rejected. Windows private-ACL verification is not implemented: record measurement as unavailable and continue authorized work. This is local storage, not a same-user security sandbox. No export, network collection, host startup hook or model call occurs. Identity and event labels are owner-supplied metadata, not authenticated provider proof.

If the host/tool is unavailable, keep the source coverage unknown and state that limitation in the owning work record. Do not block unrelated authorized work or manufacture a count. End the job with complete, partial or unavailable coverage and done, failed or interrupted outcome. A complete declaration is an attestation about source coverage, not an independently verified audit. Empty or unknown measurements do not become a zero total.

## Import actual counters

Import one bounded JSON metadata delta per provider request. Only the listed fields are accepted; transcript, prompt, credentials and arbitrary extra fields are rejected. The source must supply stable IDs. Cumulative snapshots require an authorized source adapter to compute deltas; importing them as individual calls would double count and is unsupported.

```json
{"version":1,"kind":"delta","source":"runner-fixture","eventId":"request-1","activity":"coding","provider":null,"model":null,"inputTokens":100,"outputTokens":20,"cacheReadTokens":70,"cacheWriteTokens":10,"reasoningTokens":5}
```

Canonical input includes cache-read and cache-write tokens; canonical output includes reasoning. These are subsets, not extra spend. A provider with different definitions needs explicit normalization with retained source provenance; otherwise use null for unavailable metrics. Reports show known subtotals, missing metrics, declared job coverage and activity/model splits. They do not infer currency cost, subscription credits, remaining complexity or queue priority. Source/event identity is unique across jobs in the selected store; duplicate identical imports are idempotent, changed or differently assigned duplicates are rejected. Keep sources in one store to obtain this deduplication boundary.

The importer validates canonical metadata and the selected metadata-only Codex/Claude formats below. It does not read native transcript/log files. Gemini, Copilot and Qwen require separately reviewed adapters; no exporter is installed. No universal token stream exists merely because every client reads the same instructions. Preserve raw source metadata privately; commit only deliberately reviewed neutral aggregates, without session identity, prompts, secrets or personal data.

## Client instruction entry points

AGENTS owns the rule. Claude's existing CLAUDE bridge imports it. Optional GEMINI.md, QWEN.md and `.github/copilot-instructions.md` bridges point to the same authority; merge them into existing client instructions when useful, preserving local rules. Verify the actual client's instruction loading and telemetry access in a neutral job; a filename is not proof that it loaded. ChatGPT/Codex tools with repository access can follow AGENTS; a chat-only session without repository/usage access needs an explicitly supplied task/metadata export and reports missing coverage.

These bridges request registration/import where available; they do not install exporters, scrape conversation history, enable prompt logging, discover credentials, guarantee compliance or provide live client acceptance. Exact source model/version and actual input/output/cache counters remain unknown until observed. No owner needs to predict which agent will eventually run a job for the job to register its observed identity.

## Step reports and linked evidence

Use the stable child task ID for attributable jobs. `report --task=F-048-T02` filters jobs before aggregation; an optional item filter must match its parent. `byTask` groups by repository plus task ID, keeping feature-only jobs in a separately labelled `ITEM:unassigned` group. Feature totals count every distinct source event once; the step groups partition the same jobs/events, including unknown/empty-job coverage. Two repositories with the same step ID stay separate. No existing feature-only job is retrospectively assigned to a step.

Keep work-session, verification and review evidence linked from its task validation/parent evidence. This ledger stores permitted usage metadata only; it does not collect operational service logs, test transcripts or review conversation text. Link relevant acceptance evidence under existing privacy rules. Missing native adapters, usage counters or source coverage remain explicit, not zero.

## Selected native metadata adapters

`import --format=codex-turn --job=JOB_UUID --file=/private/metadata.json` accepts a strict envelope: `version:1`, stable `source`, stable `eventId`, `activity`, `provider`, nullable `model`, and `event:{type:"turn.completed",usage:{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens}}`. Usage fields may be absent/null; missing values remain unknown. Input already includes cached input; cache-write is unavailable. The host exporter owns stable turn IDs and must not reuse cumulative thread totals as deltas.

`import --format=claude-message` accepts `version:1`, stable `source`, `activity`, `provider`, `complete:true`, and `event:{type:"assistant",message:{id,model,usage:{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}}}`. Native message ID is the event ID, so repeated assistant/tool blocks count once. Canonical input is the sum of the three disjoint input categories only when all are known; reasoning remains unknown. A complete final per-request usage export is required. Cumulative result/session totals and partial messages are refused. Models supplied by exports are observed labels, not authentication.

Both formats refuse content/prompt/extra fields. Supply only an authorized metadata export; do not pass a transcript or raw mixed event stream. Replay is idempotent only for an identical event assigned to the same job; a changed/reassigned event is refused. Preserve failed request/retry identities even when only partial counters are available. Sources without safe deltas remain unsupported/unknown rather than silently estimated.

## Explicit prelaunch registration

Optionally adopt `tools/usage-launch.mjs` and `work:launch`. Invoke `node tools/usage-launch.mjs --repository=project-harness --item=F-048 --task=F-048-T02 --agent=CLIENT -- executable arguments`. It registers before starting the exact supplied command, inherits normal permissions and stdio, and passes `HARNESS_USAGE_JOB` and `HARNESS_USAGE_STORE`. It never stores command text or captures a transcript. The caller must already be authorized to run that command; this helper is not a model-run grant, sandbox or background hook.

`start` and the launcher accept optional `--parent=JOB_UUID` for an open same-repository parent. Read the child's stored parent identity for handoff; do not reuse a parent's event IDs/counters. Finish retains command failure/interruption and declares coverage unavailable because process success alone cannot prove telemetry coverage. Registration failure prevents launch. External host/client integration owns metadata extraction, actual instruction loading and signal/process supervision. An already running agent cannot retrospectively obtain prelaunch coverage from this helper; ordinary available job registration remains required.

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
