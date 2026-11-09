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

The importer validates canonical metadata; it does not yet read Codex, Claude, Gemini, Copilot or Qwen native logs. Their adapters are separately tested work. No universal token stream exists merely because every client reads the same instructions. Preserve raw source metadata privately; commit only deliberately reviewed neutral aggregates, without session identity, prompts, secrets or personal data.

## Client instruction entry points

AGENTS owns the rule. Claude's existing CLAUDE bridge imports it. Optional GEMINI.md, QWEN.md and `.github/copilot-instructions.md` bridges point to the same authority; merge them into existing client instructions when useful, preserving local rules. Verify the actual client's instruction loading and telemetry access in a neutral job; a filename is not proof that it loaded. ChatGPT/Codex tools with repository access can follow AGENTS; a chat-only session without repository/usage access needs an explicitly supplied task/metadata export and reports missing coverage.

These bridges request registration/import where available; they do not install exporters, scrape conversation history, enable prompt logging, discover credentials, guarantee compliance or provide live client acceptance. Exact source model/version and actual input/output/cache counters remain unknown until observed. No owner needs to predict which agent will eventually run a job for the job to register its observed identity.
