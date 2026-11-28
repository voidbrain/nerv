import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
/**
 * Node flags for every NERV process: trust the operating system's certificates as well as Node's own, so HTTPS works
 * behind TLS-inspecting networks (company laptops). Kept equal to package.json "start" and the service units by test.
 */
export const NODE_FLAGS = ['--use-system-ca'] as const;
/** How long a caller waits for a child's READY before giving up (nothing is sent before it). */
export const STARTUP_MS = 30_000;
export const MAX_CHILD_REQUESTS = 32;
/** B-126-T02: how much of a child's error output a not-ready error quotes. */
const STDERR_TAIL_CHARS = 4000;
const STDERR_TAIL_LINES = 8;
import { randomUUID } from 'node:crypto';
import { MAX_FRAME_BYTES, READY, validateParams, authorize, type Method, RpcFault } from './rpc.ts';
export class ProcessClient {
  readonly child: ChildProcess;
  readonly role: 'nervous' | 'brain' | 'tools';
  private timeoutMs: number;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private closed = false;
  private waiting = 0;
  /** Settles once the child says it is ready (READY), or when it exits or fails to start. A call's own timer starts only
     after this, so a slow start-up (a busy machine, the first run after boot) never counts against the call (B-007). */
  private readonly ready: Promise<boolean>;
  private isReady = false;
  private readonly startupMs: number;
  /** B-126-T02: when the child was started, and the last of its error output, to say why it never became ready. */
  private readonly startedAt = Date.now();
  private stderrTail = '';
  private stderrDone: Promise<void> = Promise.resolve();
  private lastStep?: { step: string; atMs: number };
  /** F-148-T02: the brain's list of model calls in flight, sent on every change without being asked. */
  onThinking?: (entries: unknown) => void;
  constructor(
    entry: URL,
    args: string[],
    role: 'nervous' | 'brain' | 'tools',
    timeoutMs = 5000,
    startupMs = STARTUP_MS,
  ) {
    this.role = role;
    this.timeoutMs = timeoutMs;
    this.startupMs = startupMs;
    let settle: (ok: boolean) => void = () => {};
    this.ready = new Promise<boolean>((done) => {
      settle = done;
    });
    // Explicit small environment: no provider/API/root token passed to children. Same-user process isolation is NOT a sandbox.
    this.child = fork(entry, args, {
      // B-126-T02: error output is piped (and passed on to ours unchanged) so a failed start can quote its last lines.
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH ?? '',
        LANG: process.env.LANG ?? 'C.UTF-8',
        // F-121-T02: children of a test run know it, so they refuse to open desktop apps (src/slicer.ts).
        ...(process.env.NODE_TEST_CONTEXT || process.env.NERV_TEST_RUNNER ? { NERV_TEST_RUNNER: '1' } : {}),
      },
      execArgv: [...NODE_FLAGS],
    });
    const stderr = this.child.stderr;
    if (stderr) {
      this.stderrDone = new Promise<void>((done) => {
        stderr.once('close', done);
        stderr.once('error', () => done());
      });
      stderr.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk);
        this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_CHARS);
      });
    }
    this.child.on('message', (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const step = (value as { nerv?: unknown; step?: unknown }).step;
      if ((value as { nerv?: unknown }).nerv === 'starting' && typeof step === 'string') {
        this.lastStep = { step: step.slice(0, 80), atMs: Date.now() - this.startedAt };
        return;
      }
      if ((value as { nerv?: unknown }).nerv === 'thinking') {
        this.onThinking?.((value as { entries?: unknown }).entries);
        return;
      }
      if ((value as { nerv?: unknown }).nerv === READY.nerv) {
        this.isReady = true;
        settle(true);
        return;
      }
      const reply = value as Record<string, unknown>;
      if (reply.jsonrpc !== '2.0' || typeof reply.id !== 'string') return;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(reply.id);
      if (Buffer.byteLength(JSON.stringify(reply)) > MAX_FRAME_BYTES) {
        pending.reject(new RpcFault(-32005, 'Child response exceeds IPC bound.'));
        return;
      }
      if ('error' in reply) {
        const e = reply.error as { code?: number; message?: string };
        pending.reject(new RpcFault(e?.code ?? -32603, e?.message ?? 'Child error.'));
      } else if ('result' in reply) pending.resolve(reply.result);
      else pending.reject(new Error('Invalid child response.'));
    });
    const fail = () => {
      this.closed = true;
      settle(false);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(`${role} process unavailable.`));
      }
      this.pending.clear();
    };
    this.child.once('exit', fail);
    this.child.once('error', fail);
    this.child.once('disconnect', fail);
  }
  async call(method: Method, params: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<unknown> {
    authorize('coordinator', this.role, method);
    validateParams(method, params);
    if (this.closed || !this.child.connected) throw new Error(`${this.role} process unavailable.`);
    if (this.waiting + this.pending.size >= MAX_CHILD_REQUESTS) throw new RpcFault(-32004, 'Process queue is full.');
    this.waiting++;
    let sent = false;
    try {
      if (!this.isReady) {
        let timer: NodeJS.Timeout | undefined;
        const ok = await Promise.race([
          this.ready,
          new Promise<false>((done) => {
            timer = setTimeout(() => done(false), this.startupMs);
          }),
        ]);
        clearTimeout(timer);
        if (!ok)
          throw new RpcFault(-32006, `${this.role} process not ready; nothing was sent. ${await this.whyNotReady()}`);
        if (this.closed || !this.child.connected) throw new Error(`${this.role} process unavailable.`);
      }
      const id = randomUUID(),
        request = { jsonrpc: '2.0', id, method, params };
      if (Buffer.byteLength(JSON.stringify(request)) > MAX_FRAME_BYTES) throw new RpcFault(-32600, 'Frame too large.');
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new RpcFault(-32001, `${this.role} ${method} timed out after ${timeoutMs} ms; outcome may be unknown.`),
          );
        }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        sent = true;
        this.waiting--;
        this.child.send(request, (error) => {
          if (error) {
            const p = this.pending.get(id);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(id);
              p.reject(error);
            }
          }
        });
      });
    } finally {
      if (!sent) this.waiting--;
    }
  }
  /** B-126-T02: how the child stands when it did not become ready: its exit code and signal, or that it is still
     running at the deadline, with the last lines of its error output. */
  private async whyNotReady(): Promise<string> {
    const waited = Date.now() - this.startedAt;
    const brief = (ms: number) => new Promise<void>((done) => setTimeout(done, ms).unref());
    // A child that ended says so on 'disconnect' before 'exit' sets its code; its last output may still be in the pipe.
    if (this.closed) {
      if (this.child.exitCode === null && this.child.signalCode === null)
        await Promise.race([once(this.child, 'exit'), brief(1000)]);
      await Promise.race([this.stderrDone, brief(500)]);
    }
    const exited = this.child.exitCode !== null || this.child.signalCode !== null;
    const state = exited
      ? `It ${this.child.signalCode ? `was ended by signal ${this.child.signalCode}` : `exited with code ${this.child.exitCode}`} after ${waited} ms`
      : this.child.pid === undefined
        ? `It did not start after ${waited} ms`
        : this.closed
          ? `It closed its channel after ${waited} ms; still running (pid ${this.child.pid})`
          : `It sent no READY after ${this.startupMs} ms; still running (pid ${this.child.pid})`;
    const lines = this.stderrTail
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^(at |\^+$|Node\.js v|node:internal|\{$|\}$)/.test(l))
      .slice(-STDERR_TAIL_LINES);
    const output = lines.length ? lines.join(' | ') : 'none';
    const step = this.lastStep
      ? `last start-up step: ${this.lastStep.step}, reported ${this.lastStep.atMs} ms after start`
      : 'no start-up step reported';
    return `${state}; ${step}; last error output: ${output}${output.endsWith('.') ? '' : '.'}`;
  }
  /** SIGTERM, SIGKILL after 2 s; resolves on exit, or 2 s after SIGKILL at the latest (B-118: never waits forever). */
  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      let last: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        this.child.kill('SIGKILL');
        last = setTimeout(resolve, 2000);
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        clearTimeout(last);
        resolve();
      });
      this.child.kill('SIGTERM');
    });
  }
}
