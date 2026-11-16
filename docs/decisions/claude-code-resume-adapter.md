# Claude Code (VS Code) resume adapter feasibility (F-012-T03)

**Observed on 16 November 2026** against installed binaries/extensions on macOS:

- **VS Code extension (`anthropic.claude-code-2.1.325-darwin-arm64`)**: `package.json` `contributes.commands` exposes UI commands (`claude-vscode.editor.open`, `claude-vscode.editor.openLast`, `claude-vscode.reopenClosedSession`, `claude-vscode.newConversation`, etc.) with **no** public command or IPC API to resume a specific `session-id` or target an individual paused conversation tab. Resuming an arbitrary VS Code UI-only tab via extension commands is therefore **infeasible** via supported APIs without fragile UI automation.
- **Claude Code CLI (`claude` `2.1.312`)**: `claude --help` explicitly supports `--resume <session-id>` with `-p` / `--print` and `--output-format json`. `ClaudeCodeResumeAdapter` (`src/claude-resume-adapter.ts`) implements `ResumeEngineDeps` using this supported CLI mechanism, verifying session availability, SHA-256 session transcript fingerprint, and strict permission scope before invoking `claude --resume <session-id>` once, while refusing UI-only `vscode-claude` targets with `VSCODE_CLAUDE_INFEASIBILITY_NOTE`.
