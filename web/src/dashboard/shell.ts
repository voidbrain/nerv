import { Component, computed, DestroyRef, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Language } from '../language.ts';
import { LiveFeed } from '../live-feed.ts';
import { Session } from '../session.ts';
import { SignIn } from '../sign-in.ts';
import { ThemeService } from '../theme.ts';
import { Panel, Stat } from '../ui.ts';
import { ACCENTS, type Accent, type Mode, type Theme } from '../../../src/dashboard-theme.ts';

/**
 * Sections still on the old page, in the order the F-130 steps move them (F-130-T02 Health to F-130-T11 Bases; F-130-T15
 * inventory). B-158: the owner sees the section names only; step IDs stay here, in a comment (B-102).
 */
const MOVING = [
  'moveHealth',
  'moveSettings',
  'movePush',
  'moveApartment',
  'moveSorties',
  'moveFlow',
  'moveComms',
  'moveNext',
  'moveEva',
  'moveBases',
] as const;

const ACCENT_KEY = {
  orange: 'accentOrange',
  blue: 'accentBlue',
  green: 'accentGreen',
  violet: 'accentViolet',
  ochre: 'accentOchre',
} as const;

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
      <a class="dash-brand" routerLink="/">NERV <span>{{ t().dashBrand }}</span></a>
      <p class="feed" role="status">{{ feedLabel() }}</p>
      <nav [attr.aria-label]="t().dashViews">
        <a routerLink="/">{{ t().simpleView }}</a>
        <a href="/dashboard/">{{ t().oldDashboard }}</a>
      </nav>
      <div class="theme" role="group" [attr.aria-label]="t().themeLabel">
        <label
          >Lingua / Language
          <select #langSel [value]="lang.lang()" (change)="lang.set(langSel.value)">
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select></label
        >
        <label
          >{{ t().themeLabel }}
          <select #themeSel [value]="theme.choice().theme" (change)="setTheme(themeSel.value)">
            <option value="simple">{{ t().themeSimple }}</option>
            <option value="eva">{{ t().themeEva }}</option>
          </select></label
        >
        <label
          >{{ t().modeLabel }}
          <select #modeSel [value]="theme.choice().mode" (change)="setMode(modeSel.value)">
            <option value="dark">{{ t().modeDark }}</option>
            <option value="light">{{ t().modeLight }}</option>
          </select></label
        >
        <label
          >{{ t().colourLabel }}
          <select #accentSel [value]="theme.choice().accent" (change)="setAccent(accentSel.value)">
            @for (a of accents; track a) {
              <option [value]="a">{{ t()[accentKey[a]] }}</option>
            }
          </select></label
        >
      </div>
    </header>
    <main>
      <h1 class="sr-only">{{ t().dashTitle }}</h1>
      @if (!session.token()) {
        <nerv-sign-in />
      } @else {
        @if (problemText(); as text) {
          <p role="alert" class="problem">{{ text }}</p>
        }
        <section class="glance" [attr.aria-label]="t().glance">
          <nerv-stat [label]="t().needsYou" [value]="'' + feed.approvals().length" [detail]="t().needsYouDetail" />
          <nerv-stat [label]="t().healthLabel" [value]="health()" [detail]="t().healthDetail" />
          <nerv-stat [label]="t().reminders" [value]="pending()" [detail]="t().remindersDetail" />
        </section>
        <div class="cols">
          <nerv-panel [heading]="t().sortiesTitle" headingId="dash-sorties">
            <span panel-meta class="meta">{{ feed.sorties().length }} {{ t().sortiesLatest }}</span>
            <ul class="rows">
              @for (s of feed.sorties(); track s.realId) {
                <li [attr.data-key]="s.realId">
                  <span class="sid">{{ s.id }}</span><span class="title">{{ s.title }}</span
                  ><span class="state" [attr.data-state]="s.status">{{ s.status }}</span>
                </li>
              } @empty {
                <li class="empty">{{ t().noSorties }}</li>
              }
            </ul>
          </nerv-panel>
          <nerv-panel [heading]="t().waitingForYou" headingId="dash-approvals">
            <ul class="rows">
              @for (a of feed.approvals(); track a.id) {
                <li [attr.data-key]="a.id">
                  <span class="sid">{{ a.sortie }}</span><span class="title">{{ a.tool }}</span
                  ><span class="state">{{ a.effect }}</span>
                </li>
              } @empty {
                <li class="empty">{{ t().nothingWaits }}</li>
              }
            </ul>
          </nerv-panel>
        </div>
        <nerv-panel [heading]="t().movingHere" headingId="dash-moving">
          <p class="meta">
            {{ t().movingBefore }} <a href="/dashboard/">{{ t().oldDashboard }}</a>{{ t().movingAfter }}
          </p>
          <ul class="moving">
            @for (m of moving; track m) {
              <li>{{ t()[m] }}</li>
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
    .problem {
      margin: 0;
      color: var(--danger);
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
  protected readonly lang = inject(Language);
  protected readonly t = this.lang.t;
  protected readonly accents = Object.keys(ACCENTS) as Accent[];
  protected readonly accentKey = ACCENT_KEY;
  protected readonly moving = MOVING;
  protected readonly health = computed(() => {
    const t = this.t();
    return { ok: t.healthOk, degraded: t.healthDegraded, issue: t.healthIssue, unknown: '—' }[this.feed.health()];
  });
  protected readonly pending = computed(() => {
    const h = this.feed.history();
    return h ? String(h.pending) : '—';
  });
  protected readonly feedLabel = computed(() => {
    const t = this.t();
    if (!this.session.token()) return t.notSignedIn;
    const mode = this.feed.mode();
    const how =
      mode === 'stream'
        ? t.feedLive
        : mode === 'poll'
          ? t.feedPolling
          : mode === 'paused'
            ? t.feedPaused
            : t.feedConnecting;
    return `${this.feed.problem() ? t.feedOffline : t.feedConnected} · ${how}`;
  });
  /** 403 and 5xx show the server's own message; an unreachable service says so. */
  protected readonly problemText = computed(() => {
    const problem = this.feed.problem(),
      t = this.t();
    if (!problem) return '';
    return problem.kind === 'offline'
      ? t.feedOffline + '.'
      : `${t.feedServerError} (${problem.status}): ${problem.message}`;
  });

  constructor() {
    effect(() => {
      const signedIn = !!this.session.token();
      untracked(() => (signedIn ? this.feed.start() : this.feed.stop()));
    });
    effect(() => {
      const language = this.feed.language();
      untracked(() => this.lang.adopt(language));
    });
    // A hidden page reads nothing; it reads and reconnects when it is visible again.
    const visibility = () => (document.hidden ? this.feed.pause() : this.feed.resume());
    document.addEventListener('visibilitychange', visibility);
    visibility();
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', visibility);
      this.feed.stop();
      this.feed.resume();
    });
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
