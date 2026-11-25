import { Component, computed, inject, signal } from '@angular/core';
import { Language } from './language.ts';
import { Session, type SignInFailure } from './session.ts';

/** F-130-T01: the dashboard's sign-in box over the shared Session (same rules as the simple page and live.js). */
@Component({
  selector: 'nerv-sign-in',
  host: { class: 'nerv-sign-in' },
  template: `
    <section aria-labelledby="signin-title">
      <h2 id="signin-title">{{ t().signInTitle }}</h2>
      <p>{{ t().signInHint }}</p>
      <form (submit)="$event.preventDefault(); submit(value.value); value.value = ''">
        <label for="signin-value">{{ t().signInLabel }}</label>
        <input id="signin-value" #value type="password" autocomplete="off" placeholder="XXXX-XXXX" />
        <button type="submit">{{ t().signInButton }}</button>
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
  protected readonly t = inject(Language).t;
  private readonly failure = signal<SignInFailure | null>(null);
  /** Same words as the simple page for the same failures (i18n.ts). */
  protected readonly message = computed(() => {
    const t = this.t();
    const failure = this.failure() ?? this.session.startFailure();
    const ended = this.session.ended();
    if (failure)
      return {
        'installed-only': t.pairInstalledOnly,
        limit: t.pairLimit,
        full: t.pairFull,
        offline: t.connectionError,
        pair: t.pairError,
        code: t.codeError,
      }[failure];
    return ended === 'device' ? t.deviceEnded : ended === 'session' ? t.sessionEnded : '';
  });

  protected async submit(value: string) {
    this.failure.set(await this.session.signIn(value));
  }
}
