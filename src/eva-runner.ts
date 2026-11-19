import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { EVA_CLASS_SPECS } from './eva-classes.ts';
import type { EvaClass } from './pilots.ts';

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
  /**
   * B-100 (owner decision (b)): file names inside the NERV state directory a job may read, nothing else of it; the
   * tools process reads its `config.json`. The database, keys and every other file there stay denied.
   */
  readonly readableStateFiles?: readonly string[];
}

export interface Eva03JobSpec {
  readonly jobId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly nervStateDir?: string;
  readonly readOnlyPaths?: readonly string[];
  readonly deniedReadPaths?: readonly string[];
  readonly readableStateFiles?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
  readonly sandboxExecPath?: string;
  readonly onLedgerEvent?: (event: Eva03LedgerEvent) => void;
  /** Lists processes for B-099's tracking; tests point it at a missing binary to see tracking fail. */
  readonly psPath?: string;
}

/** F-049-T07: what a job of any EVA class asks of its instance, beyond the EVA-03 fields. */
export interface EvaJobSpec extends Omit<Eva03JobSpec, 'onLedgerEvent'> {
  readonly evaClass: EvaClass;
  /** EVA-01 and EVA-02 only: directories the grant lets the job write besides its workspace. */
  readonly writablePaths?: readonly string[];
  /**
   * EVA-01 and EVA-02 only: where the job may connect. Seatbelt filters by port only, on `localhost` or on any host:
   * EVA-01 takes `localhost` ports (an egress proxy that checks destinations), EVA-02 also ports on any host.
   */
  readonly egress?: { readonly localhost?: readonly number[]; readonly anyHost?: readonly number[] };
  readonly onEvent?: (event: EvaJobEvent) => void;
}

export type EvaPhase = 'started' | 'completed' | 'failed' | 'cancelled' | 'timed_out';

/** F-049-T07: a job's lifecycle as the runner reports it, for any class. */
export interface EvaJobEvent {
  readonly jobId: string;
  readonly phase: EvaPhase;
  readonly evaClass: EvaClass;
  readonly rollbackClaimed: false;
  readonly uncertainExternalEffect: boolean;
  readonly containment: 'best-effort';
  readonly detail?: string;
}

/** Ports no class reaches, whatever its grant: NERV's own admin and native ports on this machine. */
export const EVA_DENIED_LOCAL_PORTS: readonly number[] = [4317, 4319];

export interface Eva03LedgerEvent {
  readonly jobId: string;
  readonly kind: 'eva03.started' | 'eva03.completed' | 'eva03.failed' | 'eva03.cancelled' | 'eva03.timed_out';
  readonly evaClass: 'eva-03';
  readonly rollbackClaimed: false;
  readonly uncertainExternalEffect: boolean;
  /**
   * B-099: ending every process a job started is best effort on macOS: one that detaches and loses its parent between
   * two samples is never seen. No EVA-03 end claims that nothing the job started is still running.
   */
  readonly containment: 'best-effort';
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
  /** B-099: processes the job started that were still running at its end and were killed. */
  readonly descendantsKilled: number;
  /** B-099: processes the job started that could not be killed; their effects are uncertain. */
  readonly survivors: readonly number[];
  /** B-099: false when the process table could not be read, so what survived is unknown. */
  readonly tracked: boolean;
  readonly containment: 'best-effort';
}

function escapeSbString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function canonicalExistingPath(target: string): string {
  return existsSync(target) ? realpathSync(target) : target;
}

const validPort = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65535;

/**
 * F-049-T07: the Seatbelt profile for one job of a class (decisions/eva-runner.md). Every class: writes only in its
 * workspace, no NERV state, no $HOME, no Keychain, no inbound connections. EVA-03 and EVA-00: no network. EVA-01:
 * writes also in its granted paths, connections only to granted `localhost` ports. EVA-02: as EVA-01, plus granted
 * ports on any host. No class reaches NERV's admin ports. A class's network or writes it may not have are refused.
 */
