import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { DesktopDriver, DesktopWindowSnapshot } from './desktop-control.ts';
import type { DisplayBounds, FrontmostAppMetadata } from './desktop-recording.ts';

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
  const helper = options.helperPath ?? MAC_DESKTOP_HELPER;
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

  const call = (command: string, args: Record<string, unknown> = {}): unknown => {
    const result = runner([command, JSON.stringify(args)]);
    if (result.status !== 0) throw new Error(`Desktop helper ${command} failed: ${helperError(result)}`);
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(`Desktop helper ${command} returned unreadable output.`);
    }
  };

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
