# Selecting verification work

Optional scoped verification reduces repeated work while keeping evidence and safeguards. Projects opt in through `verification` in `.harness.json`; without it their existing checks remain required. The project owns its test groups and risk paths. This guide owns the selection procedure.

Run `node tools/verification.mjs` before implementation and reconcile its plan after the final change. The planner reads the diff against `origin/main`, including tracked working changes and untracked files. `--base=REF` selects another reviewed base; `--full` explicitly requests the complete deterministic suite. `--github-output` writes booleans and selected group IDs for CI. Planning never launches tests, models or workflows.

Default freshness limits are seven days or ten merged PRs since the last successful full run whose tested revision reached the default branch, whichever comes first. The budget counts first-parent integration commits: each merge or squash PR counts once, and direct commits conservatively consume the budget too. Missing, partial, failed, skipped, future-dated, unmerged or unavailable evidence does not reset freshness. A successful PR run counts only when its exact tested head was merged into the default branch; missing run-to-PR links are resolved through the tested commit’s associated PRs. Main-branch scheduled/manual runs can count directly. The configured full marker job succeeds only after every configured full-suite job passes; never create it on a partial run. Unknown history requests full checks.

## Project settings

```json
{
  "verification": {
    "enabled": true,
    "workflow": "ci.yml",
    "fullJob": "full-suite",
    "days": 7,
    "prs": 10,
    "historyLimit": 30,
    "risk": ["package*.json", "security/**", "shared/**"],
    "sources": ["src/**", "test/**", "web/**"],
    "documentation": ["docs/**", "README.md"],
    "groups": [
      {"id": "backend", "paths": ["src/reminders.ts", "test/reminders.test.ts"]},
      {"id": "browser", "paths": ["web/**"]}
    ]
  }
}
```

Patterns support `*` within a directory and `**` across directories. A mapped change selects every affected group; unmapped changes request full checks. Source paths cannot hide behind a documentation pattern. Policy, planner and workflow changes always request full checks. Add shared contracts, authentication, persistence, execution gates, migrations and dependencies to project risk paths. The example is a shape, not a complete dependency map.

Fast applicable static/security/harness checks and affected regressions still run. Tests across changed joins, named backlog acceptance, independent review, privacy and green-merge requirements remain binding. A plan never turns a required human/device check into an automated pass. Inspect transitive dependencies and the impact map; widen selection when a group cannot establish the changed contract. This optional selection procedure replaces blanket repetition only in explicitly adopted projects. Existing projects need not migrate.

Run the complete deterministic suite for an explicit request, risky or unmapped changes, expired freshness or a gap in confidence. Do not repeat the same successful broad local run at an unchanged revision merely because CI will repeat it. Use a targeted rerun after a narrow fix and let the required CI validate the final revision; record scope honestly. No percent coverage target, deadline or stale evidence can waive a failing check. Coverage enforcement, if enabled, still needs its required comparable metrics; configure that group to run when necessary.

Repeated stress campaigns, real-model evaluations, costly external/device checks and distribution builds are separate scopes. Run them on request, for a concrete changed risk or when a record explicitly requires them. Their time, model/token budgets and acceptance are separate from deterministic-suite freshness. They do not run merely because the full-suite timer expired. Avoid repeat agent reviews unless the changed scope or a binding review requirement calls for one.

## CI integration

Use one pull-request workflow instead of duplicate push and PR executions for the same head. Add a manual full-suite trigger and a weekly main-branch scheduled check; a schedule evaluates freshness even without a new PR. Run the planner with full git history and authenticated read access to Actions metadata (`gh` and `GH_TOKEN`; workflow `actions: read`, plus `contents: read`). Use existing reviewed action pins, no external credential and no `pull_request_target`. Failed metadata lookup requests full work.

Keep required job names stable. Each job runs its applicable selected work or reports an explicit scoped skip. A separate `full-suite` marker job is skipped on partial plans and succeeds only when all full-suite dependencies succeeded. An `always()` marker must explicitly reject failed, cancelled or skipped dependencies; an empty successful marker is not full evidence. Keep full/targeted selection and reasons visible in job summaries. Concurrency cancellation may stop superseded runs, never the newest head's required checks. Do not change branch protection or required-check settings without owner approval.

GitHub history lookup is bounded by `historyLimit` successful workflow runs. If the verified marker is beyond that bound, run full rather than guessing. This check does not install an agent, execute while no host is running or alter a backlog's priorities. Evidence remains scoped to its tested revision and environment.
