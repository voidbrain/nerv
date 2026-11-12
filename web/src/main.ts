import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, isDevMode, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { registerSurfaces } from './status-card';
import { messages } from './i18n';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServiceWorker } from '@angular/service-worker';
import { UpdatePrompt } from './update-prompt';
import { DoctorView } from './doctor-view';
import { SurfaceRenderer } from './surface-renderer';
/** F-004-T01: API calls go straight to the service; the service worker never sees or holds them. */
const SW_BYPASS = { 'ngsw-bypass': '1' };
interface Page<T> {
  items: T[];
  next: number | null;
}
type ReminderKind = 'at' | 'all-day' | 'from-to' | 'from' | 'until';
interface Reminder {
  id: string;
  title: string;
  due: string;
  kind?: ReminderKind;
  end?: string | null;
  delivered: string | null;
  cancelled: string | null;
}
@Component({
  selector: 'nerv-app',
  imports: [NgOptimizedImage, UpdatePrompt, DoctorView, SurfaceRenderer],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
<div class="shell"><aside><a class="brand" href="/"><img ngSrc="brand.svg" priority width="48" height="36" alt="NERV Agency">NERV<span>{{t().agent}}</span></a><nav [attr.aria-label]="t().workspace"><button (click)="view.set('home')" [class.active]="view()==='home'">◈ &nbsp; {{t().overview}}</button><button (click)="view.set('reminders')" [class.active]="view()==='reminders'">◷ &nbsp; {{t().reminders}}</button><button (click)="view.set('doctor')" [class.active]="view()==='doctor'">+ &nbsp; {{t().doctor}}</button></nav><div class="sidebar-foot"><i></i> Nodo · v0.1<br><small>{{t().foot}}</small></div></aside>
<main><nerv-update-prompt [t]="t()" /><header><label class="language">Lingua / Language <select #languageSelect [value]="language()" (change)="changeLanguage(languageSelect.value)"><option value="it">Italiano</option><option value="en">English</option></select></label><span>{{t().workspace}}</span><button class="quiet refresh-btn" (click)="refresh()">{{t().refresh}}</button>@if(connected()&&pushSupported()){<button class="quiet push-toggle" [class.active]="pushSubscribed()" [attr.aria-pressed]="pushSubscribed()" [disabled]="pushPending()" (click)="togglePush()">{{pushSubscribed()?t().pushActive:t().pushInactive}}</button>}</header><section class="intro"><p class="eyebrow">{{t().tagline}}</p><h1>{{t().world}}<br><em>{{t().together}}</em></h1><p>{{t().intro}}</p></section>
@if(!connected()){<section class="connect panel"><h2>{{t().connectTitle}}</h2><p>{{t().connectHint}}</p><label>{{t().token}}<input #token type="password" autocomplete="off" placeholder="NERV_TOKEN"></label><button (click)="connect(token.value);token.value=''">{{t().connect}}</button></section>}
@if(error()){<p role="alert" class="error">{{error()}}</p>}
@if(connected()){<nerv-surface-renderer [surface]="statusSurface()" [t]="t()"></nerv-surface-renderer>
@if(view()!=='doctor'){<div class="section-heading"><h2>{{view()==='home'?t().horizon:t().reminders}}</h2><span>{{reminders().length}} {{t().recorded}}</span></div><div class="grid"><section class="panel"><h3>{{t().keep}}</h3><label>{{t().what}}<input #title [placeholder]="t().example" maxlength="500"></label><label>{{t().when}} <small>{{t().browserTime}}</small><input #due type="datetime-local"></label><button (click)="add(title.value,due.value,title,due)">{{t().tie}}</button><p class="hint">{{t().delivery}}</p></section><section class="panel"><h3>{{t().horizon}}</h3>@for(r of reminders();track r.id){@if(editingId()!==r.id){<article class="reminder" [attr.data-reminder-id]="r.id"><div><strong>{{r.title}}</strong><p>{{formatReminder(r)}}</p><small>{{r.cancelled?t().cancelled:r.delivered?t().delivered:t().scheduled}}</small></div>@if(!r.cancelled&&!r.delivered){<div class="reminder-actions"><button class="quiet cancel-btn" (click)="cancel(r.id)" [attr.aria-label]="t().cancel+' '+r.title">×</button><button class="quiet edit-btn" (click)="startEdit(r)" [attr.aria-label]="t().edit+' '+r.title">{{t().edit}}</button></div>}</article>}@if(editingId()===r.id){<article class="reminder editing" [attr.data-reminder-id]="r.id"><form class="rem-edit" (submit)="saveEdit($event,r.id)" novalidate><label [attr.for]="'rem-edit-title-'+r.id">{{t().what}}</label><input [id]="'rem-edit-title-'+r.id" type="text" [value]="editTitle()" (input)="editTitle.set($any($event.target).value)" maxlength="500"><label [attr.for]="'rem-edit-due-'+r.id">{{t().when}} <small>{{t().browserTime}}</small></label><input [id]="'rem-edit-due-'+r.id" type="datetime-local" [value]="editDue()" (input)="editDue.set($any($event.target).value)"><div class="edit-actions"><button type="submit" class="save-btn">{{t().save}}</button><button type="button" class="quiet keep-btn" (click)="cancelEdit(r.id)">{{t().keepAsIs}}</button></div></form></article>}}@empty{<p class="empty">{{t().empty}}</p>}<div role="group" data-history="reminders" [attr.aria-label]="t().reminderPages"><button class="quiet" (click)="pageReminders(false)" [disabled]="reminderBefore().length===1" [attr.aria-disabled]="paging()||reminderBefore().length===1">{{t().previous}}</button><button class="quiet" (click)="pageReminders(true)" [disabled]="reminderNext()===null" [attr.aria-disabled]="paging()||reminderNext()===null">{{t().next}}</button></div></section></div><section class="panel inbox"><h3>{{t().inbox}}</h3>@for(message of inbox();track $index){<p>{{message}}</p>}@empty{<p class="hint">{{t().inboxHint}}</p>}<div role="group" data-history="inbox" [attr.aria-label]="t().inboxPages"><button class="quiet" (click)="pageInbox(false)" [disabled]="inboxBefore().length===1" [attr.aria-disabled]="paging()||inboxBefore().length===1">{{t().previous}}</button><button class="quiet" (click)="pageInbox(true)" [disabled]="inboxNext()===null" [attr.aria-disabled]="paging()||inboxNext()===null">{{t().next}}</button></div><div role="status">{{paging()?t().loading:t().pageReady}}</div></section>}
@if(view()==='doctor'){<nerv-doctor-view [t]="t()" [raw]="doctorRaw()"></nerv-doctor-view>}
<section class="roadmap"><span class="eyebrow">{{t().network}}</span><h2>{{t().room}}</h2><div class="cards"><article><span>01 / MAC</span><h3>{{t().models}}</h3><p>{{t().modelsHint}}</p><small>{{t().planned}}</small></article><article><span>02 / MINI PC</span><h3>{{t().home}}</h3><p>{{t().homeHint}}</p><small>{{t().planned}}</small></article><article><span>03 / RASPBERRY PI</span><h3>{{t().devices}}</h3><p>{{t().devicesHint}}</p><small>{{t().planned}}</small></article></div></section>}
<footer>NERV Agency <span>{{t().control}}</span></footer></main></div>`,
})
class App {
  customSurface = signal<unknown>(null);
  statusSurface = computed(
    () =>
      this.customSurface() ?? {
        version: 1,
        component: 'nerv-status-card',
        props: { title: this.t().doctor, detail: this.t().doctorHint, status: this.runtimeState() },
      },
  );
  runtimeState = signal<'ok' | 'waiting' | 'error'>('waiting');
  language = signal<'it' | 'en'>('en');
  t = computed(() => messages[this.language()]);
  changeLanguage(value: string) {
    if (value === 'it' || value === 'en') {
      this.language.set(value);
      document.documentElement.lang = value;
    }
  }

  paging = signal(false);
  reminderBefore = signal([0]);
  inboxBefore = signal([0]);
  reminderNext = signal<number | null>(null);
  inboxNext = signal<number | null>(null);
  private revision = 0;
  view = signal('home');
  connected = signal(false);
  pushSupported = signal(false);
  pushSubscribed = signal(false);
  pushPending = signal(false);
  error = signal('');
  reminders = signal<Reminder[]>([]);
  editingId = signal<string | null>(null);
  editTitle = signal('');
  editDue = signal('');
  inbox = signal<string[]>([]);
  doctor = signal('');
  doctorRaw = signal<unknown>({});
  private token = '';
  localInput(iso: string) {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  format(d: string) {
    return new Date(d).toLocaleString(this.language() === 'it' ? 'it-IT' : 'en-GB');
  }
  formatReminder(r: Reminder) {
    const kind = r.kind ?? 'at';
    if (kind === 'at') return this.format(r.due);
    const locale = this.language() === 'it' ? 'it-IT' : 'en-GB';
    const hm = (iso: string) =>
      new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
    if (kind === 'all-day') {
      return `${new Date(r.due).toLocaleDateString(locale)} · ${this.t().allDay}`;
    }
    if (kind === 'from-to') {
      const day = new Date(r.due).toLocaleDateString(locale);
      const endHm = r.end ? hm(r.end) : '';
      return endHm ? `${day}, ${hm(r.due)}–${endHm}` : `${day}, ${hm(r.due)}`;
    }
    if (kind === 'from') {
      return `${new Date(r.due).toLocaleDateString(locale)} · ${this.t().fromTime} ${hm(r.due)}`;
    }
    const target = r.end || r.due;
    return `${new Date(target).toLocaleDateString(locale)} · ${this.t().untilTime} ${hm(target)}`;
  }
  async request(path: string, init: RequestInit = {}) {
    const response = await fetch('/api/' + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token, ...SW_BYPASS },
    });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error((data as { error?: string }).error ?? 'Request failed');
    return data;
  }
  async connect(token: string) {
    this.token = token;
    await this.refresh();
    await this.checkPushSubscription();
  }
  /** `npm start -- open` lands here with #code=…: drop it from the address and history first, then swap it once for the token. */
  constructor() {
    if (typeof window !== 'undefined') {
      (window as unknown as { __nervSetSurface?: (s: unknown) => void }).__nervSetSurface = (s: unknown) =>
        this.customSurface.set(s);
      (window as unknown as { __nervApp?: App }).__nervApp = this;
      (window as unknown as { __nervTogglePush?: () => Promise<void> }).__nervTogglePush = () => this.togglePush();
      if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
        this.pushSupported.set(true);
      }
    }
    const match = /^#code=([a-f0-9]{32})$/.exec(window.location.hash);
    if (match) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      void this.exchange(match[1]!);
    }
  }
  async checkPushSubscription() {
    if (!this.pushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      this.pushSubscribed.set(!!sub);
    } catch {
      // service worker or pushManager unavailable
    }
  }
  async togglePush() {
    if (!this.pushSupported() || this.pushPending()) return;
    this.pushPending.set(true);
    this.error.set('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
        await this.request('push/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        this.pushSubscribed.set(false);
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('Permission denied');
        }
        const keyData = (await this.request('push/key')) as { publicKey?: string };
        if (!keyData?.publicKey) throw new Error('No VAPID key');
        const rawKey = this.urlBase64ToUint8Array(keyData.publicKey);
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: rawKey as unknown as BufferSource,
        });
        const subJson = sub.toJSON();
        await this.request('push/subscribe', {
          method: 'POST',
          body: JSON.stringify({
            endpoint: sub.endpoint,
            keys: subJson.keys,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          }),
        });
        this.pushSubscribed.set(true);
      }
    } catch {
      this.error.set(this.t().pushError);
    } finally {
      this.pushPending.set(false);
    }
  }
  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
  async exchange(code: string) {
    try {
      const response = await fetch('/api/session/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...SW_BYPASS },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json()) as { token?: string };
      if (!response.ok || !data.token) throw new Error('code');
      await this.connect(data.token);
    } catch {
      this.error.set(this.t().codeError);
    }
  }
  async refresh() {
    const revision = ++this.revision;
    this.error.set('');
    this.paging.set(true);
    try {
      const [r, i, d] = await Promise.all([
        this.request('reminders/page'),
        this.request('inbox/history'),
        this.request('doctor'),
      ]);
      if (revision !== this.revision) return;
      this.reminders.set((r as Page<Reminder>).items);
      if (this.editingId()) {
        const stillOpen = (r as Page<Reminder>).items.some(
          (x) => x.id === this.editingId() && !x.cancelled && !x.delivered,
        );
        if (!stillOpen) this.editingId.set(null);
      }
      this.reminderNext.set((r as Page<Reminder>).next);
      this.reminderBefore.set([0]);
      this.inbox.set((i as Page<{ message: string }>).items.map((x) => x.message));
      this.inboxNext.set((i as Page<{ message: string }>).next);
      this.inboxBefore.set([0]);
      this.doctor.set(JSON.stringify(d, null, 2));
      this.doctorRaw.set(d);
      this.runtimeState.set(
        (d as { processes?: { brainAlive?: boolean } }).processes?.brainAlive === false ? 'waiting' : 'ok',
      );
      if (!this.connected()) {
        const language = (d as { language?: string }).language;
        if (language) this.changeLanguage(language);
      }
      this.connected.set(true);
    } catch {
      if (revision === this.revision) {
        this.runtimeState.set('error');
        this.error.set(this.t().connectionError);
      }
    } finally {
      if (revision === this.revision) this.paging.set(false);
    }
  }
  async pageReminders(next: boolean) {
    await this.turnPage('reminders', next);
  }
  async pageInbox(next: boolean) {
    await this.turnPage('inbox', next);
  }
  private async turnPage(kind: 'reminders' | 'inbox', next: boolean) {
    if (this.paging()) return;
    const focused = document.activeElement;
    const group = document.querySelector('[data-history=' + kind + ']');
    const restoreFocus = focused instanceof HTMLButtonElement && group?.contains(focused);
    const stack = kind === 'reminders' ? this.reminderBefore : this.inboxBefore;
    const cursor = kind === 'reminders' ? this.reminderNext() : this.inboxNext();
    if (next ? cursor === null : stack().length === 1) return;
    const before = next ? [...stack(), cursor!] : stack().slice(0, -1);
    const revision = ++this.revision;
    this.paging.set(true);
    this.error.set('');
    try {
      const page = (await this.request(
        (kind === 'reminders' ? 'reminders/page' : 'inbox/history') + '?before=' + before.at(-1),
      )) as Page<Reminder & { message: string }>;
      if (revision !== this.revision) return;
      if (kind === 'reminders') {
        this.reminders.set(page.items);
        this.reminderNext.set(page.next);
      } else {
        this.inbox.set(page.items.map((x) => x.message));
        this.inboxNext.set(page.next);
      }
      stack.set(before);
    } catch {
      if (revision === this.revision) this.error.set(this.t().connectionError);
    } finally {
      if (revision === this.revision) {
        this.paging.set(false);
        if (restoreFocus)
          requestAnimationFrame(() => {
            if (document.activeElement === document.body || document.activeElement === focused) {
              const button = focused as HTMLButtonElement;
              (button.disabled ? group?.querySelector<HTMLButtonElement>('button:not(:disabled)') : button)?.focus();
            }
          });
      }
    }
  }
  startEdit(r: Reminder) {
    this.error.set('');
    this.editingId.set(r.id);
    this.editTitle.set(r.title);
    this.editDue.set(this.localInput(r.kind === 'until' && r.end ? r.end : r.due));
    requestAnimationFrame(() => {
      const input = document.getElementById('rem-edit-title-' + r.id) as HTMLInputElement | null;
      input?.focus();
    });
  }
  cancelEdit(id: string) {
    this.error.set('');
    this.editingId.set(null);
    requestAnimationFrame(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-reminder-id="' + id + '"] .edit-btn');
      btn?.focus();
    });
  }
  async saveEdit(event: Event, id: string) {
    event.preventDefault();
    this.error.set('');
    const title = this.editTitle().trim();
    const due = this.editDue();
    if (!title || title.length > 500) {
      this.error.set(this.t().saveError);
      return;
    }
    if (!due || !Number.isFinite(new Date(due).getTime())) {
      this.error.set(this.t().saveError);
      return;
    }
    if (new Date(due).getTime() <= Date.now()) {
      this.error.set(this.t().saveError);
      return;
    }
    const current = this.reminders().find((r) => r.id === id);
    if (!current) {
      this.editingId.set(null);
      return;
    }
    const patch: { title?: string; due?: string; end?: string } = {};
    if (title !== current.title) patch.title = title;
    const targetIso = current.kind === 'until' && current.end ? current.end : current.due;
    if (new Date(due).toISOString() !== new Date(targetIso).toISOString()) {
      const nextIso = new Date(due).toISOString();
      if (current.kind === 'until') {
        patch.end = nextIso;
      } else {
        patch.due = nextIso;
        if (current.kind === 'from-to' && current.end) {
          const span = Math.max(60_000, new Date(current.end).getTime() - new Date(current.due).getTime());
          if (new Date(nextIso).getTime() >= new Date(current.end).getTime()) {
            patch.end = new Date(new Date(nextIso).getTime() + span).toISOString();
          }
        }
      }
    }
    if (Object.keys(patch).length === 0) {
      this.cancelEdit(id);
      return;
    }
    try {
      await this.request('reminders/' + id, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      this.editingId.set(null);
      await this.refresh();
      requestAnimationFrame(() => {
        const btn = document.querySelector<HTMLButtonElement>('[data-reminder-id="' + id + '"] .edit-btn');
        btn?.focus();
      });
    } catch {
      this.error.set(this.t().editError);
    }
  }
  async add(title: string, due: string, input: HTMLInputElement, dueInput?: HTMLInputElement) {
    this.error.set('');
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 500) {
      this.error.set(this.t().saveError);
      return;
    }
    if (!due || !Number.isFinite(new Date(due).getTime())) {
      this.error.set(this.t().saveError);
      return;
    }
    if (new Date(due).getTime() <= Date.now()) {
      this.error.set(this.t().saveError);
      return;
    }
    try {
      await this.request('reminders', {
        method: 'POST',
        body: JSON.stringify({ title: trimmed, due: new Date(due).toISOString() }),
      });
      input.value = '';
      if (dueInput) dueInput.value = '';
      await this.refresh();
    } catch {
      this.error.set(this.t().saveError);
    }
  }
  async cancel(id: string) {
    try {
      if (this.editingId() === id) this.editingId.set(null);
      await this.request('reminders/' + id, { method: 'DELETE' });
      await this.refresh();
    } catch {
      this.error.set(this.t().cancelError);
    }
  }
}
registerSurfaces();
// F-004-T01: the production build registers the service worker (offline shell, update prompt); `ng serve` does not.
bootstrapApplication(App, {
  providers: [provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() })],
}).catch(console.error);
