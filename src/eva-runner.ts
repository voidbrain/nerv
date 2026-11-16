import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EVA_CLASS_SPECS } from './eva-classes.ts';

export const DEFAULT_SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';

export class EvaSandboxUnavailableError extends Error {
  constructor(message = 'EVA-03 confinement requires /usr/bin/sandbox-exec on macOS.') {
    super(message);
    this.name = 'EvaSandboxUnavailableError';
  }
}

export interface Eva03SeatbeltOptions {
  readonly workspaceDir: string;
  readonly hostHomeDir: string;
  readonly nervStateDir?: string;
  readonly readOnlyPaths?: readonly string[];
  readonly deniedReadPaths?: readonly string[];
}

export interface Eva03JobSpec {
  readonly jobId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly nervStateDir?: string;
  readonly readOnlyPaths?: readonly string[];
  readonly deniedReadPaths?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
  readonly sandboxExecPath?: string;
  readonly onLedgerEvent?: (event: Eva03LedgerEvent) => void;
}

export interface Eva03LedgerEvent {
  readonly jobId: string;
  readonly kind: 'eva03.started' | 'eva03.completed' | 'eva03.failed' | 'eva03.cancelled' | 'eva03.timed_out';
  readonly evaClass: 'eva-03';
  readonly rollbackClaimed: false;
  readonly uncertainExternalEffect: boolean;
  readonly detail?: string;
}

export interface Eva03JobResult {
  readonly jobId: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputTruncated: boolean;
  readonly workspaceDiscarded: boolean;
  readonly rollbackClaimed: false;
  readonly durationMs: number;
}

function escapeSbString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function canonicalExistingPath(target: string): string {
  return existsSync(target) ? realpathSync(target) : target;
}

/**
 * Builds a canonicalized macOS Seatbelt profile for an ephemeral EVA-03 job (F-049-T04).
 * Enforces read-only/ephemeral-workspace filesystem isolation, zero network egress,
 * and credential/Keychain denial.
 */
export function buildEva03SeatbeltProfile(options: Eva03SeatbeltOptions): string {
  const workspace = canonicalExistingPath(options.workspaceDir);
  const homeDir = canonicalExistingPath(options.hostHomeDir);
  const stateDir = options.nervStateDir ? canonicalExistingPath(options.nervStateDir) : undefined;
  const readOnly = (options.readOnlyPaths ?? []).map(canonicalExistingPath);
  const deniedReads = [
    homeDir,
    ...(stateDir ? [stateDir] : []),
    ...(options.deniedReadPaths ?? []).map(canonicalExistingPath),
  ];

  const lines: string[] = [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound)',
    '(deny network-inbound)',
    '(deny file-write*)',
    `(allow file-write* (subpath "${escapeSbString(workspace)}"))`,
    '(allow file-write* (literal "/dev/null"))',
    '(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd"))',
  ];

  for (const p of deniedReads) {
    lines.push(`(deny file-read* (subpath "${escapeSbString(p)}"))`);
  }
  for (const p of readOnly) {
    lines.push(`(allow file-read* (subpath "${escapeSbString(p)}"))`);
  }
  lines.push(`(allow file-read* (subpath "${escapeSbString(workspace)}"))`);
  return `${lines.join('\n')}\n`;
}

export function buildEva03CleanEnv(workspaceDir: string, commandPath: string): NodeJS.ProcessEnv {
  const cmdDir = dirname(commandPath);
  const basePath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';
  return {
    PATH: cmdDir && !basePath.split(':').includes(cmdDir) ? `${cmdDir}:${basePath}` : basePath,
    HOME: workspaceDir,
    TMPDIR: workspaceDir,
    NODE_NO_WARNINGS: '1',
  };
}

function terminateProcessGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  const forceTimer = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already exited
    }
  }, 250);
  forceTimer.unref();
}

/**
 * Runs a single job in a fresh EVA-03 Seatbelt instance, discards its ephemeral workspace
 * and profile on completion, and records outcome/uncertainty without claiming rollback.
 */
