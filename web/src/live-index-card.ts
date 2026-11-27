import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { liveIndexAgeMinutes, type LiveIndexView } from '../../src/live-index.ts';
import { Language } from './language.ts';
import { Modules } from './modules-panel.ts';
import { Session } from './session.ts';
import { ThemeService } from './theme.ts';
import { Panel } from './ui.ts';

/** The index rebuilds from git every 5 minutes; the card reads it as often, and on Refresh. */
const READ_EVERY_MS = 5 * 60_000;

/**
 * F-147: the coordinator's live index on the dashboard: the owner's turn across every project, what each step
 * unblocks, the snapshot's age and the projects the index could not read, each row with its source link. The service
 * reads the index through its granted read tools (`GET /api/live-index`); this card only shows the answer.
 */
@Component({
  selector: 'nerv-live-index-card',
  imports: [Panel],
  template: `
    <nerv-panel [heading]="eva() ? t().liTitleEva : t().liTitle" headingId="dash-live-index">
      <span panel-meta class="meta">
        @if (ready(); as r) {
          {{ age() === null ? t().liNoSnapshot : t().liAge + ': ' + age() + ' ' + t().liMinutes }} ·
          <a [href]="r.screen" target="_blank" rel="noopener">{{ t().liScreen }}</a> ·
        }
        <button type="button" (click)="read()" [disabled]="reading()">{{ t().refresh }}</button>
      </span>
      <div role="status" aria-live="polite">
        @switch (view()?.state) {
          @case (undefined) {
            <p class="meta">{{ problem() || t().liLoading }}</p>
          }
          @case ('offline') {
            <p class="warn">{{ t().liOffline }}</p>
            <p class="meta">{{ reason() }}</p>
          }
          @case ('failed') {
            <p class="warn">{{ t().liFailed }} {{ reason() }}</p>
          }
          @case ('not-set-up') {
            <p>{{ t().liNotSetUp }}</p>
            <pre><code>{{ commands() }}</code></pre>
          }
        }
      </div>
      @if (ready(); as r) {
        @if (r.unknown.length) {
          <p class="warn">
            {{ t().liUnknown }}:
            @for (u of r.unknown; track u.repo; let last = $last) {
              <strong>{{ u.repo }}</strong> ({{ u.reason }}){{ last ? '' : ', ' }}
            }
          </p>
        }
        <h3>{{ eva() ? t().liTurnEva : t().liTurn }} · {{ r.turn.length }}</h3>
        <ul class="rows">
          @for (s of r.turn; track s.key) {
            <li [attr.data-key]="s.key">
              <span class="kind">{{ kind(s.ownerKind) }}</span>
              <span class="title">{{ s.title }} <span class="repo">{{ s.repo }}</span></span>
              @if (s.url) {
                <a [href]="s.url" target="_blank" rel="noopener"
                  >{{ t().liSource }}<span class="sr-only"> · {{ s.title }}</span></a
                >
              }
              @if (s.blocks.length) {
                <ul class="blocks" [attr.aria-label]="t().liUnblocks">
                  @for (b of s.blocks; track b.key) {
                    <li>
                      {{ t().liUnblocks }}: {{ b.title }} <span class="repo">{{ b.repo }}</span>{{ ' ' }}
                      @if (b.url) {
                        <a [href]="b.url" target="_blank" rel="noopener"
                          >{{ t().liSource }}<span class="sr-only"> · {{ b.title }}</span></a
                        >
                      }
                    </li>
                  }
                </ul>
              }
            </li>
          } @empty {
            <li class="empty">{{ t().liNothing }}</li>
          }
        </ul>
      }
    </nerv-panel>
  `,
  styles: `
    h3 {
      margin: 12px 0 4px;
      font-size: 13px;
      color: var(--title);
    }
    p {
      margin: 0 0 8px;
      font-size: 14px;
    }
    .meta,
    .repo,
    .kind {
      color: var(--muted);
      font-size: 12px;
    }
    .warn {
      color: var(--warn);
    }
    a {
      color: var(--accent);
    }
    button {
      background: var(--panel2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 12px;
    }
    a:focus-visible,
    button:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
    }
    pre {
      margin: 0;
      padding: 8px;
      overflow-x: auto;
      background: var(--panel2);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 12px;
    }
    .rows,
    .blocks {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rows > li {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 4px 8px;
      padding: 6px 0;
      border-top: 1px solid var(--border);
      font-size: 14px;
    }
    .rows li.empty {
      display: block;
      color: var(--muted);
    }
    .title {
      overflow-wrap: anywhere;
    }
    .blocks {
      grid-column: 2 / -1;
      font-size: 13px;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class LiveIndexCard {
  private readonly session = inject(Session);
  private readonly modules = inject(Modules);
  private readonly theme = inject(ThemeService);
  protected readonly t = inject(Language).t;
  protected readonly eva = computed(() => this.theme.choice().theme === 'eva');
  protected readonly view = signal<LiveIndexView | null>(null);
  /** The service itself could not answer (the card's own request failed). */
  protected readonly problem = signal('');
  protected readonly reading = signal(false);
  private readonly readAt = signal(0);
  protected readonly ready = computed(() => {
    const v = this.view();
    return v?.state === 'ready' ? v : null;
  });
  protected readonly age = computed(() => liveIndexAgeMinutes(this.ready()?.snapshot ?? null, this.readAt()));
  protected readonly reason = computed(() => {
    const v = this.view();
    return v && 'reason' in v ? v.reason : '';
  });
  protected readonly commands = computed(() => {
    const v = this.view();
    return v?.state === 'not-set-up' ? v.commands.join('\n') : '';
  });

  constructor() {
    void this.read();
    const timer = setInterval(() => void this.read(), READ_EVERY_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected kind(ownerKind: string): string {
    const t = this.t();
    return ownerKind === 'decision' ? t.liDecision : ownerKind === 'both' ? t.liBoth : t.liProcedure;
  }

  protected async read(): Promise<void> {
    if (this.reading()) return;
    this.reading.set(true);
    try {
      const v = (await this.session.request('live-index')) as LiveIndexView;
      // F-159: turned off elsewhere (the CLI, another tab): reread the modules, so the dashboard drops this card.
      if (v.state === 'off') void this.modules.load();
      this.readAt.set(Date.now());
      this.view.set(v);
      this.problem.set('');
    } catch (e) {
      this.view.set(null);
      this.problem.set(e instanceof Error ? e.message : 'Request failed');
    } finally {
      this.reading.set(false);
    }
  }
}
