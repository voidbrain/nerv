import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { DesktopDriver, DesktopWindowSnapshot } from './desktop-control.ts';
import type { DisplayBounds, FrontmostAppMetadata } from './desktop-recording.ts';
import {
  createDesktopControl,
  refusingDesktopControl,
  type DesktopControl,
  type DesktopInputSession,
  type MouseSample,
} from './desktop-service.ts';
import { underTestRunner } from './slicer.ts';

/** The JXA helper next to the sources' parent (`native/desktop-ax.js`). */
export const MAC_DESKTOP_HELPER = fileURLToPath(new URL('../native/desktop-ax.js', import.meta.url));

export const MAC_ACCESSIBILITY_GRANT_HINT =
  'Grant it to the app that runs nerv (your terminal for the CLI, node for the service) in System Settings > Privacy & Security > Accessibility, then run the command again. NERV never changes this setting itself. The first window read also asks once to let it control System Events (Automation).';

export interface HelperResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `osascript -l JavaScript <helper> <command> <json>`; replaceable in tests. */
export type MacHelperRunner = (args: readonly string[]) => HelperResult;

export interface MacDesktopDriverOptions {
  readonly helperPath?: string;
  readonly osascript?: string;
  readonly runner?: MacHelperRunner;
  readonly timeoutMs?: number;
}

const MAX_OUTPUT = 4 * 1024 * 1024;

function helperError(result: HelperResult): string {
  try {
    const parsed = JSON.parse(result.stderr) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // not JSON: fall through to the raw text
  }
  return result.stderr.trim() || `desktop helper exited with status ${result.status}`;
}

/**
 * Calls one command of a JXA helper (`osascript -l JavaScript <helper> <command> <json>`) and parses its JSON
 * answer; arguments travel as JSON data, never as script text. Shared by the desktop and app-workflow helpers.
 */
export function macHelperCaller(
  label: string,
  helper: string,
  options: Omit<MacDesktopDriverOptions, 'helperPath'> = {},
): (command: string, args?: Record<string, unknown>) => unknown {
  const runner: MacHelperRunner =
    options.runner ??
    ((args) => {
      const r = spawnSync(options.osascript ?? 'osascript', ['-l', 'JavaScript', helper, ...args], {
        encoding: 'utf8',
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: MAX_OUTPUT,
      });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? r.error.message : '') };
    });
  return (command, args = {}) => {
    const result = runner([command, JSON.stringify(args)]);
    if (result.status !== 0) throw new Error(`${label} ${command} failed: ${helperError(result)}`);
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(`${label} ${command} returned unreadable output.`);
    }
  };
}

function asWindow(value: unknown): DesktopWindowSnapshot {
  const v = value as Partial<DesktopWindowSnapshot>;
  if (typeof v?.appName !== 'string' || typeof v.windowTitle !== 'string' || !Array.isArray(v.controls)) {
    throw new Error('Desktop helper returned an unreadable window snapshot.');
  }
  return {
    appName: v.appName,
    ...(typeof v.bundleId === 'string' ? { bundleId: v.bundleId } : {}),
    windowTitle: v.windowTitle,
    controls: v.controls
      .filter((c) => typeof c?.name === 'string' && typeof c.role === 'string')
      .map((c) => ({ name: c.name, role: c.role, ...(c.isPassword === true ? { isPassword: true } : {}) })),
    summaryText: typeof v.summaryText === 'string' ? v.summaryText : '',
  };
}

/**
 * F-093-T05: the live macOS binding of the shared desktop driver. A small JXA helper reads and presses
 * controls through the Accessibility API (System Events); the permission check uses AXIsProcessTrusted
 * without the prompt option, so NERV never asks for or changes the grant itself.
 */
export function createMacDesktopDriver(options: MacDesktopDriverOptions = {}): DesktopDriver {
  const call = macHelperCaller('Desktop helper', options.helperPath ?? MAC_DESKTOP_HELPER, options);

  return {
    checkAccessibilityPermission() {
      try {
        return (call('permission') as { granted?: unknown }).granted === true;
      } catch {
        return false;
      }
    },
    accessibilityGrantHint: () => MAC_ACCESSIBILITY_GRANT_HINT,
    async getWindow(appName, windowTitle) {
      return asWindow(call('window', { app: appName, ...(windowTitle ? { window: windowTitle } : {}) }));
    },
    async pressControl(appName, windowTitle, controlName) {
      return asWindow(call('press', { app: appName, window: windowTitle, control: controlName }));
    },
    async getDisplayBounds() {
      return call('display') as DisplayBounds;
    },
    async getFrontmostApp() {
      return call('frontmost') as FrontmostAppMetadata;
    },
  };
}

const UNSUPPORTED = 'Desktop control has a live driver on macOS only; Windows UI Automation is not bound yet.';

/** The live desktop driver for this platform: the macOS helper, or a driver that refuses with the reason. */
export function desktopDriverFor(platform: NodeJS.Platform, options: MacDesktopDriverOptions = {}): DesktopDriver {
  if (platform === 'darwin') return createMacDesktopDriver(options);
  const refuse = async (): Promise<never> => {
    throw new Error(UNSUPPORTED);
  };
  return {
    checkAccessibilityPermission: () => false,
    accessibilityGrantHint: () => UNSUPPORTED,
    getWindow: refuse,
    pressControl: refuse,
    getDisplayBounds: refuse,
    getFrontmostApp: refuse,
  };
}