export async function runEva03Job(spec: Eva03JobSpec): Promise<Eva03JobResult> {
  if (process.platform !== 'darwin') {
    throw new EvaSandboxUnavailableError(`EVA-03 Seatbelt runner requires macOS (got ${process.platform}).`);
  }
  const sandboxExec = spec.sandboxExecPath ?? DEFAULT_SANDBOX_EXEC_PATH;
  if (!existsSync(sandboxExec)) {
    throw new EvaSandboxUnavailableError(`EVA-03 confinement binary missing: ${sandboxExec}`);
  }

  const eva03 = EVA_CLASS_SPECS['eva-03'];
  const timeoutMs = Math.min(spec.timeoutMs ?? eva03.resources.maxWallMs, eva03.resources.maxWallMs);
  const maxOutputBytes = Math.min(
    spec.maxOutputBytes ?? eva03.resources.maxOutputBytes,
    eva03.resources.maxOutputBytes,
  );
  const hostHomeDir = process.env.HOME || tmpdir();

  const instanceDir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), `nerv-eva03-${spec.jobId}-`)));
  const workspaceDir = join(instanceDir, 'workspace');
  const profilePath = join(instanceDir, 'eva03.sb');
  const startedAt = Date.now();

  let workspaceDiscarded = false;
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(workspaceDir, { recursive: true });
    const profile = buildEva03SeatbeltProfile({
      workspaceDir,
      hostHomeDir,
      nervStateDir: spec.nervStateDir,
      readOnlyPaths: spec.readOnlyPaths,
      deniedReadPaths: spec.deniedReadPaths,
    });
    writeFileSync(profilePath, profile, 'utf8');

    spec.onLedgerEvent?.({
      jobId: spec.jobId,
      kind: 'eva03.started',
      evaClass: 'eva-03',
      rollbackClaimed: false,
      uncertainExternalEffect: false,
    });

    const outcome = await new Promise<{
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
      cancelled: boolean;
      outputTruncated: boolean;
    }>((resolve, reject) => {
      const child = spawn(sandboxExec, ['-f', profilePath, spec.command, ...spec.args], {
        cwd: workspaceDir,
        env: buildEva03CleanEnv(workspaceDir, spec.command),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let outputTruncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const appendChunk = (target: Buffer[], chunk: Buffer) => {
        if (totalBytes >= maxOutputBytes) {
          outputTruncated = true;
          return;
        }
        const remaining = maxOutputBytes - totalBytes;
        if (chunk.length > remaining) {
          target.push(chunk.subarray(0, remaining));
          totalBytes += remaining;
          outputTruncated = true;
        } else {
          target.push(chunk);
          totalBytes += chunk.length;
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => appendChunk(stdoutChunks, chunk));
      child.stderr?.on('data', (chunk: Buffer) => appendChunk(stderrChunks, chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) terminateProcessGroup(child.pid);
      }, timeoutMs);
      timer.unref();

      const onAbort = () => {
        cancelled = true;
        if (child.pid) terminateProcessGroup(child.pid);
      };
      if (spec.signal) {
        if (spec.signal.aborted) onAbort();
        else spec.signal.addEventListener('abort', onAbort, { once: true });
      }

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        spec.signal?.removeEventListener('abort', onAbort);
        reject(err);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        spec.signal?.removeEventListener('abort', onAbort);
        if (child.pid) terminateProcessGroup(child.pid);
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          timedOut,
          cancelled,
          outputTruncated,
        });
      });
    });

    const kind = outcome.cancelled
      ? 'eva03.cancelled'
      : outcome.timedOut
        ? 'eva03.timed_out'
        : outcome.exitCode === 0
          ? 'eva03.completed'
          : 'eva03.failed';
    const uncertain = outcome.cancelled || outcome.timedOut || outcome.exitCode !== 0;
    spec.onLedgerEvent?.({
      jobId: spec.jobId,
      kind,
      evaClass: 'eva-03',
      rollbackClaimed: false,
      uncertainExternalEffect: uncertain,
      detail: outcome.stderr.slice(0, 400) || undefined,
    });

    rmSync(instanceDir, { recursive: true, force: true });
    workspaceDiscarded = !existsSync(instanceDir);

    return {
      jobId: spec.jobId,
      ...outcome,
      workspaceDiscarded,
      rollbackClaimed: false,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (!workspaceDiscarded && existsSync(instanceDir)) {
      rmSync(instanceDir, { recursive: true, force: true });
    }
  }
}

/**
 * Spawns `src/tools-process.ts` inside an ephemeral EVA-03 Seatbelt instance for one-shot
 * tool listing or execution, discarding the sandbox immediately after the call completes.
 */
export async function runToolsProcessInEva03(options: {
  readonly jobId: string;
  readonly home?: string;
  readonly repoRoot: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onLedgerEvent?: (event: Eva03LedgerEvent) => void;
}): Promise<Eva03JobResult> {
  const toolsEntry = join(options.repoRoot, 'src', 'tools-process.ts');
  const args = options.home ? [toolsEntry, options.home] : [toolsEntry];
  return runEva03Job({
    jobId: options.jobId,
    command: process.execPath,
    args,
    nervStateDir: options.home,
    readOnlyPaths: [join(options.repoRoot, 'src'), join(options.repoRoot, 'node_modules')],
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onLedgerEvent: options.onLedgerEvent,
  });
}
