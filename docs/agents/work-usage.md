# Development job usage

Optional metadata accounting, enabled by `workUsage.enabled` in `.harness.json`. The shared rule is "In short" below; AGENTS routes here. It applies to any agent that has actually loaded repository instructions and can run local tools. It does not configure a client, expose hidden counters or replace execution permissions. API/model identity, task owner and client name are separate fields; owner assignment before launch is optional unless task suitability requires it.

Moved to [usage sources](work-usage-sources.md): "Subscription allowance snapshots", "Save a private report", "Selected native metadata adapters", "Import actual counters".

Moved to [client launch](work-usage-launch.md): "Client instruction entry points", "Explicit prelaunch registration". Read it before you set up a client bridge or launch an agent through `work:launch`.

Moved to [effectiveness observations](work-usage-effectiveness.md): "Effectiveness observations (optional)".

## In short

When `.harness.json` enables `workUsage.enabled`, follow this guide at each job start, phase change and completion. Record actual client/model and backlog/task identity, import authorized metadata counters when exposed, and retain unknown coverage otherwise. Keep token metadata private and separate from prompts, credentials and conversation text. A model/client assignment need not be declared by the owner before launch unless task suitability requires it; instruction loading and measured usage availability still require verification.

## Start, label and finish

Start one job at an independently attributable task boundary, before its model work when the host supports that boundary. Record the actual agent and model; omit model when unexposed. Keep a continuing debugging/review/CI job coherent. A phase annotation alone does not split a provider turn's tokens. Mixed turns use an explicit source mapping or remain `unallocated`; repeated attribution to several items is refused.

```sh
node tools/work-usage.mjs start --repository=project-harness --item=F-048 --task=F-048-T01 --agent=codex --activity=coding
# Copy the actual job UUID returned above, then use that UUID:
node tools/work-usage.mjs phase --job=JOB_UUID --activity=review
node tools/work-usage.mjs pause --job=JOB_UUID --from=2026-01-01T10:00:00Z --to=2026-01-01T13:00:00Z
node tools/work-usage.mjs import --job=JOB_UUID --file=/private/path/usage-metadata.json
node tools/work-usage.mjs finish --job=JOB_UUID --coverage=partial --outcome=done
node tools/work-usage.mjs report --repository=project-harness --item=F-048
node tools/work-usage.mjs report --repository=project-harness --item=F-048 --task=F-048-T02
```

Activities: planning, coding, tests, review, documentation, backlog, harness and unallocated. Test execution itself is not model-token spend: import only model work used to prepare, run or interpret it. Count failed/retried model calls with their distinct source event IDs. Waiting time and tool calls do not establish token counts. When the agent could not run (a usage or allowance limit, the owner away), record the pause on resuming with `pause`, from the last work before the stop to the resume, in UTC or with an offset; it may be added to a finished job; a stop that hit several running jobs is recorded on each. When finishing a job, run `report` and check `suggestedPauses` on the job (100 % allowance buckets and idle gaps over `workUsage.pauseGapMinutes`, default 15); a suggestion is never subtracted until confirmed with `pause`. Reports subtract recorded pauses from the effective elapsed time; reviews and CI waits stay counted. Register a shared job with `--item=unallocated` when ownership cannot be attributed without guessing.

The default store is outside the checkout at `~/.local/state/project-harness/work-usage`; `--store` selects another private local directory. POSIX directories/files use0700/0600 and exclusive creation; linked stores and stores inside the current checkout are rejected. Windows private-ACL verification is not implemented: record measurement as unavailable and continue authorized work. This is local storage, not a same-user security sandbox. No export, network collection, host startup hook or model call occurs. Identity and event labels are owner-supplied metadata, not authenticated provider proof.

If the host/tool is unavailable, keep the source coverage unknown and state that limitation in the owning work record. Do not block unrelated authorized work or manufacture a count. End the job with complete, partial or unavailable coverage and done, failed or interrupted outcome. A complete declaration is an attestation about source coverage, not an independently verified audit. Empty or unknown measurements do not become a zero total.

## Step reports and linked evidence

Use the stable child task ID for attributable jobs. `report --task=F-048-T02` filters jobs before aggregation; an optional item filter must match its parent. `byTask` groups by repository plus task ID, keeping feature-only jobs in a separately labelled `ITEM:unassigned` group. Feature totals count every distinct source event once; the step groups partition the same jobs/events, including unknown/empty-job coverage. Two repositories with the same step ID stay separate. No existing feature-only job is retrospectively assigned to a step.

Keep work-session, verification and review evidence linked from its task validation/parent evidence. This ledger stores permitted usage metadata only; it does not collect operational service logs, test transcripts or review conversation text. Link relevant acceptance evidence under existing privacy rules. Missing native adapters, usage counters or source coverage remain explicit, not zero.
