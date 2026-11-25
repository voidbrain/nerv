import { computed, Service, signal } from '@angular/core';
import { messages } from './i18n.ts';

export type Lang = 'it' | 'en';

/**
 * F-130-T01: the workspace language, shared by the simple page and the full dashboard (English default, Italian
 * selectable; the style guide). Each page adopts the service's configured language once, on its first read.
 */
@Service()
export class Language {
  readonly lang = signal<Lang>('en');
  readonly t = computed(() => messages[this.lang()]);
  /** True once a page took the service's language or the viewer chose one. */
  settled = false;

  set(value: string): void {
    if (value !== 'it' && value !== 'en') return;
    this.lang.set(value);
    this.settled = true;
    if (typeof document !== 'undefined') document.documentElement.lang = value;
  }

  /** The service's configured language, taken only before anything settled it. */
  adopt(value: unknown): void {
    if (!this.settled && typeof value === 'string') this.set(value);
  }
}
