import { execFile, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { EVA_CLASS_SPECS } from './eva-classes.ts';
import { EVA_DENIED_LOCAL_PORTS } from './policy.ts';
import {
  startEgressProxy,
  type EgressDecision,
  type EgressLookupResult,
  type EgressProxyHandle,
} from './egress-proxy.ts';
import { asJobUser, endJobUser, stageRuntime, type EvaJobUser } from './eva-job-user.ts';
import type { EvaClass } from './pilots.ts';

export const DEFAULT_SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';
export const DEFAULT_BWRAP_PATH = '/usr/bin/bwrap';

export class EvaSandboxUnavailableError extends Error {
  constructor(message = 'EVA confinement requires /usr/bin/sandbox-exec on macOS or /usr/bin/bwrap on Linux.') {
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
  /** B-099-T02: see EvaJobSpec.jobUser. */
  readonly jobUser?: EvaJobUser;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
  readonly sandboxExecPath?: string;
  /** F-049-T10: Linux Bubblewrap binary path; tests point it at unconfined-bwrap. */
  readonly bwrapPath?: string;
  readonly onLedgerEvent?: (event: Eva03LedgerEvent) => void;
  /** Lists processes for B-099's tracking; tests point it at a missing binary to see tracking fail. */
  readonly psPath?: string;
  /** F-112-T03: optional line-delimited stdin/stdout bridge for gated EVA-03 script plans. */
  readonly onBridgeLine?: (line: string, send: (replyLine: string) => void) => void;
  readonly maxBridgeLineBytes?: number;
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
  /** F-027-T02: Scrolls `egressAllow` destinations enforced via a per-job localhost egress proxy. */
  readonly scrollsEgressAllow?: readonly string[];
  readonly onEgressDecision?: (decision: EgressDecision) => void;
  readonly egressLookup?: (host: string) => Promise<readonly EgressLookupResult[]>;
  readonly onEvent?: (event: EvaJobEvent) => void;
  /**
   * B-099-T02: run the job as this dedicated user (docs/guides/eva-job-user.md). Its instance lives in the shared
   * folder, and at the end every process of that user is killed and the table is checked.
   */
  readonly jobUser?: EvaJobUser;
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
export { EVA_DENIED_LOCAL_PORTS };

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

const within = (path: string, root: string) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const overlaps = (a: string, b: string) => within(a, b) || within(b, a);

function validateEvaSandboxOptions(
  evaClass: EvaClass,
  options: Eva03SeatbeltOptions & Pick<EvaJobSpec, 'writablePaths' | 'egress'>,
) {
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
  for (const w of writable)
    if (deniedReads.some((d) => overlaps(w, d)))
      throw new Error(`${w}: no EVA class writes in $HOME, NERV state or a denied path, or in a folder holding one.`);
  const neverRead = [...(stateDir ? [stateDir] : []), ...denied];
  for (const r of readOnly)
    if (within(homeDir, r) || neverRead.some((d) => overlaps(r, d)))
      throw new Error(`${r} re-opens NERV state or a denied path (or holds $HOME); it cannot be a read-only input.`);
  const stateFiles = (options.readableStateFiles ?? []).map((name) => {
    if (!stateDir) throw new Error('readableStateFiles needs nervStateDir.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw new Error(`Not a plain file name: ${name}`);
    return join(stateDir, name);
  });
  return { spec, egress, writable, workspace, homeDir, stateDir, readOnly, deniedReads, neverRead, stateFiles };
}

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
  const { egress, writable, workspace, readOnly, deniedReads, neverRead, stateFiles } = validateEvaSandboxOptions(
    evaClass,
    options,
  );

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
  for (const f of stateFiles) lines.push(`(allow file-read* (literal "${escapeSbString(f)}"))`);
  // Resolving a path (Node's realpath) stats every directory above it, which may sit inside the denied $HOME or state:
  // the metadata of those directories only, never their listing or any other file in them.
  const ancestors = new Set<string>();
  for (const p of [...readOnly, ...stateFiles])
    for (let d = dirname(p); d !== dirname(d); d = dirname(d)) ancestors.add(d);
  for (const d of ancestors) lines.push(`(allow file-read-metadata (literal "${escapeSbString(d)}"))`);
  return `${lines.join('\n')}\n`;
}

/**
 * F-049-T10: Bubblewrap (`bwrap`) arguments for one job of a class on Linux (decisions/eva-linux-enforcement.md).
 * Starts from an empty rootfs, isolates PIDs (`--unshare-pid --die-with-parent`), and drops networking (`--unshare-net`)
 * for EVA-03 and EVA-00.
 */
export function buildEvaBwrapArgs(
  evaClass: EvaClass,
  options: Eva03SeatbeltOptions &
    Pick<EvaJobSpec, 'writablePaths' | 'egress'> & { command: string; args: readonly string[] },
): string[] {
  const { spec, writable, workspace, homeDir, neverRead, readOnly, stateFiles } = validateEvaSandboxOptions(
    evaClass,
    options,
  );
  const args: string[] = ['--die-with-parent', '--unshare-pid', '--new-session'];
  if (spec.network.mode === 'deny') args.push('--unshare-net');
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp');

  const sysRo = ['/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc/ld.so.cache', '/etc/alternatives'];
  if (spec.network.mode !== 'deny') sysRo.push('/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/ssl');
  for (const p of sysRo) args.push('--ro-bind-try', p, p);

  // Bind the executable's runtime prefix (e.g. setup-node's /opt/hostedtoolcache/...) when outside /usr.
  const cmdReal = canonicalExistingPath(options.command);
  const cmdDir = dirname(cmdReal);
  const cmdRoot = cmdDir.endsWith('/bin') ? dirname(cmdDir) : cmdDir;
  if (
    isAbsolute(cmdRoot) &&
    cmdRoot !== '/' &&
    !sysRo.some((s) => within(cmdRoot, s)) &&
    !within(homeDir, cmdRoot) &&
    !neverRead.some((d) => overlaps(cmdRoot, d))
  ) {
    args.push('--ro-bind', cmdRoot, cmdRoot);
  }

  for (const p of readOnly) args.push('--ro-bind', p, p);
  args.push('--dir', workspace, '--bind', workspace, workspace, '--chdir', workspace);
  for (const w of writable) args.push('--bind', w, w);
  for (const f of stateFiles) if (existsSync(f)) args.push('--ro-bind', f, f);
  args.push('--', options.command, ...options.args);
  return args;
}

export function buildEva03CleanEnv(
  workspaceDir: string,
  commandPath: string,
  extraEnv?: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const cmdDir = dirname(commandPath);
  const basePath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';
  return {
    PATH: cmdDir && !basePath.split(':').includes(cmdDir) ? `${cmdDir}:${basePath}` : basePath,
    HOME: workspaceDir,
    TMPDIR: workspaceDir,
    NODE_NO_WARNINGS: '1',
    ...extraEnv,
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
  const isDarwin = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  if (!isDarwin && !isLinux) {
    throw new EvaSandboxUnavailableError(`The EVA runner requires macOS or Linux (got ${process.platform}).`);
  }
  const sandboxBin = isDarwin
    ? (spec.sandboxExecPath ?? DEFAULT_SANDBOX_EXEC_PATH)
    : (spec.bwrapPath ?? DEFAULT_BWRAP_PATH);
  if (!existsSync(sandboxBin)) {
    throw new EvaSandboxUnavailableError(`EVA confinement binary missing: ${sandboxBin}`);
  }
  if (isLinux && spec.jobUser) {
    throw new EvaSandboxUnavailableError('jobUser (_nervjob) is macOS-only; Linux uses bwrap namespaces.');
  }

  const cls = EVA_CLASS_SPECS[spec.evaClass];
  const timeoutMs = Math.min(spec.timeoutMs ?? cls.resources.maxWallMs, cls.resources.maxWallMs);
  const maxOutputBytes = Math.min(spec.maxOutputBytes ?? cls.resources.maxOutputBytes, cls.resources.maxOutputBytes);
  const hostHomeDir = process.env.HOME || tmpdir();

  const tag = spec.evaClass.replace('-', '');
  // B-099-T02: a job user cannot open the owner's temp folder; its instances live in the shared folder.
  const instanceRoot = spec.jobUser ? realpathSync(spec.jobUser.sharedRoot) : realpathSync(tmpdir());
  const instanceDir = realpathSync(mkdtempSync(join(instanceRoot, `nerv-${tag}-${spec.jobId}-`)));
  const workspaceDir = join(instanceDir, 'workspace');
  const profilePath = join(instanceDir, `${tag}.sb`);
  const startedAt = Date.now();

  let workspaceDiscarded = false;
  let tracker: DescendantTracker | undefined;
  let egressProxy: EgressProxyHandle | undefined;
  try {
    if (spec.scrollsEgressAllow !== undefined) {
      if (cls.network.mode === 'deny') {
        if (spec.scrollsEgressAllow.length > 0) throw new Error(`${spec.evaClass} has no network.`);
      } else {
        if (isLinux) {
          throw new EvaSandboxUnavailableError(
            'Scrolls egress confinement for eva-01/eva-02 is not enforced on Linux bwrap (host network namespace cannot block direct sockets).',
          );
        }
        if (spec.egress?.anyHost?.length || spec.egress?.localhost?.length) {
          throw new Error('scrollsEgressAllow cannot be combined with raw egress port grants.');
        }
        egressProxy = await startEgressProxy({
          allowedDestinations: spec.scrollsEgressAllow,
          lookup: spec.egressLookup,
          onDecision: spec.onEgressDecision,
        });
      }
    }
    const effectiveEgress = egressProxy ? { localhost: [egressProxy.port] } : spec.egress;
    const proxyEnv = egressProxy
      ? {
          HTTP_PROXY: egressProxy.url,
          HTTPS_PROXY: egressProxy.url,
          http_proxy: egressProxy.url,
          https_proxy: egressProxy.url,
          NO_PROXY: '',
        }
      : undefined;

    const { mkdirSync } = await import('node:fs');
    mkdirSync(workspaceDir, { recursive: true });
    if (spec.jobUser) {
      // The job user reads the profile and writes only its workspace; the instance folder stays the owner's.
      chmodSync(instanceDir, 0o711);
      chmodSync(workspaceDir, 0o777);
    }
    const sandboxArgs = isDarwin
      ? (() => {
          const profile = buildEvaSeatbeltProfile(spec.evaClass, {
            workspaceDir,
            hostHomeDir,
            nervStateDir: spec.nervStateDir,
            readOnlyPaths: spec.readOnlyPaths,
            deniedReadPaths: spec.deniedReadPaths,
            readableStateFiles: spec.readableStateFiles,
            writablePaths: spec.writablePaths,
            egress: effectiveEgress,
          });
          writeFileSync(profilePath, profile, 'utf8');
          return ['-f', profilePath, spec.command, ...spec.args];
        })()
      : buildEvaBwrapArgs(spec.evaClass, {
          workspaceDir,
          hostHomeDir,
          nervStateDir: spec.nervStateDir,
          readOnlyPaths: spec.readOnlyPaths,
          deniedReadPaths: spec.deniedReadPaths,
          readableStateFiles: spec.readableStateFiles,
          writablePaths: spec.writablePaths,
          egress: effectiveEgress,
          command: spec.command,
          args: spec.args,
        });

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
      const launch = spec.jobUser
        ? asJobUser(spec.jobUser, sandboxBin, sandboxArgs)
        : { command: sandboxBin, args: sandboxArgs };
      const child = spawn(launch.command, launch.args, {
        cwd: workspaceDir,
        env: buildEva03CleanEnv(workspaceDir, spec.command, proxyEnv),
        detached: true,
        stdio: [spec.onBridgeLine ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
      if (child.pid) tracker = new DescendantTracker(child.pid, spec.psPath ?? '/bin/ps');

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let outputTruncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      let bridgeBuf = '';
      const bridgeDecoder = spec.onBridgeLine ? new StringDecoder('utf8') : undefined;
      const maxBridgeBytes = spec.maxBridgeLineBytes ?? 48 * 1024;
      const sendToChild = (replyLine: string) => {
        if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) return;
        child.stdin.write(`${replyLine}\n`);
      };

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

      child.stdout?.on('data', (chunk: Buffer) => {
        appendChunk(stdoutChunks, chunk);
        if (spec.onBridgeLine && bridgeDecoder) {
          bridgeBuf += bridgeDecoder.write(chunk);
          for (;;) {
            const nl = bridgeBuf.indexOf('\n');
            if (nl < 0) {
              if (Buffer.byteLength(bridgeBuf, 'utf8') > maxBridgeBytes) {
                bridgeBuf = '';
                if (child.pid) terminateProcessGroup(child.pid);
                spec.onBridgeLine(
                  JSON.stringify({ kind: 'error', reason: 'Bridge frame exceeds budget' }),
                  sendToChild,
                );
              }
              break;
            }
            const line = bridgeBuf.slice(0, nl).trim();
            bridgeBuf = bridgeBuf.slice(nl + 1);
            if (line) spec.onBridgeLine(line, sendToChild);
          }
        }
      });
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
    const sampled = tracker ? await tracker.endAll() : { killed: 0, survivors: [] };
    // B-099-T02: with a job user, everything it runs is killed and the table checked: nothing it started can hide.
    const byUser = spec.jobUser ? await endJobUser(spec.jobUser) : undefined;
    const ended = {
      killed: sampled.killed,
      survivors: [...new Set([...sampled.survivors, ...(byUser?.survivors ?? [])])],
    };
    const tracked = (tracker?.tracked ?? false) && (byUser?.tracked ?? true);
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

    if (spec.jobUser) await removeAsJobUser(spec.jobUser, sandboxBin, instanceDir, workspaceDir);
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
    if (egressProxy) await egressProxy.close().catch(() => undefined);
    // A launch error never reached endAll: stop sampling and end anything it started.
    if (tracker) await tracker.endAll().catch(() => undefined);
    if (spec.jobUser && !workspaceDiscarded) {
      await endJobUser(spec.jobUser).catch(() => undefined);
      await removeAsJobUser(spec.jobUser, sandboxBin, instanceDir, workspaceDir).catch(() => undefined);
    }
    if (!workspaceDiscarded && existsSync(instanceDir)) {
      rmSync(instanceDir, { recursive: true, force: true });
    }
  }
}

/**
 * B-099-T02: files the job user wrote belong to it, so it removes them itself, through sandbox-exec (the only command
 * the sudo rule allows besides kill) with writes limited to the workspace.
 */
async function removeAsJobUser(user: EvaJobUser, sandboxExec: string, instanceDir: string, workspaceDir: string) {
  if (!existsSync(workspaceDir)) return;
  const profile = join(instanceDir, 'cleanup.sb');
  writeFileSync(
    profile,
    `(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write* (subpath "${escapeSbString(workspaceDir)}"))\n`,
  );
  chmodSync(profile, 0o644);
  const { command, args } = asJobUser(user, sandboxExec, ['-f', profile, '/bin/rm', '-rf', workspaceDir]);
  await new Promise<void>((done) => {
    const c = spawn(command, args, { stdio: 'ignore' });
    c.on('close', () => done());
    c.on('error', () => done());
  });
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
  /** B-099-T02: run as the job user, from a read-only runtime copy in the shared folder. */
  readonly jobUser?: EvaJobUser;
}): Promise<Eva03JobResult> {
  if (options.jobUser) return runToolsAsJobUser({ ...options, jobUser: options.jobUser });
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

/**
 * B-099-T02: the tools process as the job user. It cannot open the owner's home, so it runs from the runtime copy in
 * the shared folder, and reads a copy of config.json alone (owner decision (b), B-100), removed after the job.
 */
async function runToolsAsJobUser(
  options: Parameters<typeof runToolsProcessInEva03>[0] & { jobUser: EvaJobUser },
): Promise<Eva03JobResult> {
  const runtime = stageRuntime(options.jobUser, options.repoRoot);
  const configDir = options.home
    ? realpathSync(mkdtempSync(join(realpathSync(options.jobUser.sharedRoot), 'nerv-config-')))
    : undefined;
  try {
    if (configDir) {
      chmodSync(configDir, 0o711);
      const source = join(options.home!, 'config.json');
      if (existsSync(source)) {
        copyFileSync(source, join(configDir, 'config.json'));
        chmodSync(join(configDir, 'config.json'), 0o644);
      }
    }
    return await runEva03Job({
      jobId: options.jobId,
      command: runtime.node,
      args: [join(runtime.src, 'tools-process.ts'), ...(configDir ? [configDir] : []), '--list'],
      readOnlyPaths: [runtime.dir, ...(configDir ? [configDir] : []), ...(options.readOnlyPaths ?? [])],
      ...(options.home ? { nervStateDir: options.home } : {}),
      jobUser: options.jobUser,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onLedgerEvent: options.onLedgerEvent,
    });
  } finally {
    if (configDir) rmSync(configDir, { recursive: true, force: true });
  }
}
