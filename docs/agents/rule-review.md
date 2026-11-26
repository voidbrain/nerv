# Rule review

Read before you measure friction or consolidate rules; the agent-behaviour checks have their own page, [behaviour checks](behaviour-checks.md). Moved from [maintenance](maintenance.md) unchanged (F-076).

## Measure actual friction

Measurement is local, not background telemetry. Adoption/reconciliation starts with `node tools/friction.mjs start --operation=reconciliation` and ends with `node tools/friction.mjs finish` plus any observed counters. Elapsed wall-clock time is calculated automatically, including waits; retain that boundary when comparing samples. Start refuses to overwrite a running session; finish refuses a supplied duration. Counters require actual observation and remain unknown if not supplied. Record/finish summaries carry latest observation time; a review requires a recent measurement. Legacy `record` remains for explicitly observed historical durations, never guessed ones. Time an adoption or reconciliation from reading its applicable rules through validation, with pauses/excluded work stated in the owning record. Record only observed duration and counters:

```bash
node tools/friction.mjs record --operation=reconciliation --duration-ms=120000 --conflicts=1 --unnecessary-prompts=0 --repeated-context-loads=2
node tools/friction.mjs report
```

The numbers above are examples, not a baseline. Omitted counters are unknown, never zero. Define a conflict as a file requiring manual resolution; count an unnecessary prompt only after reviewing why existing authorization sufficed; count a repeated context load only when unchanged material was reread unnecessarily. Distinguish deliberate rule refreshes from waste. Use consistent start/end boundaries and note unusual task scope in the owning backlog evidence, not in the numeric log.

`.harness/friction.jsonl` is append-only local data, ignored by default. It lives in the primary checkout, so samples recorded in any worktree are shared and survive its removal; a running `start` session stays in its own worktree. A project below its repository's top level, a submodule and a worktree of a bare repository keep the log under their own root. It contains operation, timestamp, observed duration and optional counts only; no prompt/source text, identity or credentials. Report sample counts, missing values and medians separately for adoption/reconciliation. Do not compare incomparable scopes, turn estimates into observations, infer token usage from reads, or claim a productivity gain from one sample. Share aggregates deliberately, never upload automatically. A summary is diagnostic evidence, not a CI gate or completion score.

## Periodic rule consolidation

At an audit and after a repeated procedural conflict or significant workflow change, review the affected rule set for duplicates, contradictions, obsolete assumptions and unnecessary repeated reading. The authoritative owner remains AGENTS, BACKLOG-RULES, APPLY or the appropriate area/style guide.

For each proposed consolidation record old locations, the requirement they enforce, new owner/location, preserved exceptions, why the text is redundant/obsolete, and the check establishing no requirement was lost. Replace duplicate normative text with a short pointer where useful. Explicitly preserve applicable rules from session start. Update every affected summary, template/adapted copy and test in the same change; generic changes release upstream before projects adopt them. If deletion changes behavior, treat it as a policy change with its own acceptance, not editorial cleanup.

Age, rare use and no recent incident do not justify deleting ownership, evidence, privacy or safety safeguards. Do not automatically expire rules or create an empty review artifact on every edit. Track actual unresolved findings/outcomes; completed scoped reviews can record no changes with inspected scope and reasons. Session checks, PR CI and the daily read-only workflow enforce freshness. The agent closes the loop on findings: inspect evidence, produce justified rule/tool/skill improvements, test in the owning repository and submit a normal PR, or record an owned backlog/no-change outcome. Candidate suggestions from conflict/prompt/reload medians are diagnostics, not semantic conclusions or authority to rewrite policy unattended.

## Agent-behaviour checks

Moved to [behaviour checks](behaviour-checks.md) unchanged, with two rules added (F-102: an edited held-out scenario leaves the set; a one-run drop is rerun first): read it before you run them or measure a rule change.

## Periodic token review

Run when `reviews.token.days` triggers (or on demand) and write `docs/reviews/token/<YYYY-MM-DD>.md`. Inputs: recent `work-usage` reports and `rule-load` measurements. Scan outside practice via generic web-search queries (no project names, data, code or usage figures) and record an `adopt` / `adapt` / `reject` table with reasons and sources. Rule changes still go through rule review; never edit rules unattended.
