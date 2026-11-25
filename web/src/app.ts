import { Component, inject, InjectionToken, isDevMode, type ApplicationConfig } from '@angular/core';
import { provideRouter, RouterOutlet, type Routes } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { isInstalled } from './device-pairing.ts';
import { LiveFeed } from './live-feed.ts';
import { Nodo } from './nodo.ts';
import { Session } from './session.ts';

/** The `#code=…` login code main.ts took from the address before Angular started, or null. */
export const LOGIN_CODE = new InjectionToken<string | null>('nerv.login-code');

/**
 * F-130-T01: two layouts in one workspace. `/` is the simple page (Nodo), the base of the simple view (F-130-T16);
 * `/full` is the full dashboard, loaded on first visit. `/dashboard/` stays the old page until F-130-T13.
 */
export const routes: Routes = [
  { path: '', component: Nodo, title: 'NERV Agency · Your devices, connected.' },
  {
    path: 'full',
    loadComponent: () => import('./dashboard/shell.ts').then((m) => m.DashboardShell),
    title: 'NERV · Dashboard',
  },
  { path: '**', redirectTo: '' },
];

@Component({
  selector: 'nerv-app',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  constructor() {
    void inject(Session).start(inject(LOGIN_CODE));
  }
}

function browserStorage(kind: 'sessionStorage' | 'localStorage'): Storage | undefined {
  try {
    return window[kind];
  } catch {
    return undefined;
  }
}

export function appConfig(code: string | null): ApplicationConfig {
  return {
    providers: [
      provideRouter(routes),
      // F-004-T01: the production build registers the service worker (offline shell, update prompt); `ng serve` does not.
      // F-004-T09: workspace-sw.js runs ngsw-worker.js and posts a tapped reminder push's receipt.
      provideServiceWorker('workspace-sw.js', { enabled: !isDevMode() }),
      { provide: LOGIN_CODE, useValue: code },
      {
        provide: Session,
        useFactory: () =>
          new Session({
            fetch: (input, init) => fetch(input, init),
            tabStorage: () => browserStorage('sessionStorage'),
            appStorage: () => browserStorage('localStorage'),
            installed: isInstalled(window),
            userAgent: navigator.userAgent,
          }),
      },
      {
        provide: LiveFeed,
        useFactory: () =>
          new LiveFeed(
            inject(Session),
            (input, init) => fetch(input, init),
            { set: (run, ms) => setTimeout(run, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
            // The debrief counts what happened since this page opened.
            new Date().toISOString(),
          ),
      },
    ],
  };
}
