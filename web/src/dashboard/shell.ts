import { Component, computed, DestroyRef, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LiveFeed } from '../live-feed.ts';
import { Session } from '../session.ts';
import { SignIn } from '../sign-in.ts';
import { ThemeService } from '../theme.ts';
import { Panel, Stat } from '../ui.ts';
import { ACCENTS, type Accent, type Mode, type Theme } from '../../../src/dashboard-theme.ts';

/** Sections still on the old page, with the step that moves each (F-130 record, F-130-T15 inventory). */
const MOVING = [
  ['Health', 'F-130-T02'],
  ['Settings, devices and pairing', 'F-130-T03'],
  ['Push', 'F-130-T04'],
  ["At a glance and Misato's apartment", 'F-130-T05'],
  ['Sorties and plan detail', 'F-130-T06'],
  ['Sephirot flow', 'F-130-T07'],
  ['Comms and the debrief', 'F-130-T08'],
  ['Coming up, models and budget', 'F-130-T09'],
  ['EVA cages, pilots, tools and skills', 'F-130-T10'],
  ['Bases, chronicle and Lilith', 'F-130-T11'],
] as const;

const HEALTH = { ok: 'OK', degraded: 'Degraded', issue: 'Issue', unknown: '—' } as const;

/**
 * F-130-T01: the full dashboard's shell in the workspace, the second layout beside the simple page (Nodo, route `/`).
 * It signs in through the shared Session and reads the shared LiveFeed; sections move in one step each and render
 * their lists with `@for … track` over keyed signals, so an unchanged poll leaves their DOM in place.
 */