export function buildEvaSeatbeltProfile(
  evaClass: EvaClass,
  options: Eva03SeatbeltOptions & Pick<EvaJobSpec, 'writablePaths' | 'egress'>,
): string {
  const spec = EVA_CLASS_SPECS[evaClass];
  const egress = options.egress ?? {};
  const writable = (options.writablePaths ?? []).map(canonicalExistingPath);
  if (spec.filesystem.mode === 'ephemeral-ro-inputs' || spec.filesystem.mode === 'ephemeral-workspace') {
    if (writable.length) throw new Error(`${evaClass} writes only in its own workspace.`);
  }
  if (spec.network.mode === 'deny' && (egress.localhost?.length || egress.anyHost?.length))
    throw new Error(`${evaClass} has no network.`);
  if (spec.network.mode === 'grant-allowlist' && egress.anyHost?.length)
    throw new Error(`${evaClass} connects only to localhost ports (an egress proxy), never to any host directly.`);
  const ports = [...(egress.localhost ?? []), ...(egress.anyHost ?? [])];
  if (ports.some((p) => !validPort(p))) throw new Error('Egress ports must be whole numbers from 1 to 65535.');
  if (ports.some((p) => EVA_DENIED_LOCAL_PORTS.includes(p)))
    throw new Error(`No EVA class reaches NERV's own ports (${EVA_DENIED_LOCAL_PORTS.join(', ')}).`);

  const workspace = canonicalExistingPath(options.workspaceDir);
  const homeDir = canonicalExistingPath(options.hostHomeDir);
  const stateDir = options.nervStateDir ? canonicalExistingPath(options.nervStateDir) : undefined;
  const readOnly = (options.readOnlyPaths ?? []).map(canonicalExistingPath);
  const denied = (options.deniedReadPaths ?? []).map(canonicalExistingPath);
  const deniedReads = [homeDir, ...(stateDir ? [stateDir] : []), ...denied];
  // Later Seatbelt rules win: an allow for a path that holds a denied one would re-open it (review of PR #558).
  // path.relative handles both separators and drive roots, so this holds on every platform.
  const within = (path: string, root: string) => {
    const rel = relative(root, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  const overlaps = (a: string, b: string) => within(a, b) || within(b, a);
  for (const w of writable)
    if (deniedReads.some((d) => overlaps(w, d)))
      throw new Error(`${w}: no EVA class writes in $HOME, NERV state or a denied path, or in a folder holding one.`);
  // A read-only input may sit inside $HOME (a checkout), never hold it, and never touch state or a denied path.
  const neverRead = [...(stateDir ? [stateDir] : []), ...denied];
  for (const r of readOnly)
    if (within(homeDir, r) || neverRead.some((d) => overlaps(r, d)))
      throw new Error(`${r} re-opens NERV state or a denied path (or holds $HOME); it cannot be a read-only input.`);

  const lines: string[] = [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound)',
    '(deny network-inbound)',
    ...(egress.localhost ?? []).map((p) => `(allow network-outbound (remote ip "localhost:${p}"))`),
    ...(egress.anyHost ?? []).map((p) => `(allow network-outbound (remote ip "*:${p}"))`),
    // Name lookups go through mDNSResponder; a class with no host ports needs none.
    ...(egress.anyHost?.length ? [] : ['(deny mach-lookup (global-name "com.apple.dnssd.service"))']),
    ...EVA_DENIED_LOCAL_PORTS.map((p) => `(deny network-outbound (remote ip "localhost:${p}"))`),
    '(deny file-write*)',
    `(allow file-write* (subpath "${escapeSbString(workspace)}"))`,
    ...writable.map((w) => `(allow file-write* (subpath "${escapeSbString(w)}"))`),
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
  for (const w of writable) lines.push(`(allow file-read* (subpath "${escapeSbString(w)}"))`);
  // State and denied paths stay denied after every allow, whatever was granted.
  for (const d of neverRead) {
    lines.push(`(deny file-read* (subpath "${escapeSbString(d)}"))`);
    lines.push(`(deny file-write* (subpath "${escapeSbString(d)}"))`);
  }
  // B-100 (owner decision (b)): the named files of the state directory, read-only, one by one; nothing else of it.
  const stateFiles = (options.readableStateFiles ?? []).map((name) => {
    if (!stateDir) throw new Error('readableStateFiles needs nervStateDir.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw new Error(`Not a plain file name: ${name}`);
    return join(stateDir, name);
  });
  for (const f of stateFiles) lines.push(`(allow file-read* (literal "${escapeSbString(f)}"))`);
  // Resolving a path (Node's realpath) stats every directory above it, which may sit inside the denied $HOME or state:
  // the metadata of those directories only, never their listing or any other file in them.
  const ancestors = new Set<string>();
  for (const p of [...readOnly, ...stateFiles])
    for (let d = dirname(p); d !== dirname(d); d = dirname(d)) ancestors.add(d);
  for (const d of ancestors) lines.push(`(allow file-read-metadata (literal "${escapeSbString(d)}"))`);
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

/** One process as `ps` lists it; `started` tells a reused pid from the process that had it before. */
interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly started: string;
}

/** The process table, or null when it could not be read (a missing or hung `ps`, a full process table). */
function listProcesses(psPath: string): Promise<ProcessEntry[] | null> {
  return new Promise((resolve) => {
    execFile(psPath, ['-A', '-o', 'pid=,ppid=,lstart='], { maxBuffer: 8 * 1024 * 1024, timeout: 2000 }, (err, out) => {
      if (err) return resolve(null);
      resolve(
        out
          .split('\n')
          .map((line) => /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), started: m[3]! })),
      );
    });
  });
}

