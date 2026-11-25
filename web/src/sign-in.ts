import { Component, computed, inject, signal } from '@angular/core';
import { Session, type SignInFailure } from './session.ts';

const FAILURE: Record<SignInFailure, string> = {
  'installed-only':
    'A pairing code works only in the installed app: open NERV from the Home Screen and type it there. In a browser tab, run nerv open dashboard.',
  limit: 'Too many pairing attempts. Wait a minute and try again.',
  full: 'Too many paired devices. Revoke one in Settings, then try again.',
  offline: 'The service was not reached. Check that NERV is running.',
  pair: 'That pairing code was not accepted. Run nerv open --phone for a new one.',
  code: 'The login code was not accepted. Run nerv open dashboard again.',
};
const ENDED = {
  session: 'Your session ended (after 12 h, a service restart or sessions revoke). Sign in again.',
  device: "This device's pairing ended (revoked, 90 days unused or a changed token). Pair it again.",
} as const;

/** F-130-T01: the dashboard's sign-in box over the shared Session (same rules as the simple page and live.js). */
@Component({
  selector: 'nerv-sign-in',
  host: { class: 'nerv-sign-in' },
  template: `
    <section aria-labelledby="signin-title">
      <h2 id="signin-title">Sign in</h2>
      <p>
        Run <code>nerv open dashboard</code>, or type the pairing code from <code>nerv open --phone</code> in the
        installed app, or paste the access token (kept in memory only).
      </p>
      <form (submit)="$event.preventDefault(); submit(value.value); value.value = ''">
        <label for="signin-value">Pairing code or access token</label>
        <input id="signin-value" #value type="password" autocomplete="off" placeholder="XXXX-XXXX" />
        <button type="submit">Sign in</button>
      </form>
      @if (message()) {
        <p role="alert" class="error">{{ message() }}</p>
      }
    </section>
  `,
  styles: `
    section {
      max-width: 560px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    h2 {
      margin-top: 0;
      font-size: 18px;
    }
    p {
      color: var(--muted);
      font-size: 14px;
    }
    form {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    label {
      flex-basis: 100%;
      font-size: 13px;
    }
    input {
      flex: 1 1 12em;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px;
    }
    button {
      background: var(--brand-bg);
      color: var(--brand-fg);
      border: 0;
      border-radius: 4px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    input:focus-visible,
    button:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
    }
    .error {
      color: var(--danger);
    }
  `,
})
export class SignIn {
  private readonly session = inject(Session);
  private readonly failure = signal<SignInFailure | null>(null);
  protected readonly message = computed(() => {
    const failure = this.failure() ?? this.session.startFailure();
    const ended = this.session.ended();
    if (failure) return FAILURE[failure];
    return ended ? ENDED[ended] : '';
  });

  protected async submit(value: string) {
    this.failure.set(await this.session.signIn(value));
  }
}