@Component({
  selector: 'nerv-dashboard',
  imports: [RouterLink, SignIn, Panel, Stat],
  host: { class: 'dash', '[style]': 'theme.tokens()', '[attr.data-theme]': 'theme.choice().theme' },
  template: `
    <header class="dash-head">
      <a class="dash-brand" routerLink="/">NERV <span>Dashboard</span></a>
      <p class="feed" role="status">{{ feedLabel() }}</p>
      <nav aria-label="Views">
        <a routerLink="/">Simple view</a>
        <a href="/dashboard/">Old dashboard</a>
      </nav>
      <div class="theme" role="group" aria-label="Theme">
        <label
          >Theme
          <select #themeSel [value]="theme.choice().theme" (change)="setTheme(themeSel.value)">
            <option value="simple">Simple</option>
            <option value="eva">EVA</option>
          </select></label
        >
        <label
          >Mode
          <select #modeSel [value]="theme.choice().mode" (change)="setMode(modeSel.value)">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select></label
        >
        <label
          >Colour
          <select #accentSel [value]="theme.choice().accent" (change)="setAccent(accentSel.value)">
            @for (a of accents; track a) {
              <option [value]="a">{{ a }}</option>
            }
          </select></label
        >
      </div>
    </header>
    <main>
      <h1 class="sr-only">NERV dashboard</h1>
      @if (!session.token()) {
        <nerv-sign-in />
      } @else {
        <section class="glance" aria-label="At a glance">
          <nerv-stat label="Needs you" [value]="'' + feed.approvals().length" detail="waiting approvals" />
          <nerv-stat label="Health" [value]="health()" detail="processes and checks" />
          <nerv-stat label="Reminders" [value]="pending()" detail="scheduled" />
        </section>
        <div class="cols">
          <nerv-panel heading="Sorties" headingId="dash-sorties">
            <span panel-meta class="meta">{{ feed.sorties().length }} latest</span>
            <ul class="rows">
              @for (s of feed.sorties(); track s.realId) {
                <li [attr.data-key]="s.realId">
                  <span class="sid">{{ s.id }}</span><span class="title">{{ s.title }}</span
                  ><span class="state" [attr.data-state]="s.status">{{ s.status }}</span>
                </li>
              } @empty {
                <li class="empty">No sorties yet.</li>
              }
            </ul>
          </nerv-panel>
          <nerv-panel heading="Waiting for you" headingId="dash-approvals">
            <ul class="rows">
              @for (a of feed.approvals(); track a.id) {
                <li [attr.data-key]="a.id">
                  <span class="sid">{{ a.sortie }}</span><span class="title">{{ a.tool }}</span
                  ><span class="state">{{ a.effect }}</span>
                </li>
              } @empty {
                <li class="empty">Nothing waits for you.</li>
              }
            </ul>
          </nerv-panel>
        </div>
        <nerv-panel heading="Moving here" headingId="dash-moving">
          <p class="meta">
            These sections still run on the <a href="/dashboard/">old dashboard</a>; each moves here in its own step.
          </p>
          <ul class="moving">
            @for (m of moving; track m[1]) {
              <li>{{ m[0] }} <span class="meta">{{ m[1] }}</span></li>
            }
          </ul>
        </nerv-panel>
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, sans-serif;
      padding: 16px;
    }
    .dash-head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      margin-bottom: 16px;
      background: var(--hdr-bg);
      color: var(--hdr-fg);
      border-radius: 6px;
      font-size: 13px;
      letter-spacing: normal;
    }
    .dash-head p,
    .dash-head label {
      color: var(--hdr-fg);
    }
    .dash-brand {
      font-weight: 700;
      letter-spacing: 0.1em;
      color: inherit;
      text-decoration: none;
    }
    .dash-brand span {
      font-weight: 400;
    }
    .feed {
      margin: 0;
      font-size: 13px;
    }
    nav {
      display: flex;
      gap: 12px;
    }
    nav a {
      color: inherit;
    }
    .theme {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    label {
      margin: 0;
      font-size: 12px;
      display: flex;
      gap: 4px;
      align-items: center;
    }
    select {
      background: var(--panel);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px;
    }
    a:focus-visible,
    select:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
    }
    main {
      display: grid;
      gap: 16px;
      padding: 0;
      max-width: none;
    }
    .glance {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
    }
    .cols {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
      gap: 16px;
    }
    .rows,
    .moving {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rows li {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 8px;
      padding: 6px 0;
      border-top: 1px solid var(--border);
      font-size: 14px;
    }
    .rows li.empty {
      display: block;
      color: var(--muted);
    }
    .sid,
    .meta {
      color: var(--muted);
      font-size: 12px;
    }
    .title {
      overflow-wrap: anywhere;
    }
    .moving li {
      padding: 2px 0;
      font-size: 14px;
    }
    p.meta a {
      color: var(--accent);
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
export class DashboardShell {
  protected readonly session = inject(Session);
  protected readonly feed = inject(LiveFeed);
  protected readonly theme = inject(ThemeService);
  protected readonly accents = Object.keys(ACCENTS) as Accent[];
  protected readonly moving = MOVING;
  protected readonly health = computed(() => HEALTH[this.feed.health()]);
  protected readonly pending = computed(() => {
    const h = this.feed.history();
    return h ? String(h.pending) : '—';
  });
  protected readonly feedLabel = computed(() => {
    if (!this.session.token()) return 'Not signed in';
    const mode = this.feed.mode();
    const how = mode === 'stream' ? 'live' : mode === 'poll' ? 'polling' : 'connecting';
    return this.feed.stale() ? `Service not reached · ${how}` : `Connected · ${how}`;
  });

  constructor() {
    effect(() => {
      const signedIn = !!this.session.token();
      untracked(() => (signedIn ? this.feed.start() : this.feed.stop()));
    });
    inject(DestroyRef).onDestroy(() => this.feed.stop());
  }

  protected setTheme(value: string) {
    this.theme.set({ theme: value as Theme });
  }
  protected setMode(value: string) {
    this.theme.set({ mode: value as Mode });
  }
  protected setAccent(value: string) {
    this.theme.set({ accent: value as Accent });
  }
}
