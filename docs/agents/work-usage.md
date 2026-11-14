# Development job usage

Optional metadata accounting, enabled by `workUsage.enabled` in `.harness.json`. The shared rule is "In short" below; AGENTS routes here. It applies to any agent that has actually loaded repository instructions and can run local tools. It does not configure a client, expose hidden counters or replace execution permissions. API/model identity, task owner and client name are separate fields; owner assignment before launch is optional unless task suitability requires it.

Moved to [usage sources](work-usage-sources.md): "Subscription allowance snapshots", "Save a private report", "Selected native metadata adapters", "Import actual counters".

Moved to [effectiveness observations](work-usage-effectiveness.md): "Effectiveness observations (optional)".

## In short

When `.harness.json` enables `workUsage.enabled`, follow this guide at each job start, phase change and completion. Record actual client/model and backlog/task identity, import authorized metadata counters when exposed, and retain unknown coverage otherwise. Keep token metadata private and separate from prompts, credentials and conversation text. A model/client assignment need not be declared by the owner before launch unless task suitability requires it; instruction loading and measured usage availability still require verification.

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

## Client instruction entry points

AGENTS owns the rule. Claude's existing CLAUDE bridge imports it. Optional GEMINI.md, QWEN.md and `.github/copilot-instructions.md` bridges point to the same authority; merge them into existing client instructions when useful, preserving local rules. Verify the actual client's instruction loading and telemetry access in a neutral job; a filename is not proof that it loaded. ChatGPT/Codex tools with repository access can follow AGENTS; a chat-only session without repository/usage access needs an explicitly supplied task/metadata export and reports missing coverage.

These bridges request registration/import where available; they do not install exporters, scrape conversation history, enable prompt logging, discover credentials, guarantee compliance or provide live client acceptance. Exact source model/version and actual input/output/cache counters remain unknown until observed. No owner needs to predict which agent will eventually run a job for the job to register its observed identity.

## Step reports and linked evidence

Use the stable child task ID for attributable jobs. `report --task=F-048-T02` filters jobs before aggregation; an optional item filter must match its parent. `byTask` groups by repository plus task ID, keeping feature-only jobs in a separately labelled `ITEM:unassigned` group. Feature totals count every distinct source event once; the step groups partition the same jobs/events, including unknown/empty-job coverage. Two repositories with the same step ID stay separate. No existing feature-only job is retrospectively assigned to a step.

Keep work-session, verification and review evidence linked from its task validation/parent evidence. This ledger stores permitted usage metadata only; it does not collect operational service logs, test transcripts or review conversation text. Link relevant acceptance evidence under existing privacy rules. Missing native adapters, usage counters or source coverage remain explicit, not zero.

## Explicit prelaunch registration

Optionally adopt `tools/usage-launch.mjs` and `work:launch`. Invoke `node tools/usage-launch.mjs --repository=project-harness --item=F-048 --task=F-048-T02 --agent=CLIENT -- executable arguments`. It registers before starting the exact supplied command, inherits normal permissions and stdio, and passes `HARNESS_USAGE_JOB` and `HARNESS_USAGE_STORE`. It never stores command text or captures a transcript. The caller must already be authorized to run that command; this helper is not a model-run grant, sandbox or background hook.

`start` and the launcher accept optional `--parent=JOB_UUID` for an open same-repository parent. Read the child's stored parent identity for handoff; do not reuse a parent's event IDs/counters. Finish retains command failure/interruption and declares coverage unavailable because process success alone cannot prove telemetry coverage. Registration failure prevents launch. External host/client integration owns metadata extraction, actual instruction loading and signal/process supervision. An already running agent cannot retrospectively obtain prelaunch coverage from this helper; ordinary available job registration remains required.
