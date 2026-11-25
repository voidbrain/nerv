# Addendum to the full audit of 13 November 2026

**Date:** 2026-11-13. Corrects one statement in [2026-11-13-full.md](2026-11-13-full.md); the report itself is unchanged.

The report says the 2026-11-06 proposal 3 (the freshness check finding the harness template from a worktree) is resolved. It is not resolved in general. From `~/Projects/NERV/NERV-audit-1113` the relative `template.path` `../harness-template` happened to resolve to `~/Projects/NERV/harness-template`. A worktree at another depth, such as `.claude/worktrees/<name>` or the Gauntlet worktree `~/Projects/gauntlet-protocol.worktrees/plan-roadmap`, still reports the template missing; the same day the Gauntlet check said "Harness template not found at ../project-harness" from its worktree and found it from its primary checkout. The proposal stays open and belongs to the harness template (resolve `template.path` from `git rev-parse --git-common-dir`).
