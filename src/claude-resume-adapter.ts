import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import type {
  ResumeAttemptOutcome,
  ResumeAvailabilityCheck,
  ResumeEngineDeps,
  ResumeIntent,
  ResumeJobIdentity,
} from './resume-intent.ts';

const execFileAsync = promisify(execFile);

export const VSCODE_CLAUDE_INFEASIBILITY_NOTE =
  'Observed anthropic.claude-code-2.1.325 exposes only UI focus/open commands (claude-vscode.editor.openLast, reopenClosedSession) with no public session-ID resume API; headless resumption uses supported `claude --resume <session-id> -p ... --output-format json` CLI.';

export interface ClaudeCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ClaudeCommandRunner = (
  bin: string,
  args: readonly string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<ClaudeCommandResult>;

export interface ClaudeResumeTargetMetadata {
  readonly sessionId?: string;
  readonly sessionFile?: string;
  readonly cwd?: string;
  readonly resumePrompt?: string;
  readonly uiOnly?: boolean;
}

export interface ClaudeResumeAdapterOptions {
  readonly claudeBin?: string;
  readonly resumePrompt?: string;
  readonly timeoutMs?: number;
  readonly runner?: ClaudeCommandRunner;
  readonly readSessionFile?: (path: string) => string | null;
  readonly resolveTarget?: (intent: ResumeIntent) => ClaudeResumeTargetMetadata;
}

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

export function computeClaudeSessionFingerprint(sessionId: string, content: string, cwd = ''): string {
  return createHash('sha256').update(`${sessionId}\n${cwd}\n${content}`).digest('hex');
}

async function defaultRunner(
  bin: string,
  args: readonly string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<ClaudeCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, [...args], {
      cwd: options?.cwd,
      timeout: options?.timeoutMs ?? 60_000,
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? 'Command failed',
    };
  }
}

function defaultReadSessionFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/**
 * F-012-T03: Supported-API adapter for resuming a paused Claude Code session via
 * `claude --resume <session-id> -p <prompt> --output-format json`.
 * Refuses VS Code UI-only targets because `anthropic.claude-code` exposes no public
 * extension API to target a specific session ID.
 */
export class ClaudeCodeResumeAdapter {
  private readonly claudeBin: string;
  private readonly defaultPrompt: string;
  private readonly timeoutMs: number;
  private readonly runner: ClaudeCommandRunner;
  private readonly readSessionFile: (path: string) => string | null;
  private readonly resolveTarget: (intent: ResumeIntent) => ClaudeResumeTargetMetadata;

  constructor(options: ClaudeResumeAdapterOptions = {}) {
    this.claudeBin = options.claudeBin ?? 'claude';
    this.defaultPrompt = options.resumePrompt ?? 'Continue the paused task.';
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.runner = options.runner ?? defaultRunner;
    this.readSessionFile = options.readSessionFile ?? defaultReadSessionFile;
    this.resolveTarget =
      options.resolveTarget ??
      ((intent) => ({
        sessionId: intent.targetId,
      }));
  }

  toEngineDeps(
    owner: string,
    options?: { now?: number; notifyOutcome?: ResumeEngineDeps['notifyOutcome'] },
  ): ResumeEngineDeps {
    return {
      owner,
      now: options?.now,
      notifyOutcome: options?.notifyOutcome,
      checkAvailability: (intent) => this.checkAvailability(intent),
      verifyIdentity: (intent) => this.verifyIdentity(intent),
      executeResume: (intent) => this.executeResume(intent),
    };
  }

  async checkAvailability(intent: ResumeIntent): Promise<ResumeAvailabilityCheck> {
    if (intent.targetKind !== 'cli-job' && intent.targetKind !== 'vscode-claude') {
      return { available: false, reason: `Unsupported targetKind for Claude adapter: ${intent.targetKind}` };
    }
    const meta = this.resolveTarget(intent);
    if (meta.uiOnly) {
      return { available: false, reason: VSCODE_CLAUDE_INFEASIBILITY_NOTE };
    }
    const sessionId = meta.sessionId ?? intent.targetId;
    if (!SAFE_SESSION_ID.test(sessionId)) {
      return { available: false, reason: `Invalid Claude session ID: ${sessionId}` };
    }
    const version = await this.runner(this.claudeBin, ['--version'], { timeoutMs: 10_000 });
    if (version.exitCode !== 0) {
      return {
        available: false,
        reason: `Claude CLI unavailable (${version.stderr.trim() || `exit ${version.exitCode}`})`,
      };
    }
    return { available: true };
  }

  async verifyIdentity(intent: ResumeIntent): Promise<ResumeJobIdentity | null> {
    const meta = this.resolveTarget(intent);
    if (meta.uiOnly) return null;
    const sessionId = meta.sessionId ?? intent.targetId;
    if (!SAFE_SESSION_ID.test(sessionId)) return null;

    if (meta.sessionFile) {
      const content = this.readSessionFile(meta.sessionFile);
      if (content === null) return null;
      const fingerprint = computeClaudeSessionFingerprint(sessionId, content, meta.cwd ?? '');
      return {
        targetId: sessionId,
        targetFingerprint: fingerprint,
        stillActive: true,
      };
    }

    return {
      targetId: sessionId,
      targetFingerprint: intent.targetFingerprint,
      stillActive: true,
    };
  }

  async executeResume(intent: ResumeIntent): Promise<ResumeAttemptOutcome> {
    if (
      intent.permissionScope.allowedAction !== 'resume-named-job' ||
      intent.permissionScope.targetId !== intent.targetId ||
      intent.permissionScope.allowSecurityPrompts ||
      intent.permissionScope.allowLimitBypass ||
      !intent.permissionScope.modelOverrideBlocked
    ) {
      return { kind: 'failed', reason: 'Resume permission scope violated.', retryable: false };
    }

    const meta = this.resolveTarget(intent);
    if (meta.uiOnly) {
      return { kind: 'failed', reason: VSCODE_CLAUDE_INFEASIBILITY_NOTE, retryable: false };
    }

    const sessionId = meta.sessionId ?? intent.targetId;
    const prompt = meta.resumePrompt ?? this.defaultPrompt;
    const result = await this.runner(this.claudeBin, ['--resume', sessionId, '-p', prompt, '--output-format', 'json'], {
      cwd: meta.cwd,
      timeoutMs: this.timeoutMs,
    });

    const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (/rate[_ ]?limit|usage limit|token limit|quota|try again/.test(combined)) {
      return {
        kind: 'deferred',
        reason: 'Provider token/rate limit still active at deadline.',
      };
    }
    if (/already running|session.*locked|in use/.test(combined)) {
      return {
        kind: 'failed',
        reason: 'Target Claude session is already running.',
        retryable: false,
      };
    }
    if (result.exitCode !== 0) {
      return {
        kind: 'failed',
        reason: result.stderr.trim() || `claude --resume exited with code ${result.exitCode}`,
        retryable: false,
      };
    }

    return {
      kind: 'resumed',
      detail: {
        adapter: 'claude-cli',
        sessionId,
        exitCode: result.exitCode,
      },
    };
  }
}
