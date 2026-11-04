import type { StoreApi } from './runtime.ts';
/**
 * Hyuga's brief (F-003): a short daily summary built from facts in the ledger, not by a model, so it is quick and never
 * invents anything. It lists the cards waiting for the owner, reminders due in the next 24 hours, what finished or
 * failed since the previous brief, and health problems. Times are shown in the owner's time zone.
 */
export interface BriefInput {
 now:Date;timeZone:string;language:'it'|'en';base?:string;
 approvals:{tool:string;expires:string}[];
 reminders:{title:string;due:string}[];
 sorties:{title:string;status:string;closed:string|null}[];
 health:string[];
}
const words={
 en:{title:'Good morning. Hyuga\'s brief',needs:'Needs you',none:'Nothing waits for you.',expires:'expires',due:'Due in the next 24 h',noDue:'No reminders in the next 24 h.',since:'Since the last brief',done:'done',failed:'failed',quiet:'Nothing finished or failed.',health:'Health',ok:'All checks pass.'},
 it:{title:'Buongiorno. Il brief di Hyuga',needs:'Ti aspettano',none:'Nulla ti aspetta.',expires:'scade',due:'In scadenza nelle prossime 24 h',noDue:'Nessun promemoria nelle prossime 24 h.',since:'Dall\'ultimo brief',done:'fatte',failed:'fallite',quiet:'Nulla di concluso o fallito.',health:'Stato',ok:'Tutti i controlli sono a posto.'},
};
export function composeBrief(b:BriefInput):string {
 const w=words[b.language];
 const at=(iso:string)=>new Intl.DateTimeFormat(b.language==='it'?'it-IT':'en-GB',{timeZone:b.timeZone,weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
 const soon=b.reminders.filter(r=>{const t=Date.parse(r.due);return t>b.now.getTime()&&t<=b.now.getTime()+86_400_000;}).sort((x,y)=>Date.parse(x.due)-Date.parse(y.due));
 const done=b.sorties.filter(s=>s.status==='done'),failed=b.sorties.filter(s=>s.status==='failed');
 const lines=[`☀️ ${w.title}${b.base?` · ${b.base}`:''}`,'',`${w.needs}: ${b.approvals.length}`,...(b.approvals.length?b.approvals.slice(0,5).map(a=>`• ${a.tool} (${w.expires} ${at(a.expires)})`):[w.none]),
  '',`${w.due}: ${soon.length}`,...(soon.length?soon.slice(0,8).map(r=>`• ${at(r.due)} ${r.title}`):[w.noDue]),
  '',`${w.since}: ${done.length} ${w.done}, ${failed.length} ${w.failed}`,...(failed.length?failed.slice(0,5).map(s=>`• ✗ ${s.title}`):done.length?[]:[w.quiet]),
  '',`${w.health}: ${b.health.length?b.health.join('; '):w.ok}`];
 return lines.join('\n').slice(0,3500);
}
/** The local date (YYYY-MM-DD) and minutes since local midnight in the owner's time zone. */
export function localClock(now:Date,timeZone:string):{date:string;minutes:number} {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,minutes:Number(parts.hour)*60+Number(parts.minute)};
}
/** Due once per local day, at or after `at` (HH:MM), and only if today's brief has not gone out yet. */
export function briefDue(now:Date,timeZone:string,at:string,lastSent:string|undefined):string|undefined {
 const [h,m]=at.split(':').map(Number);const clock=localClock(now,timeZone);
 return clock.minutes>=h!*60+m!&&lastSent!==clock.date?clock.date:undefined;
}
/** Reads the brief's facts through the store interface (the running service, or the CLI's local store). */
export async function gatherBrief(store:Pick<StoreApi,'approvals'|'list'|'sorties'|'health'>,since:Date):Promise<Pick<BriefInput,'approvals'|'reminders'|'sorties'|'health'>> {
 const [cards,reminders,sorties,health]=await Promise.all([store.approvals(5),store.list(),store.sorties(50),Promise.resolve(store.health()).catch(()=>({}))]);
 const p=(health as {processes?:{nervous?:number;brainAlive?:boolean}}).processes;const degraded=(health as {degraded?:unknown}).degraded;
 return {approvals:cards.map(a=>({tool:a.card.tool,expires:a.card.expires})),
  reminders:reminders.filter(r=>!r.delivered&&!r.cancelled).map(r=>({title:r.title,due:r.due})),
  sorties:sorties.filter(s=>s.closed&&Date.parse(s.closed)>since.getTime()).map(s=>({title:s.title,status:s.status,closed:s.closed})),
  health:[...(p&&p.brainAlive===false?['brain process not alive']:[]),...(Array.isArray(degraded)?degraded.filter((d):d is string=>typeof d==='string').slice(0,3):[])]};
}
