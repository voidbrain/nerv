# Rule review

Read before you measure friction, rerun the agent-behaviour checks or consolidate rules. Moved from [maintenance](maintenance.md) unchanged (F-076).

## Measure actual friction

Measurement is local, not background telemetry. Adoption/reconciliation starts with `node tools/friction.mjs start --operation=reconciliation` and ends with `node tools/friction.mjs finish` plus any observed counters. Elapsed wall-clock time is calculated automatically, including waits; retain that boundary when comparing samples. Start refuses to overwrite a running session; finish refuses a supplied duration. Counters require actual observation and remain unknown if not supplied. Record/finish summaries carry latest observation time; a review requires a recent measurement. Legacy `record` remains for explicitly observed historical durations, never guessed ones. Time an adoption or reconciliation from reading its applicable rules through validation, with pauses/excluded work stated in the owning record. Record only observed duration and counters:

```bash
node tools/friction.mjs record --operation=reconciliation --duration-ms=120000 --conflicts=1 --unnecessary-prompts=0 --repeated-context-loads=2
node tools/friction.mjs report
```

The numbers above are examples, not a baseline. Omitted counters are unknown, never zero. Define a conflict as a file requiring manual resolution; count an unnecessary prompt only after reviewing why existing authorization sufficed; count a repeated context load only when unchanged material was reread unnecessarily. Distinguish deliberate rule refreshes from waste. Use consistent start/end boundaries and note unusual task scope in the owning backlog evidence, not in the numeric log.

`.harness/friction.jsonl` is append-only local data, ignored by default. It contains operation, timestamp, observed duration and optional counts only; no prompt/source text, identity or credentials. Report sample counts, missing values and medians separately for adoption/reconciliation. Do not compare incomparable scopes, turn estimates into observations, infer token usage from reads, or claim a productivity gain from one sample. Share aggregates deliberately, never upload automatically. A summary is diagnostic evidence, not a CI gate or completion score.

## Periodic rule consolidation

At an audit and after a repeated procedural conflict or significant workflow change, review the affected rule set for duplicates, contradictions, obsolete assumptions and unnecessary repeated reading. The authoritative owner remains AGENTS, BACKLOG-RULES, APPLY or the appropriate area/style guide.

For each proposed consolidation record old locations, the requirement they enforce, new owner/location, preserved exceptions, why the text is redundant/obsolete, and the check establishing no requirement was lost. Replace duplicate normative text with a short pointer where useful. Explicitly preserve applicable rules from session start. Update every affected summary, template/adapted copy and test in the same change; generic changes release upstream before projects adopt them. If deletion changes behavior, treat it as a policy change with its own acceptance, not editorial cleanup.

Age, rare use and no recent incident do not justify deleting ownership, evidence, privacy or safety safeguards. Do not automatically expire rules or create an empty review artifact on every edit. Track actual unresolved findings/outcomes; completed scoped reviews can record no changes with inspected scope and reasons. Session checks, PR CI and the daily read-only workflow enforce freshness. The agent closes the loop on findings: inspect evidence, produce justified rule/tool/skill improvements, test in the owning repository and submit a normal PR, or record an owned backlog/no-change outcome. Candidate suggestions from conflict/prompt/reload medians are diagnostics, not semantic conclusions or authority to rewrite policy unattended.

## Agent-behaviour checks

Tools check records and files; `tools/behaviour.mjs` checks whether an agent following this project's AGENTS.md and BACKLOG-RULES behaves as they say. Each scenario builds a fixture repository from the project's own rule files (`behaviour.rules` maps fixture paths to sources), gives the agent one task and grades the result without a model: files, records, commits, the remote and the transcript. `node tools/behaviour.mjs list` names the scenarios and the rule each one tests.

The runner is the project's choice, set in `.harness.json` `behaviour.runner`: a shell command run in the fixture repository with the task in `$HARNESS_TASK_FILE`, whose output is the transcript, so it should print the agent's final reply rather than tool logs (for example `claude -p "$(cat "$HARNESS_TASK_FILE")"` with the permissions the owner allows for a throwaway fixture). The fixture lives in a temporary folder with a local bare remote; give the runner no credentials or network access it does not need. `npm run behaviour -- run` runs each scenario `behaviour.times` times (3 by default) and reports passes per scenario, never only a total; `--scenarios=a,b` narrows it and `--keep` leaves the fixtures for inspection. A runner that fails to start, exits non-zero or times out (`behaviour.timeoutMs`, 20 minutes by default; its whole process group is stopped) counts as a failed run, never as a graded one.

Run it on demand and when the rule files it copies change (AGENTS.md, CLAUDE.md, BACKLOG-RULES: an impact-map row), never on every PR by default: each run costs agent time. Compare each scenario with its last run. A scenario that starts failing is a backlog record, with the report as evidence. A mistake seen in real work or an audit finding becomes a new scenario: a fixture, a task and a grader that reads the result. A pass shows the agent followed the rule in that fixture, not in every situation.
