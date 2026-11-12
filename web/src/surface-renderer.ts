import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, effect, input } from '@angular/core';
import {
  validateSurfaceResult,
  logSurfaceRejection,
  type Surface,
  type SurfaceValidationResult,
} from '../../shared/surface.ts';
import type { messages } from './i18n';

export {
  surfaceRejectionLog,
  clearSurfaceRejectionLog,
  logSurfaceRejection,
  type SurfaceRejectionEntry,
} from '../../shared/surface.ts';

type Messages = { [K in keyof (typeof messages)['en']]: string };

@Component({
  selector: 'nerv-surface-renderer',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (validation().ok) {
      @switch (asSurface(validation()).component) {
        @case ('nerv-status-card') {
          <nerv-status-card [surface]="asSurface(validation())"></nerv-status-card>
        }
        @case ('nerv-notice-card') {
          <nerv-notice-card [surface]="asSurface(validation())"></nerv-notice-card>
        }
      }
    } @else {
      <div class="surface-rejection" role="alert">
        <span class="rejection-badge">REJECTED</span>
        <p class="rejection-msg">{{ t()?.surfaceRejected || 'Invalid or unauthorized surface payload rejected.' }}</p>
      </div>
    }
  `,
  styles: `
    .surface-rejection {
      border: 1px solid var(--error);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 20px;
      background: var(--panel);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .rejection-badge {
      background: var(--error);
      color: var(--ink);
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .rejection-msg {
      margin: 0;
      color: var(--text);
      font-size: 13px;
      line-height: 1.4;
    }
  `,
})
export class SurfaceRenderer {
  readonly surface = input<unknown>();
  readonly t = input<Messages>();

  readonly validation = computed<SurfaceValidationResult>(() => {
    return validateSurfaceResult(this.surface());
  });

  asSurface(res: SurfaceValidationResult): Surface {
    if (res.ok) return res.surface;
    throw new Error('Surface is not valid');
  }

  constructor() {
    effect(() => {
      const res = this.validation();
      const raw = this.surface();
      if (!res.ok) {
        logSurfaceRejection(res.reason, raw);
      }
    });
  }
}
