/**
 * F-118-T02: the installed app signs itself in by pairing. Framework-free so it is unit-tested directly; the dashboard's
 * live.js (a classic script) keeps the same rules in a few lines of its own.
 *
 * - A typed `XXXX-XXXX` code (from `nerv open --phone`) is swapped once at `POST /api/device/pair` for a device credential.
 * - Installed (Home Screen, standalone display), the credential is kept in this app's `localStorage`, so later launches
 *   need no sign-in until it is revoked, lapses after 90 days unused, or the admin token rotates.
 * - In a browser tab nothing is stored: the tab keeps its session behaviour (memory only in the workspace).
 * - A pasted admin token is never stored anywhere.
 */
export const DEVICE_KEY = 'nerv.device';

/** A pairing code as typed: 8 letters or digits, the hyphen or a space optional. An admin token is 24+ characters. */
export function isPairingCode(value: string): boolean {
  return /^[A-Za-z0-9]{4}[\s-]?[A-Za-z0-9]{4}$/.test(value.trim());
}

/** True when running as an installed app (Home Screen), not in a browser tab. */
export function isInstalled(win: {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: object;
}): boolean {
  // iOS reports a Home Screen app as navigator.standalone; other browsers through the display-mode media query.
  if ((win.navigator as { standalone?: unknown } | undefined)?.standalone === true) return true;
  try {
    return (
      !!win.matchMedia?.('(display-mode: standalone)').matches ||
      !!win.matchMedia?.('(display-mode: fullscreen)').matches
    );
  } catch {
    return false;
  }
}

/** The device name shown in Settings and `nerv devices`: the kind of device and the app, never anything personal. */
export function deviceLabel(userAgent: string, app: string): string {
  const kind = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(userAgent)
          ? 'Mac'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : 'Device';
  return `${kind} · ${app}`.slice(0, 40);
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The kept device credential, or '' (storage blocked or empty). */
export function keptDevice(storage: Storage | undefined): string {
  try {
    return storage?.getItem(DEVICE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function keepDevice(storage: Storage | undefined, credential: string): void {
  try {
    storage?.setItem(DEVICE_KEY, credential);
  } catch {
    /* storage blocked: this launch only */
  }
}

export function forgetDevice(storage: Storage | undefined): void {
  try {
    storage?.removeItem(DEVICE_KEY);
  } catch {
    /* nothing kept */
  }
}

export type PairOutcome = { token: string } | { status: number; error: string };

/** Swaps a typed pairing code once for a device credential. `status` 0 means the service was not reached. */
export async function pairDevice(
  code: string,
  name: string,
  fetcher: typeof fetch,
  headers: Record<string, string> = {},
): Promise<PairOutcome> {
  try {
    const response = await fetcher('/api/device/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ code: code.trim(), name }),
    });
    const data = (await response.json().catch(() => ({}))) as { token?: unknown; error?: unknown };
    if (response.ok && typeof data.token === 'string' && data.token) return { token: data.token };
    return { status: response.status || 500, error: typeof data.error === 'string' ? data.error : 'Pairing failed.' };
  } catch {
    return { status: 0, error: 'Service not reached.' };
  }
}
