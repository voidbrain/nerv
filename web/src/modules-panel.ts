import { Component, computed, inject, Injectable, signal } from '@angular/core';
import type { ModuleRow } from '../../src/module-row.ts';
import { Language } from './language.ts';
import { Session } from './session.ts';
import { ThemeService } from './theme.ts';
import { Panel } from './ui.ts';

/**
 * F-159: the owner's modules (MCP servers and built-in packs), shared by the Settings panel and the cards each one
 * owns. Until the list is read nothing a module owns is shown, so an off module's card never starts polling; a
 * service that cannot list them (an older one) leaves every module on, as before.
 */
@Injectable({ providedIn: 'root' })
export class Modules {
  private readonly session = inject(Session);
  readonly rows = signal<ModuleRow[]>([]);
  readonly loaded = signal(false);
  readonly problem = signal('');
  readonly busy = signal('');

  /** Whether a module is shown: after the list is read, and while it is on (an unknown module is on). */
  shown(id: string): boolean {
    return this.loaded() && this.rows().find((r) => r.id === id)?.on !== false;
  }

  async load(): Promise<void> {
    try {
      this.rows.set(((await this.session.request('modules')) as { modules: ModuleRow[] }).modules);
    } catch {
      this.rows.set([]);
    }
    this.loaded.set(true);
  }

  async set(id: string, on: boolean): Promise<void> {
    this.busy.set(id);
    this.problem.set('');
    try {
      const r = (await this.session.request('modules/' + id, {
        method: 'PUT',
        body: JSON.stringify({ on }),
      })) as { modules: ModuleRow[] };
      this.rows.set(r.modules);
    } catch (e) {
      this.problem.set(e instanceof Error ? e.message : 'Request failed');
    } finally {
      this.busy.set('');
    }
  }
}

/** F-159: the Modules panel in Settings: one switch per module, with whether it answers and how many tools it gives. */
@Component({
  selector: 'nerv-modules-panel',
  imports: [Panel],
  template: `
    <nerv-panel [heading]="eva() ? t().modTitleEva : t().modTitle" headingId="dash-modules">
      <p class="meta">{{ t().modHint }}</p>
      @if (modules.problem(); as p) {
        <p role="alert" class="warn">{{ t().modFailed }} {{ p }}</p>
      }
      <ul class="rows">
        @for (m of modules.rows(); track m.id) {
          <li [attr.data-key]="m.id">
            <label
              ><input
                type="checkbox"
                role="switch"
                [checked]="m.on"
                [disabled]="modules.busy() === m.id"
                (click)="$event.preventDefault(); modules.set(m.id, !m.on)"
              />
              <span class="name">{{ name(m) }}</span></label
            >
            <span class="state" [attr.data-on]="m.on">{{ state(m.on) }}</span>
            <span class="reach">{{ reach(m) }}</span>
            <span class="tools">{{ t().modTools }}: {{ m.tools }}</span>
          </li>
        } @empty {
          <li class="meta">{{ modules.loaded() ? t().modNone : t().modLoading }}</li>
        }
      </ul>
    </nerv-panel>
  `,
  styles: `
    .meta {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .warn {
      color: var(--warn);
      margin: 0 0 8px;
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 8px;
      padding: 6px 0;
      border-top: 1px solid var(--border);
      font-size: 14px;
    }
    label {
      display: flex;
      gap: 6px;
      align-items: center;
      min-width: 0;
    }
    input {
      accent-color: var(--accent);
      width: 18px;
      height: 18px;
      margin: 0;
    }
    input:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
    }
    .name {
      overflow-wrap: anywhere;
    }
    .state {
      font-weight: 600;
      color: var(--text);
    }
    .state[data-on='false'] {
      color: var(--muted);
    }
    .reach,
    .tools {
      font-size: 12px;
      color: var(--muted);
    }
  `,
})
export class ModulesPanel {
  protected readonly modules = inject(Modules);
  private readonly theme = inject(ThemeService);
  protected readonly t = inject(Language).t;
  protected readonly eva = computed(() => this.theme.choice().theme === 'eva');

  constructor() {
    void this.modules.load();
  }

  protected name(m: ModuleRow): string {
    const t = this.t();
    return m.id === 'cooking' ? t.modCooking : m.id === 'coordinator' ? t.liTitle : m.name;
  }
  protected state(on: boolean): string {
    const t = this.t();
    return this.eva() ? (on ? t.modOnEva : t.modOffEva) : on ? t.modOn : t.modOff;
  }
  protected reach(m: ModuleRow): string {
    const t = this.t();
    return !m.on
      ? t.modNotAsked
      : m.reachable === true
        ? t.modReachable
        : m.reachable === false
          ? t.modUnreachable
          : t.modUnknown;
  }
}
