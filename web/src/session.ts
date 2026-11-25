import { signal } from '@angular/core';
import { deviceLabel, forgetDevice, isPairingCode, keepDevice, keptDevice, pairDevice } from './device-pairing.ts';

/**
 * F-130-T01: one sign-in for both workspace layouts, the simple page (Nodo) and the full dashboard, with the rules of
 * live.js and the frontend area notes:
 * - `nerv open` lands with `#code=…`; main.ts takes it from the address before Angular starts and it is swapped once
 *   for a dashboard session (12 h), kept in this tab's sessionStorage so a reload stays signed in.
 * - A typed pairing code pairs only in the installed app, which keeps the device credential (localStorage `nerv.device`).
 * - A pasted admin token stays in memory only, never stored.
 * - A 401 ends the session: the kept session or device is forgotten and the sign-in box comes back.
 * Plain class (no decorator) so node tests construct it with fakes; app.config.ts provides it.
 */
export const SESSION_KEY = 'nerv.workspace.session';
/** F-004-T01: API calls go straight to the service; the service worker never sees or holds them. */
export const SW_BYPASS = { 'ngsw-bypass': '1' };

type KeptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SessionDeps {
  fetch: typeof fetch;
  /** sessionStorage, or undefined where the browser blocks it. */
  tabStorage(): KeptStorage | undefined;
  /** localStorage, or undefined where the browser blocks it. */
  appStorage(): KeptStorage | undefined;
  installed: boolean;
  userAgent: string;
}

/** Why a sign-in failed; the page turns it into its own words. */
export type SignInFailure = 'installed-only' | 'limit' | 'full' | 'offline' | 'pair' | 'code';
export type Ended = '' | 'session' | 'device';

export class Session {
  readonly token = signal('');
  readonly paired = signal(false);
  /** Set when the service refused the credential (401): which kind ended. */
  readonly ended = signal<Ended>('');
  /** Why signing in at start failed (the login code was refused), for the page to say. */
  readonly startFailure = signal<SignInFailure | null>(null);
  private readonly deps: SessionDeps;
  private kept: 'session' | 'device' | 'memory' = 'memory';

  constructor(deps: SessionDeps) {
    this.deps = deps;
  }

  /** Signs in from what the tab or the installed app kept, or swaps the login code main.ts took from the address. */
  async start(code: string | null): Promise<SignInFailure | null> {
    if (code) {
      const failure = await this.exchange(code);
      this.startFailure.set(failure);
      return failure;
    }
    const session = this.read(this.deps.tabStorage(), SESSION_KEY);
    if (session) {
      this.use(session, 'session');
      return null;
    }
    const device = this.deps.installed ? keptDevice(this.deps.appStorage()) : '';
    if (device) this.use(device, 'device');
    return null;
  }

  /** The sign-in box: a short code pairs this device (installed app only); anything else is the admin token. */
  async signIn(value: string): Promise<SignInFailure | null> {
    const typed = value.trim();
    if (!typed) return null;
    if (!isPairingCode(typed)) {
      this.use(typed, 'memory');
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
    this.use(outcome.token, 'device');
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
      try {
        this.deps.tabStorage()?.setItem(SESSION_KEY, data.token);
      } catch {
        /* storage blocked: this tab's memory only */
      }
      this.use(data.token, 'session');
      return null;
    } catch {
      return 'code';
    }
  }

  /** An authenticated JSON call; a 401 ends the session. Errors carry the HTTP status (0: not reached). */
  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = this.token();
    let response: Response;
    try {
      response = await this.deps.fetch('/api/' + path, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...SW_BYPASS },
      });
    } catch {
      throw Object.assign(new Error('Service not reached.'), { status: 0 });
    }
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && token && token === this.token()) this.end();
      throw Object.assign(new Error((data as { error?: string }).error ?? 'Request failed'), {
        status: response.status,
      });
    }
    return data;
  }

  /** The credential stopped working: forget what was kept, so the next launch asks again. */
  end(): void {
    if (this.kept === 'session') this.remove(this.deps.tabStorage(), SESSION_KEY);
    if (this.kept === 'device') forgetDevice(this.deps.appStorage());
    this.ended.set(this.kept === 'device' ? 'device' : 'session');
    this.kept = 'memory';
    this.paired.set(false);
    this.token.set('');
  }

  private use(token: string, kept: 'session' | 'device' | 'memory') {
    this.kept = kept;
    this.ended.set('');
    this.paired.set(kept === 'device');
    this.token.set(token);
  }

  private read(storage: KeptStorage | undefined, key: string): string {
    try {
      return storage?.getItem(key) ?? '';
    } catch {
      return '';
    }
  }

  private remove(storage: KeptStorage | undefined, key: string) {
    try {
      storage?.removeItem(key);
    } catch {
      /* nothing kept */
    }
  }
}

/** The `#code=…` login fragment, removed from the address and history before anything else reads it. */
export function takeLoginCode(win: Pick<Window, 'location' | 'history'>): string | null {
  const match = /^#code=([a-f0-9]{32})$/.exec(win.location.hash);
  if (!match) return null;
  win.history.replaceState(null, '', win.location.pathname + win.location.search);
  return match[1]!;
}
