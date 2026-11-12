import { Component, DOCUMENT, DestroyRef, inject, input, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import type { messages } from './i18n';

type Messages = { [K in keyof (typeof messages)['en']]: string };

/**
 * F-004-T01: a new build never reloads the page by itself. The service worker downloads it in the background; this
 * prompt says so and reloads only when the owner presses Reload. "Later" leaves this tab on the current version; the
 * next time NERV Agency is opened it starts on the new one.
 */
@Component({
  selector: 'nerv-update-prompt',
  template: `<section class="update" [class.open]="state() !== 'idle'" [attr.aria-label]="t().updateTitle">
    <p role="status">{{ state() === 'broken' ? t().updateBroken : state() === 'ready' ? t().updateReady : '' }}</p>
    @if (state() !== 'idle') {
      <button type="button" (click)="reload()" [disabled]="reloading()">{{ t().updateReload }}</button>
      @if (state() === 'ready') {
        <button type="button" class="quiet" (click)="state.set('idle')">{{ t().updateLater }}</button>
      }
    }
  </section>`,
  styles: `
    .update {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .update.open {
      border: 1px solid var(--accent);
      background: var(--panel);
      border-radius: 8px;
      padding: 12px 20px;
      margin-bottom: 20px;
    }
    p {
      margin: 0;
      flex: 1 1 240px;
      color: var(--text);
    }
  `,
})
export class UpdatePrompt {
  readonly t = input.required<Messages>();
  readonly state = signal<'idle' | 'ready' | 'broken'>('idle');
  readonly reloading = signal(false);
  private readonly updates = inject(SwUpdate);
  private readonly document = inject(DOCUMENT);

  constructor() {
    if (!this.updates.isEnabled) return;
    const versions = this.updates.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY' && this.state() !== 'broken') this.state.set('ready');
    });
    const broken = this.updates.unrecoverable.subscribe(() => this.state.set('broken'));
    // A tab left open for days still learns about a new build when it is shown again; no timer runs in the background.
    const check = () => {
      if (this.document.visibilityState === 'visible') this.updates.checkForUpdate().catch(() => undefined);
    };
    this.document.addEventListener('visibilitychange', check);
    inject(DestroyRef).onDestroy(() => {
      versions.unsubscribe();
      broken.unsubscribe();
      this.document.removeEventListener('visibilitychange', check);
    });
  }

  async reload() {
    this.reloading.set(true);
    try {
      if (this.state() === 'ready') await this.updates.activateUpdate();
    } catch {
      // The reload below still loads whatever version the worker now serves.
    }
    this.document.defaultView?.location.reload();
  }
}
