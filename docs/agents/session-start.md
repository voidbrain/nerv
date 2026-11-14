# Session start

AGENTS.md says to run `npm run check:freshness` first in every session and do what it lists. This page says how to handle each finding.

## What to do for each finding

**At the start of every session, before other work, run `npm run check:freshness`**, inspect `.harness.json` for selected integrations and solution context ([MCP guidance](mcp.md), [solution profile](solution-profile.md)), and do what the check lists (in the session's first PR, except the backlog, which has its own rule below):
- the backlog is behind `main`: run `npm run reconcile:draft` (each PR's CI and the records naming it; flags a failed check, a PR no record names and a commit without a PR), open `npm run ci:status -- <number>` only for a flagged PR, review any commit without a PR, update or close their records, archive closed ones, move the header to the current `main`. Do this inside the session's working PR. A PR whose only purpose is reconciliation is opened only when the check marks it due (`!`): 10 merged PRs or one day behind by default (`freshness.backlogPRs`, `freshness.backlogDays`), a commit that reached `main` without a PR, or a session with no other PR;
- merged branches are still on GitHub: delete them (and their local branches and worktrees);
- the scope-aware audit checker reports missing/stale/blocked areas (7 days by default): audit what changed since (docs, tests, style guide, accessibility, privacy, and what the outputs rely on outside the repository: dependency upgrades, the CI browser and machine, external services and data) and write `docs/audits/<date>.md`;
- a declared evaluation dependency (`.harness.json` `evaluations`) reports pending cases: keep an open backlog record naming them until a run covers them; real-model runs need the owner's approval (BACKLOG-RULES, "Evaluation dependencies");
- the harness template has a newer release (`.harness.json` names the one this project is on), or its clone is missing, behind or unreachable: pull it first (`git -C ~/Projects/project-harness pull --ff-only --tags`), reconcile as its `APPLY.md` ("Reconciling") says, then move `version` forward. A copied tool under `tools/` is never edited here unless it is listed under `forked` in `.harness.json`; its settings are there too.

CI prints ordinary freshness findings as warnings; the required maintenance evidence check can fail in 3.0. `ci:status` needs a logged-in `gh`; if unavailable, inspect the same runs/jobs through an authenticated connector/API and name that evidence source. If neither is available, record the missing evidence; never claim the CLI ran.

To pick the next work, run `npm run work:next` (with source-owned records): the steps that can move now, one line each in ledger order. `work:tasks` prints every task as JSON; read it only for a field `next` omits.
