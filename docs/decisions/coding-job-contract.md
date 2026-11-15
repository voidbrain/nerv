# Coding-Job Contract (F-084-T01)

Date: 2026-11-15  
Status: Accepted (decision for F-084)

## 1. Purpose

Define the inputs, outputs, isolation boundaries, token-budget admission rules, and owner approval boundary for a NERV coding job (`F-084`) before implementation.

## 2. Job Inputs & Allowlist

- **Repository allowlist**: A coding job only targets repositories explicitly listed in the base's owner-approved repository allowlist (each entry pins `id`, `localPath`, `defaultBranch`, and optional `remote`). Unknown or un-allowlisted paths are rejected fail-closed.
- **Worktree location**: Never edit the primary checkout. Each job creates a fresh git worktree under `<repo>.worktrees/job-<shortId>` branched from `<defaultBranch>` (or `origin/<defaultBranch>`), and removes or archives it when the job settles.
- **Sandbox class**: Runs in `eva-01` (F-049) when local build/test tools are needed without network access, or `eva-02` only when an explicit allowlisted fetch is required; `eva-00` for read-only analysis. Credentials are never mounted into the coding sandbox.
- **Coding agent**: Runs via the configured coding-agent runner (e.g. local CLI agent or worker pilot) with `whole-job` or step-bounded handoff (`F-050`), each step in a fresh session with a persisted handoff so context saturation never silently drops a rule.

## 3. Budget & Pre-Push Owner Gate

- **Budget**: Each job carries an explicit `maxSteps`, `maxWallMs`, `maxTokens`, and `maxCostUsd` (defaulting to the owner's configured coding-job budget). Exceeding any limit halts the job and reports partial work without pushing.
- **What reaches the owner before a push**:
  1. Compact `git diff --stat` and unified diff summary (plus full diff link/attachment).
  2. Exact test and typecheck commands run and their exit status / pass-fail counts.
  3. Token and cost accounting for the job.
- **Approval gate**: Pushing the branch and opening a PR is an **Orange** (`network-write` / `owner: true`) action on an approval card. Nothing leaves the machine until the owner approves; once approved, the PR URL is returned to the originating channel.

## 4. Instruction Load Measurement & Route Admission

Measured via `npm run rule-load` (characters ÷ 4, confirmed 2026-11-15) and verified against the selected model's own token counter at job admission:

- **Always loaded**: `3,064` tokens (`AGENTS.md`: `3,034`, `CLAUDE.md`: `30`).
- **Typical coding-job startup triggers**: `session-start.md` (`+706`), `pull-requests.md` (`+1,114`), `verification.md` (`+1,494`), `claims.md` (`+1,080`) -> `~7,458` tokens total instruction load (plus `~1,042` when touching Angular `web/`).
- **Admission rule**: Before starting a step, NERV measures the actual instruction load (`AGENTS.md`, `CLAUDE.md`, and triggered procedure files) plus the task prompt using the target model route's token counter (or `chars / 4` conservative upper bound when the provider has no preflight counter). Any model route whose context window cannot hold `instructionTokens + taskTokens + 16,384` tokens of working headroom (minimum `32,768`-token context window for coding jobs) is **refused** at admission with an explicit reason so rules are never silently truncated.
