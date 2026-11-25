# Feasibility: Headless Coding-Agent Resume (F-090-T01)

Date: 2026-11-15  
Status: Accepted (feasibility & adapter contract for F-090)

## 1. Supported Resume Commands (Host Probe 2026-11-15)

Probed installed coding-agent CLIs on the macOS host:

- **Claude Code (`claude`, installed on host)**:
  - Observed flags via `claude --help`: `-p` / `--print` (headless non-interactive mode), `--resume <session-id>` (resume an exact session by ID), `-c` / `--continue` (continue most recent conversation in working directory), `--fork-session`, `--bg` / `--background`.
  - Recommended headless invocation: `claude -p --resume <sessionId> "<continuationPrompt>"` executed with `cwd` set to the job's worktree (`F-084`).
- **Other CLIs (`codex`, `gemini`, `agy`)**:
  - Not installed in `PATH` on this host at probe time (`2026-11-15`).
  - Adapter contract: any non-`claude` CLI adapter must pass an explicit startup capability check (`<cli> --help` / version probe) on the target base before admitting a resumable job; unsupported or unverified CLIs fail closed with `needs-attention`.

## 2. Session Identity & Pre-Resume Guards

Every resumable coding-agent job records:

- `agent`: `'claude'` (or verified adapter ID)
- `sessionId`: explicit agent session UUID/ID captured at session creation
- `repoPath`: worktree path (`F-084`)
- `branch`: expected git branch name
- `resumeIntentId`: link to `F-012` durable resume intent

Before spawning the headless resume process:

1. **Branch guard**: Run `git -C <repoPath> rev-parse --abbrev-ref HEAD`; if it differs from `branch` or the worktree is missing, transition to `needs-attention` and do not run.
2. **Idempotency / lease guard**: Claim the `F-012` resume lease atomically; if the intent is already `completed`, `resumed`, or `expired`, return `needs-attention` instead of launching a second run.

## 3. What Survives a Restart

- **Survives NERV / host restart**:
  - NERV's SQLite `resume_intents` state (`sessionId`, `repoPath`, `branch`, `attempt`, `lease`, `status`).
  - Claude Code's on-disk session state under the user's `~/.claude` project directory, keyed by `sessionId` and `cwd`.
- **Does not survive**:
  - In-memory child-process pipes, transient stdout streams, and unpersisted environment variables; the adapter therefore captures `sessionId`, exit code, structured output, and cost summary to disk/SQLite on completion and reports them back to the originating channel.

## 4. Live Binding in `serve`

- The owner records a session that stopped at its usage limit: `nerv session-limit record SESSION REPO BRANCH "ISO reset time+zone" [--prompt TEXT]` (`nerv session-limit list` shows them). The target sits in SQLite next to a resume intent that allows one attempt and stays open for a day after the reset.
- While `serve` runs, the scheduler process checks once a minute and, after the reset, runs `claude -p --resume <sessionId>` once in the worktree, after the branch and worktree recheck. The run is asynchronous, so the scheduler keeps working meanwhile.
- Each outcome reaches the inbox once: the run's output, or **Needs attention** when the branch changed, the worktree is gone, the run failed (a limit still active included), the window closed, or a restart cut the run off. None of these runs it a second time.
