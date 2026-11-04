import {Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal} from '@angular/core';
import {NgOptimizedImage} from '@angular/common';
import {registerSurfaces} from './status-card';
import {messages} from './i18n';
import {bootstrapApplication} from '@angular/platform-browser';
interface Reminder {id:string;title:string;due:string;delivered:string|null;cancelled:string|null}
@Component({selector:'nerv-app',imports:[NgOptimizedImage],schemas:[CUSTOM_ELEMENTS_SCHEMA],template:`
<div class="shell"><aside><a class="brand" href="/"><img ngSrc="brand.svg" priority width="48" height="36" alt="NERV Agency">NERV<span>{{t().agent}}</span></a><nav [attr.aria-label]="t().workspace"><button (click)="view.set('home')" [class.active]="view()==='home'">◈ &nbsp; {{t().overview}}</button><button (click)="view.set('reminders')" [class.active]="view()==='reminders'">◷ &nbsp; {{t().reminders}}</button><button (click)="view.set('doctor')" [class.active]="view()==='doctor'">+ &nbsp; {{t().doctor}}</button></nav><div class="sidebar-foot"><i></i> Nodo · v0.1<br><small>{{t().foot}}</small></div></aside>
<main><header><label class="language">Lingua / Language <select #languageSelect [value]="language()" (change)="changeLanguage(languageSelect.value)"><option value="it">Italiano</option><option value="en">English</option></select></label><span>{{t().workspace}}</span><button class="quiet" (click)="refresh()">{{t().refresh}}</button></header><section class="intro"><p class="eyebrow">{{t().tagline}}</p><h1>{{t().world}}<br><em>{{t().together}}</em></h1><p>{{t().intro}}</p></section>
@if(!connected()){<section class="connect panel"><h2>{{t().connectTitle}}</h2><p>{{t().connectHint}}</p><label>{{t().token}}<input #token type="password" autocomplete="off" placeholder="NERV_TOKEN"></label><button (click)="connect(token.value);token.value=''">{{t().connect}}</button></section>}
@if(error()){<p role="alert" class="error">{{error()}}</p>}
@if(connected()){<nerv-status-card [surface]="statusSurface()"></nerv-status-card>
@if(view()!=='doctor'){<div class="section-heading"><h2>{{view()==='home'?t().horizon:t().reminders}}</h2><span>{{reminders().length}} {{t().recorded}}</span></div><div class="grid"><section class="panel"><h3>{{t().keep}}</h3><label>{{t().what}}<input #title [placeholder]="t().example" maxlength="500"></label><label>{{t().when}} <small>{{t().browserTime}}</small><input #due type="datetime-local"></label><button (click)="add(title.value,due.value,title)">{{t().tie}}</button><p class="hint">{{t().delivery}}</p></section><section class="panel"><h3>{{t().horizon}}</h3>@for(r of reminders();track r.id){<article class="reminder"><div><strong>{{r.title}}</strong><p>{{format(r.due)}}</p><small>{{r.cancelled?t().cancelled:r.delivered?t().delivered:t().scheduled}}</small></div>@if(!r.cancelled&&!r.delivered){<button class="quiet" (click)="cancel(r.id)" [attr.aria-label]="t().cancel+' '+r.title">×</button>}</article>}@empty{<p class="empty">{{t().empty}}</p>}</section></div><section class="panel inbox"><h3>{{t().inbox}}</h3>@for(message of inbox();track $index){<p>{{message}}</p>}@empty{<p class="hint">{{t().inboxHint}}</p>}</section>}
@if(view()==='doctor'){<section class="panel"><h2>{{t().doctor}}</h2><p>{{t().doctorHint}}</p><pre>{{doctor()}}</pre></section>}
<section class="roadmap"><span class="eyebrow">{{t().network}}</span><h2>{{t().room}}</h2><div class="cards"><article><span>01 / MAC</span><h3>{{t().models}}</h3><p>{{t().modelsHint}}</p><small>{{t().planned}}</small></article><article><span>02 / MINI PC</span><h3>{{t().home}}</h3><p>{{t().homeHint}}</p><small>{{t().planned}}</small></article><article><span>03 / RASPBERRY PI</span><h3>{{t().devices}}</h3><p>{{t().devicesHint}}</p><small>{{t().planned}}</small></article></div></section>}
<footer>NERV Agency <span>{{t().control}}</span></footer></main></div>`})
class App {
 statusSurface=computed(()=>({version:1,component:'nerv-status-card',props:{title:this.t().doctor,detail:this.t().doctorHint,status:this.runtimeState()}}));
 runtimeState=signal<'ok'|'waiting'|'error'>('waiting');
 language=signal<'it'|'en'>('en');t=computed(()=>messages[this.language()]);
 changeLanguage(value:string){if(value==='it'||value==='en'){this.language.set(value);document.documentElement.lang=value;}}

 view=signal('home');connected=signal(false);error=signal('');reminders=signal<Reminder[]>([]);inbox=signal<string[]>([]);doctor=signal('');private token='';
 format(d:string){return new Date(d).toLocaleString(this.language()==='it'?'it-IT':'en-GB');}
 async request(path:string,init:RequestInit={}){const response=await fetch('/api/'+path,{...init,headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.token}});const data:unknown=await response.json();if(!response.ok)throw new Error((data as {error?:string}).error??'Request failed');return data;}
 async connect(token:string){this.token=token;await this.refresh();}
 /** `npm start -- open` lands here with #code=…: drop it from the address and history first, then swap it once for the token. */
 constructor(){const match=/^#code=([a-f0-9]{32})$/.exec(window.location.hash);if(match){window.history.replaceState(null,'',window.location.pathname+window.location.search);void this.exchange(match[1]!);}}
 async exchange(code:string){try{const response=await fetch('/api/session/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const data=await response.json() as {token?:string};if(!response.ok||!data.token)throw new Error('code');await this.connect(data.token);}catch{this.error.set(this.t().codeError);}}
 async refresh(){this.error.set('');try{const [r,i,d]=await Promise.all([this.request('reminders'),this.request('inbox'),this.request('doctor')]);this.reminders.set(r as Reminder[]);this.inbox.set((i as {message:string}[]).map(x=>x.message));this.doctor.set(JSON.stringify(d,null,2));this.runtimeState.set((d as {processes?:{brainAlive?:boolean}}).processes?.brainAlive===false?'waiting':'ok');if(!this.connected()){const language=(d as {language?:string}).language;if(language)this.changeLanguage(language);}this.connected.set(true);}catch(e){this.runtimeState.set('error');this.error.set(this.t().connectionError);}}
 async add(title:string,due:string,input:HTMLInputElement){try{if(!due)throw new Error(this.t().dateRequired);await this.request('reminders',{method:'POST',body:JSON.stringify({title,due:new Date(due).toISOString()})});input.value='';await this.refresh();}catch(e){this.error.set(this.t().saveError);}}
 async cancel(id:string){try{await this.request('reminders/'+id,{method:'DELETE'});await this.refresh();}catch(e){this.error.set(this.t().cancelError);}}
}
registerSurfaces();
bootstrapApplication(App).catch(console.error);
