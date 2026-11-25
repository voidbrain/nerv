import { computed, Service, signal } from '@angular/core';
import { themeChoice, tokenStyle, type ThemeChoice } from '../../src/dashboard-theme.ts';

/**
 * F-130-T01: the workspace theme, Theme · Mode · Accent from the dashboard (F-047), plain by default and EVA optional.
 * A layout binds `tokens()` on its host, so every `var(--…)` inside reads the chosen palette. The choice is a
 * per-viewer convenience kept in this browser only; without storage the page starts on the default.
 */
const PREFS = 'nerv.workspace.theme';

@Service()
export class ThemeService {
  readonly choice = signal<ThemeChoice>(themeChoice(this.load()));
  readonly tokens = computed(() => tokenStyle(this.choice()));

  set(part: Partial<ThemeChoice>): void {
    this.choice.set(themeChoice({ ...this.choice(), ...part }));
    try {
      localStorage.setItem(PREFS, JSON.stringify(this.choice()));
    } catch {
      /* storage blocked: not remembered */
    }
  }

  private load(): unknown {
    try {
      return JSON.parse(localStorage.getItem(PREFS) ?? 'null');
    } catch {
      return null;
    }
  }
}