export interface MacInputSessionOptions {
  /** Starts the helper's `session` command; tests start a fake that speaks the same line protocol. */
  readonly spawn?: () => ChildProcessWithoutNullStreams;
  readonly requestTimeoutMs?: number;
}

const MOUSE_EVENT_KINDS = new Set(['mouseMove', 'mouseDown', 'mouseUp']);

/**
 * F-092-T05: one long-lived helper process per replay (`desktop-ax.js session`), so each event costs a pipe round
 * trip rather than an osascript start. One JSON request per line in, one JSON answer per line out, matched by id.
 * Only mouse events are sent: a key event is refused here, before it reaches the helper (which refuses it too).
 */
export function openMacInputSession(options: MacInputSessionOptions = {}): DesktopInputSession {
  const child =
    options.spawn?.() ??
    spawn('osascript', ['-l', 'JavaScript', MAC_DESKTOP_HELPER, 'session'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const timeoutMs = options.requestTimeoutMs ?? 10_000;
  const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void }>();
  let nextId = 1;
  let buffer = '';
  let stopped: Error | undefined;
  const failAll = (error: Error) => {
    stopped ??= error;
    for (const p of pending.values()) p.reject(stopped);
    pending.clear();
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let answer: Record<string, unknown>;
      try {
        answer = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const waiter = typeof answer.id === 'number' ? pending.get(answer.id) : undefined;
      if (!waiter) continue;
      pending.delete(answer.id as number);
      if (typeof answer.error === 'string') waiter.reject(new Error(`Desktop input: ${answer.error}`));
      else waiter.resolve(answer);
    }
  });
  child.stderr.resume();
  // A helper that closes its input makes the next write fail with EPIPE: that fails the replay, never the service.
  child.stdin.on('error', (e) => failAll(new Error(`The desktop input helper stopped: ${e.message}`)));
  child.on('error', (e) => failAll(new Error(`The desktop input helper stopped: ${e.message}`)));
  child.on('exit', (code) => failAll(new Error(`The desktop input helper stopped (exit ${code ?? 'signal'}).`)));

  const request = (cmd: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    if (stopped) return Promise.reject(stopped);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`The desktop input helper did not answer ${cmd} in ${timeoutMs / 1000} s.`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin.write(`${JSON.stringify({ id, cmd, ...extra })}\n`);
    });
  };

  return {
    async dispatchEvent(event) {
      if (!MOUSE_EVENT_KINDS.has(event.kind)) throw new Error('The desktop input session replays only mouse events.');
      await request('post', {
        event: { kind: event.kind, x: event.x, y: event.y, ...(event.button ? { button: event.button } : {}) },
      });
    },
    async hasOwnerInput() {
      return (await request('owner')).input === true;
    },
    async getFrontmostApp() {
      return (await request('frontmost')).frontmost as FrontmostAppMetadata;
    },
    async releaseButtons() {
      await request('release');
    },
    close() {
      failAll(new Error('The desktop input session is closed.'));
      child.stdin.end();
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      }, 1000).unref();
    },
  };
}

function asSamples(value: unknown): MouseSample[] {
  const samples = (value as { samples?: unknown })?.samples;
  if (!Array.isArray(samples)) throw new Error('Desktop helper returned unreadable mouse samples.');
  return samples as MouseSample[];
}

/** Polls the pointer for a bounded time with the helper's `record` command (asynchronously: the scheduler keeps ticking). */
export function sampleMacMouse(
  durationMs: number,
  sampleMs: number,
  helperPath = MAC_DESKTOP_HELPER,
): Promise<MouseSample[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', helperPath, 'record', JSON.stringify({ durationMs, sampleMs })],
      { encoding: 'utf8', timeout: durationMs + 15_000, maxBuffer: MAX_OUTPUT },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Desktop helper record failed: ${helperError({ status: 1, stdout, stderr })}`));
          return;
        }
        try {
          resolve(asSamples(JSON.parse(stdout)));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      },
    );
  });
}

/**
 * F-092-T05: the desktop control the service uses. On macOS it binds the shared driver, the pointer sampler and the
 * input session to the running node binary (the one the owner grants Accessibility to). Under the test runner it
 * refuses, so no test moves the mouse on the developer's desktop: a test injects its own control.
 */
export function liveDesktopControl(platform: NodeJS.Platform = process.platform): DesktopControl {
  if (underTestRunner()) {
    return refusingDesktopControl(
      'A test must inject a desktop control: the default one moves the mouse on this desktop.',
    );
  }
  if (platform !== 'darwin') return refusingDesktopControl(UNSUPPORTED);
  return createDesktopControl({
    driver: createMacDesktopDriver(),
    executable: process.execPath,
    sampleMouse: (durationMs, sampleMs) => sampleMacMouse(durationMs, sampleMs),
    openInputSession: () => openMacInputSession(),
  });
}
