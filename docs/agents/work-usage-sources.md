# Usage sources

Read before you import usage counters, allowance snapshots or native metadata, or save a usage report. Moved from [work-usage](work-usage.md) unchanged (F-076).

## Subscription allowance snapshots

Subscription allowance is a separate account-level signal from tokens and currency. Codex collection makes one read-only `account/rateLimits/read` request through the installed CLI app server; it does not invoke a model, change login/account state or expose credentials:

```bash
node tools/work-usage.mjs collect-codex --job=JOB_UUID
```

Omit `--job` for an unassigned account observation. The collector stores only documented percentages, window lengths and reset times. A linked job permits a qualified before/after comparison, but account activity may include other clients or people, so the report labels the change as shared-account metadata rather than exact task usage.

Claude Code exposes Pro/Max allowance percentages in its documented status-line JSON after the first API response. Configure the status-line command deliberately in the relevant Claude settings, composing it with any existing status line instead of overwriting one:

```json
{"statusLine":{"type":"command","command":"node /absolute/path/to/tools/work-usage.mjs claude-status --store=/absolute/private/store --source=claude-statusline"}}
```

The command reads the JSON payload on stdin, persists only `rate_limits.five_hour` and `rate_limits.seven_day`, and prints a short percentage line. Session ID, transcript path, cost fields and all other input are discarded. Before rate-limit fields exist it prints `Claude allowance unavailable`. Use `--job=JOB_UUID` when the status-line process inherits a known active job. Identical observations within five minutes for the same job/source are coalesced to avoid status refresh spam; changed counters and later boundary samples remain immutable.

For reviewed fixtures or another authorized adapter, `allowance --format=normalized|codex-rate-limits --file=/private/metadata.json [--job=JOB_UUID]` imports a bounded file. Normalized records require a stable event ID, provider, observation time and explicit buckets. Do not point any allowance command at transcripts, credential stores or arbitrary logs.

`report` includes allowance history and conservative changes only when provider/bucket/reset identity is stable and the percentage does not decrease. A reset/decrease is a boundary, not negative consumption. It never converts subscription percentage into tokens, API price, a fixed subscription charge or an automatic backlog estimate.

## Save a private report

`report` still prints JSON. Add `--out=/absolute/private/report.json` to also save exactly that JSON as a new mode-0600 file. The parent directory must be private and outside every checkout; symlinks and overwrite are refused. A report snapshot is output, not an import format, so saving it cannot double-count ledger events.

The `calibration.completedWork` groups successfully completed (`done`) jobs by repository/task and reports sample size, elapsed range and complete token samples when available; failed and interrupted attempts remain in effectiveness reporting, not this comparison pool. `calibration.allowanceSamples` requires stable provider, source, bucket, window length and reset identity, and names jobs whose lifetimes overlap the observation interval. Compare scope, model/client configuration, overlap and source coverage manually; the tool does not recommend or rewrite estimates.

## Import actual counters

Import one bounded JSON metadata delta per provider request. Only the listed fields are accepted; transcript, prompt, credentials and arbitrary extra fields are rejected. The source must supply stable IDs. Cumulative snapshots require an authorized source adapter to compute deltas; importing them as individual calls would double count and is unsupported.

```json
{"version":1,"kind":"delta","source":"runner-fixture","eventId":"request-1","activity":"coding","provider":null,"model":null,"inputTokens":100,"outputTokens":20,"cacheReadTokens":70,"cacheWriteTokens":10,"reasoningTokens":5}
```

Canonical input includes cache-read and cache-write tokens; canonical output includes reasoning. These are subsets, not extra spend. A provider with different definitions needs explicit normalization with retained source provenance; otherwise use null for unavailable metrics. Reports show known subtotals, missing metrics, declared job coverage and activity/model splits. They do not infer currency cost, subscription credits, remaining complexity or queue priority. Source/event identity is unique across jobs in the selected store; duplicate identical imports are idempotent, changed or differently assigned duplicates are rejected. Keep sources in one store to obtain this deduplication boundary.

The importer validates canonical metadata and the selected metadata-only Codex/Claude formats below. It does not read native transcript/log files. Gemini, Copilot and Qwen require separately reviewed adapters; no exporter is installed. No universal token stream exists merely because every client reads the same instructions. Preserve raw source metadata privately; commit only deliberately reviewed neutral aggregates, without session identity, prompts, secrets or personal data.

## Selected native metadata adapters

`import --format=codex-turn --job=JOB_UUID --file=/private/metadata.json` accepts a strict envelope: `version:1`, stable `source`, stable `eventId`, `activity`, `provider`, nullable `model`, and `event:{type:"turn.completed",usage:{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens}}`. Usage fields may be absent/null; missing values remain unknown. Input already includes cached input; cache-write is unavailable. The host exporter owns stable turn IDs and must not reuse cumulative thread totals as deltas.

`import --format=claude-message` accepts `version:1`, stable `source`, `activity`, `provider`, `complete:true`, and `event:{type:"assistant",message:{id,model,usage:{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}}}`. Native message ID is the event ID, so repeated assistant/tool blocks count once. Canonical input is the sum of the three disjoint input categories only when all are known; reasoning remains unknown. A complete final per-request usage export is required. Cumulative result/session totals and partial messages are refused. Models supplied by exports are observed labels, not authentication.

Both formats refuse content/prompt/extra fields. Supply only an authorized metadata export; do not pass a transcript or raw mixed event stream. Replay is idempotent only for an identical event assigned to the same job; a changed/reassigned event is refused. Preserve failed request/retry identities even when only partial counters are available. Sources without safe deltas remain unsupported/unknown rather than silently estimated.
