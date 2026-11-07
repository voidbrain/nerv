# Friction, reconciliation previews and rule review

All applicable rules are binding from the start. An index can reduce repeated navigation, but never defers reading relevant instructions or makes ownership, evidence, privacy or safety optional.

## In short

Moved from AGENTS.md in 3.3.0, unchanged in substance; AGENTS keeps the trigger.

All applicable rules must be known and followed from the start; shorter indexes never defer requirements. Use this guidance for read-only preview, mandatory timed adoption/reconciliation and input-bound review evidence. Run `node tools/maintenance.mjs check` at session start and in CI; failures require current reviewed outcomes before proceeding. At audits, repeated procedural conflicts or significant workflow changes, consolidate redundant rules with requirement/owner/exception traceability. Never remove a safeguard just because it is old or rarely triggered. Record unresolved findings on their owning outcomes; no automatic expiry or telemetry.

Maintenance findings drive justified rule/tool/skill improvements through tested, owned PRs or an explicit no-change/backlog outcome, never unattended policy rewriting. Daily CI checks freshness between sessions. Coverage is separate from quality: test changed behavior and risky joins, preserve static/security checks, use optional main-baseline non-regression, never demand a percentage increase on every PR.

## Required enforcement

For harness 3.0 adoption, enable `.harness.json` maintenance policy, choose the actual rule/tool input files and a review interval (7 days by default). Run `node tools/maintenance.mjs check` at session start and in PR CI. The daily read-only Maintenance freshness workflow is scheduled between sessions at 09:00 UTC (normal Actions scheduling may delay a run); failure reporting uses normal GitHub Actions notifications, not an installed background agent. No agent works while no execution host is running.

The committed `docs/agents/maintenance-review.json` records review time, policy/input hashes, aggregate measurements and outcomes. Missing/stale evidence or changed inputs fails the check. All policy changes require review too. Generate it only after reviewing evidence and implementing/test-verifying justified changes or linking owned backlog work. A no-change outcome requires a reason. Review shape, timestamps and file existence do not prove semantic quality; PR review and behavior tests remain necessary.

`node tools/maintenance.mjs review --outcomes=.harness/review-outcomes.json` writes the receipt from a reviewed JSON array. Each outcome has `kind` (rule/tool/skill/none), `disposition` (implemented/backlog/no-change), `target` (existing implementation file or active owned B-/F- ID when applicable) and `evidence` (reason/check). The tool never invents rules or runs a generated skill. Raw numeric logs stay local; only deliberately reviewed aggregates enter the receipt. Configure inputs relevant to the current project; no foreign source or acceptance is required.

## Measure actual friction

Measurement is local, not background telemetry. Adoption/reconciliation starts with `node tools/friction.mjs start --operation=reconciliation` and ends with `node tools/friction.mjs finish` plus any observed counters. Elapsed wall-clock time is calculated automatically, including waits; retain that boundary when comparing samples. Start refuses to overwrite a running session; finish refuses a supplied duration. Counters require actual observation and remain unknown if not supplied. Record/finish summaries carry latest observation time; a review requires a recent measurement. Legacy `record` remains for explicitly observed historical durations, never guessed ones. Time an adoption or reconciliation from reading its applicable rules through validation, with pauses/excluded work stated in the owning record. Record only observed duration and counters:

```bash
node tools/friction.mjs record --operation=reconciliation --duration-ms=120000 --conflicts=1 --unnecessary-prompts=0 --repeated-context-loads=2
node tools/friction.mjs report
```

The numbers above are examples, not a baseline. Omitted counters are unknown, never zero. Define a conflict as a file requiring manual resolution; count an unnecessary prompt only after reviewing why existing authorization sufficed; count a repeated context load only when unchanged material was reread unnecessarily. Distinguish deliberate rule refreshes from waste. Use consistent start/end boundaries and note unusual task scope in the owning backlog evidence, not in the numeric log.

`.harness/friction.jsonl` is append-only local data, ignored by default. It contains operation, timestamp, observed duration and optional counts only; no prompt/source text, identity or credentials. Report sample counts, missing values and medians separately for adoption/reconciliation. Do not compare incomparable scopes, turn estimates into observations, infer token usage from reads, or claim a productivity gain from one sample. Share aggregates deliberately, never upload automatically. A summary is diagnostic evidence, not a CI gate or completion score.

## Preview before writing

```bash
node tools/reconcile-preview.mjs --template=/path/to/project-harness --to=v2.2.2
node tools/reconcile-preview.mjs --template=/path/to/project-harness --to=v2.2.2 --json
```

