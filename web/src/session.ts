import { signal } from '@angular/core';
import { deviceLabel, forgetDevice, isPairingCode, keepDevice, keptDevice, pairDevice } from './device-pairing.ts';

/**
 * F-130-T01: one sign-in for both workspace layouts, the simple page (Nodo) and the full dashboard, with the rules
 * Nodo already had (frontend area notes):
 * - `nerv open` lands with `#code=…`; main.ts takes it from the address before Angular starts and it is swapped once
 *   for a dashboard session (12 h), held in memory only: a reload asks again, as Nodo always did.
 * - A typed pairing code pairs only in the installed app, which keeps the device credential (localStorage `nerv.device`).
 * - A pasted admin token stays in memory only, never stored.
 * - Each caller decides what a 401 means (`end()`): the dashboard shows the sign-in box; Nodo ends only a pairing.
 * Plain class (no decorator) so node tests construct it with fakes; app.ts provides it.
 */
/** F-004-T01: API calls go straight to the service; the service worker never sees or holds them. */
export const SW_BYPASS = { 'ngsw-bypass': '1' };

type KeptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SessionDeps {
  fetch: typeof fetch;
  /** localStorage, or undefined where the browser blocks it. */
  appStorage(): KeptStorage | undefined;
  installed: boolean;
  userAgent: string;
}

/** Why a sign-in failed; the page turns it into its own words. */
export type SignInFailure = 'installed-only' | 'limit' | 'full' | 'offline' | 'pair' | 'code';
export type Ended = '' | 'session' | 'device';

/** A failed call: `status` 0 when the service was not reached, otherwise the HTTP status with the server's message. */
export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class Session {
  readonly token = signal('');
  readonly paired = signal(false);
  /** Set when a caller ended the credential after a 401: which kind ended. */
  readonly ended = signal<Ended>('');
  /** Why signing in at start failed (the login code was refused), for the page to say. */
  readonly startFailure = signal<SignInFailure | null>(null);
  private readonly deps: SessionDeps;

  constructor(deps: SessionDeps) {
    this.deps = deps;
  }

  /** Swaps the login code main.ts took from the address, or signs the installed app in with its kept device. */
  async start(code: string | null): Promise<SignInFailure | null> {
    if (code) {
      const failure = await this.exchange(code);
      this.startFailure.set(failure);
      return failure;
    }
    const device = this.deps.installed ? keptDevice(this.deps.appStorage()) : '';
    if (device) this.use(device, true);
    return null;
  }

  /** The sign-in box: a short code pairs this device (installed app only); anything else is the admin token. */
  async signIn(value: string): Promise<SignInFailure | null> {
    const typed = value.trim();
    if (!typed) return null;
    if (!isPairingCode(typed)) {
      this.use(typed, false);
      return null;
    }
    // Review of #707: only the installed app pairs; a tab would hold a 90-day device it cannot sign out of.
    if (!this.deps.installed) return 'installed-only';
    const outcome = await pairDevice(
      typed,
      deviceLabel(this.deps.userAgent, 'workspace app'),
      (input, init) => this.deps.fetch(input, init),
      SW_BYPASS,
    );
    if ('error' in outcome)
      return outcome.status === 429
        ? 'limit'
        : outcome.status === 409
          ? 'full'
          : outcome.status === 0
            ? 'offline'
            : 'pair';
    keepDevice(this.deps.appStorage(), outcome.token);
    this.use(outcome.token, true);
    return null;
  }

  async exchange(code: string): Promise<SignInFailure | null> {
    try {
      const response = await this.deps.fetch('/api/session/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...SW_BYPASS },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json()) as { token?: string };
      if (!response.ok || !data.token) return 'code';
      this.use(data.token, false);
      return null;
    } catch {
      return 'code';
    }
  }

  /** An authenticated JSON call. Throws a RequestError with the status and the server's message. */
  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.deps.fetch('/api/' + path, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token(), ...SW_BYPASS },
      });
    } catch {
      throw new RequestError(0, 'Service not reached.');
    }
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (data as { error?: unknown }).error;
      throw new RequestError(response.status, typeof message === 'string' && message ? message : 'Request failed');
    }
    return data;
  }

  /** The credential stopped working (401): forget a kept device, so the next launch asks again. */
  end(): void {
    const device = this.paired();
    if (device) forgetDevice(this.deps.appStorage());
    this.ended.set(device ? 'device' : 'session');
    this.paired.set(false);
    this.token.set('');
  }

  private use(token: string, device: boolean) {
    this.ended.set('');
    this.paired.set(device);
    this.token.set(token);
  }
}

/** The `#code=…` login fragment, removed from the address and history before anything else reads it. */
export function takeLoginCode(win: Pick<Window, 'location' | 'history'>): string | null {
  const match = /^#code=([a-f0-9]{32})$/.exec(win.location.hash);
  if (!match) return null;
  win.history.replaceState(null, '', win.location.pathname + win.location.search);
  return match[1]!;
}
