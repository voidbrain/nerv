# Pull requests

Read before you open, update or merge a PR. The never and ask-first rules stay in AGENTS.md (its safety block); this page holds the workflow.

## Opening and updating a PR

Open every PR against `main`, never on another PR's branch (merging it would not reach `main`). Once a PR's CI is green the owner may merge it at any moment: push no new work to it, open a new PR. Exception: a green PR that conflicts with `main` cannot merge, so it may get a push that only resolves the conflict; its checks run again before it can merge. A conflict in `docs/BACKLOG.md` is resolved record by record, never by keeping one side's record (that silently drops the other side's edits): with source-owned records (`workItems.enabled`) resolve the record and task sources, preserving both sides, then regenerate the views (`npm run work:build`); otherwise use `node tools/merge-backlog.mjs`.

## Checks

- With scoped verification explicitly enabled, follow [verification selection](verification.md): applicable fast checks and affected regressions by default; full deterministic checks on request, risk or freshness limits. Without adoption, the checks in AGENTS.md ("Checks before you finish") remain required. Run the fast local checks (format, lint, typecheck, backlog, rules, maintenance) in one pass before pushing to avoid multi-push CI cycles.


## Independent review

- **Independent review.** A PR that closes a P1 record or changes a harness file (a file listed in `.harness.json`, or the template itself) gets a review in a fresh context before it merges: a review skill or a separate session that did not write the change reads the diff and the record's Check for bugs, security and compliance. Its findings are fixed in the PR or answered there. The record cites it: `Review: <how, outcome>`. Documentation-only and small (a few lines, no behaviour) changes are exempt; a P1 record says why: `No review: <reason>`. So is a reconcile whose only harness-file changes are byte-identical copies of `copied` files from a published template tag, their `copied` entries and the `version` stamp, when `node tools/check-harness.mjs --strict` passes on the PR head (it exits 1 if any copied file differs or the template is missing); the record cites it as `No review: check-harness --strict matched vX.Y.Z`. Any adapted file (AGENTS.md and BACKLOG-RULES included), forked or project-written change, or a P1 closure in the same PR still needs a reviewer. Match the reviewer to the change: mechanical checks (byte copies, version bumps, a reformat whose syntax tree is unchanged, regenerated views) can run on a smaller, cheaper model with an explicit list of what to verify; design, safety rules, security, data migration and lifecycle code get the strongest available model. The checks required do not change with the model. In Claude Code the copied agent definitions pin the model: `mechanical-reviewer` (Haiku) and `design-reviewer` (Opus), both instructed to report and never edit or merge; other clients follow the rule through their own settings, and the work-usage ledger records which model actually ran. Pass the reviewer `git diff origin/main...HEAD` and the changed file list rather than asking it to rediscover the diff. The reviewer reports; it never approves or merges. `check:backlog` warns when a branch makes a P1 record Verified or Closed with neither; `check:freshness` reminds a branch that changes harness files.

## NERV

Moved from AGENTS.md (owner decision 2026-11-14, rule-load budgets).

NERV has scoped verification enabled. Follow [verification selection](../../docs/agents/verification.md) and the [NERV check mapping](../../docs/verification.md): run freshness and applicable fast checks, then affected regressions. The commands below are the available check catalogue, not a requirement to repeat every suite locally on every edit. Full deterministic checks run on request, risk, unmapped changes or stale/missing full evidence; required CI validates the final revision. Stress and real-model campaigns have separate triggers/budgets. <!-- project -->

- A PR that closes a P1 record or changes a harness file gets a review in a fresh context before it merges, with the exemptions listed there; the reviewer reports, never approves or merges (BACKLOG-RULES, "Independent review"). Pass the reviewer `git diff origin/main...HEAD` and the changed file list rather than asking it to rediscover the diff. <!-- project -->