Select an actually published release tag (the examples use v2.2.2), not an untagged prepared version. Run from the applied project through its copied script. It reads the project stamp and release-tag content, lists copy updates, local/conflicting differences, missing sources/base tags and adapted-file review, and shows marked project rules plus required checks. It never fetches, writes, merges or applies. Verify the remote release under APPLY first; a local tag alone is not proof of publication. Dirty template state is reported. All project-specific content must survive adaptation, including unmarked rules: marker extraction cannot prove semantic preservation. Missing ancestry requires manual review rather than a guessed common base. Fork conflict classification is conservative; existing check-harness three-way merge remains a separate explicit operation.

Review the plan and record unresolved conflicts on the owning outcome before editing. Re-run it when source/target revisions change. A preview does not authorize edits, waive checks or establish that a rule is correct.

## Periodic rule consolidation

At an audit and after a repeated procedural conflict or significant workflow change, review the affected rule set for duplicates, contradictions, obsolete assumptions and unnecessary repeated reading. The authoritative owner remains AGENTS, BACKLOG-RULES, APPLY or the appropriate area/style guide.

For each proposed consolidation record old locations, the requirement they enforce, new owner/location, preserved exceptions, why the text is redundant/obsolete, and the check establishing no requirement was lost. Replace duplicate normative text with a short pointer where useful. Explicitly preserve applicable rules from session start. Update every affected summary, template/adapted copy and test in the same change; generic changes release upstream before projects adopt them. If deletion changes behavior, treat it as a policy change with its own acceptance, not editorial cleanup.

Age, rare use and no recent incident do not justify deleting ownership, evidence, privacy or safety safeguards. Do not automatically expire rules or create an empty review artifact on every edit. Track actual unresolved findings/outcomes; completed scoped reviews can record no changes with inspected scope and reasons. Session checks, PR CI and the daily read-only workflow enforce freshness. The agent closes the loop on findings: inspect evidence, produce justified rule/tool/skill improvements, test in the owning repository and submit a normal PR, or record an owned backlog/no-change outcome. Candidate suggestions from conflict/prompt/reload medians are diagnostics, not semantic conclusions or authority to rewrite policy unattended.

## Agent-behaviour checks

Tools check records and files; `tools/behaviour.mjs` checks whether an agent following this project's AGENTS.md and BACKLOG-RULES behaves as they say. Each scenario builds a fixture repository from the project's own rule files (`behaviour.rules` maps fixture paths to sources), gives the agent one task and grades the result without a model: files, records, commits, the remote and the transcript. `node tools/behaviour.mjs list` names the scenarios and the rule each one tests.

The runner is the project's choice, set in `.harness.json` `behaviour.runner`: a shell command run in the fixture repository with the task in `$HARNESS_TASK_FILE`, whose output is the transcript, so it should print the agent's final reply rather than tool logs (for example `claude -p "$(cat "$HARNESS_TASK_FILE")"` with the permissions the owner allows for a throwaway fixture). The fixture lives in a temporary folder with a local bare remote; give the runner no credentials or network access it does not need. `npm run behaviour -- run` runs each scenario `behaviour.times` times (3 by default) and reports passes per scenario, never only a total; `--scenarios=a,b` narrows it and `--keep` leaves the fixtures for inspection. A runner that fails to start, exits non-zero or times out (`behaviour.timeoutMs`, 20 minutes by default; its whole process group is stopped) counts as a failed run, never as a graded one.

Run it on demand and when the rule files it copies change (AGENTS.md, CLAUDE.md, BACKLOG-RULES: an impact-map row), never on every PR by default: each run costs agent time. Compare each scenario with its last run. A scenario that starts failing is a backlog record, with the report as evidence. A mistake seen in real work or an audit finding becomes a new scenario: a fixture, a task and a grader that reads the result. A pass shows the agent followed the rule in that fixture, not in every situation.

## Incremental quality policy

Coverage measures executed code, not assertion quality, security, readability or maintainability. Unit coverage excludes browser execution unless explicitly instrumented; do not interpret UI unit coverage as total UI validation. Require tests for changed behavior and regression fixes, preserve clean static/security checks, and prioritize high-risk untested branches/integration joins. Do not require every PR (including docs/refactors) to increase a global percentage or add mirror tests to game a target.

Projects may adopt `coverage.enforce: true` with a justified `coverage.drop` tolerance. `coverage-table --check` then fails for missing summary/main baseline/comparable metrics or regression beyond tolerance against the baseline on `origin/main` (or configured default branch); the PR's lowered baseline or removed display-folder row cannot approve itself; baseline folders remain checked. Default false retains warning-only behavior. Baseline/policy changes are explicit reviewed decisions, not automatic lowering. This is aggregate non-regression, not changed-line coverage; branch-level and browser/visual checks remain distinct.