/**
 * B-099: the processes a job started, including one in its own session (setsid) that its process-group kill misses.
 * The job's process tree is sampled while it runs; a process whose parent has exited is still known from an earlier
 * sample. Best effort: a process that detaches and loses its parent between two samples is never seen. A pid is only
 * signalled while its start time matches.
 */
class DescendantTracker {
  private readonly known = new Map<number, string>();
  private timer: NodeJS.Timeout | undefined;
  private sampling: Promise<void> = Promise.resolve();
  private readonly rootPid: number;
  private readonly psPath: string;
  /** False once the process table could not be read: what the job left running is then unknown. */
  tracked = true;
  constructor(rootPid: number, psPath: string, intervalMs = 100) {
    this.rootPid = rootPid;
    this.psPath = psPath;
    this.timer = setInterval(() => void this.sample(), intervalMs);
    this.timer.unref();
    void this.sample();
  }
  /** Adds the job's descendants; returns how many were new, or null when the table could not be read. */
  sample(): Promise<number | null> {
    const next = this.sampling.then(async () => {
      const table = await listProcesses(this.psPath);
      // A failed listing keeps what is known: it never counts as "everything ended".
      if (!table) {
        this.tracked = false;
        return null;
      }
      let added = 0;
      const live = new Map(table.map((e) => [e.pid, e.started]));
      for (const [pid, started] of this.known) if (live.get(pid) !== started) this.known.delete(pid);
      const parents = new Set([this.rootPid, ...this.known.keys()]);
      for (let grew = true; grew;) {
        grew = false;
        for (const e of table)
          if (parents.has(e.ppid) && !parents.has(e.pid) && e.pid !== process.pid) {
            parents.add(e.pid);
            this.known.set(e.pid, e.started);
            added++;
            grew = true;
          }
      }
      return added;
    });
    this.sampling = next.then(() => undefined);
    return next;
  }
  /** The known descendants still running, or null when the table could not be read. */
  private async running(): Promise<number[] | null> {
    const table = await listProcesses(this.psPath);
    if (!table) {
      this.tracked = false;
      return null;
    }
    const live = new Map(table.map((e) => [e.pid, e.started]));
    return [...this.known].filter(([pid, started]) => live.get(pid) === started).map(([pid]) => pid);
  }
  private ended?: Promise<{ killed: number; survivors: number[] }>;
  /**
   * Stops sampling and ends every known descendant: each is stopped first (SIGSTOP, so it can start nothing more), the
   * tree is sampled again until nothing new appears, then all are killed (SIGKILL) and the table is read once more.
   */
  endAll(): Promise<{ killed: number; survivors: number[] }> {
    return (this.ended ??= this.end());
  }
  private async end(): Promise<{ killed: number; survivors: number[] }> {
    clearInterval(this.timer);
    const signal = (pids: number[], sig: NodeJS.Signals) => {
      for (const pid of pids)
        try {
          process.kill(pid, sig);
        } catch {
          // already gone
        }
    };
    for (let round = 0; round < 10; round++) {
      const added = await this.sample();
      const now = await this.running();
      if (now) signal(now, 'SIGSTOP');
      if (!added) break;
    }
    const first = (await this.running()) ?? [...this.known.keys()];
    signal(first, 'SIGKILL');
    signal(first, 'SIGCONT');
    await new Promise((done) => setTimeout(done, 50));
    const survivors = (await this.running()) ?? [];
    return { killed: first.length - survivors.length, survivors };
  }
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
export function runEva03Job(spec: Eva03JobSpec): Promise<Eva03JobResult> {
  const { onLedgerEvent, ...rest } = spec;
  return runEvaJob({
    ...rest,
    evaClass: 'eva-03',
    onEvent: ({ phase, ...e }) => onLedgerEvent?.({ ...e, kind: `eva03.${phase}`, evaClass: 'eva-03' }),
  });
}

/**
 * F-049-T07: runs one job of any EVA class in a fresh Seatbelt instance of that class's profile, discards it after,
 * and reports its outcome and uncertainty without claiming rollback. Its limits are the class's.
 */
export async function runEvaJob(spec: EvaJobSpec): Promise<Eva03JobResult> {
  if (process.platform !== 'darwin') {
    throw new EvaSandboxUnavailableError(`The EVA Seatbelt runner requires macOS (got ${process.platform}).`);
  }
  const sandboxExec = spec.sandboxExecPath ?? DEFAULT_SANDBOX_EXEC_PATH;
  if (!existsSync(sandboxExec)) {
    throw new EvaSandboxUnavailableError(`EVA confinement binary missing: ${sandboxExec}`);
  }

  const cls = EVA_CLASS_SPECS[spec.evaClass];
  const timeoutMs = Math.min(spec.timeoutMs ?? cls.resources.maxWallMs, cls.resources.maxWallMs);
  const maxOutputBytes = Math.min(spec.maxOutputBytes ?? cls.resources.maxOutputBytes, cls.resources.maxOutputBytes);
  const hostHomeDir = process.env.HOME || tmpdir();

  const tag = spec.evaClass.replace('-', '');
  const instanceDir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), `nerv-${tag}-${spec.jobId}-`)));
  const workspaceDir = join(instanceDir, 'workspace');
  const profilePath = join(instanceDir, `${tag}.sb`);
  const startedAt = Date.now();

  let workspaceDiscarded = false;
  let tracker: DescendantTracker | undefined;
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(workspaceDir, { recursive: true });
    const profile = buildEvaSeatbeltProfile(spec.evaClass, {
      workspaceDir,
      hostHomeDir,
      nervStateDir: spec.nervStateDir,
      readOnlyPaths: spec.readOnlyPaths,
      deniedReadPaths: spec.deniedReadPaths,
      readableStateFiles: spec.readableStateFiles,
      writablePaths: spec.writablePaths,
      egress: spec.egress,
    });
    writeFileSync(profilePath, profile, 'utf8');

    spec.onEvent?.({
      jobId: spec.jobId,
      phase: 'started',
      evaClass: spec.evaClass,
      rollbackClaimed: false,
      uncertainExternalEffect: false,
      containment: 'best-effort',
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
      if (child.pid) tracker = new DescendantTracker(child.pid, spec.psPath ?? '/bin/ps');

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

    // B-099: whatever the job started and left running ends with it, whether it timed out, was cancelled or exited.
    const ended = tracker ? await tracker.endAll() : { killed: 0, survivors: [] };
    const tracked = tracker?.tracked ?? false;
    const phase: EvaPhase = outcome.cancelled
      ? 'cancelled'
      : outcome.timedOut
        ? 'timed_out'
        : outcome.exitCode === 0
          ? 'completed'
          : 'failed';
    // A job that left processes running, or whose processes could not be listed, did not end cleanly either.
    const uncertain =
      outcome.cancelled ||
      outcome.timedOut ||
      outcome.exitCode !== 0 ||
      ended.survivors.length > 0 ||
      ended.killed > 0 ||
      !tracked;
    const survivorNote = [
      !tracked ? 'The process table could not be read: what the job left running is unknown.' : '',
      ended.killed ? `Ended ${ended.killed} process(es) the job left running.` : '',
      ended.survivors.length ? `Processes still running after the job ended: ${ended.survivors.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    spec.onEvent?.({
      jobId: spec.jobId,
      phase,
      evaClass: spec.evaClass,
      rollbackClaimed: false,
      uncertainExternalEffect: uncertain,
      containment: 'best-effort',
      detail: [survivorNote, outcome.stderr.slice(0, 400)].filter(Boolean).join(' ') || undefined,
    });

    rmSync(instanceDir, { recursive: true, force: true });
    workspaceDiscarded = !existsSync(instanceDir);

    return {
      jobId: spec.jobId,
      ...outcome,
      workspaceDiscarded,
      rollbackClaimed: false,
      descendantsKilled: ended.killed,
      survivors: ended.survivors,
      tracked,
      containment: 'best-effort',
      durationMs: Date.now() - startedAt,
    };
  } finally {
    // A launch error never reached endAll: stop sampling and end anything it started.
    if (tracker) await tracker.endAll().catch(() => undefined);
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
  /** Where the granted MCP servers' own files live (read-only); the tools process starts them inside the instance. */
  readonly readOnlyPaths?: readonly string[];
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onLedgerEvent?: (event: Eva03LedgerEvent) => void;
}): Promise<Eva03JobResult> {
  const toolsEntry = join(options.repoRoot, 'src', 'tools-process.ts');
  // B-100: one listing, printed, then exit: the instance has no IPC channel to the coordinator.
  const args = options.home ? [toolsEntry, options.home, '--list'] : [toolsEntry, '--list'];
  return runEva03Job({
    jobId: options.jobId,
    command: process.execPath,
    args,
    nervStateDir: options.home,
    // B-100 (owner decision (b)): config.json is the one file of the NERV home the tools process reads.
    ...(options.home ? { readableStateFiles: ['config.json'] } : {}),
    readOnlyPaths: [
      join(options.repoRoot, 'src'),
      join(options.repoRoot, 'node_modules'),
      join(options.repoRoot, 'package.json'),
      ...(options.readOnlyPaths ?? []),
    ],
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onLedgerEvent: options.onLedgerEvent,
  });
}
