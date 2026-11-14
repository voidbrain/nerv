# Friction, reconciliation previews and rule review

All applicable rules are binding from the start. An index can reduce repeated navigation, but never defers reading relevant instructions or makes ownership, evidence, privacy or safety optional.

Moved to [rule review](rule-review.md): "Measure actual friction", "Agent-behaviour checks", "Periodic rule consolidation".

## In short

Moved from AGENTS.md in 3.3.0, unchanged in substance; AGENTS keeps the trigger.

All applicable rules must be known and followed from the start; shorter indexes never defer requirements. Use this guidance for read-only preview, mandatory timed adoption/reconciliation and input-bound review evidence. Run `node tools/maintenance.mjs check` at session start and in CI; failures require current reviewed outcomes before proceeding. At audits, repeated procedural conflicts or significant workflow changes, consolidate redundant rules with requirement/owner/exception traceability. Never remove a safeguard just because it is old or rarely triggered. Record unresolved findings on their owning outcomes; no automatic expiry or telemetry.

Maintenance findings drive justified rule/tool/skill improvements through tested, owned PRs or an explicit no-change/backlog outcome, never unattended policy rewriting. Daily CI checks freshness between sessions. Coverage is separate from quality: test changed behavior and risky joins, preserve static/security checks, use optional main-baseline non-regression, never demand a percentage increase on every PR.

## Required enforcement

For harness 3.0 adoption, enable `.harness.json` maintenance policy, choose the actual rule/tool input files and a review interval (7 days by default). Run `node tools/maintenance.mjs check` at session start and in PR CI. The daily read-only Maintenance freshness workflow is scheduled between sessions at 09:00 UTC (normal Actions scheduling may delay a run); failure reporting uses normal GitHub Actions notifications, not an installed background agent. No agent works while no execution host is running.

The committed `docs/agents/maintenance-review.json` records review time, policy/input hashes, aggregate measurements and outcomes. Missing/stale evidence or changed inputs fails the check. All policy changes require review too. Generate it only after reviewing evidence and implementing/test-verifying justified changes or linking owned backlog work. A no-change outcome requires a reason. Review shape, timestamps and file existence do not prove semantic quality; PR review and behavior tests remain necessary.

`node tools/maintenance.mjs review --outcomes=.harness/review-outcomes.json` writes the receipt from a reviewed JSON array. Each outcome has `kind` (rule/tool/skill/none), `disposition` (implemented/backlog/no-change), `target` (existing implementation file or active owned B-/F- ID when applicable) and `evidence` (reason/check). The tool never invents rules or runs a generated skill. Raw numeric logs stay local; only deliberately reviewed aggregates enter the receipt. Configure inputs relevant to the current project; no foreign source or acceptance is required.

## Preview before writing

```bash
node tools/reconcile-preview.mjs --template=/path/to/project-harness --to=v2.2.2
node tools/reconcile-preview.mjs --template=/path/to/project-harness --to=v2.2.2 --json
```

Select an actually published release tag (the examples use v2.2.2), not an untagged prepared version. Run from the applied project through its copied script. It reads the project stamp and release-tag content, lists copy updates, local/conflicting differences, missing sources/base tags and adapted-file review, and shows marked project rules plus required checks. It never fetches, writes, merges or applies. Verify the remote release under APPLY first; a local tag alone is not proof of publication. Dirty template state is reported. All project-specific content must survive adaptation, including unmarked rules: marker extraction cannot prove semantic preservation. Missing ancestry requires manual review rather than a guessed common base. Fork conflict classification is conservative; existing check-harness three-way merge remains a separate explicit operation.

Review the plan and record unresolved conflicts on the owning outcome before editing. Re-run it when source/target revisions change. A preview does not authorize edits, waive checks or establish that a rule is correct.

## Incremental quality policy

Coverage measures executed code, not assertion quality, security, readability or maintainability. Unit coverage excludes browser execution unless explicitly instrumented; do not interpret UI unit coverage as total UI validation. Require tests for changed behavior and regression fixes, preserve clean static/security checks, and prioritize high-risk untested branches/integration joins. Do not require every PR (including docs/refactors) to increase a global percentage or add mirror tests to game a target.

Projects may adopt `coverage.enforce: true` with a justified `coverage.drop` tolerance. `coverage-table --check` then fails for missing summary/main baseline/comparable metrics or regression beyond tolerance against the baseline on `origin/main` (or configured default branch); the PR's lowered baseline or removed display-folder row cannot approve itself; baseline folders remain checked. Default false retains warning-only behavior. Baseline/policy changes are explicit reviewed decisions, not automatic lowering. This is aggregate non-regression, not changed-line coverage; branch-level and browser/visual checks remain distinct.
